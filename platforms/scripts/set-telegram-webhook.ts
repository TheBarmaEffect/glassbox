import "dotenv/config";
import { registerTelegramWebhook } from "../src/telegram-webhook.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
if (!token || !secret || !baseUrl) {
  throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and PUBLIC_BASE_URL first.");
}

await registerTelegramWebhook({ botToken: token, webhookSecret: secret, publicBaseUrl: baseUrl });
console.log("Telegram webhook registered.");
