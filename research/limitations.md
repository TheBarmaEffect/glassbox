# Limitations and threats to validity

## Method limitations

1. **Not a fact-check.** GlassBox Lite audits structure, not truth. It does not consult
   the web, authenticate sources, or establish that a claim is correct. An answer can
   be entirely false and pass every probe.
2. **ECS is a structural score, not a probability.** GBSA-1 scores probe firing against
   labels, not ECS against outcomes, so no calibration result exists and ECS must never
   be presented as a truth or confidence probability.
3. **Contradiction detection is lexical.** Direct contradictions and repeated-value
   conflicts only. It is not NLI-grade and will miss paraphrased or semantic conflicts.
4. **Arithmetic is allowlisted, not general.** Only supported expression forms are
   recomputed. Unsupported mathematics is silently out of scope, which is a
   false-negative source.
5. **Prompt-injection signalling is not a security boundary.** Injection-like language
   is analysed as inert content. Detection is a signal, not containment.
6. **Bounded inputs.** 6 000 characters for the question, 12 000 for the answer, at
   most 8 intents. Long-document auditing is out of scope.
7. **Accuracy is measured, and only the held-out split is a capability estimate.** A
   labelled per-probe benchmark now exists: GBSA-1 (`benchmark/`), a 112-item
   development split and a 75-item held-out split, with scoring code, three
   byte-identical passes per split, and results in `benchmark/RESULTS.md`. The held-out
   figures are micro precision 1.000, micro recall 0.639, F1 0.780, with zero false
   positives across all 187 items **for the five probes it scores**. Recall is not
   uniform, and the spread is the result rather than a defect list:
   `arithmetic_sanity` at 1.000 and `internal_contradiction`
   at 0.833 compute a property and generalise, while `citation_verifiability` at 0.333
   and `unsupported_certainty` and `prompt_injection` at 0.000 match a vocabulary and
   are only as broad as their lexicon. The development split was used to locate defects
   and the implementation was repaired against it, so its post-repair 1.000 / 1.000 /
   1.000 is tuned on the test set and **must never be quoted as a capability estimate.**
   Only the held-out figures may be.
8. **What GBSA-1 does not license.** Items are constructed, not sampled from any real
   answer distribution. Labels are fixed by construction, so there is no blinded
   annotation and no inter-annotator agreement statistic. Class balance is by design,
   not natural. Both splits are single-author. n is small: the held-out micro-recall
   Wilson 95% interval is [0.48, 0.78]. No AUROC, no calibration result, and no
   false-approval or false-rejection rate against real traffic has been computed. Above
   all, **nothing in the benchmark says how often these failure modes occur in
   practice**, so no prevalence, base-rate or deployment-impact claim follows from it.
   The benchmark's negative space is known to be incomplete: a false-positive class on
   comparison sentences ("Plan A allows 5 requests. Plan B allows 50 requests.") was
   found in real use in August 2026, and none of the original 187 items could express
   it. The 21-item `comparison` stratum was added afterwards and now passes 7/7
   positives with zero false positives, but that class was found by users, not by the
   benchmark.
9. **GBSA-1 scores five probes; the implementation emits thirteen.**
   `arithmetic_sanity`, `internal_contradiction`, `unsupported_certainty`,
   `citation_verifiability` and `prompt_injection` are measured. `claim_extraction`,
   `unsupported_specificity`, `answer_relevance`, `input_injection`,
   `credential_exposure`, `dangerous_action`, `network_boundary` and `fact_check_scope`
   have **no accuracy measurement of any kind**, and the headline precision figure says
   nothing about them. This is not hypothetical. On the 2026-09-03 re-run,
   `answer_relevance` fires on 3 of the 14 benign clean controls — terse but correct
   answers such as "The process reads its configuration and opens one listening socket."
   — and turns each into a `caution` verdict. Within-stratum precision for the five
   scored probes is still 1.000 with zero false positives, which is exactly why that
   number must not be read as a statement about the system: at the verdict level, which
   is what a user actually sees, there is a false-positive class and it is unmeasured.
   `benchmark/RESULTS.md` predates these probes, and its statements that no probe fired
   outside its own stratum and that no clean control was flagged were true of the August
   run but are not true of the current one.

## Evidence limitations

10. **Single-operator canaries.** The GitHub App E2E and the MCP canary were initiated
    by the developer. They demonstrate that the path works; they are not a user study
    and carry no statistical weight.
11. **No Discord or Telegram user transcript.** Both are publicly registered and
    authenticated, but no real-user result was preserved. These remain L3.
12. **JetBrains was not re-run locally.** Cited on CI evidence only.
13. **Cross-language determinism starts from prebuilt parts.** It proves canonical
    assembly, serialization and hashing, not that model analysis is deterministic. It
    also belongs to the older six-tool MCP, not to Lite.
14. **The Reddit diagnosis is an inference.** The playtest failed at the gateway stage
    while the gateway was healthy and the Fetch-domain request was pending. The
    allowlist is the leading explanation, not a confirmed Reddit determination.
15. **Dependency audits report zero *known* vulnerabilities at the configured
    threshold.** This is not a penetration test, not SAST, not a certification. CI also
    emits Node 20 deprecation warnings and transitive package deprecations.

## Deployment and privacy limitations

16. **Traffic is processed by third parties.** Platform providers and Render receive
    and process network traffic. Claims of "zero data collection", "nothing leaves the
    device", "no third parties", or end-to-end encryption are false and are refused.
17. **Retention is bounded, not absent.** Raw content is not persisted to a database or
    files by the gateway, but content and results stay transiently in memory for up to
    five minutes while work and delivery complete; completed event ids are retained up
    to 24 hours for replay protection; rate-control identifiers up to 10 minutes.
18. **No latency guarantee.** The Render free instance can sleep and cold-start. GBSA-1
    runs in process and measures no latency, cost or throughput, so it adds nothing here.
19. **External approvals are outside the researcher's control.** GitHub Marketplace,
    Reddit Devvit, Slack, and the ChatGPT and Claude directories all depend on
    third-party review with no committed timeline.

## Threats to validity

- **Construct validity.** "Trustworthiness" is not measured. What is measured is
  determinism, projection minimality, fail-closed behaviour, and, since GBSA-1, whether
  a probe fires on items constructed to be positive or negative for that probe. Agreement
  with a constructed label is not agreement with a human trust judgement, and the paper
  must not let the Trust Card framing imply a validated trust judgement.
- **Internal validity.** Canary inputs were chosen by the developer to exercise a known
  probe. They demonstrate reachability, not detector quality. GBSA-1 narrows this gap but
  does not close it: the same author wrote the probes, the items and the labels, and the
  development split was used to repair the implementation before the held-out split was
  written. The held-out split was written after those repairs, with surface forms
  deliberately excluded from every pattern that was touched, which is what makes it the
  only figure quotable as a capability estimate.
- **External validity.** One operator, one deployment, one free-tier host. Behaviour
  under concurrent multi-tenant load is untested; concurrency is pinned at 1 and the
  daily ceiling at 100.
- **Reproducibility validity.** Live canaries depend on a running instance that may
  drift from the pinned commit. The commit, release and CI run are the stable anchors;
  the live endpoint is not.
