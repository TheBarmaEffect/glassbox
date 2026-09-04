#!/usr/bin/env node
/**
 * GlassBox Lite arm of the comparison.
 *
 * Emits one record per item: which comparison AXES fired, which probe angles
 * fired in total (for the any-flag protocol), the verdict, and per-item
 * wall-clock. Timing is deliberately excluded from the determinism digest —
 * a clock is not part of the output.
 *
 * Usage: node run_glassbox.mjs --dataset heldout.jsonl [--repeat 2]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BENCH = join(here, "../benchmark");
const LITE = join(here, "../../platforms/dist/src/lite.js");
const { GlassboxLiteVerifier } = await import(LITE);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const DATASET = arg("--dataset", "heldout.jsonl");
const REPEAT = Number(arg("--repeat", 2));

// probe angle -> comparison axis. Angles absent here are still recorded in
// `all_flagged`, so the any-flag protocol sees them.
const AXIS = {
  arithmetic_sanity: "arith",
  internal_contradiction: "contra",
  unsupported_certainty: "cert",
  citation_verifiability: "cite",
  prompt_injection: "inj",
};

const items = readFileSync(join(BENCH, DATASET), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// Fixed clock, exactly as run_benchmark.mjs does, so audit timestamps cannot
// perturb the determinism check.
const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

async function runAll() {
  const out = [];
  for (const item of items) {
    const t0 = process.hrtime.bigint();
    const card = await verifier.verify({
      platform: "api", question: item.question, answer: item.answer,
    });
    const t1 = process.hrtime.bigint();
    const failed = card.red_team.probes.filter((p) => !p.passed).map((p) => p.angle);
    const fired = [...new Set(failed.map((a) => AXIS[a]).filter(Boolean))].sort();
    out.push({
      id: item.id,
      fired_axes: fired,
      all_flagged: failed.sort(),
      verdict: card.verdict,
      ms: Number(t1 - t0) / 1e6,
    });
  }
  return out;
}

// Digest over everything except timing.
const digestOf = (rows) => createHash("sha256").update(JSON.stringify(
  rows.map(({ ms, ...rest }) => rest),
)).digest("hex");

const digests = [];
let first = null;
for (let i = 0; i < REPEAT; i += 1) {
  const pass = await runAll();
  digests.push(digestOf(pass));
  if (i === 0) first = pass;
}
const identical = digests.every((d) => d === digests[0]);

const stem = DATASET.replace(/\.jsonl$/, "");
writeFileSync(join(here, `glassbox_${stem}.jsonl`),
  first.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(here, `glassbox_${stem}_determinism.json`), JSON.stringify({
  dataset: DATASET, repeats: REPEAT, identical, digests,
}, null, 2) + "\n");

console.log(`glassbox ${DATASET}: items=${first.length} repeats=${REPEAT} ` +
  `deterministic=${identical} digest=${digests[0].slice(0, 16)}`);
