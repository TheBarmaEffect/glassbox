import crypto from 'node:crypto';

export const GLASSBOX_GATEWAY_ORIGIN =
  'https://glassbox-platform-gateway.onrender.com';
export const GLASSBOX_VERIFY_URL = `${GLASSBOX_GATEWAY_ORIGIN}/api/v1/verify`;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_RESULT_CHARS = 3_200;
const DEFAULT_TIMEOUT_MS = 25_000;

export type SelectedContent = {
  answer: string;
  intents: string[];
  question: string;
  truncated: boolean;
};

export type TrustCard = {
  audit: { log_id: string };
  claims: unknown[];
  ecs: { dimensions: Record<string, number>; total: number };
  red_team: {
    pass_rate: number;
    probes: Array<{
      angle: string;
      finding: string;
      passed: boolean;
      severity: string;
    }>;
  };
  verdict: 'trust' | 'caution' | 'reject';
  verdict_rationale: string;
};

export class GatewayError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

type AuditRequestOptions = {
  content: SelectedContent;
  fetchImpl?: typeof fetch;
  idempotencyKey?: string;
  secret: string;
  timeoutMs?: number;
};

export function selectedContent(
  kind: 'comment' | 'post',
  title: string,
  rawAnswer: string,
): SelectedContent {
  const cleanTitle = normalize(title) || 'Untitled Reddit post';
  const cleanAnswer = normalize(rawAnswer) || cleanTitle;
  const answer = cleanAnswer.slice(0, MAX_ANSWER_CHARS);
  const truncated = answer.length < cleanAnswer.length;
  const subject = kind === 'comment' ? 'comment' : 'post';
  const question = truncate(
    `What reasoning and evidentiary risks appear in this Reddit ${subject} under the post titled “${cleanTitle}”?`,
    6_000,
  );
  const intents = [
    'Check internal consistency, unsupported certainty, citation signals, simple arithmetic, and prompt-injection language.',
  ];
  if (truncated) {
    intents.push(
      `Only the first ${MAX_ANSWER_CHARS.toLocaleString('en-US')} characters of the selected Reddit content were submitted.`,
    );
  }
  return { answer, intents, question, truncated };
}

export async function requestGlassboxAudit({
  content,
  fetchImpl = fetch,
  idempotencyKey = crypto.randomUUID(),
  secret,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AuditRequestOptions): Promise<TrustCard> {
  const bearer = secret.trim();
  if (!bearer) throw new GatewayError('GlassBox gateway secret is not configured.');

  let response: Response;
  try {
    response = await fetchImpl(GLASSBOX_VERIFY_URL, {
      body: JSON.stringify({
        answer: content.answer,
        intents: content.intents,
        platform: 'reddit',
        question: content.question,
      }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `reddit-devvit:${idempotencyKey}`,
      },
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    throw new GatewayError(
      timeout
        ? 'GlassBox took too long to respond. The free service may be waking up; retry once.'
        : 'GlassBox could not be reached. Retry shortly.',
    );
  }

  if (!response.ok) throw statusError(response.status);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new GatewayError('GlassBox returned an unreadable response.');
  }
  if (!isTrustCard(value)) {
    throw new GatewayError('GlassBox returned an invalid Trust Card.');
  }
  return value;
}

export function formatTrustCard(card: TrustCard): string {
  const weakest = Object.entries(card.ecs.dimensions)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort((left, right) => left[1] - right[1])
    .slice(0, 2)
    .map(([name, score]) => `${humanize(name)} ${percent(score)}`)
    .join(' · ');
  const failures = card.red_team.probes
    .filter((probe) => !probe.passed)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 3);

  const lines = [
    `GlassBox: ${card.verdict.toUpperCase()} · ECS ${percent(card.ecs.total)}`,
    safeDynamic(card.verdict_rationale),
    weakest ? `Weakest dimensions: ${safeDynamic(weakest)}` : '',
    `Claims inspected: ${card.claims.length} · Red-team pass rate: ${percent(card.red_team.pass_rate)}`,
  ].filter(Boolean);

  if (failures.length > 0) {
    lines.push('', 'Top findings:');
    for (const probe of failures) {
      lines.push(
        `• ${safeDynamic(humanize(probe.angle))} (${safeDynamic(probe.severity)}): ${truncate(safeDynamic(probe.finding), 360)}`,
      );
    }
  }

  lines.push(
    '',
    `Audit: ${safeDynamic(card.audit.log_id)}`,
    'Deterministic reasoning audit only — not an internet fact-check, moderation decision, or professional advice.',
    `Privacy: ${GLASSBOX_GATEWAY_ORIGIN}/privacy`,
    `Terms: ${GLASSBOX_GATEWAY_ORIGIN}/terms`,
  );
  return truncate(lines.join('\n'), MAX_RESULT_CHARS);
}

export function isTrustCard(value: unknown): value is TrustCard {
  if (!isRecord(value)) return false;
  if (!['trust', 'caution', 'reject'].includes(String(value.verdict))) return false;
  if (typeof value.verdict_rationale !== 'string') return false;
  if (!Array.isArray(value.claims)) return false;
  if (!isRecord(value.ecs) || !Number.isFinite(value.ecs.total)) return false;
  if (!isNumberRecord(value.ecs.dimensions)) return false;
  if (!isRecord(value.red_team) || !Number.isFinite(value.red_team.pass_rate)) return false;
  if (!Array.isArray(value.red_team.probes)) return false;
  if (!value.red_team.probes.every(isProbe)) return false;
  return isRecord(value.audit) && typeof value.audit.log_id === 'string';
}

function isProbe(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.angle === 'string' &&
    typeof value.finding === 'string' &&
    typeof value.passed === 'boolean' &&
    typeof value.severity === 'string'
  );
}

function statusError(status: number): GatewayError {
  if (status === 401) {
    return new GatewayError('GlassBox gateway authorization is misconfigured.', status);
  }
  if (status === 403) {
    return new GatewayError('This Reddit pilot is not admitted by the GlassBox gateway.', status);
  }
  if (status === 429) {
    return new GatewayError('GlassBox request limit reached. Retry later.', status);
  }
  if (status === 503 || status === 504) {
    return new GatewayError(
      'GlassBox is temporarily unavailable. The free service may be waking up; retry once.',
      status,
    );
  }
  return new GatewayError(`GlassBox request failed (HTTP ${status}).`, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

function normalize(value: string): string {
  return value.replaceAll('\r', '').trim();
}

function percent(value: number): string {
  const bounded = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return `${(bounded * 100).toFixed(1)}%`;
}

function severityRank(value: string): number {
  return { critical: 4, high: 3, low: 1, medium: 2 }[value.toLowerCase()] ?? 0;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function safeDynamic(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- strip control/bidi characters from untrusted output.
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('@', '@\u200b')
    .replace(/\b([ur])\/([A-Za-z0-9_-])/g, '$1/\u200b$2')
    .replace(/https?:\/\//gi, (match) => `${match.slice(0, -2)}\u200b//`)
    .replace(/www\./gi, 'www\u200b.');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
