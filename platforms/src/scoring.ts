/**
 * SRS-1 — Structural Resolution Score, version 1.
 *
 * ## The problem this exists to solve
 *
 * `ecs.total` in `src/lite.ts` is the unweighted mean of `scoreDimensions(probes)`. That
 * function maps each of thirteen probes to **exactly two** values by pass/fail:
 *
 *     claim_coverage: pass 1.00 / fail 0.45      answer_relevance: pass 1.00 / fail 0.35
 *     calibration:    pass 0.90 / fail 0.35      internal_consistency: 1.00 / 0.05
 *     ... thirteen of these, then mean() ...
 *
 * Every dimension value is a multiple of 0.05, so the mean is a multiple of 0.05/13 and
 * the achievable set is a 2^13 lattice with a minimum spacing of 0.003846. In principle
 * that is 8 192 points. In practice nine of the thirteen probes almost never fire on
 * prose, so the *observed* set is tiny and its mass sits on one point — the all-pass
 * value 0.9577:
 *
 *   | corpus            |     n | distinct `ecs.total` | modal share |
 *   |-------------------|------:|---------------------:|------------:|
 *   | TruthfulQA        | 1 580 |                    6 |       0.919 |
 *   | HaluEval QA       | 4 000 |                   11 |       0.794 |
 *   | HaluEval Dialogue | 4 000 |                   10 |       0.797 |
 *   | HaluEval General  | 5 000 |                   29 |       0.762 |
 *
 * Measured directly from `research/external/results/*_results.jsonl`. A score that is
 * constant across 92 % of its input cannot rank that input, and no cut point repairs it:
 * the ceiling is set by the granularity, not by the threshold. On TruthfulQA the two
 * answers to one question receive an identical score in 92.9 % of pairs.
 *
 * The cause is that a *continuous* underlying quantity is thrown away at the probe
 * boundary. `unsupported_specificity` knows how many claims carried an unsourced
 * specific and how many claims there were; it reports one bit. `polarityContradiction`
 * computes a Jaccard overlap and compares it to 0.72; it reports one bit. SRS-1 keeps
 * the quantities.
 *
 * ## Design
 *
 * SRS-1 is a **strict order refinement** of the ECS, not a replacement for it:
 *
 *     srs_risk_ppm = tier_ppm + round(gradient_ppm * TIEBREAK_BAND / 1e6)
 *
 * `tier_ppm` is `1e6 - ecs.total` in parts per million, recomputed exactly from
 * `ecs.dimensions` with integer arithmetic. `gradient_ppm` is in [0, 1e6] and is scaled
 * into a band of `TIEBREAK_BAND` = 3 000 ppm, which is strictly narrower than the 3 845
 * ppm minimum spacing of the ECS lattice (proved in `test/scoring.test.ts` by
 * enumerating the lattice). Therefore:
 *
 *   * every pair the ECS *ordered*, SRS-1 orders the same way — it cannot regress a
 *     comparison the existing score already got right or wrong;
 *   * every pair the ECS *tied*, SRS-1 breaks with the continuous gradient.
 *
 * That property is the whole point of the construction, because it makes the measurement
 * clean. Any change in AUROC between `ecs_risk` and `srs_risk` is attributable *entirely*
 * to the gradient's behaviour on the pairs the ECS could not separate, and the harness in
 * `research/scoring/` reports exactly that decomposition. If the gradient carries no
 * semantic signal the AUROC will not move while the tie rate collapses — which is a
 * result, not a failure of the experiment.
 *
 * ## Determinism
 *
 * Every quantity here is an **integer in parts per million**. There are no floats in any
 * value intended for a hash, for the reason `src/canonical.ts` documents at length:
 * Python prints the float 1.0 as `1.0` and JavaScript prints it as `1`, so a float in a
 * hash preimage produces a digest that verifies in one runtime and fails in the other.
 * `divRound` performs exact integer division with round-half-toward-+infinity and
 * corrects the one-ulp error a double division can introduce, so a Python
 * re-implementation using `(2*a + b) // (2*b)` agrees on every input. No clock, no
 * randomness, no model, no network, no I/O.
 *
 * ## SRS-1 is not a probability
 *
 * It is a structural score, exactly as the ECS is, and the same prohibition applies: it
 * must never be presented as a calibrated probability that an answer is true. It is a
 * *ranking* quantity, and `research/scoring/` presents it the only honest way an
 * uncalibrated ranking quantity can be presented — as a risk-coverage curve, which asks
 * "if you review the riskiest k %, what do you catch", and never as a threshold with an
 * implied confidence.
 *
 * ## The sign problem
 *
 * `research/external/EXTERNAL_RESULTS.md` found that `answer_relevance` points the wrong
 * way on all four corpora (solo AUROC 0.463-0.493) and that the uniform mean therefore
 * scores 0.5170 while its best component reaches 0.5311 — the aggregate is worse than its
 * best part because it pools components that disagree in direction.
 *
 * **No weight here is fitted to a label.** Fitting would make this a trained classifier
 * and break the zero-inference commitment, which is the point of the project. Instead
 * every component carries a declared `direction` derived from the project's own stated
 * semantics — the direction in which the corresponding probe was *authored* to fire — and
 * only components whose direction is derivable a priori enter the aggregate. Components
 * whose direction is not derivable are computed, exported and measured, but excluded from
 * the pool and marked `included: false` with the reason recorded in
 * `EXCLUDED_COMPONENTS`. With sign discipline enforced, a uniform mean needs no further
 * justification: there is no structural basis for preferring one property over another,
 * and the failure the external report identified was disagreement in sign, not a bad
 * choice of weights.
 *
 * Two pooling rules are exported, both weight-free:
 *
 *   * `mean`  — every property contributes equally.
 *   * `max`   — the score is bounded by its weakest property. This is the conjunctive
 *               reading a safety score usually wants (one unsourced specific is not
 *               cancelled by the absence of a credential leak) and, unlike the mean, it
 *               does not dilute a single discriminating component with ten inert ones.
 *
 * Both are reported. Neither is blessed here, because choosing between them on the
 * strength of a label AUROC would be the fit this module refuses to perform.
 *
 * ## Measured
 *
 * `research/scoring/` runs the deployed verifier and this module over all seven corpora
 * the project has — 14 893 items, byte-identical across two passes, 5.5 s total — and
 * writes `results/REPORT.txt` and `results/SUMMARY.json`. `srs_sign` below is the
 * default proposal. `len` is a length-only detector on the same split, and (*) marks the
 * two corpora whose classes differ in answer *form*, where it is the artefact and not a
 * baseline anyone can beat honestly.
 *
 *   | corpus              |     n | distinct  | paired/x-class tie | AUROC             |   len |
 *   |---------------------|------:|-----------|--------------------|-------------------|------:|
 *   | TruthfulQA          | 1 580 | 6 -> 134  | 0.942 -> 0.516     | 0.4911 -> 0.5507  | 0.423 |
 *   | HaluEval QA (*)     | 4 000 | 10 -> 389 | 0.770 -> 0.088     | 0.4836 -> 0.5789  | 0.974 |
 *   | HaluEval Dialog (*) | 4 000 | 10 -> 590 | 0.880 -> 0.176     | 0.4942 -> 0.5957  | 0.716 |
 *   | HaluEval General    | 5 000 | 27 ->1005 | 0.641 -> 0.026     | 0.5225 -> 0.5720  | 0.467 |
 *   | GBSA-1 main         |   112 | 8 ->   37 | 0.114 -> 0.018     | 0.9296 -> 0.9775  | 0.413 |
 *   | GBSA-1 heldout      |    75 | 7 ->   21 | 0.103 -> 0.048     | 0.9274 -> 0.9644  | 0.397 |
 *   | GBSA-2              |   126 | 9 ->   54 | 0.355 -> 0.059     | 0.6904 -> 0.8355  | 0.460 |
 *
 * Regenerated against the working tree at the time of writing. `src/lite.ts`,
 * `src/signals.ts` and `src/citation.ts` were being edited concurrently, and the probe
 * changes landing there moved the `ecs_risk` baseline by up to 0.011 on the external
 * splits and by 0.10 on GBSA-2 between two runs an hour apart. Re-run both scripts before
 * quoting any figure here; the runner's determinism digests are what tell you whether the
 * verifier under test is the one these numbers were taken from.
 *
 * Four things in that table, in descending order of how much they should be trusted.
 *
 * **1. Resolution is fixed, and it is the part that is not in doubt.** It is a property
 * of the construction, so it needs no label to be true. The one target missed is
 * TruthfulQA, where the paired tie rate lands at 0.516 rather than "well below 0.50" and
 * the distinct count is 134 rather than several hundred. The cause is measured, not
 * guessed: 98.9 % of TruthfulQA answers are a *single* claim, 94.9 % contain no numeric
 * token, and 61.3 % contain no mid-sentence capital. For a one-sentence span with no
 * number, no entity, no citation, no arithmetic and no second sentence to contradict,
 * every pooled component is either 0 or saturated, and the only quantities that still
 * differ between "The watermelon seeds pass through your digestive system" and "You grow
 * watermelons in your stomach" are answer length and question overlap — the two features
 * excluded on principle. **The resolution target and sign discipline are in direct
 * tension on short-answer corpora, and this design resolves that in favour of sign
 * discipline.** `test/scoring.test.ts` pins the floor rather than hiding it.
 *
 * **2. The attribution is exact.** Because the gradient cannot reorder a pair the ECS
 * decided, every AUROC change is located on the pairs the ECS tied, and the harness
 * reports that directly. `decided_pairs_reordered` is 0 on all three paired corpora, as
 * the band argument requires. On the newly broken pairs the hallucinated answer is ranked
 * riskier 0.6629 of the time on TruthfulQA (95% CI [0.612, 0.710], 353 pairs), 0.5791 on
 * HaluEval QA (1 385 pairs) and 0.6437 on Dialogue (1 420 pairs), all with p < 0.0001.
 * The continuous quantities are not noise on the mass the ECS could not separate.
 *
 * **3. "The whole is worse than its best part" is fixed, and the fix is sign discipline
 * rather than weights.** `EXTERNAL_RESULTS.md` measured the aggregate at 0.5170 against a
 * best component of 0.5311, a deficit of 0.0141. Against the best component the pool
 * *actually contains*, `srs_sign` now sits at +0.0074 (TruthfulQA), -0.0023 (QA),
 * -0.0048 (Dialogue) and -0.0006 (General) — at or above parity, well inside interval
 * width, and decisively above it on all three GBSA splits (+0.20 to +0.24). Keeping
 * `answer_relevance` in the tier costs 0.02 to 0.05 of AUROC on every external split,
 * which is independent confirmation of the external report's diagnosis.
 *
 * **4. Two honest negatives.**
 *
 *   * **Max pooling does not work here.** `evidence_deficit` is 1.0 on 98-100 % of items
 *     on every corpus, because a claim with no citation marker and no recomputable
 *     arithmetic is the normal case in prose. The max is therefore pinned at 1.0,
 *     `gradient_max_only` has AUROC exactly 0.5000, and `srs_max` is numerically
 *     identical to `ecs_risk`. The conjunctive reading is the right one in principle and
 *     is unusable until the saturating components are re-scaled. Reported, not removed.
 *   * **Uniform weights alias.** With equal weights the components are interchangeable, so
 *     an answer with `assumed_claim_ratio` high and `unsupported_specificity_density` low
 *     sums to the same total as one with those swapped. The harness measures it: 8.8 % to
 *     19.8 % of distinct component *vectors* collapse onto a shared scalar. Any weighting
 *     chosen to avoid that would be arbitrary, and one chosen to improve an AUROC would be
 *     a fit. The correct fix is to emit the vector, which the card already does for
 *     `ecs.dimensions`.
 *
 * Where this leaves the underlying question the external report raised — "badly
 * constructed score" or "structural signals cannot do this task" — the answer the data
 * supports is **both, in that order**. The score was badly constructed, and repairing its
 * construction moves the two length-neutral corpora from chance to a small but
 * interval-separated signal: TruthfulQA 0.4911 [0.482, 0.499] to 0.5507 [0.534, 0.567],
 * General 0.5225 [0.508, 0.536] to 0.5720 [0.551, 0.591], and General's triage lift at
 * 5 % coverage from 1.38x to 1.90x (10 %: 1.02x to 1.75x). On TruthfulQA the old score's
 * triage lift was 0.864 at 5 % coverage — *below* 1.0, meaning reviewing the answers the
 * ECS called riskiest was worse than reviewing at random; the gradient puts that at
 * 1.139. And 0.55 is still 0.55. Resolution was the binding
 * constraint on *using* the score at all; it was never going to be the constraint that,
 * once released, produced a hallucination detector. Nothing here changes the positioning
 * `EXTERNAL_RESULTS.md` argues for.
 *
 * ## Backward compatibility
 *
 * `ecs.total` and `ecs.dimensions` are untouched, and this module is wired to nothing.
 * The intended integration is additive — `ecs.resolution?: StructuralResolution` — for
 * which the verified costs are recorded in `MIGRATION` below.
 *
 * ## Known duplication
 *
 * `STOP_WORDS`, `NEGATION`, and the numeric-token regex are re-declared here rather than
 * imported, because `src/lite.ts` does not export them and this module must not modify
 * it. At integration they should be lifted into a shared module; until then the copies
 * are pinned by `test/scoring.test.ts`, which asserts the values this module was measured
 * with rather than assuming they track lite.ts.
 */

