import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyArxiv,
  classifyDoi,
  classifyIsbn,
  classifyIssn,
  classifyOrcid,
  classifyPmcid,
  classifyPmid,
  classifyRfc,
  isbn10ChecksumValid,
  isbn13ChecksumValid,
  issnChecksumValid,
  orcidChecksumValid,
} from "../src/citation.js";

// ---------------------------------------------------------------------------
// Check-digit arithmetic, against published identifiers whose check digits are
// documented by their issuing standard. If any of these fail, the arithmetic is
// wrong and every downstream verdict is worthless.
// ---------------------------------------------------------------------------

test("ISBN-13 check digit accepts published identifiers", () => {
  assert.equal(isbn13ChecksumValid("9780132350884"), true); // Clean Code
  assert.equal(isbn13ChecksumValid("9780262033848"), true); // Introduction to Algorithms, 3rd
  assert.equal(isbn13ChecksumValid("9783161484100"), true); // ISO 2108 worked example
});

test("ISBN-13 check digit rejects a single transposed digit", () => {
  // 9780132350884 is valid; swapping the last two body digits must break the sum.
  assert.equal(isbn13ChecksumValid("9780132350848"), false);
  assert.equal(isbn13ChecksumValid("9780132350885"), false);
});

test("ISBN-13 rejects prefixes that GS1 never assigned to books", () => {
  // Correct mod-10 arithmetic but a 977 prefix, which is periodicals, not books.
  assert.equal(isbn13ChecksumValid("9771234567003"), false);
});

test("ISBN-10 check digit accepts published identifiers, including the X form", () => {
  assert.equal(isbn10ChecksumValid("0306406152"), true); // ISO 2108 worked example
  assert.equal(isbn10ChecksumValid("080442957X"), true); // check digit 10, written X
});

test("ISBN-10 rejects a corrupted check digit", () => {
  assert.equal(isbn10ChecksumValid("0306406153"), false);
  assert.equal(isbn10ChecksumValid("0804429570"), false);
});

test("ISSN check digit accepts published identifiers", () => {
  assert.equal(issnChecksumValid("03178471"), true); // ISO 3297 worked example
  assert.equal(issnChecksumValid("20493630"), true);
});

test("ISSN rejects a corrupted check digit", () => {
  assert.equal(issnChecksumValid("03178472"), false);
});

test("ORCID MOD 11-2 accepts published identifiers, including the X form", () => {
  assert.equal(orcidChecksumValid("0000000218250097"), true); // ORCID's own example
  assert.equal(orcidChecksumValid("000000021694233X"), true); // check digit 10, written X
});

test("ORCID rejects a corrupted check digit", () => {
  assert.equal(orcidChecksumValid("0000000218250098"), false);
  assert.equal(orcidChecksumValid("0000000216942330"), false);
});

// ---------------------------------------------------------------------------
// The property that matters: a fabricated identifier is caught by arithmetic,
// not by recognising any particular wording.
// ---------------------------------------------------------------------------

test("a plausible-looking but fabricated ISBN is rejected without any lookup", () => {
  const fabricated = classifyIsbn("978-0-13-235088-7"); // real ISBN, wrong check digit
  assert.equal(fabricated.verdict, "structurally_invalid");
  assert.equal(fabricated.checksum_verified, true);
  assert.match(fabricated.reason, /check digit/);
});

test("a fabricated ORCID is rejected by checksum", () => {
  const fabricated = classifyOrcid("0000-0002-1825-0098");
  assert.equal(fabricated.verdict, "structurally_invalid");
  assert.equal(fabricated.checksum_verified, true);
});

test("separator style does not change the verdict", () => {
  const forms = ["9780132350884", "978-0-13-235088-4", "978 0 13 235088 4", "978–0–13–235088–4"];
  for (const form of forms) {
    assert.equal(classifyIsbn(form).verdict, "structurally_valid", form);
  }
});

test("ORCID accepts its canonical URL form", () => {
  assert.equal(classifyOrcid("https://orcid.org/0000-0002-1825-0097").verdict, "structurally_valid");
});

