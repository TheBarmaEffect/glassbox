import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import {
  GatewayMetrics,
  MAX_LABEL_CARDINALITY,
  OVERFLOW_LABEL,
  TRACKED_PROBE_ANGLES,
  probeLabel,
  verificationEvent,
  type VerificationEvent,
} from "../src/metrics.js";
import type { RedTeamProbe, ResponseAction, TrustCard, Verifier } from "../src/types.js";

process.env.PLATFORM_SHARED_SECRET = "metrics-test-secret";
process.env.PLATFORM_ALLOW_PUBLIC = "false";
process.env.PLATFORM_PUBLIC_PLATFORMS = "mcp";
process.env.PILOT_TENANT_ALLOWLIST = "api";

const { buildServer } = await import("../src/server.js");
const { VerificationService } = await import("../src/service.js");
const { GlassboxLiteVerifier } = await import("../src/lite.js");

type Service = InstanceType<typeof VerificationService>;

function trustCard(overrides: Partial<TrustCard> = {}): TrustCard {
  return {
    question: "q",
    answer: "a",
    verdict: "trust",
    verdict_rationale: "ok",
    ecs: { total: 0.9, dimensions: {}, notes: [] },
    claims: [],
    red_team: { probes: [], pass_rate: 1, highest_severity: "low" },
    constitution: { rules: [] },
    governance: {
      checkpoint: { id: "submitted-answer", type: "final_output" },
      constitution_version: "glassbox-lite/builtin-v1",
      response: { action: "allow", executed: false, policy_downgrade_refused: false, rationale: "ok" },
    },
    audit: { log_id: "id", generated_at: "now", inputs_hash: "hash" },
    ...overrides,
  };
}

function governed(action: ResponseAction, verdict: TrustCard["verdict"]): TrustCard {
  return trustCard({
    verdict,
    governance: {
      checkpoint: { id: "submitted-answer", type: "final_output" },
      constitution_version: "glassbox-lite/builtin-v1",
      response: { action, executed: false, policy_downgrade_refused: false, rationale: "ok" },
    },
  });
}

function testService(verifier: Verifier, rateLimit = 100, dailyLimit = 1_000): Service {
  return new VerificationService(
    verifier,
    1,
    50,
    rateLimit,
    dailyLimit,
    60_000,
    10 * 60_000,
    { allowPublic: true, tenants: new Set() },
  );
}

function event(overrides: Partial<VerificationEvent> = {}): VerificationEvent {
  return {
    surface: "verify",
    verdict: "trust",
    action: "allow",
    released: true,
    checkpoint_type: "unspecified",
    highest_severity: "low",
    constitution_version: "glassbox-lite/builtin-v1",
    probe_outcomes: {},
    latency_ms: 10,
    claim_count: 0,
    ...overrides,
  };
}

const liteService = new VerificationService(new GlassboxLiteVerifier(), 1, 50, 100);
const app = buildServer(liteService);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(() => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test("verification counts are exact across surfaces, verdicts, actions, and release decisions", async () => {
  const cards = [
    governed("allow", "trust"),
    governed("record", "caution"),
    governed("block", "reject"),
    governed("retry", "caution"),
    governed("escalate", "reject"),
  ];
  let index = 0;
  const service = testService({ verify: async () => cards[index++] ?? trustCard() });
  const surfaces = ["verify", "govern", "govern", "mcp", "verify"];
  for (let run = 0; run < cards.length; run += 1) {
    await service.run(
      { question: "q", answer: "a", platform: "api" },
      { idempotencyKey: `event-${run}`, rateKey: `caller-${run}`, tenantKey: "api", surface: surfaces[run] },
    );
  }

  const snapshot = service.metrics().snapshot();
  assert.equal(snapshot.verifications.total, 5);
  assert.deepEqual(snapshot.verifications.by_surface, { govern: 2, mcp: 1, verify: 2 });
  assert.deepEqual(snapshot.verifications.by_verdict, { caution: 2, reject: 2, trust: 1 });
  assert.deepEqual(snapshot.verifications.by_action, { allow: 1, block: 1, escalate: 1, record: 1, retry: 1 });
  assert.equal(snapshot.verifications.released, 2);
  assert.equal(snapshot.verifications.withheld, 3);
  assert.equal(snapshot.rejections.total, 0);
  assert.equal(snapshot.latency_ms.count, 5);
});

test("a surface falls back to the platform name when an adapter does not name itself", async () => {
  const service = testService({ verify: async () => trustCard() });
  await service.run(
    { question: "q", answer: "a", platform: "discord" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "discord:guild" },
  );
  assert.deepEqual(service.metrics().snapshot().verifications.by_surface, { discord: 1 });
});

test("checkpoint types are counted as the caller declared them, not as the engine defaulted them", async () => {
  const service = testService({ verify: async () => trustCard() });
  await service.run(
    { question: "q", answer: "a", platform: "api", checkpoint: { id: "step-1", type: "tool_call" } },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "govern" },
  );
  // The card that comes back declares final_output, because that is what the engine
  // substitutes when nothing was declared. The counter must report what the caller
  // actually integrated at, which is the only thing that says where the gateway is used.
  await service.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-2", rateKey: "caller-2", tenantKey: "api", surface: "govern" },
  );

  const byCheckpoint = service.metrics().snapshot().verifications.by_checkpoint_type;
  assert.equal(byCheckpoint.tool_call, 1);
  assert.equal(byCheckpoint.unspecified, 1);
  assert.equal(byCheckpoint.final_output, 0);
});