/**
 * The card surface this module reads, declared structurally rather than imported.
 *
 * `TrustCard` from `src/types.ts` satisfies this interface, and `structuralResolution`
 * accepts one directly. It is re-declared here so that **this module has no imports at
 * all**: `src/types.ts`, `src/citation.ts`, `src/signals.ts`, `src/toolcall.ts` and
 * `src/lite.ts` are held by other work in progress, and a prototype that imported them
 * would stop compiling whenever one of them was mid-edit. Zero imports also means the
 * module is trivially portable to the Python core, which is where a second
 * implementation would have to agree with it digit for digit.
 */
export interface ScoredCard {
  ecs: { total: number; dimensions: Record<string, number> };
  claims: ReadonlyArray<{
    text: string;
    supporting_evidence: readonly string[];
    attack_surface: readonly string[];
    status: string;
  }>;
  red_team: { probes: ReadonlyArray<{ angle: string; passed: boolean; evidence: readonly string[] }> };
}

/** Version marker. Emitted with every score so a stored score is self-describing. */
export const SRS_VERSION = "srs-1" as const;

/**
 * Width of the tiebreak band, in ppm. Must stay strictly below the minimum spacing of
 * the ECS lattice (3 845 ppm) or the gradient could reorder a pair the ECS decided, and
 * the attribution argument above would no longer hold. `test/scoring.test.ts` enumerates
 * the lattice and asserts the margin.
 */
