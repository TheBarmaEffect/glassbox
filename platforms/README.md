# GlassBox Platform Gateway

One deployable Node 20 service that brings the published GlassBox v1 Trust Card pipeline to:

- Discord: `/glassbox` and **Analyze with GlassBox** message command
- Slack: `/glassbox` and **Analyze with GlassBox** message shortcut + review modal
- Telegram: `/glassbox --consent` on a replied-to message or explicit question/answer
- GitHub: `/glassbox` issue or pull-request comments
- GitHub Marketplace: isolated free-plan purchase/cancellation webhook and credential-gated Setup OAuth flow
- Reddit: disabled-by-default classic bridge for explicitly approved Data API pilots; Devvit is the primary path
- ChatGPT and Claude: public MCP Streamable HTTP at `/mcp`
- Web browsers and Notion: installable/embeddable zero-secret app at `/app`
- Any approved platform: authenticated advisory `POST /api/v1/verify` or blocking gate `POST /api/v1/govern`

## What this gateway is, against the four assurance capabilities

Stated first because the wording matters and the project's other documentation used to get
it wrong. This service is a **governor**, not only an observer.

| Capability | Status | What that means here |
|---|---|---|
| Detection | ✅ | 14 deterministic answer probes (13 currently live — see *deployment skew* below) and 6 tool-invocation probes, at five named checkpoints |
| **Prevention** | ✅ **deployed** | `POST /api/v1/govern` is a synchronous release gate. It **withholds** output. |
| Remediation | ❌ not built | The gate can refuse to release an answer. It cannot rewrite, regenerate or repair one. |
| Human escalation | ⚠️ **signalled, not operated** | `escalate` returns 409 with `next_step: "human_review"`. There is no escalation queue, no reviewer identity, no decision record. |

The precise sentence is *escalation signalling is implemented; an escalation queue is not.*

"Deterministic" here means the **Lite backend**: byte-identical output for identical input,
no clock read, no network, no model. It is **not** a property of the optional `anthropic`
backend, which reintroduces model inference under the operator's own key.

No conformity assessment under any AI regulation has been performed. This service is not a
notified body or a conformity assessment body and produces no presumption of conformity for
any party.

The gateway uses the deterministic GlassBox Lite verifier by default and produces compact platform-native Trust Cards without a paid model API, API key, or network lookup. It does not monitor conversations or persist raw question/answer content. The published `@glassbox-framework/mcp@1.0.3`/Anthropic verifier remains an explicit opt-in backend for operators who provide their own key.

GlassBox is a product developed under Aura, an unregistered umbrella brand. Aura is not a company or legal entity. The platform service is operated by Karthik Barma as an individual developer, charges no fee, accepts no payment, and sells nothing. `TheBarmaEffect` is retained in repository URLs and the support address as an account/contact identifier, not as a company name.

## Quick start

```bash
cd platforms
cp .env.example .env
# Keep GLASSBOX_BACKEND=lite. Set PLATFORM_SHARED_SECRET for the universal API.
npm install
npm test
npm run build
npm start
```

Check `http://localhost:8080/health` for liveness and `/ready` for selected-verifier readiness. Lite is ready without an external API key. Only adapters whose complete credentials are present appear in the `platforms` list.

When Telegram credentials are configured, startup registers `${PUBLIC_BASE_URL}/telegram/webhook` before the gateway begins listening. If registration fails, Telegram is disabled for that process while the core gateway and other adapters remain healthy; tokens and webhook secrets are never logged.

Run the container:

```bash
docker build -t glassbox-platform-gateway .
docker run --rm -p 8080:8080 --env-file .env glassbox-platform-gateway
```

## Universal interaction model

Every platform sends the same three pieces to GlassBox:

```text
question || answer || optional intent 1; optional intent 2
```

The native reply/context-menu flows pre-fill the answer. Analysis is always user-invoked. Discord and Slack results are private by default. Discord supports an explicit public result; Slack publishes only when `--public` is the first command argument. Telegram requires `--consent` as the first argument for every audit.

