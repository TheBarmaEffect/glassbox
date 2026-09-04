import crypto from "node:crypto";
import type { Request, Response } from "express";

export function rawBody(request: Request): Buffer {
  if (!Buffer.isBuffer(request.body)) throw new Error("Expected a raw request body.");
  return request.body;
}

export function parseJson<T>(body: Buffer): T {
  return JSON.parse(body.toString("utf8")) as T;
}

/**
 * Constant-time string comparison.
 *
 * Comparing lengths first short-circuits, which leaks the secret's length to a caller who
 * can time the response. Both sides are hashed to a fixed 32 bytes before comparison, so
 * the compared length is constant regardless of the inputs, and the digest comparison is
 * still the timing-safe one.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash("sha256").update(left, "utf8").digest();
  const b = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export function verifyHmac(body: Buffer, secret: string, signature: string, prefix = "sha256="): boolean {
  const expected = `${prefix}${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, signature);
}

export function sendJson(response: Response, status: number, value: unknown): void {
  response.status(status).type("application/json").send(JSON.stringify(value));
}

export function publicError(error: unknown): string {
  if (error instanceof Error && [
    "InputError",
    "QueueFullError",
    "RateLimitError",
    "AdmissionError",
    "GlobalLimitError",
    "JobTimeoutError",
    "DeliveryDeadlineError",
  ].includes(error.constructor.name)) return error.message;
  return "GlassBox could not complete this audit. Try again shortly.";
}
