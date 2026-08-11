import { createHmac, timingSafeEqual } from "node:crypto";

function equalText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyNotionSignature(
  rawBody: Buffer,
  signature: string | undefined,
  verificationToken: string,
): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", verificationToken)
    .update(rawBody)
    .digest("hex")}`;
  return equalText(signature, expected);
}

export function verifyBearer(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return equalText(header.slice("Bearer ".length), secret);
}

export function verifyOauthState(state: string | undefined, cookieState: string | undefined): boolean {
  return !!state && !!cookieState && equalText(state, cookieState);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

export class VerificationTokenCapture {
  #token: string | undefined;

  capture(token: string): void {
    if (!/^secret_[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new Error("Invalid Notion verification-token shape.");
    }
    if (this.#token) {
      throw new Error("A Notion verification token is already waiting.");
    }
    this.#token = token;
  }

  take(): string | undefined {
    const token = this.#token;
    this.#token = undefined;
    return token;
  }
}