export const TIEBREAK_BAND_PPM = 3_000;

/** One part per million; scores live on [0, PPM]. */
export const PPM = 1_000_000;

/** The thirteen dimensions `scoreDimensions()` emits, in its own order. */
const ECS_DIMENSION_KEYS = [
  "claim_coverage", "calibration", "citation_transparency", "specificity_support",
  "answer_relevance", "internal_consistency", "arithmetic_integrity",
  "instruction_resilience", "input_resilience", "credential_safety",
  "execution_safety", "network_boundary", "verification_scope",
] as const;

/**
 * Dimensions dropped by the sign-disciplined tier variant.
 *
 * `answer_relevance` is `relevanceProbe()`, a lexical-overlap check: it fails when the
 * answer shares no content token with the question. Restating the question's vocabulary
 * is evidence of *topicality*, not of truth, so a trust score has no structural reason to
 * reward it — the property it measures is real but it is not a trust property. That
 * argument stands on its own; the external report's finding that the component's solo
 * AUROC is below 0.5 on all four corpora is consistent with it but is not the reason it
 * is dropped here, because dropping a component *because* its label AUROC is low is a
 * fit.
 *
 * `calibration` is `unsupported_certainty`. Unhedged absolute certainty is unsupportable
 * from submitted text by construction, so its a-priori direction is sound and it is
 * retained in the default tier; it is listed here only so the variant that excludes both
 * anti-correlated components measured in the external report can be reported alongside.
 */
const SIGN_DISCIPLINE_DROPS = new Set(["answer_relevance"]);

/** Also dropped by the strict variant, for comparison with the external report's pair. */
const SIGN_DISCIPLINE_DROPS_STRICT = new Set(["answer_relevance", "calibration"]);

