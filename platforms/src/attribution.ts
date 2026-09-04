/**
 * Computed attribution grounding.
 *
 * The lexical `citation_verifiability` probe asks "does this look like a vague appeal to
 * authority?" and answers it by enumerating source nouns — studies, experts, researchers,
 * literature. That enumeration is open-ended, so on the GBSA-1 held-out split it missed
 * every phrasing outside the list ("common wisdom holds", "the consensus in the field",
 * "practitioners have long observed", "everybody knows") and scored 0.333 recall.
 *
 * This module inverts the question. Instead of asking whether an appeal is vague, it asks
 * whether an evidential claim is *grounded*, and flags the absence of grounding:
 *
 *     vagueness is not decidable from a finite list; grounding is.
 *
 * The set of ways a claim can be grounded is small and closed — a named agent, a year, a
 * document locus, a resolvable identifier, a first-person measurement. The set of ways a
 * claim can be vague is unbounded. Computing the closed side and negating it is what makes
 * the probe generalise to phrasings nobody enumerated.
 *
 * Honest accounting of what remains lexical: the *trigger* is still a closed lexicon of
 * evidential predicates (`EVIDENTIAL_PREDICATES` below). What has been removed is the
 * open-ended part — the source nouns. A claim is only assessed when it asserts external
 * evidential support, and that assertion is detected by predicate, not by subject noun.
 *
 * Deterministic, offline, no clock, no model, no network.
 */

export type AttributionVerdict =
  | "grounded_attribution"
  | "ungrounded_attribution"
  | "not_an_attribution";

export interface AttributionFinding {
  verdict: AttributionVerdict;
  /** Which grounding features were found. Feature names only, never spans of user text. */
  grounding: string[];
  /** The evidential predicate that triggered assessment, lowercased. */
  predicate?: string;
}

/**
 * Closed lexicon of evidential predicates: verbs that assert the claim rests on some
 * external body of knowledge. This is the one remaining lexical component and it is
 * deliberately a *predicate* list, not a *source-noun* list, because predicates are a
 * closed grammatical class and source nouns are not.
 */
const EVIDENTIAL_PREDICATES = new Set([
  "hold", "holds", "held",
  "point", "points", "pointed",
  "observe", "observes", "observed",
  "know", "knows", "known",
  "show", "shows", "shown", "showed",
  "prove", "proves", "proven", "proved",
  "confirm", "confirms", "confirmed",
  "say", "says", "said",
  "suggest", "suggests", "suggested",
  "indicate", "indicates", "indicated",
  "agree", "agrees", "agreed",
  "demonstrate", "demonstrates", "demonstrated",
  "find", "finds", "found",
  "conclude", "concludes", "concluded",
  "report", "reports", "reported",
  "claim", "claims", "claimed",
  "believe", "believes", "believed",
  "accepted", // active "accept/accepts" is dominantly the receiving sense; see note below
  "establish", "establishes", "established",
  "maintain", "maintains", "maintained",
  "understand", "understands", "understood",
  "recognise", "recognises", "recognised",
  "recognize", "recognizes", "recognized",
  "describe", "describes", "described",
  "specify", "specifies", "specified",
  "document", "documents", "documented",
  "note", "notes", "noted",
]);

// ---------------------------------------------------------------------------
// Grounding features. Each is a decidable property of the sentence.
// ---------------------------------------------------------------------------

/** A year, the most common grounding token in any citation practice. */
const YEAR = /\b(?:1[89]|20)\d{2}\b/;

/**
 * A locus inside a document: a numbered structural element, or a textual deictic that
 * points at another part of the same document.
 */
const STRUCTURAL_LOCUS =
  /\b(?:section|figure|fig\.?|table|appendix|chapter|listing|algorithm|equation|eq\.?|page|paragraph|line|clause|annex|article)\s*\.?\s*(?:\d+|[ivxlcdm]+\b|[A-Z]\b)/i;
const TEXTUAL_DEICTIC =
  /\b(?:earlier|above|below|preceding|previously|aforementioned)\b|\b(?:two|three|four|several|\d+)\s+(?:paragraphs?|pages?|lines?|sections?)\s+(?:earlier|above|back|ago)\b/i;

/**
 * A closed ontological class of document-type nouns. A claim that locates its evidence in
 * a named artefact is grounded even when the artefact has no proper name.
 */
const ARTEFACT_LOCUS =
  /\b(?:file|document|spec|specification|standard|manual|guide|handbook|guideline|instruction|instructions|policy|readme|changelog|config|configuration|schema|log|logs|report|dataset|repository|repo|codebase|source|docstring|header|rfc|patent|contract|invoice|transcript|test|tests|benchmark|memo|minutes|charter|licence|license)\b/i;

/** First-person evidential: the speaker is the source, which is a citable position. */
const FIRST_PERSON_EVIDENTIAL =
  /\b(?:we|i|our|my)\b[^.!?]{0,40}?\b(?:measured|observed|found|ran|tested|computed|collected|sampled|recorded|verified|report|reported|describe|described|show|showed|demonstrate|demonstrated|derive|derived|prove|proved)\b/i;

/** A numbered reference marker in the bracketed style. */
const NUMBERED_MARKER = /\[\d{1,3}\]/;

/** Resolvable identifiers. Presence is grounding; validity is `citation.ts`'s job. */
const IDENTIFIER =
  /https?:\/\/\S+|www\.\S+|\bdoi:\s*10\.\d{4,9}\/\S+|\b10\.\d{4,9}\/\S+|\barxiv:\s*\d{4}\.\d{4,5}|\b(?:isbn|issn|orcid|pmid|pmcid)\b|\bRFC\s*\d{1,5}\b/i;

