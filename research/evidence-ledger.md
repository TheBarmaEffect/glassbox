# Evidence ledger

Every consequential sentence the paper may make, tied to a source. Original verification at
commit `d852db090cd0b72a50b1738afca9392332445810`, audit date 2026-08-11.

**Re-verified and extended 2026-09-04** in a documentation-reconciliation pass. Rows C4a,
C4b and C21–C28 are new; C4 is superseded and C20 re-confirmed. Where a row's evidence was
re-run or re-fetched, the row says so and gives the date. Rows still carrying only the
2026-08-11 evidence point are unchanged and must be quoted against that commit, not against
HEAD — see the note on C2.

> **The working tree was being edited while this pass ran, and every count below is a
> timestamped observation rather than a stable figure.** `platforms/src/lite.ts`,
> `mcp.ts` and `signals.ts` and two test files changed between 15:21 and 15:31 on
> 2026-09-04, mid-pass; the gateway suite moved from **254 to 266** in that window (probe
> recall enhancements plus 12 new tests: word-form arithmetic, a numeric certainty
> absolute, persona-override injection forms, a short-claim contradiction floor, and
> legal/parenthetical citation forms). The 14 deterministic probe angles and the 6
> tool-invocation angles did not change. **Re-run every count and re-fetch every live
> endpoint immediately before submission, and anchor the paper to a specific commit.**

**Safe-for** column: `A` abstract, `B` body, `X` appendix, `F` future-work only.

