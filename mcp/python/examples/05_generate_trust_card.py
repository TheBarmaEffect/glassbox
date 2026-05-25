"""
glassbox_generate_trust_card — assemble a Trust Card from prebuilt parts.

This is the one tool in v1 that makes ZERO LLM calls. It runs the
verdict policy + deterministic SHA-256 audit hashing locally, so it
works WITHOUT an ANTHROPIC_API_KEY. Useful for:

  - UI flows that progressively reveal each section
  - Caching pipelines that ran each engine separately
  - This demo (so you can see Glassbox work without a key)

Run:
    python examples/05_generate_trust_card.py
"""

import json
import os
import sys

# Use the bundled healthcare example so this script is self-contained.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))         # for glassbox_framework/ (uninstalled)
INPUTS_PATH = os.path.join(HERE, "..", "..", "demo", "raw-inputs.json")

from glassbox_framework import Glassbox  # noqa: E402

with open(INPUTS_PATH) as f:
    inputs = json.load(f)

print(f"Q: {inputs['question']}\n")

with Glassbox() as gb:
    card = gb.generate_trust_card(
        question=inputs["question"],
        answer=inputs["answer"],
        claims=inputs["claims"],
        red_team=inputs["red_team"],
        ecs=inputs["ecs"],
        constitution=inputs["constitution"],
        intents=inputs["intents"],
    )

# Pretty-print the headline fields.
print(f"Verdict:   {card['verdict'].upper()}")
print(f"Rationale: {card['verdict_rationale']}\n")
print(f"ECS total: {card['ecs']['total']:.4f}")
print(f"  formula: {card['ecs']['formula'].splitlines()[0]}\n")
print(f"Audit log_id: {card['audit']['log_id']}")
print(f"Inputs hash:  {card['audit']['inputs_hash'][:32]}…")
