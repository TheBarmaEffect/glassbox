import { config } from "./config.js";
import { formatPlainTrustCard } from "./formatter.js";
import { DuplicateRequestError, VerificationService } from "./service.js";

interface RedditThing<T> { kind: string; data: T }
interface RedditListing<T> { data: { children: Array<RedditThing<T>> } }
interface RedditMention {
  name: string;
  body: string;
  parent_id?: string;
  subreddit?: string;
  link_title?: string;
  author?: string;
}
interface RedditContent {
  body?: string;
  selftext?: string;
  title?: string;
}

export const REDDIT_UNREAD_PATH = "/message/unread?limit=25&raw_json=1";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export function isExplicitRedditMention(body: string, username: string): boolean {
  const normalized = username.replace(/^\/?u\//i, "");
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)/?u/${escaped}(?=\\s|$|[.,:;!?])`, "i").test(body);
}

export function redditRateDelayMs(
  headers: Headers,
  status: number,
  fallbackBackoffMs = INITIAL_BACKOFF_MS,
): number {
  const retryAfterMs = durationHeaderMs(headers.get("retry-after"));
  const resetMs = secondsHeaderMs(headers.get("x-ratelimit-reset"));
  const remaining = numberHeader(headers.get("x-ratelimit-remaining"));
  if (status === 429) return Math.max(retryAfterMs, resetMs, fallbackBackoffMs);
  if (status >= 500) return Math.max(retryAfterMs, fallbackBackoffMs);
  if (remaining !== undefined && remaining < 5) return resetMs;
  return 0;
}

export class RedditWorker {
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private accessToken: { value: string; expires: number } | undefined;
  private nextRequestAt = 0;
  private backoffMs = INITIAL_BACKOFF_MS;

  constructor(private readonly service: VerificationService) {}

  get enabled(): boolean {
    return Boolean(
      config.reddit.approved && config.reddit.clientId && config.reddit.clientSecret && config.reddit.username &&
      config.reddit.password && config.reddit.userAgent && config.reddit.subreddits.size > 0,
    );
  }

  start(): void {
    if (!this.enabled || !this.stopped) return;
    this.stopped = false;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const listing = await this.api<RedditListing<RedditMention>>(
        REDDIT_UNREAD_PATH,
      );
      for (const child of listing.data.children) {
        if (child.kind !== "t1" || !isExplicitRedditMention(child.data.body, config.reddit.username ?? "")) {
          continue;
        }
        await this.handleMention(child.data).catch((error) => {
          console.error(`Reddit mention handling failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } catch (error) {
      console.error(`Reddit poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!this.stopped) {
        const delayMs = Math.max(config.reddit.pollIntervalMs, this.nextRequestAt - Date.now());
        this.timer = setTimeout(() => void this.poll(), delayMs);
      }
    }
  }

  private async handleMention(mention: RedditMention): Promise<void> {
    const subreddit = mention.subreddit?.toLowerCase();
    if (!subreddit || !mention.parent_id) return;
    if (!config.reddit.subreddits.has(subreddit) || !/\b(?:verify|analyze|audit)\b/i.test(mention.body)) {
      await this.markRead(mention.name);
      return;
    }
    const eventKey = `reddit:${mention.name}`;
    let verificationComplete = false;
    let deliveryComplete = false;
    try {
      const parent = await this.api<RedditListing<RedditContent>>(
        `/api/info?id=${encodeURIComponent(mention.parent_id)}&raw_json=1`,
      );
      const content = parent.data.children[0]?.data;
      const answer = content?.body ?? content?.selftext ?? content?.title ?? "";
      const question = mention.link_title ?? "Audit the parent content's reasoning and evidentiary support.";
      const card = await this.service.run({ question, answer, platform: "reddit" }, {
        idempotencyKey: eventKey,
        rateKey: `reddit:${subreddit}:${mention.author ?? "unknown"}`,
        tenantKey: `reddit:${subreddit}`,
      });
      verificationComplete = true;
      await this.api("/api/comment", {
        api_type: "json",
        thing_id: mention.name,
        text: formatPlainTrustCard(card, 7_500),
      });
      this.service.markDelivered(eventKey);
      deliveryComplete = true;
      await this.markRead(mention.name);
    } catch (error) {
      if (verificationComplete && !deliveryComplete) this.service.markDeliveryFailed(eventKey);
      if (error instanceof DuplicateRequestError) await this.markRead(mention.name);
      else throw error;
    }
  }

  private markRead(id: string): Promise<unknown> {
    return this.api("/api/read_message", { id });
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expires > Date.now() + 60_000) return this.accessToken.value;
    await this.waitForRateWindow();
    const credentials = Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "password",
      username: config.reddit.username ?? "",
      password: config.reddit.password ?? "",
    });
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "user-agent": config.reddit.userAgent ?? "glassbox-platform-gateway",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    this.updateRateLimit(response);
    const result = await response.json() as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !result.access_token) {
      throw new Error(`Reddit OAuth failed: ${result.error ?? response.status}`);
    }
    this.accessToken = {
      value: result.access_token,
      expires: Date.now() + (result.expires_in ?? 3_600) * 1_000,
    };
    return result.access_token;
  }

  private async api<T = unknown>(path: string, form?: Record<string, string>): Promise<T> {
    await this.waitForRateWindow();
    const token = await this.token();
    const response = await fetch(`https://oauth.reddit.com${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": config.reddit.userAgent ?? "glassbox-platform-gateway",
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    if (response.status === 401) this.accessToken = undefined;
    this.updateRateLimit(response);
    if (!response.ok) throw new Error(`Reddit API ${path} failed (${response.status}).`);
    const text = await response.text();
    const parsed = (text ? JSON.parse(text) : {}) as T & {
      json?: { errors?: unknown[] };
    };
    if (parsed.json?.errors && parsed.json.errors.length > 0) {
      throw new Error(`Reddit API ${path} returned an application error.`);
    }
    return parsed;
  }

  private updateRateLimit(response: Response): void {
    const delayMs = redditRateDelayMs(response.headers, response.status, this.backoffMs);
    if (delayMs > 0) this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + delayMs);
    if (response.status === 429 || response.status >= 500) {
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    } else if (response.ok) {
      this.backoffMs = INITIAL_BACKOFF_MS;
    }
  }

  private async waitForRateWindow(): Promise<void> {
    const waitMs = this.nextRequestAt - Date.now();
    if (waitMs > 0) await delay(waitMs);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numberHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function secondsHeaderMs(value: string | null): number {
  return Math.ceil((numberHeader(value) ?? 0) * 1_000);
}

function durationHeaderMs(value: string | null): number {
  const seconds = numberHeader(value);
  if (seconds !== undefined) return Math.ceil(seconds * 1_000);
  if (!value) return 0;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
