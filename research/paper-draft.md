# A Glass Box Around the Black Box: Deterministic Auditing of LLM Answers Without Inference

> Canonical source is now `latex/main.tex`. This markdown copy is kept for reference only.

**Karthik Barma, Sarita Singh**

> **DRAFT, v1, 2026-08-11, at commit `d852db0`.** This is a working draft for the
> author to revise and take ownership of. If this is submitted to an AAAI venue, note
> that AAAI-26 author policy prohibits LLM-generated text in submissions while
> explicitly permitting editing and polishing of author-written text; every paragraph
> below should be rewritten in the author's own voice before submission.

---

## Abstract

Tools that audit AI answers generally assume a model in the loop: a judge model, a
classifier, or a guardrail service with its own inference cost. That assumption makes
auditing something a deployment turns on deliberately, for a subset of traffic, rather
than something that can be default-on. We ask how much useful auditing survives if the
auditor is allowed no model inference at all.

We present GlassBox Lite, a deterministic structural reasoning auditor that examines an
explicitly submitted question/answer pair with seven bounded probes: claim segmentation,
allowlisted arithmetic recomputation, direct lexical contradiction, unsupported absolute
certainty, citation transparency, external fact-check scope, and prompt-injection
signals. It makes no model call and performs no network lookup. It emits a compact Trust
Card carrying a verdict, a structural score, per-probe outcomes, and explicit
limitations.

Removing inference has a consequence beyond cost. Because identical inputs produce
identical outputs, the auditor becomes deterministic in a strong sense, and determinism
turns out to be a *deployment* property as much as an evaluation one: it makes
idempotency, replay protection, and reproducible audit records tractable. We verified
this on the live public endpoint, where three identical production requests returned
byte-identical responses.

We then deploy this auditor as one service behind eight heterogeneous surfaces and
report what deployment actually costs. The public Trust Card projection withholds the
submitted content and every verifier-internal field, verified by planting sentinel
tokens in a live request and confirming their absence from the response. All provider
routes fail closed on unsigned requests. At commit `d852db0`, 108 automated tests pass
across six suites and twelve CI jobs succeed on the merged main commit.

Our most transferable contribution is methodological. Deployment claims in this area
routinely collapse five distinct states into the word "available." We separate
implementation presence, provider registration, public installability, production
end-to-end evidence, and directory approval into an explicit five-level scale, and we
report our own results against it, including the surfaces that sit low on it. We make no
truth claim, because GlassBox is not a fact-checker. On accuracy we report a labelled
per-probe benchmark of 187 constructed items whose held-out split yields micro precision
1.000 at micro recall 0.639 over the five probes it scores, and the gap between those two
numbers is itself the result:
probes that compute a property generalise to unseen phrasing, and probes that match a
vocabulary do not.

---

## 1. Introduction

An answer auditor that costs money per audit is an auditor that gets switched off. This
is not a hypothetical constraint. If verification requires a paid model API, then the
verification budget scales with traffic, and the rational deployment response is to
sample: audit some answers, some of the time, in some contexts. The cases most worth
auditing are then exactly the ones most likely to be missed.

This paper explores the opposite corner of the design space. We constrain the auditor to
perform no model inference whatsoever and ask what remains. The honest answer is: less
than a model-based judge, but more than nothing, and what remains has properties a
model-based judge cannot have.

What remains is *structural* auditing. GlassBox Lite does not decide whether an answer
is true. It decides whether an answer is internally well-formed: whether its arithmetic
recomputes, whether it contradicts itself, whether it asserts certainty it has not
earned, whether it cites anything, and whether it contains instruction-like text that a
downstream client should treat as inert. These are narrow properties. They are also
checkable without a model, and checkable identically every time.

That last point is where the paper turns. A deterministic auditor is not merely cheaper
than a sampled one; it is *operationally different*. Retry handling becomes exact rather
than probabilistic. A duplicate provider delivery can be suppressed with confidence that
the suppressed result would have been identical. An audit record can be reproduced from
its inputs. None of this is available to a service whose verdict is drawn from a
sampling distribution.

