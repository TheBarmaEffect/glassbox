export const DEFAULT_ENDPOINT = "https://glassbox-platform-gateway.onrender.com/mcp";
export const MAX_QUESTION_CHARS = 6_000;
export const MAX_ANSWER_CHARS = 12_000;
const MAX_RESPONSE_CHARS = 128_000;

const VERDICTS = new Set(["trust", "caution", "reject"] as const);
const SEVERITIES = new Set(["low", "medium", "high", "critical"] as const);
const PROBE_ANGLES = new Set([
  "claim_extraction",
  "unsupported_certainty",
  "internal_contradiction",
  "prompt_injection",
  "fact_check_scope",
  "citation_verifiability",
  "arithmetic_sanity",
] as const);

export type Verdict = "trust" | "caution" | "reject";
export type Severity = "low" | "medium" | "high" | "critical";
export type ProbeAngle =
  | "claim_extraction"
  | "unsupported_certainty"
  | "internal_contradiction"
  | "prompt_injection"
  | "fact_check_scope"
  | "citation_verifiability"
  | "arithmetic_sanity";

export interface PublicFinding {
  angle: ProbeAngle;
  severity: Severity;
  summary: string;
}

export interface PublicProbe extends PublicFinding {
  passed: boolean;
}

export interface PublicMcpResult {
  verdict: Verdict;
  summary: string;
  score: number;
  claim_count: number;
  finding_count: number;
  highest_severity: Severity;
  findings: PublicFinding[];
  probes: PublicProbe[];
  caveats: string[];
}

export interface VerifyRequest {
  endpoint: string;
  question: string;
  answer: string;
  signal?: AbortSignal;
}

export async function verifyAnswer(
  request: VerifyRequest,
  fetcher: typeof fetch = fetch,
): Promise<PublicMcpResult> {
  const endpoint = validateEndpoint(request.endpoint);
  const question = boundedText(request.question, MAX_QUESTION_CHARS, "Question");
  const answer = boundedText(request.answer, MAX_ANSWER_CHARS, "Selection");
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name: "glassbox_verify_answer",
        arguments: { question, answer },
      },
    }),
    signal: request.signal ?? null,
  });
  const body = await response.text();
  if (body.length > MAX_RESPONSE_CHARS) throw new Error("GlassBox returned an oversized response.");
  return parseMcpResponse(response.status, response.headers.get("content-type") ?? "", body);
}

export function validateEndpoint(raw: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new Error("GlassBox endpoint must be a valid URL.");
  }
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1";
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new Error("GlassBox endpoint must use HTTPS (HTTP is allowed only for localhost)."
    );
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("GlassBox endpoint cannot contain credentials or a fragment.");
  }
  return endpoint.toString();
}

export function parseMcpResponse(status: number, contentType: string, body: string): PublicMcpResult {
  if (status < 200 || status >= 300) throw new Error(`GlassBox request failed (${status}).`);
  const envelope = contentType.toLowerCase().includes("text/event-stream")
    ? parseEventStream(body)
    : parseJsonObject(body, "GlassBox response");
  const error = recordValue(envelope.error);
  if (error) {
    throw new Error(`GlassBox rejected the audit${typeof error.message === "string" ? `: ${safeText(error.message)}` : "."}`);
  }
  const rpcResult = requireRecord(envelope.result, "MCP result");
  const structured = requireRecord(rpcResult.structuredContent, "GlassBox structured result");
  for (const forbidden of ["question", "answer", "audit", "generated_at", "log_id", "inputs_hash"]) {
    if (forbidden in structured) throw new Error("GlassBox returned non-public audit data.");
  }
  return validatePublicResult(structured);
}

export function formatResult(result: PublicMcpResult): string {
  const lines = [
    "GlassBox Lite — selected-text audit",
    "",
    `Verdict: ${result.verdict.toUpperCase()}`,
    `Score: ${(result.score * 100).toFixed(1)}%`,
    `Claims analyzed: ${result.claim_count}`,
    `Highest severity: ${result.highest_severity}`,
    `Summary: ${safeText(result.summary)}`,
  ];
  if (result.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of result.findings) {
      lines.push(`- ${finding.angle} (${finding.severity}): ${safeText(finding.summary)}`);
    }
  }
  lines.push("", "Caveats:");
  for (const caveat of result.caveats) lines.push(`- ${safeText(caveat)}`);
  lines.push("", "The selected text is intentionally not repeated in this result.");
  return lines.join("\n");
}

function validatePublicResult(value: Record<string, unknown>): PublicMcpResult {
  const verdict = enumValue(value.verdict, VERDICTS, "verdict");
  const score = finiteNumber(value.score, "score", 0, 1);
  const claimCount = integer(value.claim_count, "claim_count", 0, 24);
  const findingCount = integer(value.finding_count, "finding_count", 0, 7);
  const severity = enumValue(value.highest_severity, SEVERITIES, "highest_severity");
  const findings = arrayValue(value.findings, "findings", 7).map((item) => finding(item, false));
  const probes = arrayValue(value.probes, "probes", 7).map((item) => finding(item, true));
  if (findingCount !== findings.length) throw new Error("GlassBox finding count did not match its findings.");
  const caveats = arrayValue(value.caveats, "caveats", 8).map((item) => boundedOutput(item, "caveat"));
  return {
    verdict,
    summary: boundedOutput(value.summary, "summary"),
    score,
    claim_count: claimCount,
    finding_count: findingCount,
    highest_severity: severity,
    findings,
    probes,
    caveats,
  };
}

function finding(value: unknown, includePassed: false): PublicFinding;
function finding(value: unknown, includePassed: true): PublicProbe;
function finding(value: unknown, includePassed: boolean): PublicFinding | PublicProbe {
  const item = requireRecord(value, "finding");
  const common: PublicFinding = {
    angle: enumValue(item.angle, PROBE_ANGLES, "angle"),
    severity: enumValue(item.severity, SEVERITIES, "severity"),
    summary: boundedOutput(item.summary, "finding summary"),
  };
  if (!includePassed) return common;
  if (typeof item.passed !== "boolean") throw new Error("GlassBox probe passed value was invalid.");
  return { ...common, passed: item.passed };
}

function parseEventStream(body: string): Record<string, unknown> {
  const messages = body.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => parseJsonObject(line, "MCP event"));
  const envelope = [...messages].reverse().find((message) => "result" in message || "error" in message);
  if (!envelope) throw new Error("GlassBox returned no MCP result event.");
  return envelope;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(text) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} was not valid JSON.`);
    throw error;
  }
}

function boundedText(value: string, max: number, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} cannot be empty.`);
  if (text.length > max) throw new Error(`${label} exceeds the ${max}-character limit.`);
  return text;
}

function boundedOutput(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_000) {
    throw new Error(`GlassBox ${label} was invalid.`);
  }
  return safeText(value);
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = recordValue(value);
  if (!record) throw new Error(`${label} was missing or invalid.`);
  return record;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayValue(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`GlassBox ${label} was invalid.`);
  return value;
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`GlassBox ${label} was invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = finiteNumber(value, label, minimum, maximum);
  if (!Number.isInteger(number)) throw new Error(`GlassBox ${label} was invalid.`);
  return number;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`GlassBox ${label} was invalid.`);
  return value as T;
}
