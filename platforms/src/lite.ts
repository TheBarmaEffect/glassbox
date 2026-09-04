import crypto from "node:crypto";
import { normalizeInput } from "./parser.js";
import {
  PROMPT_INJECTION_PATTERN,
  credentialText,
  dangerousActionSignals,
  secretSignals,
  securityText,
} from "./signals.js";
import { networkBoundaryFinding, targetMatchesValue } from "./network.js";
import { checksumFailures, extractCitationFindings, grammarFailures } from "./citation.js";
import { TOOL_PROBE_ANGLES, toolCallProbes } from "./toolcall.js";
import type {
  Claim,
  ConstitutionRule,
  RedTeamProbe,
  ResponseAction,
  TrustCard,
  VerificationInput,
  Verifier,
} from "./types.js";

const MAX_CLAIMS = 24;
/**
 * Security probes scan a wider window than the reported claim list. MAX_CLAIMS bounds
 * what is *reported*; scanning only that window let an attacker prepend 24 benign
 * sentences and push a contradiction or an injection payload out of view entirely.
 * The answer is already length-capped upstream, so this window is bounded by construction.
 */
const SECURITY_SCAN_LIMIT = 200;
/** Hard ceiling on pairwise contradiction comparisons, so the wider window cannot blow up. */
const MAX_CONTRADICTION_PAIRS = 20_000;
const FACT_CHECK_CAVEAT =
  "GlassBox Lite is a deterministic reasoning check, not a fact-check; it does not browse, validate citations, or verify external facts.";

const CERTAINTY_PATTERN =
  /\b(?:always|never|definitely|certainly|absolutely certain|absolute certainty|guaranteed|indisputable|undeniable|unquestionably|(?:without|beyond)\s+(?:a |any )?doubt|no doubt(?:\s+whatsoever)?|beyond question|proves?|proven|100\s*%|must be true)\b/i;
const UNCERTAINTY_PATTERN =
  /\b(?:may|might|could|perhaps|possibly|likely|unlikely|uncertain|unclear|cannot confirm|can't confirm|do not know|don't know|unable to verify|not enough information)\b/i;
const CITATION_PATTERN =
  /https?:\/\/\S+|www\.\S+|\bdoi:\s*10\.\d{4,9}\/\S+|\[[0-9]{1,3}\]|\b[A-Z][A-Za-z'-]+(?:\s+et al\.)?\s*\([12][0-9]{3}\)/g;
const VAGUE_ATTRIBUTION_NOUNS =
  "studies|study|research|researchers|experts|scientists|analysts|authorities|reports|literature|papers|sources|evidence|data";
const VAGUE_ATTRIBUTION_VERBS =
  "show|shows|shown|prove|proves|proven|confirm|confirms|confirmed|say|says|suggest|suggests|suggested|" +
  "indicate|indicates|indicated|agree|agrees|agreed|demonstrate|demonstrates|demonstrated|" +
  "find|finds|found|conclude|concludes|concluded|report|reports|reported|claim|claims|claimed";
// Bounded gap so an auxiliary ("papers have demonstrated") is covered without
// letting the match run across an unrelated clause.
const VAGUE_SOURCE_PATTERN = new RegExp(
  `\\b(?:${VAGUE_ATTRIBUTION_NOUNS})\\b[^.!?]{0,32}?\\b(?:${VAGUE_ATTRIBUTION_VERBS})\\b` +
  `|\\bit is (?:well|widely|commonly|generally)\\s+(?:known|understood|accepted|agreed|established)\\b`,
  "i",
);
const SOURCE_REQUEST_PATTERN =
  /\b(?:fact[- ]?check|verify (?:the )?facts?|is (?:this|that|it) true|correctness|cite|citation|source|evidence|reference|bibliograph)\b/i;
const SPECIFIC_FACT_PATTERN =
  /(?:\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s*%\b|[$€£]\s*\d|\bCVE-\d{4}-\d{4,}\b|\b\d+(?:\.\d+)?\s*(?:mg|ml|g|kg|GB|TB|ms)\b)/i;

const NEGATION_PATTERN =
  /\b(?:not|never|no|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|wouldn't|couldn't|shouldn't|hasn't|haven't|hadn't)\b/i;

// Operand length is bounded. Unbounded \d[\d,]* made every start position in a long
// digit run scan the whole run before failing to find an operator, which is quadratic:
// a 12 000-digit answer cost ~160x a benign one on a maxConcurrency=1 service. Arithmetic
// beyond 30 digits is out of the allowlisted scope rather than checked slowly.
const NUMBER_SOURCE = "[-+]?(?:\\d[\\d,]{0,30}(?:\\.\\d{1,15})?|\\.\\d{1,15})";

/**
 * Single-character substitutions that spell the same arithmetic differently: fullwidth
 * forms, the Unicode minus sign, and arrows used as an equals. Every mapping is one
 * character to one character, so match offsets into the original answer stay valid and
 * no separate index map is needed.
 */
const NOTATION_FOLD: Record<string, string> = {
  "\uFF0B": "+", "\uFF0D": "-", "\uFF0A": "*", "\uFF0F": "/", "\uFF1D": "=",
  "\u2212": "-", "\u2192": "=", "\u21D2": "=", "\u279C": "=", "\uFF1A": ":",
};

function foldNotation(value: string): string {
  return value
    .replace(/[\uFF10-\uFF19]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/[\uFF0B\uFF0D\uFF0A\uFF0F\uFF1D\u2212\u2192\u21D2\u279C\uFF1A]/g, (character) => NOTATION_FOLD[character] ?? character);
}
const PERCENT_ARITHMETIC = new RegExp(
  `(${NUMBER_SOURCE})\\s*%\\s+of\\s+(${NUMBER_SOURCE})\\s*(?:={1,3}|equals?|is)\\s*(${NUMBER_SOURCE})`,
  "gi",
);
const RATIO_PERCENT_ARITHMETIC = new RegExp(
  `(${NUMBER_SOURCE})\\s*(?:out\\s+of|/)\\s*(${NUMBER_SOURCE})\\s*(?:={1,3}|equals?|is)\\s*(${NUMBER_SOURCE})\\s*%`,
  "gi",
);
// The leading lookbehind rejects an operand that is itself preceded by an operator, so a
// chain such as "3 + 4 + 5 = 12" no longer matches its own tail "4 + 5 = 12" and report a
// correct expression as an arithmetic error. Multi-operand arithmetic stays out of scope
// rather than being silently mis-evaluated: the allowlist is binary expressions only.
const BINARY_ARITHMETIC = new RegExp(
  `(?<![-+*×x/÷]\\s{0,4})(${NUMBER_SOURCE})\\s*(\\+|-|\\*|×|x|/|÷)\\s*(${NUMBER_SOURCE})\\s*(?:={1,3}|equals?|is)\\s*(${NUMBER_SOURCE})(?![\\d,.]*\\s*%)(?!\\s*[-+*×/÷]\\s*\\d)`,
  "gi",
);

/**
 * Word-form arithmetic. Answers state arithmetic in words at least as often as in
 * symbols ("9 times 9 is 80", "the product of 9 and 9 is 80"), and the symbolic pattern
 * above cannot see any of it. Ported from an uncommitted working copy; the operand bound
 * and the chain guard below are the ones the symbolic pattern already uses.
 *
 * This extends `arithmetic_sanity`, the probe with held-out recall 1.000, and it stays a
 * *computed* check: the expression is recomputed rather than recognised, so it is
 * indifferent to phrasings nobody enumerated.
 */
const WORD_OPERATORS =
  "times|multiplied\\s+by|plus|added\\s+to|minus|less|subtracted\\s+from|divided\\s+by|over";
// Same reasoning as BINARY_ARITHMETIC: an operand already preceded by a word operator is
// the tail of a longer chain, not a new expression, so "2 plus 3 plus 4 is 9" must not
// match "3 plus 4 is 9" and report correct prose as an arithmetic error.
const WORD_ARITHMETIC = new RegExp(
  `(?<!\\b(?:${WORD_OPERATORS})\\s)(${NUMBER_SOURCE})\\s+(${WORD_OPERATORS})\\s+(${NUMBER_SOURCE})` +
  `\\s*(?:={1,3}|equals?|is|gives|makes)\\s*(${NUMBER_SOURCE})(?![\\d,.]*\\s*%)` +
  `(?!\\s+(?:${WORD_OPERATORS})\\s)`,
  "gi",
);
const NAMED_ARITHMETIC = new RegExp(
  `\\b(product|sum|difference|quotient)\\s+of\\s+(${NUMBER_SOURCE})\\s+and\\s+(${NUMBER_SOURCE})` +
  `\\s*(?:={1,3}|equals?|is)\\s*(${NUMBER_SOURCE})(?![\\d,.]*\\s*%)`,
  "gi",
);

/** Symbolic operator equivalent of a word operator, so one code path recomputes both. */
function wordOperatorSymbol(word: string): string | undefined {
  const normalized = word.toLowerCase().replace(/\s+/g, " ");
  if (normalized === "plus" || normalized === "added to") return "+";
  if (normalized === "minus" || normalized === "less") return "-";
  if (normalized === "times" || normalized === "multiplied by") return "*";
  if (normalized === "divided by" || normalized === "over") return "/";
  // "3 subtracted from 10" reverses its operands, so it has no single-symbol equivalent
  // and is handled numerically rather than pretending the symbolic path applies.
  return undefined;
}

function applyWordOperator(word: string, left: number, right: number): number | undefined {
  const normalized = word.toLowerCase().replace(/\s+/g, " ");
  if (normalized === "plus" || normalized === "added to") return left + right;
  if (normalized === "minus" || normalized === "less") return left - right;
  if (normalized === "subtracted from") return right - left;
  if (normalized === "times" || normalized === "multiplied by") return left * right;
  if ((normalized === "divided by" || normalized === "over") && right !== 0) return left / right;
  return undefined;
}

const NAMED_OPERATOR_SYMBOL: Record<string, string> = {
  sum: "+", difference: "-", product: "*", quotient: "/",
};

function applyNamedOperator(name: string, left: number, right: number): number | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "sum") return left + right;
  if (normalized === "difference") return left - right;
  if (normalized === "product") return left * right;
  if (normalized === "quotient" && right !== 0) return left / right;
  return undefined;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "for", "from", "has",
  "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "their", "there", "these", "this",
  "those", "to", "was", "were", "will", "with", "not", "never", "no", "cannot", "cant", "isnt", "arent",
  "wasnt", "werent", "doesnt", "dont", "didnt", "wont", "wouldnt", "couldnt", "shouldnt", "hasnt", "havent",
  "hadnt", "all",
  // Auxiliary and modal verbs are function words: they must not count toward
  // content overlap. Their absence made "X succeeded" / "X did not succeed"
  // score 2/3 on Jaccard and fall under the contradiction threshold.
  "do", "does", "did", "done", "had", "am", "can", "could", "would", "should",
  "may", "might", "must", "shall",
]);

