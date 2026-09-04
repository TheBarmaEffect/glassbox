# Python-side verification

Run 2026-08-16. Answers the question "was anything other than the Lite verifier
actually tested?" Previously the answer was no.

## 1. Cross-language audit determinism, now independently reproduced

Claim C15 was previously carried on **continuous-integration evidence only**. It
has now been reproduced locally, from a clean virtual environment, with **no
API key**, because `generate_trust_card` makes zero model calls.

| Side | Command | `log_id` |
|---|---|---|
| JavaScript | `node demo/launch-demo.mjs --fast` | `glassbox-85cc09903bd4b3f8022a4087` |
| Python (installed wheel) | `glassbox_framework.Glassbox().generate_trust_card(...)` | `glassbox-85cc09903bd4b3f8022a4087` |
| Canonical reference | CI assertion | `glassbox-85cc09903bd4b3f8022a4087` |

**Match: exact, byte for byte.** Evidence level moves L2 (CI only) to L2+
(CI plus independent local reproduction). The prebuilt-parts caveat is unchanged:
this proves canonical assembly, serialization and hashing, not that model
analysis is deterministic.

## 2. Pip package `glassbox-framework`

Built and installed from `mcp/python` into a clean venv.

| Check | Result |
|---|---|
| `python -m build --wheel` | builds `glassbox_framework-1.0.2-py3-none-any.whl` |
| install into fresh venv | succeeds |
| import contract (`Glassbox`, `GlassboxError`, `ToolError`) | passes |
| `__version__` | `1.0.2`, matching the published PyPI release |

Note the standing version skew: npm and the repo are at 1.0.3, PyPI and this
package are at 1.0.2.

## 3. Local `core/` package, `glassbox` 0.3.0

This is the **separate** research prototype, not the system the paper evaluates.
Installed from `core/dist/glassbox-0.3.0-py3-none-any.whl`. It imports with only
`pydantic`, `networkx`, `numpy`, `rich`; the heavy declared dependencies
(`torch`, `spacy`, `transformers`, `sentence-transformers`) are not needed to
import or to run the suite, so they are evidently lazy.

```
156 passed, 1 failed, 1 skipped   (tests/, excluding tests/test_math.py)
```

**157 test functions across 32 modules.** Earlier notes in this repository
described this as "32 test modules" without ever running them; the function
count and pass rate are reported here for the first time.

### Two defects found, both version skew between the tests and the wheel

1. **`tests/test_math.py` cannot be collected.** It imports `glassbox.math`,
   `glassbox.math.aggregate` and `glassbox.math.entropy`. None exist in the
   0.3.0 wheel. Three of the 56 distinct `glassbox.*` modules the tests import
   are absent; the other 53 resolve.
2. **`test_verified_corpus_structural_expectations` fails.** A committed corpus
   fixture declares `expected_analysis_state = PARTIAL`; the 0.3.0 engine
   returns `COMPLETE`.

Both point the same way: **the checked-in tests are newer than the checked-in
wheel, and `core/src/` is empty**, so there is no source tree to reconcile them
against. This is a reproducibility defect in the local repository, not
necessarily a defect in the package.

## Bearing on the paper

None of this changes the paper's evaluated artifact. GlassBox Lite remains the
system under test and the 108-test platform figure is unaffected. What changes:

- C15 can now be stated as independently reproduced rather than CI-asserted.
- Any claim about the `core/` package must carry the caveat that its test suite
  and its distributed wheel are out of step, and that its source tree is missing
  locally.
- The `core/` package's 157 tests must **not** be added to the platform total.
  They belong to a different system.
