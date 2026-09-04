#!/usr/bin/env python3
"""
Score GlassBox Lite's external-benchmark runs as a *discrimination* problem.

GlassBox has no knowledge base and never asserts that a statement is false, so the
question asked here is not "did it catch the hallucination". It is: does the score the
gateway already emits separate answers a third party labelled hallucinated from answers
the same third party labelled correct?

Everything is stdlib. AUROC uses midranks, because the ECS is coarse and the tie mass is
large enough that a tie-blind estimator would be wrong rather than merely imprecise.
Intervals are cluster bootstraps over the question, not over the item, because the two
answers to one question are not independent observations.

Usage:  python3 score_external.py [--datasets a,b,c] [--resamples N]
Output: results/SUMMARY.json, and a printed report.
"""
import argparse
import json
import math
import pathlib
import random
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
RESULTS = HERE / "results"
SEED = 20260904
DATASETS = ["halueval_qa", "halueval_dialogue", "halueval_general", "truthfulqa"]

# The scalar the deployed gateway actually emits. Higher ECS is a healthier answer, so the
# risk score is its complement and AUROC is read as "P(hallucinated ranks riskier)".
def risk(row): return 1.0 - row["ecs"]
# Two reference scores, computed from the same result rows.
def length_only(row): return float(row["answer_chars"])
def probe_count(row): return float(row["failed_probes"])

VERDICT_RISK = {"trust": 0.0, "caution": 1.0, "reject": 2.0}
def verdict_ordinal(row): return VERDICT_RISK[row["verdict"]]

SCORES = {
    "ecs_risk": risk,
    "failed_probe_count": probe_count,
    "verdict_ordinal": verdict_ordinal,
    "answer_length_baseline": length_only,
}


def auroc(labels, scores):
    """Tie-aware AUROC via the Mann-Whitney statistic on midranks.

    With a coarse score most comparisons are ties, and a tie contributes exactly 0.5.
    Returns None when one class is empty or the score is constant, because an AUROC is
    undefined in both cases and reporting 0.5 there would be an invented number.
    """
    pos = [s for l, s in zip(labels, scores) if l == 1]
    neg = [s for l, s in zip(labels, scores) if l == 0]
    if not pos or not neg:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        mid = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = mid
        i = j + 1
    rank_sum = sum(r for r, l in zip(ranks, labels) if l == 1)
    return (rank_sum - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def average_precision(labels, scores):
    """Average precision with tied scores collapsed into one threshold step.

    Ranking within a tied block is arbitrary, so scoring it as if it were ordered would
    credit the detector for an ordering it did not produce.
    """
    pos_total = sum(labels)
    if pos_total == 0 or pos_total == len(labels):
        return None
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    ap, tp, seen, i = 0.0, 0, 0, 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        block = order[i:j + 1]
        block_pos = sum(labels[k] for k in block)
        tp += block_pos
        seen += len(block)
        if block_pos:
            ap += (tp / seen) * block_pos
        i = j + 1
    return ap / pos_total


def tie_rate(labels, scores):
    """Fraction of cross-class comparisons that are exact ties. This is the ceiling on how
    much any threshold can do with the score, and it is the headline property of a coarse
    detector."""
    pos = Counter(s for l, s in zip(labels, scores) if l == 1)
    neg = Counter(s for l, s in zip(labels, scores) if l == 0)
    npos, nneg = sum(pos.values()), sum(neg.values())
    if not npos or not nneg:
        return None
    return sum(pos[v] * neg[v] for v in pos if v in neg) / (npos * nneg)


def cluster_bootstrap(rows, fn, resamples, seed=SEED):
    """Percentile CI, resampling *questions* with replacement.

    Resampling items instead would treat the correct and hallucinated answer to the same
    question as independent draws and shrink the interval below what the data supports.
    """
    by_cluster = defaultdict(list)
    for row in rows:
        by_cluster[row["pair_id"]].append(row)
    clusters = list(by_cluster.values())
    rng = random.Random(seed)
    draws = []
    for _ in range(resamples):
        sample = []
        for _ in range(len(clusters)):
            sample.extend(clusters[rng.randrange(len(clusters))])
        value = fn(sample)
        if value is not None:
            draws.append(value)
    if len(draws) < resamples * 0.5:
        return None, None
    draws.sort()
    return draws[int(0.025 * len(draws))], draws[min(len(draws) - 1, int(0.975 * len(draws)))]


def binom_two_sided(k, n):
    """Exact two-sided binomial test against p=0.5, by summing every outcome at most as
    likely as the observed one. Exact rather than normal-approximate because the tie mass
    can leave n small on some splits."""
    if n == 0:
        return 1.0
    obs = math.comb(n, k)
    total = sum(math.comb(n, i) for i in range(n + 1) if math.comb(n, i) <= obs)
    return min(1.0, total / (2 ** n))


def wilson(k, n, z=1.96):
    if n == 0:
        return None, None
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - half), min(1.0, centre + half)