interface ArithmeticCheck {
  expression: string;
  passed: boolean;
  expected?: number;
  actual?: number;
  start: number;
  end: number;
}

interface Contradiction {
  left: string;
  right: string;
}

interface Analysis {
  claims: Claim[];
  probes: RedTeamProbe[];
  truncatedClaims: boolean;
  arithmetic: ArithmeticCheck[];
}

export class GlassboxLiteVerifier implements Verifier {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify(raw: VerificationInput): Promise<TrustCard> {
    const input = normalizeInput(raw);
    const analysis = analyze(input);
    const customRules = input.constitution?.rules ?? [];
    analysis.probes.push(...evaluateConstitution(input, customRules));
    if (input.tool) {
      analysis.probes.push(...toolCallProbes(input.tool, input.tool_pins ?? [], input.allowed_tools));
    }
    const failed = analysis.probes.filter((probe) => !probe.passed);
    const decisive = failed.filter((probe) => isDecisive(probe, input.checkpoint?.type));
    const verdict: TrustCard["verdict"] = decisive.length > 0
      ? "reject"
      : failed.length > 0
        ? "caution"
        : "trust";
    const hash = inputsHash(input);
    const dimensions = scoreDimensions(analysis.probes);
    const total = round(
      Object.values(dimensions).reduce((sum, value) => sum + value, 0) /
      Math.max(1, Object.keys(dimensions).length),
    );
    const highestSeverity = failed.length > 0
      ? failed.map((probe) => probe.severity).sort((a, b) => severityRank(b) - severityRank(a))[0] ?? "low"
      : "low";

    return {
      question: input.question,
      answer: input.answer,
      verdict,
      verdict_rationale: verdictRationale(verdict, failed, decisive),
      ecs: {
        total,
        dimensions,
        notes: [
          FACT_CHECK_CAVEAT,
          `Extracted ${analysis.claims.length}${analysis.truncatedClaims ? "+" : ""} claim-like statement(s) from the submitted answer.`,
          "Scores describe structural signals only; they are not probabilities that the answer is true.",
        ],
      },
      claims: analysis.claims,
      red_team: {
        probes: analysis.probes,
        pass_rate: round(analysis.probes.filter((probe) => probe.passed).length / analysis.probes.length),
        highest_severity: highestSeverity,
      },
      constitution: constitution(analysis.probes, customRules),
      governance: governance(input, verdict),
      audit: {
        log_id: `lite-${hash.slice(0, 16)}`,
        generated_at: this.now().toISOString(),
        inputs_hash: hash,
      },
    };
  }

