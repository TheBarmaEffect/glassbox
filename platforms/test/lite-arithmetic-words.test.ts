import assert from "node:assert/strict";
import test from "node:test";
import { GlassboxLiteVerifier } from "../src/lite.js";

// Ported from an uncommitted working copy of platforms/. This file covers the word-form
// arithmetic cases; the remaining cases from the same original file exercise four other
// probe enhancements and now live in lite-probe-recovery.test.ts.

const verifier = new GlassboxLiteVerifier(() => new Date("2026-09-01T00:00:00.000Z"));

async function verdictFor(answer: string) {
  const card = await verifier.verify({
    platform: "api", question: "Compute it.", answer, intents: [],
  });
  const failed = new Set(card.red_team.probes.filter((p) => !p.passed).map((p) => p.angle));
  return { verdict: card.verdict, failed };
}

test("word-form arithmetic errors are caught, not only symbolic ones", async () => {
  const wrong = [
    "9 times 9 is 80.", "9 multiplied by 9 is 80.", "The product of 9 and 9 is 80.",
    "2 plus 2 is 5.", "10 minus 3 is 6.", "100 divided by 4 is 20.",
    "The sum of 2 and 3 is 6.", "The quotient of 100 and 4 is 20.",
  ];
  for (const answer of wrong) {
    const { failed } = await verdictFor(answer);
    assert.ok(failed.has("arithmetic_sanity"), `expected arithmetic_sanity to fail for: ${answer}`);
  }
});

test("correct word-form arithmetic does not raise a false positive", async () => {
  const right = [
    "9 times 9 is 81.", "9 multiplied by 9 is 81.", "The product of 9 and 9 is 81.",
    "2 plus 2 is 4.", "10 minus 3 is 7.", "100 divided by 4 is 25.",
    "The sum of 2 and 3 is 5.", "5 minus 9 is -4.", "1 divided by 3 is 0.33.",
  ];
  for (const answer of right) {
    const { verdict, failed } = await verdictFor(answer);
    assert.ok(!failed.has("arithmetic_sanity"), `unexpected arithmetic failure for: ${answer}`);
    assert.equal(verdict, "trust", `expected trust for: ${answer}`);
  }
});

test("word-form and symbolic arithmetic in one answer are not double counted", async () => {
  const card = await verifier.verify({
    platform: "api", question: "Compute both.",
    answer: "9 times 9 is 80. Also 2 + 2 = 5.", intents: [],
  });
  assert.equal(card.verdict, "reject");
  const failed = card.red_team.probes.filter((probe) => probe.angle === "arithmetic_sanity");
  assert.equal(failed.length, 1, "arithmetic_sanity should be reported once, not once per form");
  assert.equal(failed[0]?.passed, false);
});

test("word-form arithmetic keeps the backend deterministic", async () => {
  const input = { platform: "api" as const, question: "Q?", answer: "9 times 9 is 80.", intents: [] };
  const a = await verifier.verify(input);
  const b = await verifier.verify(input);
  assert.equal(a.audit.log_id, b.audit.log_id);
  assert.equal(a.ecs.total, b.ecs.total);
});
