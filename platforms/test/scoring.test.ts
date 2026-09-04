import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPONENTS,
  INCLUDED_COMPONENT_KEYS,
  MIGRATION,
  PPM,
  SRS_VERSION,
  TIEBREAK_BAND_PPM,
  clampPpm,
  contentTokenList,
  contentTokens,
  divRound,
  ppmToDecimalString,
  ratioPpm,
  structuralComponents,
  structuralResolution,
  tierRiskPpm,
  type ScoredCard,
} from "../src/scoring.js";

/**
 * A card stub. Built by hand rather than by calling the verifier, so these tests pin
 * `scoring.ts` alone and stay green while `src/lite.ts` and its dependencies are being
 * edited elsewhere. The integration path is exercised by `research/scoring/run_scoring.mjs`
 * against the real verifier.
 */
function card(overrides: Partial<ScoredCard> = {}): ScoredCard {
  const dimensions: Record<string, number> = {
    claim_coverage: 1, calibration: 0.9, citation_transparency: 0.85, specificity_support: 0.9,
    answer_relevance: 1, internal_consistency: 1, arithmetic_integrity: 0.9,
    instruction_resilience: 1, input_resilience: 1, credential_safety: 1,
    execution_safety: 1, network_boundary: 1, verification_scope: 0.9,
  };
  return {
    ecs: { total: 0.9577, dimensions },
    claims: [],
    red_team: { probes: [{ angle: "arithmetic_sanity", passed: true, evidence: [] }] },
    ...overrides,
  };
}

function claim(text: string, extra: Partial<ScoredCard["claims"][number]> = {}) {
  return {
    text,
    supporting_evidence: [] as readonly string[],
    attack_surface: ["External factual truth is not verified by Lite."] as readonly string[],
    status: "assumed",
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------
// Fixed-precision arithmetic. The determinism claim rests entirely on these.
// ---------------------------------------------------------------------------------------

test("divRound is exact and rounds halves toward +infinity", () => {
  assert.equal(divRound(7, 2), 4);
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(-5, 2), -2);   // -2.5 -> -2, toward +infinity
  assert.equal(divRound(4, 2), 2);
  assert.equal(divRound(0, 13), 0);
  assert.equal(divRound(-7, -2), 4);
  // Agrees with the integer formula a Python port must use, over the whole feature range.
  for (let n = -5_000; n <= 5_000; n += 7) {
    for (const d of [1, 2, 3, 7, 11, 13, 24, 512, 1_000_000]) {
      assert.equal(divRound(n, d), Math.floor((2 * n + d) / (2 * d)), `${n}/${d}`);
    }
  }
});

test("divRound survives the magnitudes ratioPpm actually produces", () => {
  // 1e6 * a numerator that a double division can misplace by one ulp.
  assert.equal(divRound(999_999 * PPM, 1_000_000), 999_999);
  assert.equal(divRound(1 * PPM, 3), 333_333);
  assert.equal(divRound(2 * PPM, 3), 666_667);
  assert.throws(() => divRound(1, 0), RangeError);
  assert.throws(() => divRound(1.5, 2), RangeError);
});

test("ratioPpm is total, clamped, and zero on an empty denominator", () => {
  assert.equal(ratioPpm(0, 0), 0);
  assert.equal(ratioPpm(5, 0), 0);
  assert.equal(ratioPpm(1, 2), 500_000);
  assert.equal(ratioPpm(1, 3), 333_333);
  assert.equal(ratioPpm(3, 3), PPM);
  assert.equal(ratioPpm(9, 3), PPM, "clamped rather than exceeding one");
  assert.equal(clampPpm(-1), 0);
  assert.equal(clampPpm(PPM + 1), PPM);
});

test("ppmToDecimalString never prints a float and pads to six places", () => {
  assert.equal(ppmToDecimalString(PPM), "1.000000");
  assert.equal(ppmToDecimalString(0), "0.000000");
  assert.equal(ppmToDecimalString(957_700), "0.957700");
  assert.equal(ppmToDecimalString(1), "0.000001");
  assert.equal(ppmToDecimalString(-1), "-0.000001");
  // Byte-equal to Python's f"{n // 10**6}.{n % 10**6:06d}" for every value tested.
  for (const value of [0, 1, 9, 10, 99_999, 100_000, 999_999, PPM]) {
    const expected = `${Math.floor(value / PPM)}.${String(value % PPM).padStart(6, "0")}`;
    assert.equal(ppmToDecimalString(value), expected);
  }
  assert.throws(() => ppmToDecimalString(0.5), RangeError);
});

// ---------------------------------------------------------------------------------------
// The order-refinement invariant, which is the load-bearing property of the design.
// ---------------------------------------------------------------------------------------

/** Every value `scoreDimensions()` in src/lite.ts can emit, pass and fail. */
const LATTICE: Array<[number, number]> = [
  [1, 0.45], [0.9, 0.35], [0.85, 0.45], [0.9, 0.4], [1, 0.35], [1, 0.05], [0.9, 0.05],
  [1, 0.25], [1, 0.05], [1, 0], [1, 0.05], [1, 0], [0.9, 0.4],
];

test("the ECS lattice's minimum spacing exceeds the tiebreak band", () => {
  // Enumerating all 8 192 corners is cheap and is the only way to know the band is safe
  // rather than probably safe.
  const totals = new Set<number>();
  for (let mask = 0; mask < 1 << LATTICE.length; mask += 1) {
    let sum = 0;
    for (let bit = 0; bit < LATTICE.length; bit += 1) {
      const [pass, fail] = LATTICE[bit]!;
      sum += Math.round(((mask >> bit) & 1 ? fail : pass) * PPM);
    }
    totals.add(divRound(sum, LATTICE.length));
  }
  const sorted = [...totals].sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < sorted.length; i += 1) minGap = Math.min(minGap, sorted[i]! - sorted[i - 1]!);
  // 171, not 2^13: the thirteen pass/fail deltas collide heavily (four of them are
  // exactly 0.95, two are 1.00, two are 0.55, two are 0.50), so most of the 8 192 corners
  // land on a value another corner already occupies. 171 is therefore the *ceiling* on
  // `ecs.total`'s resolution over every input that could ever exist, against the 6 to 29
  // values actually observed on the external corpora.
  assert.equal(sorted.length, 171, "distinct achievable ECS values on the full lattice");
  assert.equal(minGap, 3_846, "minimum spacing of the ECS lattice, in ppm");
  assert.ok(
    TIEBREAK_BAND_PPM < minGap,
    `the tiebreak band (${TIEBREAK_BAND_PPM}) must stay inside the lattice gap (${minGap})`,
  );
});

