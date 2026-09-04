# Changelog

All notable changes to Glassbox are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

Everything below is measured. Each figure names the suite or split it comes from.

### Probes rebuilt from vocabularies into computed relations

The GBSA-1 held-out split had shown two probes at **0.000 recall** — a
roughly forty-term word list outscored both. The diagnosis was not lexicon
size: coverage was *non-monotonic*, so adding terms could leave an input
uncovered. `"Ignore all previous instructions"` fired while
`"Ignore every earlier instruction"` did not.

- **`unsupported_certainty`** is now a tripartite quantificational relation —
  it fires iff asserted scope is UNIVERSAL and evidenced scope is NONE, with
  no floats and no thresholds. Held-out recall **0.000 → 1.000** at precision
  1.000, beating the informed lexicon's 0.750. GBSA-2 **0.000/0.000 → 1.000/0.833**.
- **Injection detection** moved to `src/injection.ts` as seven structural
  disjuncts with free slots and a bounded token window, so intervening
  modifiers cannot defeat a match. Held-out `prompt_injection` **0.000 → 1.000**;
  GBSA-2 `prompt_injection` **0.000 → 1.000**, `tool_description_injection`
  **0.000 → 1.000**. An insertion grid went from 27.9% of 4,928 forms firing to
  **100%**, with monotonicity violations **560 → 0**, now guarded by a property
  test over 8,704 pairs.

### Citation soundness proved rather than asserted

18,000 generated valid identifiers across nine schemes produced **zero** false
positives, with check characters computed by a second, independently
transcribed implementation of each standard. 307,148 single-character
perturbations were detected at **100.000%**. Transposition rates are predicted
from each scheme's own check equation and asserted against measurement.

Two defects that had falsified the claim are fixed: the extractor ran past an
identifier into a following digit run, so a valid ISBN-10 in a bibliography
line was *rejected*; and `checksum_verified` was set on length alone, so
failures were reported as check-digit failures with no check digit computed.

Coverage widened to ISNI, LEI, GTIN-8/12/13/14 and the discontinued federal
reporters. GBSA-2 `citation_resolvability` recall **0.769 → 0.923**.

### Tool-invocation assurance hardened

Scalars are type-tagged in the declaration digest, so a rug pull that only
retypes a schema value (`1.5` versus `"1.5"`) no longer hashes identically.
Pins carry a version; an unversioned pin is refused as unreadable rather than
misread as drift. An internally inconsistent pin is its own **critical**
finding, closing both a critical-to-high downgrade and a clean-pass path.

### Fixed

- **A chat transcript was rejected 98.25% of the time.** Role-marker branches
  matched ordinary `[Human]:` / `[Assistant]:` transcript syntax. On another
  corpus the same branches produced five detections, **all false positives**.
  Withdrawn; a transcript now returns `trust`.
- `rm -rf /` was not detected while `rm -rf /home` was — a word boundary after
  an alternation ending in `/` only holds when a word character follows, so the
  most destructive form was the one that escaped.
- Wildcard target rules failed open. A deny wildcard now covers the apex; an
  allow wildcard does not.
- Seven probes were invisible in the public MCP projection, so callers received
  `reject` with no stated reason.

### Measurement

- GBSA-1 held-out, in-scope micro: **1.000 / 0.889 / 0.941** (was 1.000/0.667/0.800).
- GBSA-1 development, in-scope micro: 1.000 / 1.000 / 1.000, 0 of 8 clean controls firing.
- GBSA-2 micro: **1.000 / 0.862 / 0.926** (was 0.953/0.631/0.759), zero false
  positives across all twelve scored probes.
- Gateway suite: **388 passing**. This is the TypeScript gateway only and must
  not be combined with the Python core's count.

### Still true, and stated because it is easy to lose

- **GlassBox does not detect semantic hallucination.** Across four public
  datasets and 14,580 verifications, discrimination is 0.49–0.57 AUROC. A
  length-only baseline scores 0.974 on HaluEval QA, so any published number on
  that corpus without a length control is uninterpretable.
- The ECS resolution defect is root-caused by enumerating all 2^13 corners of
  its binary dimensions: **171** achievable values, not 8192. A prototype
  raising TruthfulQA from 6 distinct values to 134 and AUROC 0.491 to 0.551
  exists in `src/scoring.ts` and is **wired to nothing**. 0.55 is still 0.55.
- `citation_verifiability` recall remains ~0.33–0.375, and a fabricated
  citation carrying no identifier still returns `trust`.
- `answer_relevance` fires on 3 of 6 held-out and 4 of 12 GBSA-2 clean controls.
- `src/trajectory.ts` and `src/attribution.ts` are tested and reachable from no
  endpoint.

