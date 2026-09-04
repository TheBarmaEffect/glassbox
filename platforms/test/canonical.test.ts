import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  CanonicalJsonError,
  canonicalJson,
  decimalString,
  sha256Canonical,
} from "../src/canonical.js";

/**
 * Written as code points rather than literals so the two characters that make the
 * Python/JavaScript sort orders disagree are unambiguous in the source: U+FFFD sits below
 * U+10000 by code point (Python) but above it by UTF-16 code unit (JavaScript), because
 * U+10000's leading surrogate is D800.
 */
const REPLACEMENT = String.fromCodePoint(0xfffd);
const LINEAR_B_A = String.fromCodePoint(0x10000);
const DEL = String.fromCharCode(0x7f);

test("canonical JSON is stable across key insertion order", () => {
  const inserted = { zulu: 1, alpha: 2, mike: 3 };
  const reversed = { mike: 3, alpha: 2, zulu: 1 };
  assert.equal(canonicalJson(inserted), '{"alpha":2,"mike":3,"zulu":1}');
  assert.equal(canonicalJson(inserted), canonicalJson(reversed));
  assert.equal(sha256Canonical(inserted), sha256Canonical(reversed));
});

test("keys sort by UTF-8 bytes, not UTF-16 code units", () => {
  // The naive JavaScript sort puts U+10000 first and would produce a digest Python can
  // never reproduce. UTF-8 byte order is order-isomorphic to code-point order, so it
  // agrees with Python's sort_keys=True on every input.
  const naive = [REPLACEMENT, LINEAR_B_A].sort();
  assert.deepEqual(naive, [LINEAR_B_A, REPLACEMENT], "the divergent case is no longer divergent");

  const canonical = canonicalJson({ [LINEAR_B_A]: 2, [REPLACEMENT]: 1 });
  assert.equal(canonical, '{"\\ufffd":1,"\\ud800\\udc00":2}');
  // Python: json.dumps({"�": 1, "\U00010000": 2}, sort_keys=True, separators=(",", ":"))
  // produces exactly this string, U+FFFD first.
  assert.ok(canonical.indexOf("\\ufffd") < canonical.indexOf("\\ud800"));
});

test("key order is stable regardless of which astral key was inserted first", () => {
  assert.equal(
    canonicalJson({ [REPLACEMENT]: 1, [LINEAR_B_A]: 2 }),
    canonicalJson({ [LINEAR_B_A]: 2, [REPLACEMENT]: 1 }),
  );
});

test("a non-integer number throws instead of being coerced", () => {
  // Python renders the float 1.0 as "1.0" and JavaScript as "1". There is no shared form,
  // so silently accepting a float would produce a record that hashes differently on the
  // two sides with no visible symptom until a signature failed.
  assert.throws(() => canonicalJson({ ecs: 1.5 }), CanonicalJsonError);
  assert.throws(() => canonicalJson({ ecs: 1.5 }), /not an integer/);
  assert.throws(() => canonicalJson([0.1]), /not an integer/);
  assert.throws(() => canonicalJson(0.8462), /not an integer/);

  try {
    canonicalJson({ ecs: 1.5 });
    assert.fail("1.5 was accepted");
  } catch (error) {
    assert.equal((error as CanonicalJsonError).code, "float");
  }
});

test("a float that happens to be integral is fine, because both languages print it the same", () => {
  // 1.0 in TypeScript *is* the integer 1; the divergence only exists when Python holds a
  // float, which it cannot if the JSON it parsed said `1`.
  assert.equal(canonicalJson({ n: 1.0 }), '{"n":1}');
  assert.equal(canonicalJson({ n: -0 }), '{"n":0}', "negative zero must not be a distinct value");
});

test("NaN, Infinity and unsafe integers are rejected", () => {
  assert.throws(() => canonicalJson({ n: Number.NaN }), /NaN and Infinity/);
  assert.throws(() => canonicalJson({ n: Number.POSITIVE_INFINITY }), /NaN and Infinity/);
  assert.throws(() => canonicalJson({ n: 2 ** 53 }), /safe-integer/);
  assert.equal(canonicalJson({ n: Number.MAX_SAFE_INTEGER }), '{"n":9007199254740991}');
});

