/**
 * Audit engine — deterministic log IDs and full call traces.
 *
 * Two distinct hashes are produced for every verification:
 *
 *   inputs_hash : sha256(model || question || answer || sortedIntents)
 *                 Same inputs → same hash, regardless of when the run
 *                 was made. Lets a reviewer ask "is this the same input
 *                 we audited last week?" without leaking timestamps.
 *
 *   log_id      : sha256(inputs_hash || canonical(claims) ||
 *                        canonical(ecs.dimensions) || canonical(redteam) ||
 *                        canonical(constitution.evaluations))
 *                 Same inputs AND same engine outputs → same log id.
 *                 Two runs with identical results collapse to the same
 *                 audit record (useful for caching / replay detection).
 *
 * `generated_at` is recorded but never enters either hash, so audit IDs
 * stay reproducible across replays.
 */

import crypto from "node:crypto";
import type {
  ApiCallTrace,
  AuditRecord,
  AuditReference,
  Claim,
  ConstitutionReport,
  ECSReport,
  RedTeamReport,
  Verdict,
} from "../types";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Stable JSON: object keys sorted recursively so two equivalent objects
 * always serialise to byte-identical strings. Required for any field
 * that enters a hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function computeInputsHash(args: {
  model: string;
  question: string;
  answer: string;
  intents: string[];
}): string {
  const payload = canonicalJson({
    model: args.model,
    question: args.question,
    answer: args.answer,
    intents: [...args.intents].sort(),
  });
  return sha256(payload);
}

export function computeLogId(args: {
  inputsHash: string;
  claims: Claim[];
  ecs: ECSReport;
  redTeam: RedTeamReport;
  constitution: ConstitutionReport;
}): string {
  const payload = canonicalJson({
    inputs_hash: args.inputsHash,
    claims: args.claims,
    ecs_dimensions: args.ecs.dimensions,
    ecs_total: args.ecs.total.toFixed(6),
    red_team: args.redTeam.probes.map((p) => ({
      angle: p.angle,
      passed: p.passed,
      severity: p.severity,
    })),
    constitution: args.constitution.evaluations ?? {},
  });
  return "glassbox-" + sha256(payload).slice(0, 24);
}

export interface AuditAssembly {
  model: string;
  question: string;
  answer: string;
  intents: string[];
  claims: Claim[];
  ecs: ECSReport;
  redTeam: RedTeamReport;
  constitution: ConstitutionReport;
  verdict: Verdict;
  callTrace: ApiCallTrace[];
  generatedAt?: string;
}

export function assembleAuditRecord(input: AuditAssembly): AuditRecord {
  const inputsHash = computeInputsHash({
    model: input.model,
    question: input.question,
    answer: input.answer,
    intents: input.intents,
  });
  const logId = computeLogId({
    inputsHash,
    claims: input.claims,
    ecs: input.ecs,
    redTeam: input.redTeam,
    constitution: input.constitution,
  });
  return {
    log_id: logId,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    inputs_hash: inputsHash,
    model: input.model,
    question: input.question,
    answer: input.answer,
    verdict: input.verdict,
    ecs: input.ecs,
    claims: input.claims,
    red_team: input.redTeam,
    constitution: input.constitution,
    call_trace: input.callTrace,
  };
}

export function toAuditReference(record: AuditRecord): AuditReference {
  return {
    log_id: record.log_id,
    generated_at: record.generated_at,
    inputs_hash: record.inputs_hash,
  };
}
