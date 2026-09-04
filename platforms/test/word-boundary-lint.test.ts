import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `\b` asserts a transition between a word character and a non-word character. Writing it
 * next to a *literal* non-word character therefore does not mean "end of token" — it
 * silently requires a word character on the far side, which is usually the opposite of
 * what was intended.
 *
 * Three separate defects of exactly this shape shipped in this codebase:
 *   `100\s*%` inside `\b(?:…)\b`  — could never match, because % is not a word character
 *   `rm -rf (?:/|~|\$HOME)\b`     — matched "rm -rf /home", missed "rm -rf /"
 *   `\d+(?:\.\d+)?\s*%\b`         — matched "87.4%," missed "87.4% of cases"
 *
 * Each was found by hand, months apart. This lint makes the class unrepeatable.
 */

const WORDY = /[A-Za-z0-9_]/;
/** Characters that belong to group syntax rather than being a literal neighbour. */
const STRUCTURAL = new Set("()|[]{}?*+^$`".split(""));

function isStructural(pattern: string, index: number): boolean {
  const ch = pattern[index]!;
  if (STRUCTURAL.has(ch)) return true;
  if (ch === ":" && pattern.slice(index - 2, index) === "(?") return true;
  if ((ch === "!" || ch === "=") && ["(?", "<!", "<="].includes(pattern.slice(index - 2, index))) return true;
  if ((ch === "!" || ch === "=") && pattern.slice(index - 3, index) === "(?<") return true;
  if (ch === "<" && pattern.slice(index - 2, index) === "(?") return true;
  return false;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

test("no regex anchors \\b against a literal non-word character", () => {
  const offences: string[] = [];
  for (const file of sourceFiles("src")) {
    const text = stripComments(readFileSync(file, "utf8"));
    const literals = text.matchAll(/\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[gimsuyv]*/g);
    for (const literal of literals) {
      const pattern = literal[1]!;
      const line = text.slice(0, literal.index).split("\n").length;
      for (const boundary of pattern.matchAll(/(?<!\\)\\b/g)) {
        const at = boundary.index!;
        for (const neighbour of [at - 1, at + 2]) {
          if (neighbour < 0 || neighbour >= pattern.length) continue;
          const ch = pattern[neighbour]!;
          if (WORDY.test(ch) || ch === "\\" || isStructural(pattern, neighbour)) continue;
          offences.push(`${file}:${line} — \\b next to literal ${JSON.stringify(ch)} in …${pattern.slice(Math.max(0, at - 22), at + 22)}…`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(offences)], [],
    "a word boundary beside a literal non-word character can only be satisfied from the far side");
});