def paired_sign_test(rows, score_fn):
    """For each question, does the hallucinated answer score riskier than its own correct
    counterpart? This is the strongest framing available: both members share a topic, a
    domain and a question, so anything the comparison picks up is a property of the two
    answers rather than of the subject matter."""
    by_pair = defaultdict(dict)
    for row in rows:
        by_pair[row["pair_id"]][row["label"]] = row
    wins = losses = ties = 0
    for pair in by_pair.values():
        if 0 not in pair or 1 not in pair:
            continue
        hi, lo = score_fn(pair[1]), score_fn(pair[0])
        if hi > lo:
            wins += 1
        elif hi < lo:
            losses += 1
        else:
            ties += 1
    decided = wins + losses
    lo_ci, hi_ci = wilson(wins, decided)
    return {
        "pairs": wins + losses + ties,
        "hallucinated_riskier": wins,
        "correct_riskier": losses,
        "tied": ties,
        "tie_fraction": round(ties / (wins + losses + ties), 4) if (wins + losses + ties) else None,
        "win_rate_among_decided": round(wins / decided, 4) if decided else None,
        "win_rate_95ci": [round(lo_ci, 4), round(hi_ci, 4)] if decided else None,
        "p_two_sided": round(binom_two_sided(wins, decided), 6) if decided else None,
    }


def probe_breakdown(rows):
    """Fire rate per probe on each class, with a Wilson interval on the difference's two
    components. A probe that never fires on either class is reported, not dropped: knowing
    a probe is inert on real data is the same kind of fact as knowing it discriminates."""
    angles = sorted({angle for row in rows for angle in row["flagged"]})
    pos = [r for r in rows if r["label"] == 1]
    neg = [r for r in rows if r["label"] == 0]
    out = {}
    for angle in angles:
        fp = sum(1 for r in pos if r["flagged"].get(angle))
        fn_ = sum(1 for r in neg if r["flagged"].get(angle))
        rate_pos = fp / len(pos) if pos else None
        rate_neg = fn_ / len(neg) if neg else None
        # Per-probe AUROC: a single binary signal, so this is just the balanced accuracy
        # of using that probe alone, and 0.5 means "fires equally often on both classes".
        solo = auroc([r["label"] for r in rows], [1.0 if r["flagged"].get(angle) else 0.0 for r in rows])
        lo_p, hi_p = wilson(fp, len(pos))
        lo_n, hi_n = wilson(fn_, len(neg))
        out[angle] = {
            "fired_on_hallucinated": fp, "n_hallucinated": len(pos),
            "rate_hallucinated": round(rate_pos, 4) if rate_pos is not None else None,
            "rate_hallucinated_95ci": [round(lo_p, 4), round(hi_p, 4)] if lo_p is not None else None,
            "fired_on_correct": fn_, "n_correct": len(neg),
            "rate_correct": round(rate_neg, 4) if rate_neg is not None else None,
            "rate_correct_95ci": [round(lo_n, 4), round(hi_n, 4)] if lo_n is not None else None,
            "solo_auroc": round(solo, 4) if solo is not None else None,
            # Precision of "this probe fired" as a hallucination call, against the class
            # prior. Below the prior means the probe is anti-correlated with the label.
            "precision_if_used_as_detector": round(fp / (fp + fn_), 4) if (fp + fn_) else None,
        }
    return out


