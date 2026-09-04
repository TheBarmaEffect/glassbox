#!/usr/bin/env python3
"""
Score the SRS-1 prototype against `ecs.total` as a *resolution* and *discrimination*
problem, on all seven corpora the project has.

The question is deliberately split in two, because the external benchmark identified
resolution as the binding constraint and the two failure modes have opposite
implications for the paper:

  1. RESOLUTION — how many values does the score take, and how often does it assign the
     same value to a correct and a hallucinated answer to the *same question*? This is a
     property of the score's construction and is measurable without any label being
     right or useful.

  2. DISCRIMINATION — does the score rank a hallucinated answer above its correct
     counterpart? This is a property of the underlying signals.

A score can fix (1) completely and leave (2) at chance. That is not a null result; it
separates "our score is badly constructed" from "structural signals cannot do this task",
and only the first is fixable by scoring work.

Estimators are the ones `research/external/score_external.py` uses, deliberately
unchanged, so the `ecs_risk` column here reproduces the published numbers rather than
inviting a comparison across two different AUROC conventions. AUROC uses midranks
because the tie mass is the whole subject. Intervals are cluster bootstraps over the
question, not the item.

Everything is stdlib.

Usage:  python3 score_scoring.py [--resamples N] [--datasets a,b]
Output: results/SUMMARY.json, results/REPORT.txt, and a printed report.
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

EXTERNAL = ["truthfulqa", "halueval_qa", "halueval_dialogue", "halueval_general"]
GBSA = ["gbsa1_main", "gbsa1_heldout", "gbsa2"]
DATASETS = EXTERNAL + GBSA

# Corpora whose two classes differ in answer *form*, not only in truth. On these a
# length-only detector scores AUROC 0.9737 and 0.7155 respectively, so no number on them
# means anything until the length baseline is read alongside it.
LENGTH_CONFOUNDED = {"halueval_qa", "halueval_dialogue"}

# The scores under test. All are risk-oriented: higher = the score says riskier.
SCORES = {
    # The deployed scalar, in the exact form EXTERNAL_RESULTS.md reports.
    "ecs_risk": lambda r: float(r["ecs_risk_ppm"]),
    # SRS-1: the ECS tier plus the continuous gradient in a 3 000 ppm tiebreak band.
    "srs_risk": lambda r: float(r["srs_risk_ppm"]),
    # Same, max-pooled gradient (the conjunctive reading).
    "srs_max": lambda r: float(r["srs_max_ppm"]),
    # Same, with answer_relevance dropped from the tier on structural grounds.
    "srs_sign": lambda r: float(r["srs_sign_ppm"]),
    # Same, also dropping calibration — the pair EXTERNAL_RESULTS.md found anti-correlated.
    "srs_sign_strict": lambda r: float(r["srs_sign_strict_ppm"]),
    # The gradient with no tier at all: does the continuous signal carry anything alone?
    "gradient_only": lambda r: float(r["gradient_ppm"]),
    "gradient_max_only": lambda r: float(r["gradient_max_ppm"]),
    # Controls. Neither is a proposal; both are here so a result cannot be read without them.
    "answer_length_baseline": lambda r: float(r["answer_chars"]),
    "failed_probe_count": lambda r: float(r["failed_probes"]),
}

AGGREGATES = ["ecs_risk", "srs_risk", "srs_max", "srs_sign", "srs_sign_strict",
              "gradient_only", "gradient_max_only"]


# ---------------------------------------------------------------------------------------
# Estimators. Identical to research/external/score_external.py.
# ---------------------------------------------------------------------------------------

def auroc(labels, scores):
    """Tie-aware AUROC via the Mann-Whitney statistic on midranks. A tie contributes
    exactly 0.5. None when a class is empty or the score is constant, because an AUROC is
    undefined in both cases and 0.5 there would be an invented number."""
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
    """Average precision with tied scores collapsed into one threshold step: ranking
    inside a tied block is arbitrary, so crediting it would credit an ordering the
    detector did not produce."""
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
    """Fraction of cross-class comparisons that are exact ties. The ceiling on what any
    threshold can do with the score."""
    pos = Counter(s for l, s in zip(labels, scores) if l == 1)
    neg = Counter(s for l, s in zip(labels, scores) if l == 0)
    npos, nneg = sum(pos.values()), sum(neg.values())
    if not npos or not nneg:
        return None
    return sum(pos[v] * neg[v] for v in pos if v in neg) / (npos * nneg)


def cluster_bootstrap(rows, fn, resamples, seed=SEED):
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
    total = wins + losses + ties
    decided = wins + losses
    lo_ci, hi_ci = wilson(wins, decided)
    return {
        "pairs": total,
        "hallucinated_riskier": wins,
        "correct_riskier": losses,
        "tied": ties,
        "tie_fraction": round(ties / total, 4) if total else None,
        "win_rate_among_decided": round(wins / decided, 4) if decided else None,
        "win_rate_95ci": [round(lo_ci, 4), round(hi_ci, 4)] if decided else None,
        "p_two_sided": round(binom_two_sided(wins, decided), 6) if decided else None,
    }


# ---------------------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------------------

def resolution(rows, score_fn):
    values = [score_fn(r) for r in rows]
    counts = Counter(values)
    modal_value, modal_count = counts.most_common(1)[0]
    return {
        "n": len(rows),
        "distinct_values": len(counts),
        "modal_share": round(modal_count / len(rows), 4),
        "modal_value": modal_value,
        # Effective number of levels: 1 / sum(p^2). A score sitting 92 % on one value has
        # an effective resolution near 1 however many values it can technically take, and
        # `distinct_values` alone hides that.
        "effective_levels": round(1.0 / sum((c / len(rows)) ** 2 for c in counts.values()), 2),
    }


# ---------------------------------------------------------------------------------------
# Risk-coverage / selective prediction. The honest presentation for an uncalibrated score.
# ---------------------------------------------------------------------------------------

def risk_coverage(labels, scores, points=(0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0)):
    """Two framings, both tie-aware.

    `selective` accepts the least-risky `coverage` fraction and reports the hallucination
    rate among accepted answers. A working score puts that below the base rate.

    `triage` reviews the most-risky `coverage` fraction and reports precision and recall
    there. This is the framing the one positive result in EXTERNAL_RESULTS.md lives in.

    Ties are handled by taking the *expected* count over a uniformly random ordering
    inside the boundary block, which is what an arbitrary tie-break actually delivers in
    expectation. Reporting a lucky ordering of a tied block would credit the score for
    resolution it does not have.
    """
    n = len(labels)
    base = sum(labels) / n
    pairs = sorted(zip(scores, labels), key=lambda kv: kv[0])
    out = {"base_rate": round(base, 4), "selective": [], "triage": []}

    def expected_positives(ordered, k):
        """Positives in the first k of `ordered`, averaging over tied boundary blocks."""
        if k <= 0:
            return 0.0
        total, seen, i = 0.0, 0, 0
        while i < len(ordered) and seen < k:
            j = i
            while j + 1 < len(ordered) and ordered[j + 1][0] == ordered[i][0]:
                j += 1
            block = ordered[i:j + 1]
            block_pos = sum(l for _, l in block)
            take = min(len(block), k - seen)
            total += block_pos * take / len(block)
            seen += take
            i = j + 1
        return total

    ascending = pairs
    descending = sorted(zip(scores, labels), key=lambda kv: -kv[0])
    for coverage in points:
        k = max(1, round(coverage * n))
        accepted_pos = expected_positives(ascending, k)
        reviewed_pos = expected_positives(descending, k)
        out["selective"].append({
            "coverage": coverage, "n_accepted": k,
            "hallucination_rate_among_accepted": round(accepted_pos / k, 4),
            "lift_vs_base": round((accepted_pos / k) / base, 3) if base else None,
        })
        out["triage"].append({
            "coverage": coverage, "n_reviewed": k,
            "precision": round(reviewed_pos / k, 4),
            "recall": round(reviewed_pos / sum(labels), 4) if sum(labels) else None,
            "precision_lift_vs_base": round((reviewed_pos / k) / base, 3) if base else None,
        })
    return out


# ---------------------------------------------------------------------------------------
# Per-component breakdown, and the tie decomposition that attributes any AUROC change.
# ---------------------------------------------------------------------------------------

def component_breakdown(rows, resamples):
    keys = sorted(rows[0]["components"].keys())
    labels = [r["label"] for r in rows]
    out = {}
    for key in keys:
        values = [float(r["components"][key]) for r in rows]
        counts = Counter(values)
        point = auroc(labels, values)
        lo, hi = (None, None)
        if point is not None and resamples:
            lo, hi = cluster_bootstrap(
                rows,
                lambda s, k=key: auroc([r["label"] for r in s],
                                       [float(r["components"][k]) for r in s]),
                resamples)
        out[key] = {
            "auroc": round(point, 4) if point is not None else None,
            "auroc_95ci": [round(lo, 4), round(hi, 4)] if lo is not None else None,
            "distinct_values": len(counts),
            # A component sitting on one value cannot contribute resolution or signal, and
            # dilutes a uniform pool. Reported rather than acted on: dropping components
            # because they are quiet on the corpus in hand is how a score gets fitted.
            "modal_share": round(counts.most_common(1)[0][1] / len(rows), 4),
            "constant": len(counts) == 1,
        }
    return out


def tie_decomposition(rows, base_fn, new_fn):
    """Where any AUROC change comes from.

    SRS-1 is built so that it cannot reorder a pair `ecs_risk` already ordered: the
    gradient lives in a band narrower than the ECS lattice spacing. So the base score's
    decided pairs are untouched, and everything new happens on the pairs it tied. This
    reports the win rate on exactly those pairs, which is the whole of the change.
    """
    by_pair = defaultdict(dict)
    for row in rows:
        by_pair[row["pair_id"]][row["label"]] = row
    tied_wins = tied_losses = tied_still = 0
    decided_agree = decided_flip = 0
    for pair in by_pair.values():
        if 0 not in pair or 1 not in pair:
            continue
        base_hi, base_lo = base_fn(pair[1]), base_fn(pair[0])
        new_hi, new_lo = new_fn(pair[1]), new_fn(pair[0])
        if base_hi == base_lo:
            if new_hi > new_lo:
                tied_wins += 1
            elif new_hi < new_lo:
                tied_losses += 1
            else:
                tied_still += 1
        else:
            same = (base_hi > base_lo) == (new_hi > new_lo)
            if new_hi == new_lo:
                decided_flip += 1
            elif same:
                decided_agree += 1
            else:
                decided_flip += 1
    broken = tied_wins + tied_losses
    lo_ci, hi_ci = wilson(tied_wins, broken)
    return {
        "pairs_base_tied": tied_wins + tied_losses + tied_still,
        "of_those_broken": broken,
        "of_those_still_tied": tied_still,
        "hallucinated_riskier": tied_wins,
        "correct_riskier": tied_losses,
        "win_rate_on_newly_broken": round(tied_wins / broken, 4) if broken else None,
        "win_rate_95ci": [round(lo_ci, 4), round(hi_ci, 4)] if broken else None,
        "p_two_sided": round(binom_two_sided(tied_wins, broken), 6) if broken else None,
        "pairs_base_decided": decided_agree + decided_flip,
        # Must be 0. The band argument is a proof, and this is its empirical check.
        "decided_pairs_reordered": decided_flip,
    }


def aliasing(rows, pooled_keys):
    """How much resolution the *pooling* throws away, as distinct from how much the
    features carry.

    With uniform weights the components are interchangeable: an item with
    `assumed_claim_ratio` at 1 and `unsupported_specificity_density` at 0 sums to exactly
    the same total as an item with those two swapped, so two structurally different
    answers alias onto one scalar. This counts it: distinct component *vectors* against
    distinct pooled *scalars*.

    The fix is not a cleverer weight vector — any weighting chosen to avoid collisions
    would be arbitrary, and one chosen to improve an AUROC would be a fit. The fix is to
    emit the vector, which the project already does for `ecs.dimensions`.
    """
    vectors = {tuple(row["components"][k] for k in sorted(pooled_keys)) for row in rows}
    scalars = {row["gradient_ppm"] for row in rows}
    return {
        "distinct_component_vectors": len(vectors),
        "distinct_pooled_scalars": len(scalars),
        "resolution_lost_to_pooling": round(1 - len(scalars) / len(vectors), 4) if vectors else None,
    }


def score_dataset(name, resamples, component_resamples=None):
    rows = [json.loads(line) for line in (RESULTS / f"{name}_rows.jsonl").read_text().splitlines()]
    labels = [r["label"] for r in rows]
    paired = len({r["pair_id"] for r in rows}) < len(rows)
    out = {
        "n_items": len(rows),
        "n_positive": sum(labels),
        "prevalence": round(sum(labels) / len(labels), 4),
        "n_clusters": len({r["pair_id"] for r in rows}),
        "paired": paired,
        "label_kind": rows[0]["label_kind"],
        "length_confounded": name in LENGTH_CONFOUNDED,
        "scores": {},
        "components": component_breakdown(
            rows, resamples if component_resamples is None else component_resamples),
    }
    for score_name, fn in SCORES.items():
        values = [fn(r) for r in rows]
        point = auroc(labels, values)
        lo, hi = cluster_bootstrap(
            rows, lambda s, f=fn: auroc([r["label"] for r in s], [f(r) for r in s]), resamples)
        entry = {
            **resolution(rows, fn),
            "auroc": round(point, 4) if point is not None else None,
            "auroc_95ci": [round(lo, 4), round(hi, 4)] if lo is not None else None,
            "auprc": round(average_precision(labels, values), 4)
                     if average_precision(labels, values) is not None else None,
            "cross_class_tie_rate": round(tie_rate(labels, values), 4)
                                    if tie_rate(labels, values) is not None else None,
        }
        if paired:
            entry["paired_sign_test"] = paired_sign_test(rows, fn)
        if score_name in ("srs_risk", "srs_sign", "gradient_only"):
            entry["tie_decomposition_vs_ecs"] = tie_decomposition(rows, SCORES["ecs_risk"], fn)
        if score_name in AGGREGATES or score_name == "answer_length_baseline":
            entry["risk_coverage"] = risk_coverage(labels, values)
        out["scores"][score_name] = entry

    # The question EXTERNAL_RESULTS.md raised: is the aggregate worse than its best part?
    #
    # Restricted to the components the aggregate actually *contains*. Comparing a pool
    # against a component it deliberately excludes is not a fair test of the pooling rule:
    # on HaluEval QA the best component of any kind is `answer_token_norm` at AUROC 0.96,
    # which is the answer-form artefact the exclusion exists to keep out. Both numbers are
    # reported, separately and labelled.
    manifest = json.loads((RESULTS / "MANIFEST.json").read_text())
    pooled_keys = {c["key"] for c in manifest["components"] if c["included"]}

    def best_of(keys):
        best_key, best = None, None
        for key in keys:
            value = out["components"][key]["auroc"]
            if value is None:
                continue
            # A component declared risk-oriented is read as declared. Taking
            # max(v, 1-v) would silently re-fit its sign to the label, which is the
            # thing this whole exercise refuses to do.
            if best is None or value > best:
                best_key, best = key, value
        return best_key, (round(best, 4) if best is not None else None)

    pooled_best_key, pooled_best = best_of(pooled_keys)
    excluded_keys = set(out["components"]) - pooled_keys
    excluded_best_key, excluded_best = best_of(excluded_keys)
    out["best_component"] = {
        "pooled_key": pooled_best_key, "pooled_auroc": pooled_best,
        "excluded_key": excluded_best_key, "excluded_auroc": excluded_best,
    }
    # How saturated is the pool? A component sitting on one value adds no resolution and
    # dilutes a uniform mean. This is the diagnosis for why max-pooling fails below.
    out["aliasing"] = aliasing(rows, pooled_keys)
    out["pool_health"] = {
        "n_pooled": len(pooled_keys),
        "n_constant": sum(1 for k in pooled_keys if out["components"][k]["constant"]),
        "n_modal_over_95pct": sum(1 for k in pooled_keys
                                  if out["components"][k]["modal_share"] > 0.95),
        "saturated_at_one": sorted(
            k for k in pooled_keys
            if out["components"][k]["modal_share"] > 0.95 and not out["components"][k]["constant"]),
        "constant_components": sorted(k for k in pooled_keys if out["components"][k]["constant"]),
    }
    for name_ in AGGREGATES:
        aggregate = out["scores"][name_]["auroc"]
        out["scores"][name_]["beats_best_pooled_component"] = (
            None if aggregate is None or pooled_best is None else bool(aggregate >= pooled_best)
        )
        out["scores"][name_]["delta_vs_best_pooled"] = (
            None if aggregate is None or pooled_best is None else round(aggregate - pooled_best, 4)
        )
    return out


# ---------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------

def emit(lines, text=""):
    print(text)
    lines.append(text)


def num(value, spec=".4f", width=8, blank="n/a"):
    """Format an optional number in a fixed column. Kept out of the f-strings because a
    nested conditional inside a format spec is unreadable and, in an earlier draft of this
    file, silently wrong."""
    return f"{blank:>{width}}" if value is None else f"{value:>{width}{spec}}"


def report(summary, lines):
    emit(lines, "=" * 100)
    emit(lines, "HEADLINE - before and after, one row per corpus.")
    emit(lines, "  ties = paired tie fraction where the corpus is paired, else cross-class tie rate.")
    emit(lines, "  srs_sign is the default proposal: ECS tier minus answer_relevance, plus the gradient.")
    emit(lines, "=" * 100)
    emit(lines, f"{'corpus':<19}{'n':>6}{'distinct':>19}{'ties':>17}{'AUROC':>19}{'len':>8}")
    emit(lines, f"{'':<19}{'':>6}{'ecs -> srs_sign':>19}{'ecs -> srs_sign':>17}"
                f"{'ecs -> srs_sign':>19}{'base':>8}")
    for name, res in summary.items():
        base = res["scores"]["ecs_risk"]
        new_ = res["scores"]["srs_sign"]

        def ties_of(stats):
            if res["paired"]:
                return (stats.get("paired_sign_test") or {}).get("tie_fraction")
            return stats["cross_class_tie_rate"]

        emit(lines, f"{name + ('*' if res['length_confounded'] else ''):<19}{res['n_items']:>6}"
                    f"{base['distinct_values']:>8} ->{new_['distinct_values']:>8}"
                    f"{ties_of(base):>8.3f} ->{ties_of(new_):>6.3f}"
                    f"{base['auroc']:>9.4f} ->{new_['auroc']:>8.4f}"
                    f"{res['scores']['answer_length_baseline']['auroc']:>8.3f}")
    emit(lines)
    emit(lines, "=" * 100)
    emit(lines, "POOL HEALTH - a component sitting on one value adds no resolution and dilutes a mean.")
    emit(lines, "=" * 100)
    emit(lines, f"{'corpus':<19}{'pooled':>8}{'constant':>10}{'modal>95%':>11}"
                f"{'vectors':>9}{'scalars':>9}{'lost':>7}   constant components")
    for name, res in summary.items():
        health = res["pool_health"]
        alias = res["aliasing"]
        emit(lines, f"{name:<19}{health['n_pooled']:>8}{health['n_constant']:>10}"
                    f"{health['n_modal_over_95pct']:>11}"
                    f"{alias['distinct_component_vectors']:>9}{alias['distinct_pooled_scalars']:>9}"
                    f"{alias['resolution_lost_to_pooling']:>7.3f}"
                    f"   {', '.join(health['constant_components']) or '-'}")
    emit(lines)
    emit(lines, "=" * 100)
    emit(lines, "RESOLUTION - distinct values and paired tie rate.  Target: ties well below 0.50.")
    emit(lines, "=" * 100)
    emit(lines, f"{'corpus':<19}{'n':>6}  {'score':<18}{'distinct':>9}{'eff.lv':>8}"
                f"{'modal':>7}{'xclass tie':>11}{'paired tie':>11}")
    for name, res in summary.items():
        for index, score_name in enumerate(
                ("ecs_risk", "srs_risk", "srs_sign", "gradient_only", "srs_max")):
            stats = res["scores"][score_name]
            paired_tie = (stats.get("paired_sign_test") or {}).get("tie_fraction")
            label = name if index == 0 else ""
            count = str(res["n_items"]) if index == 0 else ""
            emit(lines, f"{label:<19}{count:>6}  {score_name:<18}"
                        f"{stats['distinct_values']:>9}{stats['effective_levels']:>8}"
                        f"{stats['modal_share']:>7.3f}"
                        f"{num(stats['cross_class_tie_rate'], '.3f', 11)}"
                        f"{num(paired_tie, '.3f', 11)}")
        emit(lines)

    emit(lines, "=" * 100)
    emit(lines, "DISCRIMINATION - AUROC with cluster-bootstrap CI over the question.")
    emit(lines, "  (*) marks a corpus whose two classes differ in answer FORM; read the length row.")
    emit(lines, "=" * 100)
    emit(lines, f"{'corpus':<19}{'score':<24}{'AUROC':>8}{'95% CI':>18}{'AUPRC':>8}{'>best comp':>12}")
    for name, res in summary.items():
        tag = "*" if res["length_confounded"] else ""
        for index, score_name in enumerate(SCORES):
            stats = res["scores"][score_name]
            ci = ("n/a" if not stats["auroc_95ci"]
                  else f"[{stats['auroc_95ci'][0]:.3f}, {stats['auroc_95ci'][1]:.3f}]")
            beats = stats.get("beats_best_pooled_component")
            emit(lines, f"{(name + tag) if index == 0 else '':<19}{score_name:<24}"
                        f"{num(stats['auroc'])}{ci:>18}{num(stats['auprc'], '.3f')}"
                        f"{('' if beats is None else ('yes' if beats else 'NO')):>12}")
        best = res["best_component"]
        emit(lines, f"{'':<19}{'-> best POOLED component':<24}"
                    f"{num(best['pooled_auroc'])}{'':>18}{'':>8}   ({best['pooled_key']})")
        emit(lines, f"{'':<19}{'-> best excluded component':<24}"
                    f"{num(best['excluded_auroc'])}{'':>18}{'':>8}   ({best['excluded_key']}, "
                    f"not in the pool by design)")
        emit(lines)

    emit(lines, "=" * 100)
    emit(lines, "ATTRIBUTION - SRS-1 cannot reorder a pair the ECS decided, so all change is here.")
    emit(lines, "=" * 100)
    emit(lines, f"{'corpus':<19}{'ECS-tied':>10}{'broken':>8}{'still tied':>11}"
                f"{'win rate':>10}{'95% CI':>18}{'p':>9}{'reordered':>11}")
    for name, res in summary.items():
        decomposition = res["scores"]["srs_risk"].get("tie_decomposition_vs_ecs")
        if not decomposition or not res["paired"]:
            continue
        ci = ("n/a" if not decomposition["win_rate_95ci"]
              else f"[{decomposition['win_rate_95ci'][0]:.3f}, {decomposition['win_rate_95ci'][1]:.3f}]")
        emit(lines, f"{name:<19}{decomposition['pairs_base_tied']:>10}"
                    f"{decomposition['of_those_broken']:>8}{decomposition['of_those_still_tied']:>11}"
                    f"{num(decomposition['win_rate_on_newly_broken'], '.4f', 10)}{ci:>18}"
                    f"{num(decomposition['p_two_sided'], '.4f', 9)}"
                    f"{decomposition['decided_pairs_reordered']:>11}")
    emit(lines)

    emit(lines, "=" * 100)
    emit(lines, "PER-COMPONENT AUROC - individual, not pooled. `pool` marks membership of the aggregate.")
    emit(lines, "=" * 100)
    manifest = json.loads((RESULTS / "MANIFEST.json").read_text())
    pooled = {c["key"] for c in manifest["components"] if c["included"]}
    for name, res in summary.items():
        if res["label_kind"] != "external":
            continue
        emit(lines, f"\n-- {name}  (prevalence {res['prevalence']})")
        emit(lines, f"{'component':<34}{'pool':>6}{'AUROC':>8}{'95% CI':>18}"
                    f"{'distinct':>9}{'modal':>8}")
        ordered = sorted(res["components"].items(),
                         key=lambda kv: -abs((kv[1]["auroc"] or 0.5) - 0.5))
        for key, stats in ordered:
            ci = ("n/a" if not stats["auroc_95ci"]
                  else f"[{stats['auroc_95ci'][0]:.3f}, {stats['auroc_95ci'][1]:.3f}]")
            emit(lines, f"{key:<34}{('yes' if key in pooled else '-'):>6}"
                        f"{num(stats['auroc'], '.4f', 8, 'const')}{ci:>18}"
                        f"{stats['distinct_values']:>9}{stats['modal_share']:>8.3f}")
    emit(lines)

    emit(lines, "=" * 100)
    emit(lines, "RISK-COVERAGE - the honest presentation for a score with no calibration.")
    emit(lines, "  triage: review the riskiest k%. lift 1.00 = no better than reviewing at random.")
    emit(lines, "=" * 100)
    points = (0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0)
    for name, res in summary.items():
        if res["label_kind"] != "external":
            continue
        base = res["scores"]["ecs_risk"]["risk_coverage"]["base_rate"]
        emit(lines, f"\n-- {name}  (base rate {base})")
        emit(lines, f"{'score':<20}" + "".join(f"{p:>8.0%}" for p in points))
        for score_name in ("ecs_risk", "srs_risk", "srs_sign", "gradient_only", "srs_max",
                           "answer_length_baseline"):
            curve = res["scores"][score_name].get("risk_coverage")
            if not curve:
                continue
            emit(lines, f"{score_name:<20}" +
                 "".join(f"{point['precision_lift_vs_base']:>8.3f}" for point in curve["triage"]))
    emit(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--resamples", type=int, default=2000)
    # The 17 per-component intervals cost 17x the headline ones and are a secondary
    # figure, so they get their own, smaller budget. Stated rather than hidden: a CI at
    # 500 resamples is wider in the third decimal than one at 2 000, and no conclusion
    # here turns on a component CI's third decimal.
    parser.add_argument("--component-resamples", type=int, default=500)
    parser.add_argument("--datasets", default=",".join(DATASETS))
    args = parser.parse_args()

    names = [n for n in args.datasets.split(",") if (RESULTS / f"{n}_rows.jsonl").exists()]
    summary = {name: score_dataset(name, args.resamples, args.component_resamples)
               for name in names}

    lines = []
    report(summary, lines)
    (RESULTS / "SUMMARY.json").write_text(json.dumps(summary, indent=2) + "\n")
    (RESULTS / "REPORT.txt").write_text("\n".join(lines) + "\n")
    print(f"\nwrote {RESULTS / 'SUMMARY.json'} and {RESULTS / 'REPORT.txt'}")


if __name__ == "__main__":
    main()
