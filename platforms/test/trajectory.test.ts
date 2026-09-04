import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canonicalJson, sha256Canonical } from "../src/canonical.js";
import {
  GENESIS_PREV_HASH,
  TrajectoryLog,
  canonicalBytes,
  publicKeyHex,
  replay,
  signSeal,
  verifyInclusionProof,
  verifySignedSeal,
  type ReplayFailureCode,
  type TrajectoryEntry,
  type TrajectoryRecord,
} from "../src/trajectory.js";

function entry(index: number, overrides: Partial<TrajectoryEntry> = {}): TrajectoryEntry {
  return {
    checkpoint: { id: `step-${index}`, type: "tool_call", actor: "agent-a", target: "db.write" },
    verdict: index % 3 === 0 ? "trust" : "caution",
    action: index % 3 === 0 ? "allow" : "record",
    released: index % 3 === 0,
    constitution_version: "policy-2026-09",
    inputs_hash: crypto.createHash("sha256").update(`input-${index}`).digest("hex"),
    generated_at: `2026-09-03T22:0${index % 10}:00.000Z`,
    ...overrides,
  };
}

function buildChain(size: number, id = "run-alpha"): { log: TrajectoryLog; records: TrajectoryRecord[] } {
  const log = new TrajectoryLog(id);
  const records = Array.from({ length: size }, (_unused, index) => log.append(entry(index)));
  return { log, records };
}

function codes(failures: Array<{ code: ReplayFailureCode }>): ReplayFailureCode[] {
  return failures.map((failure) => failure.code);
}

test("a valid chain replays", () => {
  const { records } = buildChain(8);
  const result = replay(records);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.record_count, 8);
  assert.equal(result.head, records[7]?.record_hash);
  assert.equal(records[0]?.prev_hash, GENESIS_PREV_HASH);
  assert.match(result.head, /^[a-f0-9]{64}$/);
});

test("each record's hash is the canonical digest of the record minus its own hash", () => {
  const { records } = buildChain(3);
  for (const record of records) {
    const { record_hash: stored, ...preimage } = record;
    assert.equal(stored, sha256Canonical(preimage));
  }
});

test("a closed chain replays as verified_complete", () => {
  const { log, records } = buildChain(6);
  const seal = log.close();
  const result = replay(records, { seal });
  assert.equal(result.ok, true);
  assert.equal(result.completeness, "verified_complete");
  assert.equal(seal.total_records, 6);
  assert.equal(seal.trace_hash, records[5]?.record_hash);
});

test("an unclosed chain is verified_prefix and never verified_complete", () => {
  // Truncating the tail of an open chain leaves a chain that is internally perfect. No
  // amount of hashing detects that, so the API must not claim completeness it cannot have.
  const { records } = buildChain(10);
  const full = replay(records);
  assert.equal(full.completeness, "verified_prefix");
  assert.notEqual(full.completeness, "verified_complete");

  const truncated = replay(records.slice(0, 7));
  assert.equal(truncated.ok, true, "a truncated open chain is genuinely indistinguishable");
  assert.equal(truncated.completeness, "verified_prefix");
  assert.notEqual(truncated.completeness, "verified_complete");
  assert.equal(truncated.record_count, 7);
});

test("truncating a closed chain is caught, because the seal commits to the count", () => {
  const { log, records } = buildChain(10);
  const seal = log.close();
  const result = replay(records.slice(0, 7), { seal });
  assert.equal(result.ok, false);
  assert.equal(result.completeness, "broken");
  assert.ok(codes(result.failures).includes("total_mismatch"));
  assert.ok(codes(result.failures).includes("merkle_mismatch"));
  assert.ok(codes(result.failures).includes("trace_hash_mismatch"));
});

