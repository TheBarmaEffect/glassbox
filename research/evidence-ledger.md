# Evidence ledger

Every consequential sentence the paper may make, tied to a source. Verified at commit
`d852db090cd0b72a50b1738afca9392332445810`, audit date 2026-08-11.

**Safe-for** column: `A` abstract, `B` body, `X` appendix, `F` future-work only.

| ID | Proposed wording | Level | Source / evidence | Limitation that must accompany it | Safe for |
|---|---|---|---|---|---|
| C1 | "GlassBox Lite is a deterministic, zero-paid-API structural reasoning auditor." | L4 | `platforms/src/lite.ts`; live `/ready` reports `external_model_required=false`; 3 identical production MCP calls returned byte-identical output (SHA-256 `f33f8274…`) | Determinism is asserted for the Lite backend only, not the model-assisted npm MCP | A, B |
| C2 | "It applies bounded, conservative probes for claim segmentation, allowlisted arithmetic, direct lexical contradiction, unsupported certainty, citation transparency, external fact-check scope, and prompt-injection signals." | L4 | Live `tools/call` returned exactly these seven probe angles: `claim_extraction`, `unsupported_certainty`, `internal_contradiction`, `prompt_injection`, `fact_check_scope`, `citation_verifiability`, `arithmetic_sanity` | Contradiction detection is lexical, not NLI-grade; arithmetic is allowlisted, not general | A, B |
| C3 | "The public MCP projection omits submitted content, excerpts, timestamps, audit identifiers, input hashes, and verifier-internal free text." | L4 | **New test in this audit:** unique tokens planted in question and answer were absent from the response, as were `log_id`, `inputs_hash`, `generated_at`, `timestamp`, `excerpt`. Also `platforms/test/mcp.test.ts` | Providers and Render still process request traffic in transit | A, B |
| C4 | "At commit `d852db0`, 108 automated tests passed across six heterogeneous suites." | L2 | Re-run in this audit: gateway 69/69, browser extension 10/10, Notion 12/12, Devvit 9/9, VS Code 5/5. JetBrains 3/3 **CI-verified only** | 108 is the platform-layer total, **not** the whole repository's test count | B, X |
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
| C20 | "Warm and cold latency characterisation under Render free-tier cold starts." | **L0** | Not executed | Render free instances can sleep; no guaranteed-latency claim may be made | F |

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

## Claims explicitly refused

These were checked and **cannot** be supported at `d852db0`: universal platform E2E;
any marketplace or directory approval; measured hallucination precision/recall/F1;
ECS as calibrated truth probability; semantic/NLI contradiction detection; general-purpose
arithmetic; complete prompt-injection security boundary; "nothing leaves the device";
"zero data collection"; "no third parties"; end-to-end encryption; "no vulnerabilities";
penetration tested; any compliance certification; determinism of the model-assisted
pipeline; captured Discord/Telegram user transcripts; public Slack; public Reddit.
