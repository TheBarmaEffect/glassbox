import crypto from "node:crypto";
import { CanonicalJsonError, canonicalJson, sha256Canonical } from "./canonical.js";
import type { ResponseAction, RuntimeCheckpoint, TrustCard } from "./types.js";

/**
 * Tamper-evident trajectory audit chain.
 *
 * Each verification emits an independent `audit.inputs_hash` with nothing linking it to
 * the verification before it. Across a multi-step agent run that means a record can be
 * dropped, reordered, or inserted and no one can tell: every record is individually
 * well-formed, and individual well-formedness is all the current audit trail asserts.
 * This module supplies the missing linkage, so that the *sequence* of governance
 * decisions is as verifiable as each decision is on its own.
 *
 * ## What is carried
 *
 * Hashes, categorical fields, integers and booleans. No question, no answer, no probe
 * evidence, no tool arguments. `inputs_hash` is already a digest on the TrustCard so it
 * is safe to carry forward, and it is what binds a chain record to the verification it
 * describes. `checkpoint` carries caller-declared routing metadata (id, type, actor,
 * target) rather than model output. The gateway can keep advertising
 * `raw_content_persistence: false` with this chain in place.
 *
 * ## What is proved, and what is not
 *
 *   - Alteration of any field of any record: the stored `record_hash` no longer matches.
 *   - Dropping or inserting a record in the middle: caught twice over, by a gap in `seq`
 *     and by a break in `prev_hash` linkage. Two detectors rather than one because they
 *     fail independently — `seq` is inside the hash preimage, so records cannot be
 *     renumbered to close a gap without invalidating every hash downstream.
 *   - Reordering: breaks linkage immediately, and shows up as a `seq` gap too.
 *   - Truncation of the tail: **only once the trajectory is closed.** A truncated open
 *     chain is internally perfect, and no amount of hashing changes that. This is why
 *     `replay()` returns a trichotomy and not a boolean — see below.
 *
 * Not proved: split view. A dishonest operator can maintain two chains and show a
 * different one to each party. Certificate Transparency solves that with gossip between
 * independent monitors; there is no gossip here, so the claim is not made. Publishing a
 * signed `trace_hash` to an external log would close it, and is the natural upgrade.
 *
 * ## Ordering
 *
 * `seq` is the only trusted ordering. `generated_at` is inside the hash preimage — so it
 * cannot be altered after the fact — but it is never used for ordering, comparison, or
 * expiry arithmetic, because it comes from a clock the verifier has no reason to trust.
 *
 * ## Cross-language verification
 *
 * A seal signed here verifies under the *unmodified* `WitnessVerifier.verify()` in
 * `core/src/glassbox/witness/signing.py`: the envelope is that module's
 * `SignedWitnessDocument` field for field, the signed bytes are the same canonical JSON,
 * and the head field is called `trace_hash` because that is the one key the Python
 * verifier reads out of the document. Run end to end — sign in TypeScript, verify in
 * Python — including the negative cases (wrong head, altered `total_records`).
 *
 * What does *not* align, and cannot: the Python `WitnessDocument` dataclass declares
 * `avg_ecs: float`, so that particular document type can never satisfy the no-float rule.
 * The alignment is with the verifier, which treats the document as an opaque dict, not
 * with `WitnessProtocol`'s document schema. Carrying a score into a seal would mean
 * encoding it as a fixed-precision decimal string, which `WitnessDocument` has no field
 * for.
 *
 * ## How this would be wired (deliberately not wired yet)
 *
 * The gateway is stateless and single-writer; the chain keeps it that way by making the
 * *caller* carry the chain forward:
 *
 *   1. `VerificationInput` gains an optional `trajectory?: { id, seq, prev_hash }`.
 *      Absent, `verify()` behaves bit-identically to today — this is what keeps the
 *      change backward compatible and keeps `deepEqual(verify(x), verify(x))` true.
 *   2. In `verify()`, after `governance()`, build a `TrajectoryEntry` from the checkpoint,
 *      verdict, action, `released`, constitution version and the existing
 *      `audit.inputs_hash`, then `TrajectoryLog.resume(id, priorHashes).append(entry)`.
 *   3. `TrustCard.audit` gains an optional
 *      `trajectory?: { trajectory_id, seq, prev_hash, record_hash }`, and the running head
 *      also goes back as an `x-glassbox-chain-head` response header. It must not go inside
 *      the `/govern` `gate` object, which `test/adapters.test.ts` deep-equals against
 *      exactly five fields.
 *   4. `POST /api/v1/trajectory/replay` verifies a caller-submitted chain statelessly, and
 *      `GET /api/v1/trajectory/pubkey` publishes the signing key.
 *   5. `inputsHash()` in `src/lite.ts` is left alone. Repointing it at `sha256Canonical`
 *      would change every digest already published against it.
 *
 * Wiring touches the hot path, so it is a separate change with its own review.
 */

