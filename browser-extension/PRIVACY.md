# Privacy and data-flow record

1. A person pastes text, or explicitly selects text and invokes the GlassBox context menu.
2. A browser selection is staged only in `storage.session`, bounded to 12,000 characters and two minutes. The audit page consumes and deletes it immediately.
3. The editable audit form does nothing until **Run audit** is pressed.
4. Only the displayed question, answer, and optional requirements are sent over HTTPS to the public GlassBox Lite MCP endpoint.
5. No credentials, page URL, page title, browsing history, tab ID, user identity, cookies, or unrelated page data are sent.
6. The returned fixed-schema audit is validated and rendered as inert text. The extension stores neither input nor output.

The deployed service privacy notice is https://glassbox-platform-gateway.onrender.com/privacy. Render hosts the gateway. The default Lite verifier is deterministic, does not browse or call a paid model API, and does not persist raw submitted content.

The explicit audit text is user-provided/website content transmitted for the requested feature and must be declared that way in browser-store privacy forms. The extension performs no analytics, tracking, advertising, profiling, sale of data, model training, or automated consequential decision-making.
