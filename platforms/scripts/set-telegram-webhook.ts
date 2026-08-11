import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
if (!token || !secret || !baseUrl) {
  throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and PUBLIC_BASE_URL first.");
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${baseUrl}/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(`Telegram webhook setup failed (${response.status}): ${JSON.stringify(result)}`);
console.log(JSON.stringify(result, null, 2));