test("rejections are counted apart from verifications, by the reason they were refused", async () => {
  const rateLimited = testService({ verify: async () => trustCard() }, 1);
  await rateLimited.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  );
  await assert.rejects(rateLimited.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-2", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  ));

  const rateSnapshot = rateLimited.metrics().snapshot();
  assert.equal(rateSnapshot.verifications.total, 1);
  assert.equal(rateSnapshot.rejections.total, 1);
  assert.equal(rateSnapshot.rejections.by_kind.rate, 1);
  // A refused request never reached the verifier, so it must not land in the verdict
  // denominator or in the latency distribution.
  assert.equal(rateSnapshot.latency_ms.count, 1);
  assert.equal(
    Object.values(rateSnapshot.verifications.by_verdict).reduce((total, count) => total + count, 0),
    1,
  );

  const gated = new VerificationService(
    { verify: async () => trustCard() },
    1, 50, 100, 1_000, 60_000, 10 * 60_000,
    { allowPublic: false, tenants: new Set(["api"]) },
  );
  await assert.rejects(gated.run(
    { question: "q", answer: "a", platform: "discord" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "discord:not-enrolled" },
  ));
  assert.equal(gated.metrics().snapshot().rejections.by_kind.admission, 1);

  const badInput = testService({ verify: async () => trustCard() });
  await assert.rejects(badInput.run(
    { question: "   ", answer: "a", platform: "api" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  ));
  assert.equal(badInput.metrics().snapshot().rejections.by_kind.input, 1);
  assert.equal(badInput.metrics().snapshot().verifications.total, 0);

  const failing = testService({ verify: async () => { throw new Error("provider down"); } });
  await assert.rejects(failing.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  ));
  const failedSnapshot = failing.metrics().snapshot();
  assert.equal(failedSnapshot.rejections.by_kind.verifier, 1);
  assert.equal(failedSnapshot.verifications.total, 0);

  const capped = testService({ verify: async () => trustCard() }, 100, 1);
  await capped.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  );
  await assert.rejects(capped.run(
    { question: "q", answer: "a", platform: "api" },
    { idempotencyKey: "event-2", rateKey: "caller-2", tenantKey: "api", surface: "verify" },
  ));
  assert.equal(capped.metrics().snapshot().rejections.by_kind.global, 1);
});

test("a retried delivery is counted once as a verification and once as a duplicate", async () => {
  const service = testService({ verify: async () => trustCard() });
  const options = { idempotencyKey: "delivery-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" };
  await service.run({ question: "q", answer: "a", platform: "api" }, options);
  service.markDelivered(options.idempotencyKey);

  // The same platform event delivered twice is one audit, not two.
  await assert.rejects(service.run({ question: "q", answer: "a", platform: "api" }, options));
  await assert.rejects(service.run({ question: "q", answer: "a", platform: "api" }, options));

  const snapshot = service.metrics().snapshot();
  assert.equal(snapshot.verifications.total, 1);
  assert.equal(snapshot.latency_ms.count, 1);
  assert.equal(snapshot.rejections.total, 2);
  assert.equal(snapshot.rejections.by_kind.duplicate, 2);
});

