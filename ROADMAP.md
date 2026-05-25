# Roadmap

## Where we are

Glassbox today is an **observer**.

It produces a deterministic, structured trace of how an AI response is assembled. It scores structural reliability, surfaces failure modes, detects contradictions, and signals hallucination proximity. It does this without external API calls and reproducibly to four decimal places.

What it does **not** do:

- Take action on what it finds
- Stop a model from emitting an unreliable response
- Rewrite, revise, or repair an unreliable response in place
- Compare itself head-to-head against alternative observability stacks
- Operate over hierarchical reasoning structures (long responses are flat-graph today)

This is intentional for v0.3.0. The observer layer must be solid before the governor layer is built on top.

## Strategic transition path

```
Phase 0–4 (DONE)            Phase 5 (NEXT)
─────────────────           ─────────────────
Observability       ──►     Decision
Scoring             ──►     Intervention
Diagnostic          ──►     Self-correction
Engineering         ──►     Governance
```

## Phase 5 — observer → governor

### 5A. Adaptive control loop

Today: signals are computed and surfaced. Nothing acts on them.

Plan:
- **ECS-triggered rewrite request.** If `avg_ecs < 0.40` AND `analysis_state == COMPLETE`, emit a `RewriteRecommendation` artifact specifying which claims need stronger evidence.
- **HPS-triggered caution layer.** If `HPS < 0.20` (low — overconfident territory) AND `causal_audit.unsupported_causal_count > 0`, emit a `CautionLayerRecommendation` with proposed hedge insertions per claim.
- **PARTIAL-triggered re-analysis.** If `analysis_state == PARTIAL`, attempt re-analysis with a more aggressive sentence splitter and/or relaxed support thresholds; produce a follow-up `RecoveryReport`.

Out of scope: actually calling an LLM to perform the rewrite. Glassbox produces the *recommendation artifact*; consumers (orchestrators, agents) execute it.

### 5B. Hierarchical reasoning segmentation

Today: every claim is a peer in one DAG. Long responses (>300 words) degrade because the graph flattens.

Plan:
- **Chunk-level graph builder.** Segment response into ~150-word chunks; build per-chunk reasoning DAG.
- **Cross-chunk consistency stitcher.** Detect topical bridges (shared entities, anaphoric references); add `BRIDGES` edges across chunk boundaries.
- **Hierarchy-aware ECS.** Per-chunk ECS + cross-chunk ECS; flag chunks that are individually coherent but inconsistent with each other.
- **Schema addition** (Optional, None default): `hierarchical_structure: HierarchicalReasoningReport | None`.

### 5C. Real-time intervention layer

Today: analysis is post-hoc — Glassbox runs after the response is complete.

Plan:
- **Streaming ingest.** Accept partial responses (token-by-token or chunk-by-chunk). Run a lightweight sub-pipeline at each boundary.
- **Interrupt protocol.** Emit `InterruptSignal` when streaming detects a high-confidence contradiction with prior chunks or a critical injection signature.
- **Inline correction surface.** Browser extension shows mid-stream amber glow when an interrupt fires, before the full response renders.

This is a hard problem — partial responses have no DAG yet, no graph context, and embeddings are expensive. Phase 5C is the longest-running work item.

### 5D. Baselines and comparative evaluation

Today: numbers exist in isolation. We have a 60-pair HPS validation with AUROC 0.73, and 10-case latency benchmarks. We do not have:

- Head-to-head vs raw LLM-as-judge on the same 60 pairs
- Comparison against Guardrails AI / NeMo Guardrails / Lakera Guard on the same threat surface
- Inter-rater agreement with human reviewers on a held-out set
- Per-domain (medical, legal, code, science) precision/recall breakdown
- Adversarial dataset performance (TruthfulQA, HaluEval)

Plan:
- Add `research/comparison/` with reproducible scripts and a `comparison_report.json`
- Run on TruthfulQA-extended, HaluEval-QA, FEVER-style claims
- Publish full confusion matrices, ROC curves, and per-category breakdowns
- File comparison results to the IEEE TETC submission

### 5E. ECS normalization and threshold semantics

Today: ECS is a structural reliability score in `[0.0, 1.0]` but threshold semantics are not formalized in the schema.

Observed in practice:
```
0.0 – 0.2     unreliable        (no support, isolated, low syntactic clarity)
0.2 – 0.4     weak coherence    (sparse support or hedged claims)
0.4 – 0.6     stable reasoning  (typical output of well-structured responses)
> 0.6         high integrity    (currently rare — indicates ECS ceiling)
```

The ceiling at ~0.6 indicates the formula is conservative — the structural support component (δ) saturates because no real response has every claim supported by every predecessor. This is intentional but should be explicit.

Plan:
- Formalize bands in the schema as `ECSBand` enum
- Document the ceiling effect in `docs/ecs.md`
- Optionally add `ecs_normalized` field that linearly stretches [0, 0.6] to [0, 1] for downstream consumers that want a 0–1 calibrated value

## Phase 6 — research extensions

Beyond the governor layer, the research roadmap includes:

- **Quantum reasoning adapter v2.** The current QAOA / VQE adapter (Phase 3H) is a scaffold. Phase 6 adds full HQCD validation against the Meridian project, integration with qBraid, and per-circuit reproducibility checks.
- **Agent reasoning v2.** The current agent layer (Phase 3D) handles linear step sequences. Phase 6 adds branching agent traces, tool-call graphs, and per-tool justification scoring against a tool taxonomy.
- **Reasoning diff at scale.** Multi-model fingerprint comparison currently runs pairwise. Phase 6 adds clustering across model populations and longitudinal drift tracking.
- **Federated trace exchange.** Standard JSON Schema + cryptographic witness signing already enable trace exchange. Phase 6 builds the verification network: query other Glassbox instances for similar traces, compare witness signatures, build a public ledger of consequential AI decisions.

## What's *not* on the roadmap

- **Becoming an LLM.** Glassbox does not generate text. It analyzes text. This is a deliberate architectural constraint and will not change.
- **Becoming an LLM judge.** No model evaluating another model. This is the single most important architectural commitment in the project.
- **Cloud-only deployment.** Local-first is non-negotiable for the verification core.
- **GPU dependency.** CPU-only is the default and will remain so. GPU acceleration is acceptable as an optional path (Phase 6) but the core must run on a developer laptop.

## How to influence the roadmap

- Open an issue with the label `roadmap` describing your use case
- Ship a PR — the bar is in [CONTRIBUTING.md](CONTRIBUTING.md)
- Cite Glassbox in research; that creates pull on Phase 5D baselines
- For research collaborations, contact via the repo
