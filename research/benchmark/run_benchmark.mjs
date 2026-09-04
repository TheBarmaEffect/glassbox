#!/usr/bin/env node
/**
 * GBSA-1 runner. Drives GlassBox Lite in-process against dataset.jsonl.
 *
 * No API key, no network, no paid backend. This is the whole point: because
 * Lite performs no model inference, the benchmark costs nothing to run and
 * reruns byte-identically.
 *
 * Usage:  node run_benchmark.mjs [--repeat N]
 * Output: results.jsonl (one record per item), plus a determinism check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LITE = join(here, "../../platforms/dist/src/lite.js");
const { GlassboxLiteVerifier } = await import(LITE);

const repeatArg = process.argv.indexOf("--repeat");
const REPEAT = repeatArg > -1 ? Number(process.argv[repeatArg + 1]) : 3;

const dsArg = process.argv.indexOf("--dataset");
const DATASET = dsArg > -1 ? process.argv[dsArg + 1] : "dataset.jsonl";
// Output name derives from the dataset stem, so any dataset is safe to add.
// A previous version only handled two names and overwrote a third dataset in place.
const STEM = DATASET.replace(/\.jsonl$/, "");
const OUT = (STEM === "dataset" ? "results" : `${STEM}_results`) + ".jsonl";
const DET = (STEM === "dataset" ? "determinism" : `determinism_${STEM}`) + ".json";
const items = readFileSync(join(here, DATASET), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// Fixed clock so audit timestamps cannot perturb the determinism check.
const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

async function runAll() {
  const out = [];
  for (const item of items) {
    const card = await verifier.verify({ platform: "api", question: item.question, answer: item.answer });
    const probes = Object.fromEntries(
      card.red_team.probes.map((p) => [p.angle, { passed: p.passed, severity: p.severity }]),
    );
    out.push({
      id: item.id, stratum: item.stratum, target_probe: item.target_probe,
      should_flag: item.should_flag, in_scope: item.in_scope,
      verdict: card.verdict, ecs: card.ecs.total,
      claim_count: card.claims.length,
      // A probe "flags" when it did not pass.
      flagged: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, !v.passed])),
      severity: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.severity])),
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
