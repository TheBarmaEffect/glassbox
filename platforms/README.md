# GlassBox Platform Gateway

One deployable Node 20 service that brings the published GlassBox v1 Trust Card pipeline to:

- Discord: `/glassbox` and **Analyze with GlassBox** message command
- Slack: `/glassbox` and **Analyze with GlassBox** message shortcut + review modal
- Telegram: `/glassbox --consent` on a replied-to message or explicit question/answer
- GitHub: `/glassbox` issue or pull-request comments
- Reddit: disabled-by-default classic bridge for explicitly approved Data API pilots; Devvit is the primary path
- ChatGPT and Claude: public MCP Streamable HTTP at `/mcp`
- Any approved platform: authenticated `POST /api/v1/verify`

The gateway uses the deterministic GlassBox Lite verifier by default and produces compact platform-native Trust Cards without a paid model API, API key, or network lookup. It does not monitor conversations or persist raw question/answer content. The published `@glassbox-framework/mcp@1.0.3`/Anthropic verifier remains an explicit opt-in backend for operators who provide their own key.

## Quick start

```bash
cd platforms
cp .env.example .env
# Keep GLASSBOX_BACKEND=lite. Set PLATFORM_SHARED_SECRET for the universal API.
npm install
npm test
npm run build
npm start
```

Check `http://localhost:8080/health` for liveness and `/ready` for selected-verifier readiness. Lite is ready without an external API key. Only adapters whose complete credentials are present appear in the `platforms` list.

When Telegram credentials are configured, startup registers `${PUBLIC_BASE_URL}/telegram/webhook` before the gateway begins listening. If registration fails, Telegram is disabled for that process while the core gateway and other adapters remain healthy; tokens and webhook secrets are never logged.

Run the container:

```bash
docker build -t glassbox-platform-gateway .
docker run --rm -p 8080:8080 --env-file .env glassbox-platform-gateway
```

## Universal interaction model

Every platform sends the same three pieces to GlassBox:

```text
question || answer || optional intent 1; optional intent 2
```

The native reply/context-menu flows pre-fill the answer. Analysis is always user-invoked. Discord and Slack results are private by default. Discord supports an explicit public result; Slack publishes only when `--public` is the first command argument. Telegram requires `--consent` as the first argument for every audit.

## Architecture

```text
Discord / Slack / Telegram / GitHub / Reddit / ChatGPT / Claude / API
                         |
         signature verification + input caps
                         |
   tenant admission + idempotency + requester limit
                         |
   daily volume breaker + bounded queue (concurrency 1)
                         |
 deterministic Lite verifier (default, no network)
       or explicit MCP/Anthropic opt-in
                         |
             compact Trust Card formatter
```

No platform user ID, server/workspace name, subreddit, repository name, or URL is passed to the verifier. With Lite, the explicitly submitted question, answer, and optional intents remain inside this process. With the optional Anthropic backend, only those submitted text fields cross the MCP boundary.

The default is a closed pilot. `PILOT_TENANT_ALLOWLIST` accepts exact lowercase keys: `api`, `mcp:public`, `discord:<guild-id>` (or `discord:user:<user-id>`), `slack:<team-id>`, `telegram:<chat-id>`, `github:<owner/repo>`, and `reddit:<subreddit>`. `mcp:public` deliberately opens only the rate-limited, read-only `/mcp` tool while keeping provider adapters allowlisted. Setting `PLATFORM_ALLOW_PUBLIC=true` bypasses every tenant gate and should happen only after platform approval and multi-tenant abuse controls are ready.

## ChatGPT and Claude MCP

The public zero-cost connector URL is:

```text
https://YOUR_DOMAIN/mcp
```

It speaks MCP Streamable HTTP and exposes one read-only tool: `glassbox_verify_answer`. The tool runs the same deterministic Lite verifier as the platform adapters, makes no model-provider API call, and returns the full Trust Card as JSON. Add `mcp:public` to `PILOT_TENANT_ALLOWLIST` before connecting a remote client.

In ChatGPT, enable Developer mode under **Settings → Security and login**, open **Plugins**, select **+**, and enter the `/mcp` URL as a public connection. In Claude, open **Customize → Connectors → + → Add custom connector** and enter the same URL. No OAuth client or model API key is required for this read-only public tool.

## Platform launch order

1. Telegram public bot and Discord user-install test: fastest feedback and no marketplace dependency.
2. GitHub public App: direct installs work without a Marketplace listing.
3. Slack single-workspace pilot: validate the interaction first, then add OAuth/token storage and grow to the current Marketplace eligibility threshold (5 active workspaces and 10 weekly active users).
4. Reddit Devvit review: request the exact GlassBox API domain and build the menu action. Enable the classic bridge only if Reddit separately approves that exact Data API use case.
5. Mattermost and Teams: add through the authenticated universal API after the first four produce real usage data.

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact setup and current review constraints.

## Security and privacy defaults

- Raw request bodies are used only for provider signature verification and are not logged.
- Raw prompts and answers are not stored by this service.
- Completed event IDs are held in memory for up to 24 hours for deduplication; rate counters last 10 minutes.
- Submitted content and generated Trust Cards remain in memory only while an audit runs and for at most five minutes while delivery is confirmed.
- External API access requires a bearer secret.
- Discord, Slack, Telegram, and GitHub requests are authenticated with each platform's signed webhook mechanism.
- `allowed_mentions` is disabled in Discord responses; links are not unfurled in Slack.
- Verification is an automated reasoning audit, not a fact-check, moderation decision, or professional advice.
- The default Lite verifier is offline and deterministic. It checks structure, calibration, internal contradictions, citations that need verification, and simple arithmetic; it does not establish factual truth.
- The optional Anthropic backend must be selected explicitly with `GLASSBOX_BACKEND=anthropic`, requires the deployer's API key, and must be disclosed to pilot users.
- Discord delivery is hard-stopped before its 15-minute interaction-token expiry even if an operator raises the generic job timeout.
- The classic Reddit worker remains disabled unless `REDDIT_DATA_API_APPROVED=true` is set after written approval.

Publish `/privacy` and `/terms` from the deployed service before enabling public installs.

## Adding another platform

Implement a thin adapter that:

1. Authenticates the provider request using the untouched raw body.
2. Acknowledges provider deadlines before waiting for GlassBox.
3. Produces a `VerificationInput` and passes it to `VerificationService.run()`.
4. Uses a provider event ID for idempotency and a tenant/user tuple for rate limiting.
5. Returns `formatTrustCard()` or `formatPlainTrustCard()` output.

This keeps new adapters independent of the selected verifier backend.
