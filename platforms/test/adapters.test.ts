import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TrustCard, VerificationInput, Verifier } from "../src/types.js";

process.env.PLATFORM_SHARED_SECRET = "api-test-secret";
process.env.OPENAI_APPS_CHALLENGE_TOKEN = "openai-challenge-token";
process.env.PLATFORM_ALLOW_PUBLIC = "false";
process.env.PLATFORM_PUBLIC_PLATFORMS = "discord,telegram,mcp";
process.env.PILOT_TENANT_ALLOWLIST = "api,mcp:public";
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
let lastVerificationInput: VerificationInput | undefined;
const verifier: Verifier = { verify: async (input) => { lastVerificationInput = input; return card; } };
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
    public_platforms: string[];
    raw_content_persistence: boolean;
    access: string;
  };
  assert.equal(response.status, 200);
  assert.equal(body.raw_content_persistence, false);
  assert.equal(body.access, "mixed");
  assert.deepEqual(body.public_platforms, ["discord", "telegram", "mcp"]);
  assert.deepEqual(body.platforms.sort(), ["api", "discord", "github", "mcp", "slack", "telegram"].sort());
});

test("capability contract exposes checks and enforcement boundaries", async () => {
  const response = await fetch(`${base}/api/v1/capabilities`);
  const body = await response.json() as {
    deterministic_probes: string[];
    checkpoints: string[];
    response_is_enforced_by_gateway: boolean;
    external_fact_verification: boolean;
  };
  assert.equal(response.status, 200);
  assert.ok(body.deterministic_probes.includes("credential_exposure"));
  assert.ok(body.deterministic_probes.includes("unsupported_specificity"));
  assert.ok(body.checkpoints.includes("tool_call"));
  assert.equal(body.response_is_enforced_by_gateway, false);
  assert.equal(body.external_fact_verification, false);
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

test("OpenAI plugin review challenge returns only the configured token", async () => {
  const response = await fetch(`${base}/.well-known/openai-apps-challenge`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await response.text(), "openai-challenge-token");
});

test("public web app and install manifest expose the zero-secret MCP client", async () => {
  const appResponse = await fetch(`${base}/app`);
  assert.equal(appResponse.status, 200);
  assert.match(appResponse.headers.get("content-type") ?? "", /^text\/html/);
  const html = await appResponse.text();
  assert.match(html, /glassbox_verify_answer/);
  assert.match(html, /fetch\("\/mcp"/);
  assert.doesNotMatch(html, /PLATFORM_SHARED_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY/);

  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json() as { name: string; start_url: string };
  assert.equal(manifest.name, "GlassBox Lite");
  assert.equal(manifest.start_url, "/app");
});

test("pilot readiness rejects public or concurrent deployment settings", () => {
  const baseSettings = {
    backend: "lite" as const,
    anthropicConfigured: false,
    allowPublic: false,
    publicPlatformCount: 0,
    maxConcurrency: 1,
    pilotTenantCount: 1,
    platformCount: 1,
  };
  assert.equal(pilotReadinessProblem(baseSettings), undefined);
  assert.equal(pilotReadinessProblem({
    ...baseSettings,
    pilotTenantCount: 0,
    publicPlatformCount: 3,
  }), undefined);
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

test("universal API preserves governance fields and rejects malformed bodies", async () => {
  const governed = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { authorization: "Bearer api-test-secret", "content-type": "application/json", "x-idempotency-key": "api-governance-test" },
    body: JSON.stringify({
      question: "May this proceed?", answer: "Use human approval.",
      checkpoint: { id: "tool-1", type: "tool_call", target: "payments.submit" },
      constitution: { version: "payments/1", rules: [{ id: "approval", requirement: "Require approval", kind: "require_phrase", value: "human approval", severity: "critical" }] },
      response_policy: { reject: "block" },
    }),
  });
  assert.equal(governed.status, 200);
  assert.equal(lastVerificationInput?.checkpoint?.type, "tool_call");
  assert.equal(lastVerificationInput?.constitution?.version, "payments/1");
  assert.equal(lastVerificationInput?.response_policy?.reject, "block");

  const malformed = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { authorization: "Bearer api-test-secret", "content-type": "application/json" },
    body: "null",
  });
  assert.equal(malformed.status, 400);

  const malformedRule = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { authorization: "Bearer api-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ question: "q", answer: "a", constitution: { version: "v1", rules: [null] } }),
  });
  assert.equal(malformedRule.status, 400);
});

test("public Streamable HTTP MCP lists and calls the zero-cost verifier", async () => {
  const client = new Client({ name: "glassbox-gateway-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const verify = tools.tools.find((tool) => tool.name === "glassbox_verify_answer");
    assert.ok(verify);
    assert.equal(verify.annotations?.readOnlyHint, true);
    assert.equal(verify.annotations?.destructiveHint, false);

    const result = await client.callTool({
      name: "glassbox_verify_answer",
      arguments: { question: "q", answer: "a" },
    });
    assert.equal(result.isError, undefined);
    const content = Array.isArray(result.content)
      ? result.content as Array<{ type: string; text?: string }>
      : [];
    const text = content.find((item) => item.type === "text");
    assert.equal(text?.type, "text");
    assert.equal(JSON.parse(text?.type === "text" ? text.text ?? "{}" : "{}").verdict, "trust");
  } finally {
    await client.close();
  }
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
