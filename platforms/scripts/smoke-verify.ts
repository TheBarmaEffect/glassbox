import "dotenv/config";
import { GlassboxMcpVerifier } from "../src/glassbox.js";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("Set ANTHROPIC_API_KEY before running the live verification canary.");
}

const verifier = new GlassboxMcpVerifier();
try {
  const card = await verifier.verify({
    platform: "api",
    question: "Why does ice float on liquid water?",
    answer: "Ice floats because its crystalline structure makes it less dense than liquid water.",
  });
  console.log(`Live GlassBox canary passed: ${card.verdict} · ${card.audit.log_id}`);
} finally {
  await verifier.close();
}