/** No record precedes the first one, so its `prev_hash` is a fixed non-hash sentinel. */
export const GENESIS_PREV_HASH = "0".repeat(64);

/** RFC 6962 domain separation. Without distinct prefixes a leaf could be presented as an
 * interior node, which is a second-preimage attack on the tree, not a theoretical nicety. */
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** Fixed 12-byte SPKI DER prefix for an Ed25519 public key; the remaining 32 bytes are raw. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * What a caller supplies for one link. Everything here is either a digest, an enumerated
 * value, a version string or a boolean — nothing that could carry submitted content.
 */
export interface TrajectoryEntry {
  checkpoint: RuntimeCheckpoint;
  verdict: TrustCard["verdict"];
  action: ResponseAction;
  /** Whether the output actually reached the user, as distinct from what was decided. */
  released: boolean;
  constitution_version: string;
  /** The existing `TrustCard.audit.inputs_hash`; a digest, hence safe to carry. */
  inputs_hash: string;
  /** UNTRUSTED. Hashed so it is tamper-evident, never used to order anything. */
  generated_at: string;
}

export interface TrajectoryRecord extends TrajectoryEntry {
  trajectory_id: string;
  /** 0-based, strictly +1, and inside the hash preimage so it cannot be renumbered. */
  seq: number;
  prev_hash: string;
  record_hash: string;
}

/**
 * Produced by `close()`. `total_records` and `merkle_root` commit to a chain of a specific
 * length, which is what makes tail truncation detectable.
 *
 * Precisely how much that is worth depends on who holds it. An *unsigned* seal held by the
 * same party that holds the records buys nothing against that party — they can truncate
 * and re-seal. Its value is to a verifier who obtained the seal, or its signature,
 * independently: sign it (`signSeal`) and pin the key, and truncation stops being
 * deniable. Stated here because the difference is easy to overclaim.
 *
 * The field is named `trace_hash`, not `head`, so that the Python core's
 * `WitnessVerifier.verify()` — which reads `document["trace_hash"]` and nothing else about
 * the document's shape — validates a seal produced here with no changes on its side.
 */
export interface TrajectorySeal {
  schema: "rcv-trajectory-close/1";
  trajectory_id: string;
  total_records: number;
  merkle_root: string;
  /** The head record's `record_hash`, which commits to every record before it. */
  trace_hash: string;
}

/**
 * The Python core's signed-document envelope, reproduced field for field
 * (`core/src/glassbox/witness/signing.py`) so the two sides interoperate.
 *
 * Inherited caveat: the Python envelope signs `document` only, so `signed_at` is outside
 * the signature and is not tamper-evident. Deviating would break compatibility, which is
 * the point of reusing the envelope, so the property is documented rather than fixed.
 */
export interface SignedTrajectorySeal {
  document: TrajectorySeal;
  signature: string;
  signed_at: string;
  public_key_hex: string;
  algorithm: "ed25519";
}

/**
 * Proves one record belongs to a tree of a stated size without revealing any other
 * record. The leaves are record *hashes*, so even the proved record's contents stay out
 * of the proof — an escalation packet can assert membership and disclose nothing else.
 */
