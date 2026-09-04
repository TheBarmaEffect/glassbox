#!/usr/bin/env python3
"""
Fetch and sample externally-authored hallucination benchmarks for GlassBox Lite.

Nothing in this file is authored by this project. Every item is downloaded from a
third-party repository pinned to an immutable commit, checksummed on arrival, and
sampled with a fixed seed. Re-running regenerates `data/*.jsonl` byte-identically;
re-running with the cache warm performs no network access at all.

Usage:  python3 prepare.py [--force-download]
Output: cache/<pinned raw files>, data/<dataset>.jsonl, data/MANIFEST.json
"""
import argparse
import hashlib
import json
import pathlib
import random
import csv
import io
import urllib.request

HERE = pathlib.Path(__file__).parent
CACHE = HERE / "cache"
DATA = HERE / "data"

# One seed for every sampling decision in this file. Chosen once, never tuned.
SEED = 20260904

# Immutable pins. A branch name would let the dataset move under the result; a commit
# SHA cannot. The sha256 is verified on every load, cached or freshly downloaded, so a
# corrupted or substituted cache file fails loudly instead of silently changing the number.
SOURCES = {
    "halueval_qa": {
        "url": "https://raw.githubusercontent.com/RUCAIBox/HaluEval/207f479c555a68b8d2431631a95083b84b2accbe/data/qa_data.json",
        "file": "halueval_qa_data.json",
        "sha256": "89ed139ec5e3a3169a0b30e45569ac1283846f76f27f7bb5e908ee6deed57e88",
        "repo": "RUCAIBox/HaluEval @ 207f479c555a68b8d2431631a95083b84b2accbe (MIT)",
    },
    "halueval_dialogue": {
        "url": "https://raw.githubusercontent.com/RUCAIBox/HaluEval/207f479c555a68b8d2431631a95083b84b2accbe/data/dialogue_data.json",
        "file": "halueval_dialogue_data.json",
        "sha256": "9c461df2691e4362837f66fceaaff3bc260453350c3a1cae76a5a52e5e338bfd",
        "repo": "RUCAIBox/HaluEval @ 207f479c555a68b8d2431631a95083b84b2accbe (MIT)",
    },
    "halueval_general": {
        "url": "https://raw.githubusercontent.com/RUCAIBox/HaluEval/207f479c555a68b8d2431631a95083b84b2accbe/data/general_data.json",
        "file": "halueval_general_data.json",
        "sha256": "06325213d8b9eb34fffed910516a18ba2103f1661457d4873a1f4808dffc6bf1",
        "repo": "RUCAIBox/HaluEval @ 207f479c555a68b8d2431631a95083b84b2accbe (MIT)",
    },
    "truthfulqa": {
        "url": "https://raw.githubusercontent.com/sylinrl/TruthfulQA/f6be04e52bbcb41d4d20daee6358231d4a5015d2/TruthfulQA.csv",
        "file": "TruthfulQA.csv",
        "sha256": "b8d8ef1e12f98b4f2a9f47abc9765da0640b182b6c5d9b92f0c1a1f2f1e02e5c",
        "repo": "sylinrl/TruthfulQA @ f6be04e52bbcb41d4d20daee6358231d4a5015d2 (Apache-2.0)",
    },
}

# How many *questions* to sample from each source. HaluEval QA and Dialogue carry 10 000
# each, which is more than needed for a tight interval and slower to review; 2 000 pairs
# puts the AUROC 95% interval inside roughly +/-0.015. General (5 000) and TruthfulQA (790)
# are taken whole because they are already small enough.
SAMPLE = {
    "halueval_qa": 2000,
    "halueval_dialogue": 2000,
    "halueval_general": None,   # all 5000
    "truthfulqa": None,         # all 790
}

# GlassBox Lite rejects an empty field and rejects — does not truncate — a question over
# 6 000 characters or an answer over 12 000. No item in any of these four sources exceeds
# either bound, but the filter is applied and counted anyway so the manifest can say so.
MAX_QUESTION_CHARS = 6_000
MAX_ANSWER_CHARS = 12_000


def fetch(name: str, force: bool) -> bytes:
    spec = SOURCES[name]
    CACHE.mkdir(exist_ok=True)
    path = CACHE / spec["file"]
    if force or not path.exists():
        print(f"downloading {spec['url']}")
        with urllib.request.urlopen(spec["url"], timeout=300) as response:
            path.write_bytes(response.read())
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if spec["sha256"] and digest != spec["sha256"]:
        raise SystemExit(
            f"checksum mismatch for {path.name}: expected {spec['sha256']}, got {digest}. "
            "The cache is stale or the pin is wrong; delete cache/ and rerun."
        )
    spec["observed_sha256"] = digest
    return payload


def jsonl(payload: bytes) -> list[dict]:
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


def take(rows: list, name: str) -> list:
    """Seeded, order-preserving subsample. Indices are drawn then sorted, so the emitted
    file follows the source's own order and a diff against a larger sample stays readable."""
    k = SAMPLE[name]
    if k is None or k >= len(rows):
        return rows
    idx = sorted(random.Random(SEED).sample(range(len(rows)), k))
    return [rows[i] for i in idx]


