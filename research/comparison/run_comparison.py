#!/usr/bin/env python3
"""
Head-to-head comparison orchestrator.

Runs every baseline that needs no third party, merges in the arms that were
produced by separate runners (GlassBox via node, NeMo and Presidio via their
own virtualenvs), and emits:

    comparison_results.jsonl   one record per (system, dataset, item)
    comparison_digest.json     per-system digests, determinism, cost axes

Seeded and deterministic. Timing is excluded from every digest.

Usage:  python3 run_comparison.py [--seed 20260904] [--bootstrap 10000]
"""
import argparse, hashlib, json, pathlib, statistics, time

import lexicons, systems

HERE = pathlib.Path(__file__).parent
BENCH = HERE / ".." / "benchmark"

ap = argparse.ArgumentParser()
ap.add_argument("--seed", type=int, default=20260904)
args = ap.parse_args()

DATASETS = {"dataset": "dataset.jsonl", "heldout": "heldout.jsonl"}
STRATUM_AXIS = {"arith": "arith", "contra": "contra", "cert": "cert",
                "cite": "cite", "inj": "inj", "cmp": "contra", "clean": None}


def load(stem):
    return [json.loads(l) for l in (BENCH / DATASETS[stem]).read_text().splitlines() if l.strip()]


# ---------------------------------------------------------------- cost axes
# run_network / run_key / run_weights describe RUN time, not install time.
# Everything here needs the network once, at install, like any package.
COST = {
    "glassbox_lite":    dict(run_network=False, run_key=False, run_weights=False,
                             install="npm ci && npm run build"),
    "never_flag":       dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "always_flag":      dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "random_p":         dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "keyword_blind":    dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "keyword_informed": dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "length_heuristic": dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "naive_computed":   dict(run_network=False, run_key=False, run_weights=False, install="none"),
    "nemo_injection":   dict(run_network=False, run_key=False, run_weights=False,
                             install="pip install nemoguardrails yara-python"),
    "presidio":         dict(run_network=False, run_key=False, run_weights=True,
                             install="pip install presidio-analyzer spacy + en_core_web_lg (~590MB)"),
}


# ------------------------------------------------------- length param fitting
def fit_length(dev):
    """
    Grid-search the length/numeral-density thresholds on the DEVELOPMENT split
    only, maximising any-flag F1. The winning pair is then applied unchanged to
    held-out. Deterministic: ties break on the smallest (words, density).
    """
    best = None
    for lw in range(10, 65, 5):
        for dens10k in range(200, 2100, 200):
            cfg = {"len_words": lw, "numeral_density": dens10k / 10000.0}
            tp = fp = fn = 0
            for it in dev:
                pred = bool(systems.sys_length(it, cfg))
                if it["should_flag"] and pred: tp += 1
                elif it["should_flag"]: fn += 1
                elif pred: fp += 1
            f1 = (2 * tp / (2 * tp + fp + fn)) if tp else 0.0
            key = (-f1, lw, dens10k)
            if best is None or key < best[0]:
                best = (key, cfg)
    return best[1]


dev_items = load("dataset")
LEN_CFG = fit_length(dev_items)

# ------------------------------------------------------------------ registry
kw_blind = systems.make_keyword(lexicons.BLIND)
kw_informed = systems.make_keyword(lexicons.INFORMED)

INTERNAL = {
    "never_flag": (systems.sys_never, {}),
    "always_flag": (systems.sys_always, {}),
    "keyword_blind": (kw_blind, {}),
    "keyword_informed": (kw_informed, {}),
    "naive_computed": (systems.sys_computed, {}),
    "length_heuristic": (systems.sys_length, LEN_CFG),
}

EXTERNAL = {
    "glassbox_lite": "glassbox_{stem}.jsonl",
    "nemo_injection": "thirdparty_nemo_injection_{stem}.jsonl",
    "presidio": "thirdparty_presidio_{stem}.jsonl",
}


def run_internal(name, fn, cfg, items):
    rows = []
    for it in items:
        t0 = time.perf_counter()
        fired = fn(it, cfg)
        t1 = time.perf_counter()
        rows.append({"id": it["id"], "fired_axes": sorted(fired),
                     "ms": (t1 - t0) * 1000.0, "any": bool(fired)})
    return rows


records, digest_info = [], {}
missing = []

for stem in DATASETS:
    items = load(stem)
    by_id = {it["id"]: it for it in items}

    # random uses the OBSERVED positive rate of this split.
    rate = sum(1 for it in items if it["should_flag"]) / len(items)
    per_system = dict(INTERNAL)
    per_system["random_p"] = (systems.sys_random, {"seed": args.seed, "rate": rate})

    arms = {}
    for name, (fn, cfg) in per_system.items():
        arms[name] = run_internal(name, fn, cfg, items)

    for name, pat in EXTERNAL.items():
        p = HERE / pat.format(stem=stem)
        if not p.exists():
            missing.append(str(p.name))
            continue
        ext = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        arms[name] = [{
            "id": r["id"], "fired_axes": r.get("fired_axes", []), "ms": r.get("ms", 0.0),
            # any-flag = did this system raise ANY alarm, including channels
            # outside the five comparison axes.
            "any": bool(r.get("all_flagged") or r.get("detections") or r.get("fired_axes")),
        } for r in ext]

    for name, rows in arms.items():
        for r in rows:
            it = by_id[r["id"]]
            axis = STRATUM_AXIS.get(it["stratum"])
            records.append({
                "system": name, "dataset": stem, "id": it["id"],
                "stratum": it["stratum"], "target_probe": it.get("target_probe"),
                "should_flag": it["should_flag"], "in_scope": it["in_scope"],
                "fired_axes": r["fired_axes"],
                # Protocol A: consult only the axis this item targets.
                "flag_aligned": (axis in r["fired_axes"]) if axis else None,
                # Protocol B: did the system raise any alarm at all.
                "flag_any": bool(r["any"]),
                "ms": round(r["ms"], 6),
            })

        stripped = [{k: v for k, v in r.items() if k != "ms"} for r in rows]
        blob = json.dumps(stripped, sort_keys=True)
        times = [r["ms"] for r in rows]
        digest_info.setdefault(name, {})[stem] = {
            "digest": hashlib.sha256(blob.encode()).hexdigest(),
            "n": len(rows),
            "ms_mean": round(statistics.mean(times), 4),
            "ms_median": round(statistics.median(times), 4),
            "ms_p95": round(sorted(times)[int(0.95 * (len(times) - 1))], 4),
        }

records.sort(key=lambda r: (r["system"], r["dataset"], r["id"]))
(HERE / "comparison_results.jsonl").write_text(
    "\n".join(json.dumps(r) for r in records) + "\n")

# Fold in the determinism verdicts produced by the external runners.
ext_det = {}
for f in sorted(HERE.glob("*determinism*.json")):
    ext_det[f.name] = json.loads(f.read_text())

(HERE / "comparison_digest.json").write_text(json.dumps({
    "seed": args.seed,
    "length_params_fitted_on_development_split": LEN_CFG,
    "lexicon_sizes": {k: {a: len(v) for a, v in d.items()} for k, d in
                      (("blind", lexicons.BLIND), ("informed", lexicons.INFORMED))},
    "systems": digest_info,
    "cost_axes": COST,
    "external_determinism": ext_det,
    "missing_external_arms": missing,
}, indent=2, sort_keys=True) + "\n")

print(f"records={len(records)} systems={len(digest_info)}")
print(f"length params fitted on development split: {LEN_CFG}")
if missing:
    print("MISSING external arms:", missing)
