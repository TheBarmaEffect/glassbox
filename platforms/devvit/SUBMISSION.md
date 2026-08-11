# Reddit App Review submission notes

## Short description

GlassBox Audit is a user-invoked reasoning aid for Reddit posts and comments. It sends only the selected content to a deterministic, zero-cost reasoning checker and privately displays a transient Trust Card. It never monitors communities, posts comments, makes moderation decisions, or uses a paid AI/LLM API.

## Exact HTTP Fetch justification

**Requested hostname:** `glassbox-platform-gateway.onrender.com`

The Devvit server sends one `POST /api/v1/verify` request only after a redditor opens the menu action and explicitly consents. The request contains the selected post title, up to 12,000 characters from the selected post/comment, a fixed reasoning-audit instruction, and an opaque idempotency ID. A bearer credential is read from Devvit's encrypted developer-only global secret store and sent only in the server-side Authorization header. No client/browser code can access the secret. The response is a deterministic Trust Card; the app displays a sanitized summary in a transient form and stores nothing.

The hostname also serves the public privacy notice and terms. The audit endpoint is a public HTTPS server-to-server API, not an AI/LLM provider, account-linking service, database, asset host, or external app experience. The deployed `GLASSBOX_BACKEND=lite` implementation does not browse, make a downstream network request, or call a model provider. It needs no paid API. A shared, versioned API keeps GlassBox's deterministic analysis and Trust Card contract consistent across Reddit and the other supported platforms; the Reddit-only Devvit server cannot provide that cross-platform execution surface by itself.

The README contains Reddit's required `## Fetch Domains` section with this exact hostname and justification.

## Permissions justification

- `permissions.reddit: true`: read the one post/comment chosen from the menu in the current app installation.
- `permissions.http.domains`: call the exact GlassBox gateway hostname over HTTPS.
- Global secret: keep the gateway bearer credential encrypted and developer-managed.

No classic Data API, Reddit OAuth client, user-action permission, posting/commenting, moderation write, triggers, scheduler, app-data Redis calls, payments, media, realtime, or external endpoint access is requested. Devvit automatically enables its Redis-backed form-submit grant mechanism for menu forms; this package never writes selected content or Trust Cards to Redis.

## Safety and privacy test evidence expected before submission

- Post and comment content never appears in logs.
- The bearer secret is absent from source, build output, request body, error messages, and Trust Card UI.
- Cancel/no-consent paths do not read or transmit selected content.
- Output excludes claim/evidence excerpts and neutralizes mention/link-like dynamic text.
- Cross-install content is rejected by Reddit's scoped API/context.
- Gateway 401/403/429/503/504 and the 25-second timeout return generic, actionable UI messages.
- The app performs no explicit persistence; selected content and results are absent from app-owned storage after the transient form closes.

## Reviewer links

- Privacy: <https://glassbox-platform-gateway.onrender.com/privacy>
- Terms: <https://glassbox-platform-gateway.onrender.com/terms>
- Gateway readiness: <https://glassbox-platform-gateway.onrender.com/ready>
- Support: <mailto:thebarmaeffect@gmail.com>

## Developer Portal checklist

Before the authorized owner runs `devvit publish --public`, confirm that App Details contains:

- a plain-language description and appropriate categories;
- <https://glassbox-platform-gateway.onrender.com/privacy> as the Privacy Policy;
- <https://glassbox-platform-gateway.onrender.com/terms> as the Terms and Conditions; and
- the 1024x1024 app icon declared by `marketingAssets.icon`.

The exact Fetch domain must show **Approved** in Developer Settings. A pending domain request is not a code failure and is reviewed separately by Reddit.