test("SRS-1 never reorders a pair the ECS already ordered", () => {
  const safer = card();
  const riskier = card({
    ecs: { total: 0, dimensions: { ...card().ecs.dimensions, internal_consistency: 0.05 } },
  });
  // Give the safer answer the worst possible gradient and the riskier one the best.
  const saferInput = { question: "q", answer: "In 2019, 47% of 1,204 items guaranteed 3.5 kg." };
  const riskierInput = { question: "q", answer: "maybe" };
  const saferScore = structuralResolution(saferInput, safer);
  const riskierScore = structuralResolution(riskierInput, riskier);
  assert.ok(
    riskierScore.risk_ppm > saferScore.risk_ppm,
    `tier order must dominate the gradient: ${riskierScore.risk_ppm} vs ${saferScore.risk_ppm}`,
  );
  assert.ok(saferScore.gradient_ppm > riskierScore.gradient_ppm, "the gradient really did invert");
});

test("tierRiskPpm reproduces the ECS exactly and drops dimensions on request", () => {
  const dimensions = card().ecs.dimensions;
  // sum = 12.45, /13 = 0.957692..., so risk = 1 - 0.957692 = 0.042308.
  assert.equal(tierRiskPpm(dimensions), PPM - 957_692);
  // Order-identical to 1 - ecs.total for every corner of the lattice.
  const keys = Object.keys(dimensions);
  for (let mask = 0; mask < 1 << 13; mask += 149) {
    const variant: Record<string, number> = {};
    keys.forEach((key, bit) => {
      const [pass, fail] = LATTICE[bit]!;
      variant[key] = (mask >> bit) & 1 ? fail : pass;
    });
    const total = Object.values(variant).reduce((a, b) => a + b, 0) / 13;
    assert.equal(tierRiskPpm(variant), PPM - divRound(Math.round(total * 13 * PPM), 13));
  }
  const dropped = tierRiskPpm(dimensions, new Set(["answer_relevance"]));
  assert.equal(dropped, PPM - divRound(Math.round(11.45 * PPM), 12));
  assert.equal(tierRiskPpm({}), 0, "an empty dimension map is 0, not NaN");
});

