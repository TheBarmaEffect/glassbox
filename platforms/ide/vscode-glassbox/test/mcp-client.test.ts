import assert from "node:assert/strict";
import test from "node:test";
import { formatResult, parseMcpResponse, validateEndpoint, verifyAnswer } from "../src/mcp-client";

const publicResult = {
  verdict: "reject",
  summary: "A deterministic structural check found a rejection-level issue.",
  score: 0.814,
  claim_count: 1,
  finding_count: 1,
  highest_severity: "high",
  findings: [{ angle: "arithmetic_sanity", severity: "high", summary: "A supported arithmetic expression failed deterministic recomputation." }],
  probes: [{ angle: "arithmetic_sanity", passed: false, severity: "high", summary: "A supported arithmetic expression failed deterministic recomputation." }],
  caveats: ["GlassBox Lite is a deterministic reasoning audit, not a web fact-check."],
};

test("parses JSON and SSE MCP envelopes with the privacy-minimized result", () => {
  const envelope = JSON.stringify({ jsonrpc: "2.0", id: "1", result: { structuredContent: publicResult } });
  assert.equal(parseMcpResponse(200, "application/json", envelope).verdict, "reject");
  assert.equal(parseMcpResponse(200, "text/event-stream", `event: message\ndata: ${envelope}\n\n`).score, 0.814);
});

test("rejects private fields and malformed result shapes", () => {
  const privateResult = { ...publicResult, question: "do not echo" };
  assert.throws(
    () => parseMcpResponse(200, "application/json", JSON.stringify({ result: { structuredContent: privateResult } })),
    /non-public audit data/,
  );
  assert.throws(
    () => parseMcpResponse(200, "application/json", JSON.stringify({ result: { structuredContent: { ...publicResult, score: 9 } } })),
    /score was invalid/,
  );
});

test("formatter keeps server text inert and never repeats selected content", () => {
  const rendered = formatResult({
    ...publicResult,
    summary: "<script>alert(1)</script>\u202E.exe",
  } as never);
  assert.doesNotMatch(rendered, /selected secret answer/);
  assert.match(rendered, /<script>/, "OutputChannel is a plain-text surface");
  assert.doesNotMatch(rendered, /\u202E/);
});

test("endpoint policy rejects credentials and non-local cleartext", () => {
  assert.match(validateEndpoint("https://glassbox.example/mcp"), /^https:/);
  assert.match(validateEndpoint("http://localhost:8080/mcp"), /^http:/);
  assert.throws(() => validateEndpoint("http://glassbox.example/mcp"), /HTTPS/);
  assert.throws(() => validateEndpoint("https://user:pass@glassbox.example/mcp"), /credentials/);
});

test("request contains only explicit arguments and no authorization secret", async () => {
  let request: Request | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ result: { structuredContent: publicResult } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await verifyAnswer({
    endpoint: "https://glassbox.example/mcp",
    question: "What is 2 + 2?",
    answer: "2 + 2 = 5.",
  }, fetcher);
  assert.equal(result.verdict, "reject");
  assert.equal(request?.headers.get("authorization"), null);
  const body = JSON.parse(await request!.text()) as { params: { arguments: Record<string, unknown> } };
  assert.deepEqual(body.params.arguments, { question: "What is 2 + 2?", answer: "2 + 2 = 5." });
});
