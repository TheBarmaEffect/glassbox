# Deployment and platform setup

## 1. Deploy the gateway

Use the included Dockerfile on Render, Railway, Fly.io, Cloud Run, ECS, or another service that supports a long-running Node 20 container. A Render Blueprint is included in `render.yaml`.
The Blueprint pins this pilot to one instance and uses `/ready` as its traffic health check.

Required for every live audit:

```text
ANTHROPIC_API_KEY
PLATFORM_SHARED_SECRET
PUBLIC_BASE_URL=https://your-domain.example
```

For the first deployment, keep `PLATFORM_ALLOW_PUBLIC=false` and set exact tenant keys such as `api,discord:123456789,slack:t123,telegram:-100123,github:owner/repo,reddit:testsub` in `PILOT_TENANT_ALLOWLIST`. The service fails closed for tenants not listed.

Set a minimum of one warm instance. GlassBox v1 makes several sequential model calls, so a request/response function with a short execution limit is a poor fit. Start with concurrency `1`, a 10-minute job deadline, a per-user limit of `10` audits per 10 minutes, and a global ceiling of `100` accepted audits/day. Keep `PLATFORM_ALLOW_PUBLIC=false` and list exact pilot tenant keys in `PILOT_TENANT_ALLOWLIST`. Raise access, concurrency, or spend only after observing Anthropic latency and cost.

Before platform setup:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:mcp
# After setting ANTHROPIC_API_KEY; this makes a small live API canary call:
npm run smoke:verify
docker build -t glassbox-platform-gateway .
```

Then verify:

```bash
curl https://YOUR_DOMAIN/health
curl https://YOUR_DOMAIN/ready
curl https://YOUR_DOMAIN/privacy
curl https://YOUR_DOMAIN/terms
```

`/ready` verifies that the key is present and the MCP tool is registered; it deliberately does not spend API tokens. Run `npm run smoke:verify` once in the deployment environment to catch a malformed, expired, or revoked Anthropic credential before opening the pilot.

## 2. Telegram — public beta first

1. Create the bot with BotFather and copy its token to `TELEGRAM_BOT_TOKEN`.
2. Generate a random URL-safe `TELEGRAM_WEBHOOK_SECRET`.
3. Set `PUBLIC_BASE_URL`. Before opening its listening socket, the gateway automatically calls Telegram `setWebhook` for `${PUBLIC_BASE_URL}/telegram/webhook` with the configured secret and `allowed_updates=["message"]`. Startup fails with a sanitized error if registration fails; tokens and webhook secrets are never logged. `npm run set-webhook:telegram` remains available as an optional manual check.
4. Set BotFather commands: `start - Privacy and consent information`, `privacy - Privacy information`, and `glassbox - Audit a replied-to AI answer`.
5. Add `https://YOUR_DOMAIN/privacy` as the bot privacy-policy link in BotFather.
6. Keep group privacy mode enabled. The bot only needs commands and replied-to messages.

Usage:

```text
/glassbox --consent Why does ice float? || Ice floats because it is less dense than water.
```

Or reply to an answer with `/glassbox --consent <original question>`. The explicit flag confirms per-audit consent to Anthropic processing.

## 3. Discord — private/user-install beta

1. Create a Discord application.
2. Set its Interactions Endpoint URL to `https://YOUR_DOMAIN/discord/interactions`.
3. Copy Application ID, Public Key, and Bot Token into the matching environment variables.
4. For instant test-guild registration, set `DISCORD_GUILD_ID` and run `npm run register:discord`.
5. Remove `DISCORD_GUILD_ID` and run the command again to register globally.
6. Enable User Install; use scopes `applications.commands` and, only if needed later, `bot`.
7. Add `https://YOUR_DOMAIN/privacy` and `https://YOUR_DOMAIN/terms` in the Discord Developer Portal before sharing the install link.

This adapter uses outgoing HTTPS interactions and does not require a Gateway connection or privileged Message Content intent. Results are ephemeral unless the requester chooses `public:true`.
The adapter enforces a 14-minute delivery deadline, leaving one minute before Discord invalidates the interaction token. Keep the generic job deadline at or below its 10-minute default for the pilot.

## 4. GitHub — public App

Create a GitHub App with:

- Webhook URL: `https://YOUR_DOMAIN/github/webhook`
- Webhook secret: `GITHUB_WEBHOOK_SECRET`
- Repository permission: Issues — Read and write
- Subscribe to: Issue comment
- App ID: `GITHUB_APP_ID`
- Private key: `GITHUB_PRIVATE_KEY` (preserve newlines or use escaped `\\n`)

