import assert from "node:assert/strict";
import test from "node:test";
import {
  DeliveryDeadlineError,
  withDiscordDeliveryDeadline,
} from "../src/discord.js";
import { discordRegistrationCommands } from "../src/discord-registration.js";
import {
  isExplicitRedditMention,
  redditRateDelayMs,
  REDDIT_UNREAD_PATH,
} from "../src/reddit.js";

test("guild Discord registration removes global-only command fields", () => {
  const commands = [{ name: "glassbox", integration_types: [0, 1], contexts: [0, 1, 2] }];
  assert.deepEqual(discordRegistrationCommands(commands, "guild-1"), [{ name: "glassbox" }]);
  assert.equal(discordRegistrationCommands(commands), commands);
});

test("Discord delivery rejects before the interaction token expires", async () => {
  // The stalled promise must not settle on its own, so that the deadline is what rejects.
  // It is settled explicitly at the end: a promise left pending past the test makes
  // Node's shared-process test runner report "Promise resolution is still pending but the
  // event loop has already resolved" and cancel unrelated test files alongside it.
  let settle!: (value: string) => void;
  const stalled = new Promise<string>((resolve) => { settle = resolve; });
  await assert.rejects(withDiscordDeliveryDeadline(stalled, 5), DeliveryDeadlineError);
  assert.equal(await withDiscordDeliveryDeadline(Promise.resolve("ok"), 50), "ok");
  settle("released after the deadline had already fired");
});

test("Reddit polling uses the official unread route and ignores unrelated inbox items", () => {
  assert.equal(REDDIT_UNREAD_PATH, "/message/unread?limit=25&raw_json=1");
  assert.equal(isExplicitRedditMention("u/GlassBoxBot verify this", "GlassBoxBot"), true);
  assert.equal(isExplicitRedditMention("please analyze this", "GlassBoxBot"), false);
  assert.equal(isExplicitRedditMention("/u/glassboxbot, audit", "GlassBoxBot"), true);
});

test("Reddit rate pacing honors reset, Retry-After, and server backoff", () => {
  assert.equal(redditRateDelayMs(new Headers({
    "x-ratelimit-remaining": "1",
    "x-ratelimit-reset": "12.5",
  }), 200), 12_500);
  assert.equal(redditRateDelayMs(new Headers({ "retry-after": "7" }), 429, 1_000), 7_000);
  assert.equal(redditRateDelayMs(new Headers(), 503, 4_000), 4_000);
});
