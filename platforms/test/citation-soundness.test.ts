/**
 * Soundness of the offline citation screen, established by generation rather than by
 * example.
 *
 * The claim this file exists to discharge:
 *
 *   > A subset of citation-hallucination detection is decidable offline: identifier
 *   > check-digit arithmetic and permanently closed range constraints yield a
 *   > witness-bearing, false-positive-free fabrication signal requiring no network, no
 *   > reference corpus, and no model inference.
 *
 * "False-positive-free" is the load-bearing half, and a hand-written list of a dozen
 * published ISBNs cannot establish it — it can only fail to refute it. So the corpus here
 * is *constructed*: for each scheme, thousands of bodies are drawn from a seeded generator
 * and their check characters are computed by an implementation written independently of
 * the one under test, directly from the standard's own arithmetic. Every one of those is a
 * correctly transcribed identifier by construction, so a single `structurally_invalid`
 * verdict anywhere in the corpus refutes the claim outright.
 *
 * The second-opinion implementations below matter. Deriving the expected check character
 * from `citation.ts` itself would make these tests assert only that the module agrees with
 * itself, which is true of any implementation including a wrong one. Each `expected*`
 * function is a transcription of the published rule, spelled differently from the module's
 * version wherever there was a choice — descending explicit weights instead of a derived
 * parity, a table instead of a recursion — so that a shared mistake has to be made twice
 * in two shapes to go unnoticed.
 *
 * The three properties, in order of what they buy:
 *
 *   1. **No false positives at scale.** Thousands of generated-valid identifiers, none
 *      reported invalid. This is the property the paper's claim rests on.
 *   2. **Single-character error detection.** Check digits are designed to catch every
 *      single-character error; that is a theorem about the arithmetic, and these tests
 *      check the *implementation* actually realises it rather than assuming it does.
 *   3. **Adjacent-transposition detection.** Not 100% for every scheme — mod-10 with
 *      alternating 1,3 weights is blind to transpositions of digits differing by five —
 *      so the rate is derived from each scheme's own weights and modulus, measured
 *      empirically, and asserted equal. The rate is reported, never assumed.
 *
 * Determinism: every generator is seeded, so this suite is byte-reproducible, like the
 * module it tests. No network, no clock.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGtin,
  classifyIsbn,
  classifyIsni,
  classifyIssn,
  classifyLei,
  classifyOrcid,
  extractCitationFindings,
  gs1CheckDigit,
} from "../src/citation.js";
import type { CitationFinding } from "../src/citation.js";

// ---------------------------------------------------------------------------
// Deterministic generation
// ---------------------------------------------------------------------------

/**
 * A seeded 32-bit LCG (Numerical Recipes constants). Deliberately not `Math.random`:
 * a soundness suite that draws a different corpus on every run reports a different
 * result on every run, and "we found no false positive that time" is not a finding.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function digits(random: () => number, count: number): string {
  let out = "";
  for (let index = 0; index < count; index += 1) out += String(Math.floor(random() * 10));
  return out;
}

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---------------------------------------------------------------------------
// Second-opinion check-character arithmetic, transcribed from the standards
// ---------------------------------------------------------------------------

/** ISO 2108 ISBN-10: weights 10..1, total ≡ 0 (mod 11); check value 10 is written 'X'. */
function expectedIsbn10Check(body: string): string {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(body[index]) * (10 - index);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? "X" : String(check);
}

/**
 * ISO 2108 ISBN-13 / EAN-13. Written here as an explicit odd/even table rather than the
 * length-derived parity the module uses, so the two disagree if either is wrong.
 */
function expectedIsbn13Check(body: string): string {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/** ISO 3297 ISSN: weights 8..2, check = (11 - sum mod 11) mod 11, 10 written 'X'. */
function expectedIssnCheck(body: string): string {
  let sum = 0;
  for (let index = 0; index < 7; index += 1) sum += Number(body[index]) * (8 - index);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? "X" : String(check);
}

/**
 * ISO/IEC 7064 MOD 11-2, used by both ORCID and ISNI. Written as an explicit weighted sum
 * over powers of two, where the module uses the doubling recursion — same function, two
 * different spellings, which is the point.
 */
function expectedMod11_2Check(body: string): string {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const weight = modPow(2, body.length - index, 11);
    sum = (sum + Number(body[index]) * weight) % 11;
  }
  const check = (1 - sum + 11 * 2) % 11;
  return check === 10 ? "X" : String(check);
}