// ---------------------------------------------------------------------------
// Identifiers without check digits must report what was actually computed, and
// must not be dressed up as verified.
// ---------------------------------------------------------------------------

test("a well-formed DOI is unverifiable, not verified", () => {
  const result = classifyDoi("10.1145/3442188.3445922");
  assert.equal(result.verdict, "unverifiable_form");
  assert.equal(result.checksum_verified, false);
  assert.match(result.reason, /no check digit/);
});

test("DOI accepts its URL and doi: prefixed forms", () => {
  assert.equal(classifyDoi("https://doi.org/10.1038/s41586-021-03819-2").verdict, "unverifiable_form");
  assert.equal(classifyDoi("doi:10.1038/s41586-021-03819-2").verdict, "unverifiable_form");
});

test("a malformed DOI is rejected on grammar", () => {
  assert.equal(classifyDoi("10.12/no-registrant").verdict, "structurally_invalid"); // registrant too short
  assert.equal(classifyDoi("11.1145/wrong-prefix").verdict, "structurally_invalid");
  assert.equal(classifyDoi("10.1145/").verdict, "structurally_invalid"); // empty suffix
});

test("PMID, PMCID and RFC report their form without overclaiming", () => {
  assert.equal(classifyPmid("32015507").verdict, "unverifiable_form");
  assert.equal(classifyPmid("0123").verdict, "structurally_invalid"); // leading zero
  assert.equal(classifyPmcid("PMC7159299").verdict, "unverifiable_form");
  assert.equal(classifyPmcid("PMC0").verdict, "structurally_invalid");
  assert.equal(classifyRfc("RFC 6962").verdict, "unverifiable_form");
  assert.equal(classifyRfc("RFC0").verdict, "structurally_invalid");
});

// ---------------------------------------------------------------------------
// arXiv: the date structure is computable, so impossible dates are decidable.
// ---------------------------------------------------------------------------

test("arXiv accepts well-formed new-style and legacy identifiers", () => {
  assert.equal(classifyArxiv("2103.00020").verdict, "structurally_valid");
  assert.equal(classifyArxiv("2103.00020v2").verdict, "structurally_valid");
  assert.equal(classifyArxiv("1706.03762").verdict, "structurally_valid");
  assert.equal(classifyArxiv("math.GT/0309136").verdict, "structurally_valid");
});

test("arXiv rejects an impossible month", () => {
  const result = classifyArxiv("2113.00020");
  assert.equal(result.verdict, "structurally_invalid");
  assert.match(result.reason, /calendar month/);
});

test("arXiv rejects an identifier predating the scheme", () => {
  assert.equal(classifyArxiv("0601.00020").verdict, "structurally_invalid");
  assert.equal(classifyArxiv("0703.00020").verdict, "structurally_invalid"); // scheme starts 2007-04
});

test("arXiv rejects a 5-digit sequence used before the 2015 expansion", () => {
  assert.equal(classifyArxiv("0704.0001").verdict, "structurally_valid"); // 4-digit, correct for 2007
  const early = classifyArxiv("1412.00010"); // 5-digit before 2015-01
  assert.equal(early.verdict, "structurally_invalid");
  assert.match(early.reason, /5-digit sequence/);
});

test("arXiv honours an explicit horizon and never reads the clock", () => {
  const horizon = { year: 2024, month: 6 };
  assert.equal(classifyArxiv("2405.00001", horizon).verdict, "structurally_valid");
  assert.equal(classifyArxiv("2412.00001", horizon).verdict, "structurally_invalid");
  // Determinism: the default horizon is fixed, so repeated calls agree.
  assert.deepEqual(classifyArxiv("2103.00020"), classifyArxiv("2103.00020"));
});

// ---------------------------------------------------------------------------
// Nothing here may leak surrounding text, and nothing may touch the network.
// ---------------------------------------------------------------------------

