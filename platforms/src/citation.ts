/**
 * Computed citation verification.
 *
 * The GBSA-1 held-out benchmark (research/benchmark/RESULTS.md) showed that probes
 * which *compute* a property generalise to unseen surface forms, while probes that
 * *match a vocabulary* do not. `citation_verifiability` was lexical and scored 0.333
 * recall. This module replaces the lexical part with arithmetic.
 *
 * A citation identifier is not merely a string that looks like a citation. A check-digit
 * failure is a *decidable* property of the string alone: it proves the identifier cannot be
 * a correctly transcribed real one, offline, with no lookup and no false positives from
 * paraphrase. The claim, stated exactly:
 *
 *   > A subset of citation-hallucination detection is decidable offline: identifier
 *   > check-digit arithmetic and permanently closed range constraints yield a
 *   > witness-bearing, false-positive-free fabrication signal requiring no network, no
 *   > reference corpus, and no model inference.
 *
 * `test/citation-soundness.test.ts` discharges the false-positive half by generation
 * rather than by example: thousands of identifiers per scheme, check characters computed
 * from the standards by a second implementation, and not one reported invalid.
 *
 * What carries arithmetic (a check character is computed and compared):
 *   ISBN-10 (mod 11) · ISBN-13 (GS1 mod 10) · ISSN (mod 11) · ORCID (ISO 7064 MOD 11-2)
 *   ISNI (MOD 11-2) · LEI (ISO 7064 MOD 97-10) · GTIN-8/12/13/14 and EAN/UPC (GS1 mod 10)
 *
 * What carries a permanently closed range instead (no check digit exists, but a bound
 * that history has already fixed does — a series that has ended cannot gain members):
 *   Federal Reporter F./F.2d/F.3d and F. Supp./F. Supp. 2d/F. App'x volume ceilings
 *   arXiv scheme epochs: the 2007-04 start, the 2015-01 digit-width change, the
 *   1991-2007-03 legacy window, and archives that opened after it closed
 *   the ISBN 979-0 registration group, which is the ISMN music range
 *
 * What carries only a *monotone* bound with deliberate headroom, labelled as such because
 * the registry is still live and a tight bound would rot into a false positive:
 *   PMID (NLM's documented 8-digit field) · U.S. Reports volume headroom
 *
 * What carries neither, and is therefore only ever reported as `unverifiable_form`:
 *   DOI · PMCID · RFC · URLs
 *
 * Scope, stated precisely so it is not overread:
 *   - A `structurally_invalid` verdict means the identifier is malformed, fails its own
 *     check digit, or falls outside a closed range. It does NOT prove the cited work does
 *     not exist, and it does not distinguish a fabricated reference from a mistyped one.
 *   - A `structurally_valid` verdict means the identifier is well-formed and its check
 *     digit is correct. It does NOT prove the cited work exists, and it does not
 *     resolve, fetch, or authenticate anything. Registration is not checked.
 *   - Every bound is a compiled-in constant, never a clock read, and the constant's name
 *     travels in the finding so an audit record says which epoch produced the verdict.
 *   - No network access. No clock access. Same input, same output, forever.
 */

export type CitationKind =
  | "doi"
  | "isbn10"
  | "isbn13"
  | "issn"
  | "orcid"
  | "isni"
  | "lei"
  | "gtin"
  | "arxiv"
  | "pmid"
  | "pmcid"
  | "rfc"
  | "reporter"
  | "url";

export type CitationVerdict = "structurally_valid" | "structurally_invalid" | "unverifiable_form";

export interface CitationFinding {
  kind: CitationKind;
  /** The normalized identifier. Never the surrounding text. */
  identifier: string;
  verdict: CitationVerdict;
  /** Why, in one clause. Safe to surface to a caller. */
  reason: string;
  /** True only when a check digit was actually computed and compared. */
  checksum_verified: boolean;
  /**
   * The frozen epoch constant this verdict depended on, when it depended on one.
   *
   * Every bound in this module is a compiled-in constant, never a clock read, so the
   * verdict is reproducible forever. But "reproducible" is only auditable if the audit
   * record says *which* constant was applied: a reader checking a two-year-old finding
   * needs to know the bound that was in force when it was produced, not the bound in the
   * build they happen to be running. Absent on verdicts that used no bound.
   */
  epoch?: string;
}

/**
 * Every frozen constant in this module, in one place, each with the published fact that
 * fixes it and the date that fact was checked.
 *
 * Two kinds of constant appear here, and the distinction is the whole basis of the
 * false-positive claim:
 *
 *   **Permanently closed.** A series that has ended cannot gain members. `F.2d` stopped at
 *   volume 999 in 1993; there will never be a volume 1000. These can never go stale, and a
 *   value outside them is structurally impossible rather than merely unusual.
 *
 *   **Monotone with a headroom margin.** PubMed assigns PMIDs in increasing order, so an
 *   upper bound is only ever *conservative*: it is set far above the highest issued value
 *   so that growth cannot turn a real identifier into a false positive. Such a bound
 *   catches only the grossly impossible, and it is deliberately loose. It is a frozen build
 *   constant precisely so that it cannot silently tighten as a clock advances.
 *
 * Nothing here is read from the clock, the network, or the environment.
 */
export const CITATION_EPOCHS = {
  /** arXiv's new-style YYMM.NNNN scheme began 2007-04. arxiv.org/help/arxiv_identifier */
  arxiv_new_scheme_start: "arxiv-new-scheme-2007-04",
  /** The 5-digit sequence replaced the 4-digit one at 2015-01. Same source. */
  arxiv_five_digit_start: "arxiv-5-digit-2015-01",
  /** Legacy archive/YYMMNNN identifiers ran 1991 through 2007-03 and stopped. */
  arxiv_legacy_range: "arxiv-legacy-1991..2007-03",
} as const;

/**
 * arXiv identifiers encode a YYMM. Validating "not in the future" would make the
 * result depend on the wall clock and break the determinism guarantee, so the horizon
 * is an explicit parameter with a fixed default rather than `new Date()`.
 * Callers that want a tighter bound pass one; the default never changes across runs.
 */
export const DEFAULT_ARXIV_HORIZON = { year: 2099, month: 12 } as const;

/** arXiv's new-style identifier scheme began 2007-04. Anything earlier is malformed. */
const ARXIV_EPOCH = { year: 2007, month: 4 } as const;

/**
 * The 5-digit sequence began 2015-01. This is a *biconditional*, not a floor: from 2015-01
 * arXiv issues five digits, and before it exactly four. Checking only one direction — as
 * this did — let `arXiv:2301.0001`, a four-digit sequence eight years after the expansion,
 * pass as well-formed.
 */
const ARXIV_FIVE_DIGIT_EPOCH = { year: 2015, month: 1 } as const;

