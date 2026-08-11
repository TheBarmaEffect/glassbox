import { createServer } from "node:http";
import { createApp } from "./app.js";
import { assertRunnableConfig, loadConfig } from "./config.js";
import { McpGlassboxClient } from "./glassbox.js";
import { RestNotionClient } from "./notion.js";
import { EncryptedFileTokenStore, StaticTokenStore } from "./store.js";

const config = loadConfig();
assertRunnableConfig(config);

const tokens =
  config.oauthClientId && config.tokenStoreFile && config.tokenEncryptionKey
    ? new EncryptedFileTokenStore(config.tokenStoreFile, config.tokenEncryptionKey)
    : new StaticTokenStore(config.notionAccessToken!, config.notionWorkspaceId);

const handler = createApp({
  config,
  tokens,
  notion: new RestNotionClient(),
  glassbox: new McpGlassboxClient(config.glassboxMcpUrl),
});

createServer((request, response) => {
  void handler(request, response);
}).listen(config.port, () => {
  // Do not log environment values, request bodies, OAuth codes, or tokens.
  console.log(`GlassBox Notion integration listening on port ${config.port}.`);
});