export interface InclusionProof {
  schema: "rcv-trajectory-proof/1";
  trajectory_id: string;
  leaf_index: number;
  tree_size: number;
  record_hash: string;
  /** Sibling hashes, leaf to root. Direction is derived, not stored. */
  path: string[];
  merkle_root: string;
}

export type ReplayCompleteness = "verified_complete" | "verified_prefix" | "broken";

export type ReplayFailureCode =
  | "empty_chain"
  | "seq_not_zero_based"
  | "seq_gap"
  | "genesis_prev_hash"
  | "link_broken"
  | "record_altered"
  | "float_in_record"
  | "foreign_trajectory"
  | "total_mismatch"
  | "merkle_mismatch"
  | "trace_hash_mismatch"
  | "signature_invalid";

export interface ReplayFailure {
  code: ReplayFailureCode;
  /** The seq of the record at fault; -1 for a failure about the chain or seal as a whole. */
  seq: number;
  detail: string;
}

export interface ReplayResult {
  ok: boolean;
  completeness: ReplayCompleteness;
  head: string;
  record_count: number;
  merkle_root?: string;
  /** Every failure found, not just the first: a reviewer wants the whole picture. */
  failures: ReplayFailure[];
}

export interface ReplayExpectation {
  /** Required for `verified_complete`. Without it, tail truncation cannot be excluded. */
  seal?: TrajectorySeal;
  /** Takes precedence over `seal`: its signature is checked and its document used. */
  signed_seal?: SignedTrajectorySeal;
  /** Pins the signer. Absent, the envelope's own key is used, which proves integrity but
   * not authorship — anyone can re-sign a forged seal with a key of their own. */
  public_key_hex?: string;
}

/** The preimage of `record_hash` is the record minus `record_hash` itself (RFC-X style). */
function recordPreimage(record: TrajectoryRecord): Record<string, unknown> {
  const { record_hash: _omitted, ...rest } = record;
  return rest;
}

function leafHash(recordHash: string): Buffer {
  return crypto.createHash("sha256")
    .update(LEAF_PREFIX)
    .update(Buffer.from(recordHash, "hex"))
    .digest();
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return crypto.createHash("sha256").update(NODE_PREFIX).update(left).update(right).digest();
}

/** RFC 6962 splits at the largest power of two *strictly* below n, not at the midpoint. */
function splitPoint(size: number): number {
  let split = 1;
  while (split * 2 < size) split *= 2;
  return split;
}

function merkleRoot(leaves: Buffer[]): Buffer {
  const first = leaves[0];
  if (first === undefined) return crypto.createHash("sha256").digest();
  if (leaves.length === 1) return first;
  const split = splitPoint(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, split)), merkleRoot(leaves.slice(split)));
}

function auditPath(index: number, leaves: Buffer[]): Buffer[] {
  if (leaves.length <= 1) return [];
  const split = splitPoint(leaves.length);
  return index < split
    ? [...auditPath(index, leaves.slice(0, split)), merkleRoot(leaves.slice(split))]
    : [...auditPath(index - split, leaves.slice(split)), merkleRoot(leaves.slice(0, split))];
}

/**
 * Builds one trajectory's chain. Append-only, and sealed by `close()` so that the length
 * itself becomes a signed commitment.
 */
export class TrajectoryLog {
  private readonly trajectoryId: string;
  private readonly recordHashes: string[];
  private readonly appended: TrajectoryRecord[] = [];
  private headHash: string;
  private nextSeq: number;
  private sealed = false;

  constructor(trajectoryId: string) {
    this.trajectoryId = trajectoryId;
    this.recordHashes = [];
    this.headHash = GENESIS_PREV_HASH;
    this.nextSeq = 0;
  }

