import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { TrustCard, Verifier } from "../src/types.js";

process.env.PLATFORM_SHARED_SECRET = "api-test-secret";
process.env.PLATFORM_ALLOW_PUBLIC = "false";
process.env.PILOT_TENANT_ALLOWLIST = "api";
process.env.DISCORD_APPLICATION_ID = "123";
process.env.SLACK_SIGNING_SECRET = "slack-test-secret";
process.env.SLACK_BOT_TOKEN = "slack-test-token";
process.env.TELEGRAM_BOT_TOKEN = "telegram-test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-test-secret";
process.env.GITHUB_WEBHOOK_SECRET = "github-test-secret";
process.env.GITHUB_TOKEN = "github-test-token";

const discordKeys = crypto.generateKeyPairSync("ed25519");
const discordDer = discordKeys.publicKey.export({ type: "spki", format: "der" });
process.env.DISCORD_PUBLIC_KEY = discordDer.subarray(-32).toString("hex");

const { buildServer, pilotReadinessProblem } = await import("../src/server.js");
const { VerificationService } = await import("../src/service.js");

const card: TrustCard = {
  question: "q",
  answer: "a",
  verdict: "trust",
  verdict_rationale: "ok",
  ecs: { total: 0.9, dimensions: {}, notes: [] },
  claims: [],
  red_team: { probes: [], pass_rate: 1, highest_severity: "low" },
  constitution: { rules: [] },
  audit: { log_id: "test", generated_at: "now", inputs_hash: "hash" },
};
const verifier: Verifier = { verify: async () => card };
const app = buildServer(new VerificationService(verifier, 1, 10, 10));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

test.after(() => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test("health reports only fully configured adapters", async () => {
  const response = await fetch(`${base}/health`);
  const body = await response.json() as {
    platforms: string[];
    raw_content_persistence: boolean;
    access: string;
  };
  assert.equal(response.status, 200);
  assert.equal(body.raw_content_persistence, false);
  assert.equal(body.access, "pilot_allowlist");
  assert.deepEqual(body.platforms.sort(), ["api", "discord", "github", "slack", "telegram"].sort());
});

test("Lite readiness succeeds without a paid-model API key", async () => {
  const response = await fetch(`${base}/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ready",
    verifier_backend: "lite",
    external_model_required: false,
  });
});

test("pilot readiness rejects public or concurrent deployment settings", () => {
  const baseSettings = {
    backend: "lite" as const,
    anthropicConfigured: false,
    allowPublic: false,
    maxConcurrency: 1,
    pilotTenantCount: 1,
    platformCount: 1,
  };
  assert.equal(pilotReadinessProblem(baseSettings), undefined);
  assert.match(pilotReadinessProblem({ ...baseSettings, allowPublic: true }) ?? "", /Public access/);
  assert.match(pilotReadinessProblem({ ...baseSettings, maxConcurrency: 2 }) ?? "", /MAX_CONCURRENCY=1/);
  assert.match(pilotReadinessProblem({
    ...baseSettings,
    backend: "anthropic",
  }) ?? "", /ANTHROPIC_API_KEY/);
});

test("universal API requires its bearer secret", async () => {
  const denied = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q", answer: "a" }),
  });
  assert.equal(denied.status, 401);

  const accepted = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: {
      authorization: "Bearer api-test-secret",
      "content-type": "application/json",
      "x-idempotency-key": "api-e2e-test",
    },
    body: JSON.stringify({ question: "q", answer: "a" }),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json() as TrustCard).verdict, "trust");
});

test("Discord accepts a correctly signed ping", async () => {
  const body = JSON.stringify({ type: 1, id: "ping", application_id: "123", token: "token" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign(
    null,
    Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]),
    discordKeys.privateKey,
  ).toString("hex");
  const response = await fetch(`${base}/discord/interactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("Slack rejects a forged request and acknowledges a signed usage error", async () => {
  const body = "text=missing-second-part";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const forged = await fetch(`${base}/slack/commands`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  assert.equal(forged.status, 401);

  const signature = `v0=${crypto.createHmac("sha256", "slack-test-secret")
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  const signed = await fetch(`${base}/slack/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
  assert.equal(signed.status, 200);
  assert.match((await signed.json() as { text: string }).text, /question \|\| answer/);
});

test("Telegram and GitHub enforce their webhook secrets", async () => {
  const telegram = await fetch(`${base}/telegram/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "telegram-test-secret",
    },
    body: JSON.stringify({ update_id: 1 }),
  });
  assert.equal(telegram.status, 200);

  const githubBody = JSON.stringify({ zen: "keep it logically awesome" });
  const githubSignature = `sha256=${crypto.createHmac("sha256", "github-test-secret")
    .update(githubBody)
    .digest("hex")}`;
  const github = await fetch(`${base}/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": githubSignature,
    },
    body: githubBody,
  });
  assert.equal(github.status, 200);
});
