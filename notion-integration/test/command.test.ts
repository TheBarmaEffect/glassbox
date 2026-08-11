import assert from "node:assert/strict";
import test from "node:test";
import { formatAuditResult, parseGlassboxCommand } from "../src/command.js";

test("accepts only an explicit leading /glassbox comment", () => {
  assert.deepEqual(
    parseGlassboxCommand("/glassbox What is 17 × 6? || 17 × 6 = 112 || recompute arithmetic; check certainty"),
    {
      question: "What is 17 × 6?",
      answer: "17 × 6 = 112",
      intents: ["recompute arithmetic", "check certainty"],
    },
  );
  assert.equal(parseGlassboxCommand("please /glassbox this"), undefined);
  assert.equal(parseGlassboxCommand("/glassboxes question || answer"), undefined);
  assert.throws(() => parseGlassboxCommand("/glassbox only one part"), /question \|\| answer/);
});

test("formats a bounded inert Trust Card without echoing inputs", () => {
  const output = formatAuditResult({
    verdict: "caution",
    summary: "Review @everyone at https://evil.invalid",
    score: 0.5,
    claim_count: 2,
    finding_count: 1,
    highest_severity: "high",
    findings: [{ angle: "arithmetic_sanity", severity: "high", summary: "Mismatch" }],
    caveats: [],
  });
  assert.ok(output.length <= 1_900);
  assert.doesNotMatch(output, /@everyone/);
  assert.doesNotMatch(output, /https:\/\/evil/);
  assert.match(output, /not a web fact-check/);
});
