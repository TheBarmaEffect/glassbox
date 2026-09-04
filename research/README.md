# GlassBox research package

Research artifacts for the GlassBox paper. Every claim here is tied to source, a test,
a CI record, a public URL, or a labelled operator canary.

**Evidence point:** commit `d852db090cd0b72a50b1738afca9392332445810`
("Launch zero-cost web, browser, Notion, and IDE clients", PR #4, merged
2026-08-11T09:46:13Z). Release `integrations-v0.1.0`. Main-branch CI run
**31479201334** (12/12 jobs success). Audited 2026-08-11.

## Files

| File | Purpose |
|---|---|
| `paper-outline.md` | Thesis, RQ1-RQ5, contributions C-I-C-V, 21-section plan, negative-results section |
| `evidence-ledger.md` | Claims C1-C20 with evidence level, source, mandatory limitation, safe-for placement; plus the list of permanently refused claims |
| `platform-status.md` | **Canonical** L0-L4 availability table per surface |
| `reproducibility.md` | Commands re-executed and their results, live canaries, and the CI-run correction |
| `threat-model.md` | Adversaries, controls, what was actually verified, non-goals |
| `limitations.md` | Method, evidence, deployment and privacy limitations; threats to validity |
| `experiment-plan.md` | Benchmark plan, **partly executed**. Strata 1-4 and part of 5 are done; strata 6-7 and the annotation protocol are not |
| `benchmark/` | **GBSA-1**, the labelled per-probe benchmark: seeded generators, 112-item development split, 75-item held-out split, scoring code, determinism runs, `RESULTS.md` |
| `figures/architecture.mmd` | Request path from client through auth, admission, queue, Lite, projection, formatting |
| `figures/deployment-state.mmd` | Surfaces placed on the L0-L4 ladder |
| `tables/test-coverage.md` | 108 platform-layer tests, per-suite, with re-run status |
| `tables/platform-evidence.md` | Summary index into `platform-status.md` |
| `tables/claims-to-evidence.md` | Summary index into `evidence-ledger.md` |

## Authorship

**Karthik Barma** (first author), MS Artificial Intelligence, Khoury College of Computer
Sciences, Northeastern University. **Sarita Singh**, Associate Teaching Professor, Khoury
College of Computer Sciences, Northeastern University (Seattle campus). Co-authorship
confirmed by Karthik Barma on 2026-08-14; affiliation and title verified against the
public Khoury faculty page the same day.

Per AAAI policy, all authors are responsible for the entire content of the paper,
including every text, figure, reference, and claim. The draft must be reviewed and
approved by both authors before submission.

## Identity and legal wording

Developer/operator: **Karthik Barma**, individual developer. **Aura** is an unregistered
umbrella brand, not a company or legal entity. **TheBarmaEffect** is a GitHub/contact
handle, not a company. GlassBox charges no fee, accepts no payments, and sells nothing.
The deployed default is GlassBox Lite and requires no paid model API.

## Two distinct systems, never merge them

| | **GlassBox Lite** (this paper) | **`@glassbox-framework/mcp`** (older) |
|---|---|---|
| Surface | Public gateway `/mcp`, one tool | npm stdio MCP, six tools |
| Model API | **None required** | Most tools need the user's own `ANTHROPIC_API_KEY` |
| Determinism | Byte-identical output verified live | Assembly/hashing only, from prebuilt parts |

## Standing rules

1. Never collapse L0-L4 into "tested".
2. ECS is a **structural reasoning score**, never a truth probability.
3. Never describe a provider-controlled directory as published while it is pending.
4. Do not purchase APIs, enable paid plans, expose credentials, withdraw review
   submissions, rotate secrets, or mutate external platform accounts without explicit
   approval from Karthik Barma.
5. If a statement cannot be traced to source, test, CI, a public response, or a
   labelled operator canary, weaken it.
6. Quote GBSA-1 only from the **held-out** split, and only about the **five probes it
   scores**. The development split's post-repair score is tuned on the test set. The
   implementation emits thirteen probes, so eight are unmeasured, and no benchmark
   number says how often any of these failure modes occurs in practice.
