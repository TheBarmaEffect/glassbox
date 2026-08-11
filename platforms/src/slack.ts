import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import { formatSlackTrustCard } from "./formatter.js";
import { publicError, rawBody, safeEqual, sendJson } from "./http.js";
import { parseDelimitedCommand } from "./parser.js";
import { DuplicateRequestError, VerificationService } from "./service.js";

interface SlackShortcutPayload {
  type: "message_action";
  callback_id: string;
  trigger_id: string;
  user: { id: string };
  team?: { id?: string };
  channel: { id: string };
  message: { text?: string };
  response_url?: string;
}

interface SlackViewSubmission {
  type: "view_submission";
  user: { id: string };
  team?: { id?: string };
  view: {
    id: string;
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, { value?: string }>> };
  };
}

type SlackPayload = SlackShortcutPayload | SlackViewSubmission;

export function slackRouter(service: VerificationService): Router {
  const router = Router();

  router.post("/slack/commands", (request, response) => {
    const body = rawBody(request);
    if (!verifySlack(request.headers, body)) {
      sendJson(response, 401, { error: "Invalid Slack signature." });
      return;
    }
    const form = new URLSearchParams(body.toString("utf8"));
    const rawText = form.get("text") ?? "";
    try {
      const visibility = extractSlackVisibility(rawText);
      const input = parseDelimitedCommand(visibility.text, "slack");
      const responseUrl = form.get("response_url") ?? "";
      sendJson(response, 200, {
        response_type: visibility.isPublic ? "in_channel" : "ephemeral",
        text: "⏳ GlassBox is auditing that answer…",
      });
      const eventKey = crypto.createHash("sha256").update(body).digest("hex");
      const idempotencyKey = `slack-command:${eventKey}`;
      void service.run(input, {
        idempotencyKey,
        rateKey: `slack:${form.get("team_id")}:${form.get("user_id")}`,
        tenantKey: `slack:${form.get("team_id")}`,
      }).then(
        async (card) => {
          try {
            await respondToSlack(responseUrl, {
              response_type: visibility.isPublic ? "in_channel" : "ephemeral",
              replace_original: true,
              text: formatSlackTrustCard(card, 3_500),
              unfurl_links: false,
              unfurl_media: false,
            });
            service.markDelivered(idempotencyKey);
          } catch (error) {
            service.markDeliveryFailed(idempotencyKey);
            throw error;
          }
        },
        (error) => {
          if (error instanceof DuplicateRequestError) return;
          return respondToSlack(responseUrl, { replace_original: true, text: `⚠️ ${publicError(error)}` });
        },
      ).catch(() => undefined);
    } catch (error) {
      sendJson(response, 200, {
        response_type: "ephemeral",
        text: `Use \`/glassbox [--public] question || answer || optional intent 1; intent 2\`. ${publicError(error)}`,
      });
    }
  });

  router.post("/slack/interactions", (request, response) => {
    const body = rawBody(request);
    if (!verifySlack(request.headers, body)) {
      sendJson(response, 401, { error: "Invalid Slack signature." });
      return;
    }
    const form = new URLSearchParams(body.toString("utf8"));
    const payload = JSON.parse(form.get("payload") ?? "{}") as SlackPayload;

    if (payload.type === "message_action" && payload.callback_id === "glassbox_verify_message") {
      response.status(200).send("");
      void openVerificationModal(payload).catch(() => undefined);
      return;
    }

    if (payload.type === "view_submission" && payload.view.callback_id === "glassbox_verify_submission") {
      response.status(200).send("");
      const metadata = JSON.parse(payload.view.private_metadata) as {
        responseUrl: string;
      };
      const values = payload.view.state.values;
      const question = values.question?.question?.value ?? "";
      const answer = values.answer?.answer?.value ?? "";
      const intents = (values.intents?.intents?.value ?? "").split(";").map((value) => value.trim()).filter(Boolean);
      const idempotencyKey = `slack-view:${payload.view.id}`;
      void service.run({ question, answer, intents, platform: "slack" }, {
        idempotencyKey,
        rateKey: `slack:${payload.team?.id}:${payload.user.id}`,
        tenantKey: `slack:${payload.team?.id}`,
      }).then(
        async (card) => {
          try {
            await deliverShortcutResult(
              metadata,
              formatSlackTrustCard(card, 3_500),
            );
            service.markDelivered(idempotencyKey);
          } catch (error) {
            service.markDeliveryFailed(idempotencyKey);
            throw error;
          }
        },
        (error) => {
          if (error instanceof DuplicateRequestError) return;
          return deliverShortcutResult(metadata, `⚠️ ${publicError(error)}`);
        },
      ).catch(() => undefined);
      return;
    }

    response.status(200).send("");
  });

  return router;
}

function verifySlack(headers: Record<string, string | string[] | undefined>, body: Buffer): boolean {
  if (!config.slack.signingSecret) return false;
  const signature = stringHeader(headers["x-slack-signature"]);
  const timestamp = stringHeader(headers["x-slack-request-timestamp"]);
  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = `v0=${crypto.createHmac("sha256", config.slack.signingSecret)
    .update(`v0:${timestamp}:${body.toString("utf8")}`)
    .digest("hex")}`;
  return safeEqual(expected, signature);
}

function stringHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function openVerificationModal(payload: SlackShortcutPayload): Promise<void> {
  const answer = (payload.message.text ?? "").slice(0, 2_900);
  await slackApi("views.open", {
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: "glassbox_verify_submission",
      private_metadata: JSON.stringify({
        responseUrl: payload.response_url ?? "",
      }),
      title: { type: "plain_text", text: "GlassBox Audit" },
      submit: { type: "plain_text", text: "Analyze" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "question",
          label: { type: "plain_text", text: "Original prompt or question" },
          element: { type: "plain_text_input", action_id: "question", multiline: true },
        },
        {
          type: "input",
          block_id: "answer",
          label: { type: "plain_text", text: "Selected answer" },
          element: {
            type: "plain_text_input",
            action_id: "answer",
            multiline: true,
            ...(answer ? { initial_value: answer } : {}),
          },
        },
        {
          type: "input",
          optional: true,
          block_id: "intents",
          label: { type: "plain_text", text: "Rules (optional; separate with semicolons)" },
          element: { type: "plain_text_input", action_id: "intents", multiline: true },
        },
      ],
    },
  });
}

async function slackApi(method: string, body: unknown): Promise<void> {
  if (!config.slack.botToken) throw new Error("SLACK_BOT_TOKEN is not configured.");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.slack.botToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(`Slack API ${method} failed: ${result.error ?? response.status}`);
}

async function respondToSlack(url: string, body: unknown): Promise<void> {
  if (!url.startsWith("https://hooks.slack.com/")) throw new Error("Invalid Slack response URL.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Slack response failed (${response.status}).`);
}

export async function deliverShortcutResult(
  metadata: { responseUrl: string },
  text: string,
): Promise<void> {
  await respondToSlack(metadata.responseUrl, { response_type: "ephemeral", text });
}

export function extractSlackVisibility(rawText: string): { isPublic: boolean; text: string } {
  const prefix = rawText.match(/^\s*--public(?:\s+|$)/i);
  if (!prefix) return { isPublic: false, text: rawText };
  return { isPublic: true, text: rawText.slice(prefix[0].length) };
}
