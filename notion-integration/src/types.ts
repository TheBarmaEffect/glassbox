export interface AuditInput {
  question: string;
  answer: string;
  intents?: string[];
}

export interface AuditResult {
  verdict: "trust" | "caution" | "reject";
  summary: string;
  score: number;
  claim_count: number;
  finding_count: number;
  highest_severity: "low" | "medium" | "high" | "critical";
  findings: Array<{ angle: string; severity: string; summary: string }>;
  caveats: string[];
}

export interface StoredNotionToken {
  workspaceId: string;
  accessToken: string;
  botId?: string;
  workspaceName?: string;
  installedAt: string;
}

export interface TokenStore {
  get(workspaceId: string): Promise<StoredNotionToken | undefined>;
  put(record: StoredNotionToken): Promise<void>;
}

export interface GlassboxClient {
  audit(input: AuditInput): Promise<AuditResult>;
}

export interface NotionComment {
  id: string;
  discussion_id: string;
  created_by?: { id?: string; type?: string; object?: string };
  rich_text?: Array<{ plain_text?: string }>;
}

export interface NotionClient {
  retrieveComment(accessToken: string, commentId: string): Promise<NotionComment>;
  replyToDiscussion(accessToken: string, discussionId: string, text: string): Promise<void>;
}
