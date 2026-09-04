import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config.js";
import { hashedRateKey } from "./ratekey.js";
import { parseJson, publicError, rawBody, sendJson } from "./http.js";
import {
  MAX_ANSWER_CHARS,
  MAX_INTENTS,
  MAX_INTENT_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_INTENT_CHARS,
} from "./parser.js";
import { VerificationService } from "./service.js";
import type { RedTeamProbe, TrustCard } from "./types.js";

export const GLASSBOX_MCP_TOOL = "glassbox_verify_answer";
export function mcpRateKey(clientAddress: string): string {
  return hashedRateKey("mcp", clientAddress);
}

const PUBLIC_PROBE_COPY = {
  claim_extraction: {
    passed: "Claims were extracted within the deterministic analysis limit.",
    failed: "The answer exceeded the deterministic claim-analysis limit.",
  },
  unsupported_certainty: {
    passed: "No unsupported absolute-certainty signal was detected.",
    failed: "Unsupported absolute-certainty language was detected.",
  },
  internal_contradiction: {
    passed: "No direct internal contradiction was detected.",
    failed: "A direct internal contradiction was detected.",
  },
  prompt_injection: {
    passed: "No instruction-like prompt-injection signal was detected.",
    failed: "Instruction-like prompt-injection language was detected and treated as inert text.",
  },
  input_injection: {
    passed: "No supported input-side instruction-override signal was detected.",
    failed: "An input-side instruction-override signal was detected, including normalized or decoded text.",
  },
  credential_exposure: {
    passed: "No supported credential format was detected.",
    failed: "Potential credential material was detected and its value was withheld.",
  },
  dangerous_action: {
    passed: "No supported destructive or executable attack pattern was detected.",
    failed: "Potentially dangerous executable content was detected.",
  },
  network_boundary: {
    passed: "No unsafe checkpoint network target was detected.",
    failed: "A checkpoint target crossed the deterministic network-boundary policy.",
  },
  fact_check_scope: {
    passed: "The answer did not overstate the scope of this non-web audit.",
    failed: "The request requires external fact-checking that GlassBox Lite does not perform.",
  },
  citation_verifiability: {
    passed: "No citation-transparency issue was detected by the structural check.",
    failed: "A citation-transparency issue was detected; external sources were not authenticated.",
  },
  unsupported_specificity: {
    passed: "No unsupported high-specificity factual signal was detected.",
    failed: "A specific date, percentage, amount, identifier, or measurement needs support.",
  },
  answer_relevance: {
    passed: "No clear lexical non-response signal was detected.",
    failed: "The answer may be a non-response or topic switch and needs inspection.",
  },
  arithmetic_sanity: {
    passed: "No error was found in the supported arithmetic forms that were present.",
    failed: "A supported arithmetic expression failed deterministic recomputation.",
  },
} as const;

type PublicProbeAngle = keyof typeof PUBLIC_PROBE_COPY;
type Severity = RedTeamProbe["severity"];

const PUBLIC_PROBE_ANGLES = Object.keys(PUBLIC_PROBE_COPY) as PublicProbeAngle[];
const PublicProbeAngleSchema = z.enum(PUBLIC_PROBE_ANGLES as [PublicProbeAngle, ...PublicProbeAngle[]]);
const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const PublicFindingSchema = z.object({
  angle: PublicProbeAngleSchema,
  severity: SeveritySchema,
  summary: z.string(),
});
const PublicProbeSchema = PublicFindingSchema.extend({ passed: z.boolean() });

interface PublicMcpResult {
  verdict: TrustCard["verdict"];
  summary: string;
  score: number;
  claim_count: number;
  finding_count: number;
  highest_severity: Severity;
  findings: Array<{ angle: PublicProbeAngle; severity: Severity; summary: string }>;
  probes: Array<{ angle: PublicProbeAngle; passed: boolean; severity: Severity; summary: string }>;
  caveats: string[];
}