test("altering any field breaks the chain at the right seq", () => {
  const fields: Array<keyof TrajectoryEntry | "inputs_hash"> = [
    "verdict", "action", "released", "constitution_version", "inputs_hash", "generated_at",
  ];
  for (const field of fields) {
    const { records } = buildChain(6);
    const target = records[3];
    assert.ok(target);
    const tampered: TrajectoryRecord[] = records.map((record, index) => index !== 3
      ? record
      : { ...record, [field]: field === "released" ? !record.released : "tampered" } as TrajectoryRecord);

    const result = replay(tampered);
    assert.equal(result.ok, false, `altering ${field} went undetected`);
    const altered = result.failures.filter((failure) => failure.code === "record_altered");
    assert.equal(altered.length, 1, `altering ${field} produced ${altered.length} findings`);
    assert.equal(altered[0]?.seq, 3, `altering ${field} was blamed on the wrong record`);
  }
});

test("altering the checkpoint is caught too, so routing metadata is tamper-evident", () => {
  const { records } = buildChain(4);
  const target = records[2];
  assert.ok(target);
  const tampered = records.map((record, index) => index !== 2
    ? record
    : { ...record, checkpoint: { ...record.checkpoint, target: "prod.delete" } });
  const result = replay(tampered);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result.failures), ["record_altered"]);
  assert.equal(result.failures[0]?.seq, 2);
});

test("re-hashing an altered record just moves the break to the next link", () => {
  // The interesting case: an attacker who recomputes record_hash defeats detector 2 on
  // that record, and immediately fails detector 1's successor link.
  const { records } = buildChain(5);
  const target = records[2];
  assert.ok(target);
  const { record_hash: _old, ...preimage } = target;
  const forged = { ...preimage, verdict: "trust" as const };
  const tampered = records.map((record, index) => index !== 2
    ? record
    : { ...forged, record_hash: sha256Canonical(forged) });

  const result = replay(tampered);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result.failures), ["link_broken"]);
  assert.equal(result.failures[0]?.seq, 3, "the break should surface at the successor");
});

test("dropping a middle record is caught by both detectors independently", () => {
  const { records } = buildChain(7);
  const dropped = [...records.slice(0, 3), ...records.slice(4)];
  const result = replay(dropped);
  assert.equal(result.ok, false);

  const found = codes(result.failures);
  assert.ok(found.includes("seq_gap"), "the seq detector missed the drop");
  assert.ok(found.includes("link_broken"), "the linkage detector missed the drop");
  assert.equal(result.failures.find((failure) => failure.code === "seq_gap")?.seq, 4);
  assert.equal(result.failures.find((failure) => failure.code === "link_broken")?.seq, 4);
});

test("renumbering to close the seq gap does not hide the drop", () => {
  // seq is inside the preimage, so rewriting it invalidates every record it touches.
  const { records } = buildChain(6);
  const dropped = [...records.slice(0, 2), ...records.slice(3)]
    .map((record, index) => ({ ...record, seq: index }));
  const result = replay(dropped);
  assert.equal(result.ok, false);
  assert.ok(codes(result.failures).includes("record_altered"));
});

test("reordering is caught", () => {
  const { records } = buildChain(6);
  const swapped = [...records];
  const third = swapped[2];
  const fourth = swapped[3];
  assert.ok(third && fourth);
  swapped[2] = fourth;
  swapped[3] = third;

  const result = replay(swapped);
  assert.equal(result.ok, false);
  const found = codes(result.failures);
  assert.ok(found.includes("seq_gap"), "reordering left the seq sequence looking contiguous");
  assert.ok(found.includes("link_broken"), "reordering left the linkage intact");
});

test("inserting a record from another trajectory is caught", () => {
  const { records } = buildChain(5, "run-alpha");
  const other = buildChain(5, "run-beta").records[2];
  assert.ok(other);
  const spliced = [...records.slice(0, 3), other, ...records.slice(3)];
  const result = replay(spliced);
  assert.equal(result.ok, false);
  assert.ok(codes(result.failures).includes("foreign_trajectory"));
  assert.ok(codes(result.failures).includes("link_broken"));
});

