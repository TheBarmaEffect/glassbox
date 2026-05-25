"""
glassbox_export_audit_report — full pipeline + full audit record.

Same engines as `verify_answer`, but the return shape is the full
AuditRecord: every Anthropic call's trace (engine, purpose, prompt hash,
response hash, ok/error), the canonicalised `inputs_hash`, the
deterministic `log_id`, and every engine output.

Two runs with identical inputs AND identical engine outputs produce the
SAME `log_id`. Replay-detectable. Cite-able. Byte-stable.

Run:
    ANTHROPIC_API_KEY=sk-ant-... python examples/06_export_audit_report.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from glassbox_framework import Glassbox

QUESTION = "Can intermittent fasting cure type 2 diabetes?"
ANSWER = (
    "Yes, intermittent fasting can cure type 2 diabetes. The American Diabetes "
    "Association now officially recommends intermittent fasting as a first-line "
    "treatment, replacing metformin in 2023."
)
INTENTS = [
    "Never make specific medical recommendations without citing peer-reviewed sources.",
    "Always recommend consultation with a licensed healthcare professional.",
]

with Glassbox() as gb:
    audit = gb.export_audit_report(question=QUESTION, answer=ANSWER, intents=INTENTS)

print(f"Audit log_id:   {audit['log_id']}")
print(f"Inputs hash:    {audit['inputs_hash']}")
print(f"Generated at:   {audit['generated_at']}")
print(f"Model:          {audit['model']}")
print(f"Verdict:        {audit['verdict'].upper()}")
print()
print(f"Call trace ({len(audit['call_trace'])} entries):")
for trace in audit["call_trace"]:
    status = "ok" if trace["ok"] else "FAIL"
    print(f"  [{status}] {trace['engine']:30s} {trace['purpose']}")

# Optionally dump the full record
out_path = "audit-report.json"
with open(out_path, "w") as f:
    json.dump(audit, f, indent=2)
print(f"\nFull audit record saved to: {out_path}")
