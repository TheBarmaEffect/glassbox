# Contributing to Glassbox

Thanks for considering a contribution. Glassbox is research infrastructure that other people build on — the bar for changes is high, but the path is clear.

## Architectural commitments (non-negotiable)

These are not preferences. They define what Glassbox is.

1. **No external LLM API calls in the verification core.** Ever. Not OpenAI, not Anthropic, not Gemini, not local LLMs running as judges. The verification core uses spaCy, sentence-transformers, and a local NLI cross-encoder — that's the entire model surface.
2. **Determinism.** Same input → same trace → same hash. If your change breaks 4-decimal-place reproducibility, the change is wrong (or it requires a `schema_version` bump and explicit changelog entry).
3. **Schema additivity.** Every new field is `Optional` with `None` default. We never break existing trace JSON. Migrators handle version transitions.
4. **Epistemic tag separation.** OBSERVED, RECONSTRUCTED, and GENERATED claims are visually and semantically separated. Code that silently promotes one tier into another is rejected.
5. **Local-first.** Glassbox runs on a developer laptop, no GPU, no network. Optional features (cloud, GPU) are fine; required dependencies are not.

## Development setup

```bash
git clone https://github.com/TheBarmaEffect/glassbox.git
cd glassbox/core

python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,api,witness,tui]"
python -m spacy download en_core_web_sm

make verify              # runs tests + ruff + mypy
make benchmark           # performance numbers
make hps-validate        # HPS empirical validation
```

## The PR bar

Before opening a PR:

1. **`make verify` passes locally.** ruff + mypy strict, and the test suite green.
   Quote a count only with the suite it belongs to: `core/tests` collects 182 and the
   2026-09-04 re-run gave 180 passed / 1 failed / 1 skipped, while the TypeScript
   gateway suite is separate at 266. The previous "157 tests" figure is not
   reproducible at this commit and combined two unrelated suites.
2. **New behavior has a test.** Coverage is not the metric; behavioral specificity is. A test for "X fires when Y" is worth more than a test that hits 100% of lines.
3. **Schema changes are additive and documented.** New optional field? Add a row in `CHANGELOG.md`. Hash-affecting change? Bump `schema_version` AND add a migrator path.
4. **No new required dependencies in the verification core.** Optional extras are fine — add to `[project.optional-dependencies]` in `pyproject.toml`.
5. **No external API calls.** This will be checked.
6. **Commit messages explain the why.** "fix bug" is rejected. "fix race condition in StreamingGlassboxEngine where INPUT_RECEIVED could be emitted twice under high concurrency" is good.

## What we want

- **New failure signals.** Specific, named, with a clear "fires when X" definition.
- **New benchmark cases.** Especially adversarial ones — long responses, code, math, multi-language.
- **Documentation improvements.** Especially for `docs/epistemics.md`, `docs/hps.md`, `docs/architecture.md`.
- **Reproducibility validation.** If you find a non-determinism, that's a bug — open an issue.
- **Comparison studies.** Phase 5D explicitly needs head-to-heads against alternative tools.

## What we don't want

- LLM-as-judge implementations
- Auto-rewrite features in the verification core (separate package, not in `glassbox.engine`)
- Network calls during analysis
- "AI-powered" anything in the core
- Refactors without a clear behavioral motivation

## Code style

- Python 3.11+, type hints everywhere
- `from __future__ import annotations` at the top of every module
- Pydantic v2 models with `ConfigDict(extra="forbid")` for all schemas
- Ruff configuration is in `pyproject.toml`; run `ruff check . --fix` before committing
- mypy strict is enforced; if you hit a wall, prefer `Protocol` over `Any`

## Documentation

- Update `README.md` if you add a top-level feature or capability
- Update `CHANGELOG.md` for every PR (under the next unreleased section)
- Add a doc page under `docs/` for any non-trivial subsystem
- Examples go in `examples/` with a one-line docstring at the top

## Testing philosophy

- Use real engine output where possible — mocks lie
- Schema tests use `extra="forbid"` to catch silent field drift
- Hash-stability tests catch determinism regressions
- Each detector has at least one true-positive and one true-negative test

## Releases

- Maintainers cut releases. SemVer.
- Tag `v0.X.Y` triggers `release.yml` which builds and publishes to PyPI.
- Changelog must be updated before tagging.
- Witness sign the release notes (we eat our own dog food).

## Questions

Open an issue with the label `question`. For research collaborations, mention `@TheBarmaEffect` and tag with `research`.

---

*Glassbox is part of the Glass Box Framework — visible, auditable, falsifiable AI reasoning.*