test("fractions are carried as fixed-precision decimal strings", () => {
  assert.equal(decimalString(0.8462), "0.8462");
  assert.equal(decimalString(1), "1.0000");
  assert.equal(decimalString(0), "0.0000");
  assert.equal(decimalString(-0), "0.0000", "negative zero must not hash differently from zero");
  assert.equal(decimalString(-0.5), "-0.5000");
  assert.equal(decimalString(0.000_04), "0.0000", "rounding never emits a sign for zero");
  assert.equal(canonicalJson({ ecs_total: decimalString(0.8462) }), '{"ecs_total":"0.8462"}');
});

test("decimal encoding agrees with round() in src/lite.ts", () => {
  // Both scale by 10_000 and round once, so a score already rounded by the verifier and
  // the same score encoded for the chain cannot disagree in the last digit.
  const round = (value: number): number => Math.round(value * 10_000) / 10_000;
  for (const value of [0, 1, 0.5, 0.84615, 0.123_456_789, 0.999_95, 0.333_333_3]) {
    assert.equal(decimalString(value), round(value).toFixed(4), `mismatch at ${value}`);
  }
});

test("every code point outside 0x20..0x7e is escaped, exactly as Python does it", () => {
  // Including DEL: Python's ensure_ascii escapes it and JSON.stringify does not, which is
  // the one case an "escape non-ASCII" reading of the rule misses.
  assert.equal(canonicalJson({ a: `x${DEL}y` }), '{"a":"x\\u007fy"}');
  assert.equal(canonicalJson({ a: "café" }), '{"a":"caf\\u00e9"}');
  assert.equal(canonicalJson({ a: String.fromCodePoint(0x1f600) }), '{"a":"\\ud83d\\ude00"}');
  assert.equal(canonicalJson({ a: LINEAR_B_A }), '{"a":"\\ud800\\udc00"}');
  assert.match(canonicalJson({ a: "café" }), /^[\x20-\x7e]+$/, "output must be pure ASCII");
  assert.equal(canonicalJson({ a: "\t\n" }), '{"a":"\\t\\n"}', "short escapes match Python's");
});

test("separators carry no whitespace", () => {
  assert.equal(canonicalJson({ a: 1, b: [1, 2], c: { d: true } }), '{"a":1,"b":[1,2],"c":{"d":true}}');
});

test("undefined is omitted from objects and rejected everywhere else", () => {
  // An omitted optional field and an absent one must hash identically; but JSON.stringify
  // turns an undefined array element into null, which would silently change the digest.
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(sha256Canonical({ a: 1, b: undefined }), sha256Canonical({ a: 1 }));
  assert.throws(() => canonicalJson([1, undefined]), /undefined has no JSON form/);
  assert.throws(() => canonicalJson(new Array<number>(2)), /undefined has no JSON form/);
});

test("null is preserved and is distinct from an omitted field", () => {
  assert.equal(canonicalJson({ a: null }), '{"a":null}');
  assert.notEqual(sha256Canonical({ a: null }), sha256Canonical({}));
});

test("array order is semantic and is never sorted", () => {
  assert.equal(canonicalJson(["b", "a"]), '["b","a"]');
  assert.notEqual(sha256Canonical(["b", "a"]), sha256Canonical(["a", "b"]));
});

test("values with no agreed cross-language JSON form are rejected", () => {
  assert.throws(() => canonicalJson({ at: new Date(0) }), /only plain objects and arrays/);
  assert.throws(() => canonicalJson({ m: new Map() }), /only plain objects and arrays/);
  assert.throws(() => canonicalJson({ f: () => 1 }), /type function/);
  assert.throws(() => canonicalJson({ n: 1n }), /type bigint/);
});

test("a reference cycle fails loudly rather than hanging", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /reference cycle/);
});

test("the digest is sha256 over the UTF-8 bytes of the canonical form", () => {
  const value = { b: "two", a: 1 };
  const expected = crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  assert.equal(sha256Canonical(value), expected);
  assert.match(sha256Canonical(value), /^[a-f0-9]{64}$/);
});

test("nested objects are sorted at every level", () => {
  assert.equal(
    canonicalJson({ outer: { z: { y: 1, a: 2 }, a: [{ b: 1, a: 2 }] } }),
    '{"outer":{"a":[{"a":2,"b":1}],"z":{"a":2,"y":1}}}',
  );
});
