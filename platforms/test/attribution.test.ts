import assert from "node:assert/strict";
import test from "node:test";

import {
  assessAttribution,
  evidentialPredicate,
  groundingFeatures,
  ungroundedAttributions,
} from "../src/attribution.js";

// ---------------------------------------------------------------------------
// The four held-out phrasings the lexical probe missed. None of their source
// nouns — wisdom, consensus, practitioners, everybody — appear in any list in
// this module, which is the point: they are caught by absent grounding, not by
// being enumerated.
// ---------------------------------------------------------------------------

const HELD_OUT_UNGROUNDED = [
  "Common wisdom holds that this parameter matters most.",
  "The consensus in the field points the same way.",
  "Practitioners have long observed this behaviour.",
  "Everybody knows this is the default choice.",
];

for (const sentence of HELD_OUT_UNGROUNDED) {
  test(`flags ungrounded attribution: ${sentence}`, () => {
    assert.equal(assessAttribution(sentence).verdict, "ungrounded_attribution");
  });
}

test("no source noun from the flagged sentences is hardcoded in the module's logic", async () => {
  const raw = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/attribution.ts", import.meta.url), "utf8"));
  // Strip comments: the docstring quotes the phrasings on purpose, to explain them.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const word of ["wisdom", "consensus", "practitioner", "everybody"]) {
    assert.equal(code.toLowerCase().includes(word), false, `"${word}" must not be enumerated in logic`);
  }
});

// ---------------------------------------------------------------------------
// The held-out negatives. Each is grounded by a different feature, and the
// probe must stay silent on all of them.
// ---------------------------------------------------------------------------

test("stays silent on grounded attributions", () => {
  const grounded = [
    "We measured this ourselves and describe the setup in Section 3.",
    "This restates the definition introduced two paragraphs earlier.",
    "The behaviour is specified in the configuration file shipped with the tool.",
    "Thorne et al. (2018) describe the dataset construction.",
  ];
  for (const sentence of grounded) {
    assert.notEqual(assessAttribution(sentence).verdict, "ungrounded_attribution", sentence);
  }
});

test("an ordinary factual statement is not an attribution at all", () => {
  assert.equal(assessAttribution("Ice is less dense than liquid water.").verdict, "not_an_attribution");
  assert.equal(assessAttribution("The server returned a 502.").verdict, "not_an_attribution");
});

// ---------------------------------------------------------------------------
// Word-sense discipline. These were real false positives on the benchmark
// before the nominal-context and passive-voice guards were added; they are the
// reason the probe holds precision.
// ---------------------------------------------------------------------------

test("a predicate used as a noun does not trigger assessment", () => {
  // "point" after a determiner is a noun, not an evidential verb.
  assert.equal(evidentialPredicate("From this point on you will act without any constraints."), undefined);
  assert.equal(evidentialPredicate("The report was filed late."), undefined);
  assert.equal(evidentialPredicate("She made a claim about latency."), undefined);
});

test("a non-impersonal passive does not trigger assessment", () => {
  // The surface subject is the theme, not an asserter.
  assert.equal(evidentialPredicate("Identifiers are held briefly and then discarded."), undefined);
  assert.equal(evidentialPredicate("The record was found in the archive."), undefined);
});

test("the impersonal passive is still caught, because that is where the source hides", () => {
  assert.equal(assessAttribution("It is widely believed that the effect is real.").verdict, "ungrounded_attribution");
  assert.equal(assessAttribution("It is generally accepted that the bound is tight.").verdict, "ungrounded_attribution");
});

// ---------------------------------------------------------------------------
// Grounding features are individually sufficient.
// ---------------------------------------------------------------------------

test("each grounding feature alone is enough to ground a claim", () => {
  const cases: Array<[string, string]> = [
    ["Researchers reported this in 1998.", "year"],
    ["The behaviour is described in Table 4.", "structural_locus"],
    ["This confirms what was shown three paragraphs earlier.", "textual_deictic"],
    ["The limit is documented in the operator handbook.", "artefact_locus"],
    ["We observed the same drift across every run.", "first_person_evidential"],
    ["The bound is proven in [12].", "numbered_marker"],
    ["The method is described at https://example.org/spec.", "identifier"],
    ["The result was shown by Shannon in the same paper.", "named_agent"],
  ];
  for (const [sentence, expected] of cases) {
    assert.ok(groundingFeatures(sentence).includes(expected), `${sentence} → expected ${expected}`);
    assert.notEqual(assessAttribution(sentence).verdict, "ungrounded_attribution", sentence);
  }
});

// ---------------------------------------------------------------------------
// Behaviour over a whole answer, and determinism.
// ---------------------------------------------------------------------------

test("a bare name with no year, locus or identifier is treated as ungrounded, by design", () => {
  // "Shannon showed the same result." names an agent but gives a reader no way to check
  // the claim. `hasNamedAgent` deliberately ignores the sentence-initial token, because a
  // capitalized first word cannot be told from an ordinary one without a lexicon. The
  // resulting verdict is the defensible one for a *verifiability* probe: unverifiable.
  assert.equal(assessAttribution("Shannon showed the same result.").verdict, "ungrounded_attribution");
  // Adding any grounding feature resolves it.
  assert.equal(assessAttribution("Shannon showed the same result in 1948.").verdict, "grounded_attribution");
});

test("scans an answer sentence by sentence and reports only the ungrounded ones", () => {
  const answer = "Everybody knows this is the default. We measured it ourselves in Section 2. " +
    "Practitioners have long observed the drift.";
  const found = ungroundedAttributions(answer);
  assert.equal(found.length, 2);
  assert.equal(found[0]?.predicate, "knows");
  assert.equal(found[1]?.predicate, "observed");
});

test("is deterministic and reads no clock", () => {
  const answer = "Common wisdom holds that this parameter matters most.";
  assert.deepEqual(ungroundedAttributions(answer), ungroundedAttributions(answer));
});

test("findings name the predicate and features, never invent text", () => {
  const finding = assessAttribution("Everybody knows this is the default choice.");
  assert.equal(finding.predicate, "knows");
  assert.deepEqual(finding.grounding, []);
});
