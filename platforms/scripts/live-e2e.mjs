#!/usr/bin/env node
/**
 * End-to-end test against the *deployed* gateway.
 *
 * The suite in `test/` proves the code in this checkout behaves. It cannot prove that the
 * thing answering on the internet is that code. Those came apart today: the gateway served
 * 13 deterministic probes while this repository declared 14, for three commits, and
 * nothing failed — because nothing was comparing them. So the probe assertions here read
 * their expected values out of `src/server.ts` rather than being written down a second
 * time. A copied expectation drifts with the deploy; a derived one cannot.
 *
 * Deliberately non-blocking in CI. A free-tier instance asleep after fifteen idle minutes
 * is not a defect in a commit, and gating deploys on a cold start would make the gate
 * meaningless. It is scheduled, it is loud when it fails, and it tolerates a cold start.
 *
 * Safety properties, all load-bearing:
 *   - low volume: about fifteen requests, hard-capped, spaced, well inside the gateway's
 *     own per-caller rate window
 *   - read-only apart from verification calls, which persist nothing by design
 *   - no secret is ever hardcoded, printed, or logged. PLATFORM_SHARED_SECRET is read from
 *     the environment if present and used only as a bearer token; if absent, the
 *     authenticated assertions are skipped with a stated reason and the *unauthenticated*
 *     behaviour of those endpoints is still asserted, because a closed gate is checkable
 *     without holding the key.
 *
 * Usage:
 *   node scripts/live-e2e.mjs [--base=https://...] [--repo-root=..] [--no-color]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// --- options ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const BASE = (flag("base", process.env.GLASSBOX_GATEWAY_URL
  ?? "https://glassbox-platform-gateway.onrender.com")).replace(/\/+$/, "");
const REPO_ROOT = path.resolve(
  flag("repo-root", path.join(import.meta.dirname, "..", "..")),
);
const MCP_TOOL = "glassbox_verify_answer";

// The gateway runs one verification at a time and rate-limits per caller. Spacing keeps
// this a well-behaved client rather than something the service has to defend against.
const SPACING_MS = 1_200;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUESTS = 20;

// --- reporting -------------------------------------------------------------------------

const failures = [];
const skips = [];
let passed = 0;
let requests = 0;

// Colour only on a terminal. CI logs and captured output stay plain, which keeps the
// output greppable and keeps escape bytes out of anything pasted into a report.
const ESC = "\u001b";
const colour = !argv.includes("--no-color") && process.stdout.isTTY;
const paint = (code, text) => (colour ? `${ESC}[${code}m${text}${ESC}[0m` : text);
const green = (text) => paint(32, text);
const red = (text) => paint(31, text);
const dim = (text) => paint(2, text);

function ok(label, detail = "") {
  passed += 1;
  console.log(`${green("PASS")} ${label}${detail ? ` ${dim(detail)}` : ""}`);
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.log(`${red("FAIL")} ${label}`);
  console.log(`     ${detail}`);
}

function skip(label, reason) {
  skips.push(`${label}: ${reason}`);
  console.log(`SKIP ${label}`);
  console.log(`     ${reason}`);
}

/**
 * Assert without aborting the run: one broken endpoint should not hide the rest.
 *
 * `whyFailed` explains a failure and is printed only on failure. `observed` is what was
 * actually seen and is printed only on success. Keeping them separate matters: a passing
 * line that carries the failure text reads as though the assertion failed, which is the
 * kind of log that costs an afternoon.
 */
