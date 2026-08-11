# GlassBox platform availability

GlassBox Lite is the deterministic, zero-paid-model-API surface. Every client below requires an explicit user audit and calls the public privacy-minimized MCP unless a provider-native adapter is noted.

## Use now

| Surface | Entry point | Distribution |
|---|---|---|
| Web / installable PWA | <https://glassbox-platform-gateway.onrender.com/app> | Public web app |
| Notion | Embed the web-app URL with Notion's `/embed` block | Public, no workspace permissions |
| MCP for ChatGPT, Claude, and compatible clients | `https://glassbox-platform-gateway.onrender.com/mcp` | Public Streamable HTTP MCP |
| GitHub | <https://github.com/apps/glassbox-by-aura/installations/new> | Public GitHub App |
| Discord | <https://discord.com/oauth2/authorize?client_id=1536588680813350972> | Public application install |
| Telegram | <https://t.me/GlassBoxAuditBot> | Public bot |
| Chrome / Edge / Firefox source packages | <https://github.com/TheBarmaEffect/glassbox/releases/latest> | GitHub Release; store reviews separate |
| VS Code VSIX | <https://github.com/TheBarmaEffect/glassbox/releases/latest> | GitHub Release manual install |
| JetBrains plugin ZIP | <https://github.com/TheBarmaEffect/glassbox/releases/latest> | GitHub Release manual install; verified against IntelliJ 2024.3 |

The browser and IDE packages never embed an API key. They require explicit selected/pasted text, confirmation, and display only the privacy-minimized result.

## Native integrations with external gates

| Surface | Current state | Gate |
|---|---|---|
| GitHub Marketplace | Submitted; pending publication review | GitHub review |
| Reddit Devvit | Public request and exact Fetch-domain request pending; corrected version privately ready | Reddit Fetch approval, successful replay, updated review submission |
| Slack | Native single-workspace pilot | Multi-workspace OAuth/storage and Slack eligibility/review |
| Native Notion connection | Review-ready source in [`notion-integration/`](notion-integration/) | Creator-dashboard registration, durable token storage, webhook setup, Notion review |
| ChatGPT public directory | Remote MCP works; no directory listing | OpenAI account/submission review |
| Claude public directory | Remote MCP works; no directory listing | Eligible Claude organization and directory review |
| Chrome Web Store | Package ready | Google's developer registration fee and review |
| Firefox AMO / Edge Add-ons | Packages ready | Publisher verification, signing/certification, review |
| VS Code / Open VSX / JetBrains stores | Packages ready | Publisher identity, agreements, and store review |

External approval is not equivalent to implementation readiness. GitHub Release/manual-install packages remain available while reviews are pending.

## Validation snapshot

- Platform gateway: 69/69 tests, strict TypeScript, build, and runtime dependency audit at the configured threshold.
- Browser extension: 10/10 tests, deterministic packages, Mozilla lint with zero findings, Chrome manifest packing, live MCP canary.
- Notion connection: 12/12 tests, strict TypeScript/build, encrypted token-store tests, live MCP canary.
- VS Code: 5/5 tests, strict TypeScript, VSIX packaging/integrity, live MCP canary.
- JetBrains: 3/3 JUnit tests, structure verification, package build, and Plugin Verifier compatibility with IntelliJ `243.*`/2024.3.
- Reddit Devvit: 9/9 tests plus type, lint, build, config, icon, and reviewer-document validation.

Counts describe different test suites and must not be presented as marketplace approval or universal production end-to-end testing.