The authenticated API also accepts a named runtime `checkpoint`, a versioned `constitution`,
and a `response_policy`. Deterministic rules can require or forbid a phrase, require a citation
marker, forbid absolute-certainty language, or allow or forbid an exact tool target. The policy maps each verdict to `allow`, `record`,
`block`, `retry`, or `escalate`. The advisory `/verify` response records the selected action but
sets `executed` to false because its caller remains responsible for enforcement.

`POST /api/v1/govern` runs the same audit as `/api/v1/verify` and adds a synchronous release
gate. Exact behaviour, from `src/api.ts`:

| Action | HTTP | `gate.effect` | `gate.next_step` | Trust Card |
|---|---|---|---|---|
| `allow` | 200 | `released` | `null` | `executed: true` |
| `record` | 200 | `released_with_record` | `null` | `executed: true` |
| `block` | **422** | `withheld` | `null` | `executed: true` |
| `retry` | **409** | `withheld` | `"retry"` | `executed: true` |
| `escalate` | **409** | `withheld` | `"human_review"` | `executed: true` |

Every gated response carries `enforced_by_gateway: true`. The advisory `/api/v1/verify`
always returns 200 and leaves `executed` at `false`, because on that surface the caller
enforces. The two surfaces are counted under separate `surface` labels in
`/api/v1/metrics`, so an advisory call can never be reported as an enforcement.

The gateway does not claim to regenerate an answer or operate a human-review queue; callers
handle those explicit next steps. It **withholds authorization** — it does not execute,
intercept, or block a call that a caller chooses to make anyway.

## Architecture

```text
Discord / Slack / Telegram / GitHub / Reddit / ChatGPT / Claude / API
                         |
         signature verification + input caps
                         |
   tenant admission + idempotency + requester limit
                         |
   daily volume breaker + bounded queue (concurrency 1)
                         |
 deterministic Lite verifier (default, no network)   src/lite.ts
   ├── answer probes                                 src/lite.ts, src/signals.ts
   ├── offline citation screening                    src/citation.ts
   ├── tool-invocation assurance                     src/toolcall.ts
   └── constitution rule evaluation                  src/lite.ts
       or explicit MCP/Anthropic opt-in
                         |
   content-free event counters                       src/metrics.ts
                         |
    advisory card  |  synchronous release gate       src/api.ts
                         |
             compact Trust Card formatter            src/formatter.ts
```

### Verifier modules

| Module | Wired? | What it does |
|---|---|---|
| `src/lite.ts` | ✅ | The deterministic verifier. Claim segmentation, allowlisted arithmetic, lexical contradiction, certainty and specificity vocabularies, relevance, injection and credential signals, fact-check scope, constitution rules. |
| `src/signals.ts` | ✅ | The shared detection primitives — credential formats, dangerous execution patterns, injection signatures. Shared **on purpose**, so answer scanning and tool-argument scanning cannot drift apart and silently stop covering one surface. |
| `src/citation.ts` | ✅ | Offline citation screening. See below. |
| `src/toolcall.ts` | ✅ | Tool-invocation assurance. See below. |
| `src/metrics.ts` | ✅ | Content-free aggregate counters. See below. |
| `src/canonical.ts` | ✅ | Canonical JSON and digests. Underpins determinism. |
| `src/trajectory.ts` | ❌ **not wired** | Append-only tamper-evident record chain: Merkle tree, RFC 6962 domain-separated leaf/interior hashing, per-record inclusion proofs, signed tree head, resume-from-hashes. Implemented and tested; reachable from **no endpoint**. The `POST /api/v1/trajectory/replay` and `GET /api/v1/trajectory/pubkey` routes its own header describes **do not exist**. |
| `src/attribution.ts` | ❌ **not wired, deliberately** | Computed attribution grounding — whether a "research shows"-style attribution carries a locatable support span. Held back because GBSA-1's held-out split is spent for the probes it would refine, so no recall figure for it could be quoted honestly. GBSA-2 does not yet carry an attribution stratum. |

### Tool-invocation assurance — `src/toolcall.ts`

