#!/usr/bin/env python3
"""
Score the head-to-head comparison.

Two protocols, reported separately because they answer different questions.

  ALIGNED (Protocol A)  For each item, consult only the channel corresponding
                        to the failure mode that item targets. This is the
                        convention benchmark/score.py uses for GlassBox. It
                        requires an oracle that already knows which probe is
                        relevant, so it is an upper bound and is NOT deployable.
                        Clean controls are excluded, exactly as score.py does.

  ANY-FLAG (Protocol B) Did the system raise ANY alarm on this answer? No
                        oracle. Clean controls included. This is what a user
                        actually experiences, and it is the only protocol under
                        which systems with different channel inventories can be
                        compared at all.

95% intervals are seeded percentile bootstrap over items (default 10,000
resamples), not Wilson, because under Protocol B the unit of resampling is the
item rather than a single binomial count.

Usage: python3 score_comparison.py [--dataset heldout] [--bootstrap 10000]
"""
import argparse, json, math, pathlib, random
from collections import defaultdict

HERE = pathlib.Path(__file__).parent
ap = argparse.ArgumentParser()
ap.add_argument("--dataset", default="heldout")
ap.add_argument("--bootstrap", type=int, default=10000)
ap.add_argument("--seed", type=int, default=20260904)
ap.add_argument("--json-out", default=None)
args = ap.parse_args()

rows = [json.loads(l) for l in (HERE / "comparison_results.jsonl").read_text().splitlines() if l.strip()]
rows = [r for r in rows if r["dataset"] == args.dataset]
digest = json.loads((HERE / "comparison_digest.json").read_text())

SYSTEMS = ["glassbox_lite", "keyword_informed", "keyword_blind", "naive_computed",
           "nemo_injection", "presidio", "length_heuristic", "random_p",
           "always_flag", "never_flag"]
AXES = ["arith", "contra", "cert", "cite", "inj"]


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else float("nan")
    r = tp / (tp + fn) if tp + fn else float("nan")
    f = 2 * p * r / (p + r) if tp and (p + r) else (0.0 if tp + fp + fn else float("nan"))
    return p, r, f


def counts(sel, key):
    tp = sum(1 for r in sel if r["should_flag"] and r[key])
    fn = sum(1 for r in sel if r["should_flag"] and not r[key])
    fp = sum(1 for r in sel if not r["should_flag"] and r[key])
    tn = sum(1 for r in sel if not r["should_flag"] and not r[key])
    return tp, fp, fn, tn


def boot_ci(sel, key, stat_idx):
    """Seeded percentile bootstrap over items."""
    if not sel:
        return (float("nan"), float("nan"))
    rng = random.Random(args.seed)
    n, vals = len(sel), []
    for _ in range(args.bootstrap):
        samp = [sel[rng.randrange(n)] for _ in range(n)]
        tp, fp, fn, _ = counts(samp, key)
        v = prf(tp, fp, fn)[stat_idx]
        if not math.isnan(v):
            vals.append(v)
    if not vals:
        return (float("nan"), float("nan"))
    vals.sort()
    return (vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))])


def fmt(x):
    return " n/a " if isinstance(x, float) and math.isnan(x) else f"{x:.3f}"


by_sys = defaultdict(list)
for r in rows:
    by_sys[r["system"]].append(r)

out = {"dataset": args.dataset, "bootstrap": args.bootstrap, "seed": args.seed,
       "protocols": {}}

# ------------------------------------------------------------- Protocol A
print(f"\n{'='*100}\nPROTOCOL A — ALIGNED (oracle-routed, clean controls excluded)   dataset={args.dataset}\n{'='*100}")
print(f"{'system':<18}{'TP':>4}{'FP':>4}{'FN':>4}{'TN':>4}{'  prec':>8}{'   rec':>8}{'    F1':>8}   F1 95% CI (bootstrap)")
protoA = {}
for s in SYSTEMS:
    sel = [r for r in by_sys[s] if r["flag_aligned"] is not None]
    if not sel:
        continue
    tp, fp, fn, tn = counts(sel, "flag_aligned")
    p, r_, f = prf(tp, fp, fn)
    lo, hi = boot_ci(sel, "flag_aligned", 2)
    ci = "  n/a" if math.isnan(lo) else f"[{lo:.3f}, {hi:.3f}]"
    print(f"{s:<18}{tp:>4}{fp:>4}{fn:>4}{tn:>4}{fmt(p):>8}{fmt(r_):>8}{fmt(f):>8}   {ci}")
    protoA[s] = dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=p, recall=r_, f1=f, f1_ci=[lo, hi])
