#!/usr/bin/env node
/**
 * Glass Box — Grand Launch Demo Runner.
 *
 * Spawns the live MCP server on stdio, calls `glassbox_generate_trust_card`
 * with a juicy healthcare example (intermittent fasting + fabricated ADA
 * guidance), and prints the resulting Trust Card in a screen-recording-
 * friendly format with colours and timed pauses.
 *
 * Why generate_trust_card and not verify_answer?
 *   generate_trust_card is the one v1 tool that makes ZERO LLM calls — it
 *   assembles a Trust Card from prebuilt parts (claims, red_team, ecs).
 *   That means the demo runs WITHOUT an ANTHROPIC_API_KEY, while still
 *   exercising the live MCP server, the real verdict policy, and the
 *   deterministic SHA-256 audit hashing. Set ANTHROPIC_API_KEY and pass
 *   --full to run the complete LLM pipeline on the same example.
 *
 * Usage:
 *   node demo/launch-demo.mjs           # assembly-only (no key needed)
 *   node demo/launch-demo.mjs --full    # full pipeline (needs ANTHROPIC_API_KEY)
 *   node demo/launch-demo.mjs --fast    # skip pacing pauses (for CI / tests)
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const RAW_INPUTS_PATH = join(__dirname, "raw-inputs.json");
const CAPTURED_PATH = join(__dirname, "captured-trust-card.json");

const args = new Set(process.argv.slice(2));
const FULL_MODE = args.has("--full");
const FAST = args.has("--fast");

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

const w = (s) => process.stdout.write(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));

function divider(label) {
  const bar = "─".repeat(72);
  w(`\n${c.cyan}${bar}${c.reset}\n`);
  if (label) w(`${c.cyan}${c.bold}  ${label}${c.reset}\n${c.cyan}${bar}${c.reset}\n`);
}

function header() {
  const banner = [
    "",
    "  ┌──────────────────────────────────────────────────────────────────┐",
    "  │                                                                  │",
    "  │   G L A S S B O X    F R A M E W O R K                           │",
    "  │   Runtime constitutional AI verification                         │",
    "  │                                                                  │",
    "  │   Built by Karthik Barma · MS AI · Northeastern University       │",
    "  │   Powered by Aura                                                │",
    "  │                                                                  │",
    "  └──────────────────────────────────────────────────────────────────┘",
    "",
  ];
  w(c.cyan + banner.join("\n") + c.reset + "\n");
}

function verdictBadge(verdict) {
  if (verdict === "trust") return `${c.green}${c.bold} ✓ TRUST ${c.reset}`;
  if (verdict === "caution") return `${c.yellow}${c.bold} ⚠ CAUTION ${c.reset}`;
  return `${c.red}${c.bold} ✗ REJECT ${c.reset}`;
}

function severityColour(sev) {
  if (sev === "critical") return c.red + c.bold;
  if (sev === "high") return c.red;
  if (sev === "medium") return c.yellow;
  return c.gray;
}

function probeMark(passed) {
  return passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
}

/* ------------------------------------------------------------------ */
/* MCP client (JSON-RPC over stdio)                                   */
/* ------------------------------------------------------------------ */