  /**
   * Continues a chain whose earlier records the caller holds, which is what lets the
   * gateway stay stateless: it is handed the prior record hashes, appends, and forgets.
   * Hashes are all that is needed — the prior records' contents never come back.
   */
  static resume(trajectoryId: string, priorRecordHashes: readonly string[]): TrajectoryLog {
    const log = new TrajectoryLog(trajectoryId);
    for (const hash of priorRecordHashes) {
      log.recordHashes.push(hash);
      log.headHash = hash;
    }
    log.nextSeq = priorRecordHashes.length;
    return log;
  }

  /** The most recent `record_hash`, or the genesis sentinel on an empty chain. */
  get head(): string {
    return this.headHash;
  }

  /** Total records in the chain, including those replayed in by `resume()`. */
  get length(): number {
    return this.recordHashes.length;
  }

  /** Only the records appended by this instance; `resume()` never reconstructs bodies. */
  get records(): readonly TrajectoryRecord[] {
    return this.appended;
  }

  append(entry: TrajectoryEntry): TrajectoryRecord {
    if (this.sealed) {
      throw new Error("This trajectory is closed; its seal commits to the record count.");
    }
    const withoutHash = {
      ...entry,
      trajectory_id: this.trajectoryId,
      seq: this.nextSeq,
      prev_hash: this.headHash,
    };
    const record: TrajectoryRecord = { ...withoutHash, record_hash: sha256Canonical(withoutHash) };
    this.appended.push(record);
    this.recordHashes.push(record.record_hash);
    this.headHash = record.record_hash;
    this.nextSeq += 1;
    return record;
  }

  /**
   * Seals the trajectory. `total_records` and `merkle_root` are what make tail truncation
   * detectable — a shortened chain is internally valid, but it cannot reproduce a root
   * over more leaves than it has.
   */
  close(): TrajectorySeal {
    if (this.recordHashes.length === 0) {
      throw new Error("An empty trajectory has no head to commit to.");
    }
    this.sealed = true;
    return {
      schema: "rcv-trajectory-close/1",
      trajectory_id: this.trajectoryId,
      total_records: this.recordHashes.length,
      merkle_root: merkleRoot(this.recordHashes.map(leafHash)).toString("hex"),
      trace_hash: this.headHash,
    };
  }

  /**
   * An O(log n) proof that the record at `seq` is in the tree as it stands now. On an open
   * log the proof commits to the tree *at this size*; a later, longer tree has a different
   * root, and proving the two are consistent needs a consistency proof this module does
   * not implement (see the split-view note above).
   */
  inclusionProof(seq: number): InclusionProof {
    if (!Number.isInteger(seq) || seq < 0 || seq >= this.recordHashes.length) {
      throw new Error(`seq ${seq} is not in this trajectory (0..${this.recordHashes.length - 1}).`);
    }
    const recordHash = this.recordHashes[seq];
    if (recordHash === undefined) throw new Error(`No record hash at seq ${seq}.`);
    const leaves = this.recordHashes.map(leafHash);
    return {
      schema: "rcv-trajectory-proof/1",
      trajectory_id: this.trajectoryId,
      leaf_index: seq,
      tree_size: this.recordHashes.length,
      record_hash: recordHash,
      path: auditPath(seq, leaves).map((sibling) => sibling.toString("hex")),
      merkle_root: merkleRoot(leaves).toString("hex"),
    };
  }
}

/**
 * RFC 6962 §2.1.1 path verification. The leaf hash is recomputed from `record_hash` rather
 * than taken from the proof, so a forged proof cannot smuggle in a leaf that was never in
 * the tree; and directions come from the (index, size) arithmetic rather than from the
 * proof, so they cannot be forged either.
 */
