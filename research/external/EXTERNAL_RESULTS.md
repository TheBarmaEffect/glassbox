# External benchmark results

Run 2026-09-04 against GlassBox Lite (`platforms/dist/src/lite.js`), in process, no API
key, no model inference, no network at scoring time. Four externally-authored datasets,
14 580 verifications, none of the data written by this project. Every number is
regenerable with the commands at the bottom of this file.

This is the experiment GBSA-1 could not do. GBSA-1 measures whether the probes fire on
items constructed to contain the property each probe looks for, and its authorship is its
own limitation. What follows measures something different and less flattering: whether the
score the gateway already emits separates answers that *other people* labelled
hallucinated from answers those same people labelled correct.

## Headline

**It does not. On the cleanest available contrast — 790 TruthfulQA question pairs — ECS
AUROC is 0.4922, 95% CI [0.482, 0.501], and 92.9 % of paired comparisons are exact ties.
On 5 000 human-labelled ChatGPT answers the AUROC is 0.5170 [0.502, 0.532]: nominally
above chance, practically indistinguishable from it. GlassBox Lite is not a hallucination
detector and this measurement says so directly.**

One thing does survive. On the same 5 000 real answers, three probes fire roughly twice as
often on hallucinated text as on correct text, and for two of them the effect holds inside
every answer-length quartile. `unsupported_specificity` alone raises the probability that
a flagged answer is hallucinated from the 0.195 base rate to 0.398, 95% CI [0.339, 0.461] —
a 2.0x precision lift at 9.8 % recall. That is a triage signal, not a detector, and it is
the only positive result in this file.

## The four datasets

Nothing here was authored, filtered by content, or relabelled by this project. Sources are
pinned to immutable commits and checksummed on load; sampling is seeded at **20260904**.

| Dataset | Source (pinned) | Items | Questions | Prevalence | Paired |
|---|---|---:|---:|---:|---|
| HaluEval QA | `RUCAIBox/HaluEval@207f479c` `data/qa_data.json` | 4 000 | 2 000 | 0.500 | yes |
| HaluEval Dialogue | `RUCAIBox/HaluEval@207f479c` `data/dialogue_data.json` | 4 000 | 2 000 | 0.500 | yes |
| HaluEval General | `RUCAIBox/HaluEval@207f479c` `data/general_data.json` | 5 000 | 5 000 | 0.195 | no |
| TruthfulQA | `sylinrl/TruthfulQA@f6be04e5` `TruthfulQA.csv` | 1 580 | 790 | 0.500 | yes |

HaluEval QA and Dialogue are sampled to 2 000 questions each from 10 000, seeded. General
(5 000) and TruthfulQA (790) are taken whole. Raw SHA-256 of every source file is recorded
in `data/MANIFEST.json`. Nothing was dropped: no item in any source exceeds the gateway's
6 000-character question or 12 000-character answer bound, and none is empty.

**HaluEval's `knowledge` field is deliberately withheld from the verifier.** Supplying the
gold passage would turn a structural audit into a grounding check the gateway does not
implement, and would measure a system that does not exist.

## The result

`ecs_risk` is `1 − ecs.total`, the complement of the scalar the deployed gateway already
returns, so AUROC reads as "probability the hallucinated answer ranks riskier". Intervals
are 2 000-resample cluster bootstraps over the **question**, not the item, because the two
answers to one question are not independent draws.

| Dataset | ECS-risk AUROC | 95% CI | AUPRC | base rate | cross-class tie rate |
|---|---:|---|---:|---:|---:|
| HaluEval QA | 0.4882 | [0.478, 0.499] | 0.488 | 0.500 | 0.649 |
| HaluEval Dialogue | 0.5050 | [0.497, 0.514] | 0.496 | 0.500 | 0.625 |
| **HaluEval General** | **0.5170** | **[0.502, 0.532]** | 0.205 | 0.195 | 0.571 |
| **TruthfulQA** | **0.4922** | **[0.482, 0.501]** | 0.496 | 0.500 | 0.846 |

