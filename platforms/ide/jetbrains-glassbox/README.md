# GlassBox Lite for JetBrains IDEs

This free plugin adds **Audit Selected Text with GlassBox** to the editor context and Tools menus.

## Use

1. Select an answer in the editor (maximum 12,000 characters).
2. Choose **Audit Selected Text with GlassBox**.
3. Supply the original question and approve the one-audit disclosure.
4. Review the privacy-minimized result. The selected text is not repeated in the result.

The plugin calls only `https://glassbox-platform-gateway.onrender.com/mcp`. It contains no API key, telemetry SDK, file watcher, automatic scan, or background upload. The service processes the selected content transiently on Render and does not persist raw questions or answers. GlassBox Lite is a deterministic structural audit, not a web fact-check, source authenticator, truth guarantee, or professional advice.

## Build and install locally

JDK 21 is required.

```sh
./gradlew test verifyPluginStructure buildPlugin
```

Install `build/distributions/glassbox-lite-0.1.0.zip` from **Settings → Plugins → gear icon → Install Plugin from Disk**. Version 0.1.0 intentionally declares compatibility with the verified 2024.3 (`243.*`) platform branch; widen only after running Plugin Verifier against each additional target.

## Public distribution blockers

JetBrains Marketplace distribution is free, but an external manual submission is required:

- Sign in with a JetBrains Account, accept the Marketplace Developer Agreement, create a truthful individual Vendor profile for Karthik Barma, and declare EEA trader/non-trader status.
- Provide the Developer EULA/license, source URL, live vendor website/email, and privacy policy.
- Upload the plugin ZIP (maximum 400 MB) and complete compatibility verification. Every new plugin and every version is automatically checked and manually reviewed; JetBrains does not guarantee review time and recommends contacting Marketplace support after 3–4 working days without an update.
- Marketplace signing is supported and recommended but requires external certificate/private-key material; no signing secret belongs in this repository.

The plugin name is below 30 characters, does not contain “Plugin,” “IntelliJ,” a JetBrains product name, or pricing language, and includes the required distinct 40×40 SVG icon.

Source, privacy, support, and Apache-2.0 license: https://github.com/TheBarmaEffect/glassbox · https://glassbox-platform-gateway.onrender.com/privacy · https://glassbox-platform-gateway.onrender.com/support · https://github.com/TheBarmaEffect/glassbox/blob/main/LICENSE
