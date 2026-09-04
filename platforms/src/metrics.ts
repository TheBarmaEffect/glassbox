import type { RedTeamProbe, ResponseAction, RuntimeCheckpoint, TrustCard } from "./types.js";

/**
 * Traffic evidence for the gateway: how much real work it did, and how it came out.
 *
 * The rule this file exists to hold: it counts events, never content. Nothing here reads
 * a question, an answer, a claim, an evidence string, a span, or a hash of any of them. A
 * content hash is content-derived, so it is not stored either. The only strings that
 * reach a counter are labels that have first been matched against a fixed set or an
 * identifier pattern, then capped.
 *
 * Auditing that claim is meant to be a single-file read. `verificationEvent` is the only
 * bridge from a TrustCard into a counter, and every label passes through
 * `BoundedCounter`. If both are content-free, the published payload is content-free.
 *
 * Everything is in-memory and bounded. The gateway runs on one small instance that spins
 * down, so these are process-local aggregates for an operator to scrape, not a durable
 * audit log, and the payload says so about itself.
 */

/**
 * Probe labels that may appear in the payload: the deterministic answer probes and the
 * tool-invocation probes. The set is fixed at compile time rather than taken from
 * whatever `angle` a verifier returns, so a probe label can never become a channel for
 * submitted content. Anything outside it is counted as `other`.
 */
export const TRACKED_PROBE_ANGLES = [
  "claim_extraction", "unsupported_certainty", "citation_verifiability",
  "citation_resolvability",
  "unsupported_specificity", "answer_relevance", "internal_contradiction",
  "arithmetic_sanity", "input_injection", "prompt_injection",
  "credential_exposure", "dangerous_action", "network_boundary", "fact_check_scope",
  "tool_capability", "tool_declaration_drift", "tool_description_injection",
  "tool_argument_injection", "tool_argument_credential", "tool_argument_dangerous",
] as const;

/**
 * Constitution probes carry the caller's own rule id inside their angle
 * (`constitution:<rule id>`, see src/lite.ts). That id is caller-written free text, so it
 * is dropped and every constitution rule is counted under this single label. The useful
 * signal is how often caller policy fired, not whose rule it was.
 */
export const CONSTITUTION_PROBE_LABEL = "constitution_rule";
const CONSTITUTION_ANGLE_PREFIX = "constitution:";

/** Where an observation goes when it has no key of its own. */
export const OVERFLOW_LABEL = "other";

/** Distinct keys any one distribution may hold, before the overflow bucket. */
export const MAX_LABEL_CARDINALITY = 64;

/**
 * A label earns its own key only if it looks like an identifier. `constitution_version`
 * is caller-supplied and this payload is public, so without this a caller could write
 * arbitrary prose into something the gateway publishes. Free text fails the pattern and
 * lands in `other`. The length bound is part of the pattern, not a separate truncation,
 * because truncating would keep a prefix of whatever was sent.
 */
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+\/-]{0,63}$/;

/** Actions that release the output. Every other action withholds it. Mirrors the gate in src/api.ts. */
const RELEASING_ACTIONS = new Set<ResponseAction>(["allow", "record"]);

export const REJECTION_KINDS = [
  "admission", "rate", "queue", "global", "timeout", "duplicate", "input", "verifier",
] as const;

export type RejectionKind = typeof REJECTION_KINDS[number];
export type ProbeLabel = typeof TRACKED_PROBE_ANGLES[number] | typeof CONSTITUTION_PROBE_LABEL | typeof OVERFLOW_LABEL;
export type CheckpointLabel = RuntimeCheckpoint["type"] | "unspecified";
export type Severity = RedTeamProbe["severity"];

/**
 * Everything a completed verification contributes to the counters. Categorical fields and
 * integers only: this interface is the contract that keeps content out, so widening it
 * with a free-text field would defeat the whole module.
 */
