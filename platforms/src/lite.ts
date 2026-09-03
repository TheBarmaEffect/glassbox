import crypto from "node:crypto";
import { normalizeInput } from "./parser.js";
import type {
  Claim,
  ConstitutionRule,
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
const SPECIFIC_FACT_PATTERN =
  /(?:\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s*%\b|[$€£]\s*\d|\bCVE-\d{4}-\d{4,}\b|\b\d+(?:\.\d+)?\s*(?:mg|ml|g|kg|GB|TB|ms)\b)/i;
const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|prior|above|system|developer)\b.{0,25}\b(?:instruction|message|prompt)s?\b|\b(?:reveal|print|repeat|expose|leak)\b.{0,40}\b(?:system prompt|developer message|secret|credential|api key|token)\b|\b(?:jailbreak|do anything now|developer mode)\b|<\/?(?:system|assistant|developer)>|\[(?:INST|SYSTEM)\]|\b(?:ignore|disregard|override|forget)\s+(?:all\s+|everything\s+)?(?:the\s+|your\s+)?(?:above|previous|prior|earlier|preceding)\b|\bforget everything\b|\bnew instructions?\s*:|\b(?:ignore|disregard|override|bypass)\b.{0,30}\b(?:safety|guardrail|guideline|restriction|policy|rule)s?\b/i;
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["AWS secret access key", /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe live secret", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{20,}\b/],
  ["assigned credential", /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|auth[_ -]?token|private[_ -]?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{24,}["']?/i],
  ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const DANGEROUS_ACTION_PATTERNS: Array<[string, RegExp]> = [
  ["destructive filesystem command", /\brm\s+-[^\n]*r[^\n]*f[^\n]*(?:\/|~|\$HOME)\b/i],
  ["download-and-execute pipeline", /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sh|bash|zsh|powershell)\b/i],
  ["encoded PowerShell execution", /\bpowershell(?:\.exe)?\b[^\n]{0,160}\b(?:-enc|-encodedcommand)\b/i],
  ["reverse shell", /\b(?:nc|ncat|netcat)\b[^\n]{0,120}\s-e\s*(?:\/bin\/)?(?:sh|bash)|\/dev\/tcp\//i],
  ["firewall or security-control disabling", /\b(?:disable|stop|bypass|turn off)\b[^.!?\n]{0,60}\b(?:firewall|antivirus|endpoint protection|security control|guardrail)\b/i],
  ["firewall command disabling", /\b(?:ufw\s+disable|iptables(?:-legacy)?\s+(?:-[A-Za-z]*F\b|--flush\b)|nft\s+flush\s+ruleset|systemctl\s+(?:stop|disable)\s+(?:firewalld|ufw)\b|service\s+(?:firewalld|ufw)\s+stop\b|netsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off\b|Set-NetFirewallProfile\b[^\n]{0,100}-Enabled\s+(?:False|\$false)\b)/i],
  ["cloud metadata access", /\b(?:curl|wget|Invoke-WebRequest)\b[^\n]{0,240}\b(?:169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)\b/i],
  ["credential-file exfiltration", /\b(?:curl|wget)\b[^\n]{0,240}(?:@(?:\/etc\/(?:passwd|shadow)|~\/\.ssh\/|\$HOME\/\.ssh\/)|--data-binary\s+@)/i],
  ["destructive SQL", /\b(?:DROP\s+(?:DATABASE|TABLE)|TRUNCATE\s+TABLE)\b/i],
  ["script injection", /<script\b|javascript\s*:/i],
  ["path traversal", /(?:\.\.\/|\.\.\\){2,}/],
];

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
    const customRules = input.constitution?.rules ?? [];
    analysis.probes.push(...evaluateConstitution(input, customRules));
    const failed = analysis.probes.filter((probe) => !probe.passed);
    const decisiveFailure = failed.some(
      (probe) => probe.angle === "internal_contradiction" || probe.angle === "arithmetic_sanity" ||
        ["input_injection", "credential_exposure", "network_boundary"].includes(probe.angle) ||
        (probe.angle === "dangerous_action" && ["agent_step", "tool_call"].includes(input.checkpoint?.type ?? "")) ||
        (probe.angle.startsWith("constitution:") && ["high", "critical"].includes(probe.severity)),
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
  const contradictions = findContradictions(claimTexts);
  const certaintyClaims = claimTexts.filter(
    (claim) => CERTAINTY_PATTERN.test(claim) && !UNCERTAINTY_PATTERN.test(claim),
  );
  const citations = citationSignals(input.answer);
  const vagueAttribution = VAGUE_SOURCE_PATTERN.test(input.answer);
  const sourceRequested = SOURCE_REQUEST_PATTERN.test(
    `${input.question}\n${(input.intents ?? []).join("\n")}`,
  );
  const answerInjectionSignals = claimTexts.filter((claim) => PROMPT_INJECTION_PATTERN.test(securityText(claim)));
  const inputInjection = PROMPT_INJECTION_PATTERN.test(securityText(input.question));
  const exposedSecrets = secretSignals(`${input.question}\n${input.answer}`);
  const dangerousActions = dangerousActionSignals(`${input.question}\n${input.answer}`);
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
      passed: answerInjectionSignals.length === 0,
      severity: answerInjectionSignals.length > 0 ? "high" : "low",
      finding: answerInjectionSignals.length > 0
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
      ...customRules.map((rule) => ({ id: rule.id, requirement: rule.requirement, severity: rule.severity })),
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
      ...Object.fromEntries(customRules.map((rule) => [rule.id, evaluation(`constitution:${rule.id}`)])),
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
    else if (rule.kind === "allow_target") passed = Boolean(input.checkpoint?.target && targetMatches(input.checkpoint.target, normalizedValue));
    else if (rule.kind === "forbid_target") passed = !input.checkpoint?.target || !targetMatches(input.checkpoint.target, normalizedValue);
    return {
      angle: `constitution:${rule.id}`,
      passed,
      severity: passed ? "low" : rule.severity,
      finding: passed ? `Constitution rule ${rule.id} was satisfied.` : `Constitution rule ${rule.id} was violated: ${rule.requirement}`,
      evidence: rule.value ? [rule.value] : rule.kind === "require_citation" ? citations.slice(0, 4) : [],
    };
  });
}

function securityText(value: string): string {
  const cleaned = value.normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "");
  const normalized = cleaned
    .replace(/[013457@$]/g, (character) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" }[character] ?? character));
  const decoded: string[] = [];
  for (const match of cleaned.matchAll(/(?:^|\s)([A-Za-z0-9+/]{16,512}={0,2})(?=\s|$|[.,;!?])/g)) {
    try {
      const candidate = Buffer.from(match[1] ?? "", "base64").toString("utf8");
      const printable = [...candidate].filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
      if (candidate.length > 0 && printable / candidate.length > 0.9) decoded.push(candidate);
    } catch {
      // Invalid base64 remains ordinary submitted text.
    }
  }
  return [normalized, ...decoded].join("\n");
}

function secretSignals(value: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

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

function dangerousActionSignals(value: string): string[] {
  // Keep the original digits for IP addresses and command arguments, while also
  // testing the de-obfuscated representation used for leetspeak and hidden text.
  const candidates = [value.normalize("NFKC"), securityText(value)];
  return DANGEROUS_ACTION_PATTERNS
    .filter(([, pattern]) => candidates.some((candidate) => pattern.test(candidate)))
    .map(([name]) => name);
}

function networkBoundaryFinding(target: string | undefined): string | undefined {
  if (!target) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? "Checkpoint target is not a valid URL." : undefined;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) return `Checkpoint target uses the disallowed ${parsed.protocol} scheme.`;
  if (parsed.username || parsed.password) return "Checkpoint target contains embedded credentials.";
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::" || host === "::1" || host.endsWith(".localhost") || isPrivateIpv4(host) || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return "Checkpoint target resolves syntactically to a loopback, link-local, or private-network address.";
  }
  return undefined;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}

