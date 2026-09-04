#!/usr/bin/env node
/**
 * Guard the `node:test` summary, not just the exit code.
 *
 * Why this exists: a test file can be *cancelled* rather than *failed*. When
 * `platform-guards.test.ts` raced an unref'd deadline timer against a promise with no
 * ref'd handle of its own, the event loop drained, the deadline never fired, and Node
 * reported:
 *
 *     fail 0
 *     cancelled 3
 *
 * The line a human reads in the CI log said `fail 0`. Nothing in the summary said the
 * suite had not actually run, so the red build looked like infrastructure noise and the
 * real signal was hunted for hours. That specific test is fixed; this guards the class.
 *
 * The coupling between the exit code and the counters is also not stable across Node
 * versions. The same never-settling-promise construction that produced `cancelled 3` on
 * CI's Node 20 hangs indefinitely on Node 26, and a milder variant of it exits 0. So the
 * counters are checked directly rather than inferred from the exit status, and the
 * runner's own exit code is checked as well when it is supplied.
 *
 * Failure conditions, all loud:
 *   - no summary block at all      the runner died before reporting
 *   - cancelled > 0                the class above
 *   - fail > 0                     ordinary failures, restated so there is one verdict line
 *   - pass < --min-pass            a glob that matched nothing still prints an all-green
 *                                  summary, which is the quietest way for a suite to stop
 *                                  testing anything
 *   - --runner-exit non-zero       the runner disagreed with its own summary; never let a
 *                                  clean-looking summary paper that over
 *
 * Usage:
 *   node scripts/check-test-summary.mjs <log-file> [--min-pass=N] [--runner-exit=N]
 *   node scripts/check-test-summary.mjs --selftest
 */

import { readFileSync } from "node:fs";

const KEYS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/**
 * Node's spec reporter prefixes summary lines with an info glyph, the TAP reporter with
 * `#`. Both are accepted. The line must be *only* the key and a number, which keeps a
 * test title or a `t.diagnostic()` string that happens to contain "cancelled 3" from
 * being read as the summary: a real title always carries a duration suffix such as
 * ` (0.14ms)`.
 *
 * Where a key appears more than once (a per-file summary followed by the run summary) the
 * last occurrence wins, because the run summary is printed last.
 */
export function parseSummary(text) {
  const counts = {};
  let sawAny = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI, "");
    const match = /^[^A-Za-z0-9]*(?:ℹ|#)\s+([a-z_]+)\s+(\d+(?:\.\d+)?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "duration_ms") {
      sawAny = true;
      continue;
    }
    if (!KEYS.includes(key)) continue;
    counts[key] = Number(value);
    sawAny = true;
  }
  const complete = ["tests", "pass", "fail", "cancelled"].every((key) => key in counts);
  return { counts, complete, sawAny };
}

export function verdictFor(text, { minPass = 1, runnerExit = 0 } = {}) {
  const { counts, complete } = parseSummary(text);
  const problems = [];

  if (!complete) {
    problems.push(
      "no complete node:test summary block was found in the runner output. The runner did " +
      "not reach the end of the run, so nothing here is evidence that any test passed. " +
      "Treat this as a failure, not as a reporting quirk.",
    );
    // Without counters there is nothing further to check: the counter checks below would
    // compare `undefined` and quietly pass.
    return { ok: false, counts, problems };
  }

  if (counts.cancelled > 0) {
    problems.push(
      `cancelled ${counts.cancelled}: ${counts.cancelled} test(s) were CANCELLED, not run. ` +
      "node:test reports these separately from failures, so a `fail 0` line above does not " +
      "mean the suite passed. The usual cause is a test awaiting something that never " +
      "settles while nothing holds the event loop open, such as an unref'd timer racing a " +
      "bare promise. Give the pending work a ref'd handle, or await it explicitly.",
    );
  }
  if (counts.fail > 0) {
    problems.push(`fail ${counts.fail}: ${counts.fail} test(s) failed.`);
  }
  if (counts.pass < minPass) {
    problems.push(
      `pass ${counts.pass} is below the floor of ${minPass}. A test glob that matches ` +
      "nothing, or a runner that loaded only some of the files, still prints an all-green " +
      "summary. Confirm the glob and the working directory.",
    );
  }
  if (runnerExit !== 0 && problems.length === 0) {
    problems.push(
      `the test runner exited ${runnerExit} while its own summary looked clean ` +
      `(pass ${counts.pass}, fail ${counts.fail}, cancelled ${counts.cancelled}). ` +
      "Something failed outside the reported tests: an uncaught exception after the run, a " +
      "failed import, or a non-zero exit from the loader. Read the full log.",
    );
  } else if (runnerExit !== 0) {
    problems.push(`the test runner also exited ${runnerExit}.`);
  }

  return { ok: problems.length === 0, counts, problems };
}

// --- self-test -------------------------------------------------------------------------
// This guard is the thing standing between a cancelled suite and a green deploy, so its
// parser is checked against recorded output shapes rather than trusted. CI runs it.

