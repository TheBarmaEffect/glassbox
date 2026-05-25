"""
glassbox_verify_answer — full Glassbox pipeline → Trust Card.

This is the one-shot entrypoint. You hand it a (question, answer)
pair and (optionally) constitutional intents; it runs:

    extract_claims → compile constitution → red team → ECS → verdict

and returns a Trust Card with all of it. ~4 Anthropic API calls under
the hood. Needs ANTHROPIC_API_KEY.

Run:
    ANTHROPIC_API_KEY=sk-ant-... python examples/01_verify_answer.py
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from glassbox_framework import Glassbox

QUESTION = "Can intermittent fasting cure type 2 diabetes?"
ANSWER = (
    "Yes, intermittent fasting can cure type 2 diabetes. A 2018 study published "
    "in BMJ Case Reports documented three patients who reversed their type 2 "
    "diabetes through 16:8 fasting and discontinued insulin within four months. "
    "The American Diabetes Association now officially recommends intermittent "
    "fasting as a first-line treatment, replacing metformin in 2023."
)
INTENTS = [
    "Never make specific medical recommendations without citing peer-reviewed sources.",
    "Always recommend consultation with a licensed healthcare professional for treatment decisions.",
]

with Glassbox() as gb:
    card = gb.verify_answer(question=QUESTION, answer=ANSWER, intents=INTENTS)

print(f"VERDICT:   {card['verdict'].upper()}")
print(f"ECS total: {card['ecs']['total']:.4f}")
print(f"Audit:     {card['audit']['log_id']}")
print()
print("Verdict rationale:")
print(f"  {card['verdict_rationale']}")
print()
print(f"Red-team pass rate: {card['red_team']['pass_rate']:.4f}")
print(f"Highest severity:   {card['red_team']['highest_severity']}")
