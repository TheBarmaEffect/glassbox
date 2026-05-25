# Glass Box Framework — Launch Post (dev.to / Hashnode / LinkedIn)

> Copy-paste this into dev.to, Hashnode, or LinkedIn. Swap the canonical link at the bottom once posted.

---

## Glass Box Framework: Give Every AI Answer a Trust Score

*One `pip install` away from knowing if your LLM is hallucinating.*

---

AI answers are black boxes. A model says "Yes, intermittent fasting can reverse type 2 diabetes" — and you have no idea whether that claim is grounded, overstated, or fabricated outright. You either trust it blindly or fact-check it manually.

**Glass Box Framework** closes that gap. It wraps any AI answer in a structured verification layer that produces a **Trust Card** — a machine-readable audit object containing every claim, a reasoning chain, an Epistemic Confidence Score (ECS), and a 7-angle red team report. Every verdict is deterministic, traceable, and reproducible.

---

### What it looks like

```python
pip install glassbox-framework
```

```python
from glassbox_framework import Glassbox

with Glassbox() as gb:
    card = gb.verify_answer(
        question="Can intermittent fasting cure type 2 diabetes?",
        answer="Yes, multiple studies show IF can fully reverse T2D in most patients.",
        intents=["Never make medical claims without citing peer-reviewed sources."],
    )

print(card["verdict"])         # "reject"
print(card["ecs"]["total"])    # 0.31
print(card["audit"]["log_id"]) # glassbox-85cc09903bd4b3f8022a4087
```

The `log_id` is a deterministic SHA-256 over the canonical inputs — the same question, answer, and constitution always produce the same hash, across Python *and* Node.js.

---

### Six tools, full pipeline

| Tool | What it does |
|------|-------------|
| `verify_answer` | Full pipeline in one call |
| `extract_claims` | Structured claims with per-claim reasoning chains |
| `score_ecs` | Epistemic Confidence Score (G, C, K, R, CC dimensions) |
| `red_team` | 7-angle Glassbox Court |
| `generate_trust_card` | Assembly only — **zero LLM calls**, fully deterministic |
| `export_audit_report` | SHA-256 audit record |

The **Epistemic Confidence Score** is a formal weighted sum:

```
ECS = w_G·G + w_C·C + w_K·K + w_R·R + w_CC·CC
```

Where G = groundedness, C = coherence, K = knowledge boundary, R = resistance to red team, CC = constitutional compliance. Default weights sum to 1.0.

The **Glassbox Court** runs 7 independent attack angles: fabrication, source manipulation, bias injection, context attack, overconfidence, underspecification, and constitutional violation.

---

### Use it as an MCP server (Claude Desktop, Cursor, Cline…)

```json
{
  "mcpServers": {
    "glass-box": {
      "command": "npx",
      "args": ["-y", "@glassbox-framework/mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Add that to `claude_desktop_config.json` and the six `glassbox_*` tools appear inside Claude Desktop. You can ask Claude to verify its own answers in real time.

---

### Install

```bash
# Python SDK
pip install glassbox-framework

# npm MCP server
npx -y @glassbox-framework/mcp

# Homebrew
brew tap thebarmaeffect/glassbox && brew install glassbox-mcp
```

- GitHub: https://github.com/TheBarmaEffect/glassbox
- npm: https://www.npmjs.com/package/@glassbox-framework/mcp
- PyPI: https://pypi.org/project/glassbox-framework/
- MCP Registry: `io.github.TheBarmaEffect/glassbox-framework`

---

### Why open source?

I built this because I kept running into the same problem: AI systems that sound authoritative and are subtly wrong in high-stakes domains — healthcare, law, finance. The Glass Box Framework is my answer to "what would it look like if AI answers came with a receipt?"

Contributions welcome. The red team angles, ECS weights, and constitution rule system are all designed to be extended. See [CONTRIBUTING.md](CONTRIBUTING.md).

Built by Karthik Barma · MS AI · Northeastern University | Powered by Aura.

⭐ Star the repo if this is useful: https://github.com/TheBarmaEffect/glassbox
