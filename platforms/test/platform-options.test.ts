import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicPlatforms } from "../src/config.js";
import { isGitHubCommentsUrl, selectGitHubAuthMode } from "../src/github.js";
import { deliverShortcutResult, extractSlackVisibility } from "../src/slack.js";
import {
  consentNotice,
  disabledLinkPreview,
  extractTelegramConsent,
  telegramReplyParameters,
} from "../src/telegram.js";

test("Slack publishes only when --public is the first argument", () => {
  assert.deepEqual(
    extractSlackVisibility(" --public question || answer"),
    { isPublic: true, text: "question || answer" },
  );
  assert.deepEqual(
    extractSlackVisibility("question || answer mentions --public"),
    { isPublic: false, text: "question || answer mentions --public" },
  );
});

test("Slack shortcut delivery uses the interaction response URL without a bot token", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; body?: string; authorization?: string } | undefined;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    request = {
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
      authorization: headers.get("authorization") ?? undefined,
    };
    return new Response("ok", { status: 200 });
  };
  try {
    await deliverShortcutResult(
      { responseUrl: "https://hooks.slack.com/actions/test/response" },
      "Trust Card",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.url, "https://hooks.slack.com/actions/test/response");
  assert.equal(request?.authorization, undefined);
  assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
    response_type: "ephemeral",
    text: "Trust Card",
  });
});

test("Telegram accepts consent only as the leading per-audit flag", () => {
  assert.deepEqual(
    extractTelegramConsent(" --consent question || answer"),
    { consented: true, text: "question || answer" },
  );
  assert.deepEqual(
    extractTelegramConsent("question || answer says --consent"),
    { consented: false, text: "question || answer says --consent" },
  );
  assert.match(consentNotice(), /GlassBox Lite/);
  assert.match(consentNotice(), /no paid model call/);
  assert.match(consentNotice(), /one audit/);
  assert.match(consentNotice(), /\/privacy/);
  assert.match(consentNotice(-100123), /Pilot access key: telegram:-100123/);
});

test("Telegram requests use current reply and link-preview fields", () => {
  assert.deepEqual(telegramReplyParameters(42), {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  assert.deepEqual(disabledLinkPreview(), { is_disabled: true });
});

test("GitHub App credentials take precedence over a fallback token", () => {
  assert.equal(selectGitHubAuthMode({ appId: "1", privateKey: "key", token: "pat" }), "app");
  assert.equal(selectGitHubAuthMode({ token: "pat" }), "token");
  assert.equal(selectGitHubAuthMode({ appId: "1", token: "pat" }), "token");
  assert.equal(selectGitHubAuthMode({}), "none");
});

test("GitHub comments URL is restricted to the canonical API endpoint", () => {
  assert.equal(isGitHubCommentsUrl("https://api.github.com/repos/openai/example/issues/42/comments"), true);
  assert.equal(isGitHubCommentsUrl("https://api.github.com.evil.test/repos/openai/example/issues/42/comments"), false);
  assert.equal(isGitHubCommentsUrl("https://api.github.com/repos/openai/example/issues/42/comments?redirect=1"), false);
  assert.equal(isGitHubCommentsUrl("https://api.github.com/repos/openai/example/issues/not-a-number/comments"), false);
});

test("public platform configuration accepts only known platform names", () => {
  assert.deepEqual([...parsePublicPlatforms(" Discord,telegram,mcp,discord ")], ["discord", "telegram", "mcp"]);
  assert.throws(() => parsePublicPlatforms("telegram,unknown"), /unsupported values: unknown/);
});