  async ready(): Promise<boolean> {
    return true;
  }
}

function analyze(input: VerificationInput): Analysis {
  const extracted = extractClaims(input.answer);
  const claimTexts = extracted.claims;
  const arithmetic = arithmeticChecks(input.answer);
  const contradictions = findContradictions(extracted.scanWindow);
  const certaintyClaims = claimTexts.filter(assertsUnhedgedCertainty);
  const citations = citationSignals(input.answer);
  const vagueAttribution = VAGUE_SOURCE_PATTERN.test(input.answer);
  const sourceRequested = SOURCE_REQUEST_PATTERN.test(
    `${input.question}\n${(input.intents ?? []).join("\n")}`,
  );
  // Scan the whole answer, not just the reported claims: a payload placed after the
  // MAX_CLAIMS boundary is still in the output that gets released.
  const answerInjection = PROMPT_INJECTION_PATTERN.test(securityText(input.answer));
  const answerInjectionSignals = extracted.scanWindow.filter((claim) => PROMPT_INJECTION_PATTERN.test(securityText(claim)));
  // Intents and checkpoint metadata are caller-supplied and travel in the same request
  // body as the question. They were previously never scanned at all.
  const callerMetadata = [
    input.question,
    ...(input.intents ?? []),
    input.checkpoint?.id ?? "",
    input.checkpoint?.actor ?? "",
  ].join("\n");
  const inputInjection = PROMPT_INJECTION_PATTERN.test(securityText(callerMetadata));
  const secretScanText = `${callerMetadata}\n${input.answer}`;
  const exposedSecrets = secretSignals(credentialText(secretScanText));
  const dangerousActions = dangerousActionSignals(secretScanText);
  const unsafeNetworkTarget = networkBoundaryFinding(input.checkpoint?.target);
  const unsupportedSpecifics = claimTexts.filter((claim) =>
    SPECIFIC_FACT_PATTERN.test(claim) && citationSignals(claim).length === 0 &&
    !arithmetic.some((check) => claim.includes(check.expression)),
  );
  const claims = claimTexts.map((text, index) => buildClaim(text, index, arithmetic));

  const probes: RedTeamProbe[] = [
    {
      angle: "claim_extraction",
      passed: claims.length > 0 && !extracted.truncated,
      severity: extracted.truncated ? "medium" : claims.length > 0 ? "low" : "medium",
      finding: extracted.truncated
        ? `Claim extraction reached the ${MAX_CLAIMS}-claim safety cap; later statements were not individually analyzed.`
        : claims.length > 0
          ? `Extracted ${claims.length} claim-like statement(s) for deterministic checks.`
          : "No claim-like statement could be extracted from the answer.",
      evidence: [],
    },
    {
      angle: "unsupported_certainty",
      passed: certaintyClaims.length === 0,
      severity: certaintyClaims.length > 0 ? "medium" : "low",
      finding: certaintyClaims.length > 0
        ? "Absolute-certainty language was detected. Lite cannot establish that level of confidence from submitted text alone."
        : "No unsupported absolute-certainty phrase was detected.",
      evidence: certaintyClaims.slice(0, 3),
    },
    citationProbe(citations, vagueAttribution, sourceRequested),
    {
      angle: "unsupported_specificity",
      passed: unsupportedSpecifics.length === 0,
      severity: unsupportedSpecifics.length > 0 ? "medium" : "low",
      finding: unsupportedSpecifics.length > 0
        ? "Specific dates, percentages, amounts, identifiers, or measurements appear without a citation marker or locally checked arithmetic relation."
        : "No unsupported high-specificity factual signal was detected.",
      evidence: unsupportedSpecifics.slice(0, 3),
    },
    relevanceProbe(input.question, input.answer),
    citationResolvabilityProbe(input.answer),
    {
      angle: "internal_contradiction",
      passed: contradictions.length === 0,
      severity: contradictions.length > 0 ? "high" : "low",
      finding: contradictions.length > 0
        ? "Closely matching statements with conflicting polarity or numeric values were detected."
        : "No direct lexical or repeated-value contradiction was detected.",
      evidence: contradictions.slice(0, 2).flatMap((value) => [value.left, value.right]),
    },
    arithmeticProbe(arithmetic),
    {
      angle: "input_injection",
      passed: !inputInjection,
      severity: inputInjection ? "critical" : "low",
      finding: inputInjection
        ? "The submitted input contains an instruction-override or policy-bypass pattern, including normalized or base64-decoded text."
        : "No supported input-side instruction-override pattern was detected.",
      evidence: inputInjection ? ["Potential input-side policy bypass detected; raw content withheld from this finding."] : [],
    },
    {
      angle: "prompt_injection",
      passed: !answerInjection,
      severity: answerInjection ? "high" : "low",
      finding: answerInjection
        ? "Instruction-override or secret-extraction language was treated as inert answer text."
        : "No common instruction-override or secret-extraction phrase was detected.",
      evidence: answerInjectionSignals.slice(0, 3),
    },
    {
      angle: "credential_exposure",
      passed: exposedSecrets.length === 0,
      severity: exposedSecrets.length > 0 ? "critical" : "low",
      finding: exposedSecrets.length > 0
        ? `Potential credential material detected: ${exposedSecrets.join(", ")}. Values are intentionally omitted.`
        : "No supported credential format was detected.",
      evidence: exposedSecrets.map((kind) => `[REDACTED ${kind}]`),
    },
    {
      angle: "dangerous_action",
      passed: dangerousActions.length === 0,
      severity: dangerousActions.length > 0 ? "high" : "low",
      finding: dangerousActions.length > 0
        ? `Potentially dangerous executable content detected: ${dangerousActions.join(", ")}.`
        : "No supported destructive or executable attack pattern was detected.",
      evidence: dangerousActions,
    },
    {
      angle: "network_boundary",
      passed: !unsafeNetworkTarget,
      severity: unsafeNetworkTarget ? "critical" : "low",
      finding: unsafeNetworkTarget ?? "No unsafe scheme or private-network checkpoint target was detected.",
      evidence: unsafeNetworkTarget ? ["Checkpoint target blocked by the deterministic network-boundary policy."] : [],
    },
    {
      angle: "fact_check_scope",
      passed: !sourceRequested,
      severity: sourceRequested ? "medium" : "low",
      finding: sourceRequested
        ? "The request asks for external verification, but Lite has no browsing or source-validation capability."
        : FACT_CHECK_CAVEAT,
      evidence: [],
    },
  ];

  return { claims, probes, truncatedClaims: extracted.truncated, arithmetic };
}

