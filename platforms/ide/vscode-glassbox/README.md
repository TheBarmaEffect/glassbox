# GlassBox Lite for VS Code

Audit an explicitly selected answer for structural reasoning problems without embedding a paid API key.

## Use

1. Select the answer text in an editor (maximum 12,000 characters).
2. Run **GlassBox: Audit Selected Text** from the context menu or Command Palette.
3. Enter the original question, review the one-audit disclosure, and choose **Audit once**.
4. Read the privacy-minimized result in the **GlassBox Lite** output channel.

The extension sends only the selected text and supplied question to `https://glassbox-platform-gateway.onrender.com/mcp`. It contains no API key, telemetry, automatic file scanning, or background upload. The service processes content transiently on Render and does not persist raw questions or answers. GlassBox Lite performs deterministic structural checks; it is not a web fact-check, source authenticator, truth guarantee, or professional advice.

The endpoint setting accepts HTTPS URLs, plus HTTP localhost for development. Credentials embedded in URLs are rejected and the extension never sends an `Authorization` header.

## Local package

```sh
npm ci
npm test
npm run package
code --install-extension dist/glassbox-lite-0.1.0.vsix
```

## Public distribution blockers

- Visual Studio Marketplace: reserve/verify the immutable `thebarmaeffect` publisher ID using the individual developer's Microsoft/Azure DevOps account, then upload the VSIX or publish with current `vsce` authentication. If that publisher ID is unavailable, update `publisher` before the first release because it is part of the permanent extension ID.
- Open VSX: sign in, accept the Publisher Agreement, obtain a token, and claim/create the matching namespace before publishing the same VSIX with `ovsx`. Namespace ownership is reviewed when it is not already associated with the account.

Both registries are free distribution paths; their accounts, agreements, namespace/publisher reservation, and any registry review remain external manual steps.

Source, privacy, and support: https://github.com/TheBarmaEffect/glassbox · https://glassbox-platform-gateway.onrender.com/privacy · https://glassbox-platform-gateway.onrender.com/support
