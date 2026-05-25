/**
 * Glass Box Framework — shared type definitions.
 *
 * Every output of every engine flows through these shapes. Keeping them
 * here (rather than co-located with engines) is intentional: the Trust
 * Card is a contract, and the contract must be the same regardless of
 * which tool a downstream caller invokes.
 */

export type Severity = "low" | "medium" | "high" | "critical";
export type Verdict = "trust" | "caution" | "reject";

/**
 * A single atomic factual or evaluative claim extracted from an answer,
 * together with the *reasoning chain* that justifies why the model
 * believes that claim is supported by the question, the rest of the
 * answer, or known context.
 *
 * The `reasoning` field is the Glass Box. It must never be empty.
 */
export interface Claim {
  /** Stable per-claim identifier — `c-<index>` within a single answer. */
  id: string;

  /** The asserted statement, rewritten to stand alone. */
  text: string;

  /**
   * The reasoning chain — *why* the claim is being asserted, what would
   * support it, and what would falsify it. This is the core product of
   * the framework; an empty reasoning chain is a contract violation.
   */
  reasoning: string;

  /**
   * Stated confidence in the claim, on [0, 1]. Distinct from the
   * Calibration dimension of ECS, which measures whether this stated
   * confidence matches the available evidence.
   */
  confidence: number;

  /** Pieces of the original answer that support the claim verbatim. */
  supporting_evidence: string[];

  /** How the claim could be challenged or falsified. */
  attack_surface: string[];

  /**
   * One of: "observed" (direct from answer), "reconstructed" (inferred
   * by the extractor from context), or "assumed" (treated as given by
   * the answer without justification).
   */
  status: "observed" | "reconstructed" | "assumed";
}

/**
 * Each of the five ECS dimensions, scored independently on [0, 1].
 * The breakdown is *always* surfaced; the total is never shown alone.
 */
export interface ECSDimensions {
  /** Groundedness — fraction of claims with non-trivial reasoning + evidence. */
  groundedness: number;

  /** Coherence — internal consistency; penalised by contradictions. */
  coherence: number;

  /** Calibration — stated confidence vs evidence strength. */
  calibration: number;

  /** Red-team resistance — fraction of adversarial probes that found no issue. */
  red_team_resistance: number;

  /** Constitutional compliance — fraction of compiled rules satisfied. */
  constitutional_compliance: number;
}

export interface ECSWeights {
  groundedness: number;
  coherence: number;
  calibration: number;
  red_team_resistance: number;
  constitutional_compliance: number;
}

/**
 * Full ECS result. The `formula` field is a human-readable string of
 * the exact computation that produced `total`. Transparency requires
 * that this string is always present and always accurate.
 */
export interface ECSReport {
  dimensions: ECSDimensions;
  weights: ECSWeights;
  mode: "arithmetic" | "geometric";
  formula: string;
  total: number;
  /** Notes explaining why any dimension scored below 0.8. */
  notes: string[];
}

/**
 * One of the seven adversarial angles. Each probe returns a Finding
 * even when it passes — a clean pass is itself evidence, and the
 * audit log needs to record it.
 */
export type RedTeamAngle =
  | "fabrication"
  | "source_manipulation"
  | "bias_injection"
  | "context_attack"
  | "overconfidence"
  | "underspecification"
  | "constitutional_violation";

export interface RedTeamProbe {
  angle: RedTeamAngle;
  /** Did the answer survive this probe? */
  passed: boolean;
  /** Severity of any finding ("low" even when passed=true is allowed). */
  severity: Severity;
  /** Plain-English description of what the probe looked for. */
  question_asked: string;
  /** Plain-English description of what the probe found, pass or fail. */
  finding: string;
  /** Verbatim spans of the answer the probe is reacting to. */
  evidence: string[];
}

export interface RedTeamReport {
  probes: RedTeamProbe[];
  pass_rate: number;
  highest_severity: Severity;
}

/**
 * A single rule compiled out of a human-stated intent. The constitution
 * engine produces these; the red-team engine consults them when running
 * the "constitutional_violation" probe.
 */
export interface ConstitutionalRule {
  id: string;
  /** The original human-stated intent line this rule came from. */
  source_intent: string;
  /** When does this rule apply? Plain-English trigger condition. */
  trigger: string;
  /** What does the answer have to do or avoid? */
  requirement: string;
  /** What kind of harm does violating this cause? */
  rationale: string;
  severity: Severity;
}

export interface ConstitutionReport {
  rules: ConstitutionalRule[];
  /** Map of rule id -> satisfied/violated/not_triggered, populated at verify time. */
  evaluations?: Record<string, "satisfied" | "violated" | "not_triggered">;
}

/**
 * Trust Card — the unified output of `verify_answer`. Combines every
 * other engine's output, plus the final verdict and audit reference.
 */
export interface TrustCard {
  question: string;
  answer: string;
  verdict: Verdict;
  verdict_rationale: string;
  ecs: ECSReport;
  claims: Claim[];
  red_team: RedTeamReport;
  constitution: ConstitutionReport;
  audit: AuditReference;
}

export interface AuditReference {
  log_id: string;
  generated_at: string;
  inputs_hash: string;
}

/**
 * Full audit record — what `generate_audit_report` returns. Same data
 * as the Trust Card plus an explicit trace of every Anthropic API call
 * made during verification, so a reviewer can reproduce the run.
 */
export interface AuditRecord {
  log_id: string;
  generated_at: string;
  inputs_hash: string;
  model: string;
  question: string;
  answer: string;
  verdict: Verdict;
  ecs: ECSReport;
  claims: Claim[];
  red_team: RedTeamReport;
  constitution: ConstitutionReport;
  call_trace: ApiCallTrace[];
}

export interface ApiCallTrace {
  engine: string;
  purpose: string;
  prompt_hash: string;
  response_hash: string;
  ok: boolean;
  error?: string;
}