test("an in-flight retry is counted as a duplicate without a second verification", async () => {
  let release: (() => void) | undefined;
  const service = testService({
    verify: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return trustCard();
    },
  });
  const options = { idempotencyKey: "delivery-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" };
  const first = service.run({ question: "q", answer: "a", platform: "api" }, options);
  await assert.rejects(service.run({ question: "q", answer: "a", platform: "api" }, options));
  release?.();
  await first;

  const snapshot = service.metrics().snapshot();
  assert.equal(snapshot.verifications.total, 1);
  assert.equal(snapshot.rejections.by_kind.duplicate, 1);
});

test("the metrics payload never echoes submitted content, claim text, or any hash of it", async () => {
  const sentinel = "PRIVATE-CONTENT-DO-NOT-ECHO-8f3a1c";
  const question = `What did ${sentinel} report in 2026?`;
  const answer = `${sentinel} definitively proved that 2 + 2 = 5 and 100% of experts agree.`;

  // Leg one: the real deterministic engine, so claim text, probe findings, probe evidence
  // and a genuine sha256 of the submitted content all actually exist on the card.
  const live = testService(new GlassboxLiteVerifier());
  await live.run(
    {
      question,
      answer,
      platform: "api",
      constitution: {
        version: "tenant-policy/v3",
        rules: [{
          id: `${sentinel}-rule`,
          requirement: `Never mention ${sentinel}.`,
          kind: "forbid_phrase",
          value: sentinel,
          severity: "high",
        }],
      },
    },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  );

  // Leg two: a hostile verifier that stuffs the sentinel into every free-text field a card
  // has, including the probe angle, which is the one label that comes from the engine.
  const hostileProbe: RedTeamProbe = {
    angle: `${sentinel}_angle`,
    passed: false,
    severity: "critical",
    finding: `${sentinel}-finding`,
    evidence: [`${sentinel}-probe-evidence`],
  };
  const hostile = testService({
    verify: async () => trustCard({
      question,
      answer,
      verdict: "reject",
      verdict_rationale: `${sentinel}-rationale`,
      ecs: { total: 0.1, dimensions: { [`${sentinel}-dimension`]: 0 }, notes: [`${sentinel}-note`] },
      claims: [{
        id: `${sentinel}-claim-id`,
        text: `${sentinel}-claim-text`,
        reasoning: `${sentinel}-reasoning`,
        confidence: 0.1,
        supporting_evidence: [`${sentinel}-evidence`],
        attack_surface: [`${sentinel}-attack`],
        status: "observed",
      }],
      red_team: { probes: [hostileProbe], pass_rate: 0, highest_severity: "critical" },
      audit: {
        log_id: `${sentinel}-log-id`,
        generated_at: `${sentinel}-generated-at`,
        inputs_hash: crypto.createHash("sha256").update(`${question}${answer}`).digest("hex"),
      },
    }),
  });
  await hostile.run(
    { question, answer, platform: "api" },
    { idempotencyKey: "event-1", rateKey: "caller-1", tenantKey: "api", surface: "verify" },
  );

  for (const snapshot of [live.metrics().snapshot(), hostile.metrics().snapshot()]) {
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, new RegExp(sentinel));
    assert.doesNotMatch(serialized, /definitively proved|100% of experts|report in 2026/);

    // A hash of content is still content-derived, so no digest of the submitted strings may
    // appear either, and neither may any long hex run that could be one.
    for (const algorithm of ["md5", "sha1", "sha256"]) {
      for (const source of [sentinel, question, answer, `${question}${answer}`]) {
        assert.doesNotMatch(serialized, new RegExp(crypto.createHash(algorithm).update(source).digest("hex")));
      }
    }
    assert.doesNotMatch(serialized, /[a-f0-9]{16,}/);
  }

  // The hostile probe angle is not on the fixed label list, so it is counted as `other`
  // rather than published.
  const hostileSnapshot = hostile.metrics().snapshot();
  assert.equal(hostileSnapshot.verifications.total, 1);
  assert.deepEqual(hostileSnapshot.probe_fire_rate[OVERFLOW_LABEL], { evaluated: 1, fired: 1, fire_rate: 1 });

  // The caller's constitution rule id travels inside the probe angle, so constitution
  // probes collapse to one label that keeps the signal and drops the id.
  const liveSnapshot = live.metrics().snapshot();
  assert.ok((liveSnapshot.probe_fire_rate.constitution_rule?.evaluated ?? 0) > 0);
  assert.equal(liveSnapshot.verifications.by_constitution_version["tenant-policy/v3"], 1);
});