We therefore treat deployment as the primary object of study rather than as an
afterthought. GlassBox runs as a single verification service behind a web application,
a remote Model Context Protocol (MCP) endpoint, a GitHub App, Discord, Telegram, Slack,
an authenticated API, a browser extension, two IDE clients, a Notion connection, and a
Reddit Devvit app. Building the verifier took a fraction of the effort. Satisfying eight
providers' authentication schemes, invocation models, consent requirements,
acknowledgement deadlines, and review processes took the rest.

That asymmetry produced our second contribution, which is a reporting discipline. Partway
through this work it became clear that "GlassBox is available on Discord" and "GlassBox
is available on GitHub" were both true sentences describing very different situations,
and that no vocabulary distinguished them. We introduce a five-level evidence scale
(Section 10) and hold every claim in this paper to it, including the unflattering ones.

**Contributions.**

1. A deterministic, zero-paid-API structural auditor with seven bounded, explainable
   probes, demonstrated byte-identical on a live public endpoint.
2. A privacy-minimized public Trust Card projection that withholds submitted content and
   all verifier-internal metadata, verified by planted-token testing against production.
3. A cross-platform gateway preserving provider-native authentication, explicit
   invocation, tenant admission, idempotency, rate limits, deadlines, and output
   neutralization, with every provider route verified to fail closed.
4. Reproducibility evidence at a fixed public commit, and a five-level evidence
   discipline under which we report negative results as first-class findings.

**Non-goals, stated up front.** GlassBox is not a fact-checker, a source authenticator,
a truth oracle, a hallucination detector with measured accuracy, a semantic
contradiction engine, a general-purpose calculator, or a complete prompt-injection
security boundary. We report precision, recall, and F1 only against constructed items
(Section 12); those numbers say whether a probe fires as labelled, and say nothing about
how often these failures occur in deployed traffic. Section 17 states these limits in
full.

---

## 2. Motivation and problem definition

Consider a user who receives an answer containing the expression `9 × 9 = 80`. Detecting
this requires no world knowledge, no retrieval, and no model. It requires parsing an
arithmetic expression and recomputing it. Yet in most deployed architectures, catching
it means either a second model call or nothing at all.

Structural errors of this kind form a real and under-served class. An answer may
contradict itself between its second and fifth sentences. It may assert that something
is "certainly" or "definitively" true while supplying no support. It may reference
sources that do not exist as citations at all. It may contain text engineered to be read
as an instruction by whatever consumes it. None of these require establishing external
truth; all are visible in the structure of the answer itself.

We define the problem accordingly. **Given an explicitly submitted question/answer pair,
produce a bounded, deterministic, explainable structural audit without model inference,
and deliver it across heterogeneous platforms without leaking the submitted content.**

Three constraints shape everything that follows.

*Zero paid API.* The verifier may not call a paid model. This is what makes default-on
auditing economically possible for an individual developer, and it is what forces the
probes to be conservative.

*Opt-in only.* GlassBox never audits ambient traffic. It runs when a user explicitly
invokes it. This is a privacy commitment and a scope commitment: we do not observe
conversations, we examine submissions.

*Privacy-minimized output.* On a public interface, the audit result must not echo the
submitted content back, and must not expose verifier internals. The audit is useful
precisely to the extent that it can be shown to someone without re-disclosing what was
audited.

---

## 3. Threat model and non-goals

We consider five adversaries.

A **hostile submitter** supplies content designed to manipulate the auditor or the
downstream client: prompt injection, hostile markup, control and bidirectional
characters, oversized payloads. A **forger** sends unsigned or wrongly-signed provider
webhooks. A **replay adversary** resends valid provider deliveries to duplicate work. A
**resource adversary** floods the service to exhaust a free-tier budget. A **curious
observer** reads a public Trust Card hoping to recover the submitted content or the
verifier's internal reasoning.

Controls are described in Section 8 and their verification in Section 11. We are
explicit that these are *implementation-tested controls*, not a security assessment. We
have not conducted a penetration test, static analysis at scale, or any third-party
audit, and we claim no compliance certification.

Out of scope: a malicious platform provider, a compromised host, network adversaries
beyond TLS, and any claim about the correctness of the audited answer's external facts.

---

## 4. Trust Card and ECS design

A Trust Card is the unit of output: a verdict, a structural score, a claim count, a
finding count, a highest-severity marker, per-probe outcomes, and a caveat list.

