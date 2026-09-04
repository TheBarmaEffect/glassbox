# GBSA-1 results

Datasets built 2026-08-15 from seeded generators; results re-executed and
re-scored **2026-09-04, after the probe rebuild described below** against
GlassBox Lite, in process, no API key, no network. Every number below was
produced by `run_benchmark.mjs` + `score.py` and is regenerable with the
commands in `REPRODUCE.md`.

Pinned digests for this run (`determinism.json`, `determinism_heldout.json`):

| Split | n | Digest, 3 identical passes |
|---|---|---|
| Development | 112 | `15bf4ca5b74c0499a3a7c4894b3e7356…` |
| Held-out | 75 | `24405eb8d590b0829d6c5be2d6b4e663…` |

Both digests changed from the previous revision of this file
(`82216c3f27ad8654c6c62f2f099da8a9…` and `87574ea96c52643cb0eecafb8397c1d6…`).
They changed because two probes were rebuilt, not because the datasets moved:
`dataset.jsonl` and `heldout.jsonl` still regenerate byte-identically from their
seeded generators.

## Headline

**Recall generalises for the probes that compute a property. Two probes that did
not generalise were rebuilt to compute one, and they now do.** On the held-out
split, `unsupported_certainty` and `prompt_injection` were the two worst rows in
this document at **0.000** recall each; both are now **1.000** at precision
1.000. `citation_verifiability`, which was not rebuilt, is still at **0.333**.