export interface VerificationEvent {
  surface: string;
  verdict: TrustCard["verdict"];
  action: ResponseAction;
  released: boolean;
  checkpoint_type: CheckpointLabel;
  highest_severity: Severity;
  constitution_version: string;
  /** Probe angle to whether it passed. Angles are relabelled against the fixed set above. */
  probe_outcomes: Record<string, boolean>;
  latency_ms: number;
  claim_count: number;
}

/**
 * Fixed histogram bounds in milliseconds, spanning a sub-millisecond deterministic Lite
 * audit through the ten-minute job timeout. A histogram rather than a reservoir: O(1)
 * memory, and the same inputs always give the same percentiles, where a sampled reservoir
 * would make the published figure depend on which requests happened to be kept.
 */
export const LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000, 600_000,
] as const;

export interface LatencySnapshot {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Cumulative counts by upper bound, so an operator can recompute any percentile. `le: null` is the open-ended bucket. */
  buckets: Array<{ le: number | null; count: number }>;
}

export interface ProbeFireRate {
  evaluated: number;
  fired: number;
  fire_rate: number;
}

export interface MetricsSnapshot {
  schema_version: string;
  since: string;
  uptime_s: number;
  verifications: {
    total: number;
    claims_extracted: number;
    released: number;
    withheld: number;
    by_surface: Record<string, number>;
    by_verdict: Record<string, number>;
    by_action: Record<string, number>;
    by_checkpoint_type: Record<string, number>;
    by_highest_severity: Record<string, number>;
    by_constitution_version: Record<string, number>;
  };
  probe_fire_rate: Record<string, ProbeFireRate>;
  rejections: {
    total: number;
    by_kind: Record<string, number>;
  };
  latency_ms: LatencySnapshot;
  cardinality: {
    limit: number;
    overflow_label: string;
  };
  notes: string[];
}

const METRICS_SCHEMA_VERSION = "2026-09-04";

const NOTES = [
  "Counters record categorical outcomes and integers only. No question, answer, claim, evidence string, span, or hash of submitted content is read or stored.",
  "Counters are in-memory and reset when the instance restarts. They are not a durable audit log.",
  "released and withheld count release-class actions (allow, record) against withhold-class actions (block, retry, escalate). Only /api/v1/govern acts on that decision; on every other surface the action is advisory and the caller enforces it.",
  "probe_fire_rate is fired divided by evaluated. It is how often a deterministic check flagged something, not how often the flag was correct: the gateway has no ground truth at runtime.",
  "Constitution probes are counted under one constitution_rule label because their angle carries a caller-written rule id.",
  "rejections are requests refused before or instead of verification. They are counted separately from verifications because a refused request never reached the verifier and does not belong in any verdict denominator.",
  "constitution_version is a caller-supplied policy label. It earns its own key only if it matches an identifier pattern, and only for the first 64 distinct values; everything else is counted as other.",
  "Latency is measured from queue admission to verdict, so it includes queue wait. Percentiles are bucket upper bounds by nearest rank, and a null percentile means the sample sat above the largest bucket. The cumulative buckets are published so any percentile can be recomputed.",
] as const;

/**
 * Fixed-width latency histogram. One slot per bound plus one open-ended slot, so no
 * amount of traffic grows it.
 */
class LatencyHistogram {
  private readonly counts: number[] = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
  private total = 0;

  record(milliseconds: number): void {
    const value = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : Number.POSITIVE_INFINITY;
    const found = LATENCY_BUCKETS_MS.findIndex((bound) => value <= bound);
    const index = found < 0 ? LATENCY_BUCKETS_MS.length : found;
    this.counts[index] = (this.counts[index] ?? 0) + 1;
    this.total += 1;
  }

  snapshot(): LatencySnapshot {
    let cumulative = 0;
    const buckets: Array<{ le: number | null; count: number }> = LATENCY_BUCKETS_MS.map((bound, index) => {
      cumulative += this.counts[index] ?? 0;
      return { le: bound as number, count: cumulative };
    });
    buckets.push({ le: null, count: this.total });
    return {
      count: this.total,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      buckets,
    };
  }

