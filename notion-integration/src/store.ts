import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoredNotionToken, TokenStore } from "./types.js";

type SealedValue = { iv: string; ciphertext: string; tag: string };
type StoreFile = { version: 1; records: Record<string, SealedValue> };

function encryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function seal(record: StoredNotionToken, key: Buffer): SealedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function unseal(value: SealedValue, key: Buffer): StoredNotionToken {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const record = JSON.parse(plaintext) as Partial<StoredNotionToken>;
  if (!record.workspaceId || !record.accessToken || !record.installedAt) {
    throw new Error("Encrypted token-store record is invalid.");
  }
  return record as StoredNotionToken;
}

export class StaticTokenStore implements TokenStore {
  readonly #record: StoredNotionToken;

  constructor(accessToken: string, workspaceId = "single-workspace") {
    this.#record = {
      workspaceId,
      accessToken,
      installedAt: new Date(0).toISOString(),
    };
  }

  async get(workspaceId: string): Promise<StoredNotionToken | undefined> {
    if (this.#record.workspaceId !== "single-workspace" && workspaceId !== this.#record.workspaceId) {
      return undefined;
    }
    return this.#record;
  }

  async put(): Promise<void> {
    throw new Error("Static single-workspace token storage cannot accept OAuth installations.");
  }
}

export class EncryptedFileTokenStore implements TokenStore {
  readonly #path: string;
  readonly #key: Buffer;
  #writes: Promise<void> = Promise.resolve();

  constructor(path: string, encodedKey: string) {
    this.#path = path;
    this.#key = encryptionKey(encodedKey);
  }

  async #read(): Promise<StoreFile> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as Partial<StoreFile>;
      if (value.version !== 1 || !value.records || typeof value.records !== "object") {
        throw new Error("Token store has an unsupported format.");
      }
      return value as StoreFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, records: {} };
      }
      throw error;
    }
  }

  async get(workspaceId: string): Promise<StoredNotionToken | undefined> {
    const value = (await this.#read()).records[workspaceId];
    return value ? unseal(value, this.#key) : undefined;
  }

  async put(record: StoredNotionToken): Promise<void> {
    const write = async (): Promise<void> => {
      const store = await this.#read();
      store.records[record.workspaceId] = seal(record, this.#key);
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${process.pid}.${randomBytes(6).toString("hex")}`;
      await writeFile(temporary, `${JSON.stringify(store)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#path);
      await chmod(this.#path, 0o600);
    };
    const pending = this.#writes.then(write, write);
    this.#writes = pending.catch(() => undefined);
    await pending;
  }
}

export class EventLedger {
  readonly #events = new Map<string, { state: "processing" | "delivered"; expiresAt: number }>();

  claim(eventId: string, now = Date.now()): boolean {
    this.#sweep(now);
    if (this.#events.has(eventId)) return false;
    this.#events.set(eventId, { state: "processing", expiresAt: now + 24 * 60 * 60 * 1_000 });
    return true;
  }

  delivered(eventId: string): void {
    const event = this.#events.get(eventId);
    if (event) event.state = "delivered";
  }

  release(eventId: string): void {
    if (this.#events.get(eventId)?.state === "processing") this.#events.delete(eventId);
  }

  #sweep(now: number): void {
    for (const [id, event] of this.#events) {
      if (event.expiresAt <= now) this.#events.delete(id);
    }
  }
}
