/**
 * Computed citation verification.
 *
 * The GBSA-1 held-out benchmark (research/benchmark/RESULTS.md) showed that probes
 * which *compute* a property generalise to unseen surface forms, while probes that
 * *match a vocabulary* do not. `citation_verifiability` was lexical and scored 0.333
 * recall. This module replaces the lexical part with arithmetic.
 *
 * A citation identifier is not merely a string that looks like a citation. ISBN, ISSN
 * and ORCID carry check digits, and DOI, arXiv and PMID carry structural grammars.
 * A check-digit failure is a *decidable* property of the string alone: it proves the
 * identifier cannot be a correctly transcribed real one, offline, with no lookup and
 * no false positives from paraphrase.
 *
 * Scope, stated precisely so it is not overread:
 *   - A `structurally_invalid` verdict means the identifier is malformed or fails its
 *     own check digit. It does NOT prove the cited work does not exist.
 *   - A `structurally_valid` verdict means the identifier is well-formed and its check
 *     digit is correct. It does NOT prove the cited work exists, and it does not
 *     resolve, fetch, or authenticate anything. Registration is not checked.
 *   - No network access. No clock access. Same input, same output, forever.
 */

export type CitationKind =
  | "doi"
  | "isbn10"
  | "isbn13"
  | "issn"
  | "orcid"
  | "arxiv"
  | "pmid"
  | "pmcid"
  | "rfc"
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
}

/**
 * arXiv identifiers encode a YYMM. Validating "not in the future" would make the
 * result depend on the wall clock and break the determinism guarantee, so the horizon
 * is an explicit parameter with a fixed default rather than `new Date()`.
 * Callers that want a tighter bound pass one; the default never changes across runs.
 */
export const DEFAULT_ARXIV_HORIZON = { year: 2099, month: 12 } as const;

/** arXiv's new-style identifier scheme began 2007-04. Anything earlier is malformed. */
const ARXIV_EPOCH = { year: 2007, month: 4 } as const;

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
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    const value = digits.charCodeAt(index) - 48;
    sum += index % 2 === 0 ? value : value * 3;
  }
  return sum % 10 === 0;
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
  let total = 0;
  for (let index = 0; index < 15; index += 1) {
    total = (total + (digits.charCodeAt(index) - 48)) * 2;
  }
  const expected = (12 - (total % 11)) % 11;
  const actualCharacter = digits[15]!;
  const actual = actualCharacter === "X" ? 10 : actualCharacter.charCodeAt(0) - 48;
  return expected === actual;
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
const ARXIV_NEW = /^(\d{2})(\d{2})\.(\d{4,5})(?:v(\d+))?$/;

