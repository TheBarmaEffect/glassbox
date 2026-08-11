# GlassBox Audit for Reddit

GlassBox Audit adds an **Audit with GlassBox** action to the three-dot menu on Reddit posts and comments. A redditor explicitly confirms each audit before the selected text is sent over HTTPS to the deployed GlassBox Lite gateway. The app then shows a transient Trust Card inside Reddit; it does not publish a comment, alter the selected content, or retain the text or result.

GlassBox Lite is deterministic and has no paid model dependency. It checks reasoning structure, unsupported certainty, internal contradictions, citation signals, simple arithmetic, and prompt-injection language. It does not browse the web, authenticate sources, establish factual truth, make moderation decisions, or provide professional advice.

## User flow

1. Open the three-dot menu on a post or comment and choose **Audit with GlassBox**.
2. Read the processing notice and check the one-audit consent box.
3. Choose **Send and audit**.
4. Review or copy the transient Trust Card, then close it.

No background monitoring, comment trigger, subreddit crawl, vote, removal, message, or public post/comment is used.

## Data flow and retention

- Submitted: the selected post title and up to 12,000 characters of the selected post/comment body, plus a fixed audit instruction.
- Not submitted: Reddit username, user ID, subreddit name/ID, author, permalink, votes, moderation state, or unrelated content.
- Transport: server-side HTTPS from Reddit's Devvit runtime to `glassbox-platform-gateway.onrender.com`.
- Gateway processing: the default deterministic GlassBox Lite backend, in process memory only.
- Gateway retention: no database/file persistence of selected text or Trust Cards. An opaque idempotency event ID may remain in gateway memory for up to 24 hours; rate-control metadata has shorter in-memory TTLs.
- Devvit retention: none. This package does not enable Redis, write files, post results, or log submitted content/Trust Cards.
- Third parties: no paid model provider and no downstream model call. Render hosts the gateway; Reddit hosts the Devvit app.

Privacy: <https://glassbox-platform-gateway.onrender.com/privacy>  
Terms: <https://glassbox-platform-gateway.onrender.com/terms>  
Support and data-rights contact: <thebarmaeffect@gmail.com>

## Local checks

Use the Node version in `.nvmrc`, then:

```bash
npm install
npm run check
```

`npm run check` type-checks, lints, unit-tests, and builds the CommonJS Devvit server bundle. Tests verify input limits, secret placement, status-safe errors, Trust Card validation, and output neutralization.

## Playtest and launch

The following steps make external account/app changes and therefore must be run by an authorized Reddit account owner:

```bash
npm run login
npm run dev
```

Devvit creates/uses a playtest subreddit. In a separate terminal, set the gateway credential using Reddit's encrypted global secret store:

```bash
npx devvit settings set glassboxGatewaySecret
```

Paste the value of the gateway's `PLATFORM_SHARED_SECRET` only into the CLI secret prompt. Never place it in source, `.env`, screenshots, issue text, Reddit settings visible to moderators, or chat.

Test on Reddit web, iOS, and Android from developer, moderator, and regular-user accounts. Verify both post and comment actions, cancellation, overlong content, a free-host cold start/retry, rate limiting, and gateway downtime. Then submit:

```bash
npm run publish
```

This runs all local checks before `devvit publish --public`. Publishing requests Reddit App Review; it does not bypass review.

## Required Reddit review items

The app requests only:

- Reddit read access within the installed subreddit, to read the single user-selected post/comment.
- Server-side HTTP Fetch to the exact hostname `glassbox-platform-gateway.onrender.com`.
- One developer-managed global secret named `glassboxGatewaySecret`.

The HTTP domain request is submitted during playtest/upload. Fetch-enabled apps require Reddit approval, a privacy policy, and terms. Add the live privacy and terms URLs above in the Developer Portal App Details page before publishing. The app does not use classic Reddit OAuth/Data API credentials, user-action permissions, Redis, triggers, scheduler, payments, media, realtime, external endpoints, or LLM capabilities.

The Render free service may sleep. Devvit HTTP requests have a 30-second platform timeout; this app aborts the gateway call at 25 seconds and asks the user to retry once if the service is waking.

## Uninstall and deletion

Uninstalling the app stops the menu action immediately. Because the app stores no content or Trust Cards and publishes no Reddit content, it has no app database records to delete. The gateway likewise does not persist submitted content. Contact support with the app installation and approximate time for an incident inquiry; do not email the confidential content itself.