function buildClaim(text: string, index: number, arithmetic: ArithmeticCheck[]): Claim {
  const localArithmetic = arithmetic.filter((check) => text.includes(check.expression));
  const arithmeticVerified = localArithmetic.length > 0 && localArithmetic.every((check) => check.passed);
  const citations = citationSignals(text);
  const attackSurface: string[] = ["External factual truth is not verified by Lite."];
  if (CERTAINTY_PATTERN.test(text) && !UNCERTAINTY_PATTERN.test(text)) {
    attackSurface.push("Absolute-certainty language may be unsupported.");
  }
  if (citations.length > 0) attackSurface.push("Citation markers require external validation.");
  if (localArithmetic.length > 0) attackSurface.push("Arithmetic expression was locally recomputed.");
  if (PROMPT_INJECTION_PATTERN.test(text)) attackSurface.push("Instruction-like text is treated as inert content.");

  return {
    id: `c-${index + 1}`,
    text,
    reasoning: arithmeticVerified
      ? "Extracted from the submitted answer; its explicit arithmetic relation was recomputed locally. External factual context remains unverified."
      : "Extracted from the submitted answer. Its presence proves only that the assertion was made, not that it is true.",
    confidence: arithmeticVerified ? 0.9 : 0.45,
    supporting_evidence: arithmeticVerified
      ? localArithmetic.map((check) => `Locally recomputed: ${check.expression}`)
      : citations.map((citation) => `Unverified citation marker: ${citation}`),
    attack_surface: attackSurface,
    status: arithmeticVerified ? "observed" : UNCERTAINTY_PATTERN.test(text) ? "reconstructed" : "assumed",
  };
}

function extractClaims(answer: string): { claims: string[]; truncated: boolean; scanWindow: string[] } {
  const candidates: string[] = [];
  for (const rawLine of answer.split(/\r?\n+/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    // Split on the masked copy, but take each claim from the original by offset. The mask
    // is length-preserving, so the offsets agree. Un-substituting the mask instead would
    // rewrite any U+2024 the author actually wrote, and the reported claim would then not
    // appear in the submitted answer at all.
    const protectedLine = protectAbbreviations(line);
    let cursor = 0;
    for (const part of protectedLine.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"'([])/u)) {
      const sentence = line.slice(cursor, cursor + part.length).trim();
      if (sentence) candidates.push(sentence);
      cursor += part.length;
      while (cursor < line.length && /\s/.test(line[cursor] ?? "")) cursor += 1;
    }
  }
  return {
    claims: candidates.slice(0, MAX_CLAIMS),
    truncated: candidates.length > MAX_CLAIMS,
    scanWindow: candidates.slice(0, SECURITY_SCAN_LIMIT),
  };
}

/**
 * Masks the period in an abbreviation so it does not end a sentence. Length-preserving:
 * one character is replaced by one character, so offsets into the original are unchanged.
 *
 * Titles are matched case-sensitively. Matching them case-insensitively made the unit
 * "ms." look like the title "Ms.", merging two sentences into one claim and hiding any
 * contradiction between them.
 */
/**
 * Clause boundaries at which a hedge stops applying to what precedes it. "It is
 * absolutely certain that this cures the disease, though it may rain tomorrow" hedges
 * the rain, not the cure; scanning the whole claim let any unrelated "may" anywhere in
 * the sentence cancel the certainty finding entirely.
 */
const CLAUSE_BOUNDARY =
  /,\s*(?:though|although|but|while|however|whereas|yet|even if|unless)\b|;\s*|\s+(?:though|although|but|however|whereas)\s+/i;

function assertsUnhedgedCertainty(claim: string): boolean {
  return claim
    .split(CLAUSE_BOUNDARY)
    .some((clause) => CERTAINTY_PATTERN.test(clause) && !UNCERTAINTY_PATTERN.test(clause));
}

function protectAbbreviations(value: string): string {
  return value
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\./g, (match) => match.replaceAll(".", "\u2024"))
    .replace(/\b(?:vs|etc|e\.g|i\.e)\./gi, (match) => match.replaceAll(".", "\u2024"));
}

/**
 * Computed identifier screening.
 *
 * Distinct from `citation_verifiability`, which asks whether a citation *marker* is
 * present. This asks whether the identifiers actually resolve as identifiers — whether
 * their own check digits agree with their own digits. That question is decidable from the
 * string alone: no network, no reference corpus, no model.
 *
 * A checksum failure is the strongest signal available here, because the arithmetic
 * cannot fire on a correctly transcribed real identifier. It is reported as exactly what
 * it is — the identifier fails its own check digit — and not as "the citation is
 * fabricated": a transposed digit or an OCR error produces the same failure, and the
 * distinction between fabrication and mistranscription is not something arithmetic can
 * settle.
 */
function citationResolvabilityProbe(answer: string): RedTeamProbe {
  const findings = extractCitationFindings(answer);
  const checksum = checksumFailures(findings);
  const grammar = grammarFailures(findings);

  if (checksum.length > 0) {
    return {
      angle: "citation_resolvability",
      passed: false,
      severity: "high",
      finding:
        `${checksum.length} identifier(s) fail their own check digit and therefore cannot be a correctly ` +
        "transcribed real identifier. This is computed arithmetic, not a lookup; it does not distinguish " +
        "a fabricated reference from a mistyped one.",
      evidence: checksum.map((item) => `${item.kind}:${item.identifier} — ${item.reason}`).slice(0, 4),
    };
  }
  if (grammar.length > 0) {
    return {
      angle: "citation_resolvability",
      passed: false,
      severity: "medium",
      finding:
        `${grammar.length} identifier(s) violate the structural grammar or a permanently closed range of ` +
        "their scheme. No check digit was available, so this is weaker evidence than a checksum failure.",
      evidence: grammar.map((item) => `${item.kind}:${item.identifier} — ${item.reason}`).slice(0, 4),
    };
  }
  return {
    angle: "citation_resolvability",
    passed: true,
    severity: "low",
    finding: findings.length > 0
      ? `${findings.length} identifier(s) are well-formed. Well-formedness is not existence: nothing was resolved or fetched.`
      : "No checkable identifier was present in the answer.",
    evidence: [],
  };
}

