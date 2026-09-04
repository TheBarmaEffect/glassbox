#!/usr/bin/env node
/**
 * `npm audit` as a deploy gate, without letting npm's uptime decide whether we ship.
 *
 * The problem this replaces: npm's advisory endpoint returned 503s, `400 Invalid package
 * tree` and outright timeouts across four jobs in a single afternoon. An unreachable
 * advisory service is not evidence of a vulnerability, so blocking a deploy on it is
 * wrong. A real finding must still stop the deploy. Those two requirements pull in
 * opposite directions and the only safe way to hold both is to tell the two cases apart
 * reliably.
 *
 * Two changes from the inline shell this consolidates:
 *
 *  1. The pass/fail decision is structural, not textual. `npm audit --json` reports
 *     `metadata.vulnerabilities` as per-severity integers. If that object parses, the
 *     audit ran and its counts are authoritative — no grepping human-readable prose for
 *     "Service Unavailable" to guess whether a non-zero exit meant a finding or an
 *     outage. Prose changes between npm versions; the JSON contract does not.
 *
 *  2. There is one copy. The shell version was pasted into four jobs and a fifth job
 *     (`reddit-devvit`) called a raw `npm audit` through a package script instead, so it
 *     kept every failure mode the other four had just been hardened against. A single
 *     entry point cannot drift out of sync with itself.
 *
 * Classification:
 *   - JSON parses, high + critical == 0  -> pass
 *   - JSON parses, high + critical  > 0  -> FAIL, exit 1
 *   - no parseable audit report          -> transport error: retry with backoff
 *   - transport errors on every attempt  -> warn and pass, because npm being down is not
 *                                           a property of this commit. `npm ci` in the
 *                                           same job has already validated the lockfile.
 *
 * The per-attempt cap is enforced in-process rather than by wrapping the call in
 * coreutils `timeout`. The shell version guarded for `timeout` being absent because a
 * missing binary exits 127 and would have been misread as a real finding; not needing the
 * binary at all removes that branch, and it also means the cap behaves the same on a
 * developer's macOS box as on the runners.
 *
 * Usage:
 *   node audit-gate.mjs [--dir=.] [--attempts=3] [--timeout-ms=120000] [--level=high]
 *   node audit-gate.mjs --selftest
 */

import { spawn } from "node:child_process";
import process from "node:process";

const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

/**
 * Decide from one `npm audit --json` attempt.
 *
 * Exported for the self-test: this function is the whole gate, and it is worth being able
 * to check it against recorded npm output without a network round trip.
 */
export function classify({ stdout, stderr, code, timedOut }, level = "high") {
  if (timedOut) {
    return { kind: "transport", reason: `the audit did not finish within the per-attempt cap` };
  }

  const report = parseReport(stdout);
  if (!report) {
    // npm prints its own error as JSON on some failures and as prose on others. Either
    // way, no `metadata.vulnerabilities` means no audit result, which means no evidence
    // about this dependency tree.
    const detail = firstMeaningfulLine(stderr) || firstMeaningfulLine(stdout) || `npm exited ${code}`;
    return { kind: "transport", reason: detail };
  }

  const counts = report.metadata.vulnerabilities;
  const gated = SEVERITY_ORDER.slice(SEVERITY_ORDER.indexOf(level));
  const gatedTotal = gated.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
  const breakdown = SEVERITY_ORDER
    .filter((name) => (counts[name] ?? 0) > 0)
    .map((name) => `${counts[name]} ${name}`)
    .join(", ") || "none";

  if (gatedTotal > 0) {
    return {
      kind: "findings",
      gatedTotal,
      breakdown,
      advisories: describeAdvisories(report, gated),
    };
  }
  return { kind: "clean", breakdown, total: counts.total ?? 0 };
}

function parseReport(stdout) {
  // npm sometimes prefixes the JSON with warnings on stdout, so take the first {...} run
  // rather than assuming the whole stream is JSON.
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object") return null;
  // An audit report always carries every severity key. A partial object means npm
  // reported something else in a JSON envelope, so it is not a result.
  if (!SEVERITY_ORDER.every((name) => typeof counts[name] === "number")) return null;
  return parsed;
}

function describeAdvisories(report, gated) {
  const lines = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    if (!gated.includes(entry?.severity)) continue;
    const urls = (entry.via ?? [])
      .filter((via) => via && typeof via === "object" && via.url)
      .map((via) => via.url);
    lines.push(`${name} (${entry.severity})${urls.length ? ` ${urls.join(" ")}` : ""}`);
  }
  return lines;
}

function firstMeaningfulLine(text) {
  for (const line of (text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("npm warn")) return trimmed.slice(0, 300);
  }
  return "";
}

