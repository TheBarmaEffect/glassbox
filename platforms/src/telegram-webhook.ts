export interface TelegramWebhookRegistrationSettings {
  botToken?: string;
  webhookSecret?: string;
  publicBaseUrl?: string;
}

export type TelegramWebhookRegistrationResult = "registered" | "skipped";

export async function registerTelegramWebhook(
  settings: TelegramWebhookRegistrationSettings,
  request: typeof fetch = fetch,
): Promise<TelegramWebhookRegistrationResult> {
  const { botToken, webhookSecret, publicBaseUrl } = settings;
  if (!botToken && !webhookSecret) return "skipped";
  if (!botToken || !webhookSecret || !publicBaseUrl) {
    throw new Error(
      "Telegram webhook registration requires TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and PUBLIC_BASE_URL.",
    );
  }

  let webhookUrl: string;
  try {
    const base = new URL(publicBaseUrl);
    if (base.protocol !== "https:") throw new Error("HTTPS required");
    webhookUrl = new URL("telegram/webhook", `${base.href.replace(/\/+$/, "")}/`).href;
  } catch {
    throw new Error("Telegram webhook registration requires a valid HTTPS PUBLIC_BASE_URL.");
  }

  let response: Response;
  try {
    response = await request(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      }),
    });
  } catch {
    throw new Error("Telegram webhook registration request failed; the adapter was not enabled.");
  }

  let result: { ok?: boolean; result?: boolean };
  try {
    result = await response.json() as { ok?: boolean; result?: boolean };
  } catch {
    throw new Error(`Telegram webhook registration returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || !result.ok || result.result !== true) {
    throw new Error(`Telegram webhook registration failed (HTTP ${response.status}); the adapter was not enabled.`);
  }
  return "registered";
}
