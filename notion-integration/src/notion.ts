import { NOTION_API_VERSION } from "./config.js";
import type { NotionClient, NotionComment, StoredNotionToken } from "./types.js";

const NOTION_API = "https://api.notion.com/v1";

async function notionRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Notion API request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export class RestNotionClient implements NotionClient {
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  retrieveComment(accessToken: string, commentId: string): Promise<NotionComment> {
    return notionRequest<NotionComment>(
      accessToken,
      `/comments/${encodeURIComponent(commentId)}`,
      {},
      this.#fetch,
    );
  }

  async replyToDiscussion(
    accessToken: string,
    discussionId: string,
    text: string,
  ): Promise<void> {
    await notionRequest(
      accessToken,
      "/comments",
      {
        method: "POST",
        body: JSON.stringify({
          discussion_id: discussionId,
          rich_text: [{ type: "text", text: { content: text } }],
        }),
      },
      this.#fetch,
    );
  }
}

interface OauthTokenResponse {
  access_token?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
}

export async function exchangeOauthCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<StoredNotionToken> {
  const response = await (options.fetchImpl ?? fetch)(`${NOTION_API}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Notion OAuth exchange failed with HTTP ${response.status}.`);
  const value = (await response.json()) as OauthTokenResponse;
  if (!value.access_token || !value.workspace_id) {
    throw new Error("Notion OAuth response did not contain an access token and workspace ID.");
  }
  return {
    accessToken: value.access_token,
    workspaceId: value.workspace_id,
    botId: value.bot_id,
    workspaceName: value.workspace_name,
    installedAt: new Date().toISOString(),
  };
}
