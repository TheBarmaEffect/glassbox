import { config } from "./config.js";
import { GatewayMetrics, verificationEvent, type RejectionKind } from "./metrics.js";
import { normalizeInput } from "./parser.js";
import type { Platform, TrustCard, VerificationInput, Verifier } from "./types.js";

export class DuplicateRequestError extends Error {}
export class QueueFullError extends Error {}
export class RateLimitError extends Error {}
export class AdmissionError extends Error {}
export class GlobalLimitError extends Error {}
export class JobTimeoutError extends Error {}

interface RunOptions {
  idempotencyKey: string;
  rateKey: string;
  tenantKey: string;
  /**
   * Which entry point this request arrived through, for the traffic counters only. The
   * HTTP surfaces name themselves ("verify", "govern", "mcp") because one platform value
   * can arrive through more than one of them; a platform adapter falls back to its own
   * platform name.
   */
  surface?: string;
}

interface QueueItem {
  input: VerificationInput;
  options: RunOptions;
  resolve: (card: TrustCard) => void;
  reject: (error: unknown) => void;
  deadline: number;
  /** When the request was admitted, so latency covers queue wait as well as the audit. */
  admittedAt: number;
}

interface AdmissionPolicy {
  allowPublic: boolean;
  publicPlatforms?: ReadonlySet<Platform>;
  tenants: Set<string>;
}

export class VerificationService {
  private active = 0;
  private readonly queue: QueueItem[] = [];
  private readonly inFlight = new Map<string, Promise<TrustCard>>();
  private readonly awaitingDelivery = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly seen = new Map<string, number>();
  private readonly rates = new Map<string, number[]>();
  private accepting = true;
  private dailyKey = "";
  private dailyCount = 0;
  // Every surface reaches the verifier through run(), so counting here is the only way to
  // count each request exactly once without repeating the same instrumentation in seven
  // adapters and drifting.
  private readonly gatewayMetrics = new GatewayMetrics();

  constructor(
    private readonly verifier: Verifier,
    private readonly maxConcurrency = config.maxConcurrency,
    private readonly maxQueue = config.maxQueue,
    private readonly rateLimit = config.rateLimit,
    private readonly dailyRequestLimit = config.dailyRequestLimit,
    private readonly estimatedJobMs = config.estimatedJobMs,
    private readonly jobTimeoutMs = config.jobTimeoutMs,
    private readonly admission: AdmissionPolicy = {
      allowPublic: config.allowPublic,
      publicPlatforms: config.publicPlatforms,
      tenants: config.pilotTenants,
    },
  ) {}

  run(input: VerificationInput, options: RunOptions): Promise<TrustCard> {
    this.cleanup();
    if (!this.accepting) return this.refuse("queue", new QueueFullError("Service is shutting down."));
    const tenantKey = options.tenantKey.toLowerCase();
    const platformIsPublic = this.admission.publicPlatforms?.has(input.platform) ?? false;
    if (!this.admission.allowPublic && !platformIsPublic && !this.admission.tenants.has(tenantKey)) {
      return this.refuse("admission", new AdmissionError("This community is not enabled for the GlassBox pilot."));
    }
    let normalized: VerificationInput;
    try {
      normalized = normalizeInput(input);
    } catch (error) {
      return this.refuse("input", error);
    }
    if (this.seen.has(options.idempotencyKey)) {
      return this.refuse("duplicate", new DuplicateRequestError("This event was already processed."));
    }
    if (this.inFlight.has(options.idempotencyKey)) {
      return this.refuse("duplicate", new DuplicateRequestError("This event is already being processed."));
    }
    try {
      this.enforceRateLimit(options.rateKey);
    } catch (error) {
      return this.refuse("rate", error);
    }
    this.resetDailyCounter();
    if (this.dailyCount >= this.dailyRequestLimit) {
      return this.refuse("global", new GlobalLimitError("The daily GlassBox pilot request limit has been reached."));
    }
    const estimatedCompletionMs = Math.ceil(
      (this.active + this.queue.length + 1) / this.maxConcurrency,
    ) * this.estimatedJobMs;
    if (estimatedCompletionMs > this.jobTimeoutMs) {
      return this.refuse("queue", new QueueFullError("GlassBox cannot finish within the platform response window."));
    }
    if (this.queue.length >= this.maxQueue) {
      return this.refuse("queue", new QueueFullError("GlassBox is at capacity. Try again shortly."));
    }

    this.dailyCount += 1;

    const pending = new Promise<TrustCard>((resolve, reject) => {
      this.queue.push({
        input: normalized,
        options,
        resolve,
        reject,
        deadline: Date.now() + this.jobTimeoutMs,
        admittedAt: Date.now(),
      });
      this.drain();
    });
    this.inFlight.set(options.idempotencyKey, pending);
    return pending;
  }

  status(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }

  /** In-process traffic counters. Aggregates only; see src/metrics.ts. */
  metrics(): GatewayMetrics {
    return this.gatewayMetrics;
  }