test("a chain that does not start at the genesis record is not a complete chain", () => {
  const { records } = buildChain(5);
  const result = replay(records.slice(2));
  assert.equal(result.ok, false);
  const found = codes(result.failures);
  assert.ok(found.includes("seq_not_zero_based"));
  assert.ok(found.includes("genesis_prev_hash"));
});

test("an empty chain is broken, not vacuously verified", () => {
  const result = replay([]);
  assert.equal(result.ok, false);
  assert.equal(result.completeness, "broken");
  assert.deepEqual(codes(result.failures), ["empty_chain"]);
});

test("replay reports every failure rather than stopping at the first", () => {
  const { records } = buildChain(8);
  const mangled = [...records.slice(0, 2), ...records.slice(4)];
  const result = replay(mangled);
  assert.ok(result.failures.length >= 2, "a reviewer needs the whole picture, not the first line");
});

test("a float smuggled into a record is reported as such, not as a generic alteration", () => {
  const { records } = buildChain(3);
  const target = records[1];
  assert.ok(target);
  const withFloat = records.map((record, index) => index !== 1
    ? record
    : { ...record, ecs_total: 0.8462 } as unknown as TrajectoryRecord);
  const result = replay(withFloat);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result.failures), ["float_in_record"]);
  assert.equal(result.failures[0]?.seq, 1);
});

test("generated_at is hashed but never used for ordering", () => {
  const { records } = buildChain(6);
  // Same timestamp everywhere, and timestamps running backwards: neither changes the
  // verdict, because seq and prev_hash are the only ordering signals.
  const constant = records.map((record) => ({ ...record, generated_at: "2026-01-01T00:00:00.000Z" }));
  const reversed = records.map((record) => ({
    ...record,
    generated_at: `2026-09-03T22:0${9 - record.seq}:00.000Z`,
  }));
  // The timestamps are inside the preimage, so rewriting them is detected as alteration...
  for (const rewritten of [constant, reversed]) {
    const result = replay(rewritten);
    assert.equal(result.failures.length, 6, "rewriting a timestamp went undetected");
    assert.equal(result.failures.every((failure) => failure.code === "record_altered"), true);
  }

  // ...but a chain *built* with out-of-order timestamps replays perfectly.
  const log = new TrajectoryLog("run-clockless");
  const built = [0, 1, 2, 3].map((index) =>
    log.append(entry(index, { generated_at: `2026-09-03T22:0${9 - index}:00.000Z` })));
  assert.equal(replay(built).ok, true);
});

test("inclusion proofs verify for every record, at every tree size", () => {
  for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17]) {
    const { log } = buildChain(size);
    const seal = log.close();
    for (let seq = 0; seq < size; seq += 1) {
      const proof = log.inclusionProof(seq);
      assert.equal(proof.tree_size, size);
      assert.equal(proof.merkle_root, seal.merkle_root);
      assert.equal(verifyInclusionProof(proof), true, `proof failed at size ${size} seq ${seq}`);
      assert.equal(verifyInclusionProof(proof, seal.merkle_root), true);
      // O(log n): a 17-record trajectory proves membership with at most 5 siblings.
      assert.ok(proof.path.length <= Math.ceil(Math.log2(size)) + 1);
    }
  }
});

test("an inclusion proof reveals nothing but one record hash", () => {
  const { log, records } = buildChain(8);
  log.close();
  const proof = log.inclusionProof(3);
  const serialized = canonicalJson(proof);
  for (const record of records) {
    if (record.seq === 3) continue;
    assert.equal(serialized.includes(record.record_hash), false, "another record leaked");
    assert.equal(serialized.includes(record.inputs_hash), false, "an inputs_hash leaked");
  }
  assert.equal(serialized.includes("db.write"), false, "checkpoint metadata leaked");
});

