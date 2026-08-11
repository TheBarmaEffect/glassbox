const assert = require("node:assert/strict");
const test = require("node:test");

require("../lib/mcp-client.js");
const client = globalThis.GlassBoxMcp;

const validResult = {
  verdict: "reject",
  summary: "A deterministic structural check found a rejection-level issue.",
  score: 0.81,
  claim_count: 1,
  finding_count: 1,
  highest_severity: "high",
  findings: [{ angle: "arithmetic_sanity", severity: "high", summary: "Arithmetic failed." }],
  probes: [{ angle: "arithmetic_sanity", severity: "high", summary: "Arithmetic failed.", passed: false }],
  caveats: ["Not a fact-check."],
};

function response(envelope, contentType = "text/event-stream") {
  const body = contentType === "text/event-stream"
    ? `event: message\ndata: ${JSON.stringify(envelope)}\n\n`
    : JSON.stringify(envelope);
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

test("normalizes and caps only explicit user fields", () => {
  assert.deepEqual(client.normalizeArguments({ question: " q ", answer: " a ", intents: [" rule "] }), {
    question: "q",
    answer: "a",
    intents: ["rule"],
  });
  assert.throws(() => client.normalizeArguments({ question: "q", answer: "a".repeat(12_001) }), /12,000/);
  assert.throws(() => client.normalizeArguments({ question: "q", answer: "a", intents: Array(9).fill("r") }), /8/);
});

test("calls only the public MCP tool without credentials", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return response({ jsonrpc: "2.0", id: "x", result: { structuredContent: validResult } });
  };
  const result = await client.callGlassBox({ question: "q", answer: "a" }, { fetchImpl });
  assert.equal(request.url, client.ENDPOINT);
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.headers.authorization, undefined);
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.method, "tools/call");
  assert.equal(payload.params.name, "glassbox_verify_answer");
  assert.deepEqual(result.findings, validResult.findings);
});

test("parses both SSE and JSON MCP envelopes", () => {
  const envelope = { jsonrpc: "2.0", id: 1, result: { structuredContent: validResult } };
  assert.deepEqual(client.parseEnvelope(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`), envelope);
  assert.deepEqual(client.parseEnvelope(JSON.stringify(envelope)), envelope);
});

test("neutralizes control and bidirectional formatting characters", () => {
  assert.equal(client.neutralText("safe\u202eevil\u0000text", 100), "safeeviltext");
  const normalized = client.normalizeResult({ ...validResult, summary: "safe\u202eevil" });
  assert.equal(normalized.summary, "safeevil");
  assert.throws(() => client.normalizeResult({ ...validResult, verdict: "<img onerror=alert(1)>" }), /invalid result/);
});

test("does not expose remote error bodies", async () => {
  await assert.rejects(
    client.callGlassBox(
      { question: "q", answer: "a" },
      { fetchImpl: async () => new Response("PRIVATE REMOTE ERROR", { status: 500 }) },
    ),
    (error) => error.message === "GlassBox rejected the request." && !error.message.includes("PRIVATE"),
  );
});