The score is an **Epistemic Confidence Score (ECS)**, and its name is the most dangerous
thing about it. **ECS is a structural reasoning score. It is not a probability that the
answer is true, and it is not calibrated against any labelled outcome.** An answer can
score highly and be entirely false, because a fluent, self-consistent, well-cited,
appropriately-hedged falsehood passes every structural probe we run. We surface the
score's decomposition so a reader can see which dimensions drove it, and we attach
caveats to every card that state the limits of the audit in the card itself.

The verdict policy is deliberately conservative, on the view that over-trusting is the
more costly error. A single high-severity structural failure is sufficient to reject
regardless of the aggregate score. Our canonical canary illustrates this: the answer
`9 × 9 = 80` yields ECS 0.8143, high, because the answer is short, self-consistent,
appropriately scoped, and free of injection signals, while the verdict is `reject`,
driven by one high-severity `arithmetic_sanity` failure. We consider this divergence a
feature and a useful teaching case: the score describes structure, the verdict describes
acceptability, and they are not the same question.

---

## 5. The deterministic Lite verifier

Lite runs seven probes over a bounded input (6,000 characters for the question, 12,000
for the answer, at most 8 optional intents).

**`claim_extraction`** segments the answer into atomic claims within a fixed analysis
limit, so cost is bounded by construction rather than by answer length.

**`arithmetic_sanity`** recomputes arithmetic expressions drawn from an allowlist of
supported forms. This is the probe with the sharpest precision/recall tradeoff in the
system: within the allowlist it is exact, and outside it, silent. We chose an allowlist
over a general expression evaluator because a general evaluator over untrusted input is
both a correctness and a security liability, and because a false negative is cheaper
here than a false positive.

**`internal_contradiction`** detects direct lexical contradictions and repeated-value
conflicts. It is not natural-language-inference-grade and will miss paraphrased or
semantic conflicts.

**`unsupported_certainty`** flags absolute-certainty language unaccompanied by support.

**`citation_verifiability`** reports on citation presence and attaches the caveat that
citations are not authenticated.

**`fact_check_scope`** flags answers that overstate what a non-web audit can establish.

**`prompt_injection`** signals instruction-like language. Critically, such text is
analysed as **inert content**: it is data to be reported on, never instruction to be
followed. This is a signal for a downstream consumer, not a containment boundary.

Every probe is conservative by design. Where a probe cannot reach a confident structural
judgement, it passes. The system is built to under-report rather than over-report,
because a structural auditor that cries wolf will be disabled, and a disabled auditor
has precision zero.

**Determinism.** No probe calls a model or the network. Identical inputs therefore yield
identical outputs, and we verified this against production rather than asserting it from
the source: three identical requests to the live public endpoint returned byte-identical
response bodies (SHA-256 `f33f8274…`). We note the contrast with our own earlier
six-tool MCP server, which is model-assisted and for which we make no determinism claim
beyond canonical assembly and hashing.

---

## 6. Privacy-minimized public interface

The public MCP projection is a deliberate subtraction. It omits the question, the
answer, extracted excerpts, verifier evidence, free-form rationale, timestamps,
audit and log identifiers, input hashes, and request or session metadata. What survives
is the verdict, the score, counts, fixed-category findings, per-probe outcomes, and
caveats: enough to act on, not enough to reconstruct the input.

We verified this behaviourally rather than by inspection. We issued a live production
request with unique sentinel tokens embedded in both the question and the answer and
confirmed that neither token appeared anywhere in the response, and that none of
`log_id`, `inputs_hash`, `generated_at`, `timestamp`, or `excerpt` was present. This is
a test we recommend generally: projection policies are easy to state, easy to implement
correctly once, and easy to regress silently when a field is added upstream.

**What we do not claim.** Platform providers and the infrastructure host receive and
process request traffic. We therefore make no claim of "zero data collection," "nothing
leaves the device," "no third parties," or end-to-end encryption, and we regard such
claims in comparable systems as generally unsupportable. Our actual retention posture is
bounded, not absent: raw content is not persisted to a database or to files by the
gateway; content and results remain transiently in memory for up to five minutes while
work and delivery complete; completed event identifiers are retained up to 24 hours for
replay protection; rate-control identifiers up to 10 minutes.

---

## 7. Cross-platform adapter architecture

One verification core sits behind a uniform pipeline (Figure 1):

