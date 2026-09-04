# Threat model and non-goals

## Assets
Submitted question/answer content; provider credentials and webhook secrets; the
gateway's availability under a free-tier budget; the integrity of an emitted Trust Card.

## Adversaries
1. **A hostile submitter** who supplies content designed to manipulate the auditor or
   the downstream client (prompt injection, hostile markup, control and bidirectional
   characters, oversized payloads).
2. **A forger** who sends unsigned or wrongly-signed provider webhooks.
3. **A replay adversary** who resends valid provider deliveries to duplicate work.
4. **A resource adversary** who floods the service to exhaust the free-tier budget.
5. **A curious observer** who reads a public Trust Card hoping to recover the submitted
   content or verifier internals.

## Controls, and what was actually verified

| Adversary | Control | Verified |
|---|---|---|
| Forger | Ed25519 (Discord), HMAC (Slack, GitHub, dedicated Marketplace secret), secret header (Telegram), bearer (API); raw body preserved for signature validation | **Live: all seven routes return 401 unsigned** |
| Replay | Completed event ids reserved through delivery, bounded 24 h; in-flight retries rejected rather than duplicated; failed delivery releases the reservation | L2 tests |
| Resource | 10 audits / 10 min per requester; 100 accepted audits/day global; concurrency 1; rate limits run **before** verifier invocation; deadlines reset a stalled transport without permanently holding the worker | L2 tests |
| Hostile submitter | Injection text analysed as **inert content**; markdown, mentions, links, control and bidi characters neutralized; Discord mentions disabled; Slack unfurling disabled; strict input bounds | L2 tests |
| Curious observer | Public MCP projection drops question, answer, excerpts, verifier evidence, free-form rationale, timestamps, audit/log ids, input hashes, request metadata | **Live: planted-token test, none leaked** |
| Credential exposure | MCP child process receives an explicit environment allowlist, not platform credentials; Marketplace payloads and OAuth tokens are not logged or persisted; temporary OAuth token revoked immediately | L2 tests |

## Non-goals, stated before any claim
GlassBox is **not** a fact-checker, a source authenticator, a truth oracle, a
hallucination detector with measured accuracy, a semantic contradiction engine, a
general-purpose calculator, a complete prompt-injection security boundary, or a
certified-compliant service. It does not run without explicit user invocation.

## Out of scope
A malicious platform provider; a compromised Render host; network-level adversaries
beyond TLS; denial of service against the provider rather than the gateway; and any
claim about the correctness of the audited answer's external facts.
