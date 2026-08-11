import assert from "node:assert/strict";
import test from "node:test";
import { formatPlainTrustCard, formatSlackTrustCard, formatTrustCard } from "../src/formatter.js";
import type { TrustCard } from "../src/types.js";

const card: TrustCard = {
  question: "q",
  answer: "a",
  verdict: "caution",
  verdict_rationale: "One medium-risk adversarial probe failed.",
  ecs: {
    total: 0.63,
    dimensions: { groundedness: 0.8, coherence: 0.7, calibration: 0.4 },
    notes: [],
  },
  claims: [{
    id: "c-0",
    text: "A claim",
    reasoning: "A reason",
    confidence: 0.8,
    supporting_evidence: [],
    attack_surface: [],
    status: "assumed",
  }],
  red_team: {
    probes: [{
      angle: "overconfidence",
      passed: false,
      severity: "medium",
      finding: "The answer uses certainty without matching evidence.",
      evidence: [],
    }],
    pass_rate: 6 / 7,
    highest_severity: "medium",
  },
  constitution: { rules: [] },
  audit: { log_id: "glassbox-test", generated_at: "now", inputs_hash: "hash" },
};

test("renders a compact platform-safe Trust Card", () => {
  const output = formatTrustCard(card, 700);
  assert.match(output, /CAUTION/);
  assert.match(output, /overconfidence/);
  assert.match(output, /not a fact-check/);
  assert.ok(output.length <= 700);
});

test("neutralizes model-produced markup, links, and mentions", () => {
  const hostile: TrustCard = {
    ...card,
    verdict_rationale: "# Alert [click me](https://evil.example) @everyone \u202Etxt.exe",
    red_team: {
      ...card.red_team,
      probes: [{
        ...card.red_team.probes[0]!,
        finding: "> quoted **admin** at www.evil.example and u/target",
      }],
    },
  };
  const output = formatTrustCard(hostile, 1_900);
  for (const rendered of [output, formatPlainTrustCard(hostile), formatSlackTrustCard(hostile)]) {
    assert.doesNotMatch(rendered, /\]\(https?:\/\//);
    assert.doesNotMatch(rendered, /@everyone/);
    assert.doesNotMatch(rendered, /u\/target/);
    assert.doesNotMatch(rendered, /\n> quoted/);
    assert.doesNotMatch(rendered, /\u202E/);
  }
});