  /**
   * Nearest-rank percentile, reported as the upper bound of the bucket the ranked sample
   * falls in. Null when that sample sat above the largest bound: the histogram cannot
   * know how far above, and a confident invented number is exactly the failure this
   * project exists to catch.
   */
  private percentile(percent: number): number | null {
    if (this.total === 0) return null;
    const rank = Math.ceil((percent / 100) * this.total);
    let cumulative = 0;
    for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
      cumulative += this.counts[index] ?? 0;
      if (cumulative >= rank) return LATENCY_BUCKETS_MS[index] ?? null;
    }
    return null;
  }
}

/** A label distribution that a hostile caller cannot grow without limit. */
class BoundedCounter {
  private readonly counts = new Map<string, number>();

  /**
   * Seeded labels start at zero so a distribution also shows the outcomes that never
   * happened, which is the more interesting half of a fire rate. Unseeded counters start
   * empty and fill in as traffic arrives.
   */
  constructor(seed: readonly string[] = [], private readonly limit: number = MAX_LABEL_CARDINALITY) {
    for (const label of seed) this.counts.set(label, 0);
  }

  increment(rawLabel: string): void {
    const label = LABEL_PATTERN.test(rawLabel) ? rawLabel : OVERFLOW_LABEL;
    if (label !== OVERFLOW_LABEL && !this.counts.has(label) && this.tracked() >= this.limit) {
      // A caller minting a fresh constitution version on every request would otherwise
      // grow this map until the instance dies. Past the cap the observation still counts,
      // it just stops earning a key of its own.
      this.add(OVERFLOW_LABEL);
      return;
    }
    this.add(label);
  }

  /** Sorted, so the same traffic always serializes to the same bytes. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(
      [...this.counts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  }

  private add(label: string): void {
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
  }

  /** The overflow bucket is reserved and does not consume one of the tracked slots. */
  private tracked(): number {
    return this.counts.has(OVERFLOW_LABEL) ? this.counts.size - 1 : this.counts.size;
  }
}

export function probeLabel(angle: string): ProbeLabel {
  if ((TRACKED_PROBE_ANGLES as readonly string[]).includes(angle)) return angle as ProbeLabel;
  if (angle.startsWith(CONSTITUTION_ANGLE_PREFIX)) return CONSTITUTION_PROBE_LABEL;
  return OVERFLOW_LABEL;
}

/**
 * The only path from a TrustCard into the counters. It reads the card's verdict, action,
 * severity, probe pass/fail flags, and claim count, and nothing else; it never touches
 * `question`, `answer`, `claims[].text`, probe findings or evidence, or `audit`.
 *
 * `checkpoint_type` comes from the caller's own request rather than from the card because
 * the engine substitutes `final_output` when a caller declares nothing, and the useful
 * evidence is which checkpoints callers actually integrate at.
 */
export function verificationEvent(
  card: TrustCard,
  context: { surface: string; checkpoint_type: CheckpointLabel; latency_ms: number },
): VerificationEvent {
  // Mirrors the fail-closed default the govern gate applies in src/api.ts, so the counter
  // reports the action the gateway acted on rather than a second, divergent reading of a
  // card that arrived without governance.
  const action: ResponseAction = card.governance?.response.action ?? "block";
  const probeOutcomes: Record<string, boolean> = {};
  for (const probe of card.red_team.probes) probeOutcomes[probe.angle] = probe.passed;
  return {
    surface: context.surface,
    verdict: card.verdict,
    action,
    released: RELEASING_ACTIONS.has(action),
    checkpoint_type: context.checkpoint_type,
    highest_severity: card.red_team.highest_severity,
    constitution_version: card.governance?.constitution_version ?? "unspecified",
    probe_outcomes: probeOutcomes,
    latency_ms: context.latency_ms,
    claim_count: card.claims.length,
  };
}