test("a constitution version becomes a label only when it looks like a version identifier", () => {
  const metrics = new GatewayMetrics();
  metrics.recordVerification(event({ constitution_version: "tenant-policy/v3" }));
  metrics.recordVerification(event({ constitution_version: "glassbox-lite/builtin-v1" }));
  // Free text is not a version identifier. It is the shape a caller would use to smuggle
  // content into a public payload, so it never earns a key of its own.
  metrics.recordVerification(event({ constitution_version: "the user asked about their test results" }));
  metrics.recordVerification(event({ constitution_version: "x".repeat(200) }));

  assert.deepEqual(metrics.snapshot().verifications.by_constitution_version, {
    "glassbox-lite/builtin-v1": 1,
    other: 2,
    "tenant-policy/v3": 1,
  });
});

test("distinct constitution versions cannot grow memory without limit", () => {
  const metrics = new GatewayMetrics();
  const flood = 5_000;
  for (let index = 0; index < flood; index += 1) {
    metrics.recordVerification(event({ constitution_version: `attacker-v${index}` }));
  }

  const versions = metrics.snapshot().verifications.by_constitution_version;
  // Exactly the cap, plus the one reserved overflow bucket.
  assert.equal(Object.keys(versions).length, MAX_LABEL_CARDINALITY + 1);
  assert.equal(versions[OVERFLOW_LABEL], flood - MAX_LABEL_CARDINALITY);
  assert.equal(versions["attacker-v0"], 1);
  // Nothing is lost, it just stops being labelled individually.
  assert.equal(Object.values(versions).reduce((total, count) => total + count, 0), flood);
  assert.equal(metrics.snapshot().verifications.total, flood);
});

test("distinct surfaces are capped the same way", () => {
  const metrics = new GatewayMetrics();
  for (let index = 0; index < 200; index += 1) metrics.recordVerification(event({ surface: `surface-${index}` }));

  const surfaces = metrics.snapshot().verifications.by_surface;
  assert.equal(Object.keys(surfaces).length, MAX_LABEL_CARDINALITY + 1);
  assert.equal(surfaces[OVERFLOW_LABEL], 200 - MAX_LABEL_CARDINALITY);
});

test("latency percentiles are the bucket bounds a known distribution falls in", () => {
  const metrics = new GatewayMetrics();
  const distribution: Array<[number, number]> = [[10, 50], [100, 45], [1_000, 5]];
  for (const [latency, count] of distribution) {
    for (let index = 0; index < count; index += 1) metrics.recordVerification(event({ latency_ms: latency }));
  }

  const latency = metrics.snapshot().latency_ms;
  assert.equal(latency.count, 100);
  // Nearest rank: the 50th sample is 10ms, the 95th is 100ms, the 99th is 1000ms.
  assert.equal(latency.p50, 10);
  assert.equal(latency.p95, 100);
  assert.equal(latency.p99, 1_000);

  const cumulative = Object.fromEntries(latency.buckets.map((bucket) => [String(bucket.le), bucket.count]));
  assert.equal(cumulative["10"], 50);
  assert.equal(cumulative["100"], 95);
  assert.equal(cumulative["1000"], 100);
  assert.equal(cumulative.null, 100);
});