Runs at the `tool_call` and `agent_step` checkpoints, **before the caller executes the
call**, and is declared at `/api/v1/capabilities` under `tool_invocation_probes` and
`tool_assurance`.

Six probes: `tool_capability`, `tool_declaration_drift`, `tool_description_injection`,
`tool_argument_injection`, `tool_argument_credential`, `tool_argument_dangerous`.

- **Declaration pinning covers the description, not only the JSON Schema.** The published
  pin is over `["name", "description", "input_schema"]`. An MCP re-publication attack ships
  a byte-identical schema and a description that now instructs the calling agent to read a
  private key and pass it as context. The description is what the agent reads, so a
  schema-only defence does not see the attack at all.
- **Drift is attributed by component.** A description change on an unchanged schema is
  `critical` — the attack shape. A schema-only revision is `high` — an ordinary version
  bump. Without the distinction, pinning alarms on every legitimate release and gets
  switched off.
- **Capability scope.** `allowed_tools`, when supplied, refuses any tool absent from it even
  when the answer is otherwise clean. Omitting the field declares "no capability scope".
- **Argument scanning** reuses `src/signals.ts`: a credential in a tool argument is the same
  credential, and `curl | sh` is the same command.

Limits, also in the served `limitations[]`: pinning cannot detect a behaviour change that
leaves the published declaration unchanged; **the caller supplies and stores the pin** and
the gateway retains none between requests; and the gateway records the caller's declaration
rather than independently verifying it.

### Offline citation screening — `src/citation.ts`

Wired as the `citation_resolvability` probe. Decides a subset of citation fabrication with
**no network, no reference corpus, no model and no clock read**.

- **Check digits**: ISBN-10 (ISO 2108, weighted mod 11), ISBN-13 (EAN-13, alternating mod
  10), ISSN (ISO 3297, mod 11), ORCID (ISO/IEC 7064 MOD 11-2). Both `X` forms handled.
- **Permanently closed ranges**: the arXiv digit-width/date coupling — 4-digit sequences
  valid only for `YYMM` 0704–1412, 5-digit only from 1501, nothing before the 2007-04
  epoch. The horizon is a fixed constant, not `new Date()`, so the result never depends on
  the wall clock.
- **Structural grammars** for DOI, PMID, PMCID, RFC and URL forms, reported as *weaker*
  evidence than a checksum failure because no check digit was available.

**The wording is part of the mechanism.** A finding says *the identifier fails its own check
digit*, never *the citation is fabricated*: a transposed digit and an OCR error produce the
same failure, and arithmetic cannot separate mistranscription from invention.

**False-positive freedom is proved, not observed.** 18,000 valid identifiers were generated
across nine schemes — with each check character computed by a *second, independently
transcribed* implementation of the standard, so the corpus is not valid by definition — and
**none was reported invalid**. 307,148 single-character perturbations were detected at
**100.000%**. Adjacent-transposition rates are *predicted from each scheme's own check
equation* and asserted against measurement: 100% for the mod-11 schemes, 88.9% for mod-10.
The mod-10 shortfall is blindness to digits differing by 5, which is a property of the
standard rather than a defect here.

**Recall is now measured.** GBSA-1 contains no fabricated-identifier stratum, so it could
only ever bound false positives. GBSA-2 adds one, and on it `citation_resolvability` scores
**precision 1.000, recall 0.923** — 1.000 among in-scope items. The single miss is
pre-registered `in_scope: false`: it carries no identifier at all.

Recall remains bounded above by identifier presence. A fabricated reference with no
identifier, or one whose invented identifier happens to carry a valid check digit, is
invisible to this probe — and a fabricated citation with no identifier still returns
`trust`. That is a measured limitation, not a hypothetical one.

> Live since 2026-09-04: `/api/v1/capabilities` advertises **14** deterministic probes
> including `citation_resolvability`, and the six tool-invocation probes. Verified against
> the deployed instance, name-for-name against `src/server.ts`, by `npm run test:live`.

## Transparency endpoints

Both are **unauthenticated** and machine-readable, like `/health` and `/ready`.

### `GET /api/v1/capabilities`

