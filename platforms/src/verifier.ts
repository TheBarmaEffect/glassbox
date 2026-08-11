import { GlassboxMcpVerifier } from "./glassbox.js";
import { GlassboxLiteVerifier } from "./lite.js";
import type { Verifier } from "./types.js";

export type GlassboxBackend = "lite" | "anthropic";

export function selectGlassboxBackend(
  source: Record<string, string | undefined> = process.env,
): GlassboxBackend {
  const requested = source.GLASSBOX_BACKEND?.trim().toLowerCase();
  if (requested && requested !== "lite" && requested !== "anthropic") {
    throw new Error("GLASSBOX_BACKEND must be either 'lite' or 'anthropic'.");
  }
  if (requested === "anthropic") return "anthropic";
  // Paid processing is always explicit. A stale or accidentally injected key
  // must never switch a zero-cost deployment away from Lite.
  return "lite";
}

export function createVerifier(backend: GlassboxBackend): Verifier {
  return backend === "anthropic" ? new GlassboxMcpVerifier() : new GlassboxLiteVerifier();
}