def emit(name: str, items: list[dict]) -> dict:
    """Write one dataset and return its manifest entry.

    Every item carries `pair_id` (the question it came from), `label` (1 = the class the
    source marks as hallucinated) and the two fields GlassBox Lite is given. Nothing else
    is passed to the verifier: in particular HaluEval's `knowledge` field is withheld,
    because supplying the gold passage would turn a structural audit into a grounding
    check the gateway does not implement.
    """
    kept, dropped = [], 0
    for item in items:
        q, a = item["question"].strip(), item["answer"].strip()
        if not q or not a or len(q) > MAX_QUESTION_CHARS or len(a) > MAX_ANSWER_CHARS:
            dropped += 1
            continue
        kept.append({**item, "question": q, "answer": a})
    DATA.mkdir(exist_ok=True)
    path = DATA / f"{name}.jsonl"
    body = "\n".join(json.dumps(item, sort_keys=True) for item in kept) + "\n"
    path.write_text(body, encoding="utf-8")
    pos = sum(1 for i in kept if i["label"] == 1)
    return {
        "source": SOURCES[name]["repo"],
        "url": SOURCES[name]["url"],
        "raw_sha256": SOURCES[name]["observed_sha256"],
        "items": len(kept),
        "hallucinated": pos,
        "clean": len(kept) - pos,
        "pairs": len({i["pair_id"] for i in kept}),
        "paired": bool(kept and kept[0].get("paired")),
        "dropped_out_of_bounds": dropped,
        "output_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }


def build_halueval_qa(force: bool) -> list[dict]:
    """(question, right_answer, hallucinated_answer). Paired by question.

    Read the length figures in EXTERNAL_RESULTS.md before interpreting this split: the
    correct answer is a HotpotQA gold span (~2 words) and the hallucinated answer is a
    generated sentence (~11 words), so the two classes differ in form as well as in truth.
    """
    rows = take(jsonl(fetch("halueval_qa", force)), "halueval_qa")
    out = []
    for i, row in enumerate(rows):
        for label, key in ((0, "right_answer"), (1, "hallucinated_answer")):
            out.append({
                "id": f"qa-{i}-{label}", "pair_id": f"qa-{i}", "paired": True,
                "question": row["question"], "answer": row[key], "label": label,
            })
    return out


def build_halueval_dialogue(force: bool) -> list[dict]:
    """(dialogue_history, right_response, hallucinated_response). Paired by turn.

    The dialogue history stands in for the question: it is the prompt the response was
    produced against, which is the argument GlassBox Lite's `question` field expects.
    """
    rows = take(jsonl(fetch("halueval_dialogue", force)), "halueval_dialogue")
    out = []
    for i, row in enumerate(rows):
        for label, key in ((0, "right_response"), (1, "hallucinated_response")):
            out.append({
                "id": f"dlg-{i}-{label}", "pair_id": f"dlg-{i}", "paired": True,
                "question": row["dialogue_history"], "answer": row[key], "label": label,
            })
    return out


def build_halueval_general(force: bool) -> list[dict]:
    """(user_query, chatgpt_response, hallucination_label). Not paired.

    This is the only split here made of real model output carrying a human judgement
    rather than a constructed contrast, and the only one whose two classes come from the
    same generator. It is therefore the split that is free of the form confound.
    """
    rows = take(jsonl(fetch("halueval_general", force)), "halueval_general")
    return [{
        "id": row.get("ID", f"gen-{i}"), "pair_id": row.get("ID", f"gen-{i}"), "paired": False,
        "question": row["user_query"], "answer": row["chatgpt_response"],
        "label": 1 if row["hallucination_label"].strip().lower() == "yes" else 0,
    } for i, row in enumerate(rows)]


def build_truthfulqa(force: bool) -> list[dict]:
    """(Question, Best Answer, Best Incorrect Answer). Paired by question.

    Both sides are human-written short declaratives of comparable length, which makes this
    the cleanest paired contrast available without any intervention from us.
    """
    payload = fetch("truthfulqa", force).decode("utf-8")
    rows = take(list(csv.DictReader(io.StringIO(payload))), "truthfulqa")
    out = []
    for i, row in enumerate(rows):
        for label, key in ((0, "Best Answer"), (1, "Best Incorrect Answer")):
            if not (row.get(key) or "").strip():
                continue
            out.append({
                "id": f"tqa-{i}-{label}", "pair_id": f"tqa-{i}", "paired": True,
                "question": row["Question"], "answer": row[key], "label": label,
            })
    # Drop any half-pair, so the paired sign test never compares an item against nothing.
    counts: dict[str, int] = {}
    for item in out:
        counts[item["pair_id"]] = counts.get(item["pair_id"], 0) + 1
    return [item for item in out if counts[item["pair_id"]] == 2]


BUILDERS = {
    "halueval_qa": build_halueval_qa,
    "halueval_dialogue": build_halueval_dialogue,
    "halueval_general": build_halueval_general,
    "truthfulqa": build_truthfulqa,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()

    manifest = {"seed": SEED, "datasets": {}}
    for name, builder in BUILDERS.items():
        entry = emit(name, builder(args.force_download))
        manifest["datasets"][name] = entry
        print(f"{name:<20} items={entry['items']:>6}  pairs={entry['pairs']:>6}  "
              f"hallucinated={entry['hallucinated']:>5}  dropped={entry['dropped_out_of_bounds']}")
    (DATA / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"\nmanifest: {DATA / 'MANIFEST.json'}")


if __name__ == "__main__":
    main()
