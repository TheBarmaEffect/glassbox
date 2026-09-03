import type { TrustCard } from "./types.js";

const verdictIcon = { trust: "✅", caution: "⚠️", reject: "🛑" } as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatTrustCard(card: TrustCard, maxChars = 1_900): string {
  const weakest = Object.entries(card.ecs.dimensions)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([name, score]) => `${humanize(name)} ${(score * 100).toFixed(0)}%`)
    .join(" · ");
  const failures = card.red_team.probes
    .filter((probe) => !probe.passed)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3);
  const assumed = card.claims.filter((claim) => claim.status !== "observed").slice(0, 2);

  const lines = [
    `${verdictIcon[card.verdict]} GlassBox: **${card.verdict.toUpperCase()}** · ECS ${(card.ecs.total * 100).toFixed(1)}%`,
    truncate(safeDynamic(card.verdict_rationale), 420),
    weakest ? `Weakest dimensions: ${safeDynamic(weakest)}` : "",
    `Claims: ${card.claims.length} · Red-team pass rate: ${(card.red_team.pass_rate * 100).toFixed(0)}%`,
    card.governance ? `Checkpoint: ${safeDynamic(card.governance.checkpoint.type)} · Recommended response: ${safeDynamic(card.governance.response.action).toUpperCase()}` : "",
  ].filter(Boolean);

  if (failures.length > 0) {
    lines.push("", "Top findings:");
    for (const probe of failures) {
      lines.push(
        `• ${safeDynamic(humanize(probe.angle))} (${probe.severity}): ${truncate(safeDynamic(probe.finding), 260)}`,
      );
    }
  } else if (assumed.length > 0) {
    lines.push("", "Claims to inspect:");
    for (const claim of assumed) {
      lines.push(`• ${truncate(safeDynamic(claim.text), 260)} (${claim.status})`);
    }
  }

  lines.push(
    "",
    `Audit: \`${safeDynamic(card.audit.log_id)}\``,
    "User-invoked AI reasoning audit; not a fact-check or professional advice.",
  );
  return truncate(neutralizeMentions(lines.join("\n")), maxChars);
}

function severityRank(value: string): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value] ?? 0;
}

export function formatPlainTrustCard(card: TrustCard, maxChars = 3_500): string {
  return formatTrustCard(card, maxChars).replaceAll("**", "").replaceAll("`", "");
}

export function formatSlackTrustCard(card: TrustCard, maxChars = 3_500): string {
  const formatted = formatTrustCard(card, maxChars)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "*$1*");
  return truncate(formatted, maxChars);
}

function neutralizeMentions(value: string): string {
  return value
    .replaceAll("@", "@\u200b")
    .replace(/\b([ur])\/([A-Za-z0-9_-])/g, "$1/\u200b$2");
}

function safeDynamic(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/https?:\/\//gi, (match) => `${match.slice(0, -2)}\u200b//`)
    .replace(/www\./gi, "www\u200b.")
    .replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "$1\u200b")
    .replaceAll("<", "<\u200b")
    .replaceAll(">", ">\u200b");
}
