import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import { parseJson, rawBody, safeEqual, sendJson, verifyHmac } from "./http.js";

interface MarketplacePlan {
  id?: unknown;
  price_model?: unknown;
  monthly_price_in_cents?: unknown;
  yearly_price_in_cents?: unknown;
}

interface MarketplacePurchase {
  account?: { id?: unknown };
  plan?: MarketplacePlan;
  on_free_trial?: unknown;
}

interface MarketplacePayload {
  action?: unknown;
  marketplace_purchase?: MarketplacePurchase;
}

export interface MarketplaceAccountState {
  accountId: number;
  planId?: number;
  status: "active" | "cancelled";
}

interface MarketplaceReceipt {
  action: "purchased" | "cancelled" | "ignored";
  status: "active" | "cancelled" | "ignored";
}

const MAX_DELIVERIES = 5_000;
const MAX_ACCOUNTS = 5_000;
const MAX_OAUTH_STATES = 500;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export class GitHubMarketplaceState {
  private readonly deliveries = new Map<string, MarketplaceReceipt>();
  private readonly accounts = new Map<number, MarketplaceAccountState>();

  apply(delivery: string, payload: MarketplacePayload): MarketplaceReceipt & { replayed: boolean } {
    const previous = this.deliveries.get(delivery);
    if (previous) return { ...previous, replayed: true };

    const action = payload.action;
    let receipt: MarketplaceReceipt;
    if (action === "purchased") {
      const purchase = requiredPurchase(payload);
      if (!isFreePlan(purchase)) throw new MarketplaceInputError("Only a free Marketplace plan is supported.");
      const accountId = positiveInteger(purchase.account?.id, "account ID");
      const planId = positiveInteger(purchase.plan?.id, "plan ID");
      this.rememberAccount({ accountId, planId, status: "active" });
      receipt = { action: "purchased", status: "active" };
    } else if (action === "cancelled") {
      const purchase = requiredPurchase(payload);
      const accountId = positiveInteger(purchase.account?.id, "account ID");
      const planId = optionalPositiveInteger(purchase.plan?.id);
      this.rememberAccount({ accountId, planId, status: "cancelled" });
      receipt = { action: "cancelled", status: "cancelled" };
    } else {
      receipt = { action: "ignored", status: "ignored" };
    }

    rememberBounded(this.deliveries, delivery, receipt, MAX_DELIVERIES);
    return { ...receipt, replayed: false };
  }

  provisionFromOAuth(accountId: number, planId: number): void {
    this.rememberAccount({ accountId, planId, status: "active" });
  }

  account(accountId: number): MarketplaceAccountState | undefined {
    const account = this.accounts.get(accountId);
    return account ? { ...account } : undefined;
  }

  private rememberAccount(account: MarketplaceAccountState): void {
    rememberBounded(this.accounts, account.accountId, account, MAX_ACCOUNTS);
  }
}

class MarketplaceInputError extends Error {}

interface OAuthStatePayload {
  issuedAt: number;
  nonce: string;
  planId: number;
}

export class OAuthStateStore {
  private readonly states = new Map<string, number>();

  issue(planId: number, signingSecret: string, now = Date.now()): string {
    this.prune(now);
    const nonce = crypto.randomBytes(24).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ issuedAt: now, nonce, planId })).toString("base64url");
    const signature = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");
    rememberBounded(this.states, nonce, now + OAUTH_STATE_TTL_MS, MAX_OAUTH_STATES);
    return `${payload}.${signature}`;
  }

  consume(state: string, signingSecret: string, now = Date.now()): OAuthStatePayload | undefined {
    this.prune(now);
    const parts = state.split(".");
    if (parts.length !== 2) return undefined;
    const payload = parts[0] ?? "";
    const signature = parts[1] ?? "";
    const expected = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");
    if (!safeEqual(expected, signature)) return undefined;
    try {
      const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
      if (
        typeof value.nonce !== "string" ||
        typeof value.issuedAt !== "number" ||
        typeof value.planId !== "number" ||
        !Number.isSafeInteger(value.planId) ||
        value.planId <= 0 ||
        value.issuedAt > now + 30_000 ||
        now - value.issuedAt > OAUTH_STATE_TTL_MS
      ) return undefined;
      const expiresAt = this.states.get(value.nonce);
      if (!expiresAt || expiresAt < now) return undefined;
      this.states.delete(value.nonce);
      return value as OAuthStatePayload;
    } catch {
      return undefined;
    }
  }

  private prune(now: number): void {
    for (const [state, expiresAt] of this.states) {
      if (expiresAt < now) this.states.delete(state);
    }
  }
}

