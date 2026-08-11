import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import { formatTrustCard } from "./formatter.js";
import { githubMarketplaceRouter } from "./github-marketplace.js";
import { parseJson, publicError, rawBody, sendJson, verifyHmac } from "./http.js";
import { parseDelimitedCommand } from "./parser.js";
import { DuplicateRequestError, VerificationService } from "./service.js";
import type { VerificationInput } from "./types.js";

interface GitHubPayload {
  action?: string;
  installation?: { id?: number };
  sender?: { id?: number };
  repository?: { full_name?: string };
  comment?: { id?: number; body?: string };
  issue?: { title?: string; body?: string; comments_url?: string };
}

const tokenCache = new Map<number, { token: string; expires: number }>();

export function githubRouter(service: VerificationService): Router {
  const router = Router();
  router.use(githubMarketplaceRouter());
  router.post("/github/webhook", (request, response) => {
    const body = rawBody(request);
    const signature = request.header("x-hub-signature-256") ?? "";
    if (!config.github.webhookSecret || !verifyHmac(body, config.github.webhookSecret, signature)) {
      sendJson(response, 401, { error: "Invalid GitHub signature." });
      return;
    }
    const event = request.header("x-github-event") ?? "";
    const delivery = request.header("x-github-delivery") ?? crypto.randomUUID();
    const payload = parseJson<GitHubPayload>(body);
    if (event === "ping") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (event !== "issue_comment" || payload.action !== "created") {
      sendJson(response, 202, { ignored: true });
      return;
    }
    const command = payload.comment?.body?.trim() ?? "";
    if (!/^\/glassbox\b/i.test(command)) {
      sendJson(response, 202, { ignored: true });
      return;
    }
    sendJson(response, 202, { accepted: true });
    void handleIssueComment(payload, command, delivery, service);
  });
  return router;
}

async function handleIssueComment(
  payload: GitHubPayload,
  command: string,
  delivery: string,
  service: VerificationService,
): Promise<void> {
  const commentsUrl = payload.issue?.comments_url;
  if (!commentsUrl) return;
  const eventKey = `github:${delivery}`;
  let verificationComplete = false;
  try {
    const input = githubInput(payload, command);
    const card = await service.run(input, {
      idempotencyKey: eventKey,
      rateKey: `github:${payload.repository?.full_name}:${payload.sender?.id ?? "unknown"}`,
      tenantKey: `github:${payload.repository?.full_name}`,
    });
    verificationComplete = true;
    await postGitHubComment(commentsUrl, payload.installation?.id, formatTrustCard(card, 5_500));
    service.markDelivered(eventKey);
  } catch (error) {
    if (verificationComplete) service.markDeliveryFailed(eventKey);
    if (error instanceof DuplicateRequestError) return;
    const reason = error instanceof Error ? error.message : "Unknown GitHub delivery failure.";
    console.error(`GitHub delivery ${delivery} failed: ${reason}`);
    await postGitHubComment(
      commentsUrl,
      payload.installation?.id,
      `⚠️ ${publicError(error)}\n\nUsage: \`/glassbox question || answer || optional intent 1; intent 2\`. With no arguments, GlassBox audits the issue or PR description using its title as context.`,
    ).catch(() => undefined);
  }
}

function githubInput(payload: GitHubPayload, command: string): VerificationInput {
  const rest = command.replace(/^\/glassbox\s*/i, "").trim();
  if (rest.includes("||")) return parseDelimitedCommand(rest, "github");
  return {
    platform: "github",
    question: payload.issue?.title ?? "Audit this issue or pull request description.",
    answer: payload.issue?.body ?? "",
  };
}

async function postGitHubComment(url: string, installationId: number | undefined, body: string): Promise<void> {
  if (!isGitHubCommentsUrl(url)) throw new Error("Invalid GitHub comments URL.");
  const token = await githubToken(installationId);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(`GitHub comment failed (${response.status}).`);
}

export function isGitHubCommentsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "api.github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url.pathname) &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

async function githubToken(installationId: number | undefined): Promise<string> {
  const authMode = selectGitHubAuthMode(config.github);
  if (authMode === "token") {
    if (config.github.token) return config.github.token;
  }
  if (authMode === "none") throw new Error("GitHub credentials are not configured.");
  if (!installationId || !config.github.appId || !config.github.privateKey) {
    throw new Error("GitHub webhook is missing an installation ID.");
  }
  const cached = tokenCache.get(installationId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const jwt = githubJwt(config.github.appId, config.github.privateKey);
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  const value = await response.json() as { token?: string; expires_at?: string; message?: string };
  if (!response.ok || !value.token) {
    throw new Error(`GitHub installation token failed: ${value.message ?? response.status}`);
  }
  const expires = Date.parse(value.expires_at ?? "") || Date.now() + 50 * 60_000;
  tokenCache.set(installationId, { token: value.token, expires });
  return value.token;
}

export function selectGitHubAuthMode(credentials: {
  appId?: string;
  privateKey?: string;
  token?: string;
}): "app" | "token" | "none" {
  if (credentials.appId && credentials.privateKey) return "app";
  if (credentials.token) return "token";
  return "none";
}

function githubJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
