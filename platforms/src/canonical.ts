import crypto from "node:crypto";

/**
 * Canonical JSON — `sha256_canonical_json_v1`.
 *
 * A hash chain is only tamper-evident if two honest parties hashing the same record get
 * the same digest. The Python core hashes with
 * `json.dumps(payload, sort_keys=True, separators=(",", ":"))`
 * (`core/src/glassbox/witness/signing.py`), so a TypeScript record must reproduce those
 * bytes exactly or a chain signed on one side cannot be verified on the other.
 *
 * Three places where the straightforward implementation silently produces *different*
 * bytes, all confirmed by running both runtimes rather than by reading specs:
 *
 *   1. Key order. Python's `sort_keys=True` sorts by Unicode code point; JavaScript's
 *      `Array.prototype.sort()` sorts by UTF-16 code unit. They disagree above the BMP:
 *      given the keys U+FFFD and U+10000, Python yields [U+FFFD, U+10000] and JS yields
 *      [U+10000, U+FFFD], because U+10000's leading surrogate D800 sorts below FFFD.
 *      Sorting by UTF-8 bytes is order-isomorphic to code-point order, so it reproduces
 *      Python on every input. That is why `compareUtf8` exists rather than a bare sort.
 *
 *   2. Numbers. Python prints the float 1.0 as `1.0` and the int 1 as `1`. TypeScript has
 *      one number type and prints both as `1`. There is no way to recover the
 *      distinction, so the rule is not "format floats carefully" but "no floats at all":
 *      a non-integer number throws. Fractions belong in a record as fixed-precision
 *      decimal strings (see `decimalString`), which are just strings to both runtimes.
 *      Coercing silently would leave a chain that verifies in Node and fails in Python
 *      with no visible cause, so failing loudly here is the whole point.
 *
 *   3. ASCII escaping. Python's `ensure_ascii=True` escapes everything outside
 *      0x20..0x7E — which includes U+007F DEL, a character `JSON.stringify` emits raw.
 *      The escape range therefore starts at 0x7F, not 0x80. With that one adjustment the
 *      two runtimes agree byte for byte, surrogate pairs and lowercase hex included.
 *
 * Unicode normalisation is deliberately *not* performed here. NFC and NFD forms of the
 * same text are different byte strings and must hash differently, or the digest would
 * stop identifying the record that was actually stored. Producers normalise to NFC at
 * construction time; the canonicaliser only reports what it was given.
 *
 * This is a separate function from `inputsHash` in `src/lite.ts`, and must stay separate:
 * that hash is already deterministic for its fixed shape and every digest published
 * against it would change if it were repointed here.
 */

export type CanonicalErrorCode =
  | "float"
  | "non_finite"
  | "unsafe_integer"
  | "undefined_value"
  | "unsupported_type"
  | "cycle"
  | "depth";

/** Carries a `code` so callers can distinguish a Rule-N violation from a malformed value. */
export class CanonicalJsonError extends Error {
  readonly code: CanonicalErrorCode;

  constructor(code: CanonicalErrorCode, message: string) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
  }
}

/** Bounded so a hostile or accidentally recursive structure cannot exhaust the stack. */
const MAX_DEPTH = 64;

/**
 * Python escapes every code point outside 0x20..0x7E. `JSON.stringify` has already
 * handled 0x00..0x1F, so the remaining gap is 0x7F upwards — note the 0x7F, DEL is the
 * character an "escape non-ASCII" reading of the rule would miss.
 */
const NEEDS_ESCAPE = /[\u007f-\uffff]/g;