export function verifyInclusionProof(proof: InclusionProof, expectedRoot?: string): boolean {
  const size = proof.tree_size;
  let index = proof.leaf_index;
  if (!Number.isInteger(size) || !Number.isInteger(index) || size <= 0) return false;
  if (index < 0 || index >= size) return false;
  if (!/^[a-f0-9]{64}$/.test(proof.record_hash)) return false;

  let computed = leafHash(proof.record_hash);
  let last = size - 1;
  for (const sibling of proof.path) {
    if (!/^[a-f0-9]{64}$/.test(sibling)) return false;
    if (last === 0) return false;
    const siblingBytes = Buffer.from(sibling, "hex");
    if ((index & 1) === 1 || index === last) {
      computed = nodeHash(siblingBytes, computed);
      while ((index & 1) === 0 && index !== 0) {
        index >>= 1;
        last >>= 1;
      }
    } else {
      computed = nodeHash(computed, siblingBytes);
    }
    index >>= 1;
    last >>= 1;
  }
  if (last !== 0) return false;

  const root = expectedRoot ?? proof.merkle_root;
  return timingSafeHexEqual(computed.toString("hex"), root)
    && timingSafeHexEqual(proof.merkle_root, root);
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Verifies a chain end to end and reports *how* verified it is.
 *
 * The three outcomes are not a boolean with extra steps:
 *
 *   - `verified_complete` — every link, every hash, and a matching seal: the record count,
 *     Merkle root and head all agree with a commitment made when the trajectory closed.
 *     Nothing has been added, removed, altered or reordered.
 *   - `verified_prefix` — every link and hash checks out, but there is no seal. What is
 *     present is exactly what was written, *and there may have been more*. Truncating the
 *     tail of an unclosed chain leaves no evidence of any kind, so this outcome is the
 *     honest one and `verified_complete` is unreachable without a seal, by construction.
 *   - `broken` — at least one check failed; `failures` names the code and the `seq`.
 */
export function replay(
  records: readonly TrajectoryRecord[],
  expect: ReplayExpectation = {},
): ReplayResult {
  const failures: ReplayFailure[] = [];
  const first = records[0];
  if (first === undefined) {
    return {
      ok: false,
      completeness: "broken",
      head: GENESIS_PREV_HASH,
      record_count: 0,
      failures: [{ code: "empty_chain", seq: -1, detail: "A trajectory has at least one record." }],
    };
  }

  if (first.seq !== 0) {
    failures.push({
      code: "seq_not_zero_based",
      seq: first.seq,
      detail: `The first record has seq ${first.seq}; a complete chain starts at 0.`,
    });
  }
  if (first.prev_hash !== GENESIS_PREV_HASH) {
    failures.push({
      code: "genesis_prev_hash",
      seq: first.seq,
      detail: "The first record does not carry the genesis prev_hash, so a record precedes it.",
    });
  }

  const trajectoryId = first.trajectory_id;
  let previous: TrajectoryRecord | undefined;
  for (const record of records) {
    // Detector 1: contiguity of seq. Independent of linkage, and seq is inside the
    // preimage, so a gap cannot be closed by renumbering.
    if (previous !== undefined && record.seq !== previous.seq + 1) {
      failures.push({
        code: "seq_gap",
        seq: record.seq,
        detail: `seq ${previous.seq} is followed by ${record.seq}; records are missing or reordered.`,
      });
    }
    // Detector 2: prev_hash linkage. Catches the same drop independently, and catches a
    // substitution that preserved the numbering.
    if (previous !== undefined && record.prev_hash !== previous.record_hash) {
      failures.push({
        code: "link_broken",
        seq: record.seq,
        detail: `prev_hash does not match the record_hash of seq ${previous.seq}.`,
      });
    }
    if (record.trajectory_id !== trajectoryId) {
      failures.push({
        code: "foreign_trajectory",
        seq: record.seq,
        detail: `Record belongs to trajectory ${record.trajectory_id}, not ${trajectoryId}.`,
      });
    }

    try {
      const recomputed = sha256Canonical(recordPreimage(record));
      if (recomputed !== record.record_hash) {
        failures.push({
          code: "record_altered",
          seq: record.seq,
          detail: "The record does not hash to its stored record_hash.",
        });
      }
    } catch (error) {
      const canonical = error instanceof CanonicalJsonError ? error : undefined;
      const isNumeric = canonical !== undefined
        && (canonical.code === "float" || canonical.code === "non_finite" || canonical.code === "unsafe_integer");
      failures.push({
        code: isNumeric ? "float_in_record" : "record_altered",
        seq: record.seq,
        detail: canonical?.message ?? String(error),
      });
    }
    previous = record;
  }

  const head = previous?.record_hash ?? GENESIS_PREV_HASH;
  const leaves = records.map((record) => leafHash(record.record_hash));
  const computedRoot = merkleRoot(leaves).toString("hex");

  const seal = expect.signed_seal?.document ?? expect.seal;
  if (expect.signed_seal !== undefined
    && !verifySignedSeal(expect.signed_seal, expect.public_key_hex)) {
    failures.push({
      code: "signature_invalid",
      seq: -1,
      detail: "The seal's ed25519 signature does not verify under the supplied key.",
    });
  }
  if (seal !== undefined) {
    if (seal.trajectory_id !== trajectoryId) {
      failures.push({
        code: "foreign_trajectory",
        seq: -1,
        detail: `The seal closes trajectory ${seal.trajectory_id}, not ${trajectoryId}.`,
      });
    }
    if (seal.total_records !== records.length) {
      failures.push({
        code: "total_mismatch",
        seq: -1,
        detail: `The seal commits to ${seal.total_records} records; ${records.length} were presented.`,
      });
    }
    if (seal.merkle_root !== computedRoot) {
      failures.push({
        code: "merkle_mismatch",
        seq: -1,
        detail: "The Merkle root over the presented records differs from the sealed root.",
      });
    }
    if (seal.trace_hash !== head) {
      failures.push({
        code: "trace_hash_mismatch",
        seq: -1,
        detail: "The sealed head does not match the last presented record.",
      });
    }
  }

  const ok = failures.length === 0;
  return {
    ok,
    // A seal is the only thing that rules out tail truncation, so its absence caps the
    // result at verified_prefix no matter how clean the chain is.
    completeness: !ok ? "broken" : seal !== undefined ? "verified_complete" : "verified_prefix",
    head,
    record_count: records.length,
    merkle_root: computedRoot,
    failures,
  };
}

/** Raw 32-byte Ed25519 public key as lowercase hex, matching the Python core's encoding. */
export function publicKeyHex(key: crypto.KeyObject): string {
  const publicKey = key.type === "private" ? crypto.createPublicKey(key) : key;
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(-32).toString("hex");
}

/**
 * Signs a seal into the Python core's envelope. `signedAt` is a parameter rather than a
 * clock read so that signing is deterministic and testable, and because the field is not
 * covered by the signature anyway.
 */
export function signSeal(
  seal: TrajectorySeal,
  privateKey: crypto.KeyObject,
  signedAt: string,
): SignedTrajectorySeal {
  const message = Buffer.from(canonicalBytes(seal));
  return {
    document: seal,
    signature: crypto.sign(null, message, privateKey).toString("hex"),
    signed_at: signedAt,
    public_key_hex: publicKeyHex(privateKey),
    algorithm: "ed25519",
  };
}

export function verifySignedSeal(signed: SignedTrajectorySeal, expectedKeyHex?: string): boolean {
  const keyHex = expectedKeyHex ?? signed.public_key_hex;
  if (!/^[a-f0-9]{64}$/.test(keyHex) || !/^[a-f0-9]{128}$/.test(signed.signature)) return false;
  // Pinning the key is what distinguishes "this seal is intact" from "this seal is the
  // one the deployer signed"; without a pin an attacker re-signs a forged seal.
  if (expectedKeyHex !== undefined && signed.public_key_hex !== expectedKeyHex) return false;
  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(keyHex, "hex")]);
    const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    const message = Buffer.from(canonicalBytes(signed.document));
    return crypto.verify(null, message, publicKey, Buffer.from(signed.signature, "hex"));
  } catch {
    return false;
  }
}

/**
 * The exact bytes both languages sign: Python's
 * `json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")`.
 * Routed through the shared canonicaliser so the seal obeys the same no-float and
 * UTF-8-key-order rules as every record.
 */
export function canonicalBytes(document: TrajectorySeal): Uint8Array {
  return new TextEncoder().encode(canonicalJson(document));
}