  markDelivered(idempotencyKey: string): void {
    this.clearDeliveryWait(idempotencyKey);
    this.inFlight.delete(idempotencyKey);
    this.seen.set(idempotencyKey, Date.now() + 24 * 60 * 60_000);
  }

  markDeliveryFailed(idempotencyKey: string): void {
    this.clearDeliveryWait(idempotencyKey);
    this.inFlight.delete(idempotencyKey);
  }

  async ready(): Promise<boolean> {
    return this.verifier.ready ? this.verifier.ready() : true;
  }

  stop(): void {
    this.accepting = false;
    for (const item of this.queue.splice(0)) {
      // Admitted but never verified, so it belongs in the refusal column rather than
      // silently vanishing from both sides of the ledger.
      this.gatewayMetrics.recordRejection("queue");
      item.reject(new QueueFullError("Service is shutting down."));
      this.inFlight.delete(item.options.idempotencyKey);
    }
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      if (item.deadline <= Date.now()) {
        this.gatewayMetrics.recordRejection("timeout");
        item.reject(new JobTimeoutError("GlassBox could not finish before the platform deadline."));
        this.inFlight.delete(item.options.idempotencyKey);
        continue;
      }
      this.active += 1;
      let timedOut = false;
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        this.active -= 1;
        if (!this.awaitingDelivery.has(item.options.idempotencyKey)) {
          this.inFlight.delete(item.options.idempotencyKey);
        }
        this.drain();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        this.gatewayMetrics.recordRejection("timeout");
        item.reject(new JobTimeoutError("GlassBox could not finish before the platform deadline."));
        try {
          const reset = this.verifier.reset?.();
          if (reset) void reset.catch(() => undefined);
        } catch {
          // A custom verifier may throw before returning its cleanup promise.
        } finally {
          // A provider reset is best-effort cleanup. It must never retain the
          // only worker slot after the caller's deadline has already expired.
          release();
        }
      }, item.deadline - Date.now());
      void this.verifier.verify(item.input).then(
        (card) => {
          // A late result after the deadline was already counted as a timeout. Counting it
          // again here would report more outcomes than there were requests.
          if (timedOut) return;
          this.count(item, card);
          const deliveryTimer = setTimeout(() => {
            this.awaitingDelivery.delete(item.options.idempotencyKey);
            this.inFlight.delete(item.options.idempotencyKey);
          }, 5 * 60_000);
          deliveryTimer.unref?.();
          this.awaitingDelivery.set(item.options.idempotencyKey, deliveryTimer);
          item.resolve(card);
        },
        (error) => {
          if (timedOut) return;
          this.gatewayMetrics.recordRejection("verifier");
          item.reject(error);
        },
      ).finally(() => {
        clearTimeout(timer);
        release();
      });
    }
  }

  /**
   * Refuse a request and count it. Every early return in run() goes through here so the
   * refusal column cannot silently miss a path when a new guard is added: the counter and
   * the rejection are the same statement.
   */
  private refuse(kind: RejectionKind, error: unknown): Promise<never> {
    this.gatewayMetrics.recordRejection(kind);
    return Promise.reject(error);
  }

  /**
   * Counting is strictly secondary to answering. A verifier that returns a card missing
   * the shape its own type promises would otherwise throw here, leaving the caller's
   * promise unsettled until the job deadline. An uncounted audit is a worse metric; a
   * stalled caller is a worse outage, so the outage loses.
   */
  private count(item: QueueItem, card: TrustCard): void {
    try {
      this.gatewayMetrics.recordVerification(verificationEvent(card, {
        surface: item.options.surface ?? item.input.platform,
        checkpoint_type: item.input.checkpoint?.type ?? "unspecified",
        latency_ms: Date.now() - item.admittedAt,
      }));
    } catch {
      // Deliberately swallowed. The tests assert exact counts, so a defect in the counters
      // fails there rather than degrading a live request.
    }
  }

  private enforceRateLimit(key: string): void {
    const cutoff = Date.now() - 10 * 60_000;
    const recent = (this.rates.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= this.rateLimit) {
      throw new RateLimitError("Rate limit reached. Try again in a few minutes.");
    }
    recent.push(Date.now());
    this.rates.set(key, recent);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, expires] of this.seen) if (expires <= now) this.seen.delete(key);
    const cutoff = now - 10 * 60_000;
    for (const [key, values] of this.rates) {
      const recent = values.filter((time) => time > cutoff);
      if (recent.length > 0) this.rates.set(key, recent);
      else this.rates.delete(key);
    }
  }

  private resetDailyCounter(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dailyKey) {
      this.dailyKey = key;
      this.dailyCount = 0;
    }
  }

  private clearDeliveryWait(idempotencyKey: string): void {
    const timer = this.awaitingDelivery.get(idempotencyKey);
    if (timer) clearTimeout(timer);
    this.awaitingDelivery.delete(idempotencyKey);
  }
}
