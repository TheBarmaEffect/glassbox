---
name: Bug report
about: Something Glassbox does that it shouldn't, or doesn't do that it should
title: "[bug] "
labels: ["bug", "triage"]
---

### What happened

<!-- One or two sentences. What did you do, what did you expect, what did you actually see? -->

### Reproduction

<!-- The smallest snippet that reproduces it. Include the question/answer pair and any intents. -->

```python
from glassbox_framework import Glassbox

with Glassbox() as gb:
    card = gb.verify_answer(
        question="...",
        answer="...",
    )
```

### Trust Card output (if any)

<!-- Paste the relevant fields. The `audit.log_id` is especially useful — it pins the exact run. -->

```json
{
  "verdict": "...",
  "audit": { "log_id": "glassbox-..." }
}
```

### Environment

- Glassbox install path: <!-- `pip install glassbox-framework` / `npm install -g @glassbox-framework/mcp` / `brew install thebarmaeffect/glassbox/glassbox-mcp` / source checkout -->
- `pip show glassbox-framework` version: <!-- e.g. 1.0.1 -->
- `npm view @glassbox-framework/mcp version`: <!-- e.g. 1.0.2 -->
- OS: <!-- macOS 15 / Ubuntu 22.04 / Windows 11 / ... -->
- Node version: `node --version`
- Python version: `python --version`
- Claude host (if applicable): <!-- Claude Desktop, Claude Code, claude.ai Connectors, direct API, custom -->

### Anything else

<!-- Stack traces, partial Trust Cards, what you've already tried. -->
