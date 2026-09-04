#!/usr/bin/env python3
"""
Third-party arms of the comparison. Each runs in its own virtualenv because
the dependency sets conflict; see COMPARISON_RESULTS.md REPRODUCE.

  --system nemo_injection   NeMo Guardrails `injection_detection` rail (YARA,
                            fully offline). NOTE: this rail targets CODE
                            injection (SQLi/XSS/template/code), not prompt
                            injection. Running it against the `inj` stratum is
                            OFF-LABEL and is reported as such.
  --system presidio         Microsoft Presidio analyzer (spaCy, fully offline).
                            Targets PII/credentials. GBSA-1 has no PII stratum,
                            so presidio has no positives to find here; it is
                            measured for false-positive load and wall-clock.

Emits thirdparty_<system>_<stem>.jsonl with the same record shape as the
GlassBox arm, plus raw detections.
"""
import argparse, json, pathlib, sys, time

HERE = pathlib.Path(__file__).parent
BENCH = HERE / ".." / "benchmark"

ap = argparse.ArgumentParser()
ap.add_argument("--system", required=True)
ap.add_argument("--dataset", default="heldout.jsonl")
ap.add_argument("--repeat", type=int, default=2)
args = ap.parse_args()

items = [json.loads(l) for l in (BENCH / args.dataset).read_text().splitlines() if l.strip()]


def build_nemo():
    import asyncio
    from nemoguardrails import RailsConfig
    from nemoguardrails.library.injection_detection.actions import injection_detection
    cfg = RailsConfig.from_content(yaml_content="""
models: []
rails:
  config:
    injection_detection:
      injections: [code, sqli, xss, template]
      action: reject
""")
    loop = asyncio.new_event_loop()

    def predict(item):
        out = loop.run_until_complete(
            injection_detection(text=item["answer"], config=cfg))
        meta = out.metadata or {}
        hit = bool(meta.get("is_injection"))
        dets = sorted(meta.get("detections") or [])
        # Off-label mapping: the only offline NeMo rail is mapped to the
        # nearest GBSA-1 axis so it can be scored at all.
        return ({"inj"} if hit else set()), dets

    return predict


def build_presidio():
    from presidio_analyzer import AnalyzerEngine
    engine = AnalyzerEngine()

    def predict(item):
        res = engine.analyze(text=item["answer"], language="en")
        dets = sorted({r.entity_type for r in res})
        # Presidio detects PII. No GBSA-1 axis corresponds to PII, so it
        # contributes no axis firings; `dets` carries what it actually found.
        return set(), dets

    return predict


BUILDERS = {"nemo_injection": build_nemo, "presidio": build_presidio}
if args.system not in BUILDERS:
    sys.exit(f"unknown system {args.system}")

t_load0 = time.perf_counter()
predict = BUILDERS[args.system]()
load_s = time.perf_counter() - t_load0


def run_all():
    rows = []
    for it in items:
        t0 = time.perf_counter()
        fired, dets = predict(it)
        t1 = time.perf_counter()
        rows.append({"id": it["id"], "fired_axes": sorted(fired),
                     "detections": dets, "ms": (t1 - t0) * 1000.0})
    return rows


import hashlib
def digest(rows):
    stripped = [{k: v for k, v in r.items() if k != "ms"} for r in rows]
    return hashlib.sha256(json.dumps(stripped, sort_keys=True).encode()).hexdigest()

digs, first = [], None
for i in range(args.repeat):
    rows = run_all()
    digs.append(digest(rows))
    if i == 0:
        first = rows
identical = len(set(digs)) == 1

stem = args.dataset.replace(".jsonl", "")
(HERE / f"thirdparty_{args.system}_{stem}.jsonl").write_text(
    "\n".join(json.dumps(r) for r in first) + "\n")
(HERE / f"thirdparty_{args.system}_{stem}_determinism.json").write_text(
    json.dumps({"system": args.system, "dataset": args.dataset,
                "repeats": args.repeat, "identical": identical,
                "digests": digs, "load_seconds": round(load_s, 3)},
               indent=2) + "\n")
print(f"{args.system} {args.dataset}: items={len(first)} repeats={args.repeat} "
      f"deterministic={identical} load={load_s:.2f}s digest={digs[0][:16]}")
