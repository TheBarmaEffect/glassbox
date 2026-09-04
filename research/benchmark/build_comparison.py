#!/usr/bin/env python3
"""
GBSA-1 comparison stratum, added 2026-08-20.

Added because three external users hit a false-positive class on their first
real inputs that the original 187 items could not produce. The original
temporal control distinguished its claims by a word ("last quarter") and so
avoided the defect it was meant to probe.

Positives are genuine self-contradictions about ONE entity.
Negatives are comparisons or before/after statements about TWO entities, which
must not be flagged however similar their surface form.
"""
import json, pathlib

items = []
def add(answer, should_flag, note):
    items.append({"id": f"cmp-{len(items)+1:03d}", "stratum": "cmp",
                  "question": "Compare the two options.", "answer": answer,
                  "target_probe": "internal_contradiction",
                  "should_flag": should_flag, "in_scope": True, "note": note})

# Negatives: two distinct entities, numerically distinguished. Must not flag.
for a in [
 "The M4 Air has 16GB RAM. The M5 Air has 24GB RAM.",
 "The M4 chip has 10 cores. The M5 chip has 12 cores.",
 "Version 1 used 300 MB. Version 2 used 120 MB.",
 "Latency was 300 ms in v1. Latency is 120 ms in v2.",
 "In 2024 the figure was 12 percent. In 2025 the figure was 30 percent.",
 "The 2023 model shipped 4 ports. The 2025 model shipped 2 ports.",
 "Python 3.11 took 90 seconds. Python 3.13 took 45 seconds.",
 "Tier 1 allows 10 requests. Tier 2 allows 100 requests.",
]: add(a, False, "numerically distinguished entities, comparison not contradiction")

# Negatives: two distinct entities, lexically distinguished. Must not flag.
for a in [
 "The base model costs 80000 rupees. The upgraded model costs 120000 rupees.",
 "Plan A allows 5 requests. Plan B allows 50 requests.",
 "The free tier gives 100 audits. The paid tier gives 5000 audits.",
 "The old server had 4 cores. The new server has 16 cores.",
 "Team A delivered 20 features. Team B delivered 35 features.",
 "The small model has 7 billion parameters. The large model has 70 billion parameters.",
]: add(a, False, "lexically distinguished entities, comparison not contradiction")

# Positives: one entity, conflicting values. Must flag.
for a in [
 "The timeout is 30 seconds. The timeout is 90 seconds.",
 "The cluster has 12 nodes. The cluster has 30 nodes.",
 "The error rate is 2 percent. The error rate is 11 percent.",
 "There are 500 users. There are 900 users.",
 "The M4 has 8 cores. The M4 has 10 cores.",
 "Version 2 used 300 MB. Version 2 used 120 MB.",
 "The quota is 40 requests. The quota is 75 requests.",
]: add(a, True, "single entity, conflicting values, genuine contradiction")

out = pathlib.Path(__file__).parent / "comparison.jsonl"
out.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
pos = sum(1 for i in items if i["should_flag"])
print(f"total={len(items)}  positives={pos}  negatives={len(items)-pos}")
