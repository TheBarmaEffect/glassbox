export const PLATFORMS = ["api", "discord", "slack", "telegram", "github", "reddit", "mcp"] as const;
export type Platform = typeof PLATFORMS[number];

export interface VerificationInput {
  question: string;
  answer: string;
  intents?: string[];
  platform: Platform;
  checkpoint?: RuntimeCheckpoint;
  constitution?: RuntimeConstitution;
  response_policy?: ResponsePolicy;
  /** The tool call being authorized, when this checkpoint is a tool invocation. */
  tool?: ToolInvocation;
  /** Declarations pinned at approval time, against which drift is detected. */
  tool_pins?: ToolPin[];
  /** Capability scope. Omit for "no scope declared"; [] means no tool is permitted. */
  allowed_tools?: string[];
}

export type RuleKind = "require_phrase" | "forbid_phrase" | "require_citation" | "forbid_absolute_certainty" | "allow_target" | "forbid_target";
export interface ConstitutionRule { id: string; requirement: string; kind: RuleKind; value?: string; severity: RedTeamProbe["severity"]; }
export interface RuntimeConstitution { version: string; rules: ConstitutionRule[]; }
export interface RuntimeCheckpoint { id: string; type: "input" | "model_output" | "agent_step" | "tool_call" | "final_output"; actor?: string; target?: string; }
export type ResponseAction = "allow" | "record" | "block" | "retry" | "escalate";
export interface ResponsePolicy { trust?: ResponseAction; caution?: ResponseAction; reject?: ResponseAction; }

/** A tool's published identity: what an agent reads and what the caller pins. */
export interface ToolDeclaration {
  name: string;
  description?: string;
  input_schema?: unknown;
}

/**
 * A pinned declaration, produced at approval time. Component hashes are optional so a pin
 * that carries only the combined digest still detects drift, though without them drift
 * cannot be attributed to a component.
 *
 * `pin_version` names the digest algorithm that produced the hashes. It is absent on pins
 * issued before the algorithm was versioned, and those are refused explicitly rather than
 * compared against bytes they were never computed over.
 */
export interface ToolPin {
  tool: string;
  declaration_hash: string;
  component_hashes?: { name: string; description: string; schema: string };
  /** Digest algorithm version, e.g. "gbx-pin-2". Absent means a pre-versioning pin. */
  pin_version?: string;
  pinned_at?: string;
}

export interface ToolInvocation {
  tool: string;
  arguments?: Record<string, unknown>;
  declaration?: ToolDeclaration;
}

export interface Claim {
  id: string;
  text: string;
  reasoning: string;
  confidence: number;
  supporting_evidence: string[];
  attack_surface: string[];
  status: "observed" | "reconstructed" | "assumed";
}

export interface RedTeamProbe {
  angle: string;
  passed: boolean;
  severity: "low" | "medium" | "high" | "critical";
  finding: string;
  evidence: string[];
}

export interface TrustCard {
  question: string;
  answer: string;
  verdict: "trust" | "caution" | "reject";
  verdict_rationale: string;
  ecs: {
    total: number;
    dimensions: Record<string, number>;
    notes: string[];
  };
  claims: Claim[];
  red_team: {
    probes: RedTeamProbe[];
    pass_rate: number;
    highest_severity: "low" | "medium" | "high" | "critical";
  };
  constitution: {
    rules: Array<{ id: string; requirement: string; severity: string }>;
    evaluations?: Record<string, "satisfied" | "violated" | "not_triggered">;
  };
  governance?: {
    checkpoint: RuntimeCheckpoint;
    constitution_version: string;
    response: {
      action: ResponseAction;
      /**
       * Whether the gateway itself carried the action out. False on the advisory
       * /api/v1/verify path, where the caller must enforce; true on /api/v1/govern,
       * which withholds the output itself. Hard-coding this to false made the audit
       * record state the opposite of what the enforcing gate had just done.
       */
      executed: boolean;
      /** True when a caller-supplied response_policy tried to release a rejected output. */
      policy_downgrade_refused: boolean;
      rationale: string;
    };
  };
  audit: {
    log_id: string;
    generated_at: string;
    inputs_hash: string;
  };
}

export interface Verifier {
  verify(input: VerificationInput): Promise<TrustCard>;
  ready?(): Promise<boolean>;
  reset?(): Promise<void>;
  close?(): Promise<void>;
}