function runAudit({ dir, level, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["audit", "--omit=dev", `--audit-level=${level}`, "--json"],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${error.message}`, code: -1, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(options) {
  const label = options.dir === "." ? process.cwd() : options.dir;
  console.log(`audit gate: ${label} (fail at ${options.level} or above, production deps only)`);

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const result = classify(await runAudit(options), options.level);

    if (result.kind === "clean") {
      console.log(`audit gate: PASS — no ${options.level}-or-above advisories (${result.breakdown} of ${result.total} total)`);
      return 0;
    }

    if (result.kind === "findings") {
      console.error(`audit gate: FAIL — ${result.gatedTotal} advisory/advisories at ${options.level} or above (${result.breakdown})`);
      for (const line of result.advisories) console.error(`  - ${line}`);
      console.error(
        "::error::npm audit reported findings at or above " + options.level + " severity in " +
        `${label}. This is a parsed audit result, not a transport failure: the advisory ` +
        "endpoint answered and the counts above are what it returned.",
      );
      return 1;
    }

    // transport
    console.log(`::warning::audit gate: advisory endpoint unusable on attempt ${attempt}/${options.attempts} in ${label}: ${result.reason}`);
    if (attempt < options.attempts) await sleep(attempt * 10_000);
  }

  console.log(
    `::warning::audit gate: npm's advisory endpoint was unusable on all ${options.attempts} attempts in ${label}, ` +
    "so this step is not failing the build. An unreachable advisory service is not evidence " +
    "of a vulnerability. The lockfile itself was already validated by npm ci in this job.",
  );
  return 0;
}

// --- self-test -------------------------------------------------------------------------
// Recorded npm output, including the exact shapes seen during the outage. The gate decides
// whether a deploy ships, so its classifier is checked rather than assumed.

const FIXTURES = [
  {
    name: "clean tree passes",
    attempt: {
      code: 0,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
      }),
      stderr: "",
    },
    expect: "clean",
  },
  {
    name: "a real critical finding fails (minimist@1.2.0, as verified against the registry)",
    attempt: {
      code: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          minimist: {
            name: "minimist",
            severity: "critical",
            via: [{ url: "https://github.com/advisories/GHSA-xvch-5gv4-984h", severity: "critical" }],
          },
        },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 } },
      }),
      stderr: "",
    },
    expect: "findings",
    expectMatch: /minimist \(critical\)/,
  },
  {
    name: "a high finding fails at the default level",
    attempt: {
      code: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: { lodash: { name: "lodash", severity: "high", via: [] } },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
      }),
      stderr: "",
    },
    expect: "findings",
  },
  {
    name: "moderate-only does not fail a high gate",
    attempt: {
      code: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: { thing: { name: "thing", severity: "moderate", via: [] } },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 0, critical: 0, total: 2 } },
      }),
      stderr: "",
    },
    expect: "clean",
  },
  {
    name: "503 from the advisory endpoint is a transport error, not a finding",
    attempt: {
      code: 1,
      stdout: "",
      stderr: "npm error code E503\nnpm error 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
    },
    expect: "transport",
  },
  {
    name: "400 Invalid package tree is a transport error, not a finding",
    attempt: {
      code: 1,
      stdout: "",
      stderr: "npm error code E400\nnpm error 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - Invalid package tree",
    },
    expect: "transport",
  },
  {
    name: "a JSON error envelope with no vulnerability counts is a transport error",
    attempt: {
      code: 1,
      stdout: JSON.stringify({ error: { code: "E503", summary: "Service Unavailable", detail: "" } }),
      stderr: "",
    },
    expect: "transport",
  },
  {
    name: "a hit per-attempt cap is a transport error",
    attempt: { code: null, stdout: "", stderr: "", timedOut: true },
    expect: "transport",
  },
  {
    name: "truncated JSON is a transport error, never a silent pass",
    attempt: { code: 1, stdout: '{"auditReportVersion":2,"metadata":{"vulner', stderr: "" },
    expect: "transport",
  },
  {
    name: "a partial counts object is not accepted as a result",
    attempt: {
      code: 0,
      stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0 } } }),
      stderr: "",
    },
    expect: "transport",
  },
  {
    name: "npm warnings printed before the JSON do not break parsing",
    attempt: {
      code: 0,
      stdout: 'npm warn deprecated foo@1.0.0: old\n' + JSON.stringify({
        metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 } },
      }),
      stderr: "",
    },
    expect: "clean",
  },
];

function selftest() {
  let failed = 0;
  for (const fixture of FIXTURES) {
    const result = classify({ timedOut: false, ...fixture.attempt }, fixture.level ?? "high");
    const rendered = JSON.stringify(result);
    let bad = result.kind !== fixture.expect;
    if (!bad && fixture.expectMatch && !fixture.expectMatch.test(rendered)) bad = true;
    if (bad) {
      failed += 1;
      console.error(`✖ ${fixture.name}`);
      console.error(`    expected kind=${fixture.expect}, got ${rendered}`);
    } else {
      console.log(`✔ ${fixture.name}  ->  ${result.kind}`);
    }
  }
  if (failed > 0) {
    console.error(`\naudit-gate self-test: ${failed} case(s) FAILED`);
    process.exit(1);
  }
  console.log(`\naudit-gate self-test: ${FIXTURES.length} cases passed`);
}

// --- entry point -----------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

if (argv.includes("--selftest")) {
  selftest();
} else {
  const options = {
    dir: flag("dir", "."),
    level: flag("level", "high"),
    attempts: Number(flag("attempts", "3")),
    timeoutMs: Number(flag("timeout-ms", "120000")),
  };
  process.exitCode = await main(options);
}
