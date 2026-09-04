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
9. **GBSA-1 scores five probes; the implementation emits fourteen.**
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
   run but are not true of the current one. Recount, 2026-09-04, over all 187 items in
   `benchmark/results.jsonl` and `benchmark/heldout_results.jsonl`: `arithmetic_sanity`
   fires 41 times, `internal_contradiction` 13, `answer_relevance` **12**,
   `citation_verifiability` 9, `unsupported_certainty` 7, `prompt_injection` 5,
   `unsupported_specificity` 2, `citation_resolvability` **0**.
10. **`citation_resolvability` has zero measured recall, and its zero-false-positive
    result is on a corpus with no positives in it.** The probe (`platforms/src/citation.ts`)
    computes ISBN-10, ISBN-13, ISSN and ORCID check digits and the arXiv digit-width/date
    coupling. It fires on **0 of 187** GBSA-1 items — but GBSA-1 contains **no
    fabricated-identifier stratum**, so that number bounds false positives and says nothing
    whatever about recall. Recall is additionally bounded above by identifier presence: a
    fabricated reference carrying no identifier, or one whose invented identifier happens
    to satisfy its check digit (1 in 11 for ISBN-10 by chance), cannot be detected. The
    finding must be worded *the identifier fails its own check digit*, never *the citation
    is fabricated*: a transposed digit and an OCR error produce the same failure, and
    arithmetic cannot separate mistranscription from invention. Two further scope notes:
    the probe is **deployed and live as of 2026-09-04** — the live
    `/api/v1/capabilities` lists 14 deterministic probes including it, verified
    2026-09-04 — but the Federal Reporter closed-volume constraint described in some
    design notes is **not implemented** and must not be cited.
11. **Tool-invocation assurance has no accuracy measurement of any kind.** The six
    tool-invocation probes (`platforms/src/toolcall.ts`) are deployed and their mechanism
    is verifiable, but nothing about their accuracy is measured. Declaration-drift
    detection is hash comparison, which gives TPR=1 and FPR=0 *by construction* — a fact
    about hashing, not a result about the world. The operationally meaningful quantity is
    the escalation burden the pin imposes, i.e. what fraction of real schema changes are
    benign version bumps, and that is **unmeasured**: no corpus of real MCP version
    histories has been assembled. Three hard limits: pinning cannot detect a behaviour
    change that leaves the published declaration unchanged; the **caller** supplies and
    stores the pin and the gateway retains none between requests; and the gateway records
    the caller's declaration rather than independently verifying it. The gateway
    **withholds authorization** — it does not execute, intercept or block a tool call.
12. **HPS's AUROC belongs to the Python core, is a pilot, and its orientation was chosen
    post hoc.** `core/research/validation/hps_validation_report.json` (2026-04-25) reports
    AUROC 0.7344, p=0.000906, on 60 constructed pairs. Four caveats must travel with it,
    and the first is the serious one. (a) The predictor orientation was **inverted after
    observing the data**; under the a-priori orientation the same sample gives AUROC
    0.2656, so the reported figure is the better of two orientations chosen on the only
    sample available. (b) The threshold HPS ≤ 0.6815 was selected **in-sample** by Youden's
    J on the same 60 pairs, so F1 0.7302 is an in-sample optimum, optimistic by an
    unmeasured amount. (c) n=60, single author, constructed labels, no independent
    annotators, no inter-rater agreement, no held-out split. (d) No calibration result
    exists. **"Empirically-validated" is refused.** Item 8's "no AUROC" statement is scoped
    to the **Lite gateway** and GBSA-1, which computes none; the two statements are
    consistent only when each names its component, and for a long period the root
    `README.md` asserted the AUROC without naming one.

## Evidence limitations

13. **Single-operator canaries.** The GitHub App E2E and the MCP canary were initiated
    by the developer. They demonstrate that the path works; they are not a user study
    and carry no statistical weight.
14. **No Discord or Telegram user transcript.** Both are publicly registered and
    authenticated, but no real-user result was preserved. These remain L3.
15. **JetBrains was not re-run locally.** Cited on CI evidence only. The four other
    platform suites and the gateway suite were re-run 2026-09-04: gateway 266/266, Notion
    12/12, browser extension 10/10, Reddit Devvit 9/9, VS Code 5/5.
