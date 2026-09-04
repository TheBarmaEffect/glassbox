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
  // The delivery deadline timer is unref'd in src/discord.ts, so it cannot by itself keep
  // the event loop alive. If the pending work it races is a promise with no timer of its
  // own, the loop drains before the deadline elapses, the deadline never fires, and this
  // test hangs — which Node reports as "Promise resolution is still pending but the event
  // loop has already resolved" and charges to every test in the file. So the work must be
  // slow *and* must hold a ref'd handle: a plain unsettled promise is not enough.
  let slowTimer: NodeJS.Timeout | undefined;
  const slow = new Promise<string>((resolve) => {
    slowTimer = setTimeout(() => resolve("delivered after the deadline"), 60);
  });
  await assert.rejects(withDiscordDeliveryDeadline(slow, 5), DeliveryDeadlineError);
  assert.equal(await withDiscordDeliveryDeadline(Promise.resolve("ok"), 50), "ok");
  // Drain the slow promise so nothing outlives the test.
  await slow;
  if (slowTimer) clearTimeout(slowTimer);
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
