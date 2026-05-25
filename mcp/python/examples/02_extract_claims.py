"""
glassbox_extract_claims — atomic claims with reasoning chains.

Splits the answer into atomic factual/evaluative claims. Every claim
carries a non-empty reasoning chain explaining why it's asserted, what
would support it, and what would falsify it.

The reasoning chain is the core Glassbox principle: no opaque scores.

Run:
    ANTHROPIC_API_KEY=sk-ant-... python examples/02_extract_claims.py
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

with Glassbox() as gb:
    result = gb.extract_claims(question=QUESTION, answer=ANSWER)

print(f"Extracted {len(result['claims'])} claims:\n")
for c in result["claims"]:
    print(f"  {c['id']} [{c['status']}, conf={c['confidence']:.2f}]")
    print(f"    Claim:     {c['text']}")
    print(f"    Reasoning: {c['reasoning'][:160]}…")
    print()