The verdict and the failed-probe count carry no more information than the ECS does:
`verdict_ordinal` and `failed_probe_count` land within 0.007 of `ecs_risk` on every
dataset. There is no better scalar hiding behind the headline one.

### Paired, which is the strongest framing available

For the three paired datasets, each hallucinated answer can be compared against the
correct answer *to its own question*, which removes topic, domain and difficulty as
confounds entirely.

| Dataset | Hallucinated riskier | Correct riskier | Tied | Win rate among decided | 95% CI | Exact p |
|---|---:|---:|---:|---:|---|---:|
| HaluEval QA | 213 | 261 | 1 526 (76.3 %) | 0.449 | [0.405, 0.494] | 0.031 |
| HaluEval Dialogue | 171 | 145 | 1 684 (84.2 %) | 0.541 | [0.486, 0.595] | 0.160 |
| TruthfulQA | 22 | 34 | 734 (92.9 %) | 0.393 | [0.276, 0.524] | 0.141 |

Read the tie column first. **On TruthfulQA the gateway assigns the correct and the
hallucinated answer to the same question an identical score 93 % of the time.** Of the 56
pairs it does separate, it puts the *correct* answer at higher risk 34 times. On HaluEval
QA the direction is also wrong and is nominally significant (p = 0.031) — which, given
that this is one of several comparisons and the effect is 5 points from chance, is best
read as "no signal" rather than as evidence of inversion.

### The ties are the real finding

The ECS is a sum of thirteen dimensions, each of which takes one of exactly two values
depending on whether its probe passed. It is therefore a coarse score by construction: it
took 6 distinct values across 1 580 TruthfulQA items, 11 across HaluEval QA, 29 across the
5 000 General answers, with 76–92 % of items in each corpus sitting on the single modal
value. A score that is constant across most of its input cannot rank it. **No threshold
choice can rescue this; the ceiling is set by the granularity, not by the cut point.**

## The length control, which is why the one big number is not reported as a win

