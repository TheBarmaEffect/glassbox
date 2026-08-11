# GlassBox for Notion

This is a native-ready, zero-license-cost Notion connection for GlassBox Lite. It responds only when a person writes an explicit `/glassbox` comment, fetches only that triggering comment, sends the parsed question/answer/intents to the public GlassBox MCP, and replies in the same Notion discussion.

It is review-ready source code, not a registered or deployed Notion Marketplace connection. No Notion account or Creator dashboard was changed while building it.

## Command

```text
/glassbox question || answer [|| intent one; intent two]
```

The command must be the first token and exactly `/glassbox`. Ordinary comments, embedded mentions, `/glassboxes`, and comments created by bots are ignored. Inputs are capped at 2,000 characters and eight optional intents.

## What it does

1. Notion delivers a signed `comment.created` webhook.
2. The service verifies `X-Notion-Signature` against the exact raw request body.
3. It retrieves only the event's comment and checks for the explicit command.
4. It calls `glassbox_verify_answer` at the public, authentication-free GlassBox MCP.
5. It posts a bounded, mention- and URL-sanitized Trust Card to the same `discussion_id`.

It does not scrape page content, persist comment text or audit inputs, or log request bodies, OAuth codes, access tokens, client secrets, or webhook secrets.

## Local single-workspace setup

Requirements: Node.js 22 or newer and a Notion internal connection with only **Read comments** and **Insert comments** capabilities.

```bash
npm install
cp .env.example .env
npm run check
```

Set `NOTION_ACCESS_TOKEN` in the process environment or a host secret store. Set `NOTION_WORKSPACE_ID` to the workspace ID delivered by Notion webhooks. Expose a public HTTPS URL and set `PUBLIC_BASE_URL`; `.env` is ignored and must never be committed.

Subscribe only to `comment.created` and use:

```text
https://YOUR_HOST/webhooks/notion
```

### One-time webhook verification

Notion's initial subscription payload is intentionally unsigned. Keep the setup window short:

1. Generate a separate high-entropy `SETUP_ADMIN_SECRET`, deploy it, and create the webhook subscription.
2. The endpoint captures the first valid-shaped `verification_token` and refuses replacement until it is retrieved.
3. Retrieve it once over HTTPS with `Authorization: Bearer SETUP_ADMIN_SECRET` from `/admin/notion-webhook-token` and paste it into Notion's **Verify** field.
4. Store it as `NOTION_WEBHOOK_VERIFICATION_TOKEN`, then remove `SETUP_ADMIN_SECRET` and redeploy.

The admin response is `Cache-Control: no-store`. Do not copy tokens into logs, source control, chat, or browser history.

## Public OAuth mode

Create a **public** connection with **Any workspace** distribution in Notion's Creator dashboard. Configure only Read comments and Insert comments, add the redirect URI, and set:

- `NOTION_OAUTH_CLIENT_ID`
- `NOTION_OAUTH_CLIENT_SECRET`
- `NOTION_OAUTH_AUTHORIZATION_URL`
- `NOTION_OAUTH_REDIRECT_URI=https://YOUR_HOST/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` (base64-encoded 32 random bytes)
- `NOTION_TOKEN_STORE_FILE` on a private, durable volume

Generate the encryption key locally with `openssl rand -base64 32`. OAuth access tokens are sealed with AES-256-GCM, written atomically with mode `0600`, and selected by webhook `workspace_id`. Configure exactly one mode: static internal token or public OAuth.

The connection installation URL is `https://YOUR_HOST/oauth/start`. The callback checks a cryptographically random, HttpOnly, SameSite=Lax state cookie before exchanging the code. Production must use HTTPS.

## Reviewer deployment checklist

