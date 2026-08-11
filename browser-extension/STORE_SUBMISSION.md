# Zero-cost distribution and review blockers

## Free immediately

- **Source/GitHub Releases:** publish the Chromium ZIP, Firefox source package, checksums, privacy record, and tagged source at no store cost. Chrome/Edge users must enable developer mode and load the unpacked directory. Stable Firefox will not install an unsigned XPI.
- **Firefox AMO:** Mozilla requires an addons.mozilla.org developer account and signing even for self-distribution. A listed public add-on can receive automatic updates; an unlisted signed add-on can be hosted elsewhere. Automated validation and possible human review apply. Provide the source package and reviewer instructions. The Firefox manifest truthfully declares required `websiteContent` transmission because selected/pasted text leaves the browser for the requested audit; Firefox 142+ presents the built-in consent prompt. Submit for desktop only until Android UI testing is complete.
- **Microsoft Edge Add-ons:** Microsoft states there is no registration fee. An individual can enroll with a personal Microsoft account (or linked personal GitHub account) in Partner Center. Account verification, store metadata, privacy URL, package validation, and certification are required; Microsoft says certification can take up to seven business days.

## Not zero-cost

- **Chrome Web Store:** Google requires a Chrome Web Store developer account and a one-time registration fee before publishing. The current official registration documentation does not state the amount; use the amount shown in Google's registration flow rather than assuming a historical price. Because the operator has required a zero-spend launch, Chrome Web Store publication is blocked unless that fee was already paid on an existing account.

## Review-ready declarations

- Single purpose: on-demand deterministic reasoning audits for explicitly pasted or selected text.
- Remote service: `https://glassbox-platform-gateway.onrender.com/mcp`.
- Data: question, answer, and optional requirements only after the person presses **Run audit**.
- No unrelated collection by the extension: no analytics, identifiers, browsing history, tabs, URLs, cookies, authentication, or persistent storage.
- Transmitted data: explicit audit text goes to the operator's Render-hosted GlassBox service; declare user-provided/website content in every store privacy form even though the extension does not retain it.
- Permissions: `contextMenus`, `storage.session`, and the single GlassBox hostname. Reviewer can exercise all functionality without an account or API key.
- No remote code, `eval`, obfuscated source, ads, purchases, or hidden features.

## Remaining human/account blockers

1. Choose the public publisher identity truthfully as Karthik Barma, individual developer; Aura is an unregistered brand, not a company.
2. Create/verify an AMO developer account and submit for signing/review.
3. Create/verify a personal Microsoft Partner Center Edge developer account and submit the Chromium ZIP.
4. Supply store screenshots, localized listing copy, support contact, and the live privacy URL.
5. Run real-browser canaries in current Chrome, Edge, Firefox desktop, and a cold-started Render service before submitting.
6. Chrome Web Store remains fee-blocked unless an already-paid developer account exists.

Official references:

- Chrome registration: https://developer.chrome.com/docs/webstore/register/
- Firefox signing/distribution: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Firefox submission: https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- Firefox policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Edge registration: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account
- Edge publishing: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
