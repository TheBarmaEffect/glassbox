import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AuditInput, AuditResult, GlassboxClient } from "./types.js";

const TOOL_NAME = "glassbox_verify_answer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResult(value: unknown): AuditResult {
  if (!isRecord(value)) throw new Error("GlassBox MCP returned no structured result.");
  if (!["trust", "caution", "reject"].includes(String(value.verdict))) {
    throw new Error("GlassBox MCP returned an invalid verdict.");
  }
  if (
    typeof value.summary !== "string" ||
    typeof value.score !== "number" ||
    typeof value.claim_count !== "number" ||
    typeof value.finding_count !== "number" ||
    !["low", "medium", "high", "critical"].includes(String(value.highest_severity)) ||
    !Array.isArray(value.findings) ||
    !Array.isArray(value.caveats)
  ) {
    throw new Error("GlassBox MCP returned an invalid structured result.");
  }
  return value as unknown as AuditResult;
}

export class McpGlassboxClient implements GlassboxClient {
  readonly #url: URL;

  constructor(url: string) {
    this.#url = new URL(url);
  }

  async audit(input: AuditInput): Promise<AuditResult> {
    const transport = new StreamableHTTPClientTransport(this.#url);
    const client = new Client({ name: "glassbox-notion", version: "0.1.0" });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: TOOL_NAME,
        arguments: {
          question: input.question,
          answer: input.answer,
          ...(input.intents ? { intents: input.intents } : {}),
        },
      });
      if (result.isError) throw new Error("GlassBox MCP rejected the audit request.");
      return parseResult(result.structuredContent);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
