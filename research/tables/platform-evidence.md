# Platform evidence table

The canonical, fully-verified table is **`../platform-status.md`**. It is maintained in
one place to prevent drift. Summary only:

| Level | Surfaces |
|---|---|
| **L4** public production E2E | Web/PWA `/app`; Remote MCP `/mcp` (discovery, execution, determinism, privacy projection); GitHub direct App (bot-authored Trust Card on issue #2) |
| **L3** production signed canary | Discord (registered, 401 fail-closed); Telegram (registered, 401); Authenticated API (401); GitHub Marketplace (submitted, listing 404) |
| **L2** automated / adversarial test | Browser extension 10/10; Notion 12/12; VS Code 5/5; JetBrains 3/3 (CI); Devvit 9/9; Slack single-workspace pilot; GBSA-1 labelled accuracy benchmark (held-out split only, five of thirteen probes) |
| **L1** implementation present | ChatGPT directory; Claude directory; npm six-tool MCP (separate system, needs user's own key) |
| **L0** proposed | Chrome Web Store (not pursued, no money spent); Mattermost / Discourse / Teams; latency characterisation |
