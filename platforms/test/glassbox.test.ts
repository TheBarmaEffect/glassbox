import assert from "node:assert/strict";
import test from "node:test";
import { glassboxChildEnvironment } from "../src/glassbox.js";

test("MCP child receives GlassBox runtime settings but no platform credentials", () => {
  const child = glassboxChildEnvironment({
    ANTHROPIC_API_KEY: "anthropic",
    GLASSBOX_MODEL: "model",
    PATH: "/bin",
    SLACK_BOT_TOKEN: "slack-secret",
    REDDIT_PASSWORD: "reddit-secret",
    GITHUB_PRIVATE_KEY: "github-secret",
    DISCORD_BOT_TOKEN: "discord-secret",
    TELEGRAM_BOT_TOKEN: "telegram-secret",
  });
  assert.deepEqual(child, {
    ANTHROPIC_API_KEY: "anthropic",
    GLASSBOX_MODEL: "model",
    PATH: "/bin",
  });
});