/**
 * Legacy `archive/YYMMNNN` identifiers were issued from 1991, when the server started,
 * until 2007-03, when the new scheme replaced them. Both ends are permanently closed: no
 * legacy identifier will ever be issued again, and none was issued before the service
 * existed. The two-digit year is unambiguous over that span — 91-99 are 1990s, 00-07 are
 * 2000s — because the span is shorter than a century.
 *
 * The lower bound is the *year*, not the month arXiv's first archive opened, because
 * info.arxiv.org/help/arxiv_identifier says only "Identifiers from 1991 through 2007-03".
 * Where the source is coarse the constant is coarse: a tighter lower bound than the source
 * supports would be a guess, and a guess on a lower bound is a false positive waiting.
 */
const ARXIV_LEGACY_START = { year: 1991, month: 1 } as const;
const ARXIV_LEGACY_END = { year: 2007, month: 3 } as const;

// ---------------------------------------------------------------------------
// Check-digit arithmetic
// ---------------------------------------------------------------------------

/**
 * ISBN-10, ISO 2108. Weighted sum with descending weights 10..1, valid iff ≡ 0 (mod 11).
 * The final position may be 'X', meaning 10.
 */
export function isbn10ChecksumValid(digits: string): boolean {
  if (!/^\d{9}[\dX]$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = digits[index]!;
    const value = character === "X" ? 10 : character.charCodeAt(0) - 48;
    sum += value * (10 - index);
  }
  return sum % 11 === 0;
}

/**
 * ISBN-13, identical to EAN-13. Alternating weights 1,3,... valid iff ≡ 0 (mod 10).
 * Only the 978 and 979 GS1 prefixes are assigned to books.
 */
export function isbn13ChecksumValid(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  if (!digits.startsWith("978") && !digits.startsWith("979")) return false;
  // Delegated rather than reimplemented: ISBN-13 *is* a GTIN-13, and two copies of the
  // same weighting would be two places for the weighting to be wrong.
  return gs1ChecksumValid(digits);
}

/**
 * ISSN, ISO 3297. Descending weights 8..2 over the first seven digits; the check digit
 * is (11 - sum mod 11) mod 11, with 10 written as 'X'.
 */
export function issnChecksumValid(digits: string): boolean {
  if (!/^\d{7}[\dX]$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 7; index += 1) {
    sum += (digits.charCodeAt(index) - 48) * (8 - index);
  }
  const expected = (11 - (sum % 11)) % 11;
  const actualCharacter = digits[7]!;
  const actual = actualCharacter === "X" ? 10 : actualCharacter.charCodeAt(0) - 48;
  return expected === actual;
}

/**
 * ORCID iD check digit, ISO/IEC 7064 MOD 11-2, as specified by ORCID.
 * total = ((total + digit) * 2) over the first 15 digits; check = (12 - total mod 11) mod 11.
 */
export function orcidChecksumValid(digits: string): boolean {
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  return mod11_2CheckCharacter(digits.slice(0, 15)) === digits[15];
}

/**
 * ISO/IEC 7064 MOD 97-10, computed as a streaming remainder so no value ever exceeds the
 * safe-integer range. The standard's validity condition is that the whole string, read as
 * a decimal integer with letters expanded to their two-digit ordinal (A=10 ... Z=35), is
 * congruent to 1 modulo 97.
 *
 * Expanding a letter multiplies the running remainder by 100 rather than 10, because the
 * letter contributes two decimal digits. Getting that wrong yields a check that passes on
 * roughly 1 string in 97 regardless of the letters, which is why it is spelled out here.
 */
