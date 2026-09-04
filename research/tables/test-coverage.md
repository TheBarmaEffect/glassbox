# Test coverage

Commit `d852db090cd0b72a50b1738afca9392332445810`. All rows except JetBrains were
re-executed locally on 2026-08-11.

| Suite | Location | Tests | Result | Re-run in this audit |
|---|---|---:|---|---|
| Gateway | `platforms/test/` | 69 | pass | **yes** |
| Reddit Devvit | `platforms/devvit/src/core/*.test.ts` | 9 | pass | **yes** |
| Browser extension | `browser-extension/` | 10 | pass | **yes** |
| Notion (native) | `notion-integration/` | 12 | pass | **yes** |
| VS Code | `platforms/ide/vscode-glassbox/` | 5 | pass | **yes** |
| JetBrains | `platforms/ide/jetbrains-glassbox/` | 3 | pass | no, CI evidence only (Gradle toolchain not run) |
| **Platform-layer total** | | **108** | pass | |

`108` is the platform-layer total, **not** the repository's whole test count.

## Gateway distribution (at 0926019, 67 tests; two added by PR #4 → 69)

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
