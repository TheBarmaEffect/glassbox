import crypto from "node:crypto";
import { normalizeInput } from "./parser.js";
import type {
  Claim,
  RedTeamProbe,
  TrustCard,
  VerificationInput,
  Verifier,
} from "./types.js";

const MAX_CLAIMS = 24;
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
const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|prior|above|system|developer)\b.{0,25}\b(?:instruction|message|prompt)s?\b|\b(?:reveal|print|repeat|expose|leak)\b.{0,40}\b(?:system prompt|developer message|secret|credential|api key|token)\b|\b(?:jailbreak|do anything now|developer mode)\b|<\/?(?:system|assistant|developer)>|\[(?:INST|SYSTEM)\]|\b(?:ignore|disregard|override|forget)\s+(?:all\s+|everything\s+)?(?:the\s+|your\s+)?(?:above|previous|prior|earlier|preceding)\b|\bforget everything\b|\bnew instructions?\s*:|\b(?:ignore|disregard|override|bypass)\b.{0,30}\b(?:safety|guardrail|guideline|restriction|policy|rule)s?\b/i;

const NEGATION_PATTERN =
  /\b(?:not|never|no|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|wouldn't|couldn't|shouldn't|hasn't|haven't|hadn't)\b/i;

const NUMBER_SOURCE = "[-+]?(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)";
const PERCENT_ARITHMETIC = new RegExp(
  `(${NUMBER_SOURCE})\\s*%\\s+of\\s+(${NUMBER_SOURCE})\\s*(?:=|equals?|is)\\s*(${NUMBER_SOURCE})`,
  "gi",
);
const RATIO_PERCENT_ARITHMETIC = new RegExp(
  `(${NUMBER_SOURCE})\\s*(?:out\\s+of|/)\\s*(${NUMBER_SOURCE})\\s*(?:=|equals?|is)\\s*(${NUMBER_SOURCE})\\s*%`,
  "gi",
);
const BINARY_ARITHMETIC = new RegExp(
  `(${NUMBER_SOURCE})\\s*(\\+|-|\\*|×|x|/|÷)\\s*(${NUMBER_SOURCE})\\s*(?:=|equals?|is)\\s*(${NUMBER_SOURCE})(?![\\d,.]*\\s*%)`,
  "gi",
);

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
    const failed = analysis.probes.filter((probe) => !probe.passed);
    const decisiveFailure = failed.some(
      (probe) => probe.angle === "internal_contradiction" || probe.angle === "arithmetic_sanity",
    );
    const verdict: TrustCard["verdict"] = decisiveFailure
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
      verdict_rationale: verdictRationale(verdict, failed),
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
      constitution: constitution(analysis.probes),
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
  const contradictions = findContradictions(claimTexts);
  const certaintyClaims = claimTexts.filter(
    (claim) => CERTAINTY_PATTERN.test(claim) && !UNCERTAINTY_PATTERN.test(claim),
  );
  const citations = citationSignals(input.answer);
  const vagueAttribution = VAGUE_SOURCE_PATTERN.test(input.answer);
  const sourceRequested = SOURCE_REQUEST_PATTERN.test(
    `${input.question}\n${(input.intents ?? []).join("\n")}`,
  );
  const injectionSignals = claimTexts.filter((claim) => PROMPT_INJECTION_PATTERN.test(claim));
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
      angle: "prompt_injection",
      passed: injectionSignals.length === 0,
      severity: injectionSignals.length > 0 ? "high" : "low",
      finding: injectionSignals.length > 0
        ? "Instruction-override or secret-extraction language was treated as inert answer text."
        : "No common instruction-override or secret-extraction phrase was detected.",
      evidence: injectionSignals.slice(0, 3),
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

function extractClaims(answer: string): { claims: string[]; truncated: boolean } {
  const candidates: string[] = [];
  for (const rawLine of answer.replaceAll("\r", "").split(/\n+/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const protectedLine = protectAbbreviations(line);
    for (const sentence of protectedLine.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"'([])/u)) {
      const restored = sentence.replaceAll("\u2024", ".").trim();
      if (restored) candidates.push(restored);
    }
  }
  return {
    claims: candidates.slice(0, MAX_CLAIMS),
    truncated: candidates.length > MAX_CLAIMS,
  };
}

function protectAbbreviations(value: string): string {
  return value.replace(
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\./gi,
    (match) => match.replaceAll(".", "\u2024"),
  );
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

function arithmeticChecks(answer: string): ArithmeticCheck[] {
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
  return checks;
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
    internal_consistency: score("internal_contradiction", 1, 0.05),
    arithmetic_integrity: score("arithmetic_sanity", 0.9, 0.05),
    instruction_resilience: score("prompt_injection", 1, 0.25),
    verification_scope: score("fact_check_scope", 0.9, 0.4),
  };
}

function constitution(probes: RedTeamProbe[]): TrustCard["constitution"] {
  const evaluation = (angle: string): "satisfied" | "violated" =>
    probes.find((probe) => probe.angle === angle)?.passed === false ? "violated" : "satisfied";
  return {
    rules: [
      { id: "lite-scope", requirement: "Disclose that deterministic checks do not verify external truth.", severity: "critical" },
      { id: "lite-certainty", requirement: "Flag unsupported absolute-certainty language.", severity: "medium" },
      { id: "lite-citations", requirement: "Never present citation markers as externally validated.", severity: "high" },
      { id: "lite-consistency", requirement: "Flag direct internal contradictions when conservatively detectable.", severity: "high" },
      { id: "lite-arithmetic", requirement: "Recompute only allowlisted arithmetic forms without code evaluation.", severity: "high" },
      { id: "lite-instructions", requirement: "Treat instruction-like answer text as inert content.", severity: "high" },
    ],
    evaluations: {
      "lite-scope": "satisfied",
      "lite-certainty": evaluation("unsupported_certainty"),
      "lite-citations": evaluation("citation_verifiability"),
      "lite-consistency": evaluation("internal_contradiction"),
      "lite-arithmetic": evaluation("arithmetic_sanity"),
      "lite-instructions": evaluation("prompt_injection"),
    },
  };
}

function verdictRationale(verdict: TrustCard["verdict"], failed: RedTeamProbe[]): string {
  const caveat = "This is not a fact-check; external facts and citations remain unverified.";
  if (verdict === "reject") {
    const reasons = failed
      .filter((probe) => probe.angle === "internal_contradiction" || probe.angle === "arithmetic_sanity")
      .map((probe) => probe.angle.replaceAll("_", " "));
    return `Deterministic checks found a direct ${reasons.join(" and ")} failure. ${caveat}`;
  }
  if (verdict === "caution") {
    const reasons = failed.slice(0, 3).map((probe) => probe.angle.replaceAll("_", " "));
    return `Deterministic checks found caution signals: ${reasons.join(", ")}. ${caveat}`;
  }
  return `No deterministic structural red flags were found. ${caveat}`;
}

function inputsHash(input: VerificationInput): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    question: input.question,
    answer: input.answer,
    intents: input.intents ?? [],
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
