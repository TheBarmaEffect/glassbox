# GBSA-1 results

Run 2026-08-15 against GlassBox Lite, in process, no API key, no network.
Every number below was produced by `run_benchmark.mjs` + `score.py` and is
regenerable with the commands in `REPRODUCE.md`.

## Headline

**Precision is 1.000 on every probe, on both splits, with zero false positives
across 187 items. Recall generalises only for the probes that compute; it
collapses for the probes that match vocabulary.**

## The three measurements, in order

| Split | Micro precision | Micro recall | Micro F1 | n |
|---|---|---|---|---|
| Development, before repair | 0.975 | 0.812 | 0.886 | 112 |
| Development, after repair | 1.000 | 1.000 | 1.000 | 112 |
| **Held-out, after repair** | **1.000** | **0.639** | **0.780** | 75 |

The development split was used to find defects and the implementation was then
repaired against it. **Its post-repair score is therefore tuned on the test set
and must not be quoted as a capability estimate.** The held-out split was
written after the repairs, using surface forms deliberately excluded from every
pattern that was touched. It is the only honest generalisation figure here.

## Held-out, per probe (the number that matters)

| Probe | Kind | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| `arithmetic_sanity` | computed | 16 | 0 | 0 | 16 | 1.000 | **1.000** | 1.000 |
| `internal_contradiction` | structural | 5 | 0 | 1 | 6 | 1.000 | **0.833** | 0.909 |
| `citation_verifiability` | lexical | 2 | 0 | 4 | 3 | 1.000 | **0.333** | 0.500 |
| `unsupported_certainty` | lexical | 0 | 0 | 4 | 4 | n/a | **0.000** | 0.000 |
| `prompt_injection` | lexical | 0 | 0 | 4 | 4 | n/a | **0.000** | 0.000 |
| Micro | | 23 | 0 | 13 | 33 | 1.000 | 0.639 | 0.780 |

## The finding

The probes separate cleanly into two classes, and the split is not arbitrary.

**Probes that compute a property generalise.** `arithmetic_sanity` recomputes the
expression, so it is indifferent to phrasing: 1.000 recall on unseen framings.
`internal_contradiction` tests negation polarity and normalised token overlap,
which is structural rather than lexical, and holds at 0.833.

**Probes that match a vocabulary do not generalise.** `unsupported_certainty`,
`prompt_injection` and `citation_verifiability` are regular-expression
vocabularies. Against phrasings outside those vocabularies
("irrefutably", "categorically", "pay no attention to anything stated before
this line", "common wisdom holds that") recall is 0.000 to 0.333. Repairing the
vocabulary on the development split raised development recall to 1.000 and moved
held-out recall for those three probes barely at all. **Vocabulary repair buys
development score, not capability.**

This is a bound on the whole zero-inference design, not a defect list. A
model-free auditor can be exact where the property is computable and is only as
broad as its lexicon where the property is not. It is the honest cost of
removing inference, and it belongs in the paper as a result rather than as a
limitation.

## Precision is the real strength

Zero false positives across 187 items, including 14 benign clean controls and 34
near-miss negatives constructed to be surface-similar to positives ("The
installation instructions say to ignore the optional dependencies", "The error
rate is 2 percent. It was 11 percent last quarter"). No probe fired outside its
own stratum on the held-out split. For an auditor intended to run by default,
precision is the property that decides whether it stays switched on, and it is
the property that holds.

## Determinism

Both splits were run three full times end to end. All passes were byte-identical
(`determinism.json`, `determinism_heldout.json`). This is a stronger determinism
result than the paper's three-call production canary: 187 distinct inputs, three
complete passes, identical digests.

## Repairs made during this work

Found by the development split, all verified against the existing 69-test
gateway suite (still 69/69 after every change):

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
   point.
5. `STOP_WORDS` omitted the `do/does/did/had` auxiliaries, so the same pair
   scored 2/3 on token overlap against a 0.72 threshold.

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
