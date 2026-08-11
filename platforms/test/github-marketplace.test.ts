import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

process.env.PUBLIC_BASE_URL = "https://glassbox.example";
process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = "marketplace-test-secret";
process.env.GITHUB_CLIENT_ID = "Iv1.glassbox-test";
process.env.GITHUB_CLIENT_SECRET = "github-oauth-test-secret";

const { GitHubMarketplaceState, OAuthStateStore, githubMarketplaceRouter } = await import(
  "../src/github-marketplace.js"
);

const state = new GitHubMarketplaceState();
const outbound: Array<{ url: string; init?: RequestInit }> = [];
let purchases: unknown[] = [];
const mockFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  outbound.push({ url, init });
  if (url === "https://github.com/login/oauth/access_token") {
    return new Response(JSON.stringify({ access_token: "oauth-sensitive-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://api.github.com/user/marketplace_purchases") {
    return new Response(JSON.stringify(purchases), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://api.github.com/applications/Iv1.glassbox-test/token") {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected outbound request: ${url}`);
};

const app = express();
app.disable("x-powered-by");
app.use(express.raw({ type: "*/*", limit: "128kb" }));
app.use(githubMarketplaceRouter({ fetcher: mockFetch, state }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

test.after(() => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

function signature(body: string): string {
  return `sha256=${crypto.createHmac("sha256", "marketplace-test-secret").update(body).digest("hex")}`;
}

async function postMarketplace(
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/github/marketplace`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function signedHeaders(body: string, delivery = "delivery-1"): Record<string, string> {
  return {
    "x-github-event": "marketplace_purchase",
    "x-github-delivery": delivery,
    "x-hub-signature-256": signature(body),
  };
}

function freePurchase(action: "purchased" | "cancelled", accountId: number, planId: number): string {
  return JSON.stringify({
    action,
    effective_date: "2026-08-11T00:00:00Z",
    marketplace_purchase: {
      account: { id: accountId, login: "private-user", email: "private@example.com" },
      plan: {
        id: planId,
        name: "GlassBox Free",
        price_model: "FREE",
        monthly_price_in_cents: 0,
        yearly_price_in_cents: 0,
      },
      on_free_trial: false,
    },
  });
}

test("Marketplace webhook rejects forgery, wrong events, and missing delivery IDs", async () => {
  const body = freePurchase("purchased", 101, 501);
  assert.equal((await postMarketplace(body)).status, 401);

  const wrongEvent = await postMarketplace(body, {
    ...signedHeaders(body),
    "x-github-event": "issue_comment",
  });
  assert.equal(wrongEvent.status, 400);

  const missingDelivery = signedHeaders(body);
  delete missingDelivery["x-github-delivery"];
  assert.equal((await postMarketplace(body, missingDelivery)).status, 400);
  assert.equal(state.account(101), undefined);
});

test("Marketplace webhook applies free purchases and cancellations idempotently", async () => {
  const purchase = freePurchase("purchased", 102, 502);
  const first = await postMarketplace(purchase, signedHeaders(purchase, "delivery-purchase-102"));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    ok: true,
    event: "marketplace_purchase",
    action: "purchased",
    status: "active",
    replayed: false,
  });
  assert.deepEqual(state.account(102), { accountId: 102, planId: 502, status: "active" });

  const replay = await postMarketplace(purchase, signedHeaders(purchase, "delivery-purchase-102"));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { replayed: boolean }).replayed, true);

  const cancellation = freePurchase("cancelled", 102, 502);
  const cancelled = await postMarketplace(cancellation, signedHeaders(cancellation, "delivery-cancel-102"));
  assert.equal(cancelled.status, 200);
  assert.deepEqual(state.account(102), { accountId: 102, planId: 502, status: "cancelled" });
});

test("Marketplace webhook never activates paid or trial plans", async () => {
  const paid = JSON.stringify({
    action: "purchased",
    marketplace_purchase: {
      account: { id: 103 },
      plan: {
        id: 503,
        price_model: "FLAT_RATE",
        monthly_price_in_cents: 100,
        yearly_price_in_cents: 1_000,
      },
      on_free_trial: false,
    },
  });
  const response = await postMarketplace(paid, signedHeaders(paid, "delivery-paid-103"));
  assert.equal(response.status, 422);
  assert.equal(state.account(103), undefined);

  const trial = JSON.stringify({
    action: "purchased",
    marketplace_purchase: {
      account: { id: 105 },
      plan: {
        id: 505,
        price_model: "FREE",
        monthly_price_in_cents: 0,
        yearly_price_in_cents: 0,
      },
      on_free_trial: true,
    },
  });
  const trialResponse = await postMarketplace(trial, signedHeaders(trial, "delivery-trial-105"));
  assert.equal(trialResponse.status, 422);
  assert.equal(state.account(105), undefined);

  const changed = JSON.stringify({ action: "changed" });
  const ignored = await postMarketplace(changed, signedHeaders(changed, "delivery-changed-103"));
  assert.equal(ignored.status, 202);
  assert.equal((await ignored.json() as { action: string }).action, "ignored");
});

test("Marketplace webhook does not log or echo sensitive payload fields", async () => {
  const captured: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...values: unknown[]) => captured.push(values.join(" "));
  console.warn = (...values: unknown[]) => captured.push(values.join(" "));
  console.error = (...values: unknown[]) => captured.push(values.join(" "));
  try {
    const body = freePurchase("purchased", 104, 504);
    const response = await postMarketplace(body, signedHeaders(body, "delivery-private-104"));
    const rendered = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(rendered, /private-user|private@example\.com|104|504/);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.doesNotMatch(captured.join("\n"), /private-user|private@example\.com|104|504/);
});

test("GitHub setup uses signed one-time state and completes a free-plan OAuth check", async () => {
  assert.equal((await fetch(`${base}/github/marketplace/setup`, { redirect: "manual" })).status, 400);

  const setup = await fetch(`${base}/github/marketplace/setup?marketplace_listing_plan_id=777`, {
    redirect: "manual",
  });
  assert.equal(setup.status, 302);
  const authorization = new URL(setup.headers.get("location") ?? "");
  assert.equal(authorization.origin, "https://github.com");
  assert.equal(authorization.pathname, "/login/oauth/authorize");
  assert.equal(authorization.searchParams.get("client_id"), "Iv1.glassbox-test");
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    "https://glassbox.example/github/marketplace/callback",
  );
  const oauthState = authorization.searchParams.get("state") ?? "";
  assert.match(oauthState, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(oauthState, /github-oauth-test-secret/);

  purchases = [{
    account: { id: 207, login: "private-buyer", email: "buyer@example.com" },
    plan: {
      id: 777,
      name: "GlassBox Free",
      price_model: "FREE",
      monthly_price_in_cents: 0,
      yearly_price_in_cents: 0,
    },
    on_free_trial: false,
  }];
  outbound.length = 0;
  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => captured.push(values.join(" "));
  let callback: Response;
  try {
    callback = await fetch(
      `${base}/github/marketplace/callback?code=temporary-code&state=${encodeURIComponent(oauthState)}`,
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(callback.status, 200);
  const completion = await callback.text();
  assert.match(completion, /setup complete/i);
  assert.match(completion, /did not retain the OAuth token or purchase payload/i);
  assert.doesNotMatch(completion, /oauth-sensitive-token|temporary-code|private-buyer|buyer@example\.com|207|777/);
  assert.deepEqual(state.account(207), { accountId: 207, planId: 777, status: "active" });
  assert.deepEqual(outbound.map((request) => request.url), [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user/marketplace_purchases",
    "https://api.github.com/applications/Iv1.glassbox-test/token",
  ]);
  assert.doesNotMatch(captured.join("\n"), /oauth-sensitive-token|temporary-code|private-buyer|buyer@example\.com/);

  const replay = await fetch(
    `${base}/github/marketplace/callback?code=another-code&state=${encodeURIComponent(oauthState)}`,
  );
  assert.equal(replay.status, 400);
  assert.equal(outbound.length, 3);
});

test("GitHub setup rejects tampered OAuth state before making an outbound call", async () => {
  const setup = await fetch(`${base}/github/marketplace/setup?marketplace_listing_plan_id=778`, {
    redirect: "manual",
  });
  const authorization = new URL(setup.headers.get("location") ?? "");
  const oauthState = authorization.searchParams.get("state") ?? "";
  const final = oauthState.at(-1) === "A" ? "B" : "A";
  const tampered = `${oauthState.slice(0, -1)}${final}`;
  const before = outbound.length;
  const response = await fetch(
    `${base}/github/marketplace/callback?code=temporary-code&state=${encodeURIComponent(tampered)}`,
  );
  assert.equal(response.status, 400);
  assert.equal(outbound.length, before);
});

test("GitHub callback rejects a free purchase for a different selected plan and revokes the token", async () => {
  const setup = await fetch(`${base}/github/marketplace/setup?marketplace_listing_plan_id=780`, {
    redirect: "manual",
  });
  const authorization = new URL(setup.headers.get("location") ?? "");
  const oauthState = authorization.searchParams.get("state") ?? "";
  purchases = [{
    account: { id: 208 },
    plan: {
      id: 999,
      price_model: "FREE",
      monthly_price_in_cents: 0,
      yearly_price_in_cents: 0,
    },
    on_free_trial: false,
  }];
  outbound.length = 0;
  const response = await fetch(
    `${base}/github/marketplace/callback?code=temporary-code&state=${encodeURIComponent(oauthState)}`,
  );
  assert.equal(response.status, 502);
  assert.equal(state.account(208), undefined);
  assert.deepEqual(outbound.map((request) => request.url), [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user/marketplace_purchases",
    "https://api.github.com/applications/Iv1.glassbox-test/token",
  ]);
});

test("GitHub OAuth state expires after ten minutes", () => {
  const states = new OAuthStateStore();
  const issuedAt = Date.parse("2026-08-11T00:00:00Z");
  const oauthState = states.issue(779, "state-test-secret", issuedAt);
  assert.equal(states.consume(oauthState, "state-test-secret", issuedAt + 10 * 60_000 + 1), undefined);
});
