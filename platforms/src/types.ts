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
}

export type RuleKind = "require_phrase" | "forbid_phrase" | "require_citation" | "forbid_absolute_certainty" | "allow_target" | "forbid_target";
export interface ConstitutionRule { id: string; requirement: string; kind: RuleKind; value?: string; severity: RedTeamProbe["severity"]; }
export interface RuntimeConstitution { version: string; rules: ConstitutionRule[]; }
export interface RuntimeCheckpoint { id: string; type: "input" | "model_output" | "agent_step" | "tool_call" | "final_output"; actor?: string; target?: string; }
export type ResponseAction = "allow" | "record" | "block" | "retry" | "escalate";
export interface ResponsePolicy { trust?: ResponseAction; caution?: ResponseAction; reject?: ResponseAction; }

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
    response: { action: ResponseAction; executed: false; rationale: string };
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
