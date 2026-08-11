import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGlassboxMcpServer, GLASSBOX_MCP_TOOL } from "../src/mcp.js";
import {
  MAX_ANSWER_CHARS,
  MAX_INTENTS,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_INTENT_CHARS,
} from "../src/parser.js";
import { VerificationService } from "../src/service.js";
import type { TrustCard, Verifier } from "../src/types.js";

const card: TrustCard = {
  question: "What is 2 + 2?",
  answer: "2 + 2 = 4.",
  verdict: "trust",
  verdict_rationale: "No structural issue was detected.",
  ecs: { total: 0.9, dimensions: { arithmetic_integrity: 1 }, notes: [] },
  claims: [],
  red_team: { probes: [], pass_rate: 1, highest_severity: "low" },
  constitution: { rules: [] },
  audit: {
    log_id: "glassbox-test",
    generated_at: "2026-08-11T00:00:00.000Z",
    inputs_hash: "test-hash",
  },
};

async function connectedClient(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const verifier: Verifier = { verify: async () => card };
  const service = new VerificationService(
    verifier,
    1,
    10,
    100,
    100,
    10,
    1_000,
    { allowPublic: true, tenants: new Set() },
  );
  const server = createGlassboxMcpServer(service);
  const client = new Client({ name: "glassbox-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("MCP metadata exposes the exact gateway limits and TrustCard output schema", async () => {
  const connection = await connectedClient();
  try {
    const listed = await connection.client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === GLASSBOX_MCP_TOOL);
    assert.ok(tool);

    const input = tool.inputSchema as {
      properties?: Record<string, { maximum?: number; maxLength?: number; maxItems?: number }>;
    };
    assert.equal(input.properties?.question?.maxLength, MAX_QUESTION_CHARS);
    assert.equal(input.properties?.answer?.maxLength, MAX_ANSWER_CHARS);
    assert.equal(input.properties?.intents?.maxItems, MAX_INTENTS);

    const output = tool.outputSchema as { required?: string[]; properties?: Record<string, unknown> };
    assert.ok(output.properties?.verdict);
    assert.ok(output.properties?.ecs);
    assert.ok(output.properties?.claims);
    assert.ok(output.properties?.red_team);
    assert.ok(output.properties?.constitution);
    assert.ok(output.properties?.audit);
    assert.ok(output.required?.includes("verdict"));
  } finally {
    await connection.close();
  }
});

test("MCP returns the TrustCard as both text and validated structured content", async () => {
  const connection = await connectedClient();
  try {
    const result = await connection.client.callTool({
      name: GLASSBOX_MCP_TOOL,
      arguments: { question: card.question, answer: card.answer },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, card);
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.deepEqual(JSON.parse(content[0]?.text ?? "{}"), card);
  } finally {
    await connection.close();
  }
});

test("MCP rejects intent payloads above the parser's total-character limit", async () => {
  const connection = await connectedClient();
  try {
    const result = await connection.client.callTool({
      name: GLASSBOX_MCP_TOOL,
      arguments: {
        question: card.question,
        answer: card.answer,
        intents: ["x".repeat(MAX_TOTAL_INTENT_CHARS), "y"],
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /invalid|total|4000/i);
  } finally {
    await connection.close();
  }
});
