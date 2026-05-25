#!/usr/bin/env node
/**
 * Glass Box Framework — MCP server entry point.
 *
 * Exposes the v1 six-tool surface over the Model Context Protocol stdio
 * transport:
 *
 *   glassbox_verify_answer         — full pipeline → Trust Card
 *   glassbox_extract_claims        — claim extraction with reasoning chains
 *   glassbox_score_ecs             — ECS only, from prebuilt parts
 *   glassbox_red_team              — Glassbox Court (7-angle adversarial probes)
 *   glassbox_generate_trust_card   — assemble a Trust Card from prebuilt parts
 *   glassbox_export_audit_report   — full pipeline → AuditRecord (deterministic log_id)
 *
 * The constitution compiler is an internal engine — every tool that needs
 * a constitution accepts `intents?` and compiles inline. We deliberately
 * keep the *public* tool count to six.
 *
 * Architecture note: this MCP server *is* an LLM-as-judge layer. The
 * Python research core at `../core/` is deterministic and local-only (per
 * its ROADMAP commitment); the MCP server is the network surface — the
 * runtime trust interface that lives inside Claude Desktop and similar
 * hosts. The two layers are intentional siblings, not competing
 * implementations.
 *
 * Every tool input is validated with Zod at runtime. Surface-level shapes
 * are declared inline. Tools that accept deeply-nested structures
 * (Claim[], RedTeamReport, ECSReport, ConstitutionReport) re-parse those
 * structures with the canonical internal schemas inside the handler.
 *
 * Type-erasure note: @modelcontextprotocol/sdk 1.29's `registerTool`
 * overload tries to infer the handler's input type from the supplied
 * Zod raw shape. With six concurrent registrations the cumulative
 * inference overflows TypeScript's depth budget (TS2589). To keep
 * strict-mode compilation working without sacrificing runtime
 * validation, we wrap the SDK call in `defineTool` below, which accepts
 * an explicit input type from the caller and forwards the schema to the
 * SDK with a localised cast. Zod still validates at runtime; only the
 * type-level link between schema and handler is erased.
 *
 * Every handler wraps its engine call in try/catch and returns a
 * structured error so MCP clients see a clean failure mode instead of
 * a thrown exception.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getConfiguredModel } from "./anthropic-client";
import { extractClaims } from "./engines/claims";
import { compileConstitution, evaluateConstitution } from "./engines/constitution";
import { computeECS } from "./engines/ecs";
import { runRedTeam } from "./engines/redteam";
import {
  assembleTrustCardFromParts,
  buildTrustCard,
} from "./engines/trustcard";
import type {
  Claim,
  ConstitutionReport,
  ECSReport,
  ECSWeights,
  RedTeamReport,
} from "./types";

const server = new McpServer({
  name: "glass-box-framework",
  version: "1.0.0",
});

/* ------------------------------------------------------------------ */
/* Canonical internal validators (used inside handlers).              */
/* ------------------------------------------------------------------ */

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  supporting_evidence: z.array(z.string()),
  attack_surface: z.array(z.string()),
  status: z.enum(["observed", "reconstructed", "assumed"]),
});

const ClaimArraySchema = z.array(ClaimSchema);

const RedTeamReportSchema = z.object({
  probes: z.array(
    z.object({
      angle: z.enum([
        "fabrication",
        "source_manipulation",
        "bias_injection",
        "context_attack",
        "overconfidence",
        "underspecification",
        "constitutional_violation",
      ]),
      passed: z.boolean(),
      severity: SeveritySchema,
      question_asked: z.string(),
      finding: z.string(),
      evidence: z.array(z.string()),
    })
  ),
  pass_rate: z.number().min(0).max(1),
  highest_severity: SeveritySchema,
});

const ConstitutionalRuleSchema = z.object({
  id: z.string(),
  source_intent: z.string(),
  trigger: z.string(),
  requirement: z.string(),
  rationale: z.string(),
  severity: SeveritySchema,
});

const ConstitutionReportSchema = z.object({
  rules: z.array(ConstitutionalRuleSchema),
  evaluations: z
    .record(z.string(), z.enum(["satisfied", "violated", "not_triggered"]))
    .optional(),
});