test("a latency between bounds reports the bound above it, and an empty histogram reports nothing", () => {
  const empty = new GatewayMetrics().snapshot().latency_ms;
  assert.equal(empty.count, 0);
  assert.deepEqual([empty.p50, empty.p95, empty.p99], [null, null, null]);

  const metrics = new GatewayMetrics();
  for (let index = 0; index < 10; index += 1) metrics.recordVerification(event({ latency_ms: 26 }));
  assert.equal(metrics.snapshot().latency_ms.p50, 50);

  // A sample above the largest bound has no upper bound to report, and the honest answer is
  // null rather than a number the histogram cannot know.
  const overflowed = new GatewayMetrics();
  for (let index = 0; index < 10; index += 1) overflowed.recordVerification(event({ latency_ms: 900_000 }));
  const overflowSnapshot = overflowed.snapshot().latency_ms;
  assert.equal(overflowSnapshot.p50, null);
  assert.equal(overflowSnapshot.count, 10);
  assert.equal(overflowSnapshot.buckets.at(-1)?.count, 10);
});

test("probe fire rate is fired over evaluated, and unevaluated probes are left out", () => {
  const metrics = new GatewayMetrics();
  const outcomes = [
    { unsupported_certainty: true, arithmetic_sanity: true },
    { unsupported_certainty: false, arithmetic_sanity: true },
    { unsupported_certainty: true, arithmetic_sanity: true },
    { unsupported_certainty: true, arithmetic_sanity: true },
  ];
  for (const probe_outcomes of outcomes) metrics.recordVerification(event({ probe_outcomes }));

  const fireRate = metrics.snapshot().probe_fire_rate;
  assert.deepEqual(fireRate.unsupported_certainty, { evaluated: 4, fired: 1, fire_rate: 0.25 });
  assert.deepEqual(fireRate.arithmetic_sanity, { evaluated: 4, fired: 0, fire_rate: 0 });
  // A probe that never ran is not evidence about that probe.
  assert.equal(fireRate.credential_exposure, undefined);
  assert.equal(fireRate.tool_declaration_drift, undefined);
});

test("probe labels come from a fixed set, with caller rule ids collapsed and strangers bucketed", () => {
  assert.equal(probeLabel("credential_exposure"), "credential_exposure");
  assert.equal(probeLabel("tool_declaration_drift"), "tool_declaration_drift");
  assert.equal(probeLabel("constitution:no-medical-advice"), "constitution_rule");
  assert.equal(probeLabel("constitution:PATIENT-NAME-JANE-DOE"), "constitution_rule");
  assert.equal(probeLabel("something_a_verifier_invented"), OVERFLOW_LABEL);
});

test("the tracked probe set stays in step with the advertised capability contract", async () => {
  const body = await (await fetch(`${base}/api/v1/capabilities`)).json() as {
    deterministic_probes: string[];
    tool_invocation_probes: string[];
  };
  // A probe added to the contract but not to the metrics label set would silently be
  // counted as `other`, understating the very check that had just been added.
  assert.deepEqual(
    [...TRACKED_PROBE_ANGLES].sort(),
    [...body.deterministic_probes, ...body.tool_invocation_probes].sort(),
  );
});

test("verificationEvent reads only categorical fields and mirrors the gate's fail-closed default", () => {
  const derived = verificationEvent(trustCard({ governance: undefined }), {
    surface: "verify",
    checkpoint_type: "unspecified",
    latency_ms: 5,
  });
  // api.ts defaults a card without governance to block. The counter has to agree with the
  // gate rather than publish a second, divergent reading of the same card.
  assert.equal(derived.action, "block");
  assert.equal(derived.released, false);
  assert.equal(derived.constitution_version, "unspecified");
  assert.deepEqual(Object.keys(derived).sort(), [
    "action", "checkpoint_type", "claim_count", "constitution_version", "highest_severity",
    "latency_ms", "probe_outcomes", "released", "surface", "verdict",
  ]);
});

test("the same traffic always serializes to the same bytes", () => {
  const build = (): GatewayMetrics => {
    const metrics = new GatewayMetrics(1_764_000_000_000);
    metrics.recordVerification(event({ surface: "mcp", probe_outcomes: { prompt_injection: false } }));
    metrics.recordVerification(event({ surface: "verify", verdict: "reject", action: "block", released: false }));
    metrics.recordRejection("rate");
    return metrics;
  };
  assert.equal(
    JSON.stringify(build().snapshot(1_764_000_060_000)),
    JSON.stringify(build().snapshot(1_764_000_060_000)),
  );
  assert.equal(build().snapshot(1_764_000_060_000).uptime_s, 60);
  assert.equal(build().snapshot(1_764_000_060_000).since, "2025-11-24T16:00:00.000Z");
});

