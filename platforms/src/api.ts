import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { config } from "./config.js";
import { publicError, rawBody, parseJson, safeEqual, sendJson } from "./http.js";
import { InputError } from "./parser.js";
import {
  DuplicateRequestError,
  AdmissionError,
  GlobalLimitError,
  JobTimeoutError,
  QueueFullError,
  RateLimitError,
  VerificationService,
} from "./service.js";
import type { VerificationInput } from "./types.js";

export function apiRouter(service: VerificationService): Router {
  const router = Router();
  router.post("/api/v1/verify", apiHandler(service, false));
  router.post("/api/v1/govern", apiHandler(service, true));
  return router;
}

function apiHandler(service: VerificationService, enforceGate: boolean) {
  return async (request: Request, response: Response): Promise<void> => {
    if (!authorized(request)) {
      sendJson(response, config.sharedSecret ? 401 : 503, {
        error: config.sharedSecret ? "Unauthorized" : "PLATFORM_SHARED_SECRET is not configured.",
      });
      return;
    }

    try {
      let body: Partial<VerificationInput>;
      try {
        body = parseJson<Partial<VerificationInput>>(rawBody(request));
      } catch {
        throw new InputError("Request body must be valid JSON.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new InputError("Request body must be a JSON object.");
      }
      if (typeof body.question !== "string" || typeof body.answer !== "string") {
        throw new InputError("Question and answer must be strings.");
      }
      if (body.intents !== undefined && (!Array.isArray(body.intents) || body.intents.some((intent) => typeof intent !== "string"))) {
        throw new InputError("Intents must be an array of strings.");
      }
      const suppliedIdempotency = request.header("x-idempotency-key");
      if (suppliedIdempotency && (suppliedIdempotency.length > 200 || /[^\x21-\x7E]/.test(suppliedIdempotency))) {
        throw new InputError("Idempotency key must contain 1 to 200 visible ASCII characters.");
      }
      const idempotency = suppliedIdempotency ?? crypto.randomUUID();
      const eventKey = `${enforceGate ? "govern" : "api"}:${idempotency}`;
      const card = await service.run(
        {
          platform: body.platform ?? "api",
          question: body.question,
          answer: body.answer,
          intents: body.intents ?? [],
          checkpoint: body.checkpoint,
          constitution: body.constitution,
          response_policy: body.response_policy,
        },
        {
          idempotencyKey: eventKey,
          rateKey: "api:shared",
          tenantKey: "api",
        },
      );
      try {
        if (enforceGate) {
          const action = card.governance?.response.action ?? "block";
          const released = action === "allow" || action === "record";
          const nextStep = action === "retry" ? "retry" : action === "escalate" ? "human_review" : null;
          const status = released ? 200 : action === "block" ? 422 : 409;
          sendJson(response, status, {
            gate: {
              released,
              action,
              effect: released ? (action === "record" ? "released_with_record" : "released") : "withheld",
              next_step: nextStep,
              enforced_by_gateway: true,
            },
            card,
          });
        } else {
          sendJson(response, 200, card);
        }
        service.markDelivered(eventKey);
      } catch (error) {
        service.markDeliveryFailed(eventKey);
        throw error;
      }
    } catch (error) {
      if (error instanceof DuplicateRequestError) {
        sendJson(response, 409, { error: error.message });
        return;
      }
      if (error instanceof RateLimitError) {
        sendJson(response, 429, { error: error.message });
        return;
      }
      if (error instanceof AdmissionError) {
        sendJson(response, 403, { error: error.message });
        return;
      }
      if (error instanceof GlobalLimitError) {
        sendJson(response, 503, { error: error.message });
        return;
      }
      if (error instanceof JobTimeoutError) {
        sendJson(response, 504, { error: error.message });
        return;
      }
      if (error instanceof QueueFullError) {
        sendJson(response, 503, { error: error.message });
        return;
      }
      sendJson(response, error instanceof InputError ? 400 : 502, { error: publicError(error) });
    }
  };
}

function authorized(request: Request): boolean {
  if (!config.sharedSecret) return false;
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return safeEqual(token, config.sharedSecret);
}
