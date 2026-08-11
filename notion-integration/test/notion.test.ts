import assert from "node:assert/strict";
import test from "node:test";
import { exchangeOauthCode, RestNotionClient } from "../src/notion.js";

test("Notion REST requests pin 2026-03-11 and keep the token in Authorization", async () => {
  const seen: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push(new Request(input, init));
    return Response.json({
      id: "comment-1",
      discussion_id: "discussion-1",
      rich_text: [{ plain_text: "/glassbox q || a" }],
    });
  };
  const client = new RestNotionClient(fetchImpl);
  await client.retrieveComment("secret-token", "comment-1");
  assert.equal(seen[0]?.headers.get("notion-version"), "2026-03-11");
  assert.equal(seen[0]?.headers.get("authorization"), "Bearer secret-token");
  assert.equal(seen[0]?.url.includes("secret-token"), false);
});

test("OAuth exchange uses Basic auth and returns a storable workspace token", async () => {
  let request: Request | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return Response.json({
      access_token: "oauth-access",
      bot_id: "bot-1",
      workspace_id: "workspace-1",
      workspace_name: "Example",
    });
  };
  const record = await exchangeOauthCode({
    clientId: "client-id",
    clientSecret: "client-secret",
    code: "one-time-code",
    redirectUri: "https://example.com/oauth/callback",
    fetchImpl,
  });
  assert.equal(record.workspaceId, "workspace-1");
  assert.equal(record.accessToken, "oauth-access");
  assert.equal(
    request?.headers.get("authorization"),
    `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
  );
  assert.equal((await request?.text())?.includes("client-secret"), false);
});
