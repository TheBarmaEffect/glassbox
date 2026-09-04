#!/usr/bin/env python3
"""
Baseline systems for the GlassBox head-to-head comparison.

Every system here runs with no network, no API key and no model weights.
Each exposes `predict(item) -> set[str]` returning the set of AXES it fired on.
Axes are the GBSA-1 strata: arith, contra, cert, cite. ("clean" is not an axis;
it is the benign control stratum, and any firing on it is a false positive.)

Two kinds of system:

  ITEM-LEVEL   decides "flag / do not flag" for the whole answer and therefore
               fires on every axis at once. random, always, never and the
               length heuristic are item-level: none of them has any notion of
               which failure mode it is detecting.

  AXIS-LEVEL   fires per axis. keyword and computed baselines are axis-level.

The distinction matters for scoring and is preserved in the output records.
"""
import hashlib
import re

AXES = ("arith", "contra", "cert", "cite", "inj")

# ---------------------------------------------------------------- degenerate

def sys_never(item, cfg):
    """Flags nothing. Lower bound: recall 0, precision undefined."""
    return set()


def sys_always(item, cfg):
    """Flags everything. Upper bound on recall, precision = base rate."""
    return set(AXES)


def sys_random(item, cfg):
    """
    Flags with probability `rate`, seeded per item so the result does not
    depend on iteration order and reruns byte-identically.
    """
    seed = cfg["seed"]
    rate = cfg["rate"]
    h = hashlib.sha256(f"{seed}|random|{item['id']}".encode()).digest()
    # 53 bits -> uniform in [0,1)
    u = int.from_bytes(h[:7], "big") / float(1 << 56)
    return set(AXES) if u < rate else set()


# ------------------------------------------------------------------ keyword

def _norm(text):
    return re.sub(r"[^a-z0-9%\s]+", " ", text.lower())


def make_keyword(lexicon):
    """
    The naive lexical guardrail: substring match of an axis vocabulary against
    the answer. Matches on a normalised copy so punctuation cannot hide a term.
    """
    axis_of = {"certainty": "cert", "injection": "inj", "citation": "cite"}
    compiled = {
        axis_of[k]: [t.lower() for t in v] for k, v in lexicon.items()
    }

    def predict(item, cfg):
        hay = _norm(item["answer"])
        fired = set()
        for axis, terms in compiled.items():
            for t in terms:
                if _norm(t).strip() in hay:
                    fired.add(axis)
                    break
        return fired

    return predict


# ----------------------------------------------------------------- heuristic

def sys_length(item, cfg):
    """
    Length / numeral-density control. Flags when the answer is long OR
    numeral-dense. Thresholds were selected on the DEVELOPMENT split only and
    applied unchanged to held-out; see COMPARISON_RESULTS.md.
    """
    a = item["answer"]
    words = a.split()
    n_words = len(words)
    digits = sum(c.isdigit() for c in a)
    density = digits / max(len(a), 1)
    if n_words >= cfg["len_words"] or density >= cfg["numeral_density"]:
        return set(AXES)
    return set()


# ------------------------------------------------------------------ computed
# A deliberately small "computed, not lexical" baseline. This exists to test
# GlassBox's own thesis from the outside: if ~70 lines of arithmetic and
# negation checking reproduce GlassBox's computed-probe scores, then the
# computed advantage is real but is not GlassBox-specific.

_OPS = {
    "+": lambda a, b: a + b, "plus": lambda a, b: a + b,
    "-": lambda a, b: a - b, "minus": lambda a, b: a - b,
    "*": lambda a, b: a * b, "x": lambda a, b: a * b,
    "×": lambda a, b: a * b, "times": lambda a, b: a * b,
    "/": lambda a, b: a / b if b else None,
    "÷": lambda a, b: a / b if b else None,
    "divided by": lambda a, b: a / b if b else None,
}
_NUM = r"(-?\d+(?:,\d{3})*(?:\.\d+)?)"
_OPALT = r"(\+|\-|\*|×|÷|/|x|times|plus|minus|divided by)"
_EQN = re.compile(_NUM + r"\s*" + _OPALT + r"\s*" + _NUM + r"\s*=\s*" + _NUM,
                  re.IGNORECASE)


def _f(s):
    return float(s.replace(",", ""))


def sys_computed(item, cfg):
    """Arithmetic recomputation + negation-polarity contradiction check."""
    fired = set()
    a = item["answer"]

    # --- arithmetic: recompute every "x OP y = z" and compare.
    for m in _EQN.finditer(a):
        lhs, op, rhs, claimed = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        fn = _OPS.get(op)
        if fn is None:
            continue
        try:
            want = fn(_f(lhs), _f(rhs))
        except Exception:
            continue
        if want is None:
            continue
        got = _f(claimed)
        tol = max(1e-6, abs(want) * 1e-9)
        if abs(want - got) > tol:
            fired.add("arith")

    # --- contradiction: high token overlap + opposite negation polarity.
    if _contradicts(a):
        fired.add("contra")
    return fired


_NEG = {"not", "no", "never", "cannot", "cant", "didnt", "doesnt", "dont",
        "isnt", "wasnt", "arent", "werent", "wont", "hasnt", "havent",
        "hadnt", "failed", "unsuccessful", "without"}
_STOP = {"the", "a", "an", "is", "was", "are", "were", "be", "been", "it",
         "this", "that", "of", "to", "and", "in", "on", "for", "did", "do",
         "does", "had", "has", "have", "will", "would", "at", "by", "with"}


def _stem(w):
    prev = None
    while prev != w:
        prev = w
        for suf in ("ing", "ed", "es", "s"):
            if len(w) > 4 and w.endswith(suf):
                w = w[: -len(suf)]
                break
    return w


def _toks(s):
    ws = re.findall(r"[a-z0-9]+", s.lower())
    return {_stem(w) for w in ws if w not in _STOP and w not in _NEG}


def _contradicts(answer):
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", answer) if s.strip()]
    for i in range(len(sents)):
        for j in range(i + 1, len(sents)):
            ti, tj = _toks(sents[i]), _toks(sents[j])
            if not ti or not tj:
                continue
            ov = len(ti & tj) / max(1, min(len(ti), len(tj)))
            if ov < 0.72:
                continue
            ni = bool(_NEG & set(re.findall(r"[a-z]+", sents[i].lower())))
            nj = bool(_NEG & set(re.findall(r"[a-z]+", sents[j].lower())))
            if ni != nj:
                return True
    return False