Publishes what the system can do **and an explicit `limitations[]` array of what it
cannot**: the five checkpoints, every probe angle, the `tool_assurance` block, the
constitution rule kinds, the five response actions, each endpoint's semantics, the gate's
release and withhold sets, `external_fact_verification: false`,
`raw_content_persistence: false`, and the metrics endpoint's own durability.

The `limitations[]` array is the point. It states, at the public API, that pattern-based
checks do not detect every attack or hallucination; that the advisory endpoint does not
enforce its recommendation; that the govern endpoint withholds but does not regenerate
output or operate a human-review queue; that the gateway is not a sandbox, firewall,
malware scanner or professional-advice system; the three tool-pinning limits above; and
that the metrics counters are not a durable audit log.

### `GET /api/v1/metrics`

Aggregate counters: verifications by surface, verdict, action, checkpoint type, highest
severity and constitution version; released vs withheld; per-probe fire rate; latency
buckets; and **admission rejections counted as a separate series** from verifications, so a
refused request never lands in a verdict denominator.

It **counts events, never content.** No question, answer, claim, evidence string, span, or
hash of submitted content reaches a counter. Probe labels are matched against a fixed
compile-time set, so a label can never become a channel for submitted text. Caller-supplied
constitution versions must match an identifier pattern and are capped at 64 distinct values
before overflowing to `other`. `src/metrics.ts` is written so that auditing this is a
single-file read: `verificationEvent` is the only bridge from a Trust Card into a counter,
and every label passes through `BoundedCounter`.

Published caveats, in the payload itself: the counters are **in-memory and reset when the
instance restarts** — process-local aggregates for an operator to scrape, **not a durable
audit log**; `probe_fire_rate` is fired/evaluated, i.e. how often a check flagged
something and **not how often the flag was correct**, because the gateway has no ground
truth at runtime; and a `null` percentile means the sample sat above the largest bucket.

## Tests

**266 tests, 0 failures**, re-run 2026-09-04 at 15:33 (`npm test`). This is a timestamped
observation: the same suite reported 254 at 15:05 the same day, before `src/lite.ts`,
`src/mcp.ts`, `src/signals.ts` and two test files were edited mid-pass. Re-run before
quoting. The 14 deterministic probe angles and 6 tool-invocation angles were unaffected. They cover the gate's status
codes, tool-declaration drift attribution, capability-scope refusal, citation check-digit
arithmetic against published identifiers, the (unwired) trajectory chain and its inclusion
proofs, and the projection tests asserting that no submitted content reaches the public MCP
response or the metrics payload.

This is the **gateway suite only**. Re-run on the same day across the platform layer:
browser extension 10, Notion 12, Reddit Devvit 9, VS Code 5 — a re-run platform-layer total
of **302**, plus JetBrains 3 on CI evidence only. Do not add the Python core's `core/tests`
suite to that total; it is a different system.

**No latency figure exists for this deployment.** Evidence ledger C20 is L0, not executed.
The Render free instance can sleep and cold-start, and `/api/v1/metrics` latency percentiles
read `null` on a freshly restarted instance.

No platform user ID, server/workspace name, subreddit, repository name, or URL is passed to the verifier. With Lite, the explicitly submitted question, answer, and optional intents remain inside this process. With the optional Anthropic backend, only those submitted text fields cross the MCP boundary.

The default is a closed pilot. `PILOT_TENANT_ALLOWLIST` accepts exact lowercase keys: `api`, `mcp:public`, `discord:<guild-id>` (or `discord:user:<user-id>`), `slack:<team-id>`, `telegram:<chat-id>`, `github:<owner/repo>`, and `reddit:<subreddit>`. `PLATFORM_PUBLIC_PLATFORMS` can open only named adapters (for example `discord,telegram,github,mcp`) while Slack, Reddit, and the bearer-protected API retain their own gates. The legacy `PLATFORM_ALLOW_PUBLIC=true` bypasses every tenant gate and remains unsuitable for this deployment.

## ChatGPT and Claude MCP

The public zero-cost connector URL is:

```text
https://YOUR_DOMAIN/mcp
```