export function mod97_10Valid(value: string): boolean {
  if (!/^[0-9A-Z]+$/.test(value)) return false;
  let remainder = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + (code - 48)) % 97;
    } else {
      remainder = (remainder * 100 + (code - 55)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * ISO/IEC 7064 MOD 11-2 over a digit body, returning the check character ('0'-'9' or 'X').
 * This is the recursion ORCID specifies, factored out so the same arithmetic serves every
 * scheme that uses it rather than being reimplemented per scheme.
 */
export function mod11_2CheckCharacter(body: string): string {
  let total = 0;
  for (let index = 0; index < body.length; index += 1) {
    total = (total + (body.charCodeAt(index) - 48)) * 2;
  }
  const remainder = (12 - (total % 11)) % 11;
  return remainder === 10 ? "X" : String(remainder);
}

/**
 * GS1 modulo-10 check digit, the family ISBN-13 belongs to. Covers GTIN-8, GTIN-12
 * (UPC-A), GTIN-13 (EAN-13) and GTIN-14, and the weighting is derived from the length
 * rather than tabulated per scheme.
 *
 * GS1's rule is stated from the right: the digit immediately left of the check digit takes
 * weight 3, and weights alternate 3,1,3,1 leftwards. Written from the left that makes the
 * weight depend on the parity of the total length, which is exactly why a single hardcoded
 * alternation cannot serve all four lengths — GTIN-13 starts at weight 1 while GTIN-8,
 * GTIN-12 and GTIN-14 start at weight 3. Deriving it removes that class of mistake.
 */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const weight = (body.length - 1 - index) % 2 === 0 ? 3 : 1;
    sum += (body.charCodeAt(index) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function gs1ChecksumValid(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const body = digits.slice(0, -1);
  return gs1CheckDigit(body) === digits.charCodeAt(digits.length - 1) - 48;
}

// ---------------------------------------------------------------------------
// Structural grammars
// ---------------------------------------------------------------------------

/**
 * DOI, ISO 26324. The registrant code after the "10." prefix is 4-9 digits, optionally
 * with dot-separated sub-elements; the suffix is opaque but must be non-empty.
 */
const DOI_GRAMMAR = /^10\.\d{4,9}(?:\.\d+)*\/\S+$/;

/** arXiv new style: YYMM.NNNN or YYMM.NNNNN, optional version suffix. */
const ARXIV_NEW = /^(\d{2})(\d{2})\.(\d{4,5})(?:v([1-9]\d*))?$/;

/** arXiv legacy style: archive[.subject]/YYMMNNN, optional version suffix. */
const ARXIV_LEGACY = /^([a-z-]+(?:\.[A-Za-z-]{2,})?)\/(\d{2})(\d{2})(\d{3})(?:v([1-9]\d*))?$/;

/**
 * Archives that provably post-date the legacy `archive/YYMMNNN` scheme, from arXiv's own
 * taxonomy (github.com/arXiv/arxiv-base, `taxonomy/definitions.py`, which carries a
 * `start_date` per archive). The legacy scheme closed 2007-03; each of these opened later,
 * so none can legitimately appear in a legacy identifier.
 *
 * This is an *exclusion* list, and that asymmetry is the whole design. An inclusion list of
 * the 34 pre-2007 archives fails toward a false positive the moment it is missing one
 * obscure archive, and there is no way to prove a hand-copied list complete. An exclusion
 * list fails only toward a missed detection, and each member can be justified on its own by
 * one date. Under a hard precision constraint those are not symmetric costs.
 *
 * `stat` sits exactly on the boundary at 2007-04, one month after the scheme closed.
 */
const POST_LEGACY_ARCHIVES: ReadonlySet<string> = new Set([
  "stat",   // 2007-04
  "q-fin",  // 2008-12
  "econ",   // 2017-09
  "eess",   // 2017-09
]);

function monthIsValid(month: number): boolean {
  return month >= 1 && month <= 12;
}

/**
 * arXiv two-digit years are unambiguous in practice: the scheme started in 2007, so
 * 07-99 mean 2007-2099. There is no year that could mean either century.
 */
function arxivYear(twoDigit: number): number {
  return 2000 + twoDigit;
}

export function classifyArxiv(
  raw: string,
  horizon: { year: number; month: number } = DEFAULT_ARXIV_HORIZON,
): CitationFinding {
  const identifier = raw.trim();

  const modern = ARXIV_NEW.exec(identifier);
  if (modern) {
    const year = arxivYear(Number(modern[1]));
    const month = Number(modern[2]);
    if (!monthIsValid(month)) {
      return finding("arxiv", identifier, "structurally_invalid", `month ${modern[2]} is not a calendar month`, false);
    }
    if (year < ARXIV_EPOCH.year || (year === ARXIV_EPOCH.year && month < ARXIV_EPOCH.month)) {
      return finding("arxiv", identifier, "structurally_invalid", "predates the 2007-04 start of the new-style arXiv scheme", false);
    }
    if (year > horizon.year || (year === horizon.year && month > horizon.month)) {
      return finding("arxiv", identifier, "structurally_invalid", "dated after the configured horizon", false);
    }
    // The sequence is 1-indexed: the first submission of a month is 0001. A zero sequence
    // names no submission and never has.
    if (Number(modern[3]) === 0) {
      return finding("arxiv", identifier, "structurally_invalid",
        "the within-month sequence is 1-indexed, so 0 names no submission", false);
    }
    // The digit width is *coupled* to the date in both directions: five digits from
    // 2015-01, exactly four before it. Checking only the first direction let a four-digit
    // sequence years after the expansion pass as well-formed.
    const sequenceLength = modern[3]!.length;
    const fiveDigitEra = year > ARXIV_FIVE_DIGIT_EPOCH.year
      || (year === ARXIV_FIVE_DIGIT_EPOCH.year && month >= ARXIV_FIVE_DIGIT_EPOCH.month);
    if (sequenceLength === 5 && !fiveDigitEra) {
      return finding("arxiv", identifier, "structurally_invalid",
        "5-digit sequence used before the 2015-01 expansion", false,
        CITATION_EPOCHS.arxiv_five_digit_start);
    }
    if (sequenceLength === 4 && fiveDigitEra) {
      return finding("arxiv", identifier, "structurally_invalid",
        "4-digit sequence used after the 2015-01 expansion to 5 digits", false,
        CITATION_EPOCHS.arxiv_five_digit_start);
    }
    return finding("arxiv", identifier, "structurally_valid", "well-formed new-style arXiv identifier", false);
  }

  const legacy = ARXIV_LEGACY.exec(identifier);
  if (legacy) {
    const month = Number(legacy[3]);
    if (!monthIsValid(month)) {
      return finding("arxiv", identifier, "structurally_invalid", `month ${legacy[3]} is not a calendar month`, false);
    }
    // The legacy sequence is 1-indexed too, and always exactly three digits (enforced by
    // the pattern), so 000 is the only impossible value the width does not already exclude.
    if (Number(legacy[4]) === 0) {
      return finding("arxiv", identifier, "structurally_invalid",
        "the within-month sequence is 1-indexed, so 000 names no submission", false);
    }
    // Archives that did not exist while the legacy scheme was open cannot appear in a
    // legacy identifier. Only the exclusion direction is checked — see
    // POST_LEGACY_ARCHIVES for why an inclusion list would be the unsafe way round.
    const archive = legacy[1]!.split(".")[0]!;
    if (POST_LEGACY_ARCHIVES.has(archive)) {
      return finding("arxiv", identifier, "structurally_invalid",
        `the ${archive} archive opened after the legacy identifier scheme closed in 2007-03, ` +
        "so no legacy identifier was ever issued under it",
        false, CITATION_EPOCHS.arxiv_legacy_range);
    }
    // Both ends of the legacy window are permanently closed, so they cannot go stale.
    const year = legacyYear(Number(legacy[2]));
    const before = year < ARXIV_LEGACY_START.year
      || (year === ARXIV_LEGACY_START.year && month < ARXIV_LEGACY_START.month);
    const after = year > ARXIV_LEGACY_END.year
      || (year === ARXIV_LEGACY_END.year && month > ARXIV_LEGACY_END.month);
    if (before) {
      return finding("arxiv", identifier, "structurally_invalid",
        "dated before arXiv began issuing identifiers in 1991", false,
        CITATION_EPOCHS.arxiv_legacy_range);
    }
    if (after) {
      return finding("arxiv", identifier, "structurally_invalid",
        "dated after the legacy scheme closed in 2007-03; identifiers from 2007-04 use the YYMM.NNNNN form", false,
        CITATION_EPOCHS.arxiv_legacy_range);
    }
    return finding("arxiv", identifier, "structurally_valid", "well-formed legacy arXiv identifier", false);
  }

  return finding("arxiv", identifier, "structurally_invalid", "matches no arXiv identifier scheme", false);
}

/**
 * Legacy two-digit years span 1991 to 2007-03, which is under a century, so the mapping
 * is total and unambiguous: 91-99 are 1990s, 00-07 are 2000s. Values 08-90 fall outside the
 * window either way and are rejected by the range check whichever century they are read as,
 * so they are mapped to the 2000s arbitrarily and then refused.
 */
function legacyYear(twoDigit: number): number {
  return twoDigit >= 91 ? 1900 + twoDigit : 2000 + twoDigit;
}

// ---------------------------------------------------------------------------
// Normalization and dispatch
// ---------------------------------------------------------------------------

function finding(
  kind: CitationKind,
  identifier: string,
  verdict: CitationVerdict,
  reason: string,
  checksumVerified: boolean,
  epoch?: string,
): CitationFinding {
  return {
    kind, identifier, verdict, reason,
    checksum_verified: checksumVerified,
    ...(epoch === undefined ? {} : { epoch }),
  };
}

/**
 * ISBN/ISSN/ORCID are written with hyphens, spaces or neither, and copy-paste from PDFs
 * routinely substitutes a Unicode dash for the ASCII one. Strip separators only —
 * never characters that could carry information.
 */
const SEPARATORS = /[\s\-‐‑‒–—―−]/g;

function compact(value: string): string {
  return value.replace(SEPARATORS, "").toUpperCase();
}

/**
 * The shapes on which the check-digit arithmetic is *defined*.
 *
 * `checksum_verified: true` is a claim that a check digit was computed and compared, and
 * downstream (`checksumFailures`, and the decisive `citation_resolvability` gate in
 * `lite.ts`) treats it as proof that the string cannot be a correctly transcribed real
 * identifier. So it may only be set when the arithmetic actually ran. A string of the
 * right *length* but the wrong *shape* — an ISBN-10 with 'X' somewhere other than the
 * final position, a non-ASCII digit, a 13-digit number outside the GS1 book prefixes —
 * never reaches the arithmetic, and reporting it as a check-digit mismatch both overstates
 * what was computed and promotes a grammar failure into a rejection.
 */
/**
 * On ISBN-13 registration groups, and on the one claim here that can be made permanently.
 *
 * The International ISBN Agency's Range Message
 * (isbn-international.org/export_rangemessage.xml, serial c7a6a351-f232-4194-b935-aa90476b2824,
 * dated 2026-09-04) lists which registration groups are assigned under 978 and 979: 287
 * groups, 282 under 978 and exactly {8, 10, 11, 12, 13} under 979. It is tempting to treat
 * an unassigned group as a closed range. It is not one. The registry is *live*: 978-65
 * (Brazil), 978-611 (Thailand) and 979-13 (Spain) were all added within recent years. A
 * verdict of "structurally impossible" resting on a group being unassigned *today* becomes
 * a false positive the day that group is allocated — a check that quietly rots, which is the
 * opposite of what this module claims to provide. The file even carries a serial number
 * precisely because it is expected to change.
 *
 * So no unassigned-group check is implemented. The one group fact that *is* permanent is
 * that 979-0 belongs to the ISMN music-number scheme rather than to books, and that is the
 * only one asserted.
 */
const ISBN_979_0_EPOCH = "isbn-979-0-is-ismn-2008-01";

const ISBN10_SHAPE = /^\d{9}[\dX]$/;
const ISBN13_SHAPE = /^\d{13}$/;
const ISSN_SHAPE = /^\d{7}[\dX]$/;
const ORCID_SHAPE = /^\d{15}[\dX]$/;

export function classifyIsbn(raw: string): CitationFinding {
  const digits = compact(raw);
  if (digits.length === 13) {
    if (!ISBN13_SHAPE.test(digits)) {
      return finding("isbn13", digits, "structurally_invalid",
        "an ISBN-13 is thirteen digits, so no check digit could be computed", false);
    }
    if (!digits.startsWith("978") && !digits.startsWith("979")) {
      // Not a check-digit failure: GS1 assigned only 978 and 979 to books, so this is a
      // thirteen-digit number that is not an ISBN at all. Reported as grammar, which is
      // the weaker finding, because the arithmetic was never applicable.
      return finding("isbn13", digits, "structurally_invalid",
        "a 13-digit ISBN must begin with the 978 or 979 GS1 book prefix", false);
    }
    // 979-0 is the ISMN range, and permanently so: "From 1 January 2008, the ISMN was
    // defined as a thirteen digit identifier beginning 979-0 where the zero replaced M in
    // the old-style number" (en.wikipedia.org/wiki/International_Standard_Music_Number).
    // A 979-0 string with a correct check digit is a well-formed *music* number, so it is
    // reported as the wrong scheme rather than as a bad identifier.
    if (digits.startsWith("9790")) {
      return finding("isbn13", digits, "structurally_invalid",
        "the 979-0 registration group is the ISMN music-number range, which has never been an ISBN group",
        false, ISBN_979_0_EPOCH);
    }
    const valid = isbn13ChecksumValid(digits);
    return finding("isbn13", digits, valid ? "structurally_valid" : "structurally_invalid",
      valid ? "ISBN-13 check digit is correct" : "ISBN-13 check digit does not match the preceding digits", true);
  }
  if (digits.length === 10) {
    if (!ISBN10_SHAPE.test(digits)) {
      return finding("isbn10", digits, "structurally_invalid",
        "an ISBN-10 is nine digits followed by a digit or 'X', so no check digit could be computed", false);
    }
    const valid = isbn10ChecksumValid(digits);
    return finding("isbn10", digits, valid ? "structurally_valid" : "structurally_invalid",
      valid ? "ISBN-10 check digit is correct" : "ISBN-10 check digit does not match the preceding digits", true);
  }
  return finding("isbn13", digits, "structurally_invalid", `ISBN must be 10 or 13 digits, found ${digits.length}`, false);
}

export function classifyIssn(raw: string): CitationFinding {
  const digits = compact(raw);
  if (digits.length !== 8) {
    return finding("issn", digits, "structurally_invalid", `ISSN must be 8 digits, found ${digits.length}`, false);
  }
  if (!ISSN_SHAPE.test(digits)) {
    return finding("issn", digits, "structurally_invalid",
      "an ISSN is seven digits followed by a digit or 'X', so no check digit could be computed", false);
  }
  const valid = issnChecksumValid(digits);
  return finding("issn", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid ? "ISSN check digit is correct" : "ISSN check digit does not match the preceding digits", true);
}

export function classifyOrcid(raw: string): CitationFinding {
  const digits = compact(raw.replace(/^https?:\/\/orcid\.org\//i, ""));
  if (digits.length !== 16) {
    return finding("orcid", digits, "structurally_invalid", `ORCID must be 16 characters, found ${digits.length}`, false);
  }
  if (!ORCID_SHAPE.test(digits)) {
    return finding("orcid", digits, "structurally_invalid",
      "an ORCID is fifteen digits followed by a digit or 'X', so no check digit could be computed", false);
  }
  const valid = orcidChecksumValid(digits);
  return finding("orcid", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid ? "ORCID MOD 11-2 check digit is correct" : "ORCID MOD 11-2 check digit does not match the preceding digits", true);
}

/**
 * Splits a DOI so the registrant code can be judged separately from the rest.
 * ISO 26324 fixes the directory indicator at "10" and calls what follows the registrant
 * code, but it does *not* constrain the registrant's length or value, so nothing stronger
 * than a shape can be read off the standard here.
 */
const DOI_PARTS = /^10\.(\d+)((?:\.\d+)*)\/(\S+)$/;

/**
 * The registrant band, and the exact strength of the claim it supports.
 *
 * ISO 26324 says only that "the second element of the DOI prefix shall be the registrant
 * code... a unique string assigned to a registrant". It sets no minimum. So there is no
 * *closed range* to appeal to here and none is asserted: inventing a floor and calling it
 * arithmetic is precisely the overclaim this module exists not to make.
 *
 * What is citable is Crossref's published DOI-matching pattern,
 * `/^10.\d{4,9}\/[-._;()/:A-Z0-9]+$/i`, which their own post
 * (crossref.org/blog/dois-and-matching-regular-expressions) reports matches 74.4M of the
 * 74.9M DOIs they had then seen. A registrant outside 4-9 digits therefore conforms to no
 * published DOI pattern — which is a *grammar* finding, reported at the weaker severity,
 * never as a check-digit failure. Crossref are explicit that a residue of real DOIs escapes
 * their own pattern, so "matches no published pattern" is as far as this can honestly go.
 */
const DOI_REGISTRANT_MIN_DIGITS = 4;
const DOI_REGISTRANT_MAX_DIGITS = 9;

export function classifyDoi(raw: string): CitationFinding {
  const identifier = raw.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  const parts = DOI_PARTS.exec(identifier);
  if (!parts) {
    return finding("doi", identifier, "structurally_invalid", "does not match the ISO 26324 DOI grammar", false);
  }
  const registrant = parts[1]!;
  if (registrant.length < DOI_REGISTRANT_MIN_DIGITS || registrant.length > DOI_REGISTRANT_MAX_DIGITS) {
    return finding("doi", identifier, "structurally_invalid",
      `registrant code "${registrant}" is ${registrant.length} digit(s); no published DOI pattern admits a ` +
      `registrant outside ${DOI_REGISTRANT_MIN_DIGITS}-${DOI_REGISTRANT_MAX_DIGITS} digits. ` +
      "This is a grammar finding, not a check digit: ISO 26324 sets no minimum, so impossibility is not claimed.",
      false);
  }
  if (!DOI_GRAMMAR.test(identifier)) {
    return finding("doi", identifier, "structurally_invalid", "does not match the ISO 26324 DOI grammar", false);
  }
  // A DOI carries no check digit, so a well-formed one is only ever *unverifiable*,
  // never *verified*. Saying otherwise would overstate what was computed.
  return finding("doi", identifier, "unverifiable_form",
    "well-formed DOI; DOIs carry no check digit, so validity cannot be decided offline", false);
}

/**
 * ISNI, ISO 27729. Sixteen characters: fifteen decimal digits and a check character that is
 * a digit or 'X', computed by ISO/IEC 7064 MOD 11-2 over the preceding fifteen — the same
 * arithmetic ORCID uses, and not MOD 97-10.
 *
 * That is not a coincidence to be papered over: ORCID iDs are issued from a block reserved
 * inside the ISNI namespace, so every ORCID iD *is* a valid ISNI, which forces the two
 * schemes to share a check-digit function. The shared implementation here reflects that
 * rather than duplicating it. `000000012146438X` is the canonical valid example, and it
 * exercises the 'X' branch.
 *
 * The two are told apart only by which label the text carried, so the finding names the
 * scheme the author claimed, not a scheme inferred from the digits.
 */
export function isniChecksumValid(digits: string): boolean {
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  return mod11_2CheckCharacter(digits.slice(0, 15)) === digits[15];
}

export function classifyIsni(raw: string): CitationFinding {
  const digits = compact(raw.replace(/^https?:\/\/isni\.org\/isni\//i, ""));
  if (digits.length !== 16) {
    return finding("isni", digits, "structurally_invalid", `an ISNI is 16 characters, found ${digits.length}`, false);
  }
  if (!ORCID_SHAPE.test(digits)) {
    return finding("isni", digits, "structurally_invalid",
      "an ISNI is fifteen digits followed by a digit or 'X', so no check digit could be computed", false);
  }
  const valid = isniChecksumValid(digits);
  return finding("isni", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid
      ? "ISNI MOD 11-2 check digit is correct"
      : "ISNI MOD 11-2 check digit does not match the preceding digits",
    true);
}

/**
 * LEI, ISO 17442. Twenty characters from [0-9A-Z]: an 18-character entity portion followed
 * by two check digits, validated as ISO/IEC 7064 MOD 97-10 over the whole twenty.
 *
 * ISO 17442-1:2020 Clause 4 gives the format as `18!c2!n`, where "c: upper-case
 * alphanumeric characters (A-Z and 0-9 only)" and "the 19th and 20th characters (2!n) shall
 * be the check digit pair". The trailing pair is therefore *numeric*, not alphanumeric,
 * which is why the shape below is not simply `[0-9A-Z]{20}`.
 *
 * The check is *two* decimal digits, which is what makes this materially stronger than a
 * single-digit scheme: MOD 97-10 detects every single-character error and every
 * transposition, and admits a random string with probability 1/97 rather than 1/10.
 *
 * Two constraints that look tempting and are deliberately absent. Positions 5-6 are "00"
 * in current issuance and the LEI ROC describes them as reserved, but ISO 17442-1 Clause 4
 * does not mention them, and the pre-2013 CICI-era codes still in force do not obey it —
 * Apple (HWUPKR…), Microsoft (INR2EJ…), JPMorgan, Goldman Sachs and Deutsche Bank all
 * carry letters there. Enforcing "00" would reject five of the largest firms in the world.
 * Separately, Clause 5.1 notes valid check pairs lie in [02..98]; that is arithmetically
 * implied by `98 - (n mod 97)` and so would catch nothing MOD 97-10 does not already catch.
 */
const LEI_SHAPE = /^[0-9A-Z]{18}[0-9]{2}$/;

export function classifyLei(raw: string): CitationFinding {
  const value = compact(raw);
  if (value.length !== 20) {
    return finding("lei", value, "structurally_invalid", `an LEI is 20 characters, found ${value.length}`, false);
  }
  if (!LEI_SHAPE.test(value)) {
    // Not a check-digit failure: MOD 97-10 is undefined outside [0-9A-Z], so the
    // arithmetic never ran and reporting it as a mismatch would overstate what was done.
    return finding("lei", value, "structurally_invalid",
      "an LEI uses only digits and uppercase A-Z, so no check digit could be computed", false);
  }
  const valid = mod97_10Valid(value);
  return finding("lei", value, valid ? "structurally_valid" : "structurally_invalid",
    valid
      ? "LEI ISO 7064 MOD 97-10 check digits are correct"
      : "LEI ISO 7064 MOD 97-10 check digits do not match the preceding characters",
    true);
}

/**
 * GTIN-8 / GTIN-12 (UPC-A) / GTIN-13 (EAN-13) / GTIN-14, GS1 modulo 10.
 *
 * Requires an explicit label. A bare thirteen-digit number is not a GTIN just because it
 * has thirteen digits — order numbers, phone numbers and account numbers all have runs of
 * digits — and this scheme has no prefix of its own to key on the way a DOI does.
 *
 * A 978/979 GTIN-13 is an ISBN and is left to the ISBN path, which knows about the book
 * prefixes; reporting the same string twice under two schemes would double-count one fact.
 */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function classifyGtin(raw: string): CitationFinding {
  const digits = compact(raw);
  if (!/^\d+$/.test(digits)) {
    return finding("gtin", digits, "structurally_invalid",
      "a GTIN is decimal digits only, so no check digit could be computed", false);
  }
  if (!GTIN_LENGTHS.has(digits.length)) {
    return finding("gtin", digits, "structurally_invalid",
      `a GTIN is 8, 12, 13 or 14 digits, found ${digits.length}`, false);
  }
  const valid = gs1ChecksumValid(digits);
  return finding("gtin", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid
      ? `GTIN-${digits.length} modulo-10 check digit is correct`
      : `GTIN-${digits.length} modulo-10 check digit does not match the preceding digits`,
    true);
}

/**
 * US case reporters with permanently closed volume ranges.
 *
 * This is the purest instance of the claim this module makes. A reporter series that has
 * ceased publication cannot acquire another volume: the Federal Reporter stopped at 300 in
 * 1924, its second series at 999 in 1993, its third at 999 in 2021. `1053 F.3d 218` is not
 * unlikely, or unverified, or absent from some corpus — it names a volume that does not
 * exist and never will. No lookup, no network, no clock, and the fact cannot go stale,
 * because history does not.
 *
 * Sources: en.wikipedia.org/wiki/Federal_Reporter and en.wikipedia.org/wiki/Federal_Appendix,
 * each final volume additionally confirmed by probing CourtListener — the last volume of a
 * closed series resolves to real cases and the next number does not exist.
 *
 * `F. App'x` is the instructive one. Every other West series here rolled over at 999, but
 * the Federal Appendix was *discontinued* in 2021 and stopped at 861. Assuming 999 across
 * the family would have left 138 phantom volumes accepted, which is why each bound is
 * carried per series rather than derived from a convention.
 *
 * The open series are bounded at 999 rather than at their current volume. 999 is West's
 * structural rollover point, so it cannot reject a citation that will later become valid,
 * whereas a bound at today's highest volume (F.4th was near 181, F. Supp. 3d near 819)
 * would start rejecting real citations within weeks. A bound that rots is worse than none.
 *
 * `U.S.` is open and does not roll over at 999, so its ceiling is a *headroom* bound and is
 * labelled as such wherever it is reported. Volume assignment runs three volumes per Term
 * and stood at 609 for OT2025, after 235 years; 1000 is on the order of a century of
 * headroom. It catches only the grossly impossible, which is all a bound on a live series
 * can honestly claim to do.
 *
 * One check that is deliberately *not* implemented: cross-checking the series against the
 * year in the citation. West assigns volumes by processing order, not decision date, so the
 * series genuinely overlap — 999 F.3d holds cases decided into mid-June 2021 while 1 F.4th
 * starts on 8 June 2021. A year-versus-series check would fire on real citations from every
 * changeover month.
 */
interface ReporterSeries {
  /** Highest volume ever issued, or null for a series still in publication. */
  maxVolume: number | null;
  closed: boolean;
  epoch: string;
  note: string;
}

const REPORTERS: Record<string, ReporterSeries> = {
  "F.": { maxVolume: 300, closed: true, epoch: "reporter-F-closed-1924-vol-300", note: "the Federal Reporter ended at volume 300 in 1924" },
  "F.2d": { maxVolume: 999, closed: true, epoch: "reporter-F2d-closed-1993-vol-999", note: "the Federal Reporter, Second Series ended at volume 999 in 1993" },
  "F.3d": { maxVolume: 999, closed: true, epoch: "reporter-F3d-closed-2021-vol-999", note: "the Federal Reporter, Third Series ended at volume 999 in 2021" },
  "F.4th": { maxVolume: 999, closed: false, epoch: "reporter-F4th-rollover-999", note: "the Federal Reporter, Fourth Series is in publication; 999 is West's rollover point, not a closed range" },
  "F.Supp.": { maxVolume: 999, closed: true, epoch: "reporter-FSupp-closed-1998-vol-999", note: "the Federal Supplement ended at volume 999 in 1998" },
  "F.Supp.2d": { maxVolume: 999, closed: true, epoch: "reporter-FSupp2d-closed-2014-vol-999", note: "the Federal Supplement, Second Series ended at volume 999 in 2014" },
  "F.Supp.3d": { maxVolume: 999, closed: false, epoch: "reporter-FSupp3d-rollover-999", note: "the Federal Supplement, Third Series is in publication; 999 is West's rollover point, not a closed range" },
  "F.App'x": { maxVolume: 861, closed: true, epoch: "reporter-FAppx-discontinued-2021-vol-861", note: "the Federal Appendix was discontinued in 2021 at volume 861, short of a rollover" },
  "U.S.": { maxVolume: 1000, closed: false, epoch: "reporter-US-headroom-1000", note: "United States Reports is in publication; 1000 is a frozen headroom bound, not a closed range" },
};

/** Reporter abbreviations that are not words, so a digit run around one is a citation. */
const REPORTER_DISTINCTIVE = "F\\.(?:2d|3d|4th|\\s*Supp\\.(?:\\s*[23]d)?|\\s*App'?x)";
/** Reporter abbreviations that also have a benign reading of exactly the citation shape. */
const REPORTER_AMBIGUOUS = "F\\.|U\\.S\\.";

const REPORTER_CITATION = new RegExp(`^(\\d{1,4})\\s+(${REPORTER_DISTINCTIVE}|${REPORTER_AMBIGUOUS})\\s+(\\d{1,4})$`);

/** "F. Supp. 2d" and "F.Supp.2d" are the same series; "F. Appx" and "F. App'x" likewise. */
function reporterKey(abbreviation: string): string {
  return abbreviation.replace(/\s+/g, "").replace(/App'?x/i, "App'x");
}

export function classifyReporter(raw: string): CitationFinding {
  const identifier = raw.trim().replace(/\s+/g, " ");
  const match = REPORTER_CITATION.exec(identifier);
  if (!match) {
    return finding("reporter", identifier, "structurally_invalid", "does not match a supported reporter citation form", false);
  }
  const series = REPORTERS[reporterKey(match[2]!)];
  if (!series) {
    return finding("reporter", identifier, "unverifiable_form", `${match[2]} is not a reporter with a known volume bound`, false);
  }
  const volume = Number(match[1]);
  if (volume < 1) {
    return finding("reporter", identifier, "structurally_invalid",
      "reporter volumes are numbered from 1", false, series.epoch);
  }
  if (series.maxVolume !== null && volume > series.maxVolume) {
    return finding("reporter", identifier, "structurally_invalid",
      series.closed
        ? `volume ${volume} does not exist: ${series.note}, so no higher volume can ever be published`
        : `volume ${volume} exceeds the frozen headroom bound of ${series.maxVolume}; ${series.note}`,
      false, series.epoch);
  }
  // A reporter citation carries no check digit. An in-range volume is well-formed and
  // nothing more: the case it names was not looked up.
  return finding("reporter", identifier, "unverifiable_form",
    `volume ${volume} is within the ${reporterKey(match[2]!)} range; reporters carry no check digit, so the case itself was not verified`,
    false, series.epoch);
}

/**
 * A frozen upper bound on PMIDs.
 *
 * PubMed assigns PMIDs sequentially and never reuses them, so an identifier far above the
 * highest issued value names no record.
 *
 * The bound is not a round number picked for comfort: it is NLM's own documented format
 * ceiling. NLM's data-element descriptions define the PMID as "a 1 to 8-digit accession
 * number with no leading zeros", so every format-conforming PMID passes by construction and
 * the check cannot reject a well-formed identifier at all.
 *
 * Independently observed against NCBI E-utilities on 2026-09-04: the highest live PMID was
 * 42,694,033, with a count of zero for the query range 42694034-999999999 and zero across
 * the whole nine-digit space. At the current issuance rate of roughly 1.78M a year the
 * eight-digit space holds until about 2058.
 *
 * It is stated as a headroom bound rather than a closed range because PubMed is a live
 * registry: the bound can only ever be conservative, and it catches the grossly impossible
 * (999999999, an order of magnitude clear of the frontier) while being unable to turn a
 * real PMID into a false positive within any timeframe this code will survive.
 *
 * It is a compiled-in constant and never a clock read, so it cannot silently tighten as
 * time passes — and the constant's name travels in the finding, so an audit record from
 * this build says which bound was applied.
 */
const PMID_HEADROOM_MAX = 99_999_999;
const PMID_EPOCH = "pmid-max-8-digits-nlm-observed-2026-09-04";

export function classifyPmid(raw: string): CitationFinding {
  const identifier = raw.trim().replace(/^pmid:\s*/i, "");
  if (!/^[1-9]\d{0,11}$/.test(identifier)) {
    return finding("pmid", identifier, "structurally_invalid", "PMIDs are positive integers without leading zeros", false);
  }
  if (Number(identifier) > PMID_HEADROOM_MAX) {
    return finding("pmid", identifier, "structurally_invalid",
      `PMID ${identifier} exceeds ${PMID_HEADROOM_MAX}, NLM's documented 8-digit ceiling for the field; the ` +
      "highest PMID observed was 42,694,033 in 2026-09, so no record carries this identifier. " +
      "This is a monotone bound with decades of headroom, not a check digit.",
      false, PMID_EPOCH);
  }
  return finding("pmid", identifier, "unverifiable_form", "well-formed PMID; PMIDs carry no check digit", false);
}

export function classifyPmcid(raw: string): CitationFinding {
  const identifier = raw.trim().toUpperCase();
  if (!/^PMC[1-9]\d{0,8}$/.test(identifier)) {
    return finding("pmcid", identifier, "structurally_invalid", "PMCIDs are 'PMC' followed by a positive integer", false);
  }
  return finding("pmcid", identifier, "unverifiable_form", "well-formed PMCID; PMCIDs carry no check digit", false);
}

export function classifyRfc(raw: string): CitationFinding {
  const match = /^rfc\s*(\d{1,5})$/i.exec(raw.trim());
  if (!match) {
    return finding("rfc", raw.trim(), "structurally_invalid", "does not match the RFC citation form", false);
  }
  const number = Number(match[1]);
  if (number < 1) {
    return finding("rfc", `RFC ${match[1]}`, "structurally_invalid", "RFC numbers start at 1", false);
  }
  return finding("rfc", `RFC ${number}`, "unverifiable_form", "well-formed RFC number; assignment is not checked offline", false);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Identifier candidates found in free text.
 *
 * ISBN, ISSN, ORCID and PMID are ambiguous when bare — a 13-digit number is not an ISBN
 * just because it has 13 digits — so those require an explicit label. DOI, arXiv, PMCID
 * and RFC carry distinctive prefixes and are recognised without one. Requiring the label
 * costs recall on unlabelled references and buys the precision that lets a checksum
 * failure be reported as a hard finding.
 */
/**
 * The separator run permitted *inside* a written identifier. Must stay a subset of
 * `SEPARATORS`, or the extractor could capture a character that `compact` then leaves in
 * place, turning a correctly transcribed identifier into a length failure.
 */
const SEP = "[\\s\\-\\u2010-\\u2015\\u2212]";

/**
 * An ISBN token is exactly ten or exactly thirteen characters. Writing that as a length
 * *range* over a class that includes whitespace let the match run past the end of the
 * identifier and absorb the next number in the sentence: "ISBN 0-306-40615-2 320 pages"
 * captured thirteen characters, which were then read as an ISBN-13 and reported as a
 * check-digit failure — a hard rejection produced by a correctly transcribed ISBN-10.
 *
 * So each length is its own branch, the thirteen-digit branch is anchored to the GS1 book
 * prefixes that are the only way an ISBN-13 can begin, and a trailing `(?![\dX])` refuses
 * a token that is merely the truncation of a longer digit run. Together those mean a
 * captured token is a whole identifier or nothing: the extractor no longer manufactures
 * an identifier out of two adjacent numbers, in either direction.
 */
const ISBN_TOKEN = `(?:97[89](?:${SEP}?\\d){10}|\\d(?:${SEP}?\\d){8}${SEP}?[\\dX])(?![\\dX])`;

/**
 * What may sit between a label and the identifier it labels.
 *
 * `\bORCID\s*:?\s*` requires the digits to follow the word immediately, so
 * "the corresponding author's ORCID **is** 0000-0002-1825-0098" was not extracted at all,
 * and an identifier failing its own check digit produced no finding. One English copula
 * between a label and its value is the ordinary way to write one.
 *
 * The gap is a *closed* set of connectives rather than "up to N arbitrary characters",
 * because an arbitrary gap would let a label reach across a clause and adopt an unrelated
 * number ("no ISBN was listed, 320 pages"). Every member below is a function word joining a
 * label to its value, the run is bounded at two, and the identifier's own shape still has
 * to match exactly afterwards. A reader can check this list; that is the point of it.
 */
const LABEL_GAP = "(?:\\s+(?:is|are|was|were|iD|id|identifier|identifiers|number|numbers|no\\.?|#|=))"
  + "{0,2}\\s*[:=#]?\\s*";

const GROUP4 = `\\d{4}${SEP}?`;

const EXTRACTORS: Array<{ kind: CitationKind; pattern: RegExp; group: number }> = [
  { kind: "isbn13", pattern: new RegExp(`\\bISBN(?:-1[03])?${LABEL_GAP}(${ISBN_TOKEN})`, "gi"), group: 1 },
  { kind: "issn", pattern: new RegExp(`\\bISSN${LABEL_GAP}(\\d{4}${SEP}?\\d{3}[\\dX])(?![\\dX])`, "gi"), group: 1 },
  {
    kind: "orcid",
    pattern: new RegExp(
      `(?:\\bORCID${LABEL_GAP}|https?://orcid\\.org/)(${GROUP4}${GROUP4}${GROUP4}\\d{3}[\\dX])(?![\\dX])`,
      "gi",
    ),
    group: 1,
  },
  // ISNI shares ORCID's sixteen-character shape and its MOD 11-2 check digit, so the two
  // are distinguished only by which label was written. Both are checked by the same
  // arithmetic; the label decides which scheme the finding is reported under.
  {
    kind: "isni",
    pattern: new RegExp(
      `(?:\\bISNI${LABEL_GAP}|https?://isni\\.org/isni/)(${GROUP4}${GROUP4}${GROUP4}\\d{3}[\\dX])(?![\\dX])`,
      "gi",
    ),
    group: 1,
  },
  // LEIs are twenty characters of [0-9A-Z]. That shape is far too common in free text to
  // recognise unlabelled — it matches most alphanumeric reference codes — so the label is
  // required, as it is for every scheme here whose shape is not self-identifying.
  { kind: "lei", pattern: new RegExp(`\\b(?:LEI|Legal Entity Identifier)${LABEL_GAP}([0-9A-Z]{20})(?![0-9A-Z])`, "gi"), group: 1 },
  {
    kind: "gtin",
    pattern: new RegExp(`\\b(?:GTIN(?:-(?:8|12|13|14))?|EAN(?:-(?:8|13))?|UPC(?:-A)?)${LABEL_GAP}(\\d(?:${SEP}?\\d){7,13})(?!\\d)`, "gi"),
    group: 1,
  },
  // The registrant length here must match DOI_GRAMMAR exactly. When the extractor was the
  // looser of the two (\d{1,9} against a grammar of \d{4,9}) every "10.N/..." in ordinary
  // prose — a score of 10.5/12, a dose of 10.5/kg, a version 10.2/build — was captured as
  // a DOI candidate and then reported as a grammar violation, so benign answers failed the
  // citation_resolvability probe. ISO 26324 registrants are four to nine digits; a shorter
  // one is not a malformed DOI, it is not a DOI.
  { kind: "doi", pattern: /(?:\bdoi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}(?:\.\d+)*\/[^\s,;)\]}]+)/gi, group: 1 },
  // A second, deliberately looser DOI branch, gated on an explicit `doi:` or a doi.org
  // URL. The strict branch above has to keep its 4-9 digit registrant because *unlabelled*
  // "10.N/..." occurs constantly in ordinary prose — a score of 10.5/12, a dose of
  // 10.5/kg, a build of 10.2/rc1 — and capturing those produced grammar findings on benign
  // answers. But nobody writes "doi:10.5/12" to mean a ratio. Once the label is present the
  // ambiguity is gone, so the registrant can be read permissively and judged rather than
  // skipped: `doi:10.5/ordering.2021` was previously not extracted at all, and so a DOI
  // conforming to no published pattern produced no finding whatsoever.
  { kind: "doi", pattern: /(?:\bdoi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{1,12}(?:\.\d+)*\/[^\s,;)\]}]+)/gi, group: 1 },
  { kind: "arxiv", pattern: /\barXiv\s*:?\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/gi, group: 1 },
  { kind: "pmid", pattern: new RegExp(`\\bPMID${LABEL_GAP}(\\d{1,12})(?!\\d)`, "gi"), group: 1 },
  { kind: "pmcid", pattern: /\b(PMC\d{1,9})\b/gi, group: 1 },
  { kind: "rfc", pattern: /\b(RFC\s*\d{1,5})\b/gi, group: 1 },
  // Reporter citations, in two branches split by how ambiguous the abbreviation is.
  //
  // "F.2d", "F.3d" and "F.4th" are not words; a digit run around one of them is a
  // citation. Bare "F." and "U.S." are another matter, and both have a benign reading that
  // has exactly the citation's shape: "bake at 350 F. 30 minutes" is Fahrenheit, and
  // "in 2020 U.S. 300 million people" is prose. Extracting those unguarded would have
  // turned an oven temperature into a closed-range violation.
  //
  // So the ambiguous abbreviations additionally require the year parenthetical that
  // conventional legal citation puts after the page. That is a real recall cost on
  // citations written without a year, and it is the right trade: this module's value rests
  // on a checksum-grade finding never firing on benign text.
  { kind: "reporter", pattern: new RegExp(`\\b(\\d{1,4}\\s+(?:${REPORTER_DISTINCTIVE})\\s+\\d{1,4})(?!\\d)`, "g"), group: 1 },
  { kind: "reporter", pattern: new RegExp(`\\b(\\d{1,4}\\s+(?:${REPORTER_AMBIGUOUS})\\s+\\d{1,4})\\s*\\(\\d{4}\\)`, "g"), group: 1 },
];

const CLASSIFIERS: Record<CitationKind, (raw: string) => CitationFinding> = {
  isbn10: classifyIsbn,
  isbn13: classifyIsbn,
  issn: classifyIssn,
  orcid: classifyOrcid,
  isni: classifyIsni,
  lei: classifyLei,
  gtin: classifyGtin,
  reporter: classifyReporter,
  doi: classifyDoi,
  arxiv: (raw) => classifyArxiv(raw),
  pmid: classifyPmid,
  pmcid: classifyPmcid,
  rfc: classifyRfc,
  url: (raw) => finding("url", raw, "unverifiable_form", "URLs are not resolved offline", false),
};

/** Cap on identifiers examined per answer, so a hostile input cannot amplify work. */
const MAX_IDENTIFIERS = 32;

/** Every identifier candidate in the text, classified. Deterministic order. */
export function extractCitationFindings(text: string): CitationFinding[] {
  const findings: CitationFinding[] = [];
  const seen = new Set<string>();
  for (const { kind, pattern, group } of EXTRACTORS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const raw = match[group];
      if (!raw) continue;
      const result = CLASSIFIERS[kind](raw);
      const dedupeKey = `${result.kind}:${result.identifier}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push(result);
      if (findings.length >= MAX_IDENTIFIERS) return findings;
    }
  }
  return findings;
}

/**
 * Identifiers whose own check digit proves they are not a correctly transcribed real
 * identifier. This is the strongest signal in the module: it is arithmetic, it needs no
 * network and no reference corpus, and it cannot fire on a valid identifier.
 */
export function checksumFailures(findings: CitationFinding[]): CitationFinding[] {
  return findings.filter((item) => item.verdict === "structurally_invalid" && item.checksum_verified);
}

/** Identifiers that violate a structural grammar or a permanently closed range. */
export function grammarFailures(findings: CitationFinding[]): CitationFinding[] {
  return findings.filter((item) => item.verdict === "structurally_invalid" && !item.checksum_verified);
}
