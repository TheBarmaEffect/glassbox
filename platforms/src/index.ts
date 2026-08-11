import { config, enabledPlatforms } from "./config.js";
import { RedditWorker } from "./reddit.js";
import { buildServer } from "./server.js";
import { VerificationService } from "./service.js";
import { registerTelegramWebhook } from "./telegram-webhook.js";
import { createVerifier } from "./verifier.js";

const verifier = createVerifier(config.verifierBackend);
const service = new VerificationService(verifier);
const app = buildServer(service);
const reddit = new RedditWorker(service);

try {
  await registerTelegramWebhook({
    botToken: config.telegram.botToken,
    webhookSecret: config.telegram.webhookSecret,
    publicBaseUrl: config.publicBaseUrl,
  });
} catch {
  // A platform-specific credential must not take the zero-cost core service down.
  // Clear both values so the adapter also fails closed for inbound requests.
  config.telegram.botToken = undefined;
  config.telegram.webhookSecret = undefined;
  console.warn("Telegram adapter disabled because webhook registration failed.");
}

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`GlassBox platform gateway listening on :${config.port}`);
  console.log(`Enabled adapters: ${enabledPlatforms().join(", ")}`);
  reddit.start();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down.`);
  service.stop();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  reddit.stop();
  await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
  await service.waitForIdle(10_000);
  await verifier.close?.();
  process.exitCode = 0;
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
