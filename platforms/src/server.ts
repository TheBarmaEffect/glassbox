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
  publicPlatformCount?: number;
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
  if (settings.pilotTenantCount === 0 && (settings.publicPlatformCount ?? 0) === 0) {
    return "PILOT_TENANT_ALLOWLIST is empty and no platform is explicitly public.";
  }
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
    response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
    next();
  });
  app.use(express.raw({ type: "*/*", limit: "128kb" }));
  app.use(express.static(path.resolve(process.cwd(), "public"), {
    extensions: ["html"],
    fallthrough: true,
  }));

  app.get("/.well-known/openai-apps-challenge", (_request, response) => {
    if (!config.openaiAppsChallengeToken) {
      sendJson(response, 404, { error: "OpenAI plugin domain verification is not configured." });
      return;
    }
    response.status(200).type("text/plain").send(config.openaiAppsChallengeToken);
  });

  app.get("/health", (_request, response) => {
    sendJson(response, 200, {
      status: "ok",
      platforms: enabledPlatforms(),
      access: config.allowPublic ? "public" : config.publicPlatforms.size > 0 ? "mixed" : "pilot_allowlist",
      public_platforms: config.allowPublic ? "all" : [...config.publicPlatforms],
      queue: service.status(),
      raw_content_persistence: false,
      verifier_backend: config.verifierBackend,
    });
  });

  app.get("/api/v1/capabilities", (_request, response) => {
    sendJson(response, 200, {
      schema_version: "2026-09-03",
      backend: config.verifierBackend,
      checkpoints: ["input", "model_output", "agent_step", "tool_call", "final_output"],
      deterministic_probes: [
        "claim_extraction", "unsupported_certainty", "citation_verifiability",
        "unsupported_specificity", "answer_relevance", "internal_contradiction",
        "arithmetic_sanity", "input_injection", "prompt_injection",
        "credential_exposure", "dangerous_action", "network_boundary", "fact_check_scope",
      ],
      constitution_rule_kinds: [
        "require_phrase", "forbid_phrase", "require_citation", "forbid_absolute_certainty",
        "allow_target", "forbid_target",
      ],
      response_actions: ["allow", "record", "block", "retry", "escalate"],
      response_endpoints: {
        "/api/v1/verify": "advisory",
        "/api/v1/govern": "synchronous release gate",
      },
      governance_gate: {
        releases: ["allow", "record"],
        withholds: ["block", "retry", "escalate"],
        caller_next_steps: ["retry", "human_review"],
      },
      external_fact_verification: false,
      raw_content_persistence: false,
      limitations: [
        "Pattern-based checks do not detect every attack or hallucination.",
        "The advisory verify endpoint does not enforce its recommended response.",
        "The govern endpoint withholds retry and escalation cases but does not itself regenerate output or operate a human-review queue.",
        "The gateway is not a sandbox, firewall, malware scanner, or professional-advice system.",
      ],
    });
  });

  app.get("/ready", async (_request, response) => {
    const readinessProblem = pilotReadinessProblem({
      backend: config.verifierBackend,
      anthropicConfigured: config.anthropicConfigured,
      allowPublic: config.allowPublic,
      publicPlatformCount: config.publicPlatforms.size,
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
