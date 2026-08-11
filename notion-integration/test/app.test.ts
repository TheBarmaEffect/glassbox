import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { StaticTokenStore } from "../src/store.js";
import type { AuditInput, GlassboxClient, NotionClient, NotionComment } from "../src/types.js";

const webhookToken = ["secret", "webhook-verification-token-123"].join("_");
const baseConfig: AppConfig = {
  port: 8787,
  publicBaseUrl: "http://localhost:8787",
  glassboxMcpUrl: "https://glassbox-platform-gateway.onrender.com/mcp",
  notionAccessToken: "notion-access-token",
  webhookVerificationToken: webhookToken,
  setupAdminSecret: "setup-admin-secret",
};

async function withServer(
  comment: NotionComment,
  callback: (base: string, calls: { audits: AuditInput[]; replies: string[]; retrieves: number }) => Promise<void>,
): Promise<void> {
  const calls = { audits: [] as AuditInput[], replies: [] as string[], retrieves: 0 };
  const notion: NotionClient = {
    async retrieveComment() {
      calls.retrieves += 1;
      return comment;
    },
    async replyToDiscussion(_token, _discussion, text) {
      calls.replies.push(text);
    },
  };
  const glassbox: GlassboxClient = {
    async audit(input) {
      calls.audits.push(input);
      return {
        verdict: "reject",
        summary: "A supported arithmetic expression failed.",
        score: 0.2,
        claim_count: 1,
        finding_count: 1,
        highest_severity: "high",
        findings: [{ angle: "arithmetic_sanity", severity: "high", summary: "Mismatch" }],
        caveats: [],
      };
    },
  };
  const handler = createApp({
    config: baseConfig,
    tokens: new StaticTokenStore("notion-access-token"),
    notion,
    glassbox,
  });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address.");
    await callback(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function signed(body: string): string {
  return `sha256=${createHmac("sha256", webhookToken).update(body).digest("hex")}`;
}

function event(id = "event-1"): string {
  return JSON.stringify({
    id,
    workspace_id: "workspace-1",
    type: "comment.created",
    entity: { id: "comment-1", type: "comment" },
  });
}

test("a signed explicit command invokes MCP and replies to the same discussion", async () => {
  await withServer(
    {
      id: "comment-1",
      discussion_id: "discussion-1",
      created_by: { type: "person" },
      rich_text: [{ plain_text: "/glassbox What is 17 * 6? || 17 * 6 = 112" }],
    },
    async (base, calls) => {
      const body = event();
      const response = await fetch(`${base}/webhooks/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Notion-Signature": signed(body) },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal(calls.audits.length, 1);
      assert.equal(calls.replies.length, 1);
      assert.match(calls.replies[0] ?? "", /REJECT/);
      assert.doesNotMatch(calls.replies[0] ?? "", /17 \* 6/);
    },
  );
});

test("invalid signatures and ordinary comments never invoke GlassBox", async () => {
  await withServer(
    {
      id: "comment-1",
      discussion_id: "discussion-1",
      created_by: { type: "person" },
      rich_text: [{ plain_text: "Please review this ordinary comment." }],
    },
    async (base, calls) => {
      const body = event();
      const denied = await fetch(`${base}/webhooks/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Notion-Signature": "sha256=wrong" },
        body,
      });
      assert.equal(denied.status, 401);
      assert.equal(calls.retrieves, 0);

      const ignored = await fetch(`${base}/webhooks/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Notion-Signature": signed(body) },
        body,
      });
      assert.equal(ignored.status, 200);
      assert.equal(calls.audits.length, 0);
      assert.equal(calls.replies.length, 0);
    },
  );
});

test("bot-authored comments are ignored to prevent loops", async () => {
  await withServer(
    {
      id: "comment-1",
      discussion_id: "discussion-1",
      created_by: { type: "bot" },
      rich_text: [{ plain_text: "/glassbox q || a" }],
    },
    async (base, calls) => {
      const body = event();
      const response = await fetch(`${base}/webhooks/notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Notion-Signature": signed(body) },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal(calls.audits.length, 0);
      assert.equal(calls.replies.length, 0);
    },
  );
});