It speaks MCP Streamable HTTP and exposes one read-only tool: `glassbox_verify_answer`. The tool runs the same deterministic Lite verifier as the platform adapters and makes no model-provider API call. Its public response contains a verdict, score, claim count, fixed-category findings, probe outcomes, and scope caveats. It does not echo the submitted question or answer, claim excerpts, verifier evidence, timestamps, audit IDs, input hashes, or other internal metadata. Add `mcp` to `PLATFORM_PUBLIC_PLATFORMS` (or allowlist the fixed `mcp:public` tenant) before connecting a remote client.

In ChatGPT, enable Developer mode under **Settings → Security and login**, open **Plugins**, select **+**, and enter the `/mcp` URL as a public connection. In Claude, open **Customize → Connectors → + → Add custom connector** and enter the same URL. No OAuth client or model API key is required for this read-only public tool.

## Web app and Notion embed

The public app at `https://YOUR_DOMAIN/app` calls the same privacy-minimized MCP tool directly. It can be installed as a Progressive Web App in supported browsers. In Notion, type `/embed`, select **Embed**, and paste the `/app` URL. The frame cannot read the surrounding Notion page; it receives only the question and answer deliberately pasted into its own form. See [`notion/README.md`](notion/README.md).

## Platform launch order

1. Telegram public bot and Discord user-install test: fastest feedback and no marketplace dependency.
2. GitHub public App: direct installs work without a Marketplace listing.
3. Slack single-workspace pilot: validate the interaction first, then add OAuth/token storage and reach the current Marketplace eligibility threshold of 5 active workspaces. Message-level insight generation also needs a written Slack eligibility determination.
4. Reddit Devvit review: request the exact GlassBox API domain and build the menu action. Enable the classic bridge only if Reddit separately approves that exact Data API use case.
5. Mattermost and Teams: add through the authenticated universal API after the first four produce real usage data.

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact setup and current review constraints.

## Security and privacy defaults

- Raw request bodies are used only for provider signature verification and are not logged.
- GitHub Marketplace purchase payloads and OAuth tokens are never logged or persisted; the temporary user token is revoked after free-plan verification.
- Raw prompts and answers are not stored by this service.
- Completed event IDs are held in memory for up to 24 hours for deduplication; rate counters last 10 minutes.
- Public MCP/web callers receive separate in-memory rate buckets derived with a keyed one-way digest of the network address; the raw address is not used as a rate-map key.
- Submitted content and generated Trust Cards remain in memory only while an audit runs and for at most five minutes while delivery is confirmed.
- External API access requires a bearer secret.
- Discord, Slack, Telegram, and GitHub requests are authenticated with each platform's signed webhook mechanism.
- `allowed_mentions` is disabled in Discord responses; links are not unfurled in Slack.
- Verification is an automated reasoning audit, not a fact-check, moderation decision, or professional advice.
- The default Lite verifier is offline and deterministic. It checks structure, calibration, internal contradictions, citations that need verification, supported arithmetic forms, normalized and base64-encoded input jailbreak signals, known credential formats, supported destructive execution patterns, and unsafe tool targets. It does not establish factual truth, detect every attack, or replace a sandbox, firewall, malware scanner, or human security review.
- The optional Anthropic backend must be selected explicitly with `GLASSBOX_BACKEND=anthropic`, requires the deployer's API key, and must be disclosed to pilot users.
- Discord delivery is hard-stopped before its 15-minute interaction-token expiry even if an operator raises the generic job timeout.
- The classic Reddit worker remains disabled unless `REDDIT_DATA_API_APPROVED=true` is set after written approval.

Publish `/privacy` and `/terms` from the deployed service before enabling public installs.

## Adding another platform

Implement a thin adapter that:

1. Authenticates the provider request using the untouched raw body.
2. Acknowledges provider deadlines before waiting for GlassBox.
3. Produces a `VerificationInput` and passes it to `VerificationService.run()`.
4. Uses a provider event ID for idempotency and a tenant/user tuple for rate limiting.
5. Returns `formatTrustCard()` or `formatPlainTrustCard()` output.

This keeps new adapters independent of the selected verifier backend.