out["protocols"]["aligned"] = protoA

# -------------------------------------------------- Protocol A, per axis
print(f"\n--- Protocol A, per axis (recall; precision in parentheses) ---")
hdr = f"{'system':<18}" + "".join(f"{a:>17}" for a in AXES)
print(hdr)
peraxis = defaultdict(dict)
for s in SYSTEMS:
    if not by_sys[s]:
        continue
    cells = []
    for a in AXES:
        sel = [r for r in by_sys[s] if r["flag_aligned"] is not None
               and r["stratum"] == ("cmp" if False else a)]
        if not sel:
            cells.append(f"{'-':>17}")
            continue
        tp, fp, fn, tn = counts(sel, "flag_aligned")
        p, r_, f = prf(tp, fp, fn)
        peraxis[s][a] = dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=p, recall=r_, f1=f)
        cells.append(f"{fmt(r_)} ({fmt(p)})".rjust(17))
    print(f"{s:<18}" + "".join(cells))
out["per_axis_aligned"] = peraxis

# ------------------------------------------------------------- Protocol B
print(f"\n{'='*100}\nPROTOCOL B — ANY-FLAG (deployment-realistic, clean controls INCLUDED)\n{'='*100}")
print(f"{'system':<18}{'TP':>4}{'FP':>4}{'FN':>4}{'TN':>4}{'  prec':>8}{'   rec':>8}{'    F1':>8}   F1 95% CI (bootstrap)")
protoB = {}
for s in SYSTEMS:
    sel = by_sys[s]
    if not sel:
        continue
    tp, fp, fn, tn = counts(sel, "flag_any")
    p, r_, f = prf(tp, fp, fn)
    lo, hi = boot_ci(sel, "flag_any", 2)
    ci = "  n/a" if math.isnan(lo) else f"[{lo:.3f}, {hi:.3f}]"
    print(f"{s:<18}{tp:>4}{fp:>4}{fn:>4}{tn:>4}{fmt(p):>8}{fmt(r_):>8}{fmt(f):>8}   {ci}")
    protoB[s] = dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=p, recall=r_, f1=f, f1_ci=[lo, hi])
out["protocols"]["any_flag"] = protoB

# ---------------------------------------------------- clean-control FPs
print(f"\n--- False positives on benign clean controls (Protocol B) ---")
clean_stats = {}
for s in SYSTEMS:
    sel = [r for r in by_sys[s] if r["stratum"] == "clean"]
    if not sel:
        continue
    fp = sum(1 for r in sel if r["flag_any"])
    clean_stats[s] = {"fp": fp, "n": len(sel)}
    print(f"  {s:<18} {fp}/{len(sel)}")
out["clean_controls"] = clean_stats

# ------------------------------------------------------------ cost axes
print(f"\n{'='*100}\nCOST AXES\n{'='*100}")
print(f"{'system':<18}{'net':>6}{'key':>6}{'wts':>6}{'ms/item':>10}{'p95 ms':>10}  deterministic")
cost_rows = {}
for s in SYSTEMS:
    c = digest["cost_axes"].get(s)
    d = digest["systems"].get(s, {}).get(args.dataset)
    if not c or not d:
        continue
    det = "yes"
    for fn_, dd in digest["external_determinism"].items():
        if s in fn_ and args.dataset in fn_:
            det = "yes" if dd.get("identical") else "NO"
    cost_rows[s] = dict(**c, ms_mean=d["ms_mean"], ms_p95=d["ms_p95"], deterministic=det)
    print(f"{s:<18}{'yes' if c['run_network'] else 'no':>6}"
          f"{'yes' if c['run_key'] else 'no':>6}"
          f"{'yes' if c['run_weights'] else 'no':>6}"
          f"{d['ms_mean']:>10.4f}{d['ms_p95']:>10.4f}  {det}")
out["cost_axes"] = cost_rows

if args.json_out:
    (HERE / args.json_out).write_text(json.dumps(out, indent=2, default=str) + "\n")
    print(f"\nwrote {args.json_out}")
