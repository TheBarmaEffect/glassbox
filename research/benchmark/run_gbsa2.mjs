#!/usr/bin/env node
/**
 * GBSA-2 runner. Drives GlassBox Lite in-process against gbsa2.jsonl.
 *
 * This is a SIBLING of run_benchmark.mjs, not a modification of it. GBSA-1's
 * runner and its two result files are left untouched, because a benchmark that
 * silently rewrites the artefacts of the split it is meant to replace is not a
 * held-out benchmark.
 *
 * Two differences from run_benchmark.mjs, both required:
 *
 * 1. `platform: "api"` is passed explicitly. `normalizeInput` throws
 *    "Platform is not supported." when the field is absent, so a runner that
 *    omits it cannot produce a single result. That omission is what had
 *    silently broken the documented reproduction commands.
 *
 * 2. The item shape is a superset of GBSA-1's. Tool-invocation items cannot be
 *    expressed as (question, answer), so an item may also carry `tool`,
 *    `pin_declarations`, `allowed_tools` and `checkpoint`. Pins are produced
 *    here by `pinDeclaration`, which is exactly how a caller produces them at
 *    approval time: the pin is caller state, and the gateway retains none.
 *
 * No API key, no network, no paid backend, no clock dependence.
 *
 * Usage:  node run_gbsa2.mjs [--dataset gbsa2.jsonl] [--repeat N]
 * Output: gbsa2_results.jsonl, determinism_gbsa2.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LITE = join(here, "../../platforms/dist/src/lite.js");
const TOOLCALL = join(here, "../../platforms/dist/src/toolcall.js");
const { GlassboxLiteVerifier } = await import(LITE);
const { pinDeclaration } = await import(TOOLCALL);

const repeatArg = process.argv.indexOf("--repeat");
const REPEAT = repeatArg > -1 ? Number(process.argv[repeatArg + 1]) : 3;

const dsArg = process.argv.indexOf("--dataset");
const DATASET = dsArg > -1 ? process.argv[dsArg + 1] : "gbsa2.jsonl";
const STEM = DATASET.replace(/\.jsonl$/, "");
const OUT = `${STEM}_results.jsonl`;
const DET = `determinism_${STEM}.json`;

const items = readFileSync(join(here, DATASET), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// Fixed clock so audit timestamps cannot perturb the determinism check.
const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

/** The request body for one item. Optional fields appear only when the item has them. */
function requestFor(item) {
  return {
    // Required. Omitting it is an InputError, not a silent default.
    platform: "api",
    question: item.question,
    answer: item.answer,
    ...(item.checkpoint ? { checkpoint: item.checkpoint } : {}),
    ...(item.tool ? { tool: item.tool } : {}),
    ...(item.pin_declarations
      ? { tool_pins: item.pin_declarations.map((declaration) => pinDeclaration(declaration)) }
      : {}),
    ...(item.allowed_tools !== undefined ? { allowed_tools: item.allowed_tools } : {}),
  };
}

async function runAll() {
  const out = [];
  for (const item of items) {
    const card = await verifier.verify(requestFor(item));
    const probes = Object.fromEntries(
      card.red_team.probes.map((p) => [p.angle, { passed: p.passed, severity: p.severity }]),
    );
    out.push({
      id: item.id, stratum: item.stratum, target_probe: item.target_probe,
      should_flag: item.should_flag, in_scope: item.in_scope,
      verdict: card.verdict, ecs: card.ecs.total,
      claim_count: card.claims.length,
      // A probe "flags" when it did not pass. Keys of this map are exactly the
      // angles the implementation emitted for this item, which is itself part of
      // what the tool stratum measures.
      flagged: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, !v.passed])),
      severity: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.severity])),
      // Pre-registered expectations travel with the result so the scorer needs
      // one input file, as score.py does.
      ...(item.expect ? { expect: item.expect } : {}),
      ...(item.expected_severity ? { expected_severity: item.expected_severity } : {}),
    });
  }
  return out;
}

// Determinism: run the whole suite REPEAT times and hash each pass.
const hashes = [];
let results = null;
for (let i = 0; i < REPEAT; i += 1) {
  const pass = await runAll();
  hashes.push(createHash("sha256").update(JSON.stringify(pass)).digest("hex"));
  if (i === 0) results = pass;
}
const deterministic = hashes.every((h) => h === hashes[0]);

writeFileSync(join(here, OUT), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(here, DET), JSON.stringify({
  repeats: REPEAT, identical: deterministic, digests: hashes,
}, null, 2) + "\n");

console.log(`items=${results.length}  repeats=${REPEAT}`);
console.log(`determinism: ${deterministic ? "IDENTICAL across all passes" : "DIVERGED"}`);
console.log(`digest: ${hashes[0].slice(0, 32)}`);
if (!deterministic) process.exitCode = 1;