function targetMatches(target: string, ruleValue: string): boolean {
  const candidate = target.toLocaleLowerCase("en-US");
  if (ruleValue.startsWith("*.")) {
    const suffix = ruleValue.slice(1);
    try {
      return new URL(target).hostname.toLocaleLowerCase("en-US").endsWith(suffix);
    } catch {
      return candidate.endsWith(suffix);
    }
  }
  return candidate === ruleValue;
}

function governance(input: VerificationInput, verdict: TrustCard["verdict"]): NonNullable<TrustCard["governance"]> {
  const defaults = { trust: "allow", caution: "record", reject: "block" } as const;
  const action = input.response_policy?.[verdict] ?? defaults[verdict];
  return {
    checkpoint: input.checkpoint ?? { id: "submitted-answer", type: "final_output" },
    constitution_version: input.constitution?.version ?? "glassbox-lite/builtin-v1",
    response: { action, executed: false, rationale: `The configured response policy maps verdict ${verdict} to ${action}. GlassBox reports this action; the caller must enforce it.` },
  };
}

function verdictRationale(verdict: TrustCard["verdict"], failed: RedTeamProbe[]): string {
  const caveat = "This is not a fact-check; external facts and citations remain unverified.";
  if (verdict === "reject") {
    const reasons = failed
      .filter((probe) => probe.angle === "internal_contradiction" || probe.angle === "arithmetic_sanity" ||
        ["input_injection", "credential_exposure", "network_boundary"].includes(probe.angle) ||
        probe.angle === "dangerous_action" ||
        (probe.angle.startsWith("constitution:") && ["high", "critical"].includes(probe.severity)))
      .map((probe) => probe.angle.replaceAll("_", " "));
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
