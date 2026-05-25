"""
glassbox_score_ecs — compute the Epistemic Confidence Score.

Five dimensions, weighted, formula always rendered. You pass prebuilt
claims (and optionally red_team + constitution); the tool runs one
Anthropic call for the coherence check and computes the rest locally.

Run:
    ANTHROPIC_API_KEY=sk-ant-... python examples/03_score_ecs.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
INPUTS_PATH = os.path.join(HERE, "..", "..", "demo", "raw-inputs.json")

from glassbox_framework import Glassbox

with open(INPUTS_PATH) as f:
    inputs = json.load(f)

with Glassbox() as gb:
    ecs = gb.score_ecs(
        claims=inputs["claims"],
        red_team=inputs["red_team"],
        constitution=inputs["constitution"],
    )

print(f"ECS total: {ecs['total']:.4f}  (mode: {ecs['mode']})\n")
print("Dimensions:")
for k, v in ecs["dimensions"].items():
    w = ecs["weights"][k]
    print(f"  {k:30s} {v:.4f}  × w={w:.2f}")
print()
print("Formula:")
for line in ecs["formula"].splitlines():
    print(f"  {line}")
print()
print("Notes:")
for n in ecs["notes"]:
    print(f"  • {n}")
