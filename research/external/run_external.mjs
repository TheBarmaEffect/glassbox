#!/usr/bin/env node
/**
 * Run GlassBox Lite over an externally-authored dataset produced by `prepare.py`.
 *
 * The system under test is the deployed TypeScript gateway, driven in process through
 * the same `verify()` entry point the HTTP API calls. `platform: "api"` is required —
 * `normalizeInput` rejects anything else. No API key, no network, no model inference.
 *
 * Usage:  node run_external.mjs [--dataset NAME] [--repeat N]
 *         node run_external.mjs --all
 * Output: results/<name>_results.jsonl, results/<name>_determinism.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LITE = join(here, "../../platforms/dist/src/lite.js");
const { GlassboxLiteVerifier } = await import(LITE);

const DATASETS = ["halueval_qa", "halueval_dialogue", "halueval_general", "truthfulqa"];

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const REPEAT = Number(arg("--repeat", 2));
const names = process.argv.includes("--all") ? DATASETS : [arg("--dataset", "halueval_qa")];

// Fixed clock, exactly as in the GBSA-1 runner: the trust card carries a generation
// timestamp, and a live clock would make every pass differ for a reason that has nothing
// to do with the verifier.
const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

async function runOne(item) {
  const card = await verifier.verify({
    platform: "api",
    question: item.question,
    answer: item.answer,
  });
  // A probe "flags" when it did not pass — same convention as research/benchmark.
  // Angles are not a fixed list (citation_resolvability only appears when a citation
  // marker is present), so absent angles stay absent rather than becoming false.
  const flagged = {};
  const severity = {};
  for (const probe of card.red_team.probes) {
    // Several angles can be emitted more than once (one probe per citation found). Treat
    // the angle as flagged if any of its instances failed, which is how the verdict
    // already treats them.
    flagged[probe.angle] = (flagged[probe.angle] ?? false) || !probe.passed;
    if (!probe.passed) severity[probe.angle] = probe.severity;
  }
  return {
    id: item.id,
    pair_id: item.pair_id,
    label: item.label,
    verdict: card.verdict,
    ecs: card.ecs.total,
    dimensions: card.ecs.dimensions,
    pass_rate: card.red_team.pass_rate,
    highest_severity: card.red_team.highest_severity,
    claim_count: card.claims.length,
    probe_count: card.red_team.probes.length,
    failed_probes: card.red_team.probes.filter((p) => !p.passed).length,
    flagged,
    severity,
    // Carried so the scorer can measure the length confound without re-reading the
    // dataset, and so a length-only baseline can be computed from the same file.
    answer_chars: item.answer.length,
    answer_words: item.answer.trim().split(/\s+/).length,
  };
}

for (const name of names) {
  const items = readFileSync(join(here, "data", `${name}.jsonl`), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));

  const hashes = [];
  let results = null;
  const t0 = Date.now();
  for (let pass = 0; pass < REPEAT; pass += 1) {
    const out = [];
    for (const item of items) out.push(await runOne(item));
    hashes.push(createHash("sha256").update(JSON.stringify(out)).digest("hex"));
    if (pass === 0) results = out;
  }
  const elapsed = Date.now() - t0;
  const deterministic = hashes.every((h) => h === hashes[0]);

  mkdirSync(join(here, "results"), { recursive: true });
  writeFileSync(
    join(here, "results", `${name}_results.jsonl`),
    results.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(
    join(here, "results", `${name}_determinism.json`),
    JSON.stringify({
      dataset: name, items: items.length, repeats: REPEAT,
      identical: deterministic, digests: hashes,
      ms_per_item_per_pass: Number((elapsed / REPEAT / items.length).toFixed(4)),
    }, null, 2) + "\n",
  );

  console.log(
    `${name.padEnd(20)} items=${String(items.length).padStart(5)}  repeats=${REPEAT}  ` +
    `determinism=${deterministic ? "IDENTICAL" : "DIVERGED"}  ` +
    `${(elapsed / REPEAT / items.length).toFixed(3)} ms/item  digest=${hashes[0].slice(0, 16)}`,
  );
}
