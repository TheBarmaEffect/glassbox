# Reproducibility appendix

## Fixed evidence point

| Item | Value |
|---|---|
| Repository | https://github.com/TheBarmaEffect/glassbox |
| Commit | `d852db090cd0b72a50b1738afca9392332445810` |
| Commit title | Launch zero-cost web, browser, Notion, and IDE clients (#4) |
| Merged PR | https://github.com/TheBarmaEffect/glassbox/pull/4 (merged 2026-08-11T09:46:13Z) |
| Public release | https://github.com/TheBarmaEffect/glassbox/releases/tag/integrations-v0.1.0 (published 2026-08-11T09:46:32Z, not draft, not prerelease) |
| **Current-main CI** | **https://github.com/TheBarmaEffect/glassbox/actions/runs/31479201334** |
| Audit date | 2026-08-11 |

### Correction to the handoff, cite the main-branch run

The handoff named run **31478963793**. That run has `headSha =
2901f967638eeb65481476d4ae0a8db44de527db`, `event = pull_request`, branch
`feat/public-multiplatform-launch`. It is the pre-merge run against GitHub's synthetic
merge ref, created at 09:43:11Z, three minutes *before* the merge.

The run against the merged main commit is **31479201334** (`event = push`, branch
`main`, `headSha = d852db09…`, created 09:46:16Z, **12/12 jobs success**). The paper
must cite 31479201334; the other run does not correspond to any commit on `main`.

Both runs are green and contain the same twelve jobs, so no result changes, only the
citation.

## Twelve CI jobs at `d852db0`

Zero-cost platform gateway · Reddit Devvit app · Browser extension packages · Notion
connection · VS Code extension · JetBrains plugin · TypeScript strict-mode + MCP smoke
test · Python package builds/installs/imports on 3.10, 3.11, 3.12, 3.13 ·
Cross-language audit-hash determinism.

## Commands re-executed in this audit

```bash
cd /Users/hungrycheetah/Documents/GlassBox/deploy-worktree/platforms
npm ci && npm test && npm run typecheck && npm run build && npm run smoke:mcp
npm audit --omit=dev --audit-level=high
```

| Check | Result |
|---|---|
| `npm test` (gateway) | **69/69 pass, 0 fail** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run smoke:mcp` | `glassbox_verify_answer` registered |
| `npm audit --omit=dev --audit-level=high` | **found 0 vulnerabilities** |

```bash
cd ../platforms/devvit          && npm ci && npm test   # 9/9  pass
cd ../../browser-extension      && npm ci && npm test   # 10/10 pass
cd ../notion-integration        && npm ci && npm test   # 12/12 pass
cd ../platforms/ide/vscode-glassbox && npm ci && npm test # 5/5 pass
```

**JetBrains (3/3) was not re-run locally**, it is a Gradle/Kotlin project and no JVM
toolchain run was performed. It is cited at **L2 on CI evidence only**.

Platform-layer total **at `d852db0`**: **69 + 9 + 10 + 12 + 5 + 3 = 108**. This is *not*
the whole repository's test count.

> **Stale as a current figure, verified 2026-09-04.** The gateway suite has grown from 69
> to **266**, so the current platform-layer total is **266 + 12 + 10 + 9 + 5 = 302**
> locally re-run, plus JetBrains 3 on CI evidence only. Quote 108 only against `d852db0`.
> See `tables/test-coverage.md` and `evidence-ledger.md` C4a.

## Live production canaries (re-executed 2026-08-11)

```bash
curl -s -X POST https://glassbox-platform-gateway.onrender.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"glassbox_verify_answer",
       "arguments":{"question":"What is 9 multiplied by 9?","answer":"9 × 9 = 80."}}}'
```

Returns `verdict=reject`, `score=0.8143`, `claim_count=1`, `finding_count=1`,
`highest_severity=high`, failing probe `arithmetic_sanity`, six passing probes.

**Determinism.** The identical call issued three times produced byte-identical
responses (SHA-256 of each response body: `f33f82743595e7f292565b5f74f6e6be…`).

**Privacy projection.** With unique sentinel tokens planted in the question and the
answer, neither token appeared in the response, and none of `log_id`, `inputs_hash`,
`generated_at`, `timestamp`, `excerpt` was present.

**Fail-closed routes.** All returned `401`: `/discord/interactions`, `/github/webhook`,
`/telegram/webhook`, `/slack/commands`, `/slack/interactions`, `/github/marketplace`,
`/api/v1/verify`. `/github/marketplace/setup` without a plan returned `400`.
`/.well-known/openai-apps-challenge` returned `404` (no submission token configured).

**Service state.** `/health` → `status=ok`, `verifier_backend=lite`,
`raw_content_persistence=false`, `public_platforms=[discord,telegram,mcp,github]`,
`access=mixed`. `/ready` → `status=ready`, `external_model_required=false`.

## Public E2E artifact

https://github.com/TheBarmaEffect/glassbox/issues/2#issuecomment-5250582130, comment
id `5250582130`, author `glassbox-by-aura[bot]` (type `Bot`), created
2026-08-11T08:03:58Z, body opens `🛑 GlassBox: **REJECT** · ECS 81.4%`.

## Caveats on reproduction

- The Render free instance can sleep; a cold first request may take substantially
  longer. No latency claim is made.
- Live canaries depend on the deployed instance and may drift from the pinned commit.
  Re-verify `/health` before citing.
- `smoke:verify` requires an operator-supplied paid backend key and was **not** run.
  No API was purchased for this work.
