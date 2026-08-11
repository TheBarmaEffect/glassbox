(function registerGlassBoxMcp(root) {
  "use strict";

  const ENDPOINT = "https://glassbox-platform-gateway.onrender.com/mcp";
  const TOOL_NAME = "glassbox_verify_answer";
  const MAX_RESPONSE_CHARS = 128_000;
  const ANGLES = new Set([
    "claim_extraction",
    "unsupported_certainty",
    "internal_contradiction",
    "prompt_injection",
    "fact_check_scope",
    "citation_verifiability",
    "arithmetic_sanity",
  ]);
  const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
  const VERDICTS = new Set(["trust", "caution", "reject"]);

  class GlassBoxClientError extends Error {
    constructor(message, code = "request_failed") {
      super(message);
      this.name = "GlassBoxClientError";
      this.code = code;
    }
  }

  function neutralText(value, maxLength) {
    if (typeof value !== "string") throw new GlassBoxClientError("The verifier returned an invalid response.", "invalid_response");
    return value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
      .slice(0, maxLength);
  }

  function requiredInput(value, label, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new GlassBoxClientError(`${label} is required.`, "invalid_input");
    if (text.length > maxLength) {
      throw new GlassBoxClientError(`${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.`, "invalid_input");
    }
    return text;
  }

  function normalizeArguments(input) {
    const question = requiredInput(input?.question, "Question", 6_000);
    const answer = requiredInput(input?.answer, "Answer", 12_000);
    const intents = Array.isArray(input?.intents)
      ? input.intents.map((value) => requiredInput(value, "Each requirement", 1_000))
      : [];
    if (intents.length > 8) throw new GlassBoxClientError("Use no more than 8 requirements.", "invalid_input");
    if (intents.reduce((total, value) => total + value.length, 0) > 4_000) {
      throw new GlassBoxClientError("Requirements must total 4,000 characters or fewer.", "invalid_input");
    }
    return intents.length ? { question, answer, intents } : { question, answer };
  }

  function parseEnvelope(text) {
    const trimmed = text.trim();
    if (!trimmed) throw new GlassBoxClientError("The verifier returned an empty response.", "invalid_response");
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        throw new GlassBoxClientError("The verifier returned invalid JSON.", "invalid_response");
      }
    }
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        // Ignore non-JSON keepalive events and continue to the response event.
      }
    }
    throw new GlassBoxClientError("The verifier returned an invalid event stream.", "invalid_response");
  }

  function count(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new GlassBoxClientError(`The verifier returned an invalid ${label}.`, "invalid_response");
    }
    return value;
  }

  function finding(value) {
    if (!value || !ANGLES.has(value.angle) || !SEVERITIES.has(value.severity)) {
      throw new GlassBoxClientError("The verifier returned an invalid finding.", "invalid_response");
    }
    return {
      angle: value.angle,
      severity: value.severity,
      summary: neutralText(value.summary, 600),
    };
  }

  function probe(value) {
    if (typeof value?.passed !== "boolean") {
      throw new GlassBoxClientError("The verifier returned an invalid probe.", "invalid_response");
    }
    return { ...finding(value), passed: value.passed };
  }

  function normalizeResult(value) {
    if (!value || !VERDICTS.has(value.verdict) || !SEVERITIES.has(value.highest_severity)) {
      throw new GlassBoxClientError("The verifier returned an invalid result.", "invalid_response");
    }
    if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
      throw new GlassBoxClientError("The verifier returned an invalid score.", "invalid_response");
    }
    if (!Array.isArray(value.findings) || value.findings.length > 20 || !Array.isArray(value.probes) || value.probes.length > 20) {
      throw new GlassBoxClientError("The verifier returned too many result records.", "invalid_response");
    }
    if (!Array.isArray(value.caveats) || value.caveats.length > 12) {
      throw new GlassBoxClientError("The verifier returned invalid caveats.", "invalid_response");
    }
    return Object.freeze({
      verdict: value.verdict,
      summary: neutralText(value.summary, 600),
      score: value.score,
      claim_count: count(value.claim_count, "claim count"),
      finding_count: count(value.finding_count, "finding count"),
      highest_severity: value.highest_severity,
      findings: Object.freeze(value.findings.map(finding)),
      probes: Object.freeze(value.probes.map(probe)),
      caveats: Object.freeze(value.caveats.map((item) => neutralText(item, 600))),
    });
  }

  async function callGlassBox(input, options = {}) {
    const fetchImpl = options.fetchImpl ?? root.fetch;
    if (typeof fetchImpl !== "function") throw new GlassBoxClientError("Network access is unavailable.", "network");
    const arguments_ = normalizeArguments(input);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 28_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const id = root.crypto?.randomUUID?.() ?? `glassbox-${Date.now()}`;
    let response;
    try {
      response = await fetchImpl(options.endpoint ?? ENDPOINT, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: TOOL_NAME, arguments: arguments_ },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new GlassBoxClientError("GlassBox timed out. Retry once after the free service wakes.", "timeout");
      throw new GlassBoxClientError("GlassBox could not be reached. Check your connection and retry.", "network");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new GlassBoxClientError(
        response.status === 429 ? "GlassBox is rate-limited. Please retry later." : "GlassBox rejected the request.",
        response.status === 429 ? "rate_limited" : "request_failed",
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_CHARS) throw new GlassBoxClientError("The verifier response was too large.", "invalid_response");
    const responseText = await response.text();
    if (responseText.length > MAX_RESPONSE_CHARS) throw new GlassBoxClientError("The verifier response was too large.", "invalid_response");
    const envelope = parseEnvelope(responseText);
    if (envelope?.error || envelope?.result?.isError) {
      throw new GlassBoxClientError("GlassBox could not complete this audit.", "verification_failed");
    }
    return normalizeResult(envelope?.result?.structuredContent);
  }

  root.GlassBoxMcp = Object.freeze({
    ENDPOINT,
    TOOL_NAME,
    GlassBoxClientError,
    callGlassBox,
    neutralText,
    normalizeArguments,
    normalizeResult,
    parseEnvelope,
  });
})(globalThis);
