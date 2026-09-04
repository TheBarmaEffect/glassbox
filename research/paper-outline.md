# Paper outline

**Working title:** GlassBox: Deterministic, Privacy-Minimized Trust Cards for
Cross-Platform AI Answer Auditing
**Subtitle:** A Reproducible, Opt-In Gateway for Structural Reasoning Audits Without
Paid Model APIs

## Thesis

*A useful class of AI answer auditing can be performed by bounded deterministic probes
that require no model inference at all, and once the auditor is deterministic and
content-free at its boundary, it becomes deployable as a single verification service
across heterogeneous platforms whose real constraints are authentication, consent,
idempotency and deadlines rather than model quality. The engineering difficulty of
trustworthy AI tooling lies in the deployment envelope, not only in the detector.*

Two consequences give the paper its spine:

1. **Determinism is a deployment property, not just an evaluation nicety.** Because
   Lite makes no model call, identical inputs yield byte-identical outputs. This was
   demonstrated on the live public endpoint. Determinism makes replay protection,
   idempotency and audit reproducibility tractable in a way a sampled model cannot.
2. **Availability is not binary.** The paper's most transferable contribution is a
   five-level evidence discipline (L0-L4) separating implementation, provider
   registration, public installability, production E2E, and directory approval. Most
   deployment claims in the literature silently collapse these.

## Research questions

- **RQ1** To what extent can bounded deterministic probes produce stable, explainable
  structural audits without a paid model API?
- **RQ2** Can a public Trust Card interface retain actionable diagnostic information
  while suppressing submitted content and internal metadata?
- **RQ3** Can one verification service preserve provider-native authentication,
  explicit invocation, idempotency, deadlines and output safety across heterogeneous
  platforms?
- **RQ4** What distinction should deployment research draw between implementation,
  provider registration, public installation, production E2E evidence, and directory
  approval?
- **RQ5** Which failure modes are exposed by real platform constraints such as
  interaction deadlines, cold starts, OAuth review and outbound-domain allowlists?

**RQ1 and RQ2 are answered with evidence in this paper. RQ3 is answered
architecturally and by adversarial tests. RQ4 and RQ5 are answered by the deployment
case studies and negative results. RQ1 is now answered for accuracy as well as
stability, because a labelled benchmark exists.**

GBSA-1 (`benchmark/`) is a labelled per-probe benchmark with a 112-item development
split and a 75-item held-out split, scoring code, and three byte-identical passes per
split. The held-out split gives micro precision 1.000, micro recall 0.639 and F1 0.780,
with zero false positives across all 187 items, for the five probes it scores. What that
licenses is a statement about how well those five probes separate constructed positives
from constructed negatives, and nothing beyond it. Items are constructed rather than
sampled from any real answer distribution; labels are fixed by construction, so there is
no inter-annotator agreement; class balance is by design, not natural; and nothing in the
benchmark says how often these failure modes occur in practice. The implementation now
emits thirteen probes, so eight are unmeasured, and on the 2026-09-03 re-run one of them
(`answer_relevance`) raises 3 of the 14 benign clean controls to `caution` — a
verdict-level false-positive class that the headline precision figure does not cover.

**The development split was used to locate defects and the implementation was repaired
against it, so its post-repair score is tuned on the test set and must never be quoted as
a capability estimate. Only the held-out figures may be.** See `limitations.md`, items 7
to 9.

## Contributions

- **C-I** A deterministic zero-paid-API structural auditor with seven bounded,
  explainable probes, demonstrated byte-identical on a live public endpoint.
- **C-II** A privacy-minimized public Trust Card projection that withholds submitted
  content and all verifier-internal metadata, verified by planted-token testing.
- **C-III** A cross-platform gateway preserving provider-native authentication,
  explicit invocation, tenant admission, idempotency, rate limits, deadlines and output
  neutralization, with all provider routes failing closed.
- **C-IV** Reproducibility evidence spanning TypeScript, four Python versions, six test
  suites, twelve CI jobs, a tagged public release, and public production canaries, together with an evidence-level discipline and a set of first-class negative results.
