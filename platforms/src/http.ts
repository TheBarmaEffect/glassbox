import crypto from "node:crypto";
import type { Request, Response } from "express";

export function rawBody(request: Request): Buffer {
  if (!Buffer.isBuffer(request.body)) throw new Error("Expected a raw request body.");
  return request.body;
}

export function parseJson<T>(body: Buffer): T {
  return JSON.parse(body.toString("utf8")) as T;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