const PUBLIC_CAVEATS = [
  "GlassBox Lite is a deterministic reasoning audit, not a web fact-check.",
  "External facts and citations were not authenticated or verified.",
  "Do not use this result as professional or consequential advice.",
] as const;

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function publicMcpResult(card: TrustCard): PublicMcpResult {
  const probes = PUBLIC_PROBE_ANGLES.flatMap((angle) => {
    const probe = card.red_team.probes.find((candidate) => candidate.angle === angle);
    if (!probe) return [];
    return [{
      angle,
      passed: probe.passed,
      severity: probe.severity,
      summary: PUBLIC_PROBE_COPY[angle][probe.passed ? "passed" : "failed"],
    }];
  });
  const findings = probes
    .filter((probe) => !probe.passed)
    .map(({ angle, severity, summary }) => ({ angle, severity, summary }));
  const highestSeverity = findings.reduce<Severity>(
    (highest, finding) => SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[highest]
      ? finding.severity
      : highest,
    "low",
  );
  const summary = card.verdict === "trust"
    ? "No deterministic structural red flags were found."
    : card.verdict === "reject"
      ? "A deterministic structural check found a rejection-level issue."
      : "One or more deterministic structural checks require caution.";

  return {
    verdict: card.verdict,
    summary,
    score: card.ecs.total,
    claim_count: card.claims.length,
    finding_count: findings.length,
    highest_severity: highestSeverity,
    findings,
    probes,
    caveats: [...PUBLIC_CAVEATS],
  };
}

export function createGlassboxMcpServer(
  service: VerificationService,
  requestContext: { rateKey?: string } = {},
): McpServer {
  const server = new McpServer({
    name: "glassbox-lite",
    version: "1.0.0",
  });

  server.registerTool(
    GLASSBOX_MCP_TOOL,
    {
      title: "Verify an AI answer with GlassBox Lite",
      description:
        "Use this when a user explicitly asks to audit a supplied question/answer pair with the " +
        "zero-cost deterministic GlassBox Lite engine. Returns a privacy-minimized verdict, score, " +
        "fixed-category findings, probe results, and caveats covering claims, arithmetic, direct " +
        "contradictions, unsupported certainty, citation transparency, prompt injection, credential " +
        "exposure, dangerous executable content, and network-boundary signals. " +
        "Do not use it as a web fact-check, source authenticator, truth guarantee, or professional advice.",
      inputSchema: {
        question: z.string().trim().min(1).max(MAX_QUESTION_CHARS)
          .describe(`The original question or prompt (maximum ${MAX_QUESTION_CHARS} characters).`),
        answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS)
          .describe(`The answer to audit (maximum ${MAX_ANSWER_CHARS} characters).`),
        intents: z.array(z.string().trim().min(1).max(MAX_INTENT_CHARS))
          .max(MAX_INTENTS)
          .refine(
            (values) => values.reduce((total, value) => total + value.length, 0)
              <= MAX_TOTAL_INTENT_CHARS,
            `Intents must total no more than ${MAX_TOTAL_INTENT_CHARS} characters.`,
          )
          .optional()
          .describe(
            `Optional rules or expectations the answer should satisfy (maximum ${MAX_INTENTS}; ` +
            `${MAX_TOTAL_INTENT_CHARS} characters total).`,
          ),
      },
      outputSchema: {
        verdict: z.enum(["trust", "caution", "reject"]),
        summary: z.string(),
        score: z.number().min(0).max(1),
        claim_count: z.number().int().nonnegative(),
        finding_count: z.number().int().nonnegative(),
        highest_severity: SeveritySchema,
        findings: z.array(PublicFindingSchema),
        probes: z.array(PublicProbeSchema),
        caveats: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ question, answer, intents }) => {
      const eventKey = `mcp:${crypto.randomUUID()}`;
      try {
        const card = await service.run(
          { platform: "mcp", question, answer, intents },
          {
            idempotencyKey: eventKey,
            rateKey: requestContext.rateKey ?? "mcp:public",
            tenantKey: "mcp:public",
            surface: "mcp",
          },
        );
        service.markDelivered(eventKey);
        const publicResult = publicMcpResult(card);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(publicResult, null, 2) }],
          structuredContent: { ...publicResult },
        };
      } catch (error) {
        service.markDeliveryFailed(eventKey);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: publicError(error),
              retryable: true,
              raw_content_persisted: false,
            }),
          }],
        };
      }
    },
  );

  return server;
}

export function mcpRouter(service: VerificationService): Router {
  const router = Router();

  router.post("/mcp", async (request, response) => {
    const clientAddress = request.ip || request.socket.remoteAddress || "unknown";
    const server = createGlassboxMcpServer(service, { rateKey: mcpRateKey(clientAddress) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      const body = parseJson<unknown>(rawBody(request));
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) {
        sendJson(response, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_request: Request, response: Response): void => {
    response.setHeader("allow", "POST");
    sendJson(response, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed; use MCP Streamable HTTP POST." },
      id: null,
    });
  };
  router.get("/mcp", methodNotAllowed);
  router.delete("/mcp", methodNotAllowed);

  return router;
}
