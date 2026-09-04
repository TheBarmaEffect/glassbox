# Test coverage

Two dated snapshots. The 2026-08-11 figures are the paper's original evidence point; the
2026-09-04 figures are current. **Quote one snapshot, with its date. Never mix them, and
never add the Python core suite to a platform-layer total.**

## Current — re-run 2026-09-04

| Suite | Location | Tests | Result | Re-run |
|---|---|---:|---|---|
| Gateway | `platforms/test/` | **266** | pass, 0 fail | **yes** (`npm test`) |
| Notion (native) | `notion-integration/` | 12 | pass | **yes** |
| Browser extension | `browser-extension/` | 10 | pass | **yes** (`node --test`) |
| Reddit Devvit | `platforms/devvit/src/core/*.test.ts` | 9 | pass | **yes** |
| VS Code | `platforms/ide/vscode-glassbox/` | 5 | pass | **yes** |
| **Platform-layer total, locally re-run** | | **302** | pass | |
| JetBrains | `platforms/ide/jetbrains-glassbox/` | 3 | pass | no — CI evidence only (Gradle toolchain not run) |

The gateway suite grew from 69 to 266 between the two snapshots, which is why the older
**108** total below is stale and must be scoped to `d852db0` wherever it appears.

### Separate system — do not add to the above

| Suite | Location | Tests | Result | Re-run |
|---|---|---|---|---|
| Python core | `core/tests/` | 182 collected | **180 pass, 1 fail, 1 skip** | **yes**, 2026-09-04 |

The failure is `test_verified_corpus_structural_expectations`: a committed corpus fixture
expects `PARTIAL` and the engine returns `COMPLETE`. The same failure was independently
observed on 2026-08-16 (`python-verification.md`). The run used a minimal dependency set
(`pydantic`, `networkx`, `numpy`, `rich`) because the heavy NLP dependencies are lazily
imported, so it exercises the lazy path rather than a full-model run. **The repository's
long-standing "157 passing" figure is not reproducible at this commit and omitted the
failure.**

## Original evidence point — commit `d852db0`, re-executed 2026-08-11

All rows except JetBrains were re-executed locally on 2026-08-11.

| Suite | Location | Tests | Result | Re-run in that audit |
|---|---|---:|---|---|
| Gateway | `platforms/test/` | 69 | pass | **yes** |
| Reddit Devvit | `platforms/devvit/src/core/*.test.ts` | 9 | pass | **yes** |
| Browser extension | `browser-extension/` | 10 | pass | **yes** |
| Notion (native) | `notion-integration/` | 12 | pass | **yes** |
| VS Code | `platforms/ide/vscode-glassbox/` | 5 | pass | **yes** |
| JetBrains | `platforms/ide/jetbrains-glassbox/` | 3 | pass | no, CI evidence only (Gradle toolchain not run) |
| **Platform-layer total** | | **108** | pass | |

`108` is the platform-layer total **at `d852db0`**, not the repository's whole test
count, and **not current** — see the 2026-09-04 snapshot above.

## Gateway distribution (at 0926019, 67 tests; two added by PR #4 → 69)

**Historical.** The suite is at 266 as of 2026-09-04; the distribution below is the
`d852db0` snapshot and has not been recomputed.

adapters 9 · service 10 · GitHub Marketplace 8 · Lite 6 · Lite adversarial 7 ·
MCP schema/privacy 5 · platform options 7 · platform guards 4 · parser 4 ·
Telegram webhook 4 · formatter 2 · child-environment isolation 1.

## Non-test checks re-executed

| Check | Result |
|---|---|
| `npm run typecheck` (strict) | exit 0 |
| `npm run build` | exit 0 |
| `npm run smoke:mcp` | `glassbox_verify_answer` registered |
| `npm audit --omit=dev --audit-level=high` | found 0 vulnerabilities |

Zero **known** vulnerabilities **at that threshold**. Not a pentest, not SAST, not a
certification. CI additionally emits Node 20 and transitive deprecation warnings.

## CI at `d852db0`

Run **31479201334** (`push`, `main`), 12/12 jobs success. See `../reproducibility.md`
for why this run, not 31478963793, is the correct citation.
