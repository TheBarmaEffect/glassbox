import assert from "node:assert/strict";
import test from "node:test";
import { registerTelegramWebhook } from "../src/telegram-webhook.js";

test("Telegram webhook registration is skipped when Telegram is not configured", async () => {
  let called = false;
  const result = await registerTelegramWebhook({}, async () => {
    called = true;
    return new Response();
  });
  assert.equal(result, "skipped");
  assert.equal(called, false);
});

test("Telegram webhook registration sends the exact webhook contract", async () => {
  let call: { url: string; body: unknown } | undefined;
  const result = await registerTelegramWebhook(
    {
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
      publicBaseUrl: "https://glassbox.example/base/",
    },
    async (input, init) => {
      call = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ ok: true, result: true });
    },
  );
  assert.equal(result, "registered");
  assert.equal(call?.url, "https://api.telegram.org/botbot-token/setWebhook");
  assert.deepEqual(call?.body, {
    url: "https://glassbox.example/base/telegram/webhook",
    secret_token: "webhook-secret",
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
});

test("Telegram webhook registration failures are clear and redact credentials", async () => {
  const settings = {
    botToken: "do-not-log-token",
    webhookSecret: "do-not-log-secret",
    publicBaseUrl: "https://glassbox.example",
  };
  await assert.rejects(
    registerTelegramWebhook(settings, async () => {
      throw new Error("request failed at URL containing do-not-log-token and do-not-log-secret");
    }),
    (error: Error) => {
      assert.match(error.message, /registration request failed/);
      assert.doesNotMatch(error.message, /do-not-log-token|do-not-log-secret/);
      return true;
    },
  );
});

test("partial Telegram credentials fail before startup", async () => {
  await assert.rejects(
    registerTelegramWebhook({ botToken: "token-only" }),
    /missing: TELEGRAM_WEBHOOK_SECRET, PUBLIC_BASE_URL/,
  );
});
