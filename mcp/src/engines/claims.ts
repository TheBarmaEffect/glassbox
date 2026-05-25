/**
 * Claim extraction engine.
 *
 * Decomposes an answer into atomic, standalone claims. For each claim
 * the engine produces a reasoning chain explaining why the claim is
 * being asserted and what would falsify it. The reasoning chain is the
 * single most important field in the entire framework — if any claim
 * comes back without a non-trivial reasoning string, the engine
 * synthesises a deterministic fallback rather than emit an empty field.
 *
 * The deterministic fallback is *not* a way to pretend everything is
 * fine: it always begins with `[fallback]` so a Trust Card consumer
 * can detect it and downgrade the verdict accordingly.
 */

import { callAnthropic, extractJson } from "../anthropic-client";
import type { Claim, ApiCallTrace } from "../types";

const SYSTEM_PROMPT = `You are the claim extraction engine for the Glass Box Framework, a runtime constitutional AI verification system.

Your job is to decompose an AI answer into its atomic factual or evaluative claims. For each claim you MUST produce a reasoning chain that explains:
1. Why the claim is being made (what in the question or answer supports it)
2. What evidence would strengthen the claim
3. What evidence would falsify the claim

A claim's reasoning field must never be empty, vague, or tautological. "The claim is true because the answer says so" is forbidden. Reasoning must engage with the substance.

Output ONLY a JSON array. No prose, no markdown fences. Each element has this shape:

{
  "id": "c-0",
  "text": "...",                                // the atomic claim, rewritten to stand alone
  "reasoning": "...",                           // the reasoning chain — multiple sentences, never empty
  "confidence": 0.0,                            // model's stated confidence in [0,1]
  "supporting_evidence": ["verbatim span 1"],   // verbatim quotes from the answer
  "attack_surface": ["how this could be wrong"],// list of ways the claim could be falsified
  "status": "observed"                          // "observed" | "reconstructed" | "assumed"
}

Be ruthless about atomicity: split compound assertions. Be conservative about confidence: an answer asserting something doesn't make it true.`;

interface RawClaim {
  id?: unknown;
  text?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
  supporting_evidence?: unknown;
  attack_surface?: unknown;
  status?: unknown;
}

function coerceString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function coerceConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function coerceStatus(v: unknown): Claim["status"] {
  return v === "reconstructed" || v === "assumed" ? v : "observed";
}

/**
 * Synthesise a deterministic fallback claim from a sentence in the
 * answer when the model failed to produce structured output. This keeps
 * the framework usable when the API is degraded — but the reasoning
 * field is prefixed with [fallback] so downstream scoring penalises it.
 */
function fallbackClaim(idx: number, sentence: string): Claim {
  const cleaned = sentence.trim();
  return {
    id: `c-${idx}`,
    text: cleaned,
    reasoning:
      "[fallback] The claim extraction engine could not reach the LLM, so the " +
      "extractor split the answer by sentence and treated each sentence as a " +
      "single observed claim. No reasoning chain was generated — this claim " +
      "should be treated as ungrounded and the Trust Card should reflect that.",
    confidence: 0.5,
    supporting_evidence: [cleaned],
    attack_surface: [
      "no reasoning chain was generated for this claim",
      "no atomicity check was applied to this sentence",
    ],
    status: "observed",
  };
}

function splitToSentences(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Guarantee a non-trivial reasoning string. If the model returned
 * something empty or suspiciously short, we replace it with a fallback
 * marker so the Trust Card consumer can see the gap rather than be
 * silently misled.
 */
function ensureReasoning(reasoning: string, claimText: string): string {
  const trimmed = reasoning.trim();
  if (trimmed.length >= 40) return trimmed;
  return (
    `[fallback] The model did not return a substantive reasoning chain for the claim "${claimText}". ` +
    "Treat this claim as unverified until a human reviews it or the extraction is re-run."
  );
}

export interface ClaimExtractionResult {
  claims: Claim[];
  trace: ApiCallTrace;
}

export async function extractClaims(
  question: string,
  answer: string
): Promise<ClaimExtractionResult> {
  const userPrompt = `QUESTION:\n${question}\n\nANSWER:\n${answer}\n\nReturn the JSON array of claims now.`;

  const { text, trace } = await callAnthropic({
    engine: "claim-extractor",
    purpose: "decomposing the answer into atomic claims with reasoning chains",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 3000,
  });

  if (!trace.ok || !text) {
    const sentences = splitToSentences(answer);
    const claims = sentences.length
      ? sentences.map((s, i) => fallbackClaim(i, s))
      : [fallbackClaim(0, answer)];
    return { claims, trace };
  }

  const parsed = extractJson<RawClaim[]>(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    const sentences = splitToSentences(answer);
    const claims = sentences.length
      ? sentences.map((s, i) => fallbackClaim(i, s))
      : [fallbackClaim(0, answer)];
    return { claims, trace };
  }

  const claims: Claim[] = parsed.map((raw, idx): Claim => {
    const text = coerceString(raw.text);
    const reasoning = ensureReasoning(coerceString(raw.reasoning), text);
    return {
      id: coerceString(raw.id) || `c-${idx}`,
      text: text || `(empty claim ${idx})`,
      reasoning,
      confidence: coerceConfidence(raw.confidence),
      supporting_evidence: coerceStringArray(raw.supporting_evidence),
      attack_surface: coerceStringArray(raw.attack_surface),
      status: coerceStatus(raw.status),
    };
  });

  return { claims, trace };
}
