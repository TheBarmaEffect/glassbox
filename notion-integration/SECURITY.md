# Security

## Secrets and data

- Put Notion tokens, OAuth credentials, webhook verification tokens, setup secrets, and the AES key only in the deployment host's secret manager.
- Never send them to GlassBox. The public MCP receives only the parsed question, answer, and optional intents from an explicit `/glassbox` comment.
- The application deliberately avoids logging headers, bodies, OAuth codes, tokens, command text, and caught error details.
- OAuth tokens are AES-256-GCM encrypted at rest. Keep `TOKEN_ENCRYPTION_KEY` separate from the durable token-store file and maintain a secure recovery copy.

## Webhooks

Notion's setup payload is unsigned; after verification, every event must have a valid `X-Notion-Signature` over the exact raw body. Enable `SETUP_ADMIN_SECRET` only for the short verification window, retrieve the captured token once over HTTPS, then disable setup mode. A malicious sender can deny service during an open unsigned setup window, so do not leave it enabled.

Use one application instance unless webhook event IDs are moved to a durable transactional store. The included in-memory ledger is not exactly-once across restarts or replicas.

## Rotation and response

If a secret may be exposed, disable the connection or webhook in Notion, rotate the affected secret and AES key as appropriate, invalidate stored installations, and redeploy. Do not paste suspected values into an issue. Report vulnerabilities through the operator's private security contact or the [GlassBox support page](https://glassbox-platform-gateway.onrender.com/support).

The operator must also follow Notion's current security-review, data-handling, deletion, and incident-notification requirements before a public Marketplace launch.