```
provider authentication + strict input bounds
        → tenant admission + requester limits + replay protection
        → bounded queue, concurrency 1, daily ceiling
        → deterministic Lite verifier
        → privacy-aware platform-native formatting
```

Adapters differ only at the ends: how a provider authenticates, and how a result is
rendered. Everything between is shared, which is what makes it feasible for one
developer to maintain eight surfaces.

The design tension is that providers disagree about nearly everything. Discord signs
with Ed25519 and expires interaction tokens on a deadline. Slack and GitHub sign with
HMAC. Telegram uses a secret header. MCP clients speak JSON-RPC over Streamable HTTP.
Reddit Devvit requires an approved outbound-fetch allowlist. The gateway normalizes
these into a single admission decision, and stops delivery before a provider's token
expires rather than emitting a late result.

---

## 8. Authentication, consent, and abuse controls

Every provider route validates provider-native authentication against the preserved raw
request body and **fails closed**. Wrong events, missing delivery identifiers, unsigned
requests, and forged requests are all rejected before any verification work is queued.

Admission is explicit. Public availability is per-platform rather than global; the
deployed configuration opens a selected subset and leaves the remainder allowlisted.
Rate limits run *before* verifier invocation, at 10 audits per 10 minutes per requester,
under a global ceiling of 100 accepted audits per day, with verifier concurrency pinned
at 1. Completed event identifiers are reserved through delivery and released on delivery
failure, so a provider retry after a genuine failure still succeeds while an in-flight
retry does not produce a duplicate reply.

Credential handling is minimal by construction: the MCP child process receives an
explicit environment allowlist rather than platform credentials; marketplace payloads
and OAuth tokens are not logged or persisted; a temporary OAuth token is revoked
immediately after use; OAuth state is signed, one-time, plan-bound, and expires after
ten minutes.

Output is neutralized before delivery: markdown, mentions, links, control characters,
and bidirectional characters are all defanged, Discord mentions are disabled, and Slack
link unfurling is off. An auditor that renders hostile submitted content into a
privileged channel would itself become the attack.

---

## 9. Implementation

The gateway is TypeScript under strict compilation. Clients comprise a web/PWA
application, a remote MCP endpoint, a GitHub App, Discord, Telegram, and Slack adapters,
an authenticated API, a browser extension, VS Code and JetBrains plugins, a native
Notion connection, and a Reddit Devvit app. A separate Python client package and an
older six-tool stdio MCP server are maintained in the same repository; the latter is
model-assisted, requires the user's own API key, and is a **distinct system** from Lite
which we are careful not to conflate.

---

## 10. Evaluation methodology: five levels of evidence

We found no adequate vocabulary for what we needed to report, so we adopted one.

| Level | Meaning |
|---|---|
| **L4** | Public production end-to-end: a real request traversed a public surface and produced a captured, publicly viewable result. |
| **L3** | Production signed or configured canary: an operator-initiated request against the live production route, correctly authenticated or deliberately forged. |
| **L2** | Automated test, local or CI, including adversarial tests. |
| **L1** | Implementation and configuration present, not exercised end to end. |
| **L0** | Proposed or future work. |

The scale exists because the alternative is a single word, "tested," that spans an
enormous range of epistemic strength. A system with a green test suite and a system with
a publicly viewable production result are not in the same evidentiary position, and a
paper that describes both as "tested" has destroyed information its reviewers need.

We hold every claim in this paper to the scale, and we report our own weak rows. We now
answer one accuracy question, against the held-out split of a benchmark we constructed
ourselves (Section 12), and we hold that answer to the same discipline: it is an L2 result
about constructed items, not an L4 result about production traffic. The scale is what
keeps those two apart.

---

## 11. Automated and adversarial testing

At commit `d852db0`, 108 automated tests pass across six heterogeneous suites: gateway
69, Notion 12, browser extension 10, Reddit Devvit 9, VS Code 5, JetBrains 3. This is
the platform-layer total and not the repository's whole test count.

The gateway suite is weighted toward adversarial and operational behaviour rather than
happy paths: forged and unsigned requests, wrong events, missing delivery identifiers,
in-flight retry duplication, rate limits ahead of invocation, the global ceiling, stalled
verification and transport reset, worker-slot release when a reset never settles, event
reservation held through delivery and released on failure, and delivery halted before
interaction-token expiry.