test("tierVariant: none yields the gradient alone", () => {
  const input = { question: "q", answer: "In 2019, 47% of items." };
  const withTier = structuralResolution(input, card());
  const bare = structuralResolution(input, card(), { tierVariant: "none" });
  assert.equal(bare.tier_ppm, 0);
  assert.equal(bare.risk_ppm, bare.gradient_ppm);
  assert.ok(withTier.tier_ppm > 0);
});

// ---------------------------------------------------------------------------------------
// Resolution. The reason the module exists.
// ---------------------------------------------------------------------------------------

test("resolution: answers the ECS ties receive distinct SRS values", () => {
  // All six pass every probe in the stub, so `ecs.total` is identical across them and a
  // tie-blind score would rank them arbitrarily. The gradient must separate them.
  const answers = [
    "The capital of France is Paris, a city of 2.1 million people.",
    "It is Paris. This has been true since 1944. The population is 2,148,271.",
    "Paris.",
    "The answer is Paris, which is certainly correct and always has been.",
    "Paris is the capital. Paris is not the capital.",
    "Roughly 2 million people live in the French capital.",
  ];
  const scores = new Set<number>();
  for (const answer of answers) {
    const claims = answer.split(/(?<=[.!?])\s+/).filter(Boolean).map((text) => claim(text));
    const value = structuralResolution(
      { question: "What is the capital of France?", answer },
      card({ claims }),
    );
    assert.equal(value.tier_ppm, PPM - 957_692, "tier is identical by construction");
    scores.add(value.risk_ppm);
  }
  assert.equal(scores.size, answers.length, "six ECS-tied answers must receive six SRS values");
});

test("resolution has a floor: two answers with the same structure still tie", () => {
  // Stated rather than hidden. Every length-shaped and topicality-shaped feature is
  // excluded on principle, so two single-claim answers that carry no number, no citation,
  // no proper noun and no contradiction are structurally indistinguishable and SRS-1 ties
  // them — correctly, because there is nothing structural to tell them apart. This is the
  // ceiling on how far resolution alone can go, and `research/scoring/` measures where the
  // real corpora sit against it.
  const left = structuralResolution({ question: "why?", answer: "because it does." },
    card({ claims: [claim("because it does.")] }));
  const right = structuralResolution({ question: "why?", answer: "since they cannot." },
    card({ claims: [claim("since they cannot.")] }));
  assert.equal(left.risk_ppm, right.risk_ppm);
});

test("components: densities move with the quantity they measure", () => {
  const one = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("In 2019 the figure was 47%."), claim("Nothing specific here.")],
  }));
  const both = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("In 2019 the figure was 47%."), claim("By 2020 it reached 51%.")],
  }));
  assert.equal(one.unsupported_specificity_density, 500_000);
  assert.equal(both.unsupported_specificity_density, PPM);
  assert.equal(structuralComponents({ question: "q", answer: "a" }, card()).unsupported_specificity_density, 0,
    "no claims means zero, not a division by zero");
});

test("components: card-derived counts are read, not re-derived", () => {
  const components = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [
      claim("Cited.", {
        supporting_evidence: ["Unverified citation marker: (Smith 2019)"],
        attack_surface: ["External factual truth is not verified by Lite.", "Citation markers require external validation."],
      }),
      claim("Recomputed.", { supporting_evidence: ["Locally recomputed: 2 + 2 = 4"], status: "observed" }),
      claim("Certain.", {
        attack_surface: ["External factual truth is not verified by Lite.", "Absolute-certainty language may be unsupported."],
      }),
      claim("Bare."),
    ],
  }));
  assert.equal(components.evidence_deficit, 500_000, "two of four claims carry no evidence");
  assert.equal(components.assumed_claim_ratio, 750_000);
  assert.equal(components.citation_marker_burden, 250_000);
  assert.equal(components.certainty_density, 250_000);
  assert.equal(components.attack_surface_load, ratioPpm(2, 16));
});

test("components: contradiction pressure keeps the near miss the probe discards", () => {
  const contradictory = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("The service is available."), claim("The service is not available.")],
  }));
  const unrelated = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("The service is available."), claim("Rain is not expected in Lisbon.")],
  }));
  assert.ok(contradictory.contradiction_pressure! > unrelated.contradiction_pressure!);
  assert.ok(contradictory.contradiction_pressure! > 500_000);
  // A single claim has no pairs, so every pairwise component is zero rather than NaN.
  const single = structuralComponents({ question: "q", answer: "a" }, card({ claims: [claim("Only one.")] }));
  assert.equal(single.contradiction_pressure, 0);
  assert.equal(single.claim_graph_density, 0);
  assert.equal(single.numeric_frame_collision, 0);
});

