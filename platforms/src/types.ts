export const PLATFORMS = ["api", "discord", "slack", "telegram", "github", "reddit", "mcp"] as const;
export type Platform = typeof PLATFORMS[number];

export interface VerificationInput {
  question: string;
  answer: string;
  intents?: string[];
  platform: Platform;
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