1. Install with `npm ci`, run `npm run check`, then build with `npm run build`.
2. Provision one Node 22 process, HTTPS termination, and (for OAuth) a private durable directory for `NOTION_TOKEN_STORE_FILE`.
3. Configure secrets from `.env.example` in the host secret manager; never bake them into an image.
4. Start with `npm start`. `GET /health` must report `ok: true`, API version `2026-03-11`, and whether OAuth is enabled.
5. In Notion, select only Read comments and Insert comments, use `comment.created`, complete the one-time verification flow above, and share a test page with the connection.
6. Add an ordinary comment and confirm no reply. Then add `/glassbox What is 17 * 6? || 102` and confirm exactly one reply in the same discussion.
7. Redeliver the same event ID and confirm it is treated as a duplicate while the process remains running. Confirm logs contain no comment text, authorization values, bodies, or OAuth codes.
8. For public review, test installation and removal in a separate reviewer workspace and document token-deletion and incident-response procedures before submitting the Marketplace listing.

The runtime exposes no general-purpose proxy or page-content endpoint. Its application routes are `/health`, `/oauth/start`, `/oauth/callback`, `/webhooks/notion`, and the temporary protected `/admin/notion-webhook-token` setup route.

## Zero-cost boundary and launch blockers

The software, Node runtime, Notion API, and public GlassBox Lite MCP require no paid model API key. That does not make a public multi-workspace deployment completely infrastructure-free:

- A Creator dashboard owner must create the connection, choose immutable **Any workspace** distribution, configure capabilities and webhook, supply listing artwork/category/legal links, and submit Notion's security/Marketplace review. Review is Notion-controlled and cannot be automated or bypassed.
- Public OAuth requires Notion-issued client credentials and a public HTTPS callback/webhook host.
- Notion access tokens must survive restarts. This package supplies an encrypted single-process file store, but the operator must provide a durable private volume, backups, and encryption-key recovery. An ephemeral free host can lose every installation. No zero-cost managed database is claimed.
- Webhook deduplication is in memory for 24 hours. It prevents ordinary retries in one process, not duplicate replies after a restart or across replicas. A public multi-instance deployment needs a durable transactional ledger/queue.
- Hosting providers can change free-tier terms, sleep instances, or charge for durable storage and bandwidth. No provider-specific zero-cost guarantee is made.

The strongest genuinely zero-cost launch is an internal, single-workspace connection on an already available HTTPS host. Marketplace availability additionally requires durable token storage and Notion review.

## Validation

```bash
npm run check
npm audit --omit=dev
```

The suite covers exact raw-body HMAC verification, explicit-command gating, bot suppression, same-discussion replies, OAuth exchange headers, API version headers, token encryption at rest, one-time webhook-token capture, and retry deduplication.

## Official Notion references

- [Authentication and API version](https://developers.notion.com/reference/authentication)
- [Authorization and OAuth](https://developers.notion.com/guides/get-started/authorization)
- [Public connection distribution](https://developers.notion.com/guides/get-started/public-connections)
- [Webhook verification and HMAC](https://developers.notion.com/reference/webhooks)
- [Webhook event delivery](https://developers.notion.com/reference/webhooks-events-delivery)
- [`comment.created` event](https://developers.notion.com/reference/webhooks/comment-created)
- [Working with comments](https://developers.notion.com/guides/data-apis/working-with-comments)
- [Connection capabilities](https://developers.notion.com/reference/capabilities)
- [Marketplace listing and review](https://developers.notion.com/guides/get-started/marketplace-listing)
- [Handling API keys](https://developers.notion.com/guides/get-started/handling-api-keys)
- [2026-03-11 upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)

## Service policies

- [GlassBox privacy](https://glassbox-platform-gateway.onrender.com/privacy)
- [GlassBox terms](https://glassbox-platform-gateway.onrender.com/terms)
- [GlassBox support and security](https://glassbox-platform-gateway.onrender.com/support)

See [SECURITY.md](./SECURITY.md) for the deployment threat model and incident guidance.

Licensed under the repository's [Apache License 2.0](../LICENSE).