Twelve CI jobs succeed on the merged main commit: the gateway, Devvit, browser
extension, Notion, VS Code, and JetBrains suites; TypeScript strict-mode with an MCP
smoke test; Python package build/install/import on 3.10, 3.11, 3.12, and 3.13; and a
cross-language audit-hash determinism assertion. Production dependency audits report
zero *known* vulnerabilities at the configured threshold, which is not a penetration
test, not static analysis, and not a certification. CI also emits Node 20 and transitive
dependency deprecation warnings, which we do not paper over.

---

## 12. Accuracy: the GBSA-1 benchmark

The scale in Section 10 governs what kind of claim we may make; it does not produce an
accuracy number. GBSA-1 is a labelled per-probe benchmark built for that purpose: 187
items in two splits, generated by seeded scripts and run in process against Lite with no
API key and no network.

**Construction.** The 112-item development split spans six strata: correct and incorrect
allowlisted arithmetic, direct contradictions against non-contradictory controls,
calibrated uncertainty against unsupported certainty, citation-present and
unverifiable-source cases, prompt-injection inputs, and benign clean controls. Each item
carries a target probe, a label, and a note recording why it is labelled as it is. We used
this split to locate defects and then repaired the implementation against it, which
disqualifies its post-repair score as an estimate of capability. We therefore wrote a
second, 75-item held-out split after those repairs, deliberately using surface forms
excluded from every pattern we had touched. Both generators are seeded and regenerate
byte-identically.

| Split | Micro precision | Micro recall | Micro F1 | n |
|---|---|---|---|---|
| Development, before repair | 0.975 | 0.812 | 0.886 | 112 |
| Development, after repair | 1.000 | 1.000 | 1.000 | 112 |
| **Held-out, after repair** | **1.000** | **0.639** | **0.780** | 75 |

**Only the last row is a result.** The middle row is fitted to the split it is scored on,
and we report it solely to show the size of the gap between fitting a split and
generalising past it. Scores are computed over the items the paper predicts are in scope
for the probe under test; on the held-out split the in-scope and all-items figures are
identical, so that choice changes nothing in the row that matters.

| Probe | Kind | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|
| `arithmetic_sanity` | computed | 16 | 0 | 0 | 16 | 1.000 | **1.000** | 1.000 |
| `internal_contradiction` | structural | 5 | 0 | 1 | 6 | 1.000 | **0.833** | 0.909 |
| `citation_verifiability` | lexical | 2 | 0 | 4 | 3 | 1.000 | **0.333** | 0.500 |
| `unsupported_certainty` | lexical | 0 | 0 | 4 | 4 | n/a | **0.000** | 0.000 |
| `prompt_injection` | lexical | 0 | 0 | 4 | 4 | n/a | **0.000** | 0.000 |
| Micro | | 23 | 0 | 13 | 33 | 1.000 | 0.639 | 0.780 |

