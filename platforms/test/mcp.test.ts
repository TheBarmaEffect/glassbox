import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGlassboxMcpServer, GLASSBOX_MCP_TOOL, mcpRateKey, publicMcpResult } from "../src/mcp.js";
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

test("MCP rate keys separate callers without retaining their network address", () => {
  const first = mcpRateKey("203.0.113.10");
  const again = mcpRateKey("203.0.113.10");
  const second = mcpRateKey("203.0.113.11");
  assert.equal(first, again);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /203\.0\.113/);
  assert.match(first, /^mcp:[a-f0-9]{32}$/);
});

async function connectedClient(resultCard: TrustCard = card): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const verifier: Verifier = { verify: async () => resultCard };
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
    assert.ok(output.properties?.score);
    assert.ok(output.properties?.claim_count);
    assert.ok(output.properties?.findings);
    assert.ok(output.properties?.probes);
    assert.ok(output.properties?.caveats);
    assert.equal(output.properties?.question, undefined);
    assert.equal(output.properties?.answer, undefined);
    assert.equal(output.properties?.audit, undefined);
    assert.ok(output.required?.includes("verdict"));
  } finally {
    await connection.close();
  }
});

test("MCP returns a privacy-minimized result as both text and structured content", async () => {
  const connection = await connectedClient();
  try {
    const result = await connection.client.callTool({
      name: GLASSBOX_MCP_TOOL,
      arguments: { question: card.question, answer: card.answer },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, publicMcpResult(card));
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.deepEqual(JSON.parse(content[0]?.text ?? "{}"), publicMcpResult(card));
  } finally {
    await connection.close();
  }
});

test("MCP never echoes submitted content, verifier excerpts, or internal audit metadata", async () => {
  const secret = "PRIVATE-CONTENT-DO-NOT-ECHO";
  const privateCard: TrustCard = {
    ...card,
    question: `${secret}-question`,
    answer: `${secret}-answer`,
    verdict: "caution",
    verdict_rationale: `${secret}-rationale`,
    ecs: { total: 0.4, dimensions: { [secret]: 0 }, notes: [`${secret}-note`] },
    claims: [{
      id: `${secret}-claim-id`,
      text: `${secret}-claim-text`,
      reasoning: `${secret}-reasoning`,
      confidence: 0.2,
      supporting_evidence: [`${secret}-evidence`],
      attack_surface: [`${secret}-attack`],
      status: "observed",
    }],
    red_team: {
      probes: [{
        angle: "unsupported_certainty",
        passed: false,
        severity: "medium",
        finding: `${secret}-finding`,
        evidence: [`${secret}-probe-evidence`],
      }],
      pass_rate: 0,
      highest_severity: "medium",
    },
    audit: {
      log_id: `${secret}-log-id`,
      generated_at: `${secret}-generated-at`,
      inputs_hash: `${secret}-inputs-hash`,
    },
  };
  const connection = await connectedClient(privateCard);
  try {
    const result = await connection.client.callTool({
      name: GLASSBOX_MCP_TOOL,
      arguments: { question: privateCard.question, answer: privateCard.answer },
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, new RegExp(secret));
    const structured = result.structuredContent as Record<string, unknown>;
    for (const forbidden of ["question", "answer", "audit", "generated_at", "log_id", "inputs_hash"]) {
      assert.equal(forbidden in structured, false);
    }
    assert.deepEqual(structured.findings, [{
      angle: "unsupported_certainty",
      severity: "medium",
      summary: "Unsupported absolute-certainty language was detected.",
    }]);
    const differentPrivateContent: TrustCard = {
      ...privateCard,
      question: "different private question",
      answer: "different private answer",
      verdict_rationale: "different private rationale",
      ecs: { ...privateCard.ecs, dimensions: { private_dimension: 0.4 }, notes: ["private note"] },
      claims: privateCard.claims.map((claim) => ({
        ...claim,
        text: "different private claim",
        reasoning: "different private reasoning",
        supporting_evidence: ["different private evidence"],
        attack_surface: ["different private attack surface"],
      })),
      red_team: {
        ...privateCard.red_team,
        probes: privateCard.red_team.probes.map((probe) => ({
          ...probe,
          finding: "different private finding",
          evidence: ["different private probe evidence"],
        })),
      },
      audit: { log_id: "different", generated_at: "different", inputs_hash: "different" },
    };
    assert.deepEqual(publicMcpResult(privateCard), publicMcpResult(differentPrivateContent));
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

test("MCP rejects question, answer, and intent counts above the parser limits", async () => {
  const connection = await connectedClient();
  try {
    const invalidArguments = [
      { question: "q".repeat(MAX_QUESTION_CHARS + 1), answer: card.answer },
      { question: card.question, answer: "a".repeat(MAX_ANSWER_CHARS + 1) },
      {
        question: card.question,
        answer: card.answer,
        intents: Array.from({ length: MAX_INTENTS + 1 }, () => "rule"),
      },
    ];
    for (const arguments_ of invalidArguments) {
      const result = await connection.client.callTool({
        name: GLASSBOX_MCP_TOOL,
        arguments: arguments_,
      });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /invalid/i);
    }
  } finally {
    await connection.close();
  }
});

// ---------------------------------------------------------------------------
// Projection coverage.
//
// The public MCP projection iterates the copy map, so a probe with no entry is
// dropped silently. That shipped once: `citation_resolvability` and the six
// tool probes were live and decisive while the projection reported
// verdict "reject" with finding_count 0 and highest_severity "low" — an
// unexplained rejection, which is the one failure a transparency surface
// cannot have. This test enumerates what the verifier actually emits rather
// than trusting a hand-maintained list.
// ---------------------------------------------------------------------------

test("every probe angle the verifier can emit has public copy", async () => {
  const { GlassboxLiteVerifier } = await import("../src/lite.js");
  const { PUBLIC_PROBE_ANGLES } = await import("../src/mcp.js");
  const verifier = new GlassboxLiteVerifier(() => new Date("2026-01-01T00:00:00.000Z"));

  // Inputs chosen to exercise every probe family, including the tool probes,
  // which only appear when a tool invocation is supplied.
  const cards = await Promise.all([
    verifier.verify({ platform: "api", question: "Sources?", answer: "See ISBN 978-0-13-235088-7." }),
    verifier.verify({ platform: "api", question: "Compute it.", answer: "2 + 2 = 5. It never fails." }),
    verifier.verify({
      platform: "api",
      question: "Read the config.",
      answer: "Calling read_file.",
      checkpoint: { id: "c", type: "tool_call", target: "https://example.org/x" },
      tool: {
        tool: "read_file",
        arguments: { path: "a.txt" },
        declaration: { name: "read_file", description: "Read a file.", input_schema: { type: "object" } },
      },
      tool_pins: [],
      allowed_tools: ["read_file"],
      constitution: {
        version: "v1",
        rules: [{ id: "r", requirement: "cite", kind: "require_citation", severity: "low" }],
      },
    }),
  ]);

  const emitted = new Set<string>();
  for (const card of cards) for (const probe of card.red_team.probes) emitted.add(probe.angle);
  // Caller-supplied constitution rules are namespaced and reported separately, not
  // through the fixed copy map, so they are excluded.
  const fixed = [...emitted].filter((angle) => !angle.startsWith("constitution:")).sort();
  const covered = new Set(PUBLIC_PROBE_ANGLES as string[]);
  const missing = fixed.filter((angle) => !covered.has(angle));

  assert.deepEqual(missing, [], `probe angles with no public copy: ${missing.join(", ")}`);
  assert.ok(fixed.length >= 19, `expected the full probe set, saw ${fixed.length}`);
});
