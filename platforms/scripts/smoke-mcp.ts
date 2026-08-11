import { GlassboxMcpVerifier } from "../src/glassbox.js";

const verifier = new GlassboxMcpVerifier();
try {
  if (!await verifier.ready()) throw new Error("glassbox_verify_answer was not registered.");
  console.log("GlassBox MCP launcher is ready and glassbox_verify_answer is registered.");
} finally {
  await verifier.close();
}