function asciiEscape(json: string): string {
  return json.replace(NEEDS_ESCAPE, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Order-isomorphic to Unicode code-point order, which is what Python sorts by. Comparing
 * the JS strings directly would compare UTF-16 code units and diverge above the BMP.
 */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError("non_finite", `${path}: NaN and Infinity have no JSON form.`);
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalJsonError(
      "float",
      `${path}: ${value} is not an integer. A hashed record may contain no floating-point ` +
      `number, because Python serialises 1.0 as "1.0" and JavaScript as "1". Encode the ` +
      `fraction as a fixed-precision decimal string instead (decimalString()).`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(
      "unsafe_integer",
      `${path}: ${value} is outside the safe-integer range, so its value is not preserved.`,
    );
  }
  // -0 and 0 are the same JSON number; Python prints both as `0`.
  return String(value === 0 ? 0 : value);
}

function serialize(value: unknown, path: string, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalJsonError("depth", `${path}: nesting exceeds ${MAX_DEPTH} levels.`);
  }
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return asciiEscape(JSON.stringify(value));
    case "number":
      return serializeNumber(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      // Omitted inside objects (handled below); anywhere else it would become `null` and
      // change the digest, so it is rejected rather than quietly rewritten.
      throw new CanonicalJsonError("undefined_value", `${path}: undefined has no JSON form.`);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(
        "unsupported_type",
        `${path}: values of type ${typeof value} cannot appear in a hashed record.`,
      );
  }

  const container = value as object;
  if (seen.has(container)) {
    throw new CanonicalJsonError("cycle", `${path}: the value contains a reference cycle.`);
  }
  seen.add(container);
  try {
    if (Array.isArray(container)) {
      // Array order is semantic and is preserved exactly. Indexed rather than mapped
      // because `Array.prototype.map` skips holes in a sparse array, which would leave
      // them out of the output entirely instead of rejecting them.
      const items: string[] = [];
      for (let index = 0; index < container.length; index += 1) {
        items.push(serialize(container[index], `${path}[${index}]`, depth + 1, seen));
      }
      return `[${items.join(",")}]`;
    }
    if (!isPlainObject(container)) {
      throw new CanonicalJsonError(
        "unsupported_type",
        `${path}: only plain objects and arrays are hashable; got ${container.constructor?.name ?? "an exotic object"}. ` +
        `Class instances, Date, Map and Set have no single agreed JSON form across languages.`,
      );
    }

    const record = container as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareUtf8);
    const fields = keys.map((key) => {
      const serializedKey = asciiEscape(JSON.stringify(key));
      return `${serializedKey}:${serialize(record[key], `${path}.${key}`, depth + 1, seen)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    seen.delete(container);
  }
}

/**
 * Byte-identical to Python's `json.dumps(value, sort_keys=True, separators=(",", ":"))`.
 * Throws rather than coerces: every rejection here is a case that would otherwise produce
 * a digest that disagrees with the other runtime.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$", 0, new Set());
}

/** Lowercase hex SHA-256 over the UTF-8 (here: pure ASCII) bytes of the canonical form. */
export function sha256Canonical(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * The sanctioned way to put a fraction in a hashed record: a fixed-precision decimal
 * string, which both runtimes serialise identically because it is not a number at all.
 * Four places matches `round()` in `src/lite.ts`, which is what the scores are already
 * rounded to.
 */
export function decimalString(value: number, places = 4): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError("non_finite", `Cannot encode ${value} as a decimal string.`);
  }
  // Scaled with the same `Math.round(v * 10_000)` as `round()` in `src/lite.ts`, so a
  // score rounded there and a score encoded here never disagree in the last digit. The
  // digits are then laid out from the integer directly rather than via `toFixed`, so no
  // float is ever printed and there is no second rounding step to disagree about.
  const scale = 10 ** places;
  const scaled = Math.round(value * scale);
  if (!Number.isSafeInteger(scaled)) {
    throw new CanonicalJsonError(
      "unsafe_integer",
      `${value} is too large to encode at ${places} decimal places without losing precision.`,
    );
  }
  const sign = scaled < 0 ? "-" : "";
  const digits = String(Math.abs(scaled)).padStart(places + 1, "0");
  const split = digits.length - places;
  return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
}
