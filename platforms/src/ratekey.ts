import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Per-caller rate keys.
 *
 * Every authenticated API request previously shared one bucket, `rateKey: "api:shared"`,
 * so the 10-per-10-minute limit applied to *all callers combined* rather than to each of
 * them. One client could exhaust the gateway for everyone, and no per-caller usage could
 * be distinguished at all.
 *
 * A caller is identified without retaining who they are: the identifier is HMAC'd with a
 * process secret and truncated, so the key separates callers, is stable within a
 * deployment, and cannot be reversed to a network address. This is the same construction
 * the MCP surface already used, lifted here so both paths share one implementation and
 * one secret.
 */
const RATE_SECRET = config.sharedSecret ?? crypto.randomBytes(32).toString("hex");

export function hashedRateKey(namespace: string, identifier: string): string {
  const digest = crypto.createHmac("sha256", RATE_SECRET)
    .update(identifier || "unknown")
    .digest("hex")
    .slice(0, 32);
  return `${namespace}:${digest}`;
}

/** Header a caller may send to get a stable bucket that does not move with their IP. */
export const CLIENT_ID_HEADER = "x-glassbox-client";

/** Client identifiers are opaque to us, but must be bounded and printable. */
export function validClientId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  return /^[\x21-\x7E]+$/.test(trimmed) ? trimmed : undefined;
}

/**
 * The rate bucket for an API request. A caller-supplied client id wins when present, so a
 * distributed client keeps one bucket across its instances; otherwise the network address
 * is used. The two are namespaced apart so a caller cannot pick a client id that collides
 * with another caller's address-derived bucket.
 */
export function apiRateKey(clientId: string | undefined, clientAddress: string): string {
  const supplied = validClientId(clientId);
  return supplied ? hashedRateKey("api-client", supplied) : hashedRateKey("api-addr", clientAddress);
}