test("components: numeric frame collision sees a repeated frame with different numbers", () => {
  const collides = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("The total was 40 units."), claim("The total was 50 units.")],
  }));
  assert.equal(collides.numeric_frame_collision, PPM);
  const agrees = structuralComponents({ question: "q", answer: "a" }, card({
    claims: [claim("The total was 40 units."), claim("The total was 40 units.")],
  }));
  assert.equal(agrees.numeric_frame_collision, 0);
});

test("components: identifier defects are computed arithmetic, not a lookup", () => {
  const good = structuralComponents(
    { question: "q", answer: "See ISBN 978-0-306-40615-7 and 0000-0002-1825-0097." }, card());
  assert.equal(good.identifier_defect_ratio, 0, "two identifiers, both check digits agree");
  const bad = structuralComponents(
    { question: "q", answer: "See ISBN 978-0-306-40615-8 and 0000-0002-1825-0098." }, card());
  assert.equal(bad.identifier_defect_ratio, PPM, "both check digits disagree with their digits");
  const none = structuralComponents({ question: "q", answer: "No identifier here." }, card());
  assert.equal(none.identifier_defect_ratio, 0, "no identifier is 0, not a division by zero");
});

test("components: numeric density is scale-free", () => {
  const short = structuralComponents({ question: "q", answer: "In 2019 sales hit 47." }, card());
  const long = structuralComponents(
    { question: "q", answer: "In 2019 sales hit 47. " + "In 2019 sales hit 47. ".repeat(9) }, card());
  assert.equal(short.numeric_density, long.numeric_density,
    "repeating the same text ten times must not change a ratio feature");
  assert.equal(short.numeric_density, ratioPpm(2, 4), "two numbers against two content tokens");
});

// ---------------------------------------------------------------------------------------
// Sign discipline, which is the project's commitment and not a tuning choice.
// ---------------------------------------------------------------------------------------

test("every component declares a direction and a rationale", () => {
  assert.ok(COMPONENTS.length >= 15);
  for (const component of COMPONENTS) {
    assert.equal(typeof component.higher_is_riskier, "boolean", component.key);
    assert.ok(component.rationale.length > 60, `${component.key} needs a stated rationale`);
    assert.ok(component.refines.length > 0, component.key);
    if (!component.included) {
      assert.match(component.rationale, /EXCLUDED/, `${component.key} must say why it is excluded`);
    }
  }
  assert.equal(new Set(COMPONENTS.map((c) => c.key)).size, COMPONENTS.length, "keys are unique");
});

test("only components whose direction is derivable a priori enter the pool", () => {
  for (const key of INCLUDED_COMPONENT_KEYS) {
    const spec = COMPONENTS.find((component) => component.key === key)!;
    assert.equal(spec.higher_is_riskier, true, `${key} is pooled, so it must be oriented as risk`);
  }
  const excluded = COMPONENTS.filter((component) => !component.included).map((component) => component.key);
  assert.deepEqual(excluded.sort(), [
    "answer_token_norm", "claim_count_norm", "claim_graph_density", "question_coverage_deficit",
  ]);
  // The length-shaped features are excluded, so the pool cannot import the HaluEval QA
  // form artefact that a length-only detector scores AUROC 0.9737 on.
  assert.ok(!INCLUDED_COMPONENT_KEYS.includes("claim_count_norm"));
  assert.ok(!INCLUDED_COMPONENT_KEYS.includes("answer_token_norm"));
});

test("the pooled gradient covers every included component and nothing else", () => {
  const components = structuralComponents({ question: "q", answer: "a" }, card());
  for (const component of COMPONENTS) {
    assert.ok(component.key in components, `${component.key} is specified but not computed`);
  }
  assert.equal(Object.keys(components).length, COMPONENTS.length,
    "a computed component with no spec would be pooled without a declared direction");
});

test("max pooling is available and does not dilute a single component", () => {
  const input = { question: "q", answer: "It is 2019." };
  const claims = [claim("In 2019 the figure was 47%.")];
  const mean = structuralResolution(input, card({ claims }), { pool: "mean" });
  const max = structuralResolution(input, card({ claims }), { pool: "max" });
  assert.ok(max.gradient_max_ppm >= mean.gradient_ppm);
  assert.equal(max.risk_ppm >= mean.risk_ppm, true);
  assert.equal(mean.pool, "mean");
  assert.equal(max.pool, "max");
});

// ---------------------------------------------------------------------------------------
// Determinism and presentation.
// ---------------------------------------------------------------------------------------