export class GatewayMetrics {
  private readonly startedAt: number;
  private verifications = 0;
  private rejections = 0;
  private claims = 0;
  private released = 0;
  private withheld = 0;
  private readonly bySurface = new BoundedCounter();
  private readonly byVerdict = new BoundedCounter(["caution", "reject", "trust"]);
  private readonly byAction = new BoundedCounter(["allow", "block", "escalate", "record", "retry"]);
  private readonly byCheckpointType = new BoundedCounter([
    "agent_step", "final_output", "input", "model_output", "tool_call", "unspecified",
  ]);
  private readonly byHighestSeverity = new BoundedCounter(["critical", "high", "low", "medium"]);
  private readonly byConstitutionVersion = new BoundedCounter();
  private readonly byRejectionKind = new BoundedCounter(REJECTION_KINDS);
  private readonly probesEvaluated = new BoundedCounter();
  private readonly probesFired = new BoundedCounter();
  private readonly latency = new LatencyHistogram();

  constructor(now: number = Date.now()) {
    this.startedAt = now;
  }

  recordVerification(event: VerificationEvent): void {
    this.verifications += 1;
    this.bySurface.increment(event.surface);
    this.byVerdict.increment(event.verdict);
    this.byAction.increment(event.action);
    this.byCheckpointType.increment(event.checkpoint_type);
    this.byHighestSeverity.increment(event.highest_severity);
    this.byConstitutionVersion.increment(event.constitution_version);
    if (event.released) this.released += 1;
    else this.withheld += 1;
    this.claims += wholeCount(event.claim_count);
    this.latency.record(event.latency_ms);
    for (const [angle, passed] of Object.entries(event.probe_outcomes)) {
      const label = probeLabel(angle);
      this.probesEvaluated.increment(label);
      // A probe fires when it does not pass. Nothing at runtime tells the gateway whether
      // the flag was right, so this can only ever be a fire rate.
      if (!passed) this.probesFired.increment(label);
    }
  }

  /**
   * Counted apart from verifications on purpose. A refused request never reached the
   * verifier, so folding the two together would quietly put a different denominator under
   * every verdict and fire rate in the payload.
   */
  recordRejection(kind: RejectionKind): void {
    this.rejections += 1;
    this.byRejectionKind.increment(kind);
  }

  snapshot(now: number = Date.now()): MetricsSnapshot {
    const evaluated = this.probesEvaluated.snapshot();
    const fired = this.probesFired.snapshot();
    const probeFireRate: Record<string, ProbeFireRate> = {};
    for (const [label, evaluatedCount] of Object.entries(evaluated)) {
      // A probe the engine never ran is not evidence about that probe, so it is left out
      // rather than published as a zero fire rate.
      if (evaluatedCount === 0) continue;
      const firedCount = fired[label] ?? 0;
      probeFireRate[label] = {
        evaluated: evaluatedCount,
        fired: firedCount,
        fire_rate: Math.round((firedCount / evaluatedCount) * 10_000) / 10_000,
      };
    }

    return {
      schema_version: METRICS_SCHEMA_VERSION,
      since: new Date(this.startedAt).toISOString(),
      uptime_s: Math.max(0, Math.floor((now - this.startedAt) / 1_000)),
      verifications: {
        total: this.verifications,
        claims_extracted: this.claims,
        released: this.released,
        withheld: this.withheld,
        by_surface: this.bySurface.snapshot(),
        by_verdict: this.byVerdict.snapshot(),
        by_action: this.byAction.snapshot(),
        by_checkpoint_type: this.byCheckpointType.snapshot(),
        by_highest_severity: this.byHighestSeverity.snapshot(),
        by_constitution_version: this.byConstitutionVersion.snapshot(),
      },
      probe_fire_rate: probeFireRate,
      rejections: {
        total: this.rejections,
        by_kind: this.byRejectionKind.snapshot(),
      },
      latency_ms: this.latency.snapshot(),
      cardinality: {
        limit: MAX_LABEL_CARDINALITY,
        overflow_label: OVERFLOW_LABEL,
      },
      notes: [...NOTES],
    };
  }
}

function wholeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