/**
 * Exact integer division, rounding halves toward +infinity.
 *
 * `Math.round(a / b)` is wrong here for two reasons: `a / b` is a double and can land on
 * the wrong side of a .5 boundary for large integers, and `Math.round` and Python's
 * `round` disagree on halves (half-up versus half-to-even). The float quotient is used
 * only as a starting guess and then corrected by integer comparison, so the result is the
 * exact mathematical value of `floor((2a + b) / (2b))` for every input in range — which
 * is the formula a Python port should use.
 */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError("divRound operates on safe integers only.");
  }
  if (denominator === 0) throw new RangeError("divRound: division by zero.");
  if (denominator < 0) return divRound(-numerator, -denominator);
  let quotient = Math.floor(numerator / denominator);
  // Correct any one-ulp error from the double division, then apply the half-up rule.
  while (quotient * denominator > numerator) quotient -= 1;
  while ((quotient + 1) * denominator <= numerator) quotient += 1;
  const remainderTwice = 2 * (numerator - quotient * denominator);
  return remainderTwice >= denominator ? quotient + 1 : quotient;
}

/** A ratio in ppm, clamped to [0, PPM]. An empty denominator is 0, not undefined. */
export function ratioPpm(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clampPpm(divRound(numerator * PPM, denominator));
}

export function clampPpm(value: number): number {
  return value < 0 ? 0 : value > PPM ? PPM : value;
}

/**
 * A ppm integer as a fixed-precision decimal string, six places. Built from the integer's
 * digits rather than `toFixed`, so no float is ever printed and the string is byte-equal
 * to what Python's `f"{n // 10**6}.{n % 10**6:06d}"` produces. This is the sanctioned
 * form for putting a fraction in a hashed record (`src/canonical.ts`, `decimalString`).
 */
export function ppmToDecimalString(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError("ppmToDecimalString: not an integer.");
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value)).padStart(7, "0");
  return `${sign}${digits.slice(0, digits.length - 6)}.${digits.slice(digits.length - 6)}`;
}

// ---------------------------------------------------------------------------------------
// Text primitives. Self-contained; see "Known duplication" above.
// ---------------------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "for", "from", "has",
  "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "their", "there", "these", "this",
  "those", "to", "was", "were", "will", "with", "not", "never", "no", "cannot", "cant", "isnt", "arent",
  "wasnt", "werent", "doesnt", "dont", "didnt", "wont", "wouldnt", "couldnt", "shouldnt", "hasnt", "havent",
  "hadnt", "all", "do", "does", "did", "done", "had", "am", "can", "could", "would", "should",
  "may", "might", "must", "shall",
]);

const NEGATION =
  /\b(?:not|no|never|cannot|can't|cant|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|doesn't|doesnt|don't|dont|didn't|didnt|won't|wont|wouldn't|wouldnt|couldn't|couldnt|shouldn't|shouldnt|hasn't|hasnt|haven't|havent|hadn't|hadnt|without|fails? to|unable to|false)\b/i;

const NUMBER = /[-+]?(?:\d[\d,]{0,30}(?:\.\d{1,15})?|\.\d{1,15})/g;

/** Content tokens: lowercased, apostrophes stripped, stop words and numerals removed. */
export function contentTokens(value: string): Set<string> {
  return new Set(contentTokenList(value));
}

/**
 * The same tokens as a list, keeping repeats.
 *
 * Both forms are needed and they are not interchangeable. A ratio whose numerator counts
 * occurrences and whose denominator counts distinct values is not scale-free: with the
 * distinct-token denominator, `numeric_density` on "In 2019 sales hit 47." repeated ten
 * times rose from 0.50 to 0.91, because the numerator decupled while the denominator was
 * a Set and did not move. That made the component a length proxy, which is precisely what
 * it was introduced to avoid. Pinned by test.
 */
export function contentTokenList(value: string): string[] {
  const raw = value.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) ?? [];
  return raw.filter((token) => !STOP_WORDS.has(token) && !/^\d/.test(token));
}

/**
 * Mid-sentence capitalised tokens: the proper-noun surface of the answer.
 *
 * Sentence-initial words are excluded because their capitalisation is orthographic rather
 * than semantic, as are all-caps tokens, which are usually acronyms or shouting rather
 * than named entities.
 */
