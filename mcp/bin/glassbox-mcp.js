#!/usr/bin/env node
/**
 * `glassbox-mcp` launcher.
 *
 * Spawns the TypeScript MCP server through ts-node. Used both by:
 *   - `npm install -g @glassbox/mcp` (installs this on $PATH as `glassbox-mcp`)
 *   - Homebrew (`brew install thebarmaeffect/glassbox/glassbox-mcp`)
 *   - The Python client's fallback resolver (`npx -y @glassbox/mcp`)
 *
 * We deliberately keep this a launcher rather than a build artifact so
 * the same source tree runs from a local checkout and a globally
 * installed copy. Cost: requires Node to compile TS on first run.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");

const here = __dirname;
const indexTs = path.resolve(here, "..", "src", "index.ts");

// Resolve the local ts-node binary the npm package shipped with.
const tsNodeBin = require.resolve("ts-node/dist/bin");

const child = spawn(process.execPath, [tsNodeBin, indexTs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`glassbox-mcp launcher failed: ${err.message}\n`);
  process.exit(1);
});