const marketplaceState = new GitHubMarketplaceState();
const oauthStates = new OAuthStateStore();

interface GitHubMarketplaceRouterOptions {
  fetcher?: typeof fetch;
  state?: GitHubMarketplaceState;
}

export function githubMarketplaceRouter(options: GitHubMarketplaceRouterOptions = {}): Router {
  const router = Router();
  const fetcher = options.fetcher ?? fetch;
  const accountState = options.state ?? marketplaceState;

  router.post("/github/marketplace", (request, response) => {
    let body: Buffer;
    try {
      body = rawBody(request);
    } catch {
      sendJson(response, 400, { error: "Expected a raw request body." });
      return;
    }

    const signature = request.header("x-hub-signature-256") ?? "";
    if (
      !config.github.marketplaceWebhookSecret ||
      !verifyHmac(body, config.github.marketplaceWebhookSecret, signature)
    ) {
      sendJson(response, 401, { error: "Invalid GitHub Marketplace signature." });
      return;
    }
    if (request.header("x-github-event") !== "marketplace_purchase") {
      sendJson(response, 400, { error: "Expected the marketplace_purchase event." });
      return;
    }

    const delivery = request.header("x-github-delivery") ?? "";
    if (!validDeliveryId(delivery)) {
      sendJson(response, 400, { error: "A valid X-GitHub-Delivery header is required." });
      return;
    }

    try {
      const payload = parseJson<MarketplacePayload>(body);
      const result = accountState.apply(delivery, payload);
      sendJson(response, result.action === "ignored" ? 202 : 200, {
        ok: true,
        event: "marketplace_purchase",
        action: result.action,
        status: result.status,
        replayed: result.replayed,
      });
    } catch (error) {
      const message = error instanceof MarketplaceInputError ? error.message : "Invalid Marketplace payload.";
      sendJson(response, 422, { error: message });
    }
  });

  router.get("/github/marketplace/setup", (request, response) => {
    const oauth = marketplaceOAuthConfiguration();
    if (!oauth) {
      sendJson(response, 503, { error: "GitHub Marketplace OAuth is not configured." });
      return;
    }
    const planId = positiveIntegerQuery(request.query.marketplace_listing_plan_id);
    if (!planId) {
      sendJson(response, 400, { error: "A valid Marketplace listing plan ID is required." });
      return;
    }
    const state = oauthStates.issue(planId, oauth.clientSecret);
    const authorization = new URL("https://github.com/login/oauth/authorize");
    authorization.searchParams.set("client_id", oauth.clientId);
    authorization.searchParams.set("redirect_uri", oauth.callbackUrl);
    authorization.searchParams.set("state", state);
    response.redirect(302, authorization.toString());
  });

  router.get("/github/marketplace/callback", async (request, response) => {
    const oauth = marketplaceOAuthConfiguration();
    if (!oauth) {
      sendJson(response, 503, { error: "GitHub Marketplace OAuth is not configured." });
      return;
    }
    const code = singleQueryValue(request.query.code);
    const state = singleQueryValue(request.query.state);
    const verifiedState = state ? oauthStates.consume(state, oauth.clientSecret) : undefined;
    if (!code || !verifiedState) {
      sendJson(response, 400, { error: "Invalid or expired GitHub OAuth callback." });
      return;
    }

    let token: string | undefined;
    try {
      token = await exchangeOAuthCode(fetcher, oauth, code);
      const purchases = await listMarketplacePurchases(fetcher, token);
      const purchase = purchases.find((candidate) =>
        candidate.plan?.id === verifiedState.planId && isFreePlan(candidate)
      );
      if (!purchase) throw new Error("No free Marketplace purchase was found.");
      const accountId = positiveInteger(purchase.account?.id, "account ID");
      const planId = positiveInteger(purchase.plan?.id, "plan ID");
      await revokeOAuthToken(fetcher, oauth, token);
      token = undefined;
      accountState.provisionFromOAuth(accountId, planId);
      response.status(200).type("html").send(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>GlassBox setup complete</title><body><main><h1>GlassBox setup complete</h1><p>Your free GitHub Marketplace plan was verified. GlassBox did not retain the OAuth token or purchase payload. You may close this page.</p></main></body></html>",
      );
    } catch {
      if (token) await revokeOAuthToken(fetcher, oauth, token).catch(() => undefined);
      sendJson(response, 502, { error: "GitHub Marketplace setup could not be completed." });
    }
  });

  return router;
}

