import { config } from "./config.js";
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
}

interface QueueItem {
  input: VerificationInput;
  options: RunOptions;
  resolve: (card: TrustCard) => void;
  reject: (error: unknown) => void;
  deadline: number;
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
    if (!this.accepting) return Promise.reject(new QueueFullError("Service is shutting down."));
    const tenantKey = options.tenantKey.toLowerCase();
    const platformIsPublic = this.admission.publicPlatforms?.has(input.platform) ?? false;
    if (!this.admission.allowPublic && !platformIsPublic && !this.admission.tenants.has(tenantKey)) {
      return Promise.reject(new AdmissionError("This community is not enabled for the GlassBox pilot."));
    }
    let normalized: VerificationInput;
    try {
      normalized = normalizeInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.seen.has(options.idempotencyKey)) {
      return Promise.reject(new DuplicateRequestError("This event was already processed."));
    }
    if (this.inFlight.has(options.idempotencyKey)) {
      return Promise.reject(new DuplicateRequestError("This event is already being processed."));
    }
    try {
      this.enforceRateLimit(options.rateKey);
    } catch (error) {
      return Promise.reject(error);
    }
    this.resetDailyCounter();
    if (this.dailyCount >= this.dailyRequestLimit) {
      return Promise.reject(new GlobalLimitError("The daily GlassBox pilot request limit has been reached."));
    }
    const estimatedCompletionMs = Math.ceil(
      (this.active + this.queue.length + 1) / this.maxConcurrency,
    ) * this.estimatedJobMs;
    if (estimatedCompletionMs > this.jobTimeoutMs) {
      return Promise.reject(new QueueFullError("GlassBox cannot finish within the platform response window."));
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new QueueFullError("GlassBox is at capacity. Try again shortly."));
    }

    this.dailyCount += 1;

    const pending = new Promise<TrustCard>((resolve, reject) => {
      this.queue.push({
        input: normalized,
        options,
        resolve,
        reject,
        deadline: Date.now() + this.jobTimeoutMs,
      });
      this.drain();
    });
    this.inFlight.set(options.idempotencyKey, pending);
    return pending;
  }

  status(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
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
          if (timedOut) return;
          const deliveryTimer = setTimeout(() => {
            this.awaitingDelivery.delete(item.options.idempotencyKey);
            this.inFlight.delete(item.options.idempotencyKey);
          }, 5 * 60_000);
          deliveryTimer.unref?.();
          this.awaitingDelivery.set(item.options.idempotencyKey, deliveryTimer);
          item.resolve(card);
        },
        (error) => {
          if (!timedOut) item.reject(error);
        },
      ).finally(() => {
        clearTimeout(timer);
        release();
      });
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