Make the app public when the installation test passes. A Marketplace listing is optional. When App ID and private-key credentials are configured they always take precedence over `GITHUB_TOKEN`. For a single-repository pilot, leave the App credentials unset and use `GITHUB_TOKEN` as a fallback, but do not use a personal token for broad distribution.

Usage on an issue or PR:

```text
/glassbox
```

This audits the issue/PR description using its title as context. Explicit content is also supported:

```text
/glassbox question || answer || require cited sources
```

## 5. Slack — unlisted pilot

1. Replace `YOUR_DOMAIN` in `manifests/slack-app-manifest.yml`.
2. Create a Slack app from that manifest.
3. Set `SLACK_SIGNING_SECRET` and install the app to one pilot workspace.
4. Set its bot token as `SLACK_BOT_TOKEN`.
5. Test `/glassbox`, `/glassbox --public`, and the **Analyze with GlassBox** message shortcut.

The shortcut opens a modal so the user sees the selected answer and supplies the original prompt before any text is sent for verification. Its result is delivered through Slack's per-interaction `response_url`; the manifest requests only `commands` and deliberately avoids message-history and posting scopes. Slash-command results are private unless `--public` is the first argument.

This is a single-workspace pilot configuration. Public multi-workspace distribution additionally requires OAuth state validation, encrypted per-workspace token storage, app uninstall/data deletion handling, public support pages, and Slack review. Before Marketplace submission, reach Slack's current eligibility threshold of at least 5 active workspaces and 10 weekly active users; allow up to 10 weeks for review. Because GlassBox generates per-message insights, obtain written policy pre-clearance before treating Marketplace approval as a launch path. Do not make Marketplace approval a launch blocker.

## 6. Reddit — allowlisted classic OAuth pilot

Reddit's required long-term route is Devvit. Request app-specific HTTP Fetch approval for the exact hosted GlassBox API hostname; custom API/service domains are reviewable and domain review commonly takes 1–2 business days. The Devvit submission must include its README, privacy policy, terms, complete data-flow description, and the Anthropic subprocess. Public app review commonly takes about one week and every fetch is limited to 30 seconds. Because the current synchronous GlassBox v1 path can take longer, Reddit remains no-go until warm production measurements stay below that limit or Reddit approves an asynchronous architecture.

For the short-term bot pilot:

1. Obtain written Reddit Data API approval covering user-invoked inference and third-party Anthropic processing, then register the script app by Reddit's announced September 30, 2026 API-app registration date. Reddit has said this is not the API shutdown/porting deadline; that date will be announced later.
2. Only after that approval, set `REDDIT_DATA_API_APPROVED=true`. The worker remains disabled and absent from `/health` while this flag is false.
3. Create a dedicated bot account and set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, and `REDDIT_PASSWORD`.
4. Use a descriptive, unique `REDDIT_USER_AGENT`.
5. Get moderator permission and set an explicit `REDDIT_SUBREDDIT_ALLOWLIST`. An empty allowlist disables the worker. Add the same community as `reddit:<subreddit>` in `PILOT_TENANT_ALLOWLIST`.
6. Tell users to reply beneath the content they want audited with `u/YourGlassBoxBot verify`.

The worker uses Reddit's official unread inbox route, processes only explicit `u/<bot-name>` comment mentions, and honors Reddit rate-reset and retry headers with bounded exponential backoff. It does not crawl communities, monitor all comments, vote, send unsolicited messages, or act as a moderator. It marks explicit non-command and non-allowlisted mentions read without responding, while leaving unrelated inbox items untouched.

Treat this as a migration bridge. In parallel, request Devvit approval for the exact gateway domain and build the post/comment menu action after that external architecture is accepted. Any monetized or commercial use needs the applicable Reddit agreement before launch.

## 7. Authenticated universal API

Future Mattermost, Teams, Discourse, or custom integrations can call:

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/verify \
  -H "Authorization: Bearer $PLATFORM_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: platform-event-id" \
  -d '{"platform":"api","question":"...","answer":"...","intents":["..."]}'
```

Do not place the shared secret in a browser or mobile client. Give each new server-side adapter its own secret once the gateway moves from beta to multi-tenant production.

## Production gates

- Replace in-memory rate, spend, delivery, and idempotency state with Redis before public access or multiple gateway replicas. The included controls are intentionally single-instance pilot controls.
- Add OAuth and encrypted tenant-token storage before Slack public distribution.
- Add per-tenant budgets and Anthropic cost alerts.
- Add trace export with an explicit TTL/deletion control only if users request retention.
- Run prompt-injection and unsafe-output tests against the Trust Card pipeline.
- Obtain written marketplace/platform policy clearance where required.
- Confirm the Anthropic API contract and account controls prohibit model training on submitted platform content and satisfy each platform's service-provider restrictions.
- Keep analysis opt-in and never use a Trust Card as an automatic moderation or employment decision.
