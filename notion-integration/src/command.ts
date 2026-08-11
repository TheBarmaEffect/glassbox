import type { AuditInput, AuditResult } from "./types.js";

const MAX_COMMAND_CHARS = 2_000;
const MAX_INTENTS = 8;
const MAX_INTENT_CHARS = 300;

export function parseGlassboxCommand(text: string): AuditInput | undefined {
  const normalized = text.replaceAll("\r", "").trim();
  if (!/^\/glassbox(?:\s|$)/.test(normalized)) return undefined;
  if (normalized.length > MAX_COMMAND_CHARS) {
    throw new Error("The /glassbox comment is too long.");
  }
  const payload = normalized.slice("/glassbox".length).trim();
  const parts = payload.split("||").map((value) => value.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error("Use /glassbox question || answer [|| intent one; intent two].");
  }
  const intents = parts.slice(2).join("||").split(";").map((value) => value.trim()).filter(Boolean);
  if (intents.length > MAX_INTENTS || intents.some((value) => value.length > MAX_INTENT_CHARS)) {
    throw new Error("Use at most 8 intents of 300 characters each.");
  }
  return { question: parts[0], answer: parts[1], ...(intents.length ? { intents } : {}) };
}

function percent(score: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  return `${(bounded * 100).toFixed(1)}%`;
}

function inert(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("@", "@\u200b")
    .replace(/https?:\/\//gi, (match) => `${match.slice(0, -2)}\u200b//`);
}

export function formatAuditResult(result: AuditResult): string {
  const lines = [
    `GlassBox: ${result.verdict.toUpperCase()} · score ${percent(result.score)}`,
    inert(result.summary),
    `Claims: ${result.claim_count} · Findings: ${result.finding_count} · Highest severity: ${inert(result.highest_severity)}`,
  ];
  for (const finding of result.findings.slice(0, 3)) {
    lines.push(`• ${inert(finding.angle)} (${inert(finding.severity)}): ${inert(finding.summary)}`);
  }
  lines.push(
    "",
    "Deterministic reasoning audit only — not a web fact-check, source authentication, moderation decision, or professional advice.",
  );
  return lines.join("\n").slice(0, 1_900);
}