That before/after is the result, and both halves of it are load-bearing. The
0.000 measurement was real, it was reproduced independently by
`research/comparison/` and `research/benchmark/GBSA2_RESULTS.md`, and it is what
motivated the rebuild. What it diagnosed was not lexicon size: it was that a
regular-expression vocabulary does not generalise past the phrasings it
enumerates, and — the sharper finding, from GBSA-2 defect 5 — that its coverage
was not even *monotonic* in vocabulary size. Replacing the vocabulary with a
computed relation is what moved the number. See
[The finding](#the-finding-restated-as-a-diagnosis-and-its-outcome).

**Precision is 1.000 wherever a scored probe fired, on both splits — but that
figure is a property of the scoring protocol, not of the deployed system.**
`score.py` consults only the probe that a given stratum targets. Under that
convention there are zero false positives across all 187 items. Under the
any-flag protocol a caller of `/api/v1/verify` actually experiences, GlassBox
flags **6 of the 93 benign answers** in this corpus — unchanged by the rebuild,
and still every one of them `answer_relevance`. See
[Precision is protocol-dependent](#precision-is-protocol-dependent).

## The three measurements, in order

| Split | Scope | Micro precision | Micro recall | Micro F1 | n |
|---|---|---|---|---|---|
| Development, after repair | all items | 1.000 | 0.879 | 0.936 | 112 |
| Development, after repair | in-scope only | 1.000 | 1.000 | 1.000 | 112 |
| **Held-out, after rebuild** | all items = in-scope | **1.000** | **0.889** | **0.941** | 75 |

The held-out row was **1.000 / 0.667 / 0.800** before the rebuild. Held-out micro
recall's Wilson 95% interval is now [0.75, 0.96], and all four remaining misses
are `citation_verifiability`.

Two rows are reported for the development split because `score.py` reports two,
and quoting only one has caused drift before. The development split deliberately
contains **8 positives that the paper predicts are out of scope** — 4 arithmetic
items outside the stated allowlist and 4 contradictions that are semantic rather
than lexical. Excluding those predicted misses is what produces the 1.000 row;
it is a statement about the items, not about capability. The held-out split
contains **no** out-of-scope items, so its two scopes coincide and its recall of
0.889 counts every miss.

The development split was used to find defects and the implementation was then
repaired against it. **Its post-repair score is therefore tuned on the test set
and must not be quoted as a capability estimate, under either scope.** The
held-out split was written after the repairs, using surface forms deliberately
excluded from every pattern that was touched. It was the only honest
generalisation figure here.

**That is no longer true of two probes, and the reader must be told why.** The
held-out 0.000 rows for `unsupported_certainty` and `prompt_injection` were
*read* while their replacements were being designed, and the replacements'
tests (`platforms/test/certainty-computed.test.ts`,
`platforms/test/injection-computed.test.ts`) assert the held-out surface forms
by name. Those two held-out cells are therefore now development cells, and
**their 1.000 is a tuned figure, not a capability estimate.** The same applies to
GBSA-2's `cert` and `inj` strata: GBSA-2 defect 5 is what diagnosed the
brittleness, its items are asserted in the same test files, and so **GBSA-2 is
spent for these two probes too.**

What that leaves is honest but narrower than a recall number:

- For `arithmetic_sanity`, `internal_contradiction` and `citation_verifiability`
  the held-out figures below are still clean generalisation estimates.
- For `unsupported_certainty` and `prompt_injection` **no clean split remains.**
  The defensible claim is a *mechanism* claim — the detector is now a computed
  relation rather than a vocabulary, and the property it was rebuilt to have is
  proved directly rather than sampled: see
  [What replaced the vocabularies](#what-replaced-the-vocabularies), where an
  exhaustive 4,928-form grid and a 8,704-pair monotonicity grid are enumerated
  rather than sampled. A third split, unread by any rebuild, is the only thing
  that would license a recall claim for these two, and it does not exist yet.

A "development, before repair" row appeared in earlier revisions of this file at
0.975 precision / 0.812 recall / 0.886 F1. **It is withdrawn.** It was measured
against source that no longer exists in the tree, no artifact for it was ever
committed, and no command in `REPRODUCE.md` regenerates it. The qualitative
claim it supported — that repairing lexical vocabularies raised development
recall substantially while barely moving held-out recall — is measured below
without it.

## Development, per probe

Reported at both scopes, all items first.

| Probe | Kind | TP | FP | FN | TN | Precision | Recall | F1 | Recall 95% CI |
|---|---|---|---|---|---|---|---|---|---|
| `arithmetic_sanity` | computed | 25 | 0 | 3 | 24 | 1.000 | 0.893 | 0.943 | [0.73, 0.96] |
| `internal_contradiction` | structural | 8 | 0 | 4 | 8 | 1.000 | 0.667 | 0.800 | [0.39, 0.86] |
| `unsupported_certainty` | lexical | 6 | 0 | 0 | 6 | 1.000 | 1.000 | 1.000 | [0.61, 1.00] |
| `citation_verifiability` | lexical | 7 | 0 | 0 | 3 | 1.000 | 1.000 | 1.000 | [0.65, 1.00] |
| `prompt_injection` | lexical | 5 | 0 | 0 | 5 | 1.000 | 1.000 | 1.000 | [0.57, 1.00] |
| Micro, all items | | 51 | 0 | 7 | 46 | 1.000 | 0.879 | 0.936 | [0.77, 0.94] |
| Micro, in-scope only | | 50 | 0 | 0 | 46 | 1.000 | 1.000 | 1.000 | [0.93, 1.00] |

All 7 all-items misses are out-of-scope positives: 3 of the 4 allowlist-excluded
arithmetic items and all 4 semantic contradictions. `unsupported_certainty`,
`citation_verifiability` and `prompt_injection` are at 1.000 recall here
**because they were fitted against exactly these items** — by vocabulary repair
in August, and for two of them by rebuild in September. That is the tuned figure.
This table did not move at all across the rebuild: every cell is identical to the
previous revision.

## Held-out, per probe

| Probe | Kind (now) | TP | FP | FN | TN | Precision | Recall | F1 | Recall 95% CI |
|---|---|---|---|---|---|---|---|---|---|
| `arithmetic_sanity` | computed | 16 | 0 | 0 | 16 | 1.000 | **1.000** | 1.000 | [0.81, 1.00] |
| `internal_contradiction` | structural | 6 | 0 | 0 | 6 | 1.000 | **1.000** | 1.000 | [0.61, 1.00] |
| `unsupported_certainty` | computed (quantificational) † | 4 | 0 | 0 | 4 | 1.000 | **1.000** | 1.000 | [0.51, 1.00] |
| `prompt_injection` | computed (relational) † | 4 | 0 | 0 | 4 | 1.000 | **1.000** | 1.000 | [0.51, 1.00] |
| `citation_verifiability` | lexical | 2 | 0 | 4 | 3 | 1.000 | **0.333** | 0.500 | [0.10, 0.70] |
| Micro | | 32 | 0 | 4 | 33 | 1.000 | 0.889 | 0.941 | [0.75, 0.96] |

† **Tuned on this split.** These two rows are not capability estimates — see the
caveat above. The rows to compare against are what they replaced:

| Probe | Before rebuild | After rebuild |
|---|---|---|
| `unsupported_certainty` | 0/0/4/4 · precision n/a · recall **0.000** · [0.00, 0.49] | 4/0/0/4 · precision 1.000 · recall **1.000** |
| `prompt_injection` | 0/0/4/4 · precision n/a · recall **0.000** · [0.00, 0.49] | 4/0/0/4 · precision 1.000 · recall **1.000** |
| Micro | 24/0/12/33 · 1.000 / 0.667 / 0.800 | 32/0/4/33 · 1.000 / 0.889 / 0.941 |

Precision was `n/a` rather than 1.000 for those two probes in the previous
revision, because on this split they had never fired at all. That reading is
withdrawn only in the sense that they now fire; the wording discipline it
enforced — do not report a precision for a probe with no firings — stands.

## The finding, restated as a diagnosis and its outcome

The probes separated cleanly into two classes, and the split was not arbitrary.
**That separation was the diagnosis. The rebuild is the outcome, and the
before/after is the result.** Neither half survives without the other: the 0.000
rows are what identified the mechanism to replace, and the 1.000 rows are what
replacing it bought.

**Probes that compute a property generalise.** `arithmetic_sanity` recomputes
the expression, so it is indifferent to phrasing: 1.000 recall on unseen
framings. `internal_contradiction` tests negation polarity and normalised token
overlap, which is structural rather than lexical, and it also reaches **1.000**
on unseen wording — every one of the 6 held-out contradictions, at 1.000
precision against 6 near-miss controls built from the same surface forms. Both
of these are clean: neither was touched by the rebuild.

**Probes that matched a vocabulary did not generalise — and the reason was not
lexicon size.** This is the part that has changed, and it changed because the
diagnosis got sharper, not because the original measurement was wrong. Three
independent measurements agreed that `unsupported_certainty` and
`prompt_injection` were at 0.000 on unseen phrasings: this file,
`research/comparison/COMPARISON_RESULTS.md` (where a ~40-term word list beat both
of them), and `GBSA2_RESULTS.md`. The fourth measurement is the one that
explained it: GBSA-2 defect 5 found that coverage was **not monotonic in
vocabulary size**. "Ignore all previous instructions", "Ignore all earlier
instructions" and "Ignore earlier instructions" all fired; "Ignore every earlier
instruction" was silent. Every token in the silent form was one the pattern
already knew. Inserting one unmatched token between the verb and the noun broke
the match outright. Enlarging the vocabulary could not fix that, which is why
"vocabulary repair buys development score, not capability" was true and why
repairing the vocabulary again was not the response.

Two cautions on that clean separation. The held-out strata are small — 16 and 6
positives — so the intervals are wide ([0.81, 1.00] and [0.61, 1.00]), and
`internal_contradiction`'s 1.000 rests on 6 items. And on the development split
the same two probes score 0.893 and 0.667 all-items, *below* their held-out
figures, because that split carries 8 positives the design predicts it will miss
and the held-out split carries none. The comparison that means anything is
per-probe and within a split, not across them.

### What replaced the vocabularies

Neither rebuild is a bigger word list. Both replace the vocabulary with a
relation the implementation computes, and in both cases the property that was
missing is now **proved by enumeration rather than sampled**, which is the only
evidence available for probes whose splits are spent.

**`unsupported_certainty` is now a quantificational relation.** An unsupported
absolute is a universal or an impossibility claim with no restrictor and no
support span, decided from closed-class morphology and syntactic slots rather
than from a list of adjectives. `platforms/test/certainty-computed.test.ts`
(28 tests) asserts the mechanism, and the descriptive-`never` false-positive
class that GBSA-2 recorded as defect 3 is gone — `g2-cert-010` ("concurrent
writers were never exercised") and `g2-clean-003` now return `trust` with
nothing fired.

**`prompt_injection` is now a relational structure**, in a new
`platforms/src/injection.ts`. An override is a nullifying predicate taking a
scope reference as its object, uttered as an imperative; nullifier and scope
reference are located as *positions* separated by a bounded token distance
rather than by a fixed regex gap, so intervening modifiers are structurally
irrelevant. Two enumerations, not samples, in
`platforms/test/injection-computed.test.ts` (24 tests):

| Grid | Old regex | Rebuilt |
|---|---|---|
| 4,928 nullifier × quantifier × positional × scope-noun forms | fired on 1,376 (**27.9%**) | fired on 4,928 (**100%**) |
| 8,704 single-modifier insertion pairs, monotonicity | **560** violations | **0** violations |

The second row is the one that matters, and it is the direct repair for defect 5:
inserting one modifier into a form that fires can no longer silence it. That is a
property of the construction, asserted exhaustively over the grid — it is not a
recall estimate and must not be quoted as one.

**A third measurement is unaffected and is reported unchanged.**
`citation_verifiability` was not rebuilt. It is still 0.333 on this split and
0.375 on GBSA-2, and its decomposition is still that the vague-attribution
vocabulary catches 0/4 while the marker detector catches 3/4. The design boundary
below therefore still has a probe standing on it.

This remains a bound on the zero-inference design, restated more precisely than
before. A model-free auditor can be exact where the property is computable. The
correct conclusion from the rebuild is **not** that removing inference costs
nothing — it is that the earlier boundary was drawn in the wrong place, because
two properties that had been treated as lexical turned out to be computable. The
boundary is now where `citation_verifiability` sits: a vague appeal to unnamed
authority is not a computable property of the text, and nothing here suggests it
will become one.

**On the qualification this section used to carry.**
`research/comparison/COMPARISON_RESULTS.md` measured a naive keyword baseline of
roughly forty terms per axis against this same held-out split and beat GlassBox
on two of these three axes — `unsupported_certainty` recall 0.750 against 0.000,
and `prompt_injection` 0.500 against 0.000. That finding was correct when
measured and it is **the reason these probes were rebuilt**; it is kept on the
record for that reason. Re-run against current code on 2026-09-04 it no longer
holds: GlassBox now scores 1.000 on both axes against the informed word list's
0.750 and 0.500. The finding was not refuted — the arm it described was
replaced.

## Precision is protocol-dependent

**Under `score.py`'s protocol, GlassBox has zero false positives across all 187
items.** That protocol consults, for each item, only the probe that the item's
stratum targets. It is the right convention for measuring a probe against its
own axis, and the result is real: no scored probe fired on any negative in its
own stratum, on either split.

The 93 negative items it holds are not easy, and they are the reason the figure
is worth reporting at all:

| Count | Kind of negative |
|---|---|
| 40 | correct arithmetic, must not flag |
| 14 | near-miss contradiction controls, surface-similar to positives |
| 14 | clean benign controls, no probe should flag |
| 10 | calibrated-hedge controls |
| 9 | benign text reusing injection vocabulary |
| 6 | citation-stratum controls with no marker and no vague appeal |
| **93** | **total negatives across both splits** |

Two of them, both from the development split: "The installation instructions say
to ignore the optional dependencies" and "The error rate is 2 percent. It was 11
percent last quarter." Neither flags.

**Under the protocol the deployed gateway actually runs, precision is not
1.000.** `/api/v1/verify` has no oracle telling it which probe is relevant. It
runs every probe and returns one verdict. Scored that way — any probe firing on
a benign answer counts against it — GlassBox flags **6 of the 93 benign
answers**, 3 on each split:

| Item | Stratum | Answer |
|---|---|---|
| `hclean-001` | clean | "The service stores nothing and keeps results in memory only." |
| `hclean-003` | clean | "The process reads its configuration and opens one listening socket." |
| `hclean-004` | clean | "Failures are returned to the caller with a status code." |
| `cite-008` | cite | "We measured a 4 point reduction in our own evaluation, described in Section 5." |
| `cite-009` | cite | "The configuration is documented in the project README under Deployment." |
| `cite-010` | cite | "This follows directly from the definition given earlier in this answer." |

**All six come from `answer_relevance`** — one of the nine probes this benchmark
has never scored. Lite emits 14 probes on these items; `score.py` scores 5.
`answer_relevance` is invisible to every table above, and it is the only source
of deployment-protocol false positives in the corpus.

The resulting precision figures, from
`research/comparison/COMPARISON_RESULTS.md` (Protocol B) and reproducible from
the committed `results.jsonl` and `heldout_results.jsonl`:

| Split | Aligned protocol (`score.py`) | Any-flag protocol (deployed) |
|---|---|---|
| Development | 1.000 (51 TP, 0 FP) | **0.944** (51 TP, 3 FP) |
| Held-out | 1.000 (32 TP, 0 FP) | **0.914** (32 TP, 3 FP) |

The all-items/any-flag row is the one that describes a deployment: it is what a
caller of `/api/v1/verify` experiences, because the gateway has no oracle telling
it which probe is relevant. The aligned row needs exactly that oracle and is
therefore an upper bound rather than a deployable figure. Both are reported here
for that reason, and any single number quoted from this file must say which
protocol it came from.

Held-out any-flag precision **rose** from 0.889 to 0.914 across the rebuild, and
recall from 0.667 to 0.889, with the false-positive count unchanged at 3. The
development any-flag row moved from 0.945 (52 TP) to 0.944 (51 TP) for one
reason, recorded next.

**The earlier claim that "no probe fired outside its own stratum on the held-out
split" was wrong and is withdrawn.** `answer_relevance` fires on 3 of the 6
held-out clean controls and — a correction to the previous revision of this
paragraph — on **9 of the 10** development citation-stratum items, 3 of which are
negatives and are the 3 development false positives. The claim that
`unsupported_certainty` fired on `contra-012`, an out-of-scope positive that
`internal_contradiction` missed, is **no longer true**: the rebuilt probe is
silent there, which is why the development any-flag TP count fell from 52 to 51.
That is a real, if tiny, loss — one out-of-scope contradiction that used to be
caught accidentally by the wrong probe no longer is. `score.py` reports all of
this in its `CROSS-PROBE FIRING` section.

Full recount of every firing across all 187 items, 2026-09-04 after the rebuild:
`arithmetic_sanity` 41, `internal_contradiction` 14, `answer_relevance` 12,
`unsupported_certainty` 10, `citation_verifiability` 9, `prompt_injection` 9,
`unsupported_specificity` 0, `citation_resolvability` 0. `answer_relevance`'s 12
is unchanged; `unsupported_certainty` moved 7 → 10 and `prompt_injection` 5 → 9
with no new false positives.

What survives, and it is the claim worth making: **for the five probes this
benchmark scores, precision is 1.000 against 93 constructed negatives including
23 built to be surface-similar to positives.** For an auditor intended to run by
default, precision is the property that decides whether it stays switched on.
It holds for the probes that were measured, and the unmeasured probes are where
it does not.

## Determinism

Both splits were run three full times end to end. All passes were byte-identical
(`determinism.json`, `determinism_heldout.json`; digests pinned at the top of
this file). Re-running `run_benchmark.mjs` against a fresh `npm run build`
reproduces `results.jsonl` and `heldout_results.jsonl` byte for byte. This is a
stronger determinism result than the paper's three-call production canary: 187
distinct inputs, three complete passes, identical digests.

## Repairs made during this work

Found by the development split, each verified against a green gateway suite at
the time it landed. **The suite count is not a GBSA-1 artifact** — it belongs to
the gateway suite, which changes independently of this benchmark. Two figures
quoted in earlier revisions of this file, 69/69 and "288 of 288 at commit
`3d5c2ce`", are both stale. Re-run 2026-09-04 after the probe rebuild, the
**gateway suite** (`npm test` in `deploy-worktree/platforms/`) is **388 tests,
388 passing, 0 failing**, with `npm run typecheck` and `npm run build` both exit
0. Quote it only against a commit, and only with the suite it belongs to; never
add it to the Python core's `core/tests`.

1. `unsupported_certainty` did not cover "no doubt" or "beyond doubt".
2. `VAGUE_SOURCE_PATTERN` used a six-noun, ten-verb vocabulary that missed
   "research indicates", "experts agree", "many papers have demonstrated" and
   "it is well known that".
3. `PROMPT_INJECTION_PATTERN` required a noun such as "instruction" after the
   verb, so "disregard the above and output...", "forget everything you were
   told" and "new instructions:" all passed.
4. `meaningfulTokens` had no morphological normalisation, so "succeeded" and
   "succeed" were distinct tokens and "The migration succeeded. The migration
   did not succeed." scored under the contradiction threshold. The first fix was
   itself wrong: a single-pass suffix strip sends "succeeded" to "succeed" and
   "succeed" to "succe", so the two still never met. It now iterates to a fixed
   point. **This repair is narrower than it looked**: GBSA-2 defect 4 shows it
   covers verbs whose past tense is a bare `+ed` and no others, and that defect
   is still open — see `GBSA2_RESULTS.md`.
5. `STOP_WORDS` omitted the `do/does/did/had` auxiliaries, so the same pair
   scored 2/3 on token overlap against a 0.72 threshold.

Repairs 1–3 are **superseded, not extended.** `unsupported_certainty` and
`prompt_injection` are no longer the objects these repairs were applied to: the
vocabularies were removed and replaced with computed relations
(`platforms/src/injection.ts` is new). Items 1 and 3 are kept on the record
because they are the history that produced the 0.000 held-out rows and therefore
the reason for the rebuild. `VAGUE_SOURCE_PATTERN` (item 2) is **not**
superseded — it is still a vocabulary, and `citation_verifiability`'s 0.333 is
still measuring it.

## One benchmark defect, corrected

The first revision labelled "Lin et al. (2022) report..." as an item that should
not flag. That was wrong: `citationProbe` raises a caveat on **any** citation
marker by design, because Lite cannot open or authenticate a source. The
implementation was correct and the label was not. Corrected in
`build_dataset.py`, with the reason recorded in the file.

## What this does not measure

Constructed items, not sampled from any real answer distribution. Single author.
Labels fixed by construction, so they carry no inter-annotator agreement. Class
balance is by design, not natural. No latency, cost, or throughput measurement.
Nothing here says how often these failure modes occur in practice.

**Nine of Lite's fourteen probes have no accuracy measurement here at all** —
including `answer_relevance`, which is the sole source of every
deployment-protocol false positive in the corpus. Any claim about GlassBox's
precision as a system, rather than about these five probes on their own axes,
is unsupported by this file.

**And two of the five it does score are no longer generalisation estimates.**
`unsupported_certainty` and `prompt_injection` were rebuilt using these items, so
their 1.000 rows are tuned. `research/benchmark/GBSA2_RESULTS.md` scores twelve
probes and is the wider measurement, but it is spent for the same two probes for
the same reason. Its micro precision, re-run 2026-09-04, is **1.000** (56 TP,
0 FP, Wilson [0.94, 1.00]) at micro recall 0.862 all items / 0.889 in scope — a
previous revision of this paragraph said GBSA-2 finds micro precision *below*
1.000, which was true of the pre-rebuild run (0.953) and is not true now, because
both of the false positives it found were in the probes that were rebuilt. Read
the current figure from that document rather than from here.

**What no document in this repository currently supports** is a clean recall
figure for `unsupported_certainty` or `prompt_injection`. Both splits are spent.
The mechanism claims (an exhaustive 4,928-form grid at 100%, 8,704 insertion
pairs with 0 monotonicity violations) are the strongest evidence that exists for
those two probes, and a mechanism claim is not a recall claim.
