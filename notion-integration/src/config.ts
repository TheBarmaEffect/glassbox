export const NOTION_API_VERSION = "2026-03-11";

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  glassboxMcpUrl: string;
  notionAccessToken?: string;
  notionWorkspaceId?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthAuthorizationUrl?: string;
  oauthRedirectUri?: string;
  tokenEncryptionKey?: string;
  tokenStoreFile?: string;
  webhookVerificationToken?: string;
  setupAdminSecret?: string;
}

function optional(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = source[name]?.trim();
  return value || undefined;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  return port;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicBaseUrl = optional(source, "PUBLIC_BASE_URL") ?? "http://localhost:8787";
  if (!URL.canParse(publicBaseUrl)) throw new Error("PUBLIC_BASE_URL must be a valid URL.");
  const glassboxMcpUrl =
    optional(source, "GLASSBOX_MCP_URL") ??
    "https://glassbox-platform-gateway.onrender.com/mcp";
  if (!URL.canParse(glassboxMcpUrl)) throw new Error("GLASSBOX_MCP_URL must be a valid URL.");

  return {
    port: parsePort(source.PORT),
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    glassboxMcpUrl,
    notionAccessToken: optional(source, "NOTION_ACCESS_TOKEN"),
    notionWorkspaceId: optional(source, "NOTION_WORKSPACE_ID"),
    oauthClientId: optional(source, "NOTION_OAUTH_CLIENT_ID"),
    oauthClientSecret: optional(source, "NOTION_OAUTH_CLIENT_SECRET"),
    oauthAuthorizationUrl: optional(source, "NOTION_OAUTH_AUTHORIZATION_URL"),
    oauthRedirectUri: optional(source, "NOTION_OAUTH_REDIRECT_URI"),
    tokenEncryptionKey: optional(source, "TOKEN_ENCRYPTION_KEY"),
    tokenStoreFile: optional(source, "NOTION_TOKEN_STORE_FILE"),
    webhookVerificationToken: optional(source, "NOTION_WEBHOOK_VERIFICATION_TOKEN"),
    setupAdminSecret: optional(source, "SETUP_ADMIN_SECRET"),
  };
}

export function assertRunnableConfig(config: AppConfig): void {
  const oauthFields = [
    config.oauthClientId,
    config.oauthClientSecret,
    config.oauthRedirectUri,
    config.tokenEncryptionKey,
    config.tokenStoreFile,
  ];
  const hasAnyOauth = oauthFields.some(Boolean);
  const hasAllOauth = oauthFields.every(Boolean);
  if (hasAnyOauth && !hasAllOauth) {
    throw new Error(
      "Public OAuth mode requires client ID, client secret, redirect URI, encryption key, and a durable token-store file.",
    );
  }
  if (config.notionAccessToken && hasAllOauth) {
    throw new Error("Configure single-workspace token mode or public OAuth mode, not both.");
  }
  if (!config.notionAccessToken && !hasAllOauth) {
    throw new Error("Configure either NOTION_ACCESS_TOKEN or the complete public OAuth mode.");
  }
  if (!config.webhookVerificationToken && !config.setupAdminSecret) {
    throw new Error(
      "Configure NOTION_WEBHOOK_VERIFICATION_TOKEN or SETUP_ADMIN_SECRET for one-time webhook setup.",
    );
  }
}
