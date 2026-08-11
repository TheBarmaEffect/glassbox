import assert from "node:assert/strict";
import test from "node:test";
import {
  AdmissionError,
  DuplicateRequestError,
  GlobalLimitError,
  JobTimeoutError,
  RateLimitError,
  VerificationService,
} from "../src/service.js";
import type { TrustCard, VerificationInput, Verifier } from "../src/types.js";

function result(input: VerificationInput): TrustCard {
  return {
    question: input.question,
    answer: input.answer,
    verdict: "trust",
    verdict_rationale: "ok",
    ecs: { total: 0.9, dimensions: {}, notes: [] },
    claims: [],
    red_team: { probes: [], pass_rate: 1, highest_severity: "low" },
    constitution: { rules: [] },
    audit: { log_id: "id", generated_at: "now", inputs_hash: "hash" },
  };
}

function testService(verifier: Verifier, maxConcurrency = 1, rateLimit = 10): VerificationService {
  return new VerificationService(
    verifier,
    maxConcurrency,
    10,
    rateLimit,
    100,
    60_000,
    10 * 60_000,
    { allowPublic: true, tenants: new Set() },
  );
}

test("deduplicates completed platform events without retaining input in the seen set", async () => {
  const verifier: Verifier = { verify: async (input) => result(input) };
  const service = testService(verifier);
  const input: VerificationInput = { question: "q", answer: "a", platform: "discord" };
  await service.run(input, { idempotencyKey: "event-1", rateKey: "user-1", tenantKey: "api" });
  await assert.rejects(
    service.run(input, { idempotencyKey: "event-1", rateKey: "user-1", tenantKey: "api" }),
    DuplicateRequestError,
  );
});

test("rejects an in-flight provider retry instead of emitting duplicate replies", async () => {
  let release: (() => void) | undefined;
  const verifier: Verifier = {
    verify: async (input) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return result(input);
    },
  };
  const service = testService(verifier);
  const input: VerificationInput = { question: "q", answer: "a", platform: "github" };
  const first = service.run(input, {
    idempotencyKey: "delivery-1",
    rateKey: "user-1",
    tenantKey: "github:owner/repo",
  });
  await assert.rejects(
    service.run(input, {
      idempotencyKey: "delivery-1",
      rateKey: "user-1",
      tenantKey: "github:owner/repo",
    }),
    DuplicateRequestError,
  );
  release?.();
  await first;
});

test("enforces per-requester rate limits before invoking GlassBox", async () => {
  const verifier: Verifier = { verify: async (input) => result(input) };
  const service = testService(verifier, 1, 1);
  const input: VerificationInput = { question: "q", answer: "a", platform: "api" };
  await service.run(input, { idempotencyKey: "event-1", rateKey: "user-1", tenantKey: "api" });
  await assert.rejects(
    async () => service.run(input, {
      idempotencyKey: "event-2",
      rateKey: "user-1",
      tenantKey: "api",
    }),
    RateLimitError,
  );
});

test("defaults to explicit pilot-tenant admission", async () => {
  const verifier: Verifier = { verify: async (input) => result(input) };
  const service = new VerificationService(
    verifier,
    1,
    10,
    10,
    100,
    60_000,
    10 * 60_000,
    { allowPublic: false, tenants: new Set(["discord:approved"]) },
  );
  const input: VerificationInput = { question: "q", answer: "a", platform: "discord" };
  await assert.rejects(service.run(input, {
    idempotencyKey: "event-1",
    rateKey: "user-1",
    tenantKey: "discord:unapproved",
  }), AdmissionError);
});

test("stops accepting work at the global daily pilot ceiling", async () => {
  const verifier: Verifier = { verify: async (input) => result(input) };
  const service = new VerificationService(
    verifier,
    1,
    10,
    10,
    1,
    60_000,
    10 * 60_000,
    { allowPublic: true, tenants: new Set() },
  );
  const input: VerificationInput = { question: "q", answer: "a", platform: "api" };
  await service.run(input, { idempotencyKey: "event-1", rateKey: "user-1", tenantKey: "api" });
  await assert.rejects(service.run(input, {
    idempotencyKey: "event-2",
    rateKey: "user-2",
    tenantKey: "api",
  }), GlobalLimitError);
});

test("times out stalled verification and resets the MCP transport", async () => {
  let resets = 0;
  const verifier: Verifier = {
    verify: async () => new Promise<TrustCard>(() => undefined),
    reset: async () => { resets += 1; },
  };
  const service = new VerificationService(
    verifier,
    1,
    10,
    10,
    100,
    1,
    10,
    { allowPublic: true, tenants: new Set() },
  );
  await assert.rejects(service.run(
    { question: "q", answer: "a", platform: "discord" },
    { idempotencyKey: "timeout", rateKey: "user", tenantKey: "discord:guild" },
  ), JobTimeoutError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resets, 1);
  assert.deepEqual(service.status(), { active: 0, queued: 0 });
});

test("releases the worker slot even when provider reset never settles", async () => {
  let calls = 0;
  const verifier: Verifier = {
    verify: async (input) => {
      calls += 1;
      if (calls === 1) return new Promise<TrustCard>(() => undefined);
      return result(input);
    },
    reset: async () => new Promise<void>(() => undefined),
  };
  const service = new VerificationService(
    verifier,
    1,
    10,
    10,
    100,
    1,
    10,
    { allowPublic: true, tenants: new Set() },
  );
  const input: VerificationInput = { question: "q", answer: "a", platform: "discord" };
  await assert.rejects(service.run(input, {
    idempotencyKey: "timeout-first",
    rateKey: "user-1",
    tenantKey: "discord:guild",
  }), JobTimeoutError);
  const card = await service.run(input, {
    idempotencyKey: "after-timeout",
    rateKey: "user-2",
    tenantKey: "discord:guild",
  });
  assert.equal(card.verdict, "trust");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(service.status(), { active: 0, queued: 0 });
});

test("keeps an event reserved through delivery and releases it after delivery failure", async () => {
  let calls = 0;
  const verifier: Verifier = {
    verify: async (input) => {
      calls += 1;
      return result(input);
    },
  };
  const service = testService(verifier);
  const input: VerificationInput = { question: "q", answer: "a", platform: "github" };
  const options = {
    idempotencyKey: "delivery-reservation",
    rateKey: "user",
    tenantKey: "github:owner/repo",
  };
  await service.run(input, options);
  await assert.rejects(service.run(input, options), DuplicateRequestError);
  service.markDeliveryFailed(options.idempotencyKey);
  await service.run(input, options);
  assert.equal(calls, 2);
});

test("bounds GlassBox concurrency", async () => {
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const verifier: Verifier = {
    verify: async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return result(input);
    },
  };
  const service = testService(verifier, 2);
  const requests = [0, 1, 2].map((index) => service.run(
    { question: `q${index}`, answer: "a", platform: "api" },
    { idempotencyKey: `event-${index}`, rateKey: `user-${index}`, tenantKey: "api" },
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  await Promise.all(requests);
  assert.equal(peak, 2);
});
