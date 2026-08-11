/* global GlassBoxMcp */
"use strict";

if (typeof importScripts === "function" && !globalThis.GlassBoxMcp) {
  importScripts("lib/mcp-client.js");
}

const extensionApi = globalThis.browser ?? globalThis.chrome;
const CONTEXT_MENU_ID = "glassbox-audit-selection";
const SELECTION_KEY = "glassboxPendingSelection";
const SELECTION_TTL_MS = 2 * 60_000;

extensionApi.runtime.onInstalled.addListener(() => {
  Promise.resolve(extensionApi.contextMenus.removeAll())
    .catch(() => undefined)
    .then(() => extensionApi.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Audit selected text with GlassBox",
      contexts: ["selection"],
    }))
    .catch(() => undefined);
});

extensionApi.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = typeof info.selectionText === "string" ? info.selectionText.trim().slice(0, 12_000) : "";
  if (!selectedText) return;
  void stageSelection(selectedText);
});

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof GlassBoxMcp.GlassBoxClientError
        ? { code: error.code, message: error.message }
        : { code: "unexpected", message: "GlassBox encountered an unexpected error." },
    }));
  return true;
});

async function stageSelection(text) {
  if (!extensionApi.storage?.session) return;
  await extensionApi.storage.session.set({
    [SELECTION_KEY]: { text, expiresAt: Date.now() + SELECTION_TTL_MS },
  });
  await extensionApi.tabs.create({ url: extensionApi.runtime.getURL("audit.html?selection=1") });
}

async function handleMessage(message) {
  if (message?.type === "glassbox:audit") {
    return GlassBoxMcp.callGlassBox(message.input);
  }
  if (message?.type === "glassbox:consume-selection") {
    if (!extensionApi.storage?.session) return undefined;
    const stored = await extensionApi.storage.session.get(SELECTION_KEY);
    await extensionApi.storage.session.remove(SELECTION_KEY);
    const pending = stored?.[SELECTION_KEY];
    return pending && pending.expiresAt >= Date.now() ? pending.text : undefined;
  }
  throw new GlassBoxMcp.GlassBoxClientError("Unsupported extension request.", "invalid_request");
}
