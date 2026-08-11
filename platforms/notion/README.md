# GlassBox for Notion

GlassBox Lite is available in Notion today as a zero-secret embedded web app. This deliberately narrow integration does not request access to a workspace, read pages, monitor comments, or store Notion OAuth tokens.

## Add it to a Notion page

1. Open the Notion page where you want the audit panel.
2. Type `/embed` and choose **Embed**.
3. Paste:

   ```text
   https://glassbox-platform-gateway.onrender.com/app
   ```

4. Select **Embed link** and resize the panel.
5. Paste only the question and answer you explicitly want GlassBox to audit.

The same page is an installable Progressive Web App in supported browsers.

## Privacy boundary

- The embed cannot read the surrounding Notion page.
- It receives only text the user pastes into its own fields.
- It calls the public, privacy-minimized GlassBox MCP tool on the same origin.
- GlassBox Lite uses no paid model API and performs no web lookup.
- Submitted text is processed transiently on the Render-hosted gateway and is not persisted by GlassBox.
- Notion and infrastructure providers may retain their own platform/network records.

## Native Notion connection status

A native multi-workspace Notion connection is a separate future surface. Notion requires a registered public OAuth connection, per-user workspace authorization, secure refresh-token storage, webhook verification, and a security review before Marketplace discovery. The embeddable app avoids requesting those permissions while giving users an immediately usable Notion experience.

Official Notion references:

- [Public connections](https://developers.notion.com/guides/get-started/public-connections)
- [Authorization](https://developers.notion.com/guides/get-started/authorization)
- [Marketplace listing](https://developers.notion.com/guides/get-started/marketplace-listing)