test("the score is reproducible byte for byte and carries no float", () => {
  const input = { question: "What happened in 2019?", answer: "In 2019, 47% of 1,204 sites closed." };
  const claims = [claim("In 2019, 47% of 1,204 sites closed.")];
  const first = structuralResolution(input, card({ claims }));
  const second = structuralResolution(input, card({ claims }));
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  for (const [key, value] of Object.entries(first.components)) {
    assert.ok(Number.isSafeInteger(value), `${key} = ${value} is not an integer`);
    assert.ok(value >= 0 && value <= PPM, `${key} = ${value} is out of range`);
  }
  for (const key of ["risk_ppm", "score_ppm", "tier_ppm", "gradient_ppm", "gradient_max_ppm"] as const) {
    assert.ok(Number.isSafeInteger(first[key]), `${key} must be an integer`);
  }
  assert.equal(typeof first.score, "string", "the hash-safe form is a decimal string");
  assert.equal(first.score, ppmToDecimalString(first.score_ppm));
  assert.equal(first.score_ppm + first.risk_ppm, PPM);
  assert.equal(first.version, SRS_VERSION);
});

test("the module is import-free, so no in-flight file can break it", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/scoring.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m, "scoring.ts must have no imports");
  assert.doesNotMatch(source, /new Date|Date\.now|Math\.random|process\.env|require\(/,
    "no clock, no randomness, no environment, no dynamic require");
});

test("empty and hostile inputs do not throw", () => {
  const empties: Array<{ question: string; answer: string }> = [
    { question: "", answer: "" },
    { question: " ", answer: "\n\n" },
    { question: "?", answer: "0" },
    { question: "a".repeat(6_000), answer: "1 ".repeat(4_000) },
  ];
  for (const input of empties) {
    const value = structuralResolution(input, card());
    assert.ok(Number.isSafeInteger(value.risk_ppm), JSON.stringify(input).slice(0, 40));
    assert.ok(value.risk_ppm >= 0 && value.risk_ppm <= PPM);
  }
});

test("contentTokens drops stop words and bare numerals", () => {
  assert.deepEqual([...contentTokens("The cat is not on the 47 mats")].sort(), ["cat", "mats"]);
  assert.deepEqual([...contentTokens("")], []);
  // The list form keeps repeats; the set form does not. Conflating them was a real bug.
  assert.deepEqual(contentTokenList("cat cat mats"), ["cat", "cat", "mats"]);
  assert.equal(contentTokens("cat cat mats").size, 2);
});

test("the migration record names the two hashes and their costs", () => {
  assert.equal(MIGRATION.platforms_trace_hash, "unchanged");
  assert.equal(MIGRATION.mcp_log_id, "breaking-if-added-to-preimage");
  assert.equal(MIGRATION.remote_card_schema, "compatible");
  assert.equal(MIGRATION.verdict, "must-not-consume-srs");
  assert.ok(MIGRATION.consumers.length >= 3);
});

// ---------------------------------------------------------------------------------------
// The determinism claim, checked against the actual canonicaliser rather than asserted.
// ---------------------------------------------------------------------------------------

test("the resolution object is hashable under sha256_canonical_json_v1", async () => {
  // src/canonical.ts throws CanonicalJsonError("float") on any non-integer number,
  // because Python prints 1.0 as "1.0" and JavaScript prints it as "1". A score that
  // cannot enter a hash preimage cannot be committed to, so this is the load-bearing
  // check on "fixed-precision arithmetic, no floats in anything hashed".
  const { sha256Canonical, CanonicalJsonError } = await import("../src/canonical.js");
  const value = structuralResolution(
    { question: "What happened in 2019?", answer: "In 2019, 47% of 1,204 sites closed." },
    card({ claims: [claim("In 2019, 47% of 1,204 sites closed.")] }),
  );
  const preimage = {
    version: value.version,
    risk_ppm: value.risk_ppm,
    score: value.score,           // the decimal string, not a float
    tier_ppm: value.tier_ppm,
    gradient_ppm: value.gradient_ppm,
    components: value.components,
  };
  const digest = sha256Canonical(preimage);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, sha256Canonical(preimage), "same input, same digest");

  // And the negative control: the raw ECS total cannot go in, which is exactly why the
  // new score is emitted as ppm integers plus a decimal string.
  assert.throws(
    () => sha256Canonical({ ecs_total: 0.9577 }),
    (error: unknown) => error instanceof CanonicalJsonError && error.code === "float",
  );
});