function modPow(base: number, exponent: number, modulus: number): number {
  let result = 1;
  for (let index = 0; index < exponent; index += 1) result = (result * base) % modulus;
  return result;
}

/**
 * ISO/IEC 7064 MOD 97-10 check digits for an LEI, computed by the standard's own
 * "append 00, take the remainder, subtract" construction rather than by the module's
 * streaming validity test.
 */
function expectedLeiCheck(body18: string): string {
  let remainder = 0;
  for (const character of `${body18}00`) {
    const code = character.charCodeAt(0);
    remainder = code >= 48 && code <= 57
      ? (remainder * 10 + (code - 48)) % 97
      : (remainder * 100 + (code - 55)) % 97;
  }
  return String(98 - remainder).padStart(2, "0");
}

/** GS1 modulo 10, weights 3,1 alternating leftwards from the digit before the check. */
function expectedGs1Check(body: string): string {
  let sum = 0;
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[index]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

// ---------------------------------------------------------------------------
// Scheme table
// ---------------------------------------------------------------------------

/**
 * One entry per scheme whose verdict is decided by arithmetic.
 *
 * `weights` and `modulus` describe the check equation `Σ wᵢ·dᵢ ≡ k (mod m)` over every
 * position *including* the check position. They are used only to derive the theoretical
 * error-detection rates — never to compute a check character — so a scheme's detection
 * rate is predicted from its algebra rather than read off the behaviour being tested.
 */
interface Scheme {
  name: string;
  /** A valid identifier, drawn deterministically. */
  generate(random: () => number): string;
  classify(raw: string): CitationFinding;
  /** Per-position weights of the check equation, check position included. */
  weights: number[];
  modulus: number;
  /**
   * Positions a single-character perturbation may touch while leaving the identifier
   * within the scheme's *shape*. Perturbing a position outside this set produces a
   * grammar finding instead of a check-digit finding, which is a different assertion.
   */
  perturbableFrom: number;
  /** The alphabet a perturbation draws from. */
  alphabet: string;
}

/** Weights of the ISO 7064 MOD 11-2 equation for a body of `bodyLength` digits. */
function mod11_2Weights(bodyLength: number): number[] {
  const weights: number[] = [];
  for (let index = 0; index < bodyLength; index += 1) {
    weights.push(modPow(2, bodyLength - index, 11));
  }
  weights.push(1);
  return weights;
}

const DIGIT_ALPHABET = "0123456789";

const SCHEMES: Scheme[] = [
  {
    name: "ISBN-10",
    generate: (random) => {
      const body = digits(random, 9);
      return body + expectedIsbn10Check(body);
    },
    classify: classifyIsbn,
    weights: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    modulus: 11,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "ISBN-13",
    generate: (random) => {
      // 978 or 979, and never 9790: that is the ISMN music range, so a 9790 string is a
      // valid *music* number and the module reports it as the wrong scheme by design.
      const prefix = random() < 0.5 ? "978" : `979${1 + Math.floor(random() * 9)}`;
      const body = prefix + digits(random, 12 - prefix.length);
      return body + expectedIsbn13Check(body);
    },
    classify: classifyIsbn,
    weights: [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1],
    modulus: 10,
    // Positions 0-3 carry the GS1 book prefix and the ISMN exclusion. Changing one of
    // those makes the string not-an-ISBN rather than a mistranscribed ISBN.
    perturbableFrom: 4,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "ISSN",
    generate: (random) => {
      const body = digits(random, 7);
      return body + expectedIssnCheck(body);
    },
    classify: classifyIssn,
    weights: [8, 7, 6, 5, 4, 3, 2, 1],
    modulus: 11,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "ORCID",
    generate: (random) => {
      const body = digits(random, 15);
      return body + expectedMod11_2Check(body);
    },
    classify: classifyOrcid,
    weights: mod11_2Weights(15),
    modulus: 11,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "ISNI",
    generate: (random) => {
      const body = digits(random, 15);
      return body + expectedMod11_2Check(body);
    },
    classify: classifyIsni,
    weights: mod11_2Weights(15),
    modulus: 11,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "GTIN-8",
    generate: (random) => {
      const body = digits(random, 7);
      return body + expectedGs1Check(body);
    },
    classify: classifyGtin,
    weights: [3, 1, 3, 1, 3, 1, 3, 1],
    modulus: 10,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "GTIN-12",
    generate: (random) => {
      const body = digits(random, 11);
      return body + expectedGs1Check(body);
    },
    classify: classifyGtin,
    weights: [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1],
    modulus: 10,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "GTIN-14",
    generate: (random) => {
      const body = digits(random, 13);
      return body + expectedGs1Check(body);
    },
    classify: classifyGtin,
    weights: [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1],
    modulus: 10,
    perturbableFrom: 0,
    alphabet: DIGIT_ALPHABET,
  },
  {
    name: "LEI",
    generate: (random) => {
      let body = "";
      for (let index = 0; index < 18; index += 1) {
        body += ALPHANUMERIC[Math.floor(random() * ALPHANUMERIC.length)];
      }
      return body + expectedLeiCheck(body);
    },
    classify: classifyLei,
    // MOD 97-10 over a mixed alphabet has no fixed per-position weight vector, because a
    // letter expands to two decimal digits and shifts everything to its right. Detection
    // rates for it are therefore measured and reported rather than predicted from a
    // weight vector; the fields below are unused for this scheme.
    weights: [],
    modulus: 97,
    perturbableFrom: 0,
    alphabet: ALPHANUMERIC,
  },
];

const CORPUS_SIZE = 2_000;
const PERTURBATION_SAMPLE = 250;

/** Deterministic per-scheme corpus. Distinct seeds so the schemes are not correlated. */
function corpusFor(scheme: Scheme, size: number, seed: number): string[] {
  const random = lcg(seed);
  const out: string[] = [];
  for (let index = 0; index < size; index += 1) out.push(scheme.generate(random));
  return out;
}

function seedFor(name: string): number {
  let hash = 20260904;
  for (const character of name) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

// ===========================================================================
// 1. No false positives, at scale. The claim stands or falls here.
// ===========================================================================

test("not one generated-valid identifier is ever reported structurally_invalid", () => {
  const report: string[] = [];
  let total = 0;

  for (const scheme of SCHEMES) {
    const corpus = corpusFor(scheme, CORPUS_SIZE, seedFor(scheme.name));
    assert.equal(new Set(corpus).size > CORPUS_SIZE * 0.9, true, `${scheme.name} corpus is degenerate`);

    const falsePositives: string[] = [];
    for (const identifier of corpus) {
      const result = scheme.classify(identifier);
      if (result.verdict === "structurally_invalid") falsePositives.push(`${identifier}: ${result.reason}`);
      // A valid identifier must also *say* the arithmetic ran. "Valid but unverified"
      // would mean the verdict came from something other than the check digit.
      assert.equal(result.checksum_verified, true, `${scheme.name} ${identifier} reported no arithmetic`);
    }
    total += corpus.length;
    report.push(`${scheme.name.padEnd(8)} n=${corpus.length}  false positives=${falsePositives.length}`);
    assert.deepEqual(falsePositives, [], `${scheme.name} rejected correctly transcribed identifiers`);
  }

  console.log(`\n  generated-corpus false positives (${total} identifiers):`);
  for (const line of report) console.log(`    ${line}`);
});

test("the generated corpus is validated against a second, independent implementation", () => {
  // Guards against the failure mode where the generator computes the check digit *by
  // calling the module*, which would make the corpus valid by definition and the whole
  // false-positive result vacuous. Here the module's own primitive must agree with the
  // standard transcribed separately above.
  const random = lcg(4242);
  for (let index = 0; index < 500; index += 1) {
    const body = digits(random, 12);
    assert.equal(String(gs1CheckDigit(body)), expectedGs1Check(body));
  }
  // And a hand-checked anchor per scheme, from published identifiers.
  assert.equal(expectedIsbn10Check("030640615"), "2");
  assert.equal(expectedIsbn13Check("978013235088"), "4");
  assert.equal(expectedIssnCheck("0378595"), "5");
  assert.equal(expectedMod11_2Check("000000021825009"), "7");
  assert.equal(expectedLeiCheck("7LTWFZYICNSX8D621K"), "86");
  // UPC-A 036000291452: the eleven-digit body checks to 2.
  assert.equal(expectedGs1Check("03600029145"), "2");
  // EAN-8 73513537 and GTIN-14 10614141000415, both GS1's own published examples.
  assert.equal(expectedGs1Check("7351353"), "7");
  assert.equal(expectedGs1Check("1061414100041"), "5");
});

test("real published identifiers from every supported registry validate", () => {
  // Generated corpora prove the arithmetic is self-consistent. Only real, independently
  // resolvable identifiers prove it is the *right* arithmetic. Every value below was
  // confirmed against its own registry: LEIs against the GLEIF API (all ACTIVE/ISSUED),
  // ISNIs against OCLC's ISNI SRU endpoint, GTINs against GS1's own published examples.
  const fixtures: Array<[string, (raw: string) => CitationFinding, string]> = [
    // LEI — ISO 17442-1:2020, MOD 97-10.
    ["HWUPKR0MPOU8FGXBT394", classifyLei, "Apple Inc."],
    ["784F5XWPLTWKTBV3E584", classifyLei, "The Goldman Sachs Group"],
    ["8I5DZWZKVSZI1NUHU748", classifyLei, "JPMorgan Chase & Co."],
    ["INR2EJN1ERAN0W5ZP974", classifyLei, "Microsoft Corporation"],
    ["7LTWFZYICNSX8D621K86", classifyLei, "Deutsche Bank AG"],
    ["254900QH5OOEMI8BEG32", classifyLei, "Grand Anna Owner, LLC"],
    // ISNI — ISO 27729, MOD 11-2.
    ["0000000122590564", classifyIsni, "Isaac Asimov"],
    ["000000012281955X", classifyIsni, "Albert Einstein (X check character)"],
    ["0000000121707484", classifyIsni, "The Beatles"],
    ["0000000122796570", classifyIsni, "Karl Marx"],
    ["0000000121401274", classifyIsni, "Marie Curie"],
    ["000000012146438X", classifyIsni, "documented ISNI example"],
    // ORCID — same MOD 11-2, including the post-2022 0009 issuance block, which a
    // range check against the older reserved block alone would have rejected.
    ["0000000218250097", classifyOrcid, "Josiah Carberry"],
    ["0009000295075947", classifyOrcid, "0009 block"],
    ["000900004566524X", classifyOrcid, "0009 block, X check character"],
    // GTIN — GS1 General Specifications R26 Table 7-8 worked examples.
    ["95010861", classifyGtin, "GS1 GTIN-8 example"],
    ["614141234561", classifyGtin, "GS1 GTIN-12 example"],
    ["012345000058", classifyGtin, "GS1 GTIN-12 example"],
    ["5412345678908", classifyGtin, "GS1 GTIN-13 example"],
    ["9501086100017", classifyGtin, "GS1 GTIN-13 example"],
    ["10012345678902", classifyGtin, "GS1 GTIN-14 example"],
    ["09506000134352", classifyGtin, "GS1 GTIN-14 example"],
    // ISBN — published books.
    ["9780306406157", classifyIsbn, "ISBN-13"],
    ["9783161484100", classifyIsbn, "ISBN-13"],
    ["0306406152", classifyIsbn, "ISBN-10"],
  ];

  for (const [identifier, classify, who] of fixtures) {
    const result = classify(identifier);
    assert.equal(result.verdict, "structurally_valid", `${identifier} (${who}): ${result.reason}`);
    assert.equal(result.checksum_verified, true, `${identifier} (${who}) reported no arithmetic`);
  }
  console.log(`\n  real published identifiers validated: ${fixtures.length}`);
});

test("the LEI positions-5-6 rule is deliberately absent, and that is load-bearing", () => {
  // The LEI ROC describes characters 5-6 as reserved and set to zero, and current
  // issuance obeys it — but ISO 17442-1:2020 Clause 4 does not, and the grandfathered
  // pre-2013 CICI-era codes carry letters there. Enforcing it would reject five of the
  // largest firms in the world, so this test exists to keep anyone from adding it back.
  for (const legacy of [
    "HWUPKR0MPOU8FGXBT394", // Apple: positions 5-6 are "KR"
    "784F5XWPLTWKTBV3E584", // Goldman Sachs: "5X"
    "8I5DZWZKVSZI1NUHU748", // JPMorgan: "ZW"
    "INR2EJN1ERAN0W5ZP974", // Microsoft: "EJ"
    "7LTWFZYICNSX8D621K86", // Deutsche Bank: "FZ"
  ]) {
    assert.notEqual(legacy.slice(4, 6), "00", "fixture no longer exercises the legacy case");
    assert.equal(classifyLei(legacy).verdict, "structurally_valid", `${legacy} was rejected`);
  }
});

// ===========================================================================
// 2. Single-character error detection
// ===========================================================================

test("every single-character change to a valid identifier is caught", () => {
  const report: string[] = [];

  for (const scheme of SCHEMES) {
    const corpus = corpusFor(scheme, PERTURBATION_SAMPLE, seedFor(`${scheme.name}:perturb`));
    let examined = 0;
    const missed: string[] = [];

    for (const identifier of corpus) {
      for (let position = scheme.perturbableFrom; position < identifier.length; position += 1) {
        for (const replacement of scheme.alphabet) {
          if (replacement === identifier[position]) continue;
          // LEI aside, a perturbation must not change the character *class*: swapping a
          // digit for a letter changes how many decimal places the expansion occupies,
          // which is a different kind of error from a single-character substitution.
          if (scheme.name === "LEI") {
            const wasDigit = /\d/.test(identifier[position]!);
            if (wasDigit !== /\d/.test(replacement)) continue;
          }
          const mutated = identifier.slice(0, position) + replacement + identifier.slice(position + 1);
          const result = scheme.classify(mutated);
          examined += 1;
          if (result.verdict !== "structurally_invalid" || !result.checksum_verified) {
            missed.push(`${identifier} -> ${mutated} (${result.verdict})`);
          }
        }
      }
    }

    const rate = (examined - missed.length) / examined;
    report.push(`${scheme.name.padEnd(8)} n=${String(examined).padStart(7)}  detected=${(rate * 100).toFixed(3)}%`);
    assert.deepEqual(missed.slice(0, 5), [], `${scheme.name} missed single-character errors`);
    assert.equal(rate, 1, `${scheme.name} single-character detection is not total`);
  }

  console.log("\n  single-character error detection:");
  for (const line of report) console.log(`    ${line}`);
});

// ===========================================================================
// 3. Adjacent transposition, at the rate the algebra predicts
// ===========================================================================

/**
 * The share of adjacent transpositions of *unequal* digits a scheme can detect, derived
 * from its check equation alone.
 *
 * Swapping positions i and i+1 changes the weighted sum by `(a-b)·(wᵢ - wᵢ₊₁)`, so the
 * error is caught exactly when that quantity is non-zero modulo m. Enumerating over every
 * position and every unequal digit pair gives the rate without reference to the
 * implementation — which is what makes the assertion below a prediction rather than a
 * restatement.
 */
function predictedTranspositionRate(scheme: Scheme): number {
  let detected = 0;
  let total = 0;
  for (let position = 0; position + 1 < scheme.weights.length; position += 1) {
    const delta = scheme.weights[position]! - scheme.weights[position + 1]!;
    for (let a = 0; a <= 9; a += 1) {
      for (let b = 0; b <= 9; b += 1) {
        if (a === b) continue;
        total += 1;
        if ((((a - b) * delta) % scheme.modulus + scheme.modulus) % scheme.modulus !== 0) detected += 1;
      }
    }
  }
  return detected / total;
}

test("adjacent-transposition detection matches the rate the check equation predicts", () => {
  const report: string[] = [];

  for (const scheme of SCHEMES) {
    if (scheme.weights.length === 0) continue; // MOD 97-10: measured separately below.
    const corpus = corpusFor(scheme, PERTURBATION_SAMPLE, seedFor(`${scheme.name}:transpose`));
    let examined = 0;
    let detected = 0;

    for (const identifier of corpus) {
      for (let position = scheme.perturbableFrom; position + 1 < identifier.length; position += 1) {
        const left = identifier[position]!;
        const right = identifier[position + 1]!;
        // Equal digits transpose to the same string: not an error, so not detectable.
        if (left === right) continue;
        // An 'X' is only legal in the final position, so moving it is a shape violation
        // rather than a transposition the arithmetic is asked about.
        if (left === "X" || right === "X") continue;
        const mutated = identifier.slice(0, position) + right + left + identifier.slice(position + 2);
        examined += 1;
        const result = scheme.classify(mutated);
        if (result.verdict === "structurally_invalid" && result.checksum_verified) detected += 1;
      }
    }

    const measured = detected / examined;
    const predicted = predictedTranspositionRate(scheme);
    report.push(
      `${scheme.name.padEnd(8)} n=${String(examined).padStart(6)}  measured=${(measured * 100).toFixed(2)}%` +
      `  predicted=${(predicted * 100).toFixed(2)}%`,
    );

    // Sampling means the measured rate approaches the prediction rather than equalling it
    // exactly; the tolerance is a sampling tolerance, not a fudge factor. Schemes with a
    // predicted rate of exactly 1 are held to exactly 1, because a single miss there
    // would be a real defect and not sampling noise.
    if (predicted === 1) {
      assert.equal(measured, 1, `${scheme.name} missed a transposition its algebra says it must catch`);
    } else {
      assert.ok(
        Math.abs(measured - predicted) < 0.02,
        `${scheme.name} measured ${measured.toFixed(4)} against predicted ${predicted.toFixed(4)}`,
      );
    }
  }

  console.log("\n  adjacent-transposition detection (unequal digit pairs):");
  for (const line of report) console.log(`    ${line}`);
  console.log("    note: mod-10 schemes are blind to transpositions of digits differing by 5;");
  console.log("          that is a property of the standard, not of this implementation.");
});

test("the mod-10 transposition blind spot is exactly the digits-differ-by-five case", () => {
  // Stated as its own test because it is a *limitation* being pinned down, not a
  // capability. If a future change appeared to improve the ISBN-13 transposition rate,
  // that would mean the arithmetic had stopped being ISBN-13.
  const body = "978013235088";
  const valid = body + expectedIsbn13Check(body);
  let blind = 0;
  for (let position = 4; position + 1 < valid.length; position += 1) {
    const left = Number(valid[position]);
    const right = Number(valid[position + 1]);
    if (left === right) continue;
    const mutated = valid.slice(0, position) + valid[position + 1] + valid[position] + valid.slice(position + 2);
    const caught = classifyIsbn(mutated).verdict === "structurally_invalid";
    if (Math.abs(left - right) === 5) {
      assert.equal(caught, false, "a difference-of-five transposition was reported as caught");
      blind += 1;
    } else {
      assert.equal(caught, true, `transposition at ${position} was missed`);
    }
  }
  console.log(`\n  ISBN-13 difference-of-five transpositions in the anchor case: ${blind}`);
});

// ===========================================================================
// 4. checksum_verified is true iff the arithmetic actually ran
// ===========================================================================

test("checksum_verified is true only when a check digit was computed and compared", () => {
  // True: the arithmetic ran, whichever way it came out.
  for (const [raw, classify] of [
    ["9780132350884", classifyIsbn],
    ["9780132350885", classifyIsbn],
    ["0306406152", classifyIsbn],
    ["0306406153", classifyIsbn],
    ["03785955", classifyIssn],
    ["03785956", classifyIssn],
    ["0000000218250097", classifyOrcid],
    ["0000000218250098", classifyOrcid],
    ["000000012146438X", classifyIsni],
    ["7LTWFZYICNSX8D621K86", classifyLei],
    ["7LTWFZYICNSX8D621K87", classifyLei],
    ["73513537", classifyGtin],
    ["73513538", classifyGtin],
  ] as Array<[string, (raw: string) => CitationFinding]>) {
    assert.equal(classify(raw).checksum_verified, true, `${raw} should report computed arithmetic`);
  }

  // False: the string never reached the arithmetic, so claiming a check-digit failure
  // would both overstate what was computed and promote a grammar defect to a rejection.
  for (const [raw, classify, why] of [
    ["978013235088", classifyIsbn, "wrong length"],
    ["03X6406152", classifyIsbn, "X outside the final position"],
    ["1234567890123", classifyIsbn, "not a GS1 book prefix"],
    ["9790123456785", classifyIsbn, "the ISMN music range"],
    ["0378595", classifyIssn, "wrong length"],
    ["037X5955", classifyIssn, "X outside the final position"],
    ["00000002182500", classifyOrcid, "wrong length"],
    ["000000021825009Y", classifyOrcid, "not a check character"],
    ["7LTWFZYICNSX8D621K8", classifyLei, "wrong length"],
    ["7LTWFZYICNSX8D621K8-", classifyLei, "outside the LEI alphabet"],
    ["735135370", classifyGtin, "no GTIN has nine digits"],
  ] as Array<[string, (raw: string) => CitationFinding, string]>) {
    const result = classify(raw);
    assert.equal(result.verdict, "structurally_invalid", `${raw} (${why})`);
    assert.equal(result.checksum_verified, false, `${raw} (${why}) claimed arithmetic that never ran`);
  }
});

test("schemes with no check digit never claim one, whatever their verdict", () => {
  // DOI, PMID, PMCID, RFC, arXiv and reporter citations carry no check digit. Every
  // finding they produce — valid, invalid or unverifiable — must say so, because the
  // decisive gate in lite.ts keys on checksum_verified.
  const text = [
    "See doi:10.1234/abc, arXiv:2301.00001, PMID: 12345678, PMC1234567, RFC 2119,",
    "and 410 F.3d 1052, plus doi:10.5/bad, arXiv:2113.00020, PMID 999999999,",
    "1053 F.3d 218, and 1200 F.2d 5.",
  ].join(" ");
  const findings = extractCitationFindings(text);
  const checkless = new Set(["doi", "pmid", "pmcid", "rfc", "arxiv", "reporter"]);
  const offenders = findings.filter((item) => checkless.has(item.kind) && item.checksum_verified);
  assert.deepEqual(offenders, [], "a scheme with no check digit claimed to have computed one");
  // And the run really did exercise both outcomes, or the assertion above is vacuous.
  assert.ok(findings.some((item) => item.verdict === "structurally_invalid"));
  assert.ok(findings.some((item) => item.verdict === "unverifiable_form"));
});

// ===========================================================================
// 5. Zero false positives in realistic prose
// ===========================================================================

/**
 * Every line here contains only correctly transcribed identifiers, or none at all, and is
 * written the way references, tables and prose actually are — because the extractor is
 * where false positives came from twice before.
 *
 * `ISBN 0-306-40615-2 320 pages` is the regression that motivated this section: the
 * extractor's length range ran past the end of the ISBN-10 and swallowed the leading "3"
 * of "320", producing a thirteen-character token that was read as an ISBN-13 and reported
 * as a check-digit failure. A correctly transcribed ISBN produced a hard rejection.
 */
const BENIGN_PROSE: string[] = [
  // Bibliography lines with adjacent page counts, editions and volumes.
  "Knuth, D. (1997). The Art of Computer Programming, 3rd ed. ISBN 0-306-40615-2 320 pages.",
  "Aho, A. Compilers, 2nd edition. ISBN 978-0-13-235088-4, xxiv + 1009 pp.",
  "ISBN 0-306-40615-2 (paperback), 320 pages, 2nd printing, volume 12, series 4.",
  "Reference [14]: ISBN 978-0-262-03384-8, pp. 320-340, footnote 7, table 3.",
  "See ISBN 9780262033848 pp. 12-19 and ISBN 0306406152 pp. 320-340.",
  // Multiple identifiers in one sentence.
  "The paper (ISSN 0378-5955, doi:10.1038/nphys1170, arXiv:0704.0001) is indexed as PMID: 17376648.",
  "Author ORCID 0000-0002-1825-0097; journal ISSN 2049-3630; dataset doi:10.5281/zenodo.1234567.",
  "ISNI 0000 0001 2146 438X and ORCID 0000-0002-1825-0097 identify different registries.",
  // Labels separated from their value by a copula — the recall fix, which must not have
  // become a false-positive source.
  "The corresponding author's ORCID is 0000-0002-1825-0097, given on the title page.",
  "The journal's ISSN is 0378-5955 and its founding volume was 1.",
  "The ISBN is 978-0-13-235088-4 for the hardcover and the print run was 5000.",
  "Its PMID is 17376648, retrieved 12 March 2019 from a library terminal.",
  // Line-wrapped identifiers, as copied out of a two-column PDF.
  "ISBN 978-0-13-\n235088-4",
  "ORCID 0000-0002-\n1825-0097",
  // Numbers that have an identifier's shape but are not identifiers.
  "The model scored 10.5/12 on the benchmark and 10.2/12 on the ablation.",
  "Dosing was 10.5/kg for the first cohort and 10.75/kg thereafter.",
  "Version 10.2/build-4471 shipped on the 3rd; version 10.9/build-4480 followed.",
  "Bake at 350 F. 30 minutes, then reduce to 300 F. 15 minutes more.",
  "In 2020 U.S. 300 million doses were distributed; by 2021 U.S. 500 million.",
  "Call 42 U.S.C. 1983 the operative provision; see also 28 U.S.C. 1331.",
  "Order 4006381333931 shipped; invoice 036000291452 was settled.",
  "The account number is 1234567890123 and the routing number is 021000021.",
  // Valid legal citations inside real citation contexts.
  "Smith v. Jones, 512 U.S. 44 (1994), and Doe v. Roe, 410 F.3d 1052 (9th Cir. 2005).",
  "See 89 F.4th 1201 (2024); cf. 300 F. 1 (1924) and 999 F.2d 1 (1993).",
  // Tables and footnotes.
  "| Title | ISBN | Pages |\n| A | 978-0-13-235088-4 | 1009 |\n| B | 0-306-40615-2 | 320 |",
  "1. See ISBN 978-0-262-03384-8 at 42. 2. See ISSN 0378-5955 at 7. 3. Ibid., 320-340.",
  // Prose with no identifier at all.
  "The ordering effect is reported in the literature and replicated in three labs.",
  "Between 1991 and 2007 the numbering scheme changed twice, in 2007 and again in 2015.",
];

test("zero false positives across realistic prose, tables, footnotes and near-misses", () => {
  const offenders: string[] = [];
  let findingCount = 0;

  for (const line of BENIGN_PROSE) {
    for (const item of extractCitationFindings(line)) {
      findingCount += 1;
      if (item.verdict === "structurally_invalid") {
        offenders.push(`${JSON.stringify(line.slice(0, 60))} -> ${item.kind}:${item.identifier} (${item.reason})`);
      }
    }
  }

  console.log(`\n  benign prose: ${BENIGN_PROSE.length} lines, ${findingCount} identifiers extracted,`
    + ` ${offenders.length} false positives`);
  assert.deepEqual(offenders, [], "benign prose produced a structurally_invalid verdict");
});

test("the benign corpus is not passing merely because nothing was extracted", () => {
  // A false-positive test over text the extractor ignores proves nothing. At least the
  // labelled identifiers above must actually be found and judged valid.
  const all = BENIGN_PROSE.flatMap((line) => extractCitationFindings(line));
  const byKind = new Map<string, number>();
  for (const item of all) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  for (const kind of ["isbn10", "isbn13", "issn", "orcid", "isni", "doi", "arxiv", "pmid", "reporter"]) {
    assert.ok((byKind.get(kind) ?? 0) > 0, `no ${kind} was extracted from the benign corpus`);
  }
  console.log(`  extracted by kind: ${[...byKind].map(([k, n]) => `${k}=${n}`).join(" ")}`);
});

test("the ISBN-10-followed-by-a-page-count regression stays fixed", () => {
  const findings = extractCitationFindings("ISBN 0-306-40615-2 320 pages.");
  assert.equal(findings.length, 1, "the extractor captured more than the one identifier present");
  assert.equal(findings[0]!.kind, "isbn10");
  assert.equal(findings[0]!.identifier, "0306406152");
  assert.equal(findings[0]!.verdict, "structurally_valid");
});

// ===========================================================================
// 6. Determinism, and the absence of clock and network
// ===========================================================================

test("identical input yields identical findings, and every bound is a frozen constant", () => {
  const text = BENIGN_PROSE.join("\n");
  assert.deepEqual(extractCitationFindings(text), extractCitationFindings(text));

  // Any verdict that depended on a bound must name the frozen constant it used, so an
  // audit record from this build says which epoch was in force.
  const bounded = extractCitationFindings(
    "arXiv:2301.0001 and arXiv:1412.00010 and PMID 999999999 and 1053 F.3d 218 (2019).",
  ).filter((item) => item.verdict === "structurally_invalid");
  assert.ok(bounded.length >= 3, "the bounded cases did not all produce findings");
  for (const item of bounded) {
    assert.ok(item.epoch, `${item.kind}:${item.identifier} applied a bound without naming its epoch`);
  }
  console.log(`\n  epochs cited: ${bounded.map((item) => item.epoch).join(", ")}`);
});

test("the epoch reaches the audit record, not just the finding", async () => {
  // A frozen constant is only auditable if the trust card says which constant was
  // applied. Verified end to end through the verifier rather than on the finding alone.
  const { GlassboxLiteVerifier } = await import("../src/lite.js");
  const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));
  const card = await verifier.verify({
    platform: "api",
    question: "Which sources back this?",
    answer: "Reported at 1053 F.3d 218, indexed as PMID 999999999.",
  });
  const probe = card.red_team.probes.find((item) => item.angle === "citation_resolvability");
  assert.ok(probe, "citation_resolvability was not emitted");
  assert.equal(probe.passed, false);
  assert.ok(
    probe.evidence.some((line) => /\[epoch reporter-F3d-closed-2021-vol-999\]/.test(line)),
    `no epoch in evidence: ${JSON.stringify(probe.evidence)}`,
  );
  console.log(`\n  audit evidence: ${probe.evidence.join(" | ")}`);
});

test("the module reads no clock: a fixed default horizon, not today's date", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/citation.ts", import.meta.url), "utf8"));
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["new Date", "Date.now", "performance.now", "process.env", "fetch(", "require("]) {
    assert.equal(code.includes(forbidden), false, `citation.ts must not use ${forbidden}`);
  }
});