function check(label, condition, whyFailed, observed) {
  if (condition) ok(label, observed ?? "");
  else fail(label, whyFailed || "assertion failed");
  return Boolean(condition);
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

/**
 * Run a block of assertions, turning any thrown error into a recorded failure.
 *
 * A live test hits a service that can answer with anything, including an HTML error page
 * from the platform in front of it. When that happened during development the script died
 * on a JSON parse with a stack trace and printed no summary — the worst possible output,
 * because the reader cannot tell which assertions ran. Every block that parses a response
 * goes through here so that a surprising response is a legible failure.
 */
async function guard(label, block) {
  try {
    return await block();
  } catch (error) {
    fail(label, error.message);
    return undefined;
  }
}

// --- transport -------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(pathname, init = {}) {
  if (requests >= MAX_REQUESTS) {
    throw new Error(
      `request budget of ${MAX_REQUESTS} exhausted before ${pathname}. This script is ` +
      "meant to be a low-volume probe of a free-tier instance; raise the budget only " +
      "deliberately.",
    );
  }
  requests += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${pathname}`, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text, status: response.status };
  } finally {
    clearTimeout(timer);
    await sleep(SPACING_MS);
  }
}

function parseJsonBody(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * The MCP endpoint answers Streamable HTTP, which frames the JSON-RPC reply as
 * server-sent events. The payload is the last `data:` line; the tool result is then a JSON
 * document *inside* `result.content[0].text`. Two layers, both of which have to be
 * unwrapped before anything can be asserted.
 */
function parseSse(text) {
  const dataLines = text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    throw new Error(`no SSE data: line in the /mcp response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function callTool(args, id) {
  const { response, text } = await request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: MCP_TOOL, arguments: args },
    }),
  });
  if (response.status !== 200) {
    throw new Error(`/mcp returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const envelope = parseSse(text);
  if (envelope.error) {
    throw new Error(`/mcp JSON-RPC error: ${JSON.stringify(envelope.error)}`);
  }
  const inner = envelope.result?.content?.[0]?.text;
  if (typeof inner !== "string") {
    throw new Error(`/mcp result carried no text content: ${JSON.stringify(envelope.result).slice(0, 200)}`);
  }
  const payload = JSON.parse(inner);
  // An MCP tool reports failure inside a successful HTTP response, as `isError` on the
  // result. Without this branch a refusal was unwrapped as if it were a verification and
  // every field assertion failed with "got undefined" — a confusing report of a
  // perfectly clear refusal.
  if (envelope.result?.isError === true) {
    const error = new Error(payload?.error ?? "the tool reported an error with no message");
    error.mcpToolError = payload;
    throw error;
  }
  return { payload, envelope, response };
}

/**
 * The gateway rate-limits per caller, on purpose. Being throttled is the gateway working,
 * not the gateway broken, so it is reported as a skip. It must never be silently ignored
 * either: the run says it was throttled, and the metrics-delta assertion below is
 * skipped rather than compared against calls that never happened.
 */
function isThrottled(error) {
  return /rate limit|too many requests|429/i.test(error?.message ?? "");
}

// --- source of truth for the probe set -------------------------------------------------

/**
 * Read an array literal out of `src/server.ts`.
 *
 * This is the point of the whole capabilities check: the expected probe set must come from
 * the checkout being deployed, not from a list retyped here that would silently agree with
 * a stale gateway. Missing or empty is a hard error rather than an empty expectation,
 * because an empty expected set trivially matches anything.
 */
function probeSetFromSource(key) {
  const file = path.join(REPO_ROOT, "platforms", "src", "server.ts");
  const source = readFileSync(file, "utf8");
  const at = source.indexOf(`${key}: [`);
  if (at < 0) {
    throw new Error(
      `could not find \`${key}: [\` in ${file}. The capabilities check derives its ` +
      "expectations from this file; do not delete the check to make it pass — point it at " +
      "wherever the probe list moved.",
    );
  }
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  if (close < 0) throw new Error(`unterminated ${key} array in ${file}`);
  const body = source.slice(open + 1, close);
  const names = [...body.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
  if (names.length === 0) throw new Error(`${key} in ${file} parsed as empty`);
  return names;
}

// --- assertions on any MCP verification result -----------------------------------------

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const VERDICTS = new Set(["trust", "caution", "reject"]);

function assertResultShape(label, payload, advertisedProbes) {
  check(`${label}: verdict is one of trust/caution/reject`,
    VERDICTS.has(payload.verdict), `got ${JSON.stringify(payload.verdict)}`,
    `verdict=${payload.verdict}`);

  check(`${label}: score is a number in [0,1]`,
    typeof payload.score === "number" && payload.score >= 0 && payload.score <= 1,
    `got ${JSON.stringify(payload.score)}`, `score=${payload.score}`);

  check(`${label}: finding_count matches the findings array`,
    payload.finding_count === payload.findings.length,
    `finding_count=${payload.finding_count} but findings=${payload.findings.length}`,
    `finding_count=${payload.finding_count}`);

  // A non-trust verdict with nothing to point at was a real bug: the caller is told the
  // answer was rejected and given no reason. A transparency surface must not do that.
  if (payload.verdict !== "trust") {
    check(`${label}: a non-trust verdict carries at least one finding`,
      payload.findings.length >= 1,
      `verdict=${payload.verdict} but findings=[] — a verdict with no stated reason`,
      `${payload.verdict} explained by ${payload.findings.map((f) => f.angle).join(", ")}`);
  }

  const badSummary = payload.findings.filter(
    (finding) => typeof finding.summary !== "string" || finding.summary.trim().length === 0,
  );
  check(`${label}: every finding carries a non-empty summary`,
    badSummary.length === 0,
    `findings without a summary: ${JSON.stringify(badSummary)}`,
    `${payload.findings.length} finding(s) checked`);

  const badSeverity = payload.findings.filter((finding) => !SEVERITIES.has(finding.severity));
  check(`${label}: every finding carries a known severity`,
    badSeverity.length === 0, `unexpected severities: ${JSON.stringify(badSeverity)}`,
    `highest=${payload.highest_severity}`);

  const badProbeSummary = payload.probes.filter(
    (probe) => typeof probe.summary !== "string" || probe.summary.trim().length === 0,
  );
  check(`${label}: every probe result carries a non-empty summary`,
    badProbeSummary.length === 0,
    `probes without a summary: ${JSON.stringify(badProbeSummary.map((p) => p.angle))}`,
    `${payload.probes.length} probe result(s) checked`);

  // The engine must not run a probe the deployment does not advertise, and the summary
  // projection must cover everything the engine emits. Either direction failing means the
  // published capability description is fiction.
  const unadvertised = payload.probes
    .map((probe) => probe.angle)
    .filter((angle) => !advertisedProbes.includes(angle));
  check(`${label}: every probe reported is one /api/v1/capabilities advertises`,
    unadvertised.length === 0, `not advertised: ${unadvertised.join(", ")}`,
    `${payload.probes.length} of ${advertisedProbes.length} advertised probes ran`);

  check(`${label}: caveats are present`,
    Array.isArray(payload.caveats) && payload.caveats.length > 0,
    `got ${JSON.stringify(payload.caveats)}`,
    `${payload.caveats?.length ?? 0} caveat(s)`);
}

// --- content-freedom scan --------------------------------------------------------------

/**
 * Walk the metrics payload and collect every string that could carry submitted content.
 *
 * Verified against the served payload: the only free text is the `notes` array. Every
 * other string, and every object key (label maps are keyed by caller-influenced labels),
 * is a short identifier. So "no whitespace, no more than 80 characters, outside notes" is
 * a genuine invariant rather than a guess, and it catches a submitted question that ends
 * up as a label — which the sentinel check alone would only catch for this one run.
 */
function suspiciousStrings(payload) {
  const found = [];
  const walk = (node, where) => {
    if (typeof node === "string") {
      if (where.startsWith("notes")) return;
      if (/\s/.test(node) || node.length > 80) found.push([where, node]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value, index) => walk(value, `${where}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (/\s/.test(key) || key.length > 80) found.push([`${where}.<key>`, key]);
        walk(value, where ? `${where}.${key}` : key);
      }
    }
  };
  walk(payload, "");
  return found;
}

// --- the run ---------------------------------------------------------------------------

console.log(`GlassBox live end-to-end test`);
console.log(`base:      ${BASE}`);
console.log(`checkout:  ${REPO_ROOT}`);
console.log(`started:   ${new Date().toISOString()}`);

// 1. Wake the instance ------------------------------------------------------------------
// A free instance sleeps after roughly fifteen idle minutes and takes tens of seconds to
// come back. That is a hosting-plan property, not a fault, so it is waited out rather than
// reported as an outage.

section("Reachability and health");

let health = null;
let healthResponse = null;
const WAKE_BACKOFF_MS = [0, 5_000, 10_000, 20_000];
for (const [index, wait] of WAKE_BACKOFF_MS.entries()) {
  if (wait) {
    console.log(dim(`     cold start suspected; waiting ${wait / 1000}s before attempt ${index + 1}`));
    await sleep(wait);
  }
  try {
    const { response, text, status } = await request("/health", { timeoutMs: 90_000 });
    if (status === 200) {
      health = parseJsonBody(text, "/health");
      healthResponse = response;
      if (index > 0) console.log(dim(`     came back after ${index + 1} attempts (cold start)`));
      break;
    }
    console.log(dim(`     /health returned HTTP ${status} on attempt ${index + 1}`));
  } catch (error) {
    console.log(dim(`     attempt ${index + 1} failed: ${error.message}`));
  }
}

if (!health) {
  fail("/health is reachable",
    `no 200 from ${BASE}/health after ${WAKE_BACKOFF_MS.length} attempts with backoff. ` +
    "For a free-tier instance this is usually a cold start or a sleeping service rather " +
    "than a code defect, which is why this workflow does not gate deploys.");
} else {
  ok("/health is reachable", `HTTP 200`);
  check("/health reports status ok", health.status === "ok",
    `got ${JSON.stringify(health.status)}`, `status=${health.status}`);
  check("/health names a verifier backend",
    typeof health.verifier_backend === "string" && health.verifier_backend.length > 0,
    `got ${JSON.stringify(health.verifier_backend)}`, `backend=${health.verifier_backend}`);
  check("/health declares no raw-content persistence",
    health.raw_content_persistence === false,
    `got ${JSON.stringify(health.raw_content_persistence)}`, "raw_content_persistence=false");
  check("/health lists at least one enabled platform",
    Array.isArray(health.platforms) && health.platforms.length > 0,
    `got ${JSON.stringify(health.platforms)}`, `platforms=${(health.platforms ?? []).join(",")}`);
  check("/health advertises the mcp adapter, which this test drives",
    Array.isArray(health.platforms) && health.platforms.includes("mcp"),
    `platforms=${JSON.stringify(health.platforms)}`, "mcp enabled");
}

// 2. Readiness --------------------------------------------------------------------------

await guard("/ready", async () => {
  const { status, text } = await request("/ready");
  const reachedReady = check("/ready returns HTTP 200", status === 200,
    `got HTTP ${status}: ${text.slice(0, 200)}`, "HTTP 200");
  if (!reachedReady) return;
  const body = parseJsonBody(text, "/ready");
  check("/ready reports status ready", body?.status === "ready",
    `got ${JSON.stringify(body?.status)}${body?.reason ? ` (${body.reason})` : ""}`,
    `status=ready backend=${body?.verifier_backend}`);
});

// 3. Security headers -------------------------------------------------------------------

section("Security headers");

if (!healthResponse) {
  skip("security headers", "/health never answered, so no response headers were captured");
} else {
  const header = (name) => healthResponse.headers.get(name) ?? "";

  const hsts = header("strict-transport-security");
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  check("HSTS is set with a max-age of at least a year",
    maxAge >= 31_536_000, `strict-transport-security: ${JSON.stringify(hsts)}`,
    `max-age=${maxAge}`);

  const csp = header("content-security-policy");
  check("CSP is present", csp.length > 0, "no content-security-policy header",
    `${csp.split(";").length} directives`);
  check("CSP restricts frame-ancestors",
    /frame-ancestors\s+'none'|frame-ancestors\s+'self'/.test(csp),
    `frame-ancestors missing or permissive in: ${JSON.stringify(csp)}`,
    (/frame-ancestors[^;]*/.exec(csp) ?? [""])[0].trim());
  check("CSP sets a default-src",
    /default-src/.test(csp), `no default-src in: ${JSON.stringify(csp)}`,
    (/default-src[^;]*/.exec(csp) ?? [""])[0].trim());

  const xfo = header("x-frame-options").toUpperCase();
  check("X-Frame-Options denies framing for pre-CSP-Level-2 agents",
    xfo === "DENY" || xfo === "SAMEORIGIN", `x-frame-options: ${JSON.stringify(xfo)}`, xfo);

  check("X-Content-Type-Options is nosniff",
    header("x-content-type-options").toLowerCase() === "nosniff",
    `x-content-type-options: ${JSON.stringify(header("x-content-type-options"))}`, "nosniff");

  const referrer = header("referrer-policy").toLowerCase();
  check("Referrer-Policy is set and restrictive",
    ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]
      .includes(referrer),
    `referrer-policy: ${JSON.stringify(referrer)}`, referrer);

  check("the server does not advertise its framework",
    !healthResponse.headers.has("x-powered-by"),
    `x-powered-by: ${healthResponse.headers.get("x-powered-by")}`, "no x-powered-by");
}

// 4. Capabilities vs. this checkout -----------------------------------------------------

section("Advertised capabilities against this checkout");

let capabilities = null;
await guard("/api/v1/capabilities", async () => {
  const { status, text } = await request("/api/v1/capabilities");
  check("/api/v1/capabilities returns HTTP 200", status === 200,
    `got HTTP ${status}`, "HTTP 200");
  if (status === 200) capabilities = parseJsonBody(text, "/api/v1/capabilities");
});

let advertisedProbes = [];
if (!capabilities) {
  skip("probe-set skew check", "/api/v1/capabilities did not answer");
} else {
  advertisedProbes = [
    ...(capabilities.deterministic_probes ?? []),
    ...(capabilities.tool_invocation_probes ?? []),
  ];

  for (const key of ["deterministic_probes", "tool_invocation_probes"]) {
    let expected;
    try {
      expected = probeSetFromSource(key);
    } catch (error) {
      fail(`${key}: source of truth is readable`, error.message);
      continue;
    }
    const served = capabilities[key] ?? [];
    const missing = expected.filter((name) => !served.includes(name));
    const extra = served.filter((name) => !expected.includes(name));
    check(
      `${key}: the gateway serves exactly what src/server.ts declares`,
      missing.length === 0 && extra.length === 0,
      `repo declares ${expected.length}, gateway serves ${served.length}` +
      `${missing.length ? `; absent from the deploy: ${missing.join(", ")}` : ""}` +
      `${extra.length ? `; served but not in this checkout: ${extra.join(", ")}` : ""}` +
      "; a deploy lagging the repository is the exact skew this catches",
      `${served.length} probes, matched name for name against src/server.ts`,
    );
  }

  check("capabilities disclaims external fact verification",
    capabilities.external_fact_verification === false,
    `got ${JSON.stringify(capabilities.external_fact_verification)}`, "external_fact_verification=false");
  check("capabilities declares no raw-content persistence",
    capabilities.raw_content_persistence === false,
    `got ${JSON.stringify(capabilities.raw_content_persistence)}`, "raw_content_persistence=false");
  check("capabilities states its limitations",
    Array.isArray(capabilities.limitations) && capabilities.limitations.length > 0,
    "the limitations array is missing or empty",
    `${capabilities.limitations?.length ?? 0} stated limitations`);
}

// 5. Metrics before ---------------------------------------------------------------------

section("Behaviour through the public MCP endpoint");

let metricsBefore = null;
await guard("/api/v1/metrics (baseline)", async () => {
  const { status, text } = await request("/api/v1/metrics");
  if (status === 200) metricsBefore = parseJsonBody(text, "/api/v1/metrics");
  else fail("/api/v1/metrics returns HTTP 200", `got HTTP ${status}`);
});

// 6. tools/list -------------------------------------------------------------------------

await guard("/mcp tools/list", async () => {
  const { status, text } = await request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (status !== 200) {
    fail(`/mcp tools/list returns HTTP 200`, `got HTTP ${status}: ${text.slice(0, 200)}`);
  } else {
    const tools = parseSse(text).result?.tools ?? [];
    check(`/mcp advertises ${MCP_TOOL}`,
      tools.some((tool) => tool.name === MCP_TOOL),
      `tools: ${tools.map((tool) => tool.name).join(", ") || "(none)"}`,
      `${tools.length} tool(s) advertised`);
    const tool = tools.find((candidate) => candidate.name === MCP_TOOL);
    check(`${MCP_TOOL} is annotated read-only`,
      tool?.annotations?.readOnlyHint === true,
      `annotations: ${JSON.stringify(tool?.annotations)}`, "readOnlyHint=true");
  }
});

// 7. Behavioural cases ------------------------------------------------------------------
// Every case below was run against production before being asserted here; the expected
// verdicts are observed behaviour, not hopes.

const sentinel = `glassbox-live-e2e-${createHash("sha256")
  .update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 20)}`;
const sentinelSha = createHash("sha256").update(sentinel).digest("hex");

const CASES = [
  {
    id: 2,
    label: "wrong arithmetic",
    args: { question: "What is 2 + 2?", answer: "2 + 2 = 5." },
    assert(payload) {
      check("wrong arithmetic is rejected", payload.verdict === "reject",
        `verdict=${payload.verdict}, findings=${payload.findings.map((f) => f.angle).join(",") || "none"}`,
        `verdict=reject score=${payload.score}`);
      check("the rejection is attributed to arithmetic_sanity",
        payload.findings.some((finding) => finding.angle === "arithmetic_sanity"),
        `findings: ${JSON.stringify(payload.findings.map((f) => f.angle))}`,
        "arithmetic_sanity (high)");
    },
  },
  {
    id: 3,
    // The false-positive class that accounted for ~98% of bad detections today: a
    // transcript is *written* with role prefixes, and reading those prefixes as an
    // injection attempt rejects ordinary text. This is the regression test for that.
    label: "an ordinary chat transcript",
    args: {
      question: "What did the assistant recommend in this conversation?",
      answer:
        "[Human]: I need to pick a database for a small internal tool.\n" +
        "[Assistant]: For a small internal tool, SQLite is usually enough and needs no server.\n" +
        "[Human]: What if we later need concurrent writers?\n" +
        "[Assistant]: Then Postgres is a reasonable next step, since it handles concurrent writes well.",
    },
    assert(payload) {
      check("a chat transcript is NOT rejected", payload.verdict !== "reject",
        `verdict=${payload.verdict}; role prefixes are how transcripts are written, so ` +
        `rejecting them is a false positive: findings=${JSON.stringify(payload.findings.map((f) => f.angle))}`,
        `verdict=${payload.verdict}`);
      check("a chat transcript raises no prompt_injection finding",
        !payload.findings.some((finding) => finding.angle === "prompt_injection"),
        `findings: ${JSON.stringify(payload.findings.map((f) => f.angle))}`,
        `findings=${payload.findings.map((f) => f.angle).join(",") || "none"}`);
      check("the transcript's claims were still extracted",
        payload.claim_count > 0, `claim_count=${payload.claim_count}`,
        `claim_count=${payload.claim_count}`);
    },
  },
  {
    id: 4,
    label: "a clean answer",
    args: {
      question: "Why does ice float on liquid water?",
      answer: "Ice floats because its crystalline structure makes it less dense than liquid water.",
    },
    assert(payload) {
      check("a clean answer returns trust", payload.verdict === "trust",
        `verdict=${payload.verdict}, findings=${JSON.stringify(payload.findings.map((f) => f.angle))}`,
        `verdict=trust score=${payload.score}`);
      check("a trust verdict carries no findings", payload.findings.length === 0,
        `findings: ${JSON.stringify(payload.findings)}`, "findings=0");
    },
  },
  {
    id: 5,
    // Plants the sentinel. The verdict is not asserted: this case exists to put a unique
    // string through the verification path so the metrics payload can be checked for it.
    label: "sentinel submission",
    args: {
      question: `Is the internal reference ${sentinel} correct?`,
      answer: `The internal reference ${sentinel} was checked and appears consistent.`,
    },
    assert() {},
  },
];

let verifiedCalls = 0;
let throttled = false;

for (const testCase of CASES) {
  if (throttled) {
    skip(testCase.label, "skipped: the gateway rate-limited an earlier call in this run. " +
      "Hammering a limiter that is working correctly proves nothing.");
    continue;
  }
  try {
    const { payload } = await callTool(testCase.args, testCase.id);
    verifiedCalls += 1;
    assertResultShape(testCase.label, payload, advertisedProbes);
    testCase.assert(payload);
  } catch (error) {
    if (isThrottled(error)) {
      throttled = true;
      skip(testCase.label,
        "the gateway rate-limited this call. That is the limiter doing its job, not a " +
        "defect, so it is not counted as a failure. If a scheduled run is throttled every " +
        "time, the schedule is competing with other traffic from the same egress address.");
      continue;
    }
    fail(testCase.label, error.message);
  }
}

// 8. Metrics after: aggregates, and no submitted content --------------------------------

section("Metrics are aggregates and carry no submitted content");

await guard("/api/v1/metrics", async () => {
  const { status, text } = await request("/api/v1/metrics");
  if (status !== 200) {
    fail("/api/v1/metrics returns HTTP 200", `got HTTP ${status}`);
  } else {
    const raw = text;
    const metrics = parseJsonBody(raw, "/api/v1/metrics");

    check("/api/v1/metrics returns aggregate counters",
      typeof metrics.verifications?.total === "number"
        && typeof metrics.latency_ms?.count === "number"
        && metrics.probe_fire_rate && typeof metrics.probe_fire_rate === "object",
      `payload keys: ${Object.keys(metrics).join(", ")}`,
      `${metrics.verifications?.total} verifications, ${Object.keys(metrics.probe_fire_rate ?? {}).length} probe fire rates`);

    // Without this the absence checks below could pass simply because the requests never
    // reached the counters — an assertion that cannot fail is not an assertion.
    if (metricsBefore) {
      const delta = (metrics.verifications?.total ?? 0) - (metricsBefore.verifications?.total ?? 0);
      const restarted = new Date(metrics.since).getTime() !== new Date(metricsBefore.since).getTime();
      if (restarted) {
        skip("the submissions reached the counters",
          "the instance restarted mid-run (in-memory counters reset), so the delta is not " +
          "comparable. The absence checks below still ran.");
      } else if (verifiedCalls === 0) {
        skip("the submissions reached the counters",
          "no verification call completed, so there is nothing to have been counted. The " +
          "sentinel-absence checks below are correspondingly weaker this run.");
      } else {
        check("the submissions reached the counters",
          delta >= verifiedCalls,
          `verifications.total moved by ${delta}; expected at least ${verifiedCalls} ` +
          "(the number of calls that completed). If the submissions were not counted, " +
          "finding no content in the metrics proves nothing.",
          `verifications.total +${delta} for ${verifiedCalls} call(s)`);
      }
    }

    const lowered = raw.toLowerCase();
    check("the sentinel is absent from the metrics payload (raw)",
      !raw.includes(sentinel), "a submitted string appeared verbatim in the metrics payload",
      `${raw.length} bytes scanned`);
    check("the sentinel is absent from the metrics payload (lowercased)",
      !lowered.includes(sentinel.toLowerCase()),
      "a submitted string appeared in the metrics payload under case folding", "absent");
    check("the sentinel is absent from the metrics payload (SHA-256)",
      !lowered.includes(sentinelSha.toLowerCase()),
      "a digest of a submitted string appeared in the metrics payload; a hash of content " +
      "is still derived from content", "absent");

    const suspicious = suspiciousStrings(metrics);
    check("no label or value outside notes[] looks like submitted text",
      suspicious.length === 0,
      `free-text or over-long strings found: ${JSON.stringify(suspicious.slice(0, 5))}`,
      "every label and value outside notes[] is a short identifier");
  }
});

// 9. The authenticated endpoints --------------------------------------------------------

section("Shared-secret endpoints");

await guard("unauthenticated gate", async () => {
  // Checkable without the key: the gate must be closed to an anonymous caller.
  const verify = await request("/api/v1/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "ping", answer: "pong" }),
  });
  check("/api/v1/verify rejects an unauthenticated caller",
    verify.status === 401, `got HTTP ${verify.status}: ${verify.text.slice(0, 160)}`, "HTTP 401");

  const govern = await request("/api/v1/govern", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "ping", answer: "pong" }),
  });
  check("/api/v1/govern rejects an unauthenticated caller",
    govern.status === 401, `got HTTP ${govern.status}: ${govern.text.slice(0, 160)}`, "HTTP 401");
});

const secret = process.env.PLATFORM_SHARED_SECRET;
if (!secret) {
  skip("authenticated /api/v1/verify and /api/v1/govern",
    "PLATFORM_SHARED_SECRET is not set in this environment. These endpoints need a bearer " +
    "token, so the authenticated assertions cannot run. Their unauthenticated behaviour " +
    "was asserted above. Set PLATFORM_SHARED_SECRET (as a secret, never inline) to " +
    "exercise the release gate as well.");
} else {
  // The token is passed straight into the Authorization header and never logged, echoed,
  // or included in any failure message below.
  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  };

  try {
    const { status, text } = await request("/api/v1/verify", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        question: "Why does ice float on liquid water?",
        answer: "Ice floats because its crystalline structure makes it less dense than liquid water.",
      }),
    });
    check("authenticated /api/v1/verify returns HTTP 200", status === 200,
      `got HTTP ${status}`, "HTTP 200");
    if (status === 200) {
      const card = parseJsonBody(text, "/api/v1/verify");
      check("/api/v1/verify returns a trust card with a verdict",
        VERDICTS.has(card.verdict), `verdict=${JSON.stringify(card.verdict)}`,
        `verdict=${card.verdict}`);
      check("/api/v1/verify is advisory: it does not mark a governance response executed",
        card.governance?.response?.executed !== true,
        "the advisory endpoint reported its recommended response as executed",
        `recommended action=${card.governance?.response?.action ?? "none"}, executed=false`);
    }
  } catch (error) {
    fail("authenticated /api/v1/verify", error.message);
  }

  try {
    const { status, text } = await request("/api/v1/govern", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        question: "Why does ice float on liquid water?",
        answer: "Ice floats because its crystalline structure makes it less dense than liquid water.",
      }),
    });
    check("/api/v1/govern releases a clean answer", status === 200,
      `got HTTP ${status}`, "HTTP 200");
    if (status === 200) {
      const body = parseJsonBody(text, "/api/v1/govern");
      check("/api/v1/govern reports the release as enforced by the gateway",
        body.gate?.released === true && body.gate?.enforced_by_gateway === true,
        `gate=${JSON.stringify(body.gate)}`,
        `action=${body.gate?.action} effect=${body.gate?.effect}`);
    }
  } catch (error) {
    fail("/api/v1/govern on a clean answer", error.message);
  }

  try {
    const { status, text } = await request("/api/v1/govern", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ question: "What is 2 + 2?", answer: "2 + 2 = 5." }),
    });
    // The gate withholds rather than releases, so a rejection is a 4xx with a stated
    // action, not a 200 with a warning attached.
    check("/api/v1/govern withholds a rejected answer",
      status === 422 || status === 409, `got HTTP ${status}: ${text.slice(0, 160)}`,
      `HTTP ${status}`);
    if (status === 422 || status === 409) {
      const body = parseJsonBody(text, "/api/v1/govern");
      check("the withheld response states its effect and action",
        body.gate?.released === false && typeof body.gate?.action === "string"
          && body.gate?.effect === "withheld",
        `gate=${JSON.stringify(body.gate)}`,
        `action=${body.gate?.action} effect=withheld next_step=${body.gate?.next_step}`);
    }
  } catch (error) {
    fail("/api/v1/govern on a rejected answer", error.message);
  }
}

// --- summary ---------------------------------------------------------------------------

section("Summary");
console.log(`requests issued: ${requests} (budget ${MAX_REQUESTS})`);
console.log(`passed:          ${passed}`);
console.log(`skipped:         ${skips.length}`);
console.log(`failed:          ${failures.length}`);
console.log(`verifications:   ${verifiedCalls} of ${CASES.length} behavioural cases completed`);

// A run where nothing was verified is not a passing run, it is a run that asserted almost
// nothing — and it must not read as a clean bill of health just because no assertion
// failed. Being throttled is still not a defect, so this is a warning and not an exit
// code: the distinction between "the gateway is fine" and "we did not check" belongs in
// the output, not in a footnote.
if (throttled || verifiedCalls === 0) {
  console.log(
    `::warning::live e2e: only ${verifiedCalls} of ${CASES.length} behavioural cases ran` +
    `${throttled ? " (the gateway rate-limited this run)" : ""}. The verdict assertions ` +
    "that did not run have proved nothing either way.",
  );
}

if (failures.length > 0) {
  console.log("");
  for (const failure of failures) console.log(`::error::live e2e: ${failure}`);
  console.log(`\n${red(`live end-to-end test FAILED: ${failures.length} assertion(s)`)}`);
  process.exit(1);
}

console.log(`\n${green(`live end-to-end test passed: ${passed} assertions against ${BASE}`)}`);
