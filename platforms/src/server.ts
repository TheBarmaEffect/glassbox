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
    // default-src does not govern framing, so the public HTML surface was embeddable and
    // clickjackable. frame-ancestors is the modern control; X-Frame-Options is kept for
    // agents that predate CSP Level 2.
    response.setHeader("x-frame-options", "DENY");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
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
      schema_version: "2026-09-04",
      backend: config.verifierBackend,
      checkpoints: ["input", "model_output", "agent_step", "tool_call", "final_output"],
      deterministic_probes: [
        "claim_extraction", "unsupported_certainty", "citation_verifiability",
        "citation_resolvability",
        "unsupported_specificity", "answer_relevance", "internal_contradiction",
        "arithmetic_sanity", "input_injection", "prompt_injection",
        "credential_exposure", "dangerous_action", "network_boundary", "fact_check_scope",
      ],
      tool_invocation_probes: [
        "tool_capability", "tool_declaration_drift", "tool_description_injection",
        "tool_argument_injection", "tool_argument_credential", "tool_argument_dangerous",
      ],
      tool_assurance: {
        // The pin covers the description, not only the JSON Schema. A re-published tool
        // whose schema is byte-identical and whose description now carries instructions
        // is the attack the schema-only defence cannot see, and the description is what
        // the calling agent reads.
        declaration_pin_covers: ["name", "description", "input_schema"],
        drift_attribution: true,
        capability_scope: "allowed_tools",
        evaluated: "before execution, at the caller's tool_call checkpoint",
      },
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
      metrics_endpoint: {
        path: "/api/v1/metrics",
        authentication: "none",
        content: "aggregate counters only",
        durability: "in_memory_until_restart",
      },
      limitations: [
        "Pattern-based checks do not detect every attack or hallucination.",
        "The advisory verify endpoint does not enforce its recommended response.",
        "The govern endpoint withholds retry and escalation cases but does not itself regenerate output or operate a human-review queue.",
        "The gateway is not a sandbox, firewall, malware scanner, or professional-advice system.",
        "Tool-declaration drift is detected by hash comparison against a pin the caller supplies and stores; the gateway does not itself retain pins between requests.",
        "Declaration pinning cannot detect a change in a tool's behaviour that leaves its published declaration unchanged.",
        "The gateway evaluates a tool call but does not execute or intercept it: it can withhold authorization, and it records the caller's declaration rather than independently verifying it.",
        "Traffic counters at /api/v1/metrics are in-memory aggregates that reset when the instance restarts; they record categorical outcomes and integers only, never submitted content, and they are not a durable audit log.",
      ],
    });
  });

  /**
   * Public, like /health and /api/v1/capabilities, rather than shared-secret gated like
   * /api/v1/verify.
   *
   * Why: this payload is the deployment evidence, and evidence only its author can read
   * is not evidence anyone can check. The gateway's claim is that it audits answers
   * without retaining them, at real volume. A counter set a reviewer can fetch and diff
   * over time is how that claim stops being an assertion.
   *
   * The price of that decision is that the payload has to be provably content-free, so it
   * is made cheap to audit: every field comes from GatewayMetrics.snapshot(), which only
   * ever sees the categorical fields and integers assembled by verificationEvent() in
   * src/metrics.ts. Labels are matched against fixed sets or an identifier pattern and
   * capped, so a caller cannot write arbitrary strings into it either. Checking the claim
   * means reading one file.
   *
   * What is genuinely exposed is aggregate traffic volume and verdict mix, which is the
   * thing being published on purpose. A frequent poller can watch that move over time;
   * that is inherent to publishing counters and is accepted. The counters carry no
   * per-request identifier or timestamp, so an observer still cannot attribute a change to
   * a particular submitter.
   */
  app.get("/api/v1/metrics", (_request, response) => {
    sendJson(response, 200, service.metrics().snapshot());
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