test("the metrics endpoint is public and reflects real traffic through the authenticated gate", async () => {
  const unauthenticated = await fetch(`${base}/api/v1/metrics`);
  assert.equal(unauthenticated.status, 200);
  assert.match(unauthenticated.headers.get("content-type") ?? "", /^application\/json/);

  const verify = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { authorization: "Bearer metrics-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ question: "What is 2 + 2?", answer: "2 + 2 = 4." }),
  });
  assert.equal(verify.status, 200);

  const refused = await fetch(`${base}/api/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q", answer: "a" }),
  });
  assert.equal(refused.status, 401);

  const body = await (await fetch(`${base}/api/v1/metrics`)).json() as {
    verifications: { total: number; by_surface: Record<string, number> };
    rejections: { total: number };
    uptime_s: number;
    notes: string[];
  };
  assert.equal(body.verifications.total, 1);
  assert.equal(body.verifications.by_surface.verify, 1);
  // An unauthenticated caller is turned away by the router before reaching the service, so
  // it is not a refused submission and must not be counted as one.
  assert.equal(body.rejections.total, 0);
  assert.equal(typeof body.uptime_s, "number");
  assert.ok(body.notes.some((note) => /not a durable audit log/.test(note)));
  assert.doesNotMatch(JSON.stringify(body), /2 \+ 2/);
});

test("capabilities advertises the metrics endpoint and says plainly what it is not", async () => {
  const body = await (await fetch(`${base}/api/v1/capabilities`)).json() as {
    metrics_endpoint: Record<string, string>;
    limitations: string[];
  };
  assert.deepEqual(body.metrics_endpoint, {
    path: "/api/v1/metrics",
    authentication: "none",
    content: "aggregate counters only",
    durability: "in_memory_until_restart",
  });
  assert.ok(body.limitations.includes(
    "Traffic counters at /api/v1/metrics are in-memory aggregates that reset when the instance restarts; they record categorical outcomes and integers only, never submitted content, and they are not a durable audit log.",
  ));
});

// ---------------------------------------------------------------------------
// Label coverage.
//
// `probeLabel` buckets any unknown angle into "other", so a probe missing from
// TRACKED_PROBE_ANGLES is counted but not named. That shipped: the live
// endpoint reported `{arithmetic_sanity: 1, other: 1}` while the second fire
// was `citation_resolvability`. A fire rate filed under "other" is not usable
// per-probe evidence, so the list is checked against what the verifier really
// emits rather than maintained by hand.
// ---------------------------------------------------------------------------

test("every probe angle the verifier can emit has its own metrics label", async () => {
  const { GlassboxLiteVerifier } = await import("../src/lite.js");
  const { probeLabel, OVERFLOW_LABEL } = await import("../src/metrics.js");
  const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

  const cards = await Promise.all([
    verifier.verify({ platform: "api", question: "Sources?", answer: "See ISBN 978-0-13-235088-7." }),
    verifier.verify({ platform: "api", question: "Compute it.", answer: "2 + 2 = 5. It never fails." }),
    verifier.verify({
      platform: "api", question: "Read it.", answer: "Calling read_file.",
      checkpoint: { id: "c", type: "tool_call" },
      tool: { tool: "read_file", arguments: { path: "a.txt" },
        declaration: { name: "read_file", description: "Read a file.", input_schema: { type: "object" } } },
      allowed_tools: ["read_file"],
    }),
  ]);

  const overflowed: string[] = [];
  for (const card of cards) {
    for (const probe of card.red_team.probes) {
      if (probe.angle.startsWith("constitution:")) continue; // deliberately collapsed
      if (probeLabel(probe.angle) === OVERFLOW_LABEL) overflowed.push(probe.angle);
    }
  }
  assert.deepEqual([...new Set(overflowed)], [], "probe angles falling into the overflow bucket");
});