- **C-V** A labelled per-probe benchmark, GBSA-1, whose held-out split separates the
  probes into two classes: probes that **compute** a property generalise to unseen
  phrasing, and probes that **match a vocabulary** do not. This is a bound on the
  zero-inference design itself rather than a defect list, and it is reported as a
  result. Precision is 1.000 on both splits, with zero false positives across 187 items,
  for the five probes GBSA-1 scores; the other eight probes are unmeasured.

## Section plan

| # | Section | Load-bearing content | Evidence |
|---|---|---|---|
| 1 | Abstract | Problem, deterministic-auditor gap, method, deployment envelope, what was measured, bounded contribution | C1, C3, C8, C16 |
| 2 | Introduction | Auditing tools that need a paid API cannot be default-on; deployment is the hard part | n/a |
| 3 | Motivation and problem definition | Structural auditing vs fact-checking; the opt-in, zero-cost constraint | n/a |
| 4 | Threat model and non-goals | See `threat-model.md`. Non-goals stated before any claim | n/a |
| 5 | Trust Card and ECS design | ECS as a **structural** score; verdict policy; caveat surface | C18 |
| 6 | Deterministic Lite verifier | Seven probes; bounded inputs (6 000 / 12 000 chars, ≤8 intents); allowlisted arithmetic | C1, C2 |
| 7 | Privacy-minimized public interface | Projection design; planted-token verification | C3 |
| 8 | Cross-platform adapter architecture | `figures/architecture.mmd` | n/a |
| 9 | Authentication, consent, and abuse controls | Fail-closed 401s; 10/10min per requester; 100/day ceiling; concurrency 1; 24h replay window | C9 |
| 10 | Implementation | `platforms/src/*`, extension, Notion, IDE clients | n/a |
| 11 | Evaluation methodology | **The L0-L4 discipline.** Accuracy claims confined to the held-out split; the development split explicitly refused as an estimate | RQ4 |
| 12 | Automated and adversarial testing | 108 tests across six suites; forged-request tests | C4, C5, C9 |
| 13 | **Accuracy: the GBSA-1 benchmark** | Construction, seeds and splits; held-out per-probe table; the computed-vs-lexical finding; zero false positives across 187 items on the five scored probes; five-of-thirteen coverage and the unmeasured `answer_relevance` clean-control firings; the caveats that travel with every number | C-V |
| 14 | Cross-language reproducibility | Canonical hash `glassbox-85cc…`, with the prebuilt-parts caveat stated in the same paragraph | C15 |
| 15 | Production deployment case studies | GitHub App E2E; MCP canary; determinism run | C7, C8, C1 |
| 16 | **Negative results and external platform gates** | The strongest differentiator, see below | C12, C13, C14 |
| 17 | Privacy and ethics | Opt-in only; providers and Render still process traffic; no "zero data collection" | n/a |
| 18 | Limitations | See `limitations.md` | n/a |
| 19 | Related work | Guardrails, runtime verification, output classifiers; position GlassBox as *deterministic structural audit*, not a detector competitor | n/a |
| 20 | Reproducibility appendix | See `reproducibility.md` | C6 |
| 21 | Conclusion | n/a | n/a |

## Section 16, negative results, treated as findings

1. **Public registration ≠ observed use.** Discord and Telegram are publicly
   registered and authenticated, yet no user-result transcript was preserved. The gap
   between "installable" and "observed working" is invisible in most deployment claims.
2. **Slack's distribution gate is architectural, not functional.** The adapter works;
   public listing needs multi-workspace OAuth, encrypted token storage, uninstall
   processing and an active-workspace threshold.
3. **An outbound-domain allowlist can block an otherwise correct consent flow.** Reddit
   Devvit reached explicit consent and gateway initiation, then failed at the network
   stage while the gateway itself was healthy.
4. **Directory eligibility is independent of protocol correctness.** The MCP endpoint
   is demonstrably correct, yet ChatGPT and Claude directory publication depend on
   submission tokens and organisation tier.
5. **A $0 marketplace listing can still demand billing-profile data.** A real free
   install reached GitHub's $0.00 order page and requested a private billing address.
   No address was entered.
6. **Free-tier cold starts conflict with provider acknowledgement deadlines.** Render
   free instances can sleep; Discord interaction tokens expire. The system stops
   delivery before token expiry rather than emitting late.

Each is a reusable lesson for anyone deploying an AI verification service, and none
requires a claim the evidence cannot carry.
