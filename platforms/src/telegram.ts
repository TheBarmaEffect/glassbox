import { Router } from "express";
import { config } from "./config.js";
import { formatPlainTrustCard } from "./formatter.js";
import { parseJson, publicError, rawBody, safeEqual, sendJson } from "./http.js";
import { InputError, parseDelimitedCommand } from "./parser.js";
import { DuplicateRequestError, VerificationService } from "./service.js";
import type { VerificationInput } from "./types.js";

interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: { id: number };
  from?: { id: number };
  reply_to_message?: TelegramMessage;
}
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export function telegramRouter(service: VerificationService): Router {
  const router = Router();
  router.post("/telegram/webhook", (request, response) => {
    const received = request.header("x-telegram-bot-api-secret-token") ?? "";
    if (!config.telegram.webhookSecret || !safeEqual(received, config.telegram.webhookSecret)) {
      sendJson(response, 401, { error: "Invalid Telegram webhook secret." });
      return;
    }
    const update = parseJson<TelegramUpdate>(rawBody(request));
    response.status(200).send("");
    const message = update.message;
    if (message && /^\/(?:start|privacy)(?:@[\w_]+)?\b/i.test(message.text ?? "")) {
      void telegramApi("sendMessage", {
        chat_id: message.chat.id,
        text: consentNotice(),
        link_preview_options: disabledLinkPreview(),
      }).catch(() => undefined);
      return;
    }
    if (!message || !/^\/(?:glassbox|analyze)(?:@[\w_]+)?\b/i.test(message.text ?? "")) return;

    void handleTelegram(update, message, service);
  });
  return router;
}

async function handleTelegram(
  update: TelegramUpdate,
  message: TelegramMessage,
  service: VerificationService,
): Promise<void> {
  const chatId = message.chat.id;
  const eventKey = `telegram:${update.update_id}`;
  let pendingMessageId: number | undefined;
  let verificationComplete = false;
  try {
    const input = telegramInput(message);
    const pending = await telegramApi<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: "⏳ GlassBox is auditing that answer…",
      reply_parameters: telegramReplyParameters(message.message_id),
    });
    pendingMessageId = pending.message_id;
    const card = await service.run(input, {
      idempotencyKey: eventKey,
      rateKey: `telegram:${chatId}:${message.from?.id ?? "unknown"}`,
      tenantKey: `telegram:${chatId}`,
    });
    verificationComplete = true;
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: pending.message_id,
      text: formatPlainTrustCard(card, 3_800),
      link_preview_options: disabledLinkPreview(),
    });
    service.markDelivered(eventKey);
  } catch (error) {
    if (verificationComplete) service.markDeliveryFailed(eventKey);
    const text = error instanceof DuplicateRequestError
      ? "This request was already processed."
      : `⚠️ ${publicError(error)}\n\nReply to an answer with /glassbox --consent <original question>, or use /glassbox --consent question || answer.`;
    const action = pendingMessageId
      ? telegramApi("editMessageText", { chat_id: chatId, message_id: pendingMessageId, text })
      : telegramApi("sendMessage", {
          chat_id: chatId,
          text,
          reply_parameters: telegramReplyParameters(message.message_id),
        });
    await action.catch(() => undefined);
  }
}

function telegramInput(message: TelegramMessage): VerificationInput {
  const raw = (message.text ?? "").replace(/^\/(?:glassbox|analyze)(?:@[\w_]+)?\s*/i, "").trim();
  const consent = extractTelegramConsent(raw);
  if (!consent.consented) {
    throw new InputError("Consent required: add --consent after /glassbox to confirm the selected text may be processed for this audit.");
  }
  const commandText = consent.text;
  const repliedText = message.reply_to_message?.text ?? message.reply_to_message?.caption;
  if (repliedText) {
    return {
      platform: "telegram",
      question: commandText || "Audit the replied-to message's reasoning and evidentiary support.",
      answer: repliedText,
    };
  }
  return parseDelimitedCommand(commandText, "telegram");
}

export function extractTelegramConsent(rawText: string): { consented: boolean; text: string } {
  const prefix = rawText.match(/^\s*--consent(?:\s+|$)/i);
  if (!prefix) return { consented: false, text: rawText };
  return { consented: true, text: rawText.slice(prefix[0].length).trim() };
}

export function consentNotice(): string {
  return [
    "GlassBox audits reasoning in text you explicitly submit.",
    "",
    config.verifierBackend === "anthropic"
      ? "This deployment explicitly uses Anthropic for audits. The gateway does not persist the raw text."
      : "This deployment uses the deterministic GlassBox Lite engine. It makes no paid model call, does not browse the web, and the gateway does not persist the raw text.",
    "",
    "To consent for one audit, reply to an answer with:",
    "/glassbox --consent <original question>",
    "",
    `Privacy: ${config.publicBaseUrl ? `${config.publicBaseUrl}/privacy` : "/privacy"}`,
  ].join("\n");
}

export function telegramReplyParameters(messageId: number): {
  message_id: number;
  allow_sending_without_reply: true;
} {
  return { message_id: messageId, allow_sending_without_reply: true };
}

export function disabledLinkPreview(): { is_disabled: true } {
  return { is_disabled: true };
}

async function telegramApi<T = unknown>(method: string, body: unknown): Promise<T> {
  if (!config.telegram.botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? response.status}`);
  }
  return result.result;
}
