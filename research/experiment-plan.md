# Experiment plan, partly executed

Accuracy results now exist. GBSA-1 (`benchmark/`) executed strata 1-4 and part of
stratum 5, and its results are in `benchmark/RESULTS.md`. Everything still marked OPEN
below is future work and must be labelled as such wherever it appears. The accuracy
sentence this plan was written to unlock may now be written, but only from the held-out
split, and only about the five probes GBSA-1 scores.

## Benchmark strata
1. Correct and incorrect allowlisted arithmetic. **DONE** — 52 dev / 32 held-out items.
2. Direct contradiction vs non-contradictory lexical controls. **DONE** — 20 dev / 12
   held-out, plus a 21-item `comparison` stratum added afterwards, outside this plan,
   after a false-positive class surfaced in real use that no planned stratum expressed.
3. Calibrated uncertainty vs unsupported certainty. **DONE** — 12 dev / 8 held-out.
4. Citation-present, citation-absent, unverifiable-source. **DONE** — all three kinds
   present, 10 dev / 9 held-out.
5. Prompt-injection and hostile-markup inputs. **PARTLY DONE** — injection phrasing and
   benign injection-vocabulary controls are covered, 10 dev / 8 held-out. **Hostile
   markup is not.**
6. Refusals and safe non-answers. **OPEN.**
7. Unicode, control-character and bidirectional-text attacks. **OPEN.**

Stratum 7 doubles as a privacy/neutralization regression set, and remains the more
valuable of the two open strata for that reason.

A stratum this plan did not anticipate also exists: 14 benign clean controls across the
two splits, used as the false-positive safety check.

## Protocol
Preregistered labels fixed before any run; blinded human annotation with at least two
independent annotators and a reported agreement statistic; held-out split; seeds and
input hashes recorded.

**What GBSA-1 actually did.** Labels were fixed before any run, both generators are
seeded and regenerate byte-identically, and a held-out split was written only after the
development split had been used for repair. **The annotation protocol was not followed.**
Labels are fixed by construction rather than by blinded human annotation, there are no
independent annotators, and there is therefore no agreement statistic. This is the
largest single gap between this plan and what was executed, and it must accompany any
number taken from the benchmark.

## Metrics
Per-probe precision, recall, F1 with bootstrap confidence intervals; false-positive and
false-negative analysis by stratum; ablation with each of the seven probes disabled;
baseline comparison against an output-level classifier and a length/heuristic control.
Report denominators everywhere.

**Delivered:** per-probe and micro precision, recall and F1 with explicit denominators,
reported over all items and over in-scope items separately, with false-positive and
false-negative counts by stratum, and a determinism check of three full passes per split.
**Not delivered:** intervals are Wilson rather than bootstrap; no ablation with probes
disabled; no baseline comparison against an output-level classifier or a length control.
**Scope:** five probes are scored. The implementation emits thirteen, so eight have no
accuracy measurement of any kind.

## Systems measurements
Warm and cold p50/p95 latency under Render free-tier cold starts; provider
acknowledgement success rate against Discord interaction-token expiry; throughput at
concurrency 1 against the 100/day ceiling; privacy-leakage regression across all strata.

## Three highest-value missing experiments
1. **Coverage for the eight unscored probes**, and strata 6 and 7. GBSA-1 answers RQ1
   for five probes; the rest of the verdict surface is unmeasured, and the clean controls
   already show an unmeasured false-positive class in `answer_relevance`. A natural rather
   than constructed sample would matter more than a wider constructed one: nothing built
   so far establishes how often any of these failure modes occurs in real answers.
2. **Captured Discord/Telegram user E2E.** One preserved real-user transcript each
   moves two surfaces from L3 to L4 and closes the paper's largest evidence gap.
3. **Cold-start latency and acknowledgement-deadline study.** Converts the Render
   free-tier tension from an anecdote into a measured deployment finding, and is the
   natural quantitative backbone for the negative-results section.