test("forged inclusion proofs fail", () => {
  const { log } = buildChain(9);
  const seal = log.close();
  const proof = log.inclusionProof(4);
  const sibling = proof.path[0];
  assert.ok(sibling);

  const substituted = { ...proof, record_hash: "f".repeat(64) };
  assert.equal(verifyInclusionProof(substituted, seal.merkle_root), false, "a foreign leaf verified");

  const bentPath = { ...proof, path: [`${"0".repeat(63)}1`, ...proof.path.slice(1)] };
  assert.equal(verifyInclusionProof(bentPath, seal.merkle_root), false, "a bent path verified");

  const shortPath = { ...proof, path: proof.path.slice(1) };
  assert.equal(verifyInclusionProof(shortPath, seal.merkle_root), false, "a short path verified");

  const movedIndex = { ...proof, leaf_index: 5 };
  assert.equal(verifyInclusionProof(movedIndex, seal.merkle_root), false, "a moved leaf verified");

  const outOfRange = { ...proof, leaf_index: 99 };
  assert.equal(verifyInclusionProof(outOfRange, seal.merkle_root), false);

  // A proof that is internally consistent but claims the wrong tree must not verify
  // against the real root.
  const otherRoot = buildChain(9, "run-beta");
  const otherSeal = otherRoot.log.close();
  assert.equal(verifyInclusionProof(proof, otherSeal.merkle_root), false, "verified against a foreign root");

  // Restating the root inside the proof does not make it true.
  const relabelled = { ...proof, merkle_root: otherSeal.merkle_root };
  assert.equal(verifyInclusionProof(relabelled), false, "a relabelled root verified");
});

test("leaf and interior hashes are domain-separated (RFC 6962)", () => {
  const { log, records } = buildChain(2);
  const seal = log.close();
  const first = records[0]?.record_hash;
  const second = records[1]?.record_hash;
  assert.ok(first && second);

  const leaf = (hash: string): Buffer => crypto.createHash("sha256")
    .update(Buffer.from([0x00])).update(Buffer.from(hash, "hex")).digest();
  const expected = crypto.createHash("sha256")
    .update(Buffer.from([0x01])).update(leaf(first)).update(leaf(second)).digest("hex");
  assert.equal(seal.merkle_root, expected);

  // Without the prefixes a leaf and an interior node over the same bytes would collide,
  // which is the second-preimage attack the prefixes exist to prevent.
  const undifferentiated = crypto.createHash("sha256")
    .update(Buffer.from(first, "hex")).update(Buffer.from(second, "hex")).digest("hex");
  assert.notEqual(seal.merkle_root, undifferentiated);
});

test("signing a closed root round-trips", () => {
  const { log } = buildChain(5);
  const seal = log.close();
  const keys = crypto.generateKeyPairSync("ed25519");
  const signed = signSeal(seal, keys.privateKey, "2026-09-03T23:00:00.000Z");

  assert.equal(signed.algorithm, "ed25519");
  assert.match(signed.signature, /^[a-f0-9]{128}$/);
  assert.equal(signed.public_key_hex, publicKeyHex(keys.publicKey));
  assert.match(signed.public_key_hex, /^[a-f0-9]{64}$/);
  assert.equal(verifySignedSeal(signed), true);
  assert.equal(verifySignedSeal(signed, signed.public_key_hex), true);
});

test("a signature does not survive a tampered document or a different key", () => {
  const { log } = buildChain(5);
  const seal = log.close();
  const keys = crypto.generateKeyPairSync("ed25519");
  const other = crypto.generateKeyPairSync("ed25519");
  const signed = signSeal(seal, keys.privateKey, "2026-09-03T23:00:00.000Z");

  assert.equal(
    verifySignedSeal({ ...signed, document: { ...seal, total_records: 4 } }),
    false,
    "a shortened count kept its signature",
  );
  assert.equal(
    verifySignedSeal({ ...signed, document: { ...seal, trace_hash: "0".repeat(64) } }),
    false,
  );
  assert.equal(verifySignedSeal(signed, publicKeyHex(other.publicKey)), false, "verified under a foreign key");

  // Re-signing a forged seal with an attacker's key is only caught by pinning the signer.
  const forged = signSeal({ ...seal, total_records: 4 }, other.privateKey, "2026-09-03T23:00:00.000Z");
  assert.equal(verifySignedSeal(forged), true, "the forged seal is internally consistent");
  assert.equal(verifySignedSeal(forged, signed.public_key_hex), false, "pinning the key catches it");
});