function spawnServer() {
  const proc = spawn("npx", ["ts-node", "src/index.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "demo-key-assembly-only",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const responses = [];
  const pending = new Map();

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        responses.push(msg);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        // ignore non-JSON
      }
    }
  });

  proc.stderr.on("data", () => {
    // suppress server stderr from the demo terminal — set DEBUG=1 to see it
    if (process.env.DEBUG) process.stderr.write(`[server] ${arguments[0]}`);
  });

  let nextId = 1;
  function call(method, params, timeoutMs = 60000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timeout calling ${method}`)),
        timeoutMs
      );
      pending.set(id, (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  return { proc, call, notify, responses };
}

/* ------------------------------------------------------------------ */
/* Demo flow                                                          */
/* ------------------------------------------------------------------ */

async function main() {
  header();
  await sleep(900);

  divider("STEP 1 · The question");
  await sleep(400);

  const inputs = JSON.parse(readFileSync(RAW_INPUTS_PATH, "utf-8"));

  w(`\n  ${c.bold}Q:${c.reset} ${inputs.question}\n`);
  await sleep(1200);
  w(`\n  ${c.bold}A:${c.reset} ${c.dim}${inputs.answer}${c.reset}\n`);
  await sleep(1500);

  w(`\n  ${c.gray}Deployer constitution:${c.reset}\n`);
  for (const intent of inputs.intents) {
    w(`    ${c.gray}•${c.reset} ${c.dim}${intent}${c.reset}\n`);
    await sleep(300);
  }
  await sleep(1000);

  divider("STEP 2 · Connect to the live MCP server");
  await sleep(400);

  const mode = FULL_MODE ? "FULL PIPELINE (LLM calls)" : "ASSEMBLY ONLY (no LLM calls)";
  w(`\n  ${c.gray}mode:${c.reset} ${c.bold}${mode}${c.reset}\n`);
  w(`  ${c.gray}spawning:${c.reset} npx ts-node src/index.ts\n`);
  await sleep(800);

  const client = spawnServer();
  await sleep(600);

  w(`  ${c.gray}initialising MCP session...${c.reset}`);
  const init = await client.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "glassbox-launch-demo", version: "1.0" },
  });
  client.notify("notifications/initialized");
  w(` ${c.green}ok${c.reset}\n`);
  w(`  ${c.gray}server:${c.reset} ${init.result.serverInfo.name} v${init.result.serverInfo.version}\n`);
  await sleep(700);

  w(`  ${c.gray}listing tools...${c.reset}`);
  const tools = await client.call("tools/list", {});
  const toolNames = tools.result.tools.map((t) => t.name);
  w(` ${c.green}${toolNames.length} tools registered${c.reset}\n`);
  for (const name of toolNames) {
    w(`    ${c.dim}•${c.reset} ${c.cyan}${name}${c.reset}\n`);
    await sleep(120);
  }
  await sleep(900);

  let trustCard;
  let invokedTool;

  if (FULL_MODE) {
    /* ---------------- FULL PIPELINE PATH ---------------- */
    divider("STEP 3 · Call glassbox_verify_answer (full pipeline)");
    await sleep(500);
    invokedTool = "glassbox_verify_answer";

    w(`\n  ${c.gray}This will run claim extraction → constitution → red-team → ECS → verdict${c.reset}\n`);
    w(`  ${c.gray}Each engine makes a real call to the Anthropic API.${c.reset}\n\n`);
    await sleep(800);

    w(`  ${c.bold}>${c.reset} calling ${c.cyan}glassbox_verify_answer${c.reset}`);
    const dotInterval = setInterval(() => w("."), 350);
    const callResp = await client.call(
      "tools/call",
      {
        name: "glassbox_verify_answer",
        arguments: {
          question: inputs.question,
          answer: inputs.answer,
          intents: inputs.intents,
        },
      },
      300000
    );
    clearInterval(dotInterval);
    w(` ${c.green}done${c.reset}\n`);
    if (callResp.result?.isError) {
      throw new Error(callResp.result.content[0].text);
    }
    trustCard = JSON.parse(callResp.result.content[0].text);
  } else {
    /* ---------------- ASSEMBLY-ONLY PATH ---------------- */
    divider("STEP 3 · Call glassbox_generate_trust_card (assembly only)");
    await sleep(500);
    invokedTool = "glassbox_generate_trust_card";

    w(`\n  ${c.gray}This tool makes ZERO LLM calls. It assembles a Trust Card from${c.reset}\n`);
    w(`  ${c.gray}prebuilt parts (claims, red_team, ecs) and runs the live verdict${c.reset}\n`);
    w(`  ${c.gray}policy + deterministic SHA-256 audit hashing.${c.reset}\n\n`);
    await sleep(900);

    w(`  ${c.bold}>${c.reset} calling ${c.cyan}glassbox_generate_trust_card${c.reset} ...`);
    const callResp = await client.call("tools/call", {
      name: "glassbox_generate_trust_card",
      arguments: {
        question: inputs.question,
        answer: inputs.answer,
        claims: inputs.claims,
        red_team: inputs.red_team,
        ecs: inputs.ecs,
        constitution: inputs.constitution,
        intents: inputs.intents,
      },
    });
    if (callResp.result?.isError) {
      w(` ${c.red}error${c.reset}\n`);
      console.error(callResp.result.content[0].text);
      process.exit(1);
    }
    w(` ${c.green}done${c.reset}\n`);
    trustCard = JSON.parse(callResp.result.content[0].text);
  }

  /* ---------------- TRUST CARD RENDERING ---------------- */

  divider("STEP 4 · Trust Card");
  await sleep(700);

  w(`\n  ${c.bold}Verdict:${c.reset} ${verdictBadge(trustCard.verdict)}\n`);
  await sleep(500);
  w(`  ${c.gray}Rationale:${c.reset} ${trustCard.verdict_rationale}\n`);
  await sleep(1500);

  /* --- ECS breakdown --- */
  w(`\n  ${c.bold}ECS ${c.reset}${c.dim}(Epistemic Confidence Score)${c.reset}\n`);
  const ecs = trustCard.ecs;
  const dims = ecs.dimensions;
  const w_ = ecs.weights;
  function bar(value) {
    const filled = Math.round(value * 20);
    return c.cyan + "█".repeat(filled) + c.gray + "░".repeat(20 - filled) + c.reset;
  }
  const lines = [
    ["G   Groundedness            ", dims.groundedness, w_.groundedness],
    ["C   Coherence               ", dims.coherence, w_.coherence],
    ["K   Calibration             ", dims.calibration, w_.calibration],
    ["R   Red-team resistance     ", dims.red_team_resistance, w_.red_team_resistance],
    ["CC  Constitutional compl.   ", dims.constitutional_compliance, w_.constitutional_compliance],
  ];
  for (const [label, value, weight] of lines) {
    w(`    ${c.dim}${label}${c.reset}${bar(value)} ${value.toFixed(4)} ${c.gray}× w=${weight.toFixed(2)}${c.reset}\n`);
    await sleep(280);
  }
  w(`\n  ${c.gray}Formula:${c.reset}\n`);
  for (const line of ecs.formula.split("\n")) {
    w(`    ${c.dim}${line}${c.reset}\n`);
  }
  w(`\n  ${c.bold}ECS total: ${ecs.total.toFixed(4)}${c.reset}\n`);
  await sleep(1500);

  /* --- Claims --- */
  divider(`STEP 5 · Claims with reasoning chains (${trustCard.claims.length} extracted)`);
  await sleep(500);
  for (const claim of trustCard.claims) {
    w(`\n  ${c.bold}${claim.id}${c.reset} ${c.dim}[${claim.status}, conf=${claim.confidence.toFixed(2)}]${c.reset}\n`);
    w(`    ${c.bold}Claim:${c.reset}     ${claim.text}\n`);
    w(`    ${c.bold}Reasoning:${c.reset} ${c.dim}${claim.reasoning}${c.reset}\n`);
    if (claim.attack_surface.length) {
      w(`    ${c.bold}Attack surface:${c.reset}\n`);
      for (const a of claim.attack_surface) {
        w(`      ${c.gray}•${c.reset} ${c.dim}${a}${c.reset}\n`);
      }
    }
    await sleep(900);
  }
  await sleep(1200);

  /* --- Red team / Glassbox Court --- */
  divider(`STEP 6 · Glassbox Court — 7 adversarial probes`);
  await sleep(500);
  w(`\n  ${c.gray}pass rate:${c.reset} ${trustCard.red_team.pass_rate.toFixed(4)}    ` +
    `${c.gray}highest severity:${c.reset} ${severityColour(trustCard.red_team.highest_severity)}${trustCard.red_team.highest_severity}${c.reset}\n\n`);
  for (const probe of trustCard.red_team.probes) {
    const sev = `${severityColour(probe.severity)}${probe.severity.padEnd(8)}${c.reset}`;
    w(`  ${probeMark(probe.passed)} ${c.bold}${probe.angle.padEnd(28)}${c.reset} severity: ${sev}\n`);
    w(`    ${c.dim}${probe.finding}${c.reset}\n`);
    if (probe.evidence.length) {
      for (const ev of probe.evidence) {
        w(`      ${c.gray}↳ "${ev}"${c.reset}\n`);
      }
    }
    w("\n");
    await sleep(700);
  }

  /* --- Constitution --- */
  divider(`STEP 7 · Constitution (${trustCard.constitution.rules.length} compiled rules)`);
  await sleep(500);
  for (const rule of trustCard.constitution.rules) {
    const status = trustCard.constitution.evaluations?.[rule.id] ?? "?";
    const statusColour = status === "violated" ? c.red : status === "satisfied" ? c.green : c.gray;
    w(`\n  ${c.bold}${rule.id}${c.reset} ${statusColour}[${status}]${c.reset} ${c.dim}(severity: ${rule.severity})${c.reset}\n`);
    w(`    ${c.gray}intent:${c.reset}      ${c.dim}${rule.source_intent}${c.reset}\n`);
    w(`    ${c.gray}trigger:${c.reset}     ${c.dim}${rule.trigger}${c.reset}\n`);
    w(`    ${c.gray}requirement:${c.reset} ${c.dim}${rule.requirement}${c.reset}\n`);
    await sleep(700);
  }
  await sleep(1200);

  /* --- Audit --- */
  divider("STEP 8 · Audit reference (deterministic, replay-detectable)");
  await sleep(500);
  w(`\n  ${c.gray}log_id:${c.reset}        ${c.cyan}${trustCard.audit.log_id}${c.reset}\n`);
  w(`  ${c.gray}inputs_hash:${c.reset}   ${c.cyan}${trustCard.audit.inputs_hash.slice(0, 32)}…${c.reset}\n`);
  w(`  ${c.gray}generated_at:${c.reset}  ${trustCard.audit.generated_at}\n`);
  await sleep(1500);

  divider("Demo complete");
  w(`\n  ${c.green}Trust Card returned by:${c.reset} ${c.cyan}${invokedTool}${c.reset}\n`);
  w(`  ${c.green}Saved to:${c.reset} ${CAPTURED_PATH}\n\n`);
  await sleep(800);

  writeFileSync(CAPTURED_PATH, JSON.stringify(trustCard, null, 2));

  client.proc.kill();
  setTimeout(() => process.exit(0), 200);
}

main().catch((err) => {
  console.error(`\n${c.red}FAIL:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