## [0.3.0] — 2026-04-25

First public release. Engineering substrate of the Glass Box Framework.

### Core engine
- Deterministic local pipeline: spaCy → embeddings → batched DeBERTa NLI → DAG
- 13-stage streaming engine (`StreamingGlassboxEngine`) with per-stage timing
- Trace hash: SHA-256 over canonical JSON, excludes runtime-only fields
- Schema versioning: `schema_version: "1.0.0"`, migrator for legacy traces
- Plugin registry: `ClaimExtractorPlugin`, `AssumptionDetectorPlugin`, `PostProcessorPlugin`
- Convenience API: `glassbox.analyze(prompt, response)`, `glassbox.stream(...)`
- Trace store: file-based (default) and SQLite-backed (queryable)
- Configurable presets: `medical`, `legal`, `education`, `research`, `general`

### Phase 4 — epistemic detectors
- **Hallucination Proximity Score (HPS)** — 5-component structural score with calibrated bands
- **Epistemic Boundary Detector (EBD)** — hedge density + drift + low-ECS aggregation
- **Reasoning Alignment Score (RAS)** — TF-IDF prompt intent vs DAG conclusion core
- **Causal Auditor** — STRONG/WEAK/REVERSE causal pattern detection + base-rate / selection bias

### Phase 4 — algorithmic validators
- **Complexity Claim Validator** — Big-O regex + predecessor evidence + cross-claim contradictions
- **Proof Analyzer** — AXIOM/LEMMA/THEOREM/COROLLARY classification + DAG traceability
- **Numerical Contradiction Detector** — magnitude (95% accuracy + 10% error), ordering, definition contradictions

### Phase 4 — cyber security
- **Input Sanitizer** — null bytes, NFC, HTML, oversize, long sentences, repeat patterns; never raises
- **Prompt Injection Detector** — 5 signatures (instruction-as-claim, self-referential, topic discontinuity, constraint override, meta-instruction)
- **Social Engineering Detector** — false urgency, scarcity, authority manufacturing, reciprocity, fear amplification
- **Witness Signing** — ed25519 signatures over canonical JSON; persistent key in `~/.glassbox/keys/`
- **Server API key auth** — env `GLASSBOX_API_KEY`, header `X-Glassbox-Key`

### REST server
- FastAPI app: `/analyze`, `/stream` (SSE), `/diff`, `/doubt`, `/witness`, `/render`, `/validate`, `/schema`, `/presets`
- Session endpoints: `/sessions`, `/sessions/stats`, `/sessions/search`, `/sessions/{id}`
- In-memory per-IP rate limiting
- CORS for `chrome-extension://*` and `localhost`/`127.0.0.1`
- Kubernetes-compatible `/health` + `/ready` probes

### Browser extension
- Chrome MV3 + WXT + React + TypeScript + Tailwind
- ARIA-first capture chain with 4 ChatGPT strategies + 3 Claude strategies
- `StreamEndDetector` with 800ms silence detection
- `chrome.storage.local.capture_stats` strategy success counters
- 13 unit tests passing (vitest + happy-dom)

### Web dashboard
- Next.js 14 App Router, Aura design language
- 7 pages: Sessions, Trace Room, Doubt, Compare, Fingerprint, Population, Analyze
- React Flow graphs with epistemic-tag-aware styling

### Research infrastructure
- Ablation runner across 9 module-disabling configurations
- ECS weight calibration via grid search + bootstrap CIs
- 6 publication-quality SVG figure generators
- Reproducibility checker (5-run determinism validation)

### HPS empirical validation (n=60)
- AUROC: **0.7344**, p < 0.001, effect size r = 0.469 (medium)
- Predictor orientation: low HPS → hallucination-adjacent (data-driven inversion)
- Full report: `core/research/validation/hps_validation_report.md`

### Performance benchmarks
- 10 cases × 20 runs × CPU-only
- All cases meet <300ms P95 target
- Overall P95: ~283ms; median of medians: ~237ms
- NLI batched into single forward pass per analyze() call
- Bottleneck: SENTENCES_SPLIT (~32ms); all other stages near zero

### Tests
- **157 passing** (1 skipped — cryptography optional dep)
- ruff + mypy strict pass

### Known limitations
- Glassbox is an **observer**, not a governor. No automatic intervention layer yet — see [ROADMAP](ROADMAP.md).
- HPS direction is **inverted from naive expectation** — see HPS section in README.
- Long responses (>300 words) show ECS degradation due to flat reasoning graphs — Phase 5 hierarchical segmentation will address this.
- ECS ceiling appears to be ~0.6 in practice; theoretical max is 1.0.

[0.3.0]: https://github.com/TheBarmaEffect/glassbox/releases/tag/v0.3.0