test("replay checks a signed seal against a pinned key", () => {
  const { log, records } = buildChain(6);
  const seal = log.close();
  const keys = crypto.generateKeyPairSync("ed25519");
  const attacker = crypto.generateKeyPairSync("ed25519");
  const signed = signSeal(seal, keys.privateKey, "2026-09-03T23:00:00.000Z");
  const pin = publicKeyHex(keys.publicKey);

  const good = replay(records, { signed_seal: signed, public_key_hex: pin });
  assert.equal(good.ok, true);
  assert.equal(good.completeness, "verified_complete");

  const reSigned = signSeal(seal, attacker.privateKey, "2026-09-03T23:00:00.000Z");
  const bad = replay(records, { signed_seal: reSigned, public_key_hex: pin });
  assert.equal(bad.ok, false);
  assert.deepEqual(codes(bad.failures), ["signature_invalid"]);
});

test("the signed document is shaped for the Python core's verifier", () => {
  // WitnessVerifier.verify() reads document["trace_hash"] and verifies the ed25519
  // signature over json.dumps(document, sort_keys=True, separators=(",", ":")). Naming the
  // head field trace_hash is what lets the unmodified Python verifier validate this.
  const { log } = buildChain(4);
  const seal = log.close();
  const keys = crypto.generateKeyPairSync("ed25519");
  const signed = signSeal(seal, keys.privateKey, "2026-09-03T23:00:00.000Z");

  assert.deepEqual(Object.keys(signed).sort(),
    ["algorithm", "document", "public_key_hex", "signature", "signed_at"]);
  assert.equal(typeof signed.document.trace_hash, "string");
  for (const key of Object.keys(signed.document)) {
    assert.match(key, /^[a-z0-9_]+$/, `key ${key} could make the two sort orders diverge`);
  }
  for (const value of Object.values(signed.document)) {
    if (typeof value === "number") assert.ok(Number.isInteger(value), "a float would not survive Python");
  }
  assert.equal(
    Buffer.from(canonicalBytes(seal)).toString("utf8"),
    canonicalJson(seal),
    "the signed bytes are the canonical form",
  );
});

test("a sealed trajectory rejects further appends", () => {
  const { log } = buildChain(3);
  log.close();
  assert.throws(() => log.append(entry(3)), /closed/);
});

test("resume continues a chain from its record hashes alone", () => {
  const { records } = buildChain(4, "run-stateless");
  const resumed = TrajectoryLog.resume("run-stateless", records.map((record) => record.record_hash));
  assert.equal(resumed.head, records[3]?.record_hash);
  assert.equal(resumed.length, 4);

  const next = resumed.append(entry(4));
  assert.equal(next.seq, 4);
  assert.equal(next.prev_hash, records[3]?.record_hash);

  const whole = [...records, next];
  const seal = resumed.close();
  const result = replay(whole, { seal });
  assert.equal(result.ok, true);
  assert.equal(result.completeness, "verified_complete");
  assert.equal(seal.total_records, 5);
});

test("the chain carries no submitted content", () => {
  const log = new TrajectoryLog("run-privacy");
  const record = log.append(entry(0));
  const serialized = canonicalJson(record);
  assert.equal(serialized.includes("sk-live"), false);
  assert.deepEqual(Object.keys(record).sort(), [
    "action", "checkpoint", "constitution_version", "generated_at", "inputs_hash",
    "prev_hash", "record_hash", "released", "seq", "trajectory_id", "verdict",
  ]);
});

test("appending the same entries twice produces the same chain", () => {
  const first = buildChain(5, "run-determinism").records;
  const second = buildChain(5, "run-determinism").records;
  assert.deepEqual(first, second);
});