def length_stratified(rows, angle, quartiles=4):
    """Fire rate for one probe within answer-length quartiles.

    Two of these corpora differ in answer *form* between classes, so a probe that fires
    more often on longer text would look like a hallucination signal without being one.
    A lift that survives inside every quartile is not explained by length.
    """
    ordered = sorted(rows, key=lambda r: r["answer_chars"])
    size = len(ordered) // quartiles
    out = []
    for i in range(quartiles):
        chunk = ordered[i * size:(i + 1) * size] if i < quartiles - 1 else ordered[i * size:]
        pos = [r for r in chunk if r["label"] == 1]
        neg = [r for r in chunk if r["label"] == 0]
        rate_pos = sum(1 for r in pos if r["flagged"].get(angle)) / len(pos) if pos else None
        rate_neg = sum(1 for r in neg if r["flagged"].get(angle)) / len(neg) if neg else None
        out.append({
            "chars_from": chunk[0]["answer_chars"], "chars_to": chunk[-1]["answer_chars"],
            "n": len(chunk), "n_hallucinated": len(pos),
            "rate_hallucinated": round(rate_pos, 4) if rate_pos is not None else None,
            "rate_correct": round(rate_neg, 4) if rate_neg is not None else None,
            "lift": round(rate_pos / rate_neg, 3) if rate_pos is not None and rate_neg else None,
        })
    return out


def score_dataset(name, resamples):
    rows = [json.loads(line) for line in (RESULTS / f"{name}_results.jsonl").read_text().splitlines()]
    labels = [r["label"] for r in rows]
    paired = len({r["pair_id"] for r in rows}) < len(rows)

    out = {
        "n_items": len(rows),
        "n_hallucinated": sum(labels),
        "n_correct": len(labels) - sum(labels),
        "n_questions": len({r["pair_id"] for r in rows}),
        "paired": paired,
        "prevalence": round(sum(labels) / len(labels), 4),
        "mean_answer_chars_hallucinated": round(
            sum(r["answer_chars"] for r in rows if r["label"] == 1) / max(1, sum(labels)), 1),
        "mean_answer_chars_correct": round(
            sum(r["answer_chars"] for r in rows if r["label"] == 0) / max(1, len(labels) - sum(labels)), 1),
        "distinct_ecs_values": len({r["ecs"] for r in rows}),
        "modal_ecs_share": round(Counter(r["ecs"] for r in rows).most_common(1)[0][1] / len(rows), 4),
        "verdicts_hallucinated": dict(Counter(r["verdict"] for r in rows if r["label"] == 1)),
        "verdicts_correct": dict(Counter(r["verdict"] for r in rows if r["label"] == 0)),
        "scores": {},
        "probes": probe_breakdown(rows),
    }
    # Length control, applied to the three probes with the largest solo AUROC on this
    # dataset. Run unconditionally rather than only where the headline is positive, so the
    # control cannot be accused of having been switched on to rescue a number.
    top = sorted(out["probes"].items(), key=lambda kv: -(kv[1]["solo_auroc"] or 0))[:3]
    out["length_stratified"] = {angle: length_stratified(rows, angle) for angle, _ in top}

    for score_name, fn in SCORES.items():
        values = [fn(r) for r in rows]
        point = auroc(labels, values)
        ap = average_precision(labels, values)
        ties = tie_rate(labels, values)
        lo, hi = cluster_bootstrap(
            rows, lambda s, f=fn: auroc([r["label"] for r in s], [f(r) for r in s]), resamples)
        entry = {
            "auroc": round(point, 4) if point is not None else None,
            "auroc_95ci": [round(lo, 4), round(hi, 4)] if lo is not None else None,
            "auprc": round(ap, 4) if ap is not None else None,
            "auprc_baseline_prevalence": round(sum(labels) / len(labels), 4),
            "cross_class_tie_rate": round(ties, 4) if ties is not None else None,
        }
        if paired:
            entry["paired_sign_test"] = paired_sign_test(rows, fn)
        out["scores"][score_name] = entry
    return out