function citationProbe(
  citations: string[],
  vagueAttribution: boolean,
  sourceRequested: boolean,
): RedTeamProbe {
  if (citations.length > 0) {
    return {
      angle: "citation_verifiability",
      passed: false,
      severity: "medium",
      finding: "Citation markers were detected, but Lite cannot open, authenticate, or validate them.",
      evidence: citations.slice(0, 4),
    };
  }
  if (vagueAttribution) {
    return {
      angle: "citation_verifiability",
      passed: false,
      severity: "medium",
      finding: "The answer appeals to research or experts without an identifiable citation marker.",
      evidence: [],
    };
  }
  if (sourceRequested) {
    return {
      angle: "citation_verifiability",
      passed: false,
      severity: "medium",
      finding: "Sources were requested, but no identifiable citation marker was found.",
      evidence: [],
    };
  }
  return {
    angle: "citation_verifiability",
    passed: true,
    severity: "low",
    finding: "No citation-specific issue was detected; external factual truth was not checked.",
    evidence: [],
  };
}

function citationSignals(value: string): string[] {
  return Array.from(value.matchAll(new RegExp(CITATION_PATTERN.source, CITATION_PATTERN.flags)))
    .map((match) => match[0].replace(/[),.;]+$/, ""))
    .slice(0, 12);
}

function arithmeticChecks(rawAnswer: string): ArithmeticCheck[] {
  const answer = foldNotation(rawAnswer);
  const checks: ArithmeticCheck[] = [];
  const occupied: Array<[number, number]> = [];

  for (const match of answer.matchAll(new RegExp(PERCENT_ARITHMETIC.source, PERCENT_ARITHMETIC.flags))) {
    const start = match.index ?? 0;
    const expression = match[0];
    const left = parseNumber(match[1]);
    const base = parseNumber(match[2]);
    const actual = parseNumber(match[3]);
    if (left === undefined || base === undefined || actual === undefined) continue;
    const expected = (left / 100) * base;
    checks.push(numericCheck(expression, expected, actual, start));
    occupied.push([start, start + expression.length]);
  }

  for (const match of answer.matchAll(new RegExp(RATIO_PERCENT_ARITHMETIC.source, RATIO_PERCENT_ARITHMETIC.flags))) {
    const start = match.index ?? 0;
    const expression = match[0];
    if (overlaps(start, start + expression.length, occupied)) continue;
    const part = parseNumber(match[1]);
    const whole = parseNumber(match[2]);
    const actual = parseNumber(match[3]);
    if (part === undefined || whole === undefined || actual === undefined) continue;
    if (whole === 0) checks.push({ expression, passed: false, actual, start, end: start + expression.length });
    else checks.push(numericCheck(expression, (part / whole) * 100, actual, start));
    occupied.push([start, start + expression.length]);
  }

  for (const match of answer.matchAll(new RegExp(BINARY_ARITHMETIC.source, BINARY_ARITHMETIC.flags))) {
    const start = match.index ?? 0;
    const expression = match[0];
    if (overlaps(start, start + expression.length, occupied)) continue;
    const left = parseNumber(match[1]);
    const right = parseNumber(match[3]);
    const actual = parseNumber(match[4]);
    const operator = match[2]?.toLowerCase();
    if (left === undefined || right === undefined || actual === undefined || !operator) continue;
    // Recompute integer +, - and * exactly. IEEE-754 doubles lose precision past 2^53,
    // so "9007199254740993 + 2 = 9007199254740995" was reported as an arithmetic error.
    const exact = exactIntegerResult(match[1], operator, match[3], match[4]);
    if (exact !== undefined) {
      checks.push({ expression, passed: exact, actual, start, end: start + expression.length,
        ...(exact ? {} : { expected: left + right }) });
      occupied.push([start, start + expression.length]);
      continue;
    }
    let expected: number | undefined;
    if (operator === "+") expected = left + right;
    else if (operator === "-") expected = left - right;
    else if (["*", "×", "x"].includes(operator)) expected = left * right;
    else if (["/", "÷"].includes(operator) && right !== 0) expected = left / right;
    if (expected === undefined || !Number.isFinite(expected)) {
      checks.push({ expression, passed: false, actual, start, end: start + expression.length });
    } else {
      checks.push(numericCheck(expression, expected, actual, start));
    }
  }

  for (const [pattern, leftGroup, opGroup, rightGroup, resultGroup, symbolOf, applyOp] of [
    [WORD_ARITHMETIC, 1, 2, 3, 4, wordOperatorSymbol, applyWordOperator],
    [NAMED_ARITHMETIC, 2, 1, 3, 4, (name: string) => NAMED_OPERATOR_SYMBOL[name.toLowerCase()], applyNamedOperator],
  ] as const) {
    for (const match of answer.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const start = match.index ?? 0;
      const expression = match[0];
      if (overlaps(start, start + expression.length, occupied)) continue;
      const leftText = match[leftGroup];
      const rightText = match[rightGroup];
      const actualText = match[resultGroup];
      const operatorWord = match[opGroup];
      const left = parseNumber(leftText);
      const right = parseNumber(rightText);
      const actual = parseNumber(actualText);
      if (left === undefined || right === undefined || actual === undefined || !operatorWord) continue;
      occupied.push([start, start + expression.length]);

      // Recompute integers exactly, as the symbolic path does.
      const symbol = symbolOf(operatorWord);
      const exact = symbol ? exactIntegerResult(leftText, symbol, rightText, actualText) : undefined;
      if (exact !== undefined) {
        checks.push({ expression, passed: exact, actual, start, end: start + expression.length });
        continue;
      }
      const expected = applyOp(operatorWord, left, right);
      if (expected === undefined || !Number.isFinite(expected)) {
        checks.push({ expression, passed: false, actual, start, end: start + expression.length });
      } else {
        checks.push(numericCheck(expression, expected, actual, start));
      }
    }
  }
  return checks;
}

/** Integer literal with no fractional part, so BigInt can evaluate it without loss. */
const INTEGER_LITERAL = /^[-+]?\d[\d,]*$/;

function toBigInt(value: string | undefined): bigint | undefined {
  if (!value || !INTEGER_LITERAL.test(value)) return undefined;
  try {
    return BigInt(value.replaceAll(",", ""));
  } catch {
    return undefined;
  }
}

/** Exact verdict for integer +, - and *, or undefined when the form is not integral. */
function exactIntegerResult(
  leftText: string | undefined,
  operator: string,
  rightText: string | undefined,
  actualText: string | undefined,
): boolean | undefined {
  const left = toBigInt(leftText);
  const right = toBigInt(rightText);
  const actual = toBigInt(actualText);
  if (left === undefined || right === undefined || actual === undefined) return undefined;
  if (operator === "+") return left + right === actual;
  if (operator === "-") return left - right === actual;
  if (["*", "×", "x"].includes(operator)) return left * right === actual;
  return undefined;
}

