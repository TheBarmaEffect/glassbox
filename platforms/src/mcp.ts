import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { parseJson, publicError, rawBody, sendJson } from "./http.js";
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
        question: z.string().min(1).max(8_000).describe("The original question or prompt."),
        answer: z.string().min(1).max(16_000).describe("The answer to audit."),
        intents: z.array(z.string().min(1).max(1_000)).max(20).optional()
          .describe("Optional rules or expectations the answer should satisfy."),
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
