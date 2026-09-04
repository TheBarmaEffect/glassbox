#!/usr/bin/env node
/**
 * Keep the Node version the gateway is *built* with, *tested* with, and *run* with from
 * drifting apart — and make a local mismatch visible instead of silent.
 *
 * The failure this addresses: CI runs Node 20, developers run Node 26. A test that raced
 * an unref'd timer against a bare promise was cancelled on Node 20 and passed on Node 26,
 * so the failure could not be reproduced locally and was blamed on CI for hours. Verified
 * again while writing this: the same construction reports `cancelled 3` on Node 20 and
 * hangs indefinitely on Node 26.
 *
 * Three facts have to agree, and all three are in this repository:
 *
 *   .nvmrc                        what a developer gets from `nvm use`
 *   platforms/Dockerfile          the runtime the deployed image actually is
 *   platforms/package.json        the range the package claims to support
 *
 * CI is deliberately *not* a fourth fact: the workflow reads `.nvmrc` via
 * `node-version-file`, so it cannot disagree with it. That is the point — a version can
 * only be changed in one place.
 *
 * Hard failures are limited to those repository facts, which are deterministic. The
 * running interpreter differing from `.nvmrc` is reported as a warning, because
 * developing on a newer Node is reasonable; what is not reasonable is not knowing.
 *
 * Usage: node scripts/node-version-check.mjs [--repo-root=..]
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const rootFlag = argv.find((arg) => arg.startsWith("--repo-root="));
// Default assumes this file is at <repo>/platforms/scripts/.
const repoRoot = path.resolve(
  rootFlag ? rootFlag.slice("--repo-root=".length) : path.join(import.meta.dirname, "..", ".."),
);

const problems = [];
const warnings = [];

function readIfPresent(relative) {
  const full = path.join(repoRoot, relative);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// --- .nvmrc ----------------------------------------------------------------------------

const nvmrcRaw = readIfPresent(".nvmrc");
if (nvmrcRaw === null) {
  problems.push(
    ".nvmrc is missing at the repository root. It is what makes `nvm use` give a " +
    "developer the same Node the gateway is built and deployed with; without it the " +
    "Node-version class of failure is unreproducible locally by construction.",
  );
}
const nvmrcVersion = (nvmrcRaw ?? "").trim().replace(/^v/, "");
const nvmrcMajor = Number(nvmrcVersion.split(".")[0]);
if (nvmrcRaw !== null && !Number.isInteger(nvmrcMajor)) {
  problems.push(`.nvmrc does not contain a Node version: ${JSON.stringify(nvmrcRaw)}`);
}

// --- the Dockerfile the deployed image is built from -----------------------------------

const dockerfile = readIfPresent("platforms/Dockerfile");
let dockerMajors = [];
if (dockerfile === null) {
  problems.push("platforms/Dockerfile is missing, so the deployed runtime cannot be checked.");
} else {
  const matches = [...dockerfile.matchAll(/^\s*FROM\s+node:(\d+)[^\s]*/gim)];
  if (matches.length === 0) {
    problems.push(
      "no `FROM node:<major>` line was found in platforms/Dockerfile, so this check " +
      "cannot confirm the deployed runtime. Do not weaken the check to make it pass — " +
      "if the base image moved, point this at the new one.",
    );
  }
  dockerMajors = [...new Set(matches.map((match) => Number(match[1])))];
  if (dockerMajors.length > 1) {
    problems.push(
      `platforms/Dockerfile builds with more than one Node major (${dockerMajors.join(", ")}). ` +
      "The build stage and the runtime stage must be the same major, or the image runs " +
      "code compiled against a different standard library than it was tested against.",
    );
  }
  if (Number.isInteger(nvmrcMajor) && dockerMajors.length === 1 && dockerMajors[0] !== nvmrcMajor) {
    problems.push(
      `.nvmrc says Node ${nvmrcMajor} but platforms/Dockerfile builds and runs the ` +
      `deployed image on Node ${dockerMajors[0]}. CI reads .nvmrc, so CI is testing a ` +
      "Node the deployed image is not. This is exactly the mismatch class that cost a " +
      "day: change both, in the same commit, or neither.",
    );
  }
}

// --- every Node project's declared range -----------------------------------------------

const PROJECTS = [
  "platforms",
  "platforms/devvit",
  "platforms/ide/vscode-glassbox",
  "browser-extension",
  "notion-integration",
  "mcp",
];

/**
 * Deliberately narrow: only `>=N`, `>=N.N.N` and `^N` style ranges are understood. An
 * unrecognised range is reported rather than assumed to be satisfied, because a check
 * that quietly passes on input it does not understand is not a check.
 */
function minimumMajor(range) {
  const match = /^\s*(?:>=|\^|~)?\s*v?(\d+)/.exec(range ?? "");
  return match ? Number(match[1]) : null;
}

const rows = [];
for (const project of PROJECTS) {
  const raw = readIfPresent(path.join(project, "package.json"));
  if (raw === null) continue;
  let engines;
  try {
    engines = JSON.parse(raw).engines ?? {};
  } catch {
    problems.push(`${project}/package.json is not valid JSON.`);
    continue;
  }
  rows.push({ project, node: engines.node ?? "(unset)" });
}

const gatewayRange = rows.find((row) => row.project === "platforms")?.node;
if (!gatewayRange || gatewayRange === "(unset)") {
  problems.push(
    "platforms/package.json declares no engines.node. The deployed service should say " +
    "which Node it supports, so that installing it on the wrong one is an error rather " +
    "than a surprise at runtime.",
  );
} else {
  const floor = minimumMajor(gatewayRange);
  if (floor === null) {
    problems.push(
      `platforms/package.json engines.node is ${JSON.stringify(gatewayRange)}, which this ` +
      "check does not understand. Widen the parser deliberately rather than leaving the " +
      "range unchecked.",
    );
  } else if (Number.isInteger(nvmrcMajor) && nvmrcMajor < floor) {
    problems.push(
      `.nvmrc pins Node ${nvmrcMajor} but platforms/package.json requires ${gatewayRange}. ` +
      "CI would install a Node the package itself declares unsupported.",
    );
  }
}

// --- the interpreter actually running --------------------------------------------------

const runningMajor = Number(process.versions.node.split(".")[0]);
if (Number.isInteger(nvmrcMajor) && runningMajor !== nvmrcMajor) {
  warnings.push(
    `this Node is v${process.versions.node}; .nvmrc pins ${nvmrcMajor}. Test behaviour ` +
    "differs between these: a promise that never settles is reported as a cancelled test " +
    "on Node 20 and hangs on Node 26. Run `nvm use` in the repository root before " +
    "concluding that a CI-only failure is a CI problem.",
  );
}

// --- report ----------------------------------------------------------------------------

console.log("Node version alignment");
console.log(`  .nvmrc (developers + CI)      ${nvmrcVersion || "MISSING"}`);
console.log(`  platforms/Dockerfile          ${dockerMajors.length ? dockerMajors.join(", ") : "UNKNOWN"}`);
console.log(`  running interpreter           ${process.versions.node}`);
console.log("  declared engines.node:");
for (const row of rows) console.log(`    ${row.project.padEnd(30)} ${row.node}`);

for (const warning of warnings) console.log(`::warning::node version: ${warning}`);

if (problems.length > 0) {
  console.error("");
  for (const problem of problems) console.error(`::error::node version: ${problem}`);
  process.exit(1);
}
console.log("\nnode version check: OK");