function requiredPurchase(payload: MarketplacePayload): MarketplacePurchase {
  if (!payload.marketplace_purchase || typeof payload.marketplace_purchase !== "object") {
    throw new MarketplaceInputError("Marketplace purchase details are required.");
  }
  return payload.marketplace_purchase;
}

function isFreePlan(purchase: MarketplacePurchase): boolean {
  const plan = purchase.plan;
  if (!plan || purchase.on_free_trial === true) return false;
  const priceModel = typeof plan.price_model === "string" ? plan.price_model.toUpperCase() : "";
  const monthly = optionalNonNegativeInteger(plan.monthly_price_in_cents);
  const yearly = optionalNonNegativeInteger(plan.yearly_price_in_cents);
  if (monthly === null || yearly === null) return false;
  const pricesAreZero = (monthly ?? 0) === 0 && (yearly ?? 0) === 0;
  return priceModel === "FREE" && pricesAreZero;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MarketplaceInputError(`A valid ${field} is required.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validDeliveryId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function rememberBounded<K, V>(map: Map<K, V>, key: K, value: V, maximum: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > maximum) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function singleQueryValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 ? value : undefined;
}

function positiveIntegerQuery(value: unknown): number | undefined {
  const text = singleQueryValue(value);
  if (!text || !/^[1-9]\d{0,15}$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

interface MarketplaceOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

function marketplaceOAuthConfiguration(): MarketplaceOAuthConfiguration | undefined {
  if (!config.github.clientId || !config.github.clientSecret || !config.publicBaseUrl) return undefined;
  try {
    const base = new URL(config.publicBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return undefined;
    return {
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
      callbackUrl: new URL("/github/marketplace/callback", base).toString(),
    };
  } catch {
    return undefined;
  }
}

async function exchangeOAuthCode(
  fetcher: typeof fetch,
  oauth: MarketplaceOAuthConfiguration,
  code: string,
): Promise<string> {
  const parameters = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    code,
    redirect_uri: oauth.callbackUrl,
  });
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: parameters.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json() as { access_token?: unknown };
  if (!response.ok || typeof value.access_token !== "string" || value.access_token.length === 0) {
    throw new Error("GitHub OAuth exchange failed.");
  }
  return value.access_token;
}

async function listMarketplacePurchases(fetcher: typeof fetch, token: string): Promise<MarketplacePurchase[]> {
  const response = await fetcher("https://api.github.com/user/marketplace_purchases", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const value: unknown = await response.json();
  if (!response.ok || !Array.isArray(value)) throw new Error("GitHub Marketplace purchase lookup failed.");
  return value.filter((item): item is MarketplacePurchase => Boolean(item) && typeof item === "object");
}

async function revokeOAuthToken(
  fetcher: typeof fetch,
  oauth: MarketplaceOAuthConfiguration,
  token: string,
): Promise<void> {
  const response = await fetcher(
    `https://api.github.com/applications/${encodeURIComponent(oauth.clientId)}/token`,
    {
      method: "DELETE",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64")}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("GitHub OAuth token revocation failed.");
}
