# GlassBox Platform Gateway

One deployable Node 20 service that brings the published GlassBox v1 Trust Card pipeline to:

- Discord: `/glassbox` and **Analyze with GlassBox** message command
- Slack: `/glassbox` and **Analyze with GlassBox** message shortcut + review modal
- Telegram: `/glassbox --consent` on a replied-to message or explicit question/answer
- GitHub: `/glassbox` issue or pull-request comments
- Reddit: disabled-by-default classic bridge for explicitly approved Data API pilots; Devvit is the primary path
- Any approved platform: authenticated `POST /api/v1/verify`

The gateway wraps `@glassbox-framework/mcp@1.0.3`, keeps one warm MCP child process, limits Anthropic concurrency, and produces compact platform-native Trust Cards. It does not monitor conversations or persist raw question/answer content.

## Quick start

```bash
cd platforms
cp .env.example .env
# Fill ANTHROPIC_API_KEY and PLATFORM_SHARED_SECRET first.
npm install
npm test
npm run build
npm start
```

Check `http://localhost:8080/health` for liveness and `/ready` for MCP/API-key readiness. Only adapters whose complete credentials are present appear in the `platforms` list.

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
Discord / Slack / Telegram / GitHub / Reddit / API
                         |
         signature verification + input caps
                         |
   tenant admission + idempotency + requester limit
                         |
  daily spend breaker + bounded queue (concurrency 1)
                         |
       persistent GlassBox MCP child (stdio)
                         |
             compact Trust Card formatter
```

No platform user ID, server/workspace name, subreddit, repository name, or URL is sent to GlassBox. Only the explicitly submitted question, answer, and optional intents cross the MCP boundary.

The default is a closed pilot. `PILOT_TENANT_ALLOWLIST` accepts exact lowercase keys: `api`, `discord:<guild-id>` (or `discord:user:<user-id>`), `slack:<team-id>`, `telegram:<chat-id>`, `github:<owner/repo>`, and `reddit:<subreddit>`. Setting `PLATFORM_ALLOW_PUBLIC=true` bypasses this gate and should happen only after platform approval, multi-tenant controls, and spend monitoring are ready.

## Platform launch order

1. Telegram public bot and Discord user-install test: fastest feedback and no marketplace dependency.
2. GitHub public App: direct installs work without a Marketplace listing.
3. Slack single-workspace pilot: validate the interaction first, then add OAuth/token storage and grow to the current Marketplace eligibility threshold (5 active workspaces and 10 weekly active users).
4. Reddit Devvit review: request the exact GlassBox API domain and build the menu action. Enable the classic bridge only if Reddit separately approves that exact Data API and Anthropic-processing use case.
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
- The v1 verifier sends submitted text to Anthropic using the deployer's API key. This must be disclosed to pilot users.
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

This keeps new adapters independent of the MCP implementation and leaves a clean path to swap in the local deterministic v0.3 backend if that source is restored.
