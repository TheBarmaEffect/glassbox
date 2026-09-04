#!/usr/bin/env node
/**
 * Run GlassBox Lite *and* the SRS-1 prototype over every corpus the project has, and emit
 * one row per item carrying both scores plus every SRS component.
 *
 * The system under test is the deployed verifier, driven in process through the same
 * `verify()` entry point the HTTP API calls, with `platform: "api"` — identical to
 * `research/external/run_external.mjs` and `research/benchmark/run_benchmark.mjs`, so the
 * `ecs` column here is directly comparable to the numbers already published in
 * `research/external/EXTERNAL_RESULTS.md`. No API key, no network, no model inference.
 *
 * `src/scoring.ts` is import-free, so it is compiled on its own rather than through
 * `npm run build`:
 *
 *   cd platforms && npx tsc src/scoring.ts --outDir dist --rootDir . \
 *       --target es2022 --module nodenext --moduleResolution nodenext --strict
 *
 * Usage:  node run_scoring.mjs [--datasets a,b] [--repeat 2]
 * Output: results/<name>_rows.jsonl, results/<name>_determinism.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "../../platforms/dist/src");
const { GlassboxLiteVerifier } = await import(join(DIST, "lite.js"));
const { structuralResolution, COMPONENTS, TIEBREAK_BAND_PPM, SRS_VERSION } =
  await import(join(DIST, "scoring.js"));

/**
 * Seven corpora. `label` is the thing the score is asked to rank above its complement.
 * For the external sets that is a third party's hallucination judgement; for the GBSA sets
 * it is the project's own `should_flag`, which is a different question — "does this item
 * contain the property the probe looks for" — and is labelled as such in the report so the
 * two are never averaged together.
 */
const DATASETS = [
  { name: "truthfulqa", path: "../external/data/truthfulqa.jsonl", label: "external" },
  { name: "halueval_qa", path: "../external/data/halueval_qa.jsonl", label: "external" },
  { name: "halueval_dialogue", path: "../external/data/halueval_dialogue.jsonl", label: "external" },
  { name: "halueval_general", path: "../external/data/halueval_general.jsonl", label: "external" },
  { name: "gbsa1_main", path: "../benchmark/dataset.jsonl", label: "should_flag" },
  { name: "gbsa1_heldout", path: "../benchmark/heldout.jsonl", label: "should_flag" },
  { name: "gbsa2", path: "../benchmark/gbsa2.jsonl", label: "should_flag" },
];

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const REPEAT = Number(arg("--repeat", 2));
const only = arg("--datasets", null);
const selected = only ? DATASETS.filter((d) => only.split(",").includes(d.name)) : DATASETS;

// Fixed clock, as in both existing runners: the card carries a generation timestamp and a
// live clock would make every pass differ for a reason unrelated to the verifier.
const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

/** Every score under test, all derived from one card so the comparison is exact. */
function scores(input, card) {
  const mean = structuralResolution(input, card, { pool: "mean", tierVariant: "ecs" });
  const max = structuralResolution(input, card, { pool: "max", tierVariant: "ecs" });
  const sign = structuralResolution(input, card, { pool: "mean", tierVariant: "sign" });
  const strict = structuralResolution(input, card, { pool: "mean", tierVariant: "sign_strict" });
  const bare = structuralResolution(input, card, { pool: "mean", tierVariant: "none" });
  const bareMax = structuralResolution(input, card, { pool: "max", tierVariant: "none" });
  return {
    ecs_risk_ppm: mean.tier_ppm,
    srs_risk_ppm: mean.risk_ppm,
    srs_max_ppm: max.risk_ppm,
    srs_sign_ppm: sign.risk_ppm,
    srs_sign_strict_ppm: strict.risk_ppm,
    gradient_ppm: bare.risk_ppm,
    gradient_max_ppm: bareMax.risk_ppm,
    srs_decimal: mean.score,
    components: mean.components,
  };
}

async function runOne(item, labelKind) {
  const input = { platform: "api", question: item.question, answer: item.answer };
  const card = await verifier.verify(input);
  const flagged = {};
  for (const probe of card.red_team.probes) {
    flagged[probe.angle] = (flagged[probe.angle] ?? false) || !probe.passed;
  }
  const label = labelKind === "external" ? Number(item.label) : (item.should_flag ? 1 : 0);
  return {
    id: item.id,
    // Cluster unit for the bootstrap. Unpaired corpora cluster on themselves, which makes
    // the cluster bootstrap degenerate to the ordinary one — correct, not a special case.
    pair_id: item.pair_id ?? item.id,
    label,
    label_kind: labelKind,
    stratum: item.stratum ?? null,
    in_scope: item.in_scope ?? null,
    verdict: card.verdict,
    ecs: card.ecs.total,
    failed_probes: card.red_team.probes.filter((probe) => !probe.passed).length,
    flagged,
    claim_count: card.claims.length,
    answer_chars: item.answer.length,
    answer_words: item.answer.trim().split(/\s+/).filter(Boolean).length,
    ...scores({ question: item.question, answer: item.answer }, card),
  };
}

mkdirSync(join(here, "results"), { recursive: true });
const manifest = {
  srs_version: SRS_VERSION,
  tiebreak_band_ppm: TIEBREAK_BAND_PPM,
  components: COMPONENTS.map((c) => ({
    key: c.key, refines: c.refines, included: c.included, higher_is_riskier: c.higher_is_riskier,
  })),
  datasets: [],
};

for (const dataset of selected) {
  const file = join(here, dataset.path);
  if (!existsSync(file)) {
    console.error(`SKIP ${dataset.name}: ${dataset.path} is absent`);
    continue;
  }
  const items = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  const digests = [];
  let rows = null;
  const started = Date.now();
  for (let pass = 0; pass < REPEAT; pass += 1) {
    const out = [];
    for (const item of items) out.push(await runOne(item, dataset.label));
    digests.push(createHash("sha256").update(JSON.stringify(out)).digest("hex"));
    if (pass === 0) rows = out;
  }
  const elapsed = Date.now() - started;
  const identical = digests.every((digest) => digest === digests[0]);

  writeFileSync(
    join(here, "results", `${dataset.name}_rows.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  writeFileSync(
    join(here, "results", `${dataset.name}_determinism.json`),
    JSON.stringify({
      dataset: dataset.name, items: items.length, repeats: REPEAT,
      identical, digests,
      ms_per_item_per_pass: Number((elapsed / REPEAT / items.length).toFixed(4)),
    }, null, 2) + "\n",
  );
  manifest.datasets.push({
    name: dataset.name, label_kind: dataset.label, items: items.length,
    deterministic: identical, digest: digests[0],
  });

  console.log(
    `${dataset.name.padEnd(20)} items=${String(items.length).padStart(5)}  ` +
    `label=${dataset.label.padEnd(11)} determinism=${identical ? "IDENTICAL" : "DIVERGED"}  ` +
    `${(elapsed / REPEAT / items.length).toFixed(3)} ms/item  digest=${digests[0].slice(0, 16)}`,
  );
}

writeFileSync(join(here, "results", "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
