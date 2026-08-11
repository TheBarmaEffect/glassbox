import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EncryptedFileTokenStore, EventLedger } from "../src/store.js";

test("OAuth tokens are authenticated-encrypted at rest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "glassbox-notion-store-"));
  try {
    const file = path.join(directory, "tokens.store");
    const store = new EncryptedFileTokenStore(file, randomBytes(32).toString("base64"));
    const accessToken = ["secret", "access-token-must-not-be-plaintext"].join("_");
    await store.put({
      workspaceId: "workspace-1",
      accessToken,
      workspaceName: "Example",
      installedAt: "2026-08-11T00:00:00.000Z",
    });
    assert.equal((await store.get("workspace-1"))?.accessToken, accessToken);
    assert.equal((await store.get("workspace-2")), undefined);
    assert.equal((await readFile(file, "utf8")).includes(accessToken), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("event ledger suppresses retries but releases delivery failures", () => {
  const ledger = new EventLedger();
  assert.equal(ledger.claim("event-1", 0), true);
  assert.equal(ledger.claim("event-1", 1), false);
  ledger.release("event-1");
  assert.equal(ledger.claim("event-1", 2), true);
  ledger.delivered("event-1");
  ledger.release("event-1");
  assert.equal(ledger.claim("event-1", 3), false);
});