HaluEval QA looks, on a careless read, like it should be easy. It is not, and the reason
is worth stating plainly: **its two classes differ in form, not only in truth.** The
correct answer is a HotpotQA gold span averaging 13.5 characters ("Delhi"); the
hallucinated answer is a generated sentence averaging 67.7 ("The Oberoi family's hotel
company is based in Mumbai."). In the 2 000 pairs sampled here, 97.2 % of hallucinated answers are longer
than their counterpart and 94.4 % are full sentences, against 0.8 % of correct answers.

A detector that only counted characters would score **AUROC 0.9737 [0.969, 0.979]** on
this split. Any number near that ceiling on HaluEval QA is measuring answer format.
GlassBox scores 0.4882, so it is plainly not exploiting the artefact — but for the same
reason, a strong HaluEval QA result from any system should be treated as unreported until
its length baseline is shown.

| Dataset | GlassBox ECS-risk AUROC | Length-only AUROC |
|---|---:|---:|
| HaluEval QA | 0.4882 | **0.9737** |
| HaluEval Dialogue | 0.5050 | **0.7155** |
| HaluEval General | 0.5170 | 0.4673 |
| TruthfulQA | 0.4922 | 0.4229 |

Only General and TruthfulQA are length-neutral, and those are the two splits whose numbers
should carry weight. Both sit on chance.

## Per-probe breakdown on HaluEval General

This is the only split made of real model output carrying a human judgement rather than a
constructed contrast, and the only one whose classes come from the same generator. It is
where a per-probe result means something. Rates are fire rates; `solo AUROC` is that
single binary probe used alone; `precision` is the chance a flagged answer is hallucinated,
against a base rate of 0.195.

| Probe | Fires on hallucinated | Fires on correct | Lift | Solo AUROC | Precision |
|---|---:|---:|---:|---:|---:|
| `unsupported_specificity` | 0.0983 [.081, .119] | 0.0360 [.031, .042] | **2.73x** | 0.5311 | **0.398** |
| `citation_verifiability` | 0.0389 [.029, .053] | 0.0186 [.015, .023] | **2.09x** | 0.5101 | 0.336 |
| `internal_contradiction` | 0.0256 [.017, .038] | 0.0127 [.010, .017] | **2.02x** | 0.5065 | 0.329 |
| `claim_extraction` | 0.0307 | 0.0206 | 1.49x | 0.5050 | 0.266 |
| `fact_check_scope` | 0.0082 | 0.0030 | 2.73x | 0.5026 | 0.400 |
| `arithmetic_sanity` | 0.0041 | 0.0027 | 1.52x | 0.5007 | 0.267 |
| `dangerous_action` | 0.0031 | 0.0020 | 1.55x | 0.5005 | 0.273 |
| `unsupported_certainty` | 0.0542 | 0.0649 | 0.84x | 0.4947 | 0.169 |
| `answer_relevance` | 0.0665 | 0.0984 | **0.68x** | 0.4840 | 0.141 |
| `citation_resolvability`, `credential_exposure`, `input_injection`, `network_boundary` | 0.0000 | 0.0000 | — | 0.5000 | — |
| `prompt_injection` | 0.0000 | 0.0015 | 0.00x | 0.4993 | 0.000 |

Three things sit in that table.

**The first three probes carry real signal.** Their Wilson intervals do not overlap between
classes, and for the first two the lift survives a length control:
`unsupported_specificity` runs at 2.55x, 2.27x, 2.77x and 3.72x inside the four
answer-length quartiles, `citation_verifiability` at 1.90x, 3.33x, 1.89x and 1.85x. This is
not the length artefact wearing a different hat. Used on its own, "did
`unsupported_specificity` fire" turns a 19.5 % prior into a 39.8 % posterior at 9.8 %
recall. Small, real, and the kind of thing a triage queue can use.

`internal_contradiction` is the weaker of the three and should be quoted with its caveat.
Its class intervals separate by 0.0008 — [.017, .038] against [.010, .017] — and under the
length control it runs 0.51x, 2.07x, 1.62x, 3.56x, so it is *inverted* on the shortest
quartile and carried by the longest. That is the shape you would expect from a pairwise
contradiction check, which needs two comparable sentences before it can find anything, but
on this evidence the probe discriminates on long answers and not on short ones.

**The whole is worse than its best part.** ECS pools all thirteen dimensions, so the two
anti-correlated probes — `answer_relevance` at 0.68x and `unsupported_certainty` at 0.84x —
are added to the same total as the three that discriminate, and the aggregate collapses to
0.5170 while its best single component reaches 0.5311. The weights were never fitted
against a hallucination label and this file does not fit them, but the arithmetic is
plain: **a uniform pooling of probes that point in opposite directions destroys the signal
its components carry.**

**`answer_relevance` points the wrong way on every dataset** (solo AUROC 0.4840 on
General, 0.4840 on Dialogue, 0.4632 on QA, 0.4930 on TruthfulQA). It is a lexical-overlap
check, and a correct answer that restates the question's vocabulary is not more truthful
for doing so. As a component of a trust score it is currently subtracting.

## A false-positive rate GBSA-1 could not have found

On HaluEval Dialogue, **`input_injection` fires on 3 930 of 4 000 items — 98.25 % — and
drives verdict `reject` on all of them.** The cause is exact and was verified branch by
branch: the corpus formats its conversation history as `[Human]: … [Assistant]: …`, and
`PROMPT_INJECTION_PATTERN` contains the branch `\[(?:INST|SYSTEM|ASSISTANT)\]`, intended to
catch role markers injected as content. The correspondence is perfect — the probe fires on
exactly the 3 930 items containing `[Assistant]` and on none of the 70 that do not.

Because it fires identically on both members of every pair it costs nothing in
discrimination — it is why `verdict_ordinal` has a 96.6 % tie rate on that split and an
AUROC of exactly 0.5000. It costs everything in deployment. Any caller that passes a chat
transcript using bracketed speaker labels gets a critical-severity rejection on
essentially every request.

This is not a refutation of GBSA-1's zero-false-positive result; GBSA-1 contains no
dialogue transcripts, so this input shape is outside what it measured. It is a
demonstration of why the self-authored corpus was not enough. The probe may even be
defensible in principle — a bare role marker in caller-supplied text *is* ambiguous — but
98.25 % on an unmodified public corpus is a deployment problem under either reading.

**No change was made to `platforms/src/` for this work.** This file measures; it does not
fit, tune, or repair.

## Determinism and cost

Every dataset was run twice end to end under a fixed clock. All passes were byte-identical
(`results/*_determinism.json`). Throughput was 0.025–0.130 ms per item single-threaded:
one complete pass over all 14 580 items takes 1.03 s, and the two-pass determinism run
over all four datasets takes about two seconds at zero marginal cost. That is the property
that made running four datasets instead of one free.

## What this says GlassBox can and cannot do

**Cannot:** rank a hallucinated answer above a correct one. On two length-neutral external
corpora the ECS is at chance, and on the paired contrast it is tied 93 % of the time. This
is not a tuning failure and no threshold fixes it. It is what a zero-inference structural
auditor is: HaluEval's hallucinations are fluent, well-formed, internally consistent,
arithmetic-free and uncited, so every property GlassBox computes is *identical* between the
two classes. The system is behaving exactly as designed and as documented; the design
simply does not address this task.

**Can:** raise the posterior on a flagged answer by about 2x at low recall, via
`unsupported_specificity`, `citation_verifiability` and `internal_contradiction`, on real
model output. And, separately from anything measured here, it computes properties no
inference-based judge can compute exactly — which is what GBSA-1 measures and what this
file does not touch.

**The honest positioning claim this supports** is narrower than "hallucination detection"
and stronger for being narrower: GlassBox is a deterministic structural auditor whose
outputs are exact and free, which is worth having *alongside* a semantic checker and is
not a substitute for one. Any claim that the ECS predicts factual correctness is not
supported by external data and should be dropped.

## What this does not measure

Four corpora, three of them from one research group. HaluEval's hallucinated answers are
ChatGPT-generated and filtered by the dataset authors, so they are a sample of one model's
failure modes as one team chose to elicit them, not of hallucination in general.
TruthfulQA is adversarial by construction — its questions were selected because models get
them wrong — which makes it a hard case and not a representative one. The General split's
labels come from that project's annotation process, whose agreement statistics are theirs
to report and are not reproduced here. Nothing here measures latency under load, behaviour
on adversarial input, or the probes' precision on the properties they actually claim to
detect; GBSA-1 covers the last of those and this file does not duplicate it. No result
here should be read as a comparison against any other system, because no other system was
run.

## Relationship to the Python core's earlier cross-benchmark

`core/research/cross_benchmark/` ran the **Python** implementation (glassbox 0.3.0,
2026-04-25) over 800 pairs from TruthfulQA, GSM8K and MMLU and reached ECS AUROC 0.4966
combined, 0.4967 on TruthfulQA. The TypeScript gateway measured here reaches 0.4922 on the
same TruthfulQA contrast at roughly twice the sample size. **Two independent
implementations, sharing no code, land on chance on the same external data.** That
consistency is itself worth reporting: it means the earlier result was a property of the
approach and not a bug in one implementation.

## Reproducing

```bash
cd platforms && npm ci && npm run build      # compile Lite
cd ../research/external
python3 prepare.py                           # downloads, checksums, samples; seed 20260904
node run_external.mjs --all --repeat 2       # 14 580 verifications, ~4 s
python3 score_external.py --resamples 2000   # ~35 s
```

`prepare.py` is cached: after the first run it performs no network access, and it verifies
the SHA-256 of every source file on every load, so a stale or substituted cache fails loudly
instead of silently changing a number. Re-running regenerates `data/*.jsonl`
byte-identically. `results/REPORT.txt` is the printed report; `results/SUMMARY.json` holds
every figure quoted above, including the Wilson intervals and length-stratified tables that
were summarised here.