function numericCheck(expression: string, expected: number, actual: number, start: number): ArithmeticCheck {
  const resultText = expression.match(new RegExp(`(${NUMBER_SOURCE})\\s*%?\\s*$`))?.[1] ?? String(actual);
  const decimalPlaces = resultText.includes(".") ? resultText.split(".")[1]?.length ?? 0 : 0;
  const tolerance = decimalPlaces > 0 ? 0.5 * 10 ** -decimalPlaces + 1e-12 : 1e-12;
  return {
    expression,
    passed: Math.abs(expected - actual) <= tolerance,
    expected,
    actual,
    start,
    end: start + expression.length,
  };
}

function arithmeticProbe(checks: ArithmeticCheck[]): RedTeamProbe {
  const failures = checks.filter((check) => !check.passed);
  if (failures.length > 0) {
    return {
      angle: "arithmetic_sanity",
      passed: false,
      severity: "high",
      finding: "At least one explicit arithmetic equality does not match local recomputation or divides by zero.",
      evidence: failures.slice(0, 3).map((check) => check.expression),
    };
  }
  return {
    angle: "arithmetic_sanity",
    passed: true,
    severity: "low",
    finding: checks.length > 0
      ? `${checks.length} explicit arithmetic relation(s) matched local recomputation within written precision.`
      : "No allowlisted arithmetic equality was available for local recomputation.",
    evidence: checks.slice(0, 3).map((check) => check.expression),
  };
}

function findContradictions(claims: string[]): Contradiction[] {
  const results: Contradiction[] = [];
  let pairs = 0;
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    const left = claims[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const right = claims[rightIndex];
      if (!right) continue;
      if (polarityContradiction(left, right) || numericContradiction(left, right)) {
        results.push({ left, right });
      }
      if (results.length >= 4) return results;
      if ((pairs += 1) >= MAX_CONTRADICTION_PAIRS) return results;
    }
  }
  return results;
}

function polarityContradiction(left: string, right: string): boolean {
  const leftNegated = isNegated(left);
  const rightNegated = isNegated(right);
  if (leftNegated === rightNegated) return false;
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection >= 2 && union > 0 && intersection / union >= 0.72;
}

function numericContradiction(left: string, right: string): boolean {
  const leftNumbers = numericTokens(left);
  const rightNumbers = numericTokens(right);
  if (leftNumbers.length === 0 || rightNumbers.length === 0) return false;
  const leftFrame = numericFrame(left);
  const rightFrame = numericFrame(right);
  if (!/[a-z]/.test(leftFrame) || leftFrame !== rightFrame) return false;
  if (leftNumbers.join("|") === rightNumbers.join("|")) return false;
  if (differsAtEnumerator(left, right)) return false;
  return !comparesDistinctEntities(leftNumbers, rightNumbers);
}

/**
 * Distinguishes a comparison of two entities from a self-contradiction about one.
 *
 * numericFrame replaces every number with "#", including numbers that identify
 * *which* entity a claim is about. "The M4 Air has 16GB RAM" and "The M5 Air has
 * 24GB RAM" therefore collapse to the same frame and were reported as a direct
 * contradiction, when they are a product comparison. Real users hit this on
 * their first non-trivial inputs; the constructed benchmark never did, because
 * its temporal control distinguished claims by a word ("last quarter") rather
 * than by a number.
 *
 * Rule: a claim carrying several numbers needs a shared numeric anchor before a
 * differing value counts as a contradiction. If every numeric position differs,
 * the two claims are about different things.
 *
 *   [30]      vs [90]       single value, differs  -> contradiction
 *   [4, 8]    vs [4, 10]    anchor 4 shared        -> contradiction
 *   [4, 16]   vs [5, 24]    no shared anchor       -> comparison
 *   [2024,12] vs [2025,30]  no shared anchor       -> comparison
 */
/**
 * Closed class of label nouns that index an item rather than measure one. The
 * discriminating feature is word order, not the noun alone: "Step 1" is a label followed
 * by an index, while "5 minutes" is a quantity followed by a unit. Only the first form
 * identifies *which* thing a claim is about.
 */
const ENUMERATOR_LABELS =
  "step|stage|phase|chapter|section|part|item|figure|fig|table|appendix|annex|note|line|page|" +
  "question|task|run|trial|sample|release|version|revision|build|sku|id|entry|record|row|column|" +
  "level|tier|round|iteration|epoch|batch|finding|issue|ticket|case|example|option|method|variant|" +
  "model|class|group|set|test|exercise|lesson|module|unit|day|week|attempt|slot|node|worker|shard";
const ENUMERATOR_PATTERN = new RegExp(`\\b(${ENUMERATOR_LABELS})\\s+#?(\\d+)\\b`, "gi");

/** Map of label noun to the indices it carries in this claim. */
function enumeratorIndices(value: string): Map<string, Set<string>> {
  const indices = new Map<string, Set<string>>();
  for (const match of value.matchAll(ENUMERATOR_PATTERN)) {
    const label = match[1]!.toLowerCase();
    const existing = indices.get(label) ?? new Set<string>();
    existing.add(match[2]!);
    indices.set(label, existing);
  }
  return indices;
}

/**
 * True when the two claims carry the same label with different indices, which means they
 * describe different items. "Step 1 takes 5 minutes" and "Step 2 takes 5 minutes" share a
 * numeric anchor (5) and an identical frame, so the anchor rule below treated them as a
 * self-contradiction; they are two facts about two steps.
 */
function differsAtEnumerator(left: string, right: string): boolean {
  const leftIndices = enumeratorIndices(left);
  const rightIndices = enumeratorIndices(right);
  for (const [label, leftValues] of leftIndices) {
    const rightValues = rightIndices.get(label);
    if (!rightValues) continue;
    const shared = [...leftValues].some((value) => rightValues.has(value));
    if (!shared) return true;
  }
  return false;
}

function comparesDistinctEntities(left: string[], right: string[]): boolean {
  if (left.length < 2 || right.length < 2) return false;
  const shared = new Set(left).size > 0 && left.some((value) => right.includes(value));
  return !shared;
}

function isNegated(value: string): boolean {
  return NEGATION_PATTERN.test(value.replace(/\bnot only\b/gi, ""));
}

/**
 * Light suffix normalisation so an inflected pair such as "succeeded" and
 * "succeed" is recognised as the same lemma. Deliberately conservative: it only
 * trims common regular endings on words long enough that the trim cannot
 * collapse two genuinely different short words together.
 */
