import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import { formatTrustCard } from "./formatter.js";
import { parseJson, publicError, rawBody, sendJson } from "./http.js";
import { parseIntentList } from "./parser.js";
import { DuplicateRequestError, VerificationService } from "./service.js";
import type { VerificationInput } from "./types.js";

interface DiscordOption { name: string; value: string | boolean }
interface DiscordMessage {
  content?: string;
  referenced_message?: { content?: string };
}
interface DiscordInteraction {
  id: string;
  application_id: string;
  token: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: {
    name?: string;
    type?: number;
    target_id?: string;
    options?: DiscordOption[];
    resolved?: { messages?: Record<string, DiscordMessage> };
  };
}

export const DISCORD_DELIVERY_DEADLINE_MS = 14 * 60_000;

export class DeliveryDeadlineError extends Error {}

export function discordRouter(service: VerificationService): Router {
  const router = Router();
  router.post("/discord/interactions", (request, response) => {
    const body = rawBody(request);
    const signature = request.header("x-signature-ed25519") ?? "";
    const timestamp = request.header("x-signature-timestamp") ?? "";
    if (!config.discord.publicKey || !verifyDiscord(body, signature, timestamp, config.discord.publicKey)) {
      sendJson(response, 401, { error: "Invalid Discord signature." });
      return;
    }

    const interaction = parseJson<DiscordInteraction>(body);
    if (interaction.type === 1) {
      sendJson(response, 200, { type: 1 });
      return;
    }
    if (interaction.type !== 2 || !interaction.data) {
      sendJson(response, 400, { error: "Unsupported Discord interaction." });
      return;
    }

    try {
      const parsed = discordInput(interaction);
      const isPublic = option(interaction, "public") === true;
      const eventKey = `discord:${interaction.id}`;
      sendJson(response, 200, { type: 5, data: { flags: isPublic ? 0 : 64 } });
      const audit = service.run(parsed, {
        idempotencyKey: eventKey,
        rateKey: `discord:${interaction.guild_id ?? "dm"}:${discordUserId(interaction)}`,
        tenantKey: interaction.guild_id
          ? `discord:${interaction.guild_id}`
          : `discord:user:${discordUserId(interaction)}`,
      });
      void withDiscordDeliveryDeadline(audit).then(
        async (card) => {
          try {
            await editOriginal(interaction, formatTrustCard(card));
            service.markDelivered(eventKey);
          } catch (error) {
            service.markDeliveryFailed(eventKey);
            throw error;
          }
        },
        (error) => {
          if (error instanceof DuplicateRequestError) return;
          service.markDeliveryFailed(eventKey);
          return editOriginal(interaction, `⚠️ ${publicError(error)}`);
        },
      ).catch(() => undefined);
    } catch (error) {
      sendJson(response, 200, {
        type: 4,
        data: { flags: 64, content: `Usage: /glassbox question:<prompt> answer:<response>\n${publicError(error)}` },
      });
    }
  });
  return router;
}

export function withDiscordDeliveryDeadline<T>(
  pending: Promise<T>,
  timeoutMs = DISCORD_DELIVERY_DEADLINE_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DeliveryDeadlineError("GlassBox could not deliver this audit before Discord's response deadline."));
    }, timeoutMs);
    timer.unref?.();
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function discordInput(interaction: DiscordInteraction): VerificationInput {
  if (interaction.data?.type === 3) {
    const targetId = interaction.data.target_id ?? "";
    const message = interaction.data.resolved?.messages?.[targetId];
    const answer = message?.content?.trim() ?? "";
    const question = message?.referenced_message?.content?.trim()
      || "Audit the selected message's reasoning and evidentiary support.";
    return { question, answer, platform: "discord" };
  }

  const question = option(interaction, "question");
  const answer = option(interaction, "answer");
  if (typeof question !== "string" || typeof answer !== "string") {
    throw new Error("Both question and answer are required.");
  }
  return {
    question,
    answer,
    intents: parseIntentList(option(interaction, "intents")),
    platform: "discord",
  };
}

function option(interaction: DiscordInteraction, name: string): string | boolean | undefined {
  return interaction.data?.options?.find((candidate) => candidate.name === name)?.value;
}

function discordUserId(interaction: DiscordInteraction): string {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
}

function verifyDiscord(body: Buffer, signatureHex: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const seconds = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), body]),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

async function editOriginal(interaction: DiscordInteraction, content: string): Promise<void> {
  const applicationId = interaction.application_id || config.discord.applicationId;
  if (!applicationId) return;
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    },
  );
  if (!response.ok) throw new Error(`Discord response failed (${response.status}).`);
}
