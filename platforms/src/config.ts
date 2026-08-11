import "dotenv/config";
import { PLATFORMS, type Platform } from "./types.js";
import { selectGlassboxBackend } from "./verifier.js";

const numberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function parsePublicPlatforms(value: string | undefined): Set<Platform> {
  const requested = (value ?? "")
    .split(",")
    .map((platform) => platform.trim().toLowerCase())
    .filter(Boolean);
  const valid = new Set<string>(PLATFORMS);
  const invalid = [...new Set(requested.filter((platform) => !valid.has(platform)))];
  if (invalid.length > 0) {
    throw new Error(`PLATFORM_PUBLIC_PLATFORMS contains unsupported values: ${invalid.join(", ")}.`);
  }
  return new Set(requested as Platform[]);
}

export const config = {
  verifierBackend: selectGlassboxBackend(process.env),
  anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  port: numberFromEnv("PORT", 8080),
  trustProxyHops: numberFromEnv("TRUST_PROXY_HOPS", 1),
  maxConcurrency: numberFromEnv("PLATFORM_MAX_CONCURRENCY", 1),
  maxQueue: numberFromEnv("PLATFORM_MAX_QUEUE", 50),
  rateLimit: numberFromEnv("PLATFORM_RATE_LIMIT", 10),
  dailyRequestLimit: numberFromEnv("PLATFORM_DAILY_REQUEST_LIMIT", 100),
  estimatedJobMs: numberFromEnv("PLATFORM_ESTIMATED_JOB_MS", 60_000),
  jobTimeoutMs: numberFromEnv("PLATFORM_JOB_TIMEOUT_MS", 10 * 60_000),
  allowPublic: process.env.PLATFORM_ALLOW_PUBLIC === "true",
  publicPlatforms: parsePublicPlatforms(process.env.PLATFORM_PUBLIC_PLATFORMS),
  pilotTenants: new Set(
    (process.env.PILOT_TENANT_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
  openaiAppsChallengeToken: process.env.OPENAI_APPS_CHALLENGE_TOKEN,
  sharedSecret: process.env.PLATFORM_SHARED_SECRET,
  discord: {
    applicationId: process.env.DISCORD_APPLICATION_ID,
    publicKey: process.env.DISCORD_PUBLIC_KEY,
    botToken: process.env.DISCORD_BOT_TOKEN,
  },
  slack: {
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    botToken: process.env.SLACK_BOT_TOKEN,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  },
  reddit: {
    approved: process.env.REDDIT_DATA_API_APPROVED === "true",
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
    userAgent: process.env.REDDIT_USER_AGENT,
    subreddits: new Set(
      (process.env.REDDIT_SUBREDDIT_ALLOWLIST ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
    pollIntervalMs: numberFromEnv("REDDIT_POLL_INTERVAL_MS", 30_000),
  },
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    marketplaceWebhookSecret: process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    token: process.env.GITHUB_TOKEN,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replaceAll("\\n", "\n"),
  },
};

export function enabledPlatforms(): string[] {
  const enabled: string[] = ["mcp"];
  if (config.sharedSecret) enabled.push("api");
  if (config.discord.applicationId && config.discord.publicKey) enabled.push("discord");
  if (config.slack.signingSecret && config.slack.botToken) enabled.push("slack");
  if (config.telegram.botToken && config.telegram.webhookSecret) enabled.push("telegram");
  if (
    config.reddit.approved && config.reddit.clientId && config.reddit.clientSecret && config.reddit.username &&
    config.reddit.password && config.reddit.userAgent && config.reddit.subreddits.size > 0
  ) enabled.push("reddit-classic-pilot");
  if (
    config.github.webhookSecret &&
    (config.github.token || (config.github.appId && config.github.privateKey))
  ) enabled.push("github");
  return enabled;
}