function stripOnce(token: string): string {
  if (token.length > 5 && token.endsWith("ied")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Applied to a fixed point. A single pass is not enough: "succeeded" trims to
 * "succeed", which itself still ends in "ed", so one pass leaves the inflected
 * and base forms in different buckets and the pair never matches. Iterating
 * until stable sends both to the same stem.
 */
function normaliseToken(token: string): string {
  let current = token;
  for (let i = 0; i < 4; i += 1) {
    const next = stripOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function meaningfulTokens(value: string): Set<string> {
  const tokens = value.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) ?? [];
  return new Set(
    tokens
      .filter((token) => !STOP_WORDS.has(token) && !/^\d/.test(token))
      .map(normaliseToken),
  );
}

function numericTokens(value: string): string[] {
  return Array.from(value.matchAll(new RegExp(NUMBER_SOURCE, "g"))).map((match) => match[0].replaceAll(",", ""));
}

function numericFrame(value: string): string {
  return value
    .toLowerCase()
    .replace(new RegExp(NUMBER_SOURCE, "g"), "#")
    .replace(/[^a-z#]+/g, " ")
    .replace(/\b(?:the|a|an|is|was|are|were)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreDimensions(probes: RedTeamProbe[]): Record<string, number> {
  const score = (angle: string, passed: number, failed: number): number =>
    probes.find((probe) => probe.angle === angle)?.passed === false ? failed : passed;
  return {
    claim_coverage: score("claim_extraction", 1, 0.45),
    calibration: score("unsupported_certainty", 0.9, 0.35),
    citation_transparency: score("citation_verifiability", 0.85, 0.45),
    specificity_support: score("unsupported_specificity", 0.9, 0.4),
    answer_relevance: score("answer_relevance", 1, 0.35),
    internal_consistency: score("internal_contradiction", 1, 0.05),
    arithmetic_integrity: score("arithmetic_sanity", 0.9, 0.05),
    instruction_resilience: score("prompt_injection", 1, 0.25),
    input_resilience: score("input_injection", 1, 0.05),
    credential_safety: score("credential_exposure", 1, 0),
    execution_safety: score("dangerous_action", 1, 0.05),
    network_boundary: score("network_boundary", 1, 0),
    verification_scope: score("fact_check_scope", 0.9, 0.4),
  };
}

/**
 * Caller-supplied constitution rules are namespaced. A rule id arrives in the request
 * body, so without this a caller can reuse a built-in id such as `lite-credentials`,
 * overwrite its published evaluation, and make the audit record state that the built-in
 * credential rule was satisfied when the credential probe actually failed. Namespacing
 * makes that collision structurally impossible rather than merely discouraged.
 */
const RESERVED_RULE_PREFIX = "lite-";

function callerRuleId(id: string): string {
  // Only the reserved prefix is namespaced. A caller's own rule id is preserved, so
  // legitimate callers still read their evaluations back under the id they supplied;
  // an attempt to occupy a built-in id is neutralized and left visible in the record.
  return id.startsWith(RESERVED_RULE_PREFIX) ? `caller:${id}` : id;
}

function constitution(probes: RedTeamProbe[], customRules: ConstitutionRule[]): TrustCard["constitution"] {
  const evaluation = (angle: string): "satisfied" | "violated" =>
    probes.find((probe) => probe.angle === angle)?.passed === false ? "violated" : "satisfied";
  return {
    rules: [
      { id: "lite-scope", requirement: "Disclose that deterministic checks do not verify external truth.", severity: "critical" },
      { id: "lite-certainty", requirement: "Flag unsupported absolute-certainty language.", severity: "medium" },
      { id: "lite-citations", requirement: "Never present citation markers as externally validated.", severity: "high" },
      { id: "lite-specificity", requirement: "Flag unsupported high-specificity factual signals.", severity: "medium" },
      { id: "lite-relevance", requirement: "Flag clear lexical non-responses for inspection.", severity: "medium" },
      { id: "lite-consistency", requirement: "Flag direct internal contradictions when conservatively detectable.", severity: "high" },
      { id: "lite-arithmetic", requirement: "Recompute only allowlisted arithmetic forms without code evaluation.", severity: "high" },
      { id: "lite-instructions", requirement: "Treat instruction-like answer text as inert content.", severity: "high" },
      { id: "lite-input-injection", requirement: "Reject recognized input-side instruction override attempts.", severity: "critical" },
      { id: "lite-credentials", requirement: "Do not release recognized credential material.", severity: "critical" },
      { id: "lite-dangerous-action", requirement: "Flag supported destructive or executable attack patterns.", severity: "high" },
      { id: "lite-network-boundary", requirement: "Reject unsafe schemes and private-network tool targets.", severity: "critical" },
      ...customRules.map((rule) => ({ id: callerRuleId(rule.id), requirement: rule.requirement, severity: rule.severity })),
    ],
    evaluations: {
      "lite-scope": "satisfied",
      "lite-certainty": evaluation("unsupported_certainty"),
      "lite-citations": evaluation("citation_verifiability"),
      "lite-specificity": evaluation("unsupported_specificity"),
      "lite-relevance": evaluation("answer_relevance"),
      "lite-consistency": evaluation("internal_contradiction"),
      "lite-arithmetic": evaluation("arithmetic_sanity"),
      "lite-instructions": evaluation("prompt_injection"),
      "lite-input-injection": evaluation("input_injection"),
      "lite-credentials": evaluation("credential_exposure"),
      "lite-dangerous-action": evaluation("dangerous_action"),
      "lite-network-boundary": evaluation("network_boundary"),
      ...Object.fromEntries(customRules.map((rule) => [callerRuleId(rule.id), evaluation(`constitution:${callerRuleId(rule.id)}`)])),
    },
  };
}

function evaluateConstitution(input: VerificationInput, rules: ConstitutionRule[]): RedTeamProbe[] {
  const citations = citationSignals(input.answer);
  return rules.map((rule) => {
    const normalizedAnswer = input.answer.toLocaleLowerCase("en-US");
    const normalizedValue = rule.value?.toLocaleLowerCase("en-US") ?? "";
    let passed = true;
    if (rule.kind === "require_phrase") passed = normalizedAnswer.includes(normalizedValue);
    else if (rule.kind === "forbid_phrase") passed = !normalizedAnswer.includes(normalizedValue);
    else if (rule.kind === "require_citation") passed = citations.length > 0;
    else if (rule.kind === "forbid_absolute_certainty") passed = !CERTAINTY_PATTERN.test(input.answer);
    else if (rule.kind === "allow_target") passed = Boolean(input.checkpoint?.target && targetMatchesValue(input.checkpoint.target, normalizedValue));
    else if (rule.kind === "forbid_target") passed = !input.checkpoint?.target || !targetMatchesValue(input.checkpoint.target, normalizedValue);
    return {
      angle: `constitution:${callerRuleId(rule.id)}`,
      passed,
      severity: passed ? "low" : rule.severity,
      finding: passed
        ? `Constitution rule ${callerRuleId(rule.id)} was satisfied.`
        : `Constitution rule ${callerRuleId(rule.id)} was violated: ${rule.requirement}`,
      evidence: rule.value ? [rule.value] : rule.kind === "require_citation" ? citations.slice(0, 4) : [],
    };
  });
}

/**
 * Characters that are invisible or zero-width and can be inserted mid-token to break a
 * pattern match without changing what a human or a model reads. `\p{Cf}` covers soft
 * hyphen, the zero-width and bidi controls, word joiner, BOM and the tag block; the
 * explicit additions are the combining grapheme joiner and the variation selectors,
 * which are combining marks rather than format characters.
 */

/**
 * Script-confusable characters that render as Latin letters. This is a curated subset of
 * the Unicode TR39 confusables table covering the Cyrillic and Greek homoglyphs used in
 * practice, not the full table: folding here is a detection aid, and an unmapped
 * confusable is a false negative, never a false positive.
 */


/** NFKC-fold and remove characters that carry no visible content. */



/**
 * Base64 payloads embedded anywhere, not only between whitespace. The previous boundary
 * required surrounding whitespace, so quoting or bracketing a payload hid it entirely.
 * Boundaries are now "not a base64 alphabet character", which no delimiter can satisfy.
 */

/** Text prepared for instruction-override and dangerous-action matching. */

/**
 * Text prepared for credential matching. Deliberately does NOT apply leetspeak or
 * confusable folding: those rewrite the very characters a key is made of and would
 * corrupt an otherwise matchable secret. Invisible-character stripping and NFKC are
 * safe because neither removes a character a credential can contain.
 */


function relevanceProbe(question: string, answer: string): RedTeamProbe {
  const questionTokens = meaningfulTokens(question);
  const answerTokens = meaningfulTokens(answer);
  const overlap = [...questionTokens].filter((token) => answerTokens.has(token)).length;
  const enoughContext = questionTokens.size >= 3 && answerTokens.size >= 3;
  const passed = !enoughContext || overlap > 0 || UNCERTAINTY_PATTERN.test(answer);
  return {
    angle: "answer_relevance",
    passed,
    severity: passed ? "low" : "medium",
    finding: passed
      ? "No clear lexical non-response signal was detected."
      : "The answer shares no meaningful lexical content with a sufficiently detailed question; inspect it for a non-response or topic switch.",
    evidence: [],
  };
}


/** Actions that release the output. Every other action withholds it. */
const RELEASING_ACTIONS = new Set<ResponseAction>(["allow", "record"]);

function governance(input: VerificationInput, verdict: TrustCard["verdict"]): NonNullable<TrustCard["governance"]> {
  const defaults = { trust: "allow", caution: "record", reject: "block" } as const;
  const requested = input.response_policy?.[verdict] ?? defaults[verdict];

  // A response policy travels in the request body, so it is caller-controlled input, not
  // operator configuration. It may make the gate stricter; it must never make it weaker.
  // Without this floor, `response_policy: {reject: "allow"}` walks a critical-severity
  // credential leak straight through the enforcing gate, which defeats the gate entirely.
  const downgradeRefused = verdict === "reject" && RELEASING_ACTIONS.has(requested);
  const action: ResponseAction = downgradeRefused ? defaults.reject : requested;

  return {
    checkpoint: input.checkpoint ?? { id: "submitted-answer", type: "final_output" },
    constitution_version: input.constitution?.version ?? "glassbox-lite/builtin-v1",
    response: {
      action,
      executed: false,
      policy_downgrade_refused: downgradeRefused,
      rationale: downgradeRefused
        ? `The response policy requested ${requested} for verdict reject. A caller-supplied policy cannot release a rejected output, so the built-in floor ${defaults.reject} was applied instead.`
        : `The configured response policy maps verdict ${verdict} to ${action}. GlassBox reports this action; the caller must enforce it.`,
    },
  };
}

/**
 * Which failures are severe enough to reject rather than caution. Single source of truth:
 * the verdict and the rationale previously applied two different versions of this rule, so
 * the rationale named `dangerous_action` as a rejection reason at checkpoints where the
 * gate had not in fact treated it as one.
 */
function isDecisive(probe: RedTeamProbe, checkpointType: string | undefined): boolean {
  // A checksum failure is proven arithmetic, in the same class as a wrong sum, so it is
  // decisive. A grammar failure is weaker evidence and only cautions.
  if (probe.angle === "citation_resolvability") return probe.severity === "high";
  // A tool call is an action about to happen, not a draft awaiting review, so every tool
  // probe is decisive wherever it fires.
  if (TOOL_PROBE_ANGLES.has(probe.angle)) return true;
  if (["internal_contradiction", "arithmetic_sanity", "input_injection", "credential_exposure", "network_boundary"]
    .includes(probe.angle)) return true;
  if (probe.angle === "dangerous_action") {
    // An undeclared checkpoint must not be a cheaper path through the gate. If the caller
    // has not said which stage this is, assume the most consequential one and fail closed.
    return checkpointType === undefined || ["agent_step", "tool_call"].includes(checkpointType);
  }
  return probe.angle.startsWith("constitution:") && ["high", "critical"].includes(probe.severity);
}

function verdictRationale(
  verdict: TrustCard["verdict"],
  failed: RedTeamProbe[],
  decisive: RedTeamProbe[],
): string {
  const caveat = "This is not a fact-check; external facts and citations remain unverified.";
  if (verdict === "reject") {
    const reasons = decisive.map((probe) => probe.angle.replaceAll("_", " "));
    return `Deterministic checks found rejection-level failures: ${reasons.join(", ")}. ${caveat}`;
  }
  if (verdict === "caution") {
    const reasons = failed.slice(0, 3).map((probe) => probe.angle.replaceAll("_", " "));
    return `Deterministic checks found caution signals: ${reasons.join(", ")}. ${caveat}`;
  }
  return `No deterministic structural red flags were found. ${caveat}`;
}

function inputsHash(input: VerificationInput): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    platform: input.platform,
    question: input.question,
    answer: input.answer,
    intents: input.intents ?? [],
    checkpoint: input.checkpoint ?? null,
    constitution: input.constitution ?? null,
    response_policy: input.response_policy ?? null,
  })).digest("hex");
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function overlaps(start: number, end: number, occupied: Array<[number, number]>): boolean {
  return occupied.some(([otherStart, otherEnd]) => start < otherEnd && end > otherStart);
}

function severityRank(value: RedTeamProbe["severity"]): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
