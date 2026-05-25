"""
glassbox-framework — Glass Box Framework runtime constitutional verification.

Six tools that you call like normal Python methods. The client spawns the
Glassbox MCP server as a subprocess and communicates over stdio (JSON-RPC),
so you do not need to manage a separate server process.

Quick start::

    pip install glassbox-framework

::

    from glassbox_framework import Glassbox

    with Glassbox() as gb:
        card = gb.verify_answer(
            question="Can intermittent fasting cure type 2 diabetes?",
            answer="Yes, ...",
            intents=["Never make medical claims without citing peer-reviewed sources."],
        )
        print(card["verdict"])               # "reject" / "caution" / "trust"
        print(card["ecs"]["total"])          # 0.6032
        print(card["audit"]["log_id"])       # glassbox-… (deterministic)

The six tools:

    gb.verify_answer(question, answer, intents=None)
    gb.extract_claims(question, answer)
    gb.score_ecs(claims, red_team=None, constitution=None, weights=None, mode=None)
    gb.red_team(question, answer, claims=None, constitution=None, intents=None)
    gb.generate_trust_card(question, answer, claims, red_team, ecs, constitution=None, intents=None)
    gb.export_audit_report(question, answer, intents=None)

Author: Karthik Barma · MS AI · Northeastern University | Powered by Aura.
"""

from .client import Glassbox, GlassboxError, ToolError

__all__ = ["Glassbox", "GlassboxError", "ToolError"]
__version__ = "1.0.1"
