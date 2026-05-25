# Changelog

All notable changes to Glassbox are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

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