test("findings carry the normalized identifier only, never surrounding prose", () => {
  const result = classifyIsbn("978-0-13-235088-4");
  assert.equal(result.identifier, "9780132350884");
  assert.equal(result.identifier.includes(" "), false);
});

// ---------------------------------------------------------------------------
// Extraction and the end-to-end probe.
// ---------------------------------------------------------------------------

import { checksumFailures, extractCitationFindings, grammarFailures } from "../src/citation.js";
import { GlassboxLiteVerifier } from "../src/lite.js";
import type { RedTeamProbe, TrustCard, VerificationInput } from "../src/types.js";

const liteVerifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));
const analyse = (answer: string): Promise<TrustCard> =>
  liteVerifier.verify({ platform: "api", question: "What are the sources?", answer } as VerificationInput);
const resolvability = (card: TrustCard): RedTeamProbe => {
  const probe = card.red_team.probes.find((item) => item.angle === "citation_resolvability");
  assert.ok(probe, "citation_resolvability probe missing");
  return probe;
};

test("extracts labelled identifiers and requires a label where the form is ambiguous", () => {
  const found = extractCitationFindings("See ISBN 978-0-13-235088-4 and ORCID 0000-0002-1825-0097.");
  assert.equal(found.length, 2);
  // A bare 13-digit number is not an ISBN just because it is 13 digits long.
  assert.equal(extractCitationFindings("The order number is 9780132350884.").length, 0);
});

test("recognises prefixed identifiers without a label", () => {
  const kinds = extractCitationFindings(
    "See 10.1145/3442188.3445922, arXiv:1706.03762, PMC7159299 and RFC 6962.",
  ).map((item) => item.kind);
  for (const kind of ["doi", "arxiv", "pmcid", "rfc"]) assert.ok(kinds.includes(kind as never), kind);
});

test("a checksum-invalid identifier is separated from a merely malformed one", () => {
  const bad = extractCitationFindings("ISBN 978-0-13-235088-7 and arXiv:2113.00020");
  assert.equal(checksumFailures(bad).length, 1, "the ISBN checksum failure was not isolated");
  assert.equal(grammarFailures(bad).length, 1, "the impossible arXiv month was not isolated");
});

test("a fabricated ISBN is rejected, and the finding does not overclaim fabrication", async () => {
  const card = await analyse("The method is described in ISBN 978-0-13-235088-7.");
  const probe = resolvability(card);
  assert.equal(probe.passed, false);
  assert.equal(probe.severity, "high");
  assert.equal(card.verdict, "reject", "a proven checksum failure should be decisive");
  assert.match(probe.finding, /check digit/);
  assert.doesNotMatch(probe.finding, /\bis fabricated\b/);
  assert.match(probe.finding, /mistyped|does not distinguish/);
});

test("valid identifiers pass, and passing is not a claim that the work exists", async () => {
  const card = await analyse("See ISBN 978-0-13-235088-4, ORCID 0000-0002-1825-0097 and RFC 6962.");
  const probe = resolvability(card);
  assert.equal(probe.passed, true);
  assert.match(probe.finding, /not existence|nothing was resolved/);
  assert.notEqual(card.verdict, "reject");
});

test("an impossible arXiv identifier cautions rather than rejects", async () => {
  const card = await analyse("As shown in arXiv:2113.00020, the bound is tight.");
  const probe = resolvability(card);
  assert.equal(probe.passed, false);
  assert.equal(probe.severity, "medium", "an unproven grammar failure must not be decisive");
  assert.notEqual(card.verdict, "reject");
});

test("an answer with no identifiers passes without comment", async () => {
  const probe = resolvability(await analyse("Ice is less dense than liquid water."));
  assert.equal(probe.passed, true);
  assert.match(probe.finding, /No checkable identifier/);
});

test("identifier screening is deterministic", async () => {
  const answer = "See ISBN 978-0-13-235088-7 and ORCID 0000-0002-1825-0098.";
  const first = resolvability(await analyse(answer));
  const second = resolvability(await analyse(answer));
  assert.deepEqual(first, second);
});
