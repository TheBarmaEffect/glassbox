import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { parseJson, publicError, rawBody, sendJson } from "./http.js";
import {
  MAX_ANSWER_CHARS,
  MAX_INTENTS,
  MAX_INTENT_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_INTENT_CHARS,
} from "./parser.js";
import { VerificationService } from "./service.js";

export const GLASSBOX_MCP_TOOL = "glassbox_verify_answer";

export function createGlassboxMcpServer(service: VerificationService): McpServer {
  const server = new McpServer({
    name: "glassbox-lite",
    version: "1.0.0",
  });

  server.registerTool(
    GLASSBOX_MCP_TOOL,
    {
      title: "Verify an AI answer with GlassBox Lite",
      description:
        "Audit a question/answer pair with the zero-cost deterministic GlassBox Lite engine. " +
        "Returns a transparent Trust Card covering claims, arithmetic and contradiction checks, " +
        "unsupported certainty, citation transparency, prompt-injection signals, ECS dimensions, " +
        "and an audit reference. This is a reasoning audit, not a web fact-check or professional advice.",
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
        question: z.string(),
        answer: z.string(),
        verdict: z.enum(["trust", "caution", "reject"]),
        verdict_rationale: z.string(),
        ecs: z.object({
          total: z.number().min(0).max(1),
          dimensions: z.record(z.number().min(0).max(1)),
          notes: z.array(z.string()),
        }),
        claims: z.array(z.object({
          id: z.string(),
          text: z.string(),
          reasoning: z.string(),
          confidence: z.number().min(0).max(1),
          supporting_evidence: z.array(z.string()),
          attack_surface: z.array(z.string()),
          status: z.enum(["observed", "reconstructed", "assumed"]),
        })),
        red_team: z.object({
          probes: z.array(z.object({
            angle: z.string(),
            passed: z.boolean(),
            severity: z.enum(["low", "medium", "high", "critical"]),
            finding: z.string(),
            evidence: z.array(z.string()),
          })),
          pass_rate: z.number().min(0).max(1),
          highest_severity: z.enum(["low", "medium", "high", "critical"]),
        }),
        constitution: z.object({
          rules: z.array(z.object({
            id: z.string(),
            requirement: z.string(),
            severity: z.string(),
          })),
          evaluations: z.record(z.enum(["satisfied", "violated", "not_triggered"])).optional(),
        }),
        audit: z.object({
          log_id: z.string(),
          generated_at: z.string(),
          inputs_hash: z.string(),
        }),
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
            rateKey: "mcp:public",
            tenantKey: "mcp:public",
          },
        );
        service.markDelivered(eventKey);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(card, null, 2) }],
          structuredContent: { ...card },
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
    const server = createGlassboxMcpServer(service);
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