16. **Test counts must name a suite, and one long-standing figure is not reproducible.**
    The repository asserted "157 tests passing" for the Python core in `README.md`,
    `CHANGELOG.md` and `CONTRIBUTING.md`. `core/tests` collects **182**; a 2026-09-04 re-run
    gives **180 passed, 1 failed, 1 skipped**, the failure being
    `test_verified_corpus_structural_expectations` (a committed fixture expects `PARTIAL`;
    the engine returns `COMPLETE`) — independently observed on 2026-08-16 in
    `tables/python-verification.md`. That run used a minimal dependency set (`pydantic`,
    `networkx`, `numpy`, `rich`), the heavy NLP dependencies being lazily imported, so it
    exercises the lazy path rather than a full-model run and is not a like-for-like
    substitute for the original figure. The honest statement is that 157 cannot be
    reproduced at this commit and that the suite has a known failure. Separately, the
    platform-layer figure of **108** was correct on 2026-08-11 and is now stale: the gateway
    suite grew from 69 to 266, so the re-run platform-layer total is **302** plus 3 on CI
    evidence. Never combine the Python core suite with the platform layer.
17. **Cross-language determinism starts from prebuilt parts.** It proves canonical
    assembly, serialization and hashing, not that model analysis is deterministic. It
    also belongs to the older six-tool MCP, not to Lite.
18. **The Reddit diagnosis is an inference.** The playtest failed at the gateway stage
    while the gateway was healthy and the Fetch-domain request was pending. The
    allowlist is the leading explanation, not a confirmed Reddit determination.
19. **Dependency audits report zero *known* vulnerabilities at the configured
    threshold.** This is not a penetration test, not SAST, not a certification. CI also
    emits Node 20 deprecation warnings and transitive package deprecations.

## Deployment and privacy limitations

20. **Traffic is processed by third parties.** Platform providers and Render receive
    and process network traffic. Claims of "zero data collection", "nothing leaves the
    device", "no third parties", or end-to-end encryption are false and are refused.
21. **Retention is bounded, not absent.** Raw content is not persisted to a database or
    files by the gateway, but content and results stay transiently in memory for up to
    five minutes while work and delivery complete; completed event ids are retained up
    to 24 hours for replay protection; rate-control identifiers up to 10 minutes.
22. **No latency guarantee, and no deployed latency measurement at all.** The Render free
    instance can sleep and cold-start. GBSA-1 runs in process and measures no latency, cost
    or throughput, so it adds nothing here. Evidence ledger C20 remains **L0, not
    executed**; live `/api/v1/metrics` latency percentiles read `null` on a freshly
    restarted instance, verified 2026-09-04.
23. **The published counters are not a durable record.** `/api/v1/metrics` counts events
    and never content, which is the property worth claiming. But the counters are
    **in-memory and reset when the instance restarts**, and the free-tier instance sleeps
    after idle, so no count survives. They are process-local aggregates for an operator to
    scrape, not an audit log — the payload says so about itself. At verification on
    2026-09-04 every counter read 0 (instance uptime 9 s), so **no traffic, usage or impact
    claim follows from the endpoint's existence**. Also note `probe_fire_rate` is
    fired/evaluated: how often a check flagged something, **not** how often the flag was
    correct. The gateway has no ground truth at runtime.
24. **Prevention is deployed; remediation is not, and escalation is only signalled.**
    `POST /api/v1/govern` is a real synchronous release gate — it withholds `block` with
    HTTP 422 and `retry`/`escalate` with HTTP 409 and reports `enforced_by_gateway: true`.
    That is prevention, and the documentation previously understated it as observation. The
    honest remainder: the gateway **cannot regenerate, rewrite or repair** an answer, so
    remediation does not exist; and `escalate` returns `next_step: "human_review"` into a
    void — there is no queue, no reviewer identity, no decision and no decision timestamp,
    so the correct phrasing is *escalation signalling is implemented; an escalation queue is
    not*. The gate also withholds **authorization** rather than intercepting: a caller that
    ignores a 422 and proceeds is not stopped by the gateway.
25. **The deployed instance can lag this repository.** Verified 2026-09-04: the live
    `/api/v1/capabilities` advertises 13 deterministic probes and omits
    `citation_resolvability`, which the local handler declares. The six tool-invocation
    probes are live. Any claim about a probe must be checked against the **live** endpoint
    before publication, not against source.
26. **Two tested modules are wired to nothing.** `platforms/src/trajectory.ts` (append-only
    tamper-evident chain, Merkle tree with RFC 6962 domain-separated hashing, inclusion
    proofs, signed tree head) and `platforms/src/attribution.ts` are covered by the 266-test
    suite and reachable from **no endpoint**; `POST /api/v1/trajectory/replay` and
    `GET /api/v1/trajectory/pubkey` do not exist. No append-only log, signed tree head or
    inclusion-proof endpoint is deployed. `attribution.ts` is held back deliberately, since
    GBSA-1's held-out split is spent for the citation and certainty probes.
27. **External approvals are outside the researcher's control.** GitHub Marketplace,
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