const FIXTURES = [
  {
    name: "the real Node 26 summary from this repo's suite",
    lines: [
      "✔ the chain carries no submitted content (0.049709ms)",
      "ℹ tests 285",
      "ℹ suites 0",
      "ℹ pass 285",
      "ℹ fail 0",
      "ℹ cancelled 0",
      "ℹ skipped 0",
      "ℹ todo 0",
      "ℹ duration_ms 3277.983041",
    ],
    options: { minPass: 100 },
    expectOk: true,
  },
  {
    name: "today's failure: fail 0 but cancelled 3",
    lines: [
      "ℹ tests 3",
      "ℹ suites 0",
      "ℹ pass 0",
      "ℹ fail 0",
      "ℹ cancelled 3",
      "ℹ skipped 0",
      "ℹ todo 0",
      "ℹ duration_ms 120.5",
    ],
    options: { minPass: 1, runnerExit: 1 },
    expectOk: false,
    expectMatch: /cancelled 3/,
  },
  {
    name: "cancelled with a zero exit code is still a failure",
    lines: [
      "ℹ tests 4",
      "ℹ pass 3",
      "ℹ fail 0",
      "ℹ cancelled 1",
      "ℹ duration_ms 9",
    ],
    options: { runnerExit: 0 },
    expectOk: false,
    expectMatch: /cancelled 1/,
  },
  {
    name: "the TAP reporter form is understood too",
    lines: ["# tests 285", "# pass 285", "# fail 0", "# cancelled 0"],
    options: { minPass: 100 },
    expectOk: true,
  },
  {
    name: "a glob that matched nothing",
    lines: [
      "ℹ tests 0",
      "ℹ pass 0",
      "ℹ fail 0",
      "ℹ cancelled 0",
      "ℹ duration_ms 1",
    ],
    options: { minPass: 100 },
    expectOk: false,
    expectMatch: /below the floor/,
  },
  {
    name: "the runner died before printing a summary",
    lines: ["SyntaxError: Unexpected token", "    at file:///app/test/x.test.ts:1"],
    options: { runnerExit: 1 },
    expectOk: false,
    expectMatch: /no complete node:test summary/,
  },
  {
    name: "a clean summary cannot mask a non-zero runner exit",
    lines: [
      "ℹ tests 285",
      "ℹ pass 285",
      "ℹ fail 0",
      "ℹ cancelled 0",
      "ℹ duration_ms 5",
    ],
    options: { minPass: 100, runnerExit: 7 },
    expectOk: false,
    expectMatch: /exited 7/,
  },
  {
    name: "a test title containing summary-shaped text is not read as the summary",
    lines: [
      "✔ reports cancelled 9 when the deadline never fires (0.4ms)",
      "ℹ tests 1",
      "ℹ pass 1",
      "ℹ fail 0",
      "ℹ cancelled 0",
      "ℹ duration_ms 2",
    ],
    options: {},
    expectOk: true,
  },
  {
    name: "ANSI colour codes do not defeat the parser",
    lines: [
      `${ESC}[32mℹ${ESC}[39m pass 285`,
      "ℹ tests 285",
      "ℹ fail 0",
      "ℹ cancelled 0",
    ],
    options: { minPass: 100 },
    expectOk: true,
  },
];

function selftest() {
  let failed = 0;
  for (const fixture of FIXTURES) {
    const result = verdictFor(fixture.lines.join("\n"), fixture.options);
    const joined = result.problems.join(" ");
    let bad = result.ok !== fixture.expectOk;
    if (!bad && fixture.expectMatch && !fixture.expectMatch.test(joined)) bad = true;
    if (bad) {
      failed += 1;
      console.error(`✖ ${fixture.name}`);
      console.error(`    expected ok=${fixture.expectOk}, got ok=${result.ok}`);
      if (joined) console.error(`    problems: ${joined}`);
    } else {
      console.log(`✔ ${fixture.name}`);
    }
  }
  if (failed > 0) {
    console.error(`\ncheck-test-summary self-test: ${failed} case(s) FAILED`);
    process.exit(1);
  }
  console.log(`\ncheck-test-summary self-test: ${FIXTURES.length} cases passed`);
}

// --- entry point -----------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes("--selftest")) {
  selftest();
} else {
  const logPath = argv.find((arg) => !arg.startsWith("-"));
  if (!logPath) {
    console.error("usage: check-test-summary.mjs <log-file> [--min-pass=N] [--runner-exit=N]");
    console.error("       check-test-summary.mjs --selftest");
    process.exit(2);
  }
  const flag = (name, fallback) => {
    const found = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (!found) return fallback;
    const value = Number(found.slice(name.length + 3));
    return Number.isFinite(value) ? value : fallback;
  };
  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (error) {
    console.error(`::error::cannot read the test log at ${logPath}: ${error.message}`);
    process.exit(2);
  }
  const result = verdictFor(text, {
    minPass: flag("min-pass", 1),
    runnerExit: flag("runner-exit", 0),
  });
  const shown = KEYS.filter((key) => key in result.counts)
    .map((key) => `${key} ${result.counts[key]}`)
    .join(", ");
  if (result.ok) {
    console.log(`test summary guard: OK (${shown})`);
    process.exit(0);
  }
  console.error(`test summary guard: FAILED${shown ? ` (${shown})` : ""}`);
  for (const problem of result.problems) console.error(`::error::${problem}`);
  process.exit(1);
}
