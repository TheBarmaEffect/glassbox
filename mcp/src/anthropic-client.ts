/**
 * Centralised Anthropic API wrapper.
 *
 * Every engine in the framework goes through `callAnthropic` so that
 * authentication, error handling, retry policy, and audit-trace
 * generation live in one place. The audit log is the only legitimate
 * way to reconstruct a run, and it depends on every API call being
 * captured here.
 */

import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import type { ApiCallTrace } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2048;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Glass Box MCP requires an Anthropic API key " +
        "to run its verification engines. Set ANTHROPIC_API_KEY in the environment " +
        "the MCP server is launched from (e.g. in the Claude Desktop mcpServers config)."
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export function getConfiguredModel(): string {
  return process.env.GLASSBOX_MODEL ?? DEFAULT_MODEL;
}

export function getMaxTokens(): number {
  const raw = process.env.GLASSBOX_MAX_TOKENS;
  if (!raw) return DEFAULT_MAX_TOKENS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

export interface CallOptions {
  /** Name of the engine making the call — recorded in the audit trace. */
  engine: string;
  /** Why the call is being made — recorded in the audit trace. */
  purpose: string;
  /** System prompt for the call. */
  system: string;
  /** User content for the call. */
  user: string;
  /** Optional override for max_tokens. */
  maxTokens?: number;
  /** Optional override for temperature. Defaults to 0 for determinism. */
  temperature?: number;
}

export interface CallResult {
  text: string;
  trace: ApiCallTrace;
}

function hashStr(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Make a single Anthropic API call.
 *
 * Always returns a CallResult; on error, `trace.ok` is `false`, `trace.error`
 * contains the message, and `text` is empty. Callers decide whether an empty
 * response is fatal — many engines have safe fallbacks so a single failed
 * call should not blow up the whole verification.
 */
export async function callAnthropic(opts: CallOptions): Promise<CallResult> {
  const client = getClient();
  const model = getConfiguredModel();
  const maxTokens = opts.maxTokens ?? getMaxTokens();
  const temperature = opts.temperature ?? 0;
  const promptHash = hashStr(opts.system + "\n---\n" + opts.user);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      text,
      trace: {
        engine: opts.engine,
        purpose: opts.purpose,
        prompt_hash: promptHash,
        response_hash: hashStr(text),
        ok: true,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let detail = message;
    if (err instanceof Anthropic.APIError) {
      detail = `Anthropic API error (status ${err.status}) in engine "${opts.engine}" while ${opts.purpose}: ${err.message}`;
    } else if (err instanceof Error) {
      detail = `Engine "${opts.engine}" failed while ${opts.purpose}: ${err.message}`;
    }
    return {
      text: "",
      trace: {
        engine: opts.engine,
        purpose: opts.purpose,
        prompt_hash: promptHash,
        response_hash: hashStr(""),
        ok: false,
        error: detail,
      },
    };
  }
}

/**
 * Pull the first JSON object or array out of a model response.
 *
 * Models reliably emit JSON when asked, but they often wrap it in
 * ```json ... ``` fences or chatty preamble. We tolerate both and
 * return null if nothing parseable is found — the caller is expected
 * to have a deterministic fallback for that case.
 */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch {
      // fall through to bracket scan
    }
  }

  const firstBrace = text.search(/[\[{]/);
  if (firstBrace === -1) return null;

  for (let end = text.length; end > firstBrace; end--) {
    const candidate = text.slice(firstBrace, end);
    const last = candidate[candidate.length - 1];
    if (last !== "}" && last !== "]") continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try a shorter window
    }
  }

  return null;
}
