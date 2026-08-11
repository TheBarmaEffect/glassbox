# GlassBox IDE integrations

These integrations send only an explicitly selected editor passage and a question supplied for that one audit to the public, zero-cost GlassBox Lite MCP endpoint.

- `vscode-glassbox/` packages as a VSIX for VS Code and compatible editors.
- `jetbrains-glassbox/` packages as a JetBrains plugin ZIP.

Neither package contains an API key, platform token, telemetry SDK, background scanner, file watcher, or automatic upload path. Both require a non-empty editor selection and an affirmative per-audit confirmation. Results use the privacy-minimized public MCP shape and do not echo the selected text.

See each package's README for local installation and marketplace prerequisites.