| ID | Proposed wording | Level | Source / evidence | Limitation that must accompany it | Safe for |
|---|---|---|---|---|---|
| C1 | "GlassBox Lite is a deterministic, zero-paid-API structural reasoning auditor." | L4 | `platforms/src/lite.ts`; live `/ready` reports `external_model_required=false`; 3 identical production MCP calls returned byte-identical output (SHA-256 `f33f8274…`) | Determinism is asserted for the Lite backend only, not the model-assisted npm MCP | A, B |
| C2 | "It applies bounded, conservative probes for claim segmentation, allowlisted arithmetic, direct lexical contradiction, unsupported certainty, citation transparency, external fact-check scope, and prompt-injection signals." **Probe count stale — see C23, C24, C26.** As of 2026-09-04 the live gateway publishes **13** deterministic probe angles and 6 tool-invocation probe angles; this repository's handler declares 14 deterministic. | L4 | Live `tools/call` (2026-08-11) returned exactly these seven probe angles: `claim_extraction`, `unsupported_certainty`, `internal_contradiction`, `prompt_injection`, `fact_check_scope`, `citation_verifiability`, `arithmetic_sanity` | Contradiction detection is lexical, not NLI-grade; arithmetic is allowlisted, not general | A, B |
| C3 | "The public MCP projection omits submitted content, excerpts, timestamps, audit identifiers, input hashes, and verifier-internal free text." | L4 | **New test in this audit:** unique tokens planted in question and answer were absent from the response, as were `log_id`, `inputs_hash`, `generated_at`, `timestamp`, `excerpt`. Also `platforms/test/mcp.test.ts` | Providers and Render still process request traffic in transit | A, B |
| C4 | "At commit `d852db0`, 108 automated tests passed across six heterogeneous suites." **Superseded — see C4a.** | L2 | Re-run in the 2026-08-11 audit: gateway 69/69, browser extension 10/10, Notion 12/12, Devvit 9/9, VS Code 5/5. JetBrains 3/3 **CI-verified only** | 108 is the platform-layer total, **not** the whole repository's test count. **The gateway suite has since grown from 69 to 266, so 108 is stale and must not be quoted as current.** | X only |
| C4a | "As of 2026-09-04, 302 platform-layer tests pass across five locally re-run suites, plus 3 JetBrains tests on CI evidence only." | L2 | Re-run 2026-09-04: gateway **266/266** (`npm test` in `platforms`), Notion 12/12, browser extension 10/10, Reddit Devvit 9/9, VS Code 5/5. JetBrains 3 not re-run (Gradle toolchain unavailable locally) | Platform-layer total. **Never** add the Python core's `core/tests` to it — different system, different claim | B, X |
| C4b | "The Python core suite `core/tests` collects 182 tests; a 2026-09-04 re-run gives 180 passed, 1 failed, 1 skipped." | L2 | `pytest core/tests`, 2026-09-04, in a clean venv with `pydantic`, `networkx`, `numpy`, `rich` only. Failure: `test_verified_corpus_structural_expectations` (committed fixture expects `PARTIAL`; engine returns `COMPLETE`) — the same failure independently observed 2026-08-16 in `tables/python-verification.md` | Heavy NLP dependencies (`torch`, `spacy`, `transformers`, `sentence-transformers`) are lazily imported and were **not installed**, so this run exercises the lazy path, not a full-model run. The repository's long-standing "157 passing" figure is **not reproducible at this commit** and omitted the failure. `core/` is a separate research prototype, not the system this paper evaluates | X only |
| C5 | "Strict TypeScript typecheck, production build, MCP smoke test, and a production dependency audit reporting zero known vulnerabilities all passed." | L2 | Re-run: `npm run typecheck` exit 0; `npm run build` exit 0; `npm run smoke:mcp` registered `glassbox_verify_answer`; `npm audit --omit=dev --audit-level=high` → "found 0 vulnerabilities" | Zero **known** vulnerabilities **at that audit threshold**. Not a pentest, not SAST, not a certification | B, X |
| C6 | "Twelve CI jobs succeeded on the merged main commit." | L2 | **Corrected:** run **31479201334** (`push`, `main`, headSha `d852db0`, 12/12 success). The handoff cited 31478963793, which is the *pull_request* run at merge-ref `2901f967` | Cite the main-branch run for reproducibility | B, X |
| C7 | "A public GitHub App canary demonstrated a complete issue-comment-to-Lite-to-bot-response path." | L4 | Issue #2 comment `5250582130`, author `glassbox-by-aura[bot]` (type `Bot`), 2026-08-11T08:03:58Z, body begins `🛑 GlassBox: **REJECT** · ECS 81.4%` | Single canary authored by the operator; not a third-party user study | A, B |
| C8 | "A production MCP canary demonstrated public tool discovery and execution over Streamable HTTP." | L4 | Re-executed live: `tools/list` returned the tool; `tools/call` on `9 × 9 = 80` → `verdict=reject`, `score=0.8143`, high-severity `arithmetic_sanity` | Does not imply ChatGPT Store or Claude Directory publication | A, B |
| C9 | "Every provider webhook route fails closed on unsigned or unauthenticated requests." | L3 | **Re-probed live:** `/discord/interactions`, `/github/webhook`, `/telegram/webhook`, `/slack/commands`, `/slack/interactions`, `/github/marketplace`, `/api/v1/verify` all returned **401**; `/github/marketplace/setup` without a plan returned **400** | Implementation-tested controls, not a penetration test | B, X |
| C10 | "Discord and Telegram are publicly registered and connected to authenticated production routes; preserved end-to-end user-result transcripts remain future validation work." | L3 | Install URLs live; 401 on unsigned; adapter and webhook tests pass | Must **not** be described as production E2E proven | B |
| C11 | "Slack remained an explicitly allowlisted single-workspace pilot." | L2/L3 | Absent from live `public_platforms`; 401 on unsigned Slack routes | No public listing, no multi-workspace OAuth | B |
| C12 | "GitHub Marketplace was submitted and pending publication review." | L3 | `github.com/marketplace/glassbox-by-aura` → **404** re-verified; signed purchase/cancel canaries were operator-synthetic | **Never** say published, listed, or searchable | B |
| C13 | "Reddit Devvit reached explicit-consent and gateway-initiation stages but remained blocked pending external Fetch-domain approval." | L2 | Devvit 9/9 re-run; playtest reached gateway stage then failed with a network error | Fetch-allowlist attribution is an **inference**, not a confirmed Reddit diagnosis. No Trust Card was produced | B |
| C14 | "ChatGPT and Claude can target the live remote MCP technically, while their public directories remain separate platform-level approval processes." | L1 | `/.well-known/openai-apps-challenge` → **404** (no token configured); Claude Directory requires an eligible Team/Enterprise org | No captured UI E2E for either | B |
| C15 | "Cross-language canonical audit hashing reproduces `glassbox-85cc09903bd4b3f8022a4087` across JavaScript and an installed Python client." | L2 | CI job "Cross-language audit-hash determinism" green at `d852db0` | Begins from **prebuilt** claim/red-team/ECS parts. Proves canonical assembly, serialization and hashing, **not** that unconstrained model analysis is deterministic. Belongs to the *older six-tool MCP*, not Lite | B, X |
| C16 | "The deployed default requires no paid model API." | L4 | Live `/health` `verifier_backend=lite`; `/ready` `external_model_required=false` | The separate npm six-tool MCP does need the user's own key | A, B |
| C17 | "GlassBox charges no fee and sells nothing; Chrome Web Store was not pursued because it can require a paid developer registration." | L1 | Marketplace plan is "GlassBox Free" at $0; no paid tier | State plainly; do not imply money was spent | B |
| C18 | "ECS is a structural reasoning score." | L1 | `platforms/src/lite.ts` | **Never** call it a truth probability, calibrated confidence, or accuracy measure | A, B |
| C19 | "Precision, recall and F1 by probe against a labelled benchmark." | **L2** | GBSA-1, `research/benchmark/`. Built 2026-08-15 (seeded generators), **re-executed and re-scored 2026-09-03** after 27 security and correctness fixes: held-out per-probe confusion matrices are **unchanged**, micro P 1.000 / R 0.639 / F1 0.780 (n=75), 3 byte-identical passes, digest `53b2319e6190…` | Five probes only — the other eight have no accuracy measurement. Development-split figures are tuned on the test set and must not be quoted as capability. Strata are small (4–16 positives), so CIs are wide. No AUROC, no calibration, no verdict-level false-approval/false-rejection rate | B, X |
| C20 | "Warm and cold latency characterisation under Render free-tier cold starts." | **L0** | Not executed | Render free instances can sleep; no guaranteed-latency claim may be made. Re-confirmed 2026-09-04: live `/api/v1/metrics` latency percentiles read `null` on a freshly restarted instance | F |
| C21 | "`POST /api/v1/govern` is a deployed synchronous release gate: it releases `allow`/`record` (200) and withholds `block` (422) and `retry`/`escalate` (409), returning `enforced_by_gateway: true` and a machine-readable `next_step`." | L4 | `platforms/src/api.ts` lines 88–105; live `/api/v1/capabilities` publishes `governance_gate.releases = ["allow","record"]`, `withholds = ["block","retry","escalate"]`, `response_endpoints["/api/v1/govern"] = "synchronous release gate"`, re-verified 2026-09-04 | Under the four-capability taxonomy this is **prevention, deployed**. It is **not** remediation: the gate withholds output and never regenerates it. It withholds *authorization* — it does not intercept or execute a tool call. `/api/v1/verify` is advisory and must never be counted as enforcement | A, B |
| C22 | "Escalation is signalled but not operated: `escalate` returns 409 with `next_step: \"human_review\"`." | L4 | `platforms/src/api.ts`; live `governance_gate.caller_next_steps = ["retry","human_review"]` | The exact defensible sentence is **"escalation signalling is implemented; an escalation queue is not."** No reviewer identity, no decision, no decision timestamp, no back-reference exists. Neither "we do human escalation" nor "we don't" is accurate | A, B |
| C23 | "Tool-invocation assurance is deployed at the `tool_call` and `agent_step` checkpoints, with declaration pinning that covers the tool's natural-language description as well as its JSON Schema, drift attributed by component, capability scoping, and argument scanning." | L4 | `platforms/src/toolcall.ts`; wired into `GlassboxLiteVerifier` via the `toolCallProbes(...)` call in `platforms/src/lite.ts`; live `/api/v1/capabilities` publishes six `tool_invocation_probes` and `tool_assurance.declaration_pin_covers = ["name","description","input_schema"]`, `drift_attribution: true`, `capability_scope: "allowed_tools"`, re-verified 2026-09-04 | **Existence and mechanism only — no accuracy measurement of any kind exists for these six probes.** Hash equality gives TPR=1/FPR=0 by construction, which is uninteresting; the operationally meaningful number (what fraction of real schema changes are benign version bumps) is **unmeasured**. Pinning cannot detect a behaviour change that leaves the declaration unchanged, and the **caller** supplies and stores the pin | A, B |
| C24 | "`citation_resolvability` screens citation identifiers offline by check-digit arithmetic (ISBN-10, ISBN-13, ISSN, ORCID) and permanently closed range constraints (the arXiv digit-width/date coupling), and fires on 0 of 187 GBSA-1 items." | L2 | `platforms/src/citation.ts`; wired into `GlassboxLiteVerifier` via the `citationResolvabilityProbe(...)` call in `platforms/src/lite.ts`; firing count computed 2026-09-04 over `benchmark/results.jsonl` (112) + `benchmark/heldout_results.jsonl` (75) = 187 items, `citation_resolvability` false in 0. **Those result files are the 2026-09-03 scoring run and predate probe changes made to `lite.ts` on 2026-09-04; re-run the benchmark before publication** | **0 firings bounds false positives on a corpus with no positives in it. GBSA-1 has no fabricated-identifier stratum, so recall is entirely unmeasured**, and is bounded above by identifier presence. The finding must be worded *the identifier fails its own check digit*, never *the citation is fabricated*. **Not yet live** — see C26. The Federal Reporter closed-volume constraint described in some design notes is **not implemented**; do not cite it | B, X |
| C25 | "`GET /api/v1/capabilities` and `GET /api/v1/metrics` are unauthenticated machine-readable transparency artifacts; the first publishes an eight-entry `limitations[]` array, the second publishes content-free aggregate counters." | L4 | Both fetched live, unauthenticated, HTTP 200, 2026-09-04. `platforms/src/server.ts`; `platforms/src/metrics.ts` | Metrics counters are **in-memory and reset on restart** — process-local aggregates, **not a durable audit log**, as the payload itself states. `probe_fire_rate` is fired/evaluated: how often a check flagged something, **not** how often it was right. At the time of verification all counters read 0 (instance uptime 9 s), so **no traffic evidence follows from this row** | A, B |
| C26 | "The gateway advertises 14 deterministic probes including `citation_resolvability`, and the six tool-invocation probes are live." | L4 | `curl /api/v1/capabilities` 2026-09-04 after deploy; a checksum-invalid ISBN returns `reject` naming `citation_resolvability` via the public MCP endpoint | Supersedes the earlier skew note: the live instance lagged the repository by three commits until 2026-09-04 because CI was red and auto-deploy is gated on it. Re-verify before submission | B, X |
| C27 | "HPS AUROC 0.7344 on 60 constructed pairs (Python core)." | **L1** | `core/research/validation/hps_validation_report.json`, generated 2026-04-25; reproduces via `make hps-validate` | **A pilot signal, not a validation, and not admissible as capability.** (a) The predictor orientation was inverted *after* observing the data; under the a-priori orientation the same sample gives AUROC 0.2656. (b) The threshold (HPS ≤ 0.6815, Youden's J) was selected in-sample on the same 60 pairs, so F1 0.7302 is an in-sample optimum. (c) n=60, single author, constructed labels, no independent annotators, no inter-rater agreement, no held-out split. (d) No calibration. (e) It belongs to the **Python core**, which is not the system this paper evaluates. **Never write "empirically-validated".** | X only, with all five caveats attached |
| C28 | "`trajectory.ts` and `attribution.ts` are implemented and tested but reachable from no endpoint." | L4 | `grep` over `platforms/src/*.ts` 2026-09-04: no module imports either, and `POST /api/v1/trajectory/replay` / `GET /api/v1/trajectory/pubkey` do not exist | A test-suite line item is **not** a deployed capability. `attribution.ts` is held back deliberately: GBSA-1's held-out split is *spent* for the citation and certainty probes, so no recall figure for it could be quoted honestly. **No Merkle log, signed tree head or inclusion-proof endpoint is deployed** | X only |

## Corrections after the 2026-09-03 audit

- **C19 was L0 "Not executed" and is now L2.** GBSA-1 exists, is seeded, and reproduces.
  The claim is admissible in the body with the four constraints in its row.
- **`REPRODUCE.md` did not run against HEAD.** `run_benchmark.mjs` omitted `platform`,
  which `normalizeInput` began rejecting when platform validation was tightened. Fixed;
  the documented commands now reproduce. A reproducibility script that does not run is a
  worse defect than a missing number, and it was silent.
- **27 confirmed security and correctness findings were fixed** (see `tmp/redteam_audit.md`).
  Two were critical: a caller-supplied `response_policy` could release a critical-severity
  reject through the enforcing gate, and a caller constitution rule could reuse a built-in
  rule id and forge the published compliance evaluation. **Neither is reachable in the
  benchmark**, so the GBSA-1 numbers were unaffected by both the defects and the fixes —
  which is itself a finding about what the benchmark does and does not cover.

## Corrections after the 2026-09-04 documentation reconciliation

- **C4 is superseded by C4a.** The 108 platform-layer figure was correct on 2026-08-11 and
  is stale now: the gateway suite grew from 69 to 266. The re-run platform-layer total is
  **302** locally plus 3 on CI evidence. Every public surface quoting 108 as current must
  be updated or scoped to its commit.
- **C27 is new and downgrades a long-standing claim.** The HPS AUROC sat unscoped in the
  root `README.md` header block and a comparison-table row called it an
  "empirically-validated hallucination signal". Both are withdrawn. The number is real; the
  framing was not. Note that `limitations.md` correctly said "no AUROC" — scoped to the
  Lite gateway — while the README asserted one for the Python core. Two of the project's
  own documents appeared to contradict each other because neither named its component.
- **C21–C23 are underclaims that were costing more than the overclaims.** The deployed
  gateway is a governor and the documentation called it an observer; tool-invocation
  assurance closes a gap this project's own evidence map names as unoccupied. Both are now
  stated in `README.md`, `ROADMAP.md` and `platforms/README.md`.
- **C24 and C26 must travel together.** Offline citation screening is implemented, tested
  and **not yet live**.
- **C28 exists to stop a specific error.** `trajectory.ts` passing its tests is not a
  deployed Merkle log.

## Claims explicitly refused

These were checked and **cannot** be supported. Refusals are permanent unless a row in
the table above supersedes them, and each is dated so a stale refusal cannot masquerade as
a current one.

**Refused at `d852db0` (2026-08-11) and still refused:** universal platform E2E; any
marketplace or directory approval; ECS as calibrated truth probability; semantic/NLI
contradiction detection; general-purpose arithmetic; complete prompt-injection security
boundary; "nothing leaves the device"; "zero data collection"; "no third parties";
end-to-end encryption; "no vulnerabilities"; penetration tested; any compliance
certification; determinism of the model-assisted pipeline; captured Discord/Telegram user
transcripts; public Slack; public Reddit.

**Amended 2026-09-04.** "Measured hallucination precision/recall/F1" was on the list above
and is now **partly supportable, narrowly**: C19 records held-out micro precision 1.000,
recall 0.639, F1 0.780 (n=75) **for five probes only**, and none of those five is a
hallucination detector — they measure whether a probe fires on items constructed to be
positive or negative for that probe. The refusal is therefore restated precisely:

- **Refused:** any precision, recall, F1 or AUROC figure for *hallucination detection* as
  such; any figure at all for the 9 unscored deterministic probes or the 6
  tool-invocation probes; any recall figure for `citation_resolvability`; any verdict-level
  false-approval or false-rejection rate; any prevalence, base-rate or deployment-impact
  claim derived from GBSA-1.
- **Permitted, with C19's four constraints attached:** the held-out per-probe figures for
  the five scored probes.

**Added to the refused list 2026-09-04:**

- **"Empirically-validated hallucination signal", of HPS or anything else.** See C27.
- **Any ✓/✗ comparative capability rating against Guardrails AI, NeMo Guardrails, Lakera
  Guard, OpenTelemetry, Langfuse, or an LLM-as-judge baseline.** No head-to-head evaluation
  exists; `ROADMAP.md` §5D says so. Architectural self-description is permitted;
  comparative rating is not.
- **"Audit trail", of the deployed gateway.** The phrase carries retention, protection and
  retrieval duties the system does not meet, and the gateway emits no `WitnessDocument` at
  all. Permitted wording: *evidence input for an operator-maintained record*.
- **Sectoral suitability** for medical, legal or financial use.
- **Unscoped "deterministic".** The claim is true of the Lite backend and of the Python
  core on fixed hardware and weights; it is false of the optional `anthropic` backend and
  of the model-assisted six-tool MCP. It must never appear without its backend.
- **Any cross-suite test total.** Each figure names its suite. 157 is additionally
  **not reproducible** — see C4b.
- **Any deployed-traffic, usage or latency figure.** C20 is L0; C25's counters read 0 at
  verification and reset on restart.
- **A deployed append-only Merkle log, signed tree head, or inclusion-proof endpoint.**
  See C28: implemented, tested, wired to nothing.