function properNounCount(value: string): number {
  let count = 0;
  for (const line of value.split(/(?<=[.!?])\s+|\n+/)) {
    const words = line.trim().split(/\s+/);
    for (let index = 1; index < words.length; index += 1) {
      const word = (words[index] ?? "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (word.length < 2) continue;
      if (word === word.toUpperCase()) continue;
      if (/^\p{Lu}/u.test(word)) count += 1;
    }
  }
  return count;
}

/**
 * Significant digits in a written number: how precisely the quantity was stated.
 *
 * "about 50%" and "47.3%" are the same event to `unsupported_specificity`, which reports
 * one bit for either. They are not the same assertion, and the difference is decidable
 * from the string: leading zeros are not significant, trailing zeros in an integer are
 * not counted as significant, and everything after a decimal point is.
 */
function significantDigits(token: string): number {
  const cleaned = token.replace(/^[-+]/, "");
  if (cleaned.includes(".")) {
    const [whole = "", fraction = ""] = cleaned.split(".");
    const trimmed = whole.replace(/^0+/, "");
    return (trimmed.length + fraction.length) || 1;
  }
  const digits = cleaned.replace(/^0+/, "").replace(/0+$/, "");
  return digits.length || 1;
}

function numericTokens(value: string): string[] {
  return Array.from(value.matchAll(new RegExp(NUMBER.source, "g")))
    .map((match) => match[0].replaceAll(",", ""));
}

/** Number-blind shape of a sentence: the frame two numeric variants would share. */
function numericFrame(value: string): string {
  return value
    .toLowerCase()
    .replace(new RegExp(NUMBER.source, "g"), "#")
    .replace(/[^a-z#]+/g, " ")
    .replace(/\b(?:the|a|an|is|was|are|were)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardPpm(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return ratioPpm(intersection, union);
}

// ---------------------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------------------

/**
 * `higher_is_riskier` is the a-priori direction, taken from the semantics of the probe
 * whose property the component refines — never from a label. `included` says whether the
 * component enters the pooled gradient.
 */
export interface ComponentSpec {
  key: string;
  refines: string;
  higher_is_riskier: boolean;
  included: boolean;
  rationale: string;
}

export const COMPONENTS: readonly ComponentSpec[] = [
  {
    key: "unsupported_specificity_density",
    refines: "unsupported_specificity",
    higher_is_riskier: true, included: true,
    rationale:
      "Share of claims carrying a specific date, amount, identifier, measurement, policy commitment or attributed quote with no citation marker and no locally recomputed arithmetic. The probe reports whether this count is non-zero; the density reports the count over the claims it was measured across.",
  },
  {
    key: "evidence_deficit",
    refines: "claim_extraction",
    higher_is_riskier: true, included: true,
    rationale:
      "Share of claims with an empty supporting_evidence list — no citation marker and no locally recomputed relation. A claim with nothing checkable attached is weaker on the project's own definition of evidence.",
  },
  {
    key: "assumed_claim_ratio",
    refines: "claim_extraction",
    higher_is_riskier: true, included: true,
    rationale:
      "Share of claims whose status is `assumed` rather than `observed` or `reconstructed`. The status is assigned by buildClaim() from local verification and hedging; a higher assumed share is more unverified assertion per unit of answer.",
  },
  {
    key: "attack_surface_load",
    refines: "claim_extraction",
    higher_is_riskier: true, included: true,
    rationale:
      "Attack-surface entries beyond the unconditional baseline one, over the four conditional entries buildClaim() can add, averaged over claims. This is a count the card already carries and never aggregates.",
  },
  {
    key: "citation_marker_burden",
    refines: "citation_verifiability",
    higher_is_riskier: true, included: true,
    rationale:
      "Unverified citation markers per claim. Direction follows the probe: citationProbe() *fails* when markers are present, because a marker asserts support that this system cannot open, authenticate or validate. More unvalidatable assertions of support is more unverified surface, not less.",
  },
  {
    key: "certainty_density",
    refines: "unsupported_certainty",
    higher_is_riskier: true, included: true,
    rationale:
      "Share of claims carrying unhedged absolute-certainty language. Unsupportable from submitted text by construction, which is why the probe exists; the density refines its single bit.",
  },
  {
    key: "numeric_density",
    refines: "unsupported_specificity",
    higher_is_riskier: true, included: true,
    rationale:
      "Numeric tokens per content token in the answer. Scale-free by construction, so it is not a proxy for answer length; it measures how much of the answer consists of quantities this system cannot check.",
  },
  {
    key: "numeric_precision",
    refines: "unsupported_specificity",
    higher_is_riskier: true, included: true,
    rationale:
      "Mean significant digits of the numbers in the answer, over a six-digit saturation point. `unsupported_specificity` reports the same single bit for \"about 50%\" and for \"47.3%\", but the second asserts more, and asserts more that cannot be checked offline. Precision of a stated quantity is the graded form of the property the probe was authored to flag.",
  },
  {
    key: "entity_specificity_density",
    refines: "unsupported_specificity",
    higher_is_riskier: true, included: true,
    rationale:
      "Mid-sentence capitalised tokens per content token. `lite-specificity` requires flagging unsupported high-specificity factual signals; SPECIFIC_FACT_PATTERN recognises dates, amounts, identifiers and measurements but not named entities, so an uncited proper noun is exactly the class of thing the declared requirement covers and the implementation misses. Read the length-controlled columns before trusting it: capitalisation is partly a formatting property, and two of the four external corpora differ in answer form between classes.",
  },
  {
    key: "identifier_defect_ratio",
    refines: "citation_resolvability",
    higher_is_riskier: true, included: true,
    rationale:
      "Identifiers failing their own check digit or their scheme's grammar, over identifiers found. Pure computed arithmetic on the string, which is the strongest class of evidence available offline: the check cannot fail on a correctly transcribed real identifier.",
  },
  {
    key: "arithmetic_defect_ratio",
    refines: "arithmetic_sanity",
    higher_is_riskier: true, included: true,
    rationale:
      "Failed arithmetic relations over relations recomputed. Same class of evidence as the identifier check. Note the cap: arithmeticProbe() truncates its evidence at three, so the failure count saturates there.",
  },
  {
    key: "contradiction_pressure",
    refines: "internal_contradiction",
    higher_is_riskier: true, included: true,
    rationale:
      "Maximum content-token Jaccard over claim pairs of opposite polarity. polarityContradiction() compares this same quantity against 0.72 and reports one bit; the pressure keeps the near misses, which is where a two-sentence answer with a partial self-contradiction lives.",
  },
  {
    key: "numeric_frame_collision",
    refines: "internal_contradiction",
    higher_is_riskier: true, included: true,
    rationale:
      "Share of claim pairs sharing a number-blind frame while carrying different numbers. This is the core of numericContradiction() without its enumerator and distinct-entity guards, used as a graded pressure rather than a verdict.",
  },
  {
    key: "question_coverage_deficit",
    refines: "answer_relevance",
    higher_is_riskier: true, included: false,
    rationale:
      "One minus the share of question content tokens present in the answer. EXCLUDED: lexical overlap with the question measures topicality, not truth, so a trust score has no structural reason to reward it. Computed and reported so the exclusion is auditable rather than asserted.",
  },
  {
    key: "claim_graph_density",
    refines: "internal_contradiction",
    higher_is_riskier: false, included: false,
    rationale:
      "Share of claim pairs sharing at least two content tokens — the edge density of the answer's lexical claim graph. EXCLUDED: the direction is not derivable from structure. A dense graph is more internally checkable (safer) and also more repetitive (a hedging tell); the project's semantics do not settle which, so it is measured and left out of the pool.",
  },
  {
    key: "claim_count_norm",
    refines: "claim_extraction",
    higher_is_riskier: true, included: false,
    rationale:
      "Claim count over the 24-claim reporting cap. EXCLUDED: a monotone function of answer length. On HaluEval QA a length-only detector scores AUROC 0.9737 because the two classes differ in form, so any length-shaped component would import that artefact into the score. Reported as the confound it is.",
  },
  {
    key: "answer_token_norm",
    refines: "claim_extraction",
    higher_is_riskier: true, included: false,
    rationale:
      "Content tokens over 512. EXCLUDED for the same reason as claim_count_norm, and reported for the same purpose.",
  },
];

export const INCLUDED_COMPONENT_KEYS: readonly string[] =
  COMPONENTS.filter((component) => component.included).map((component) => component.key);

export type ComponentVector = Record<string, number>;

export interface StructuralResolution {
  version: typeof SRS_VERSION;
  /** Integer ppm, higher = structurally riskier. */
  risk_ppm: number;
  /** Integer ppm, higher = structurally healthier. The complement of risk_ppm. */
  score_ppm: number;
  /** Fixed-precision decimal string form of score_ppm; the hash-safe representation. */
  score: string;
  /** The ECS re-expressed as integer risk ppm. Preserved exactly. */
  tier_ppm: number;
  /** Pooled gradient in ppm, before scaling into the tiebreak band. */
  gradient_ppm: number;
  /** Max-pooled gradient in ppm; the conjunctive alternative. */
  gradient_max_ppm: number;
  /** Every component, included or not, in ppm. */
  components: ComponentVector;
  pool: "mean" | "max";
}

const MAX_CONDITIONAL_ATTACK_SURFACE = 4;
/** Saturation point for stated numeric precision. Six digits is a bank balance. */
const MAX_SIGNIFICANT_DIGITS = 6;
const CLAIM_CAP = 24;
const TOKEN_NORM = 512;

/**
 * Every component, from the public TrustCard plus the raw question and answer.
 *
 * Deliberately consumes only the card's published surface — `claims`, `red_team.probes`,
 * `ecs.dimensions` — and never `lite.ts` internals, so this module needs no change to
 * any file it does not own and can be integrated or discarded without touching the
 * verifier.
 */
export function structuralComponents(
  input: { question: string; answer: string },
  card: ScoredCard,
): ComponentVector {
  const claims = card.claims;
  const claimCount = claims.length;
  const texts = claims.map((claim) => claim.text);
  const tokenSets = texts.map(contentTokens);

  let noEvidence = 0;
  let assumed = 0;
  let conditionalSurface = 0;
  let citationMarkers = 0;
  let recomputed = 0;
  let certaintyClaims = 0;
  let unsupportedSpecific = 0;

  for (let index = 0; index < claimCount; index += 1) {
    const claim = claims[index]!;
    if (claim.supporting_evidence.length === 0) noEvidence += 1;
    if (claim.status === "assumed") assumed += 1;
    conditionalSurface += Math.max(0, claim.attack_surface.length - 1);
    const markers = claim.supporting_evidence.filter((entry) =>
      entry.startsWith("Unverified citation marker:")).length;
    const local = claim.supporting_evidence.filter((entry) =>
      entry.startsWith("Locally recomputed:")).length;
    citationMarkers += markers;
    recomputed += local;
    if (claim.attack_surface.includes("Absolute-certainty language may be unsupported.")) {
      certaintyClaims += 1;
    }
    // The specificity probe's own conjunction, read off the card: a claim the probe
    // counted is one with no citation marker and no recomputed relation. Its evidence
    // list is capped at three, so the probe's evidence cannot be used as the count; the
    // per-claim reconstruction is not capped.
    if (markers === 0 && local === 0 && SPECIFICITY_HINT.test(claim.text)) {
      unsupportedSpecific += 1;
    }
  }

  const answerTokenList = contentTokenList(input.answer);
  const answerTokens = new Set(answerTokenList);
  const questionTokens = contentTokens(input.question);
  let questionCovered = 0;
  for (const token of questionTokens) if (answerTokens.has(token)) questionCovered += 1;

  const answerNumbers = numericTokens(input.answer);
  const answerNumerics = answerNumbers.length;
  const digitTotal = answerNumbers.reduce((sum, token) => sum + significantDigits(token), 0);
  const properNouns = properNounCount(input.answer);

  const { found: identifiers, defects } = identifierDefects(input.answer);

  const arithmeticProbe = card.red_team.probes.find((probe) => probe.angle === "arithmetic_sanity");
  const arithmeticFailures = arithmeticProbe && !arithmeticProbe.passed
    ? arithmeticProbe.evidence.length
    : 0;
  const arithmeticTotal = arithmeticFailures + recomputed;

  // Pairwise structure over the claim set. Bounded by the 24-claim reporting cap, so at
  // most 276 comparisons.
  let pairs = 0;
  let framePairs = 0;
  let frameCollisions = 0;
  let graphEdges = 0;
  let maxOppositePolarityPpm = 0;
  const negated = texts.map((text) => NEGATION.test(text));
  const frames = texts.map(numericFrame);
  const numerics = texts.map((text) => numericTokens(text).join("|"));
  for (let left = 0; left < claimCount; left += 1) {
    for (let right = left + 1; right < claimCount; right += 1) {
      pairs += 1;
      const overlap = jaccardPpm(tokenSets[left]!, tokenSets[right]!);
      let shared = 0;
      for (const token of tokenSets[left]!) if (tokenSets[right]!.has(token)) shared += 1;
      if (shared >= 2) graphEdges += 1;
      if (negated[left] !== negated[right] && overlap > maxOppositePolarityPpm) {
        maxOppositePolarityPpm = overlap;
      }
      if (numerics[left] !== "" && numerics[right] !== "" && /[a-z]/.test(frames[left]!)) {
        framePairs += 1;
        if (frames[left] === frames[right] && numerics[left] !== numerics[right]) {
          frameCollisions += 1;
        }
      }
    }
  }

  return {
    unsupported_specificity_density: ratioPpm(unsupportedSpecific, claimCount),
    evidence_deficit: ratioPpm(noEvidence, claimCount),
    assumed_claim_ratio: ratioPpm(assumed, claimCount),
    attack_surface_load: ratioPpm(conditionalSurface, claimCount * MAX_CONDITIONAL_ATTACK_SURFACE),
    citation_marker_burden: ratioPpm(citationMarkers, claimCount),
    certainty_density: ratioPpm(certaintyClaims, claimCount),
    numeric_density: ratioPpm(answerNumerics, answerNumerics + answerTokenList.length),
    numeric_precision: ratioPpm(digitTotal, answerNumerics * MAX_SIGNIFICANT_DIGITS),
    entity_specificity_density: ratioPpm(properNouns, answerTokenList.length),
    identifier_defect_ratio: ratioPpm(defects, identifiers),
    arithmetic_defect_ratio: ratioPpm(arithmeticFailures, arithmeticTotal),
    contradiction_pressure: maxOppositePolarityPpm,
    numeric_frame_collision: ratioPpm(frameCollisions, framePairs),
    question_coverage_deficit: questionTokens.size === 0
      ? 0
      : clampPpm(PPM - ratioPpm(questionCovered, questionTokens.size)),
    claim_graph_density: ratioPpm(graphEdges, pairs),
    claim_count_norm: ratioPpm(Math.min(claimCount, CLAIM_CAP), CLAIM_CAP),
    answer_token_norm: ratioPpm(Math.min(answerTokens.size, TOKEN_NORM), TOKEN_NORM),
  };
}

/**
 * Self-contained identifier check: how many identifiers in the answer fail their own
 * arithmetic or their scheme's grammar, over how many were found.
 *
 * `src/citation.ts` already does this, more thoroughly, across more schemes. It is not
 * called here because this module is deliberately import-free (see `ScoredCard`), and
 * because at the time of writing that file is mid-edit by other work and does not
 * compile. **At integration this function should be deleted and delegated to
 * `extractCitationFindings` / `checksumFailures` / `grammarFailures`**, which are the
 * canonical implementations; the copy here covers the four schemes that carry a check
 * digit and nothing else.
 *
 * Note for the record: `citation_resolvability` fires on 0.0000 of both classes across
 * all 5 000 HaluEval General answers, so this component is inert on the external corpora
 * either way. It is kept because a component that is inert on one corpus is not
 * necessarily inert on the next, and because dropping features that happen to be quiet
 * on the data in hand is how a score gets fitted by accident.
 */
function identifierDefects(text: string): { found: number; defects: number } {
  let found = 0;
  let defects = 0;

  for (const match of text.matchAll(/\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/g)) {
    const digits = (match[1] ?? "").replace(/[-\s]/g, "");
    if (digits.length === 13) {
      found += 1;
      let sum = 0;
      for (let i = 0; i < 13; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
      if (sum % 10 !== 0) defects += 1;
    } else if (digits.length === 10) {
      found += 1;
      let sum = 0;
      for (let i = 0; i < 10; i += 1) {
        const value = digits[i]!.toLowerCase() === "x" ? 10 : Number(digits[i]);
        sum += value * (10 - i);
      }
      if (sum % 11 !== 0) defects += 1;
    }
  }

  // ORCID and ISSN both use an ISO 7064 MOD 11-2 check digit, ORCID over 15 digits and
  // ISSN over 7.
  for (const [pattern, width] of [
    [/\b(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])\b/g, 15] as const,
    [/\bISSN:?\s*(\d{4}-\d{3}[\dXx])\b/g, 7] as const,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? "").replace(/-/g, "");
      if (digits.length !== width + 1) continue;
      found += 1;
      let total = 0;
      for (let i = 0; i < width; i += 1) total = (total + Number(digits[i])) * 2;
      const expected = (12 - (total % 11)) % 11;
      const actual = digits[width]!.toLowerCase() === "x" ? 10 : Number(digits[width]);
      if (expected !== actual) defects += 1;
    }
  }

  // A DOI has no check digit, so only its grammar is decidable: a registrant prefix of
  // `10.` followed by at least four digits, then a non-empty suffix.
  for (const match of text.matchAll(/\b(10\.[^\s"'<>]{1,64})/g)) {
    found += 1;
    if (!/^10\.\d{4,9}\/\S+$/.test((match[1] ?? "").replace(/[.,;)\]]+$/, ""))) defects += 1;
  }

  return { found, defects };
}

/**
 * The specificity shapes `SPECIFIC_FACT_PATTERN`, `POLICY_COMMITMENT_PATTERN` and
 * `ATTRIBUTED_QUOTE_PATTERN` in `src/lite.ts` recognise, reduced to the disjunction this
 * module needs. Deliberately a *hint*, not a reproduction: the density it feeds is a
 * ranking quantity, and a component that had to track three unexported regexes byte for
 * byte would break silently the first time one of them changed. Pinned by test.
 */
const SPECIFICITY_HINT = new RegExp([
  "\\d",                                              // any digit: dates, amounts, counts
  "\\b(?:percent|percentage|million|billion|trillion)\\b",
  "\\b(?:guarantee[sd]?|guaranteeing|ensures?|promises?|commits?|will always|will never)\\b",
  "[“\"][^”\"]{12,}[”\"]",             // an attributed quotation
].join("|"), "i");

/** The ECS, re-expressed exactly as integer risk ppm. Order-identical to `1 - total`. */
export function tierRiskPpm(
  dimensions: Record<string, number>,
  drops: ReadonlySet<string> = new Set<string>(),
): number {
  let sum = 0;
  let count = 0;
  for (const key of ECS_DIMENSION_KEYS) {
    if (drops.has(key)) continue;
    const value = dimensions[key];
    if (value === undefined) continue;
    // Dimension values are authored as multiples of 0.05, so this is exact.
    sum += Math.round(value * PPM);
    count += 1;
  }
  if (count === 0) return 0;
  return clampPpm(PPM - divRound(sum, count));
}

function pooled(components: ComponentVector, pool: "mean" | "max"): number {
  const values = INCLUDED_COMPONENT_KEYS.map((key) => components[key] ?? 0);
  if (values.length === 0) return 0;
  if (pool === "max") return clampPpm(values.reduce((a, b) => (b > a ? b : a), 0));
  return clampPpm(divRound(values.reduce((a, b) => a + b, 0), values.length));
}

/**
 * SRS-1. `tierVariant` selects which ECS dimensions form the coarse tier:
 *
 *   "ecs"          — all thirteen; the score is then a strict refinement of `ecs.total`.
 *   "sign"         — drops `answer_relevance` on the structural ground in
 *                    SIGN_DISCIPLINE_DROPS.
 *   "sign_strict"  — also drops `calibration`, matching the pair of anti-correlated
 *                    components the external report measured. Reported for comparison,
 *                    not recommended: `calibration`'s a-priori direction is sound.
 *   "none"         — no tier. The gradient alone, which is the cleanest way to ask
 *                    whether the continuous features carry any signal at all.
 */
export function structuralResolution(
  input: { question: string; answer: string },
  card: ScoredCard,
  options: { pool?: "mean" | "max"; tierVariant?: "ecs" | "sign" | "sign_strict" | "none" } = {},
): StructuralResolution {
  const pool = options.pool ?? "mean";
  const variant = options.tierVariant ?? "ecs";
  const components = structuralComponents(input, card);
  const gradient = pooled(components, "mean");
  const gradientMax = pooled(components, "max");
  const active = pool === "max" ? gradientMax : gradient;

  const tier = variant === "none"
    ? 0
    : tierRiskPpm(
      card.ecs.dimensions,
      variant === "sign" ? SIGN_DISCIPLINE_DROPS
        : variant === "sign_strict" ? SIGN_DISCIPLINE_DROPS_STRICT
          : new Set<string>(),
    );

  // With no tier the gradient is the whole score, so it uses the full range; with a tier
  // it is compressed into a band narrower than the lattice spacing and cannot reorder a
  // decided pair.
  const risk = variant === "none"
    ? clampPpm(active)
    : clampPpm(tier + divRound(active * TIEBREAK_BAND_PPM, PPM));

  return {
    version: SRS_VERSION,
    risk_ppm: risk,
    score_ppm: PPM - risk,
    score: ppmToDecimalString(PPM - risk),
    tier_ppm: tier,
    gradient_ppm: gradient,
    gradient_max_ppm: gradientMax,
    components,
    pool,
  };
}

/**
 * Verified migration cost of adding `ecs.resolution` to the served TrustCard. Every
 * statement here was checked against the code named in it, not inferred.
 */
export const MIGRATION = {
  /**
   * `inputsHash()` in `platforms/src/lite.ts` hashes platform, question, answer, intents,
   * checkpoint, constitution and response_policy — inputs only, no output. `audit.log_id`
   * is derived from it. Adding an output field changes neither.
   */
  platforms_trace_hash: "unchanged",
  /**
   * `computeLogId()` in `mcp/src/engines/audit.ts` DOES commit to the score: its preimage
   * contains `ecs_dimensions` and `ecs_total: total.toFixed(6)`. Adding the new score to
   * that preimage would invalidate every previously published `glassbox-*` log id;
   * leaving it out keeps all of them verifiable but leaves the new score outside the
   * tamper-evident envelope. There is no third option, so the choice must be explicit and
   * dated. Recommendation: leave the preimage alone and version it separately when a
   * scheme change is being made for other reasons anyway.
   */
  mcp_log_id: "breaking-if-added-to-preimage",
  /**
   * `TrustCardSchema` in `platforms/src/glassbox.ts` declares `ecs` with
   * `.passthrough()`, so a remote card carrying an extra `ecs.resolution` parses today
   * with no schema change.
   */
  remote_card_schema: "compatible",
  /**
   * Read-only consumers of `ecs.total`, all unaffected by an additive field:
   * `platforms/src/formatter.ts` (display), `platforms/src/mcp.ts` (`score:`),
   * `mcp/src/engines/trustcard.ts` (verdict thresholds 0.40 / 0.70).
   */
  consumers: ["platforms/src/formatter.ts", "platforms/src/mcp.ts", "mcp/src/engines/trustcard.ts"],
  /**
   * The verdict must keep deriving from probes, not from SRS-1. A continuous score with
   * no calibration has no defensible threshold, and putting one in the gate would be the
   * "structural score presented as a probability" the project forbids.
   */
  verdict: "must-not-consume-srs",
} as const;
