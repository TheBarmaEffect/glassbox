import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { formatAuditResult, parseGlassboxCommand } from "./command.js";
import type { AppConfig } from "./config.js";
import { exchangeOauthCode } from "./notion.js";
import {
  parseCookies,
  VerificationTokenCapture,
  verifyBearer,
  verifyNotionSignature,
  verifyOauthState,
} from "./security.js";
import { EventLedger } from "./store.js";
import type { GlassboxClient, NotionClient, TokenStore } from "./types.js";

const MAX_BODY_BYTES = 256 * 1024;
const OAUTH_STATE_COOKIE = "glassbox_notion_oauth_state";

type ExchangeCode = typeof exchangeOauthCode;

export interface AppDependencies {
  config: AppConfig;
  tokens: TokenStore;
  notion: NotionClient;
  glassbox: GlassboxClient;
  ledger?: EventLedger;
  verificationCapture?: VerificationTokenCapture;
  exchangeCode?: ExchangeCode;
}

interface NotionWebhookEvent {
  id: string;
  type: string;
  workspace_id: string;
  entity?: { id?: string; type?: string };
}

function json(response: ServerResponse, status: number, body: object): void {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(value);
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function rawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function parseJson<T>(body: Buffer): T {
  const value = JSON.parse(body.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as T;
}

function commentText(comment: { rich_text?: Array<{ plain_text?: string }> }): string {
  return (comment.rich_text ?? []).map((part) => part.plain_text ?? "").join("");
}

function oauthReady(config: AppConfig): config is AppConfig & {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
} {
  return !!config.oauthClientId && !!config.oauthClientSecret && !!config.oauthRedirectUri;
}

function authorizationUrl(config: AppConfig, state: string): URL {
  const url = new URL(
    config.oauthAuthorizationUrl ?? "https://api.notion.com/v1/oauth/authorize",
  );
  if (url.protocol !== "https:" || url.hostname !== "api.notion.com") {
    throw new Error("Notion OAuth authorization URL must use https://api.notion.com.");
  }
  url.searchParams.set("client_id", config.oauthClientId ?? "");
  url.searchParams.set("redirect_uri", config.oauthRedirectUri ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("state", state);
  return url;
}

export function createApp(dependencies: AppDependencies) {
  const ledger = dependencies.ledger ?? new EventLedger();
  const verificationCapture =
    dependencies.verificationCapture ?? new VerificationTokenCapture();
  const exchangeCode = dependencies.exchangeCode ?? exchangeOauthCode;

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", dependencies.config.publicBaseUrl);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          ok: true,
          notion_api_version: "2026-03-11",
          oauth_enabled: oauthReady(dependencies.config),
          raw_content_persisted: false,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/oauth/start") {
        if (!oauthReady(dependencies.config)) {
          json(response, 404, { error: "Public OAuth is not configured." });
          return;
        }
        const state = randomBytes(32).toString("base64url");
        response.writeHead(302, {
          "Cache-Control": "no-store",
          Location: authorizationUrl(dependencies.config, state).toString(),
          "Set-Cookie": `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; Max-Age=600; Path=/oauth/callback; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`,
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/oauth/callback") {
        if (!oauthReady(dependencies.config)) {
          json(response, 404, { error: "Public OAuth is not configured." });
          return;
        }
        const state = url.searchParams.get("state") ?? undefined;
        const code = url.searchParams.get("code") ?? undefined;
        const cookieState = parseCookies(request.headers.cookie)[OAUTH_STATE_COOKIE];
        if (!code || !verifyOauthState(state, cookieState)) {
          json(response, 400, { error: "Invalid or missing OAuth state/code." });
          return;
        }
        const token = await exchangeCode({
          clientId: dependencies.config.oauthClientId,
          clientSecret: dependencies.config.oauthClientSecret,
          redirectUri: dependencies.config.oauthRedirectUri,
          code,
        });
        await dependencies.tokens.put(token);
        response.setHeader(
          "Set-Cookie",
          `${OAUTH_STATE_COOKIE}=; HttpOnly; Max-Age=0; Path=/oauth/callback; SameSite=Lax`,
        );
        html(
          response,
          200,
          "<!doctype html><meta charset=utf-8><title>GlassBox connected</title><style>body{font:16px system-ui;max-width:42rem;margin:4rem auto;padding:1rem}</style><h1>GlassBox is connected</h1><p>You can close this window. Add <code>/glassbox question || answer</code> as a comment on content shared with the connection.</p>",
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/admin/notion-webhook-token") {
        const adminSecret = dependencies.config.setupAdminSecret;
        if (!adminSecret || !verifyBearer(request.headers.authorization, adminSecret)) {
          json(response, 401, { error: "Unauthorized." });
          return;
        }
        const token = verificationCapture.take();
        if (!token) {
          json(response, 404, { error: "No verification token is waiting; ask Notion to resend it." });
          return;
        }
        json(response, 200, { verification_token: token });
        return;
      }

      if (request.method === "POST" && url.pathname === "/webhooks/notion") {
        const body = await rawBody(request);
        const value = parseJson<Record<string, unknown>>(body);
        if (typeof value.verification_token === "string") {
          if (!dependencies.config.setupAdminSecret) {
            json(response, 503, { error: "Webhook setup mode is not enabled." });
            return;
          }
          verificationCapture.capture(value.verification_token);
          json(response, 200, { ok: true, verification_received: true });
          return;
        }

        const webhookToken = dependencies.config.webhookVerificationToken;
        if (
          !webhookToken ||
          !verifyNotionSignature(
            body,
            request.headers["x-notion-signature"] as string | undefined,
            webhookToken,
          )
        ) {
          json(response, 401, { error: "Invalid webhook signature." });
          return;
        }

        const event = value as unknown as NotionWebhookEvent;
        if (!event.id || !event.workspace_id || !event.type) {
          json(response, 400, { error: "Invalid webhook event." });
          return;
        }
        if (event.type !== "comment.created") {
          json(response, 200, { ok: true, ignored: true });
          return;
        }
        if (!event.entity?.id || event.entity.type !== "comment") {
          json(response, 400, { error: "comment.created event has no comment entity." });
          return;
        }
        if (!ledger.claim(event.id)) {
          json(response, 200, { ok: true, duplicate: true });
          return;
        }

        try {
          const token = await dependencies.tokens.get(event.workspace_id);
          if (!token) throw new Error("No OAuth installation token for the event workspace.");
          const comment = await dependencies.notion.retrieveComment(
            token.accessToken,
            event.entity.id,
          );
          if (comment.created_by?.type === "bot" || comment.created_by?.object === "bot") {
            ledger.delivered(event.id);
            json(response, 200, { ok: true, ignored: true });
            return;
          }

          let command;
          try {
            command = parseGlassboxCommand(commentText(comment));
          } catch (error) {
            await dependencies.notion.replyToDiscussion(
              token.accessToken,
              comment.discussion_id,
              error instanceof Error ? error.message : "Invalid /glassbox command.",
            );
            ledger.delivered(event.id);
            json(response, 200, { ok: true, usage_error: true });
            return;
          }
          if (!command) {
            ledger.delivered(event.id);
            json(response, 200, { ok: true, ignored: true });
            return;
          }

          const audit = await dependencies.glassbox.audit(command);
          await dependencies.notion.replyToDiscussion(
            token.accessToken,
            comment.discussion_id,
            formatAuditResult(audit),
          );
          ledger.delivered(event.id);
          json(response, 200, { ok: true, audited: true });
          return;
        } catch {
          ledger.release(event.id);
          json(response, 503, { error: "Audit delivery failed; Notion may retry the event." });
          return;
        }
      }

      json(response, 404, { error: "Not found." });
    } catch {
      if (!response.headersSent) json(response, 400, { error: "Invalid request." });
      else response.end();
    }
  };
}
