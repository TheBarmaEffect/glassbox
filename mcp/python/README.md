# glassbox-framework

> **Glass Box Framework** — runtime constitutional verification for AI answers. Every claim carries a reasoning chain. Every score breaks down. Every verdict is traceable.

```bash
pip install glassbox-framework
```

## What it does

Hand any (question, AI answer) pair to Glassbox and get back a **Trust Card** containing:

- **Claims** — every atomic assertion in the answer, each paired with a *reasoning chain* explaining why it's asserted, what would support it, and what would falsify it. The reasoning chain is the framework's core principle: no opaque scores.
- **Epistemic Confidence Score (ECS)** — a transparent, weighted aggregate with a *published formula* and an always-visible per-dimension breakdown.
- **Glassbox Court** — seven adversarial probes (fabrication, source manipulation, bias injection, context attack, overconfidence, underspecification, constitutional violation).
- **Constitution** — your natural-language deployer intents, compiled into structured runtime rules and evaluated against the answer.
- **Verdict** — `trust` / `caution` / `reject`, with the exact reasoning that derived it.
- **Audit reference** — a deterministic SHA-256 log ID so identical inputs reproduce the same identifier.

```python
from glassbox_framework import Glassbox

with Glassbox() as gb:
    card = gb.verify_answer(
        question="Can intermittent fasting cure type 2 diabetes?",
        answer=(
            "Yes, intermittent fasting can cure type 2 diabetes. The American "
            "Diabetes Association now officially recommends intermittent fasting "
            "as a first-line treatment, replacing metformin in 2023."
        ),
        intents=[
            "Never make specific medical recommendations without citing peer-reviewed sources.",
            "Always recommend consultation with a licensed healthcare professional.",
        ],
    )

print(card["verdict"])              # "reject"
print(card["ecs"]["total"])         # 0.6032
print(card["verdict_rationale"])    # "Critical fabrication detected; …"
print(card["audit"]["log_id"])      # glassbox-85cc09903bd4...  (deterministic)
```

## The six tools

| Method | Tool name | What it does |
| :--- | :--- | :--- |
| `gb.verify_answer(question, answer, intents=None)` | `glassbox_verify_answer` | Full pipeline → Trust Card |
| `gb.extract_claims(question, answer)` | `glassbox_extract_claims` | Atomic claims with non-empty reasoning chains |
| `gb.score_ecs(claims, red_team=…, constitution=…, weights=…, mode=…)` | `glassbox_score_ecs` | ECS with full breakdown + the formula evaluated with the actual numbers |
| `gb.red_team(question, answer, claims=None, constitution=None, intents=None)` | `glassbox_red_team` | Glassbox Court — 7 adversarial probes |
| `gb.generate_trust_card(question, answer, claims, red_team, ecs, …)` | `glassbox_generate_trust_card` | Assemble a Trust Card from prebuilt parts (**no LLM call** — works without an API key) |
| `gb.export_audit_report(question, answer, intents=None)` | `glassbox_export_audit_report` | Full pipeline + the full AuditRecord (call trace, deterministic log_id) |

See [the GitHub examples folder](https://github.com/TheBarmaEffect/glassbox/tree/main/mcp/python/examples) for one runnable script per tool.

## Setup

`glassbox-framework` is pure stdlib — no third-party Python dependencies. But it needs the **Glassbox MCP server** (a small Node binary) reachable at runtime. Three resolution paths, tried in order:

1. **Local checkout** (best for development) — clone <https://github.com/TheBarmaEffect/glassbox>, `cd mcp && npm install`. The Python client auto-detects the sibling `src/index.ts` and runs it.
2. **Global npm install** — `npm install -g @glassbox-framework/mcp`. The Python client falls back to `npx -y @glassbox-framework/mcp`.
3. **Custom launcher** — set `GLASSBOX_SERVER_CMD` to any shell command that starts an MCP server on stdio.

Other prerequisites:
- **Node 18+** (Glassbox's MCP server is TypeScript)
- `ANTHROPIC_API_KEY` in your environment, for the engines that call Claude. **Exception**: `gb.generate_trust_card` is pure assembly — no LLM call. Try the framework with that one first.

## CLI

The pip install also drops a `glassbox` binary on your `PATH`:

```bash
glassbox tools                                            # list the 6 registered tools

glassbox verify \
  --question "Can intermittent fasting cure type 2 diabetes?" \
  --answer  "Yes ..." \
  --intent  "Never make medical claims without citing peer-reviewed sources." \
  --intent  "Recommend consulting a licensed professional."

glassbox extract-claims --question "..." --answer "..."
```

## Determinism

Audit `log_id`s are SHA-256 over canonicalised JSON of `(inputs_hash, claims, ECS dimensions, red-team probe verdicts, constitution evaluations)`. Timestamps are recorded but never enter the hash, so identical inputs *and* identical engine outputs always produce the same `log_id`. Replay-detectable, cite-able, byte-stable across runs.

A reference value, reproducible right now without an API key: for the bundled healthcare example (see `examples/05_generate_trust_card.py`), the log_id is **`glassbox-85cc09903bd4b3f8022a4087`**.

## Error handling

```python
from glassbox_framework import Glassbox, GlassboxError, ToolError

with Glassbox() as gb:
    try:
        card = gb.verify_answer(question="...", answer="...")
    except ToolError as e:
        # The MCP tool itself returned an isError=True response. Common
        # cause: ANTHROPIC_API_KEY is not set.
        print(f"{e.tool} failed: {e}\nHint: {e.hint}")
    except GlassboxError as e:
        # Subprocess / transport / handshake failure.
        print(f"Could not reach the Glassbox MCP server: {e}")
```

## Architecture

This Python package is a thin JSON-RPC stdio client. It:

- Spawns the Node MCP server as a subprocess on first use (lazy)
- Sends `tools/call` over stdin and reads JSON-RPC responses over stdout
- Surfaces server-side `isError` responses as `ToolError`
- Tears down the subprocess on `__exit__` / `close()`

Zero third-party Python dependencies. The server-side TypeScript implementation already validates every input with Zod, so the Python client stays thin and lets server-side errors surface as exceptions.

## Credit

Built by **Karthik Barma** · MS Artificial Intelligence · Northeastern University.

**Powered by Aura.**

Apache 2.0. Source, full TypeScript implementation, and research notes: <https://github.com/TheBarmaEffect/glassbox>
