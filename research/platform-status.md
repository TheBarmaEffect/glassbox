# Platform availability and evidence status

**Verified against commit `d852db090cd0b72a50b1738afca9392332445810` on 2026-08-11.**
Every row below was independently re-verified in this audit unless the Verification
column says otherwise.

## Evidence levels

| Level | Meaning |
|---|---|
| **L4** | Public production end-to-end: a real request traversed a public surface and produced a captured, publicly viewable result. |
| **L3** | Production signed/configured canary: an operator-initiated request against the live production route, correctly authenticated or deliberately forged. |
| **L2** | CI or local automated test, including adversarial tests. |
| **L1** | Implementation and configuration present, not exercised end to end. |
| **L0** | Proposed or future work. |

Levels are never collapsed into "tested".

## Status table

| Surface | Public? | Level | What is actually proven | What is NOT proven | Verification in this audit |
|---|---|---|---|---|---|
| **Web / PWA** `/app` | Yes | **L4** | HTTP 200 live; the app is publicly reachable | No captured third-party user session | Re-verified: `/app` → 200 |
| **Remote MCP** `/mcp` | Yes | **L4** | `tools/list` returns `glassbox_verify_answer`; `tools/call` on `9 × 9 = 80` returns `verdict=reject`, `score=0.8143`, high-severity `arithmetic_sanity` | Not listed in any public directory | **Re-executed live.** Canary reproduced exactly. |
| **MCP determinism** | Yes | **L4** | 3 identical production calls produced **byte-identical** responses (SHA-256 `f33f8274…`) | Does not extend to the model-assisted npm MCP | **New evidence generated in this audit** |
| **MCP privacy projection** | Yes | **L4** | Unique tokens planted in question and answer did **not** appear in the response; `log_id`, `inputs_hash`, `generated_at`, `timestamp`, `excerpt` all absent | Providers and Render still process traffic | **New evidence generated in this audit** |
| **GitHub direct App** | Yes | **L4** | `github.com/apps/glassbox-by-aura` → 200. Issue #2 comment `5250582130` authored by `glassbox-by-aura[bot]` (type `Bot`) at 2026-08-11T08:03:58Z, body `🛑 GlassBox: REJECT · ECS 81.4%` | Not a Marketplace listing | Re-verified via GitHub API |
| **Authenticated API** `/api/v1/verify` | Bearer-protected | **L3** | Unauthenticated POST → **401** | Not an open endpoint; secret not published | Re-probed live |
| **Discord** | Public/installable | **L3** | Install URL live; unsigned POST `/discord/interactions` → **401**; 9 adapter tests pass | **No preserved real-user result transcript.** Not Discord-verified or discoverable | Re-probed live |
| **Telegram** | Public bot | **L3** | `t.me/GlassBoxAuditBot` registered; unsigned POST `/telegram/webhook` → **401**; webhook-contract tests pass | **No preserved real-user result transcript** | Re-probed live |
| **GitHub Marketplace** | Submitted | **L3** | Unsigned POST `/github/marketplace` → **401**; `/github/marketplace/setup` without a plan → **400** | **`github.com/marketplace/glassbox-by-aura` → 404. Not published.** Signed purchase/cancel canaries were operator-synthetic, not provider-originated | Re-probed live; 404 confirmed |
| **Slack** | Allowlisted pilot | **L2/L3** | Unsigned POST `/slack/commands` and `/slack/interactions` → **401**; signed-command, visibility, response_url and modal tests pass | **Absent from `public_platforms`.** No public listing, no multi-workspace OAuth, no user transcript | Re-probed live |
| **Browser extension** | Manual install | **L2** | 10/10 tests pass locally; CI job "Browser extension packages" green | Not in Chrome Web Store, AMO, or Edge Add-ons | **Re-ran: 10/10** |
| **Notion (native)** | Not hosted | **L2** | 12/12 tests pass locally; CI job "Notion connection" green | Not registered or publicly hosted. Immediate use is embedding the public `/app` URL | **Re-ran: 12/12** |
| **VS Code extension** | Manual VSIX | **L2** | 5/5 tests pass locally; CI job green | Not in VS Code Marketplace or Open VSX | **Re-ran: 5/5** |
| **JetBrains plugin** | Manual ZIP | **L2** | CI job "JetBrains plugin" green at `d852db0` | Not in JetBrains Marketplace | CI-verified only, Gradle toolchain not run locally |
| **Reddit Devvit** | Not public | **L2** | 9/9 tests pass locally; CI job green | **Public review PENDING.** Fetch-domain approval pending. Gateway stage failed with a network error; unapproved Fetch allowlist is the *leading inference*, not a confirmed Reddit diagnosis. No visible Trust Card produced | **Re-ran: 9/9** |
| **ChatGPT directory** | No | **L1** | The remote MCP is technically reachable by compatible clients | No captured ChatGPT UI E2E. `/.well-known/openai-apps-challenge` → **404** (no token configured). No Store listing | Re-probed live |
| **Claude directory** | No | **L1** | Same endpoint is technically compatible | No captured Claude UI E2E. Public Directory requires an eligible Team/Enterprise org, which this individual setup does not satisfy | Not re-probed |
| **npm `@glassbox-framework/mcp`** | Published | **L1** | Separate six-tool stdio MCP, v1.0.3 | **Different system.** Most tools need the user's own `ANTHROPIC_API_KEY`. Not the zero-cost Lite MCP | Previously verified on npm |
| **Chrome Web Store** | Not pursued | **L0** | n/a | Deliberately not pursued (can require a paid developer registration). **No money was spent** | n/a |
| **Mattermost / Discourse / Teams** | No | **L0** | n/a | Future work through the authenticated API | n/a |

## Live service state (re-verified 2026-08-11)

`/health` → `status=ok`, `verifier_backend=lite`, `raw_content_persistence=false`,
`platforms=[mcp, api, discord, slack, telegram, github]`,
`public_platforms=[discord, telegram, mcp, github]`, `access=mixed`.

`/ready` → `status=ready`, `verifier_backend=lite`, `external_model_required=false`.

`/`, `/app`, `/privacy`, `/terms`, `/support` all return 200.
