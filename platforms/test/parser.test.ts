import assert from "node:assert/strict";
import test from "node:test";
import { InputError, normalizeInput, parseDelimitedCommand } from "../src/parser.js";

test("parses the universal question || answer || intents syntax", () => {
  const input = parseDelimitedCommand(
    "/glassbox Why does ice float? || Ice is less dense than water. || cite sources; flag assumptions",
    "slack",
  );
  assert.equal(input.question, "Why does ice float?");
  assert.equal(input.answer, "Ice is less dense than water.");
  assert.deepEqual(input.intents, ["cite sources", "flag assumptions"]);
});

test("rejects empty or oversized platform content", () => {
  assert.throws(() => parseDelimitedCommand("only one part", "telegram"), InputError);
  assert.throws(
    () => normalizeInput({ question: "q", answer: "a".repeat(12_001), platform: "api" }),
    InputError,
  );
});

test("caps intents and removes empty entries", () => {
  const input = normalizeInput({
    question: "q",
    answer: "a",
    platform: "api",
    intents: ["", " one ", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  });
  assert.equal(input.intents?.length, 8);
  assert.equal(input.intents?.[0], "one");
});

test("rejects oversized intent payloads before queue or spend accounting", () => {
  assert.throws(() => normalizeInput({
    question: "q",
    answer: "a",
    platform: "api",
    intents: ["x".repeat(1_001)],
  }), InputError);
});