const ECSReportSchema = z.object({
  dimensions: z.object({
    groundedness: z.number().min(0).max(1),
    coherence: z.number().min(0).max(1),
    calibration: z.number().min(0).max(1),
    red_team_resistance: z.number().min(0).max(1),
    constitutional_compliance: z.number().min(0).max(1),
  }),
  weights: z.object({
    groundedness: z.number().min(0).max(1),
    coherence: z.number().min(0).max(1),
    calibration: z.number().min(0).max(1),
    red_team_resistance: z.number().min(0).max(1),
    constitutional_compliance: z.number().min(0).max(1),
  }),
  mode: z.enum(["arithmetic", "geometric"]),
  formula: z.string(),
  total: z.number().min(0).max(1),
  notes: z.array(z.string()),
});

const WeightsSchema = z.object({
  groundedness: z.number().min(0).max(1).optional(),
  coherence: z.number().min(0).max(1).optional(),
  calibration: z.number().min(0).max(1).optional(),
  red_team_resistance: z.number().min(0).max(1).optional(),
  constitutional_compliance: z.number().min(0).max(1).optional(),
});

/* ------------------------------------------------------------------ */
/* Tool result shape and typed registration wrapper                   */
/* ------------------------------------------------------------------ */

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
};

/**
 * Wraps `server.registerTool` with an explicit handler-input type so
 * strict-mode TypeScript does not have to infer through the SDK's
 * deeply-nested generic chain. The schema object is still passed to the
 * SDK and Zod still validates at runtime; only the type-level link
 * between schema and handler is erased.
 */
function defineTool<TInput>(
  name: string,
  config: ToolConfig,
  handler: (input: TInput) => Promise<ToolResult>
): void {
  // Localised cast on `server` itself so `this` binding is preserved
  // when we invoke `registerTool`.
  const erased = server as unknown as {
    registerTool: (
      name: string,
      config: ToolConfig,
      handler: (input: TInput) => Promise<ToolResult>
    ) => unknown;
  };
  erased.registerTool(name, config, handler);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function ok(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function fail(tool: string, err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            tool,
            error: message,
            hint:
              "Check that ANTHROPIC_API_KEY is set in the environment this MCP server " +
              "was launched from. Glass Box uses the Anthropic API for its verification engines.",
          },
          null,
          2
        ),
      },
    ],
  };
}

function strictParse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${label}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

/**
 * Compile + evaluate a constitution inline from a list of intents. Used
 * by tools that previously delegated to a separate `compile_constitution`
 * tool — we removed that from the public surface to keep the tool count
 * at six, so this helper is the only path.
 */
async function resolveConstitution(
  question: string,
  answer: string,
  intents: string[] | undefined,
  prebuilt: ConstitutionReport | null
): Promise<ConstitutionReport | null> {
  if (prebuilt) return prebuilt;
  if (!intents || intents.length === 0) return null;
  const compiled = await compileConstitution(intents);
  const evaluated = await evaluateConstitution({
    question,
    answer,
    rules: compiled.report.rules,
  });
  return { rules: compiled.report.rules, evaluations: evaluated.evaluations };
}

/* ------------------------------------------------------------------ */
/* 1. glassbox_verify_answer                                          */
/* ------------------------------------------------------------------ */

interface VerifyAnswerInput {
  question: string;
  answer: string;
  intents?: string[];
}

