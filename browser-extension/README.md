# GlassBox Lite browser extension

This isolated Manifest V3 WebExtension audits only a question and answer that the person explicitly enters, or text they explicitly select before choosing **Audit selected text with GlassBox**. The selection opens an editable audit page and is never submitted automatically. The extension has no content script, page-monitoring permission, API key, telemetry, account, or persistent data store.

It calls the public zero-cost Streamable HTTP MCP endpoint:

`https://glassbox-platform-gateway.onrender.com/mcp`

The background worker invokes only `glassbox_verify_answer`. It sends `credentials: omit`, rejects redirects, enforces the gateway's input limits, caps response size, validates the exact privacy-minimized result schema, strips control/bidirectional formatting characters, and passes data to a UI that renders with `textContent` only.

## Install locally

Run:

```sh
npm test
npm run build
```

Chromium/Chrome/Edge developer mode:

1. Open the browser's extensions page and enable Developer mode.
2. Choose **Load unpacked**.
3. Select `dist/chromium`.

Firefox 142+ temporary desktop development install:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json`.

Build outputs:

- `dist/glassbox-lite-chromium-0.1.0.zip` — Chrome Web Store and Edge Add-ons upload package.
- `dist/glassbox-lite-firefox-0.1.0.xpi` — AMO submission package. Firefox release/beta requires Mozilla signing; the locally built XPI is intentionally unsigned.
- `dist/SHA256SUMS` — reproducibility/integrity record.

## Permissions

- `contextMenus`: exposes the explicit selection action.
- `storage`: uses browser `storage.session` for a selected-text handoff, removes it on first read, and never uses persistent local/sync storage.
- Host access only to `https://glassbox-platform-gateway.onrender.com/*`: permits the background worker to call the public MCP endpoint.

Firefox 142+ also shows Mozilla's built-in `websiteContent` transmission consent across supported validation targets. Mozilla uses that category for any visible page text sent outside the add-on, including a selection the person explicitly chooses to audit. This is a transmission disclosure, not a claim that GlassBox monitors pages or persists content. The packaged UI is presently validated for desktop submission only.

No `tabs`, `activeTab`, `scripting`, browsing-history, cookie, clipboard-read, or all-sites permission is requested.

See [PRIVACY.md](PRIVACY.md) and [STORE_SUBMISSION.md](STORE_SUBMISSION.md).