**The finding is the split between these rows, and it is not arbitrary.** Probes that
*compute* a property generalise. `arithmetic_sanity` recomputes the expression, so it is
indifferent to phrasing and holds at 1.000 recall on unseen framings;
`internal_contradiction` tests negation polarity and normalised token overlap, which is
structural rather than lexical, and holds at 0.833. Probes that *match a vocabulary* do
not. `unsupported_certainty`, `prompt_injection`, and `citation_verifiability` are
regular-expression vocabularies, and against phrasings outside them ("irrefutably",
"categorically", "pay no attention to anything stated before this line", "common wisdom
holds that") recall falls to between 0.333 and 0.000. Repairing those vocabularies on the
development split raised development recall to 1.000 and moved held-out recall for the
three of them barely at all: **vocabulary repair buys development score, not capability.**

We report this as a bound on the zero-inference design rather than as a defect list. A
model-free auditor can be exact where the property is computable, and is only as broad as
its lexicon where it is not. That is the honest cost of removing inference.

**Precision is the property that holds, inside what is scored.** Across all 187 items the
five scored probes produced zero false positives, including on 34 near-miss negatives
constructed to be surface-similar to positives ("The installation instructions say to
ignore the optional dependencies", "The error rate is 2 percent. It was 11 percent last
quarter"). For an auditor intended to run by default, precision is what decides whether it
stays switched on, and for these five probes it is what generalised.

**That figure covers five probes out of the thirteen the implementation now emits.**
`claim_extraction`, `unsupported_specificity`, `answer_relevance`, `input_injection`,
`credential_exposure`, `dangerous_action`, `network_boundary`, and `fact_check_scope` are
unscored, and we can say nothing about their accuracy. The gap is not academic. On the
current run `answer_relevance` fires on 3 of the 14 benign clean controls — terse but
correct answers such as "The process reads its configuration and opens one listening
socket." — and raises each of them to a `caution` verdict. Within-stratum precision for the
five scored probes is unaffected and still 1.000, which is exactly the point: a precision
figure scoped to five probes is not a statement about the verdict a user actually sees. We
report this as an open and unmeasured false-positive class, and note that the benchmark did
not find it.

**Determinism and stability under change.** Both splits were run three complete times end
to end, and all passes were byte-identical. This is a stronger determinism result than the
three-call production canary of Section 14: 187 distinct inputs, three full passes,
identical digests. The suite was also re-executed after a later round of 27 security and
correctness fixes, and the confusion matrices for all five scored probes were unchanged.
That is a weaker result than it first appears, and we read it in both directions: the fixes
did not regress what the benchmark measures, and the benchmark could not reach what the
fixes changed.

**What GBSA-1 does not measure.** The items are constructed, not sampled from any real
answer distribution. Labels are fixed by construction, so there is no blinded annotation
and no inter-annotator agreement statistic. Class balance is by design rather than
natural, both splits are single-author, and n is small enough that the held-out
micro-recall Wilson 95% interval is [0.48, 0.78]. We compute no AUROC and no calibration
result, so ECS remains uncalibrated. Above all, **nothing here says how often these
failure modes occur in practice**, and no prevalence or deployment-impact claim follows
from these numbers. The benchmark's negative space is also demonstrably incomplete: a
false-positive class on comparison sentences ("Plan A allows 5 requests. Plan B allows 50
requests.") surfaced in real use, and none of the original 187 items could express it. We
added a 21-item comparison stratum, which the repaired probe now passes with zero false
positives, but that class was found by users rather than by the benchmark, and we take it
as evidence that a constructed benchmark bounds what we have thought of rather than what
the world contains.

---

## 13. Cross-language reproducibility

The repository's older six-tool MCP server carries a canonical audit-record construction:
recursively sorted-key JSON serialization, SHA-256 hashing, and deliberate exclusion of
the generation timestamp from the hash, so that identical inputs and identical engine
outputs collapse to the same audit identifier. CI asserts that a JavaScript run and an
installed Python client both reproduce the reference identifier
`glassbox-85cc09903bd4b3f8022a4087` byte-for-byte.

We state the scope of this result precisely, because it is easy to overclaim. The
demonstration begins from **prebuilt** claim, red-team, and ECS parts. It establishes
that canonical assembly, verdict policy, serialization, and hashing are stable across a
language boundary. It does **not** establish that unconstrained model analysis is
deterministic, and it concerns the model-assisted MCP rather than Lite. Lite's
determinism is a separate and stronger result, established directly against production
in Section 5.

---

## 14. Production deployment case studies

**GitHub App (L4).** A public GitHub App receives issue-comment events, verifies HMAC
signatures, and replies as a bot. Our canary submitted deliberately incorrect arithmetic
through a real issue comment; GlassBox replied as `glassbox-by-aura[bot]` with a REJECT
Trust Card (`ECS 81.4%`, weakest dimension arithmetic integrity) roughly three seconds
later. The comment is publicly viewable. This is our strongest public evidence, and it
is a single operator-initiated canary rather than a user study.

**Remote MCP (L4).** The public endpoint answers `tools/list` with a single
privacy-minimized tool and executes `tools/call` over Streamable HTTP. Our canary
question "What is 9 multiplied by 9?" with answer "9 × 9 = 80" returns `verdict=reject`,
`score=0.8143`, one high-severity `arithmetic_sanity` finding, and six passing probes.
Re-executed during the preparation of this paper, it reproduced exactly.

**Determinism and projection (L4).** Both were established against this same live
endpoint, as described in Sections 5 and 6.

**Discord and Telegram (L3).** Both are publicly registered, connected to authenticated
production routes, and verified to reject unsigned requests. **We preserved no real-user
result transcript for either.** They are therefore reported as publicly registered and
live-configured, not as production end-to-end proven, and closing this gap is our second
priority experiment (Section 19).

---

## 15. Negative results and external platform gates

We report these as findings rather than as apologies, because they are the transferable
part of the work.

**Public registration is not observed use.** Discord and Telegram are installable and
authenticated, and we still cannot show a real user receiving a result. The distance
between "installable" and "observed working" is invisible in most deployment claims and
is, in our experience, the most commonly overstated step.

**A distribution gate can be architectural rather than functional.** Our Slack adapter
works: signed commands, visibility control, response-URL delivery, and modal flows all
pass. Public Slack distribution nonetheless requires multi-workspace OAuth, encrypted
token storage, uninstall and deletion processing, eligibility confirmation, and an
active-workspace threshold. The remaining work is not the feature; it is the tenancy
model. Slack therefore remains a deliberately allowlisted single-workspace pilot.

**An outbound-domain allowlist can block an otherwise correct consent flow.** Our Reddit
Devvit app reached explicit consent, menu shown, consent dialog accepted, selection
validated, and initiated the gateway call, which then failed at the network stage while
the gateway itself was healthy and serving other surfaces. The fetch-domain approval
remains pending, which is the leading explanation. We state this as an inference and not
as a confirmed platform determination, and no Trust Card was produced.

**Directory eligibility is independent of protocol correctness.** Our MCP endpoint is
demonstrably correct and publicly usable by compatible clients. Publication in the
ChatGPT or Claude directories nonetheless depends on submission tokens and, in one case,
on holding an eligible organisation tier. A zero-cost individual developer can build a
conforming endpoint and still be structurally ineligible for the directory that would
make it discoverable.

**A free listing can still require commercial data.** Our GitHub Marketplace listing is a
$0 plan with no paid tier and no trial. A real free install nonetheless reached a $0.00
order page that requested a private billing address. We entered none. The listing is
**submitted and pending publication review**; at the time of writing the expected public
listing URL returns 404, and we do not describe it as published, listed, or searchable.

**Free-tier cold starts conflict with acknowledgement deadlines.** The host instance can
sleep and cold-start, while providers such as Discord expire interaction tokens on a
fixed deadline. Our resolution is to stop delivery before token expiry rather than emit
a late result, but this is a mitigation rather than a solution, and we make no
guaranteed-latency claim.

---

## 16. Privacy and ethics

GlassBox is opt-in and never audits ambient conversation. Results on public surfaces are
content-free by projection. The system charges no fee and accepts no payments.

We are deliberate about what we do not claim. Traffic is processed by platform providers
and by the infrastructure host, so absolute-privacy claims would be false. Retention is
bounded rather than absent, and Section 6 states the exact bounds. We hold that a
verification tool making unsupportable privacy claims is a worse failure than one making
modest, accurate ones, since the former asks users to trust it precisely where it should
not be trusted.

---

## 17. Limitations

The method is bounded in ways that matter. GlassBox audits structure, not truth, and a
well-formed falsehood passes. ECS is structural and uncalibrated. Contradiction detection
is lexical and misses semantic conflict. Arithmetic support is allowlisted, so
unsupported mathematics is silently out of scope. Prompt-injection signalling is a
signal, not a containment boundary. Inputs are bounded, so long-document auditing is out
of scope. **Accuracy is measured only over constructed items, and only the held-out split
of Section 12 may be quoted as an estimate.**

The evidence is bounded too. Our L4 results are single operator-initiated canaries, not a
user study. Discord and Telegram lack preserved user transcripts. Cross-language
determinism begins from prebuilt parts and concerns the model-assisted MCP. Dependency
audits report zero *known* vulnerabilities at a configured threshold and are not a
security assessment. The Reddit diagnosis is an inference. External approvals are outside
our control and have no committed timeline.

**Threats to validity.** *Construct:* we do not measure trustworthiness; we measure
determinism, projection minimality, and fail-closed behaviour, and the "Trust Card"
framing must not be read as a validated trust judgement. *Internal:* canary inputs were
chosen to exercise a known probe and demonstrate reachability, not detector quality.
*External:* one operator, one deployment, one free-tier host; multi-tenant behaviour
under load is untested at concurrency 1 and a 100/day ceiling. *Reproducibility:* live
canaries depend on a running instance that may drift from the pinned commit; the commit,
release, and CI run are the stable anchors.

---

## 18. Related work

GlassBox sits beside three lines of work without competing directly with any of them.

*Guardrail and output-classification systems* operate on prompts and responses against a
safety taxonomy, generally with a model in the loop. GlassBox differs in decomposing to
claim level, in exposing a per-probe decomposition rather than a category label, and in
requiring no inference.

*Runtime verification for agents* monitors execution traces against formal policy and,
in the stronger systems, rejects non-compliant actions before they take effect. That work
is more powerful than ours along the dimension that matters most for agents: it operates
over trajectories and it prevents. GlassBox verifies a completed answer and does not
intervene. We are explicit that we do not occupy this position.

*Assurance and audit-trail work* addresses provenance and reproducibility of AI
decisions. Our canonical audit construction is a modest instance of this, and our
contribution is less the hashing scheme than the demonstration that a fully deterministic
verifier makes such records exact rather than approximate.

We do not claim to be first, and we do not claim an unoccupied niche. Our claim is
narrower: that the zero-inference corner of this design space is under-explored, and that
it buys deployment properties the model-based corner cannot.

---

## 19. Future work

The benchmark gap is now partly closed, and what remains open is worth stating precisely.
GBSA-1 (Section 12) covers four of the seven strata we set out to build — allowlisted
arithmetic; direct contradictions with non-contradictory lexical controls; calibrated
uncertainty versus unsupported certainty; and citation-present, citation-absent and
unverifiable-source cases — together with the prompt-injection half of a fifth, whose
hostile-markup half is unbuilt. Two strata are untouched: refusals and safe non-answers, and
Unicode, control-character, and bidirectional-text attacks, the last of which would double
as a projection-regression set. The protocol we proposed is only partly honoured. Labels
were fixed before any run and the held-out split was written only after repair, but the
labels are fixed by construction rather than by blinded annotation, so there are no
independent annotators and no agreement statistic, and we report Wilson intervals rather
than bootstrap ones. Ablation by probe and baseline comparison against an output-level
classifier and a length control have not been run. **The largest remaining gap is not a
wider benchmark but a natural one.** Every item in GBSA-1 was written by us, and nothing
in it establishes how often these failure modes occur in answers people actually
receive.

Two other priorities follow. Capturing one real-user end-to-end result each on Discord
and Telegram would move two surfaces from L3 to L4 and close our largest evidence gap. A
cold-start latency and acknowledgement-deadline study would convert Section 15's final
finding from an observation into a measurement.

---

## 20. Conclusion

We built an answer auditor that is allowed no model inference, and found that the
constraint bought more than it cost. What we gave up is the ability to assess truth, and
we are explicit throughout that we cannot. What we gained is determinism, which we
verified byte-for-byte against a live public endpoint, and which propagates into
idempotency, replay protection, and exact audit records in a way a sampled verdict cannot.

The larger lesson is about deployment reporting. Running one verifier behind eight
platforms taught us that the interesting failures are not in the detector. They are
outbound-domain allowlists, tenancy models, acknowledgement deadlines, directory
eligibility rules, and billing-profile requirements attached to free listings. These are
rarely reported, and they determine whether a working system is a usable one. We have
reported ours against an explicit five-level scale, including the levels we would rather
not be on, and we would encourage the same discipline from others.

---

## Appendix A: Reproducibility

Repository `github.com/TheBarmaEffect/glassbox`, commit
`d852db090cd0b72a50b1738afca9392332445810`, release `integrations-v0.1.0`, main-branch
CI run `31479201334` (12/12 jobs success). Full command list, per-suite results, live
canary invocations, and their outputs are in `research/reproducibility.md`; the complete
claim-to-evidence mapping is in `research/evidence-ledger.md`; the per-surface evidence
table is in `research/platform-status.md`.

The GBSA-1 benchmark of Section 12 lives in `research/benchmark/`, with the commands to
regenerate both splits and reproduce every number in `research/benchmark/REPRODUCE.md`.
It needs no API key and no network. Both generators are seeded, so the splits regenerate
byte-identically, and `--repeat 3` asserts that three full passes agree.
