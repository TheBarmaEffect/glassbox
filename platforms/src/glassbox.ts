import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { normalizeInput } from "./parser.js";
import type { TrustCard, VerificationInput, Verifier } from "./types.js";

const CHILD_ENV_ALLOWLIST = [
  "ANTHROPIC_API_KEY",
  "GLASSBOX_MODEL",
  "GLASSBOX_MAX_TOKENS",
  "NODE_ENV",
  "NODE_OPTIONS",
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
] as const;

export function glassboxChildEnvironment(source = process.env): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) allowed[name] = value;
  }
  return allowed;
}

const TrustCardSchema = z.object({
  question: z.string(),
  answer: z.string(),
  verdict: z.enum(["trust", "caution", "reject"]),
  verdict_rationale: z.string(),
  ecs: z.object({
    total: z.number().min(0).max(1),
    dimensions: z.record(z.number().min(0).max(1)),
    notes: z.array(z.string()),
  }).passthrough(),
  claims: z.array(z.object({
    id: z.string(),
    text: z.string(),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1),
    supporting_evidence: z.array(z.string()),
    attack_surface: z.array(z.string()),
    status: z.enum(["observed", "reconstructed", "assumed"]),
  }).passthrough()),
  red_team: z.object({
    probes: z.array(z.object({
      angle: z.string(),
      passed: z.boolean(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      finding: z.string(),
      evidence: z.array(z.string()),
    }).passthrough()),
    pass_rate: z.number().min(0).max(1),
    highest_severity: z.enum(["low", "medium", "high", "critical"]),
  }).passthrough(),
  constitution: z.object({
    rules: z.array(z.object({
      id: z.string(),
      requirement: z.string(),
      severity: z.string(),
    }).passthrough()),
    evaluations: z.record(z.enum(["satisfied", "violated", "not_triggered"])).optional(),
  }).passthrough(),
  audit: z.object({
    log_id: z.string(),
    generated_at: z.string(),
    inputs_hash: z.string(),
  }).passthrough(),
}).passthrough();

function serverProcess(): { command: string; args: string[] } {
  const override = process.env.GLASSBOX_SERVER_COMMAND;
  if (override) {
    let args: string[] = [];
    if (process.env.GLASSBOX_SERVER_ARGS_JSON) {
      const parsed: unknown = JSON.parse(process.env.GLASSBOX_SERVER_ARGS_JSON);
      if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
        throw new Error("GLASSBOX_SERVER_ARGS_JSON must be a JSON array of strings.");
      }
      args = parsed;
    }
    return { command: override, args };
  }

  const require = createRequire(import.meta.url);
  const launcher = require.resolve("@glassbox-framework/mcp/bin/glassbox-mcp.js");
  return { command: process.execPath, args: [launcher] };
}

export class GlassboxMcpVerifier implements Verifier {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private connecting: Promise<Client> | undefined;

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    const attempt = this.connect();
    this.connecting = attempt;
    void attempt.then(
      () => { if (this.connecting === attempt) this.connecting = undefined; },
      () => { if (this.connecting === attempt) this.connecting = undefined; },
    );
    return attempt;
  }

  private async connect(): Promise<Client> {
    const child = serverProcess();
    const transport = new StdioClientTransport({ ...child, env: glassboxChildEnvironment() });
    const client = new Client({ name: "glassbox-platform-gateway", version: "0.1.0" });
    this.transport = transport;
    try {
      await client.connect(transport);
      if (this.transport !== transport) {
        await transport.close().catch(() => undefined);
        throw new Error("GlassBox MCP connection was reset before it became ready.");
      }
      this.client = client;
      return client;
    } catch (error) {
      if (this.transport === transport) this.transport = undefined;
      throw error;
    }
  }

  async verify(raw: VerificationInput): Promise<TrustCard> {
    const input = normalizeInput(raw);
    const client = await this.getClient();
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await client.callTool({
        name: "glassbox_verify_answer",
        arguments: {
          question: input.question,
          answer: input.answer,
          intents: input.intents,
        },
      });
    } catch (error) {
      // A deadline may already have replaced this transport for the next job.
      // Never let the old call's eventual rejection tear down the replacement.
      if (this.client === client) await this.reset();
      throw error;
    }
    if (result.isError) throw new Error(extractError(result.content));
    const content: unknown[] = Array.isArray(result.content) ? result.content : [];
    const text = content.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" && item !== null &&
        "type" in item && item.type === "text" &&
        "text" in item && typeof item.text === "string",
    );
    if (!text) throw new Error("GlassBox returned no text payload.");
    return TrustCardSchema.parse(JSON.parse(text.text)) as TrustCard;
  }

  async ready(): Promise<boolean> {
    const client = await this.getClient();
    const tools = await client.listTools();
    return tools.tools.some((tool) => tool.name === "glassbox_verify_answer");
  }

  async reset(): Promise<void> {
    this.client = undefined;
    this.connecting = undefined;
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

function extractError(content: unknown): string {
  if (!Array.isArray(content)) return "GlassBox verification failed.";
  const text = content.find((item) => typeof item === "object" && item !== null && "text" in item) as
    | { text?: unknown }
    | undefined;
  return typeof text?.text === "string" ? text.text : "GlassBox verification failed.";
}