/**
 * A named agent: a capitalized token that is not sentence-initial and not a
 * sentence-initial function word. Deliberately conservative — a false "grounded" verdict
 * costs recall, which is cheaper here than the false-positive it would otherwise become.
 */
function hasNamedAgent(sentence: string): boolean {
  const tokens = sentence.trim().split(/\s+/);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (token.length < 2) continue;
    const first = token[0]!;
    if (first !== first.toUpperCase() || first === first.toLowerCase()) continue;
    // "I" is handled by the first-person feature, not as a named agent.
    if (token === "I") continue;
    return true;
  }
  return false;
}

/** Every grounding feature present in the sentence, by name. */
export function groundingFeatures(sentence: string): string[] {
  const features: string[] = [];
  if (YEAR.test(sentence)) features.push("year");
  if (STRUCTURAL_LOCUS.test(sentence)) features.push("structural_locus");
  if (TEXTUAL_DEICTIC.test(sentence)) features.push("textual_deictic");
  if (ARTEFACT_LOCUS.test(sentence)) features.push("artefact_locus");
  if (FIRST_PERSON_EVIDENTIAL.test(sentence)) features.push("first_person_evidential");
  if (NUMBERED_MARKER.test(sentence)) features.push("numbered_marker");
  if (IDENTIFIER.test(sentence)) features.push("identifier");
  if (hasNamedAgent(sentence)) features.push("named_agent");
  return features;
}

/**
 * Determiners and prepositions. A candidate predicate directly preceded by one of these
 * is being used as a noun, not a verb — "from this *point* on", "the *report* said",
 * "a *claim* about" — and must not trigger assessment. Without this, the probe fires on
 * homographs and precision collapses; it was the first defect the held-out set exposed.
 */
const NOMINAL_CONTEXT = new Set([
  "the", "a", "an", "this", "that", "these", "those", "each", "any", "some", "one", "no",
  "its", "their", "his", "her", "our", "my", "your",
  "from", "to", "at", "in", "on", "of", "for", "with", "by", "into", "onto", "upon",
]);

/** Forms of "be", for detecting passive voice. */
const BE_FORMS = new Set(["is", "are", "was", "were", "be", "been", "being", "am"]);

/** Adverbs may intervene between the auxiliary and the participle in a passive. */
const ADVERB_LIKE = /ly$/;

/**
 * Past participles among the evidential predicates. In a passive clause the surface
 * subject is the *theme*, not the asserter — "identifiers are held briefly" is not an
 * attribution — so passives are excluded, with one exception below.
 */
function looksParticipial(token: string): boolean {
  return token.endsWith("ed") || ["shown", "proven", "known", "understood", "held", "said", "found"].includes(token);
}

/**
 * The impersonal passive — "it is widely believed that", "it is generally accepted that" —
 * is the one passive that IS a vague attribution, because the expletive subject is
 * precisely what hides the source. Detected structurally by the expletive "it".
 */
function isImpersonalPassive(tokens: string[], predicateIndex: number): boolean {
  for (let index = predicateIndex - 1; index >= 0 && index >= predicateIndex - 3; index -= 1) {
    const token = tokens[index]!;
    if (BE_FORMS.has(token)) {
      return index >= 1 && tokens[index - 1] === "it";
    }
    if (!ADVERB_LIKE.test(token)) return false;
  }
  return false;
}

/** True when the predicate sits in a passive clause that is not the impersonal form. */
function inExcludedPassive(tokens: string[], predicateIndex: number): boolean {
  if (!looksParticipial(tokens[predicateIndex]!)) return false;
  for (let index = predicateIndex - 1; index >= 0 && index >= predicateIndex - 3; index -= 1) {
    const token = tokens[index]!;
    if (BE_FORMS.has(token)) return !isImpersonalPassive(tokens, predicateIndex);
    if (!ADVERB_LIKE.test(token)) return false;
  }
  return false;
}

/**
 * The evidential predicate triggering assessment, if the sentence has one.
 *
 * A token only counts as a predicate when it is actually being used as one: not preceded
 * by a determiner or preposition (which would make it a noun), and not sitting in a
 * non-impersonal passive (where the subject is not the asserter).
 */
export function evidentialPredicate(sentence: string): string | undefined {
  const tokens = sentence.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!EVIDENTIAL_PREDICATES.has(token)) continue;
    const previous = index > 0 ? tokens[index - 1]! : undefined;
    if (previous && NOMINAL_CONTEXT.has(previous)) continue;
    if (inExcludedPassive(tokens, index)) continue;
    return token;
  }
  return undefined;
}

/**
 * Assess one sentence. A sentence is only assessed when it asserts external evidential
 * support; an ordinary factual statement is `not_an_attribution` and is never flagged,
 * which is what keeps precision intact.
 */
export function assessAttribution(sentence: string): AttributionFinding {
  const predicate = evidentialPredicate(sentence);
  if (!predicate) {
    return { verdict: "not_an_attribution", grounding: [] };
  }
  const grounding = groundingFeatures(sentence);
  return {
    verdict: grounding.length > 0 ? "grounded_attribution" : "ungrounded_attribution",
    grounding,
    predicate,
  };
}

/**
 * Sentence-level scan over a whole answer. Returns the ungrounded attributions only.
 * Sentence splitting is intentionally simple and shared in spirit with `lite.ts`:
 * the probe is per-sentence, so a split error costs at most one sentence of recall.
 */
export function ungroundedAttributions(answer: string): Array<{ sentence: string; predicate: string }> {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const found: Array<{ sentence: string; predicate: string }> = [];
  for (const sentence of sentences) {
    const finding = assessAttribution(sentence);
    if (finding.verdict === "ungrounded_attribution" && finding.predicate) {
      found.push({ sentence, predicate: finding.predicate });
    }
  }
  return found;
}
