import path from "node:path";
import express, { type Express } from "express";
import { apiRouter } from "./api.js";
import { config, enabledPlatforms } from "./config.js";
import { discordRouter } from "./discord.js";
import { githubRouter } from "./github.js";
import { sendJson } from "./http.js";
import { mcpRouter } from "./mcp.js";
import { slackRouter } from "./slack.js";
import { VerificationService } from "./service.js";
import { telegramRouter } from "./telegram.js";

interface PilotReadinessSettings {
  backend?: "lite" | "anthropic";
  anthropicConfigured: boolean;
  allowPublic: boolean;
  maxConcurrency: number;
  pilotTenantCount: number;
  platformCount: number;
}

export function pilotReadinessProblem(settings: PilotReadinessSettings): string | undefined {
  const backend = settings.backend ?? "anthropic";
  if (backend === "anthropic" && !settings.anthropicConfigured) {
    return "ANTHROPIC_API_KEY is not configured for the explicitly selected Anthropic backend.";
  }
  if (settings.platformCount === 0) return "No platform adapter is configured.";
  if (settings.allowPublic) return "Public access is not approved for this pilot deployment.";
  if (settings.pilotTenantCount === 0) return "PILOT_TENANT_ALLOWLIST is empty.";
  if (settings.maxConcurrency !== 1) return "The single-instance pilot requires PLATFORM_MAX_CONCURRENCY=1.";
  return undefined;
}

export function buildServer(service: VerificationService): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use((_request, response, next) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cache-control", "no-store");
    next();
  });
  app.use(express.raw({ type: "*/*", limit: "128kb" }));
  app.use(express.static(path.resolve(process.cwd(), "public"), {
    extensions: ["html"],
    fallthrough: true,
  }));

  app.get("/health", (_request, response) => {
    sendJson(response, 200, {
      status: "ok",
      platforms: enabledPlatforms(),
      access: config.allowPublic ? "public" : "pilot_allowlist",
      queue: service.status(),
      raw_content_persistence: false,
      verifier_backend: config.verifierBackend,
    });
  });

  app.get("/ready", async (_request, response) => {
    const readinessProblem = pilotReadinessProblem({
      backend: config.verifierBackend,
      anthropicConfigured: config.anthropicConfigured,
      allowPublic: config.allowPublic,
      maxConcurrency: config.maxConcurrency,
      pilotTenantCount: config.pilotTenants.size,
      platformCount: enabledPlatforms().length,
    });
    if (readinessProblem) {
      sendJson(response, 503, { status: "not_ready", reason: readinessProblem });
      return;
    }
    try {
      const ready = await service.ready();
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        verifier_backend: config.verifierBackend,
        external_model_required: config.verifierBackend === "anthropic",
      });
    } catch {
      sendJson(response, 503, {
        status: "not_ready",
        reason: config.verifierBackend === "anthropic"
          ? "GlassBox MCP is unavailable."
          : "GlassBox Lite is unavailable.",
      });
    }
  });

  app.use(apiRouter(service));
  app.use(mcpRouter(service));
  app.use(discordRouter(service));
  app.use(slackRouter(service));
  app.use(telegramRouter(service));
  app.use(githubRouter(service));

  app.use((_request, response) => sendJson(response, 404, { error: "Not found" }));
  return app;
}