defineTool<VerifyAnswerInput>(
  "glassbox_verify_answer",
  {
    title: "Glassbox · Verify Answer",
    description:
      "Run a question/answer pair through the entire Glass Box Framework: claim extraction → constitution compile + evaluate → Glassbox Court (red-team) → ECS → verdict. Returns a Trust Card with verdict, ECS breakdown, per-claim reasoning, all 7 red-team probes, and the deterministic audit reference.",
    inputSchema: {
      question: z.string().min(1),
      answer: z.string().min(1),
      intents: z.array(z.string()).optional(),
    },
  },
  async ({ question, answer, intents }) => {
    try {
      const { trustCard } = await buildTrustCard({ question, answer, intents });
      return ok(trustCard);
    } catch (err) {
      return fail("glassbox_verify_answer", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* 2. glassbox_extract_claims                                         */
/* ------------------------------------------------------------------ */

interface ExtractClaimsInput {
  question: string;
  answer: string;
}

defineTool<ExtractClaimsInput>(
  "glassbox_extract_claims",
  {
    title: "Glassbox · Extract Claims",
    description:
      "Decompose an answer into atomic claims. Every claim carries a non-empty reasoning chain explaining why it is asserted, what evidence supports it, and how it could be falsified. Fallback claims (produced when the LLM call fails) are explicitly marked with a [fallback] prefix. The reasoning field is non-negotiable — it is the core product of the framework.",
    inputSchema: {
      question: z.string().min(1),
      answer: z.string().min(1),
    },
  },
  async ({ question, answer }) => {
    try {
      const result = await extractClaims(question, answer);
      return ok({ claims: result.claims, trace: result.trace });
    } catch (err) {
      return fail("glassbox_extract_claims", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* 3. glassbox_score_ecs                                              */
/* ------------------------------------------------------------------ */

interface ScoreECSInput {
  claims: unknown;
  red_team?: unknown;
  constitution?: unknown;
  weights?: unknown;
  mode?: "arithmetic" | "geometric";
}

defineTool<ScoreECSInput>(
  "glassbox_score_ecs",
  {
    title: "Glassbox · Score ECS",
    description:
      "Compute the Epistemic Confidence Score over prebuilt claims, an optional red-team report, and an optional constitution. Returns all five dimension scores, the weights used, the exact formula evaluated, and the total — never just the total. Defaults to weighted arithmetic mean; pass mode=\"geometric\" for the stricter variant.",
    inputSchema: {
      claims: z.array(z.unknown()),
      red_team: z.unknown().optional(),
      constitution: z.unknown().optional(),
      weights: z.unknown().optional(),
      mode: z.enum(["arithmetic", "geometric"]).optional(),
    },
  },
  async ({ claims, red_team, constitution, weights, mode }) => {
    try {
      const parsedClaims: Claim[] = strictParse(ClaimArraySchema, claims, "claims");
      const parsedRedTeam: RedTeamReport | null =
        red_team === undefined || red_team === null
          ? null
          : strictParse(RedTeamReportSchema, red_team, "red_team");
      const parsedConstitution: ConstitutionReport | null =
        constitution === undefined || constitution === null
          ? null
          : strictParse(ConstitutionReportSchema, constitution, "constitution");
      const parsedWeights: Partial<ECSWeights> | undefined =
        weights === undefined ? undefined : strictParse(WeightsSchema, weights, "weights");

      const result = await computeECS({
        claims: parsedClaims,
        redTeam: parsedRedTeam,
        constitution: parsedConstitution,
        weights: parsedWeights,
        mode,
      });
      return ok(result.report);
    } catch (err) {
      return fail("glassbox_score_ecs", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* 4. glassbox_red_team — Glassbox Court                              */
/* ------------------------------------------------------------------ */

interface RedTeamInput {
  question: string;
  answer: string;
  claims?: unknown;
  constitution?: unknown;
  intents?: string[];
}

defineTool<RedTeamInput>(
  "glassbox_red_team",
  {
    title: "Glassbox · Court (7-Angle Red Team)",
    description:
      "Glassbox Court runs all seven adversarial probes against an answer: fabrication, source manipulation, bias injection, context attack, overconfidence, underspecification, and constitutional violation. Returns one finding per probe, with verbatim evidence, even when the probe passes. If `intents` are supplied and `constitution` is not, the intents are compiled and evaluated inline so the constitutional_violation probe runs against the right rule set.",
    inputSchema: {
      question: z.string().min(1),
      answer: z.string().min(1),
      claims: z.array(z.unknown()).optional(),
      constitution: z.unknown().optional(),
      intents: z.array(z.string()).optional(),
    },
  },
  async ({ question, answer, claims, constitution, intents }) => {
    try {
      let actualClaims: Claim[];
      if (claims === undefined || claims === null) {
        const extracted = await extractClaims(question, answer);
        actualClaims = extracted.claims;
      } else {
        actualClaims = strictParse(ClaimArraySchema, claims, "claims");
      }
      const prebuilt: ConstitutionReport | null =
        constitution === undefined || constitution === null
          ? null
          : strictParse(ConstitutionReportSchema, constitution, "constitution");
      const resolvedConstitution = await resolveConstitution(
        question,
        answer,
        intents,
        prebuilt
      );
      const result = await runRedTeam({
        question,
        answer,
        claims: actualClaims,
        constitution: resolvedConstitution,
      });
      return ok(result.report);
    } catch (err) {
      return fail("glassbox_red_team", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* 5. glassbox_generate_trust_card                                    */
/*                                                                    */
/* Assembly tool. Composes a Trust Card from already-computed claims, */
/* red-team report, and ECS report. Useful for UI flows that          */
/* progressively reveal each section, or for callers that ran each    */
/* engine independently and want to compose the final artifact.       */
/* The verdict policy is identical to glassbox_verify_answer.         */
/* ------------------------------------------------------------------ */

interface GenerateTrustCardInput {
  question: string;
  answer: string;
  claims: unknown;
  red_team: unknown;
  ecs: unknown;
  constitution?: unknown;
  intents?: string[];
}

defineTool<GenerateTrustCardInput>(
  "glassbox_generate_trust_card",
  {
    title: "Glassbox · Generate Trust Card",
    description:
      "Assemble a Trust Card from prebuilt parts (claims, red_team, ecs, optional constitution). No new LLM calls are made by this tool — it derives the verdict from the supplied parts and produces a deterministic audit reference. Use this when you have already called glassbox_extract_claims / glassbox_red_team / glassbox_score_ecs separately and want to compose the final artifact.",
    inputSchema: {
      question: z.string().min(1),
      answer: z.string().min(1),
      claims: z.array(z.unknown()),
      red_team: z.unknown(),
      ecs: z.unknown(),
      constitution: z.unknown().optional(),
      intents: z.array(z.string()).optional(),
    },
  },
  async ({ question, answer, claims, red_team, ecs, constitution, intents }) => {
    try {
      const parsedClaims: Claim[] = strictParse(ClaimArraySchema, claims, "claims");
      const parsedRedTeam: RedTeamReport = strictParse(
        RedTeamReportSchema,
        red_team,
        "red_team"
      );
      const parsedECS: ECSReport = strictParse(ECSReportSchema, ecs, "ecs");
      const parsedConstitution: ConstitutionReport | undefined =
        constitution === undefined || constitution === null
          ? undefined
          : strictParse(ConstitutionReportSchema, constitution, "constitution");

      const { trustCard } = assembleTrustCardFromParts({
        question,
        answer,
        claims: parsedClaims,
        red_team: parsedRedTeam,
        ecs: parsedECS,
        constitution: parsedConstitution,
        intents,
      });
      return ok(trustCard);
    } catch (err) {
      return fail("glassbox_generate_trust_card", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* 6. glassbox_export_audit_report                                    */
/* ------------------------------------------------------------------ */

interface ExportAuditReportInput {
  question: string;
  answer: string;
  intents?: string[];
}

defineTool<ExportAuditReportInput>(
  "glassbox_export_audit_report",
  {
    title: "Glassbox · Export Audit Report",
    description:
      "Run the full Glass Box pipeline and return a full AuditRecord, including the per-call API trace and a deterministic SHA-256-based log_id. Two runs with identical inputs AND identical engine outputs produce the same log_id, enabling replay detection and cache lookups.",
    inputSchema: {
      question: z.string().min(1),
      answer: z.string().min(1),
      intents: z.array(z.string()).optional(),
    },
  },
  async ({ question, answer, intents }) => {
    try {
      const { auditRecord } = await buildTrustCard({ question, answer, intents });
      return ok(auditRecord);
    } catch (err) {
      return fail("glassbox_export_audit_report", err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr — stdout is reserved for the MCP transport.
  process.stderr.write(
    `Glass Box MCP server running on stdio. Model: ${getConfiguredModel()}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