/** arXiv legacy style: archive[.subject]/YYMMNNN, optional version suffix. */
const ARXIV_LEGACY = /^([a-z-]+(?:\.[A-Z]{2})?)\/(\d{2})(\d{2})(\d{3})(?:v(\d+))?$/;

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
    // The 5-digit sequence form began 2015-01; before that the sequence was 4 digits.
    const sequenceLength = modern[3]!.length;
    const fiveDigitEra = year > 2015 || (year === 2015 && month >= 1);
    if (sequenceLength === 5 && !fiveDigitEra) {
      return finding("arxiv", identifier, "structurally_invalid", "5-digit sequence used before the 2015-01 expansion", false);
    }
    return finding("arxiv", identifier, "structurally_valid", "well-formed new-style arXiv identifier", false);
  }

  const legacy = ARXIV_LEGACY.exec(identifier);
  if (legacy) {
    const month = Number(legacy[3]);
    if (!monthIsValid(month)) {
      return finding("arxiv", identifier, "structurally_invalid", `month ${legacy[3]} is not a calendar month`, false);
    }
    return finding("arxiv", identifier, "structurally_valid", "well-formed legacy arXiv identifier", false);
  }

  return finding("arxiv", identifier, "structurally_invalid", "matches no arXiv identifier scheme", false);
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
): CitationFinding {
  return { kind, identifier, verdict, reason, checksum_verified: checksumVerified };
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

export function classifyIsbn(raw: string): CitationFinding {
  const digits = compact(raw);
  if (digits.length === 13) {
    const valid = isbn13ChecksumValid(digits);
    return finding("isbn13", digits, valid ? "structurally_valid" : "structurally_invalid",
      valid ? "ISBN-13 check digit is correct" : "ISBN-13 check digit does not match the preceding digits", true);
  }
  if (digits.length === 10) {
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
  const valid = issnChecksumValid(digits);
  return finding("issn", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid ? "ISSN check digit is correct" : "ISSN check digit does not match the preceding digits", true);
}

export function classifyOrcid(raw: string): CitationFinding {
  const digits = compact(raw.replace(/^https?:\/\/orcid\.org\//i, ""));
  if (digits.length !== 16) {
    return finding("orcid", digits, "structurally_invalid", `ORCID must be 16 characters, found ${digits.length}`, false);
  }
  const valid = orcidChecksumValid(digits);
  return finding("orcid", digits, valid ? "structurally_valid" : "structurally_invalid",
    valid ? "ORCID MOD 11-2 check digit is correct" : "ORCID MOD 11-2 check digit does not match the preceding digits", true);
}

export function classifyDoi(raw: string): CitationFinding {
  const identifier = raw.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  if (!DOI_GRAMMAR.test(identifier)) {
    return finding("doi", identifier, "structurally_invalid", "does not match the ISO 26324 DOI grammar", false);
  }
  // A DOI carries no check digit, so a well-formed one is only ever *unverifiable*,
  // never *verified*. Saying otherwise would overstate what was computed.
  return finding("doi", identifier, "unverifiable_form",
    "well-formed DOI; DOIs carry no check digit, so validity cannot be decided offline", false);
}

export function classifyPmid(raw: string): CitationFinding {
  const identifier = raw.trim().replace(/^pmid:\s*/i, "");
  if (!/^[1-9]\d{0,8}$/.test(identifier)) {
    return finding("pmid", identifier, "structurally_invalid", "PMIDs are positive integers without leading zeros", false);
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
const EXTRACTORS: Array<{ kind: CitationKind; pattern: RegExp; group: number }> = [
  { kind: "isbn13", pattern: /\bISBN(?:-1[03])?\s*:?\s*((?:97[89][\s‐-―-]?)?[\dX][\d\sX‐-―-]{8,20}[\dX])/gi, group: 1 },
  { kind: "issn", pattern: /\bISSN\s*:?\s*(\d{4}[\s‐-―-]?\d{3}[\dX])\b/gi, group: 1 },
  { kind: "orcid", pattern: /(?:\bORCID\s*:?\s*|https?:\/\/orcid\.org\/)(\d{4}[\s‐-―-]?\d{4}[\s‐-―-]?\d{4}[\s‐-―-]?\d{3}[\dX])\b/gi, group: 1 },
  { kind: "doi", pattern: /(?:\bdoi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{1,9}(?:\.\d+)*\/[^\s,;)\]}]+)/gi, group: 1 },
  { kind: "arxiv", pattern: /\barXiv\s*:?\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/gi, group: 1 },
  { kind: "pmid", pattern: /\bPMID\s*:?\s*(\d{1,9})\b/gi, group: 1 },
  { kind: "pmcid", pattern: /\b(PMC\d{1,9})\b/gi, group: 1 },
  { kind: "rfc", pattern: /\b(RFC\s*\d{1,5})\b/gi, group: 1 },
];

const CLASSIFIERS: Record<CitationKind, (raw: string) => CitationFinding> = {
  isbn10: classifyIsbn,
  isbn13: classifyIsbn,
  issn: classifyIssn,
  orcid: classifyOrcid,
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
