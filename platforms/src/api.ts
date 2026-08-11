import crypto from "node:crypto";
import { Router, type Request } from "express";
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

  router.post("/api/v1/verify", async (request, response) => {
    if (!authorized(request)) {
      sendJson(response, config.sharedSecret ? 401 : 503, {
        error: config.sharedSecret ? "Unauthorized" : "PLATFORM_SHARED_SECRET is not configured.",
      });
      return;
    }

    try {
      const body = parseJson<Partial<VerificationInput>>(rawBody(request));
      const idempotency = request.header("x-idempotency-key") ?? crypto.randomUUID();
      const eventKey = `api:${idempotency}`;
      const card = await service.run(
        {
          platform: body.platform ?? "api",
          question: String(body.question ?? ""),
          answer: String(body.answer ?? ""),
          intents: Array.isArray(body.intents) ? body.intents.map(String) : [],
        },
        {
          idempotencyKey: eventKey,
          rateKey: "api:shared",
          tenantKey: "api",
        },
      );
      try {
        sendJson(response, 200, card);
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
  });

  return router;
}

function authorized(request: Request): boolean {
  if (!config.sharedSecret) return false;
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return safeEqual(token, config.sharedSecret);
}