def show(name, res):
    print(f"\n{'=' * 78}\n{name}   n={res['n_items']}  questions={res['n_questions']}  "
          f"hallucinated={res['n_hallucinated']}  correct={res['n_correct']}\n{'=' * 78}")
    print(f"mean answer chars   hallucinated {res['mean_answer_chars_hallucinated']:>7}   "
          f"correct {res['mean_answer_chars_correct']:>7}")
    print(f"ECS granularity     {res['distinct_ecs_values']} distinct values, "
          f"{res['modal_ecs_share']:.1%} of items on the modal value")
    print(f"verdicts            hallucinated {res['verdicts_hallucinated']}")
    print(f"                    correct      {res['verdicts_correct']}")
    print(f"\n{'score':<26}{'AUROC':>7}{'95% CI':>18}{'AUPRC':>8}{'base':>7}{'tie rate':>10}")
    for score_name, entry in res["scores"].items():
        ci = f"[{entry['auroc_95ci'][0]:.3f}, {entry['auroc_95ci'][1]:.3f}]" if entry["auroc_95ci"] else "n/a"
        auc = f"{entry['auroc']:.4f}" if entry["auroc"] is not None else "  n/a"
        ap = f"{entry['auprc']:.4f}" if entry["auprc"] is not None else "  n/a"
        tr = f"{entry['cross_class_tie_rate']:.3f}" if entry["cross_class_tie_rate"] is not None else "n/a"
        print(f"{score_name:<26}{auc:>7}{ci:>18}{ap:>8}{entry['auprc_baseline_prevalence']:>7.3f}{tr:>10}")

    if res["paired"]:
        st = res["scores"]["ecs_risk"]["paired_sign_test"]
        print(f"\npaired sign test on ECS risk, over {st['pairs']} questions:")
        print(f"  hallucinated riskier {st['hallucinated_riskier']}   "
              f"correct riskier {st['correct_riskier']}   tied {st['tied']} ({st['tie_fraction']:.1%})")
        if st["win_rate_among_decided"] is not None:
            print(f"  win rate among decided pairs {st['win_rate_among_decided']:.4f} "
                  f"95% CI [{st['win_rate_95ci'][0]:.3f}, {st['win_rate_95ci'][1]:.3f}]  "
                  f"exact two-sided p={st['p_two_sided']}")

    print(f"\n{'probe':<26}{'halluc':>9}{'correct':>9}{'solo AUROC':>12}{'prec':>8}")
    for angle, p in sorted(res["probes"].items(), key=lambda kv: -(kv[1]["solo_auroc"] or 0)):
        rp = f"{p['rate_hallucinated']:.4f}" if p["rate_hallucinated"] is not None else "n/a"
        rn = f"{p['rate_correct']:.4f}" if p["rate_correct"] is not None else "n/a"
        sa = f"{p['solo_auroc']:.4f}" if p["solo_auroc"] is not None else "n/a"
        pr = f"{p['precision_if_used_as_detector']:.3f}" if p["precision_if_used_as_detector"] is not None else "n/a"
        print(f"{angle:<26}{rp:>9}{rn:>9}{sa:>12}{pr:>8}")


def show_length_control(res):
    for angle, bands in res["length_stratified"].items():
        print(f"\nlength control - {angle}")
        print(f"  {'answer chars':<20}{'n':>6}{'halluc':>9}{'correct':>9}{'lift':>8}")
        for band in bands:
            rp = f"{band['rate_hallucinated']:.4f}" if band["rate_hallucinated"] is not None else "n/a"
            rn = f"{band['rate_correct']:.4f}" if band["rate_correct"] is not None else "n/a"
            lift = f"{band['lift']:.2f}x" if band["lift"] is not None else "n/a"
            band_label = f"{band['chars_from']}-{band['chars_to']}"
            print(f"  {band_label:<20}{band['n']:>6}{rp:>9}{rn:>9}{lift:>8}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datasets", default=",".join(DATASETS))
    parser.add_argument("--resamples", type=int, default=2000)
    args = parser.parse_args()

    summary = {"seed": SEED, "bootstrap_resamples": args.resamples, "datasets": {}}
    for name in args.datasets.split(","):
        res = score_dataset(name, args.resamples)
        summary["datasets"][name] = res
        show(name, res)
        show_length_control(res)
    (RESULTS / "SUMMARY.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(f"\nwrote {RESULTS / 'SUMMARY.json'}")


if __name__ == "__main__":
    main()
