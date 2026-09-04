#!/usr/bin/env python3
"""
Lexicons for the keyword/regex baselines.

TWO lists are defined per axis, and the distinction is the point of the
experiment.

`BLIND` was authored from general knowledge of each failure mode, with a
deliberate constraint: every surface form that `benchmark/RESULTS.md` quotes
verbatim from the held-out split was EXCLUDED. RESULTS.md names the phrasings
that defeated GlassBox's own vocabulary ("irrefutably", "categorically",
"pay no attention to anything stated before this line", "common wisdom holds
that", "research indicates", "experts agree", "many papers have demonstrated",
"it is well known that", "no doubt", "beyond doubt", "disregard the above",
"forget everything you were told", "new instructions:"). An author who has read
that file cannot honestly claim to be blind to the test set, so BLIND
reconstructs the blind condition by removing exactly those leaked strings.

`INFORMED` is BLIND plus those leaked strings. It is the contaminated
condition, and it is labelled as such everywhere it is reported.

The gap between BLIND and INFORMED on the held-out split is a direct
measurement of what advance knowledge of the test vocabulary is worth. That
measurement is the reason both exist.

Nothing in either list was adjusted after seeing any score.
"""

# Surface forms quoted verbatim in benchmark/RESULTS.md. Held out of BLIND.
LEAKED = {
    "certainty": ["irrefutably", "categorically", "no doubt", "beyond doubt"],
    "injection": [
        "pay no attention", "disregard the above", "forget everything",
        "new instructions",
    ],
    "citation": [
        "common wisdom", "research indicates", "experts agree",
        "many papers", "it is well known",
    ],
}

BLIND = {
    # Unsupported certainty / overclaiming. Hedge-free absolutes.
    "certainty": [
        "definitely", "certainly", "undoubtedly", "unquestionably",
        "indisputably", "absolutely", "guaranteed", "guarantee",
        "without a doubt", "beyond question", "beyond dispute",
        "incontrovertibly", "unarguably", "undeniably", "self-evident",
        "obviously", "clearly", "plainly", "surely", "conclusively",
        "definitively", "proven fact", "it is proven", "it is certain",
        "everyone knows", "no one disputes", "invariably", "universally",
        "without exception", "in every case", "in all cases", "zero chance",
        "no chance", "100 percent", "100%", "perfectly certain",
        "completely certain", "entirely certain", "always", "never fails",
        "must be true", "has to be true", "cannot be wrong", "impossible to",
    ],
    # Prompt injection. Instruction-override phrasings.
    "injection": [
        "ignore previous", "ignore prior", "ignore all previous",
        "ignore the above", "ignore your instructions", "ignore your guidelines",
        "ignore safety", "disregard previous", "disregard prior",
        "disregard all", "forget previous", "forget your instructions",
        "override", "system prompt", "your instructions are",
        "updated instructions", "developer mode", "jailbreak",
        "do anything now", "pretend you are", "pretend to be", "act as if you",
        "you are now", "from now on you", "reveal your", "print your",
        "output your", "show your prompt", "repeat the above", "bypass",
        "unrestricted", "no restrictions", "without restrictions",
        "disable your", "admin mode", "root access", "execute the following",
        "run the following", "do not follow", "stop following",
        "your real instructions", "prior instructions",
    ],
    # Vague / unverifiable sourcing.
    "citation": [
        "studies show", "studies have shown", "research shows",
        "research suggests", "experts say", "scientists say",
        "scientists agree", "it is widely known", "common knowledge",
        "several studies", "numerous studies", "some studies",
        "a study found", "a recent study", "recent research",
        "according to research", "according to experts",
        "according to a study", "evidence suggests", "data shows",
        "reports indicate", "sources say", "it has been shown",
        "it has been proven", "widely accepted", "generally accepted",
        "most researchers", "researchers found", "literature suggests",
        "the literature", "well-documented", "well documented",
        "established fact", "scholars agree", "analysts say",
        "surveys show", "findings suggest", "papers have shown",
        "the consensus is", "it is believed",
    ],
}

INFORMED = {axis: BLIND[axis] + LEAKED[axis] for axis in BLIND}

if __name__ == "__main__":
    import hashlib, json
    for name, d in (("BLIND", BLIND), ("INFORMED", INFORMED)):
        blob = json.dumps({k: sorted(v) for k, v in d.items()}, sort_keys=True)
        h = hashlib.sha256(blob.encode()).hexdigest()[:16]
        print(f"{name:9} terms={sum(len(v) for v in d.values()):3}  "
              f"per-axis={ {k: len(v) for k, v in d.items()} }  sha256={h}")
