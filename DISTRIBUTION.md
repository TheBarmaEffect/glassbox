# Glass Box Framework — Distribution Master Checklist

Everything submitted, pending, or waiting on a manual click from you.

---

## ✅ DONE — Live Right Now

| Channel | URL | Version |
|---------|-----|---------|
| **npm** `@glassbox-framework/mcp` | https://www.npmjs.com/package/@glassbox-framework/mcp | 1.0.3 |
| **PyPI** `glassbox-framework` | https://pypi.org/project/glassbox-framework/ | 1.0.2 |
| **GitHub** `TheBarmaEffect/glassbox` | https://github.com/TheBarmaEffect/glassbox | v1.0.3 release |
| **Homebrew tap** `thebarmaeffect/glassbox` | https://github.com/TheBarmaEffect/homebrew-glassbox | 1.0.3 SHA |
| **MCP Registry** `io.github.TheBarmaEffect/glassbox-framework` | https://registry.modelcontextprotocol.io | 1.0.3 |
| **Smithery.ai** (smithery.yaml at repo root) | https://smithery.ai | auto-detected |
| **LAUNCH_POST.md** (dev.to/Hashnode/LinkedIn article) | in repo | ready to post |

---

## ⏳ PRs SUBMITTED — Pending Review

| Channel | PR | Status |
|---------|-----|--------|
| **punkpeye/awesome-mcp-servers** | https://github.com/punkpeye/awesome-mcp-servers/pull/6866 | Open |
| **conda-forge/staged-recipes** | https://github.com/conda-forge/staged-recipes/pull/33462 | Open |
| **cline/mcp-marketplace** | https://github.com/cline/mcp-marketplace/issues/1664 | Open |

---

## 🖱️ MANUAL — Needs Your Click (5–10 min each)

### MCP Directories (highest priority — copy/paste the one-liner)

| Site | URL | What to submit |
|------|-----|----------------|
| **mcp.so** | https://mcp.so | Click "Submit" → GitHub URL + description |
| **PulseMCP** | https://www.pulsemcp.com/servers | Click "Submit" |
| **mcpservers.org** | https://mcpservers.org/submit | Web form (wong2 directory) |
| **MCP Market** | https://mcpmarket.com | Web form |
| **MCP.directory** | https://mcp.directory | Web form |
| **mcp.ing** | https://mcp.ing | Web form |
| **LobeHub MCP** | https://lobehub.com/mcp | Click "Submit MCP" |
| **Glama** (auto-indexed) | https://glama.ai/mcp/servers | Repo already being indexed — claim it |
| **OpenTools** | https://opentools.ai | Web form |

**One-liner for all forms:**
> Glass Box Framework — Runtime constitutional verification for AI answers. 6 MCP tools: claim extraction with reasoning chains, Epistemic Confidence Score (ECS), 7-angle Glassbox Court red team, constitution compilation, Trust Card assembly, SHA-256 audit logs. GitHub: https://github.com/TheBarmaEffect/glassbox · npm: @glassbox-framework/mcp · npx -y @glassbox-framework/mcp

---

### AI Tool Directories

| Site | URL | Notes |
|------|-----|-------|
| **There's An AI For That** | https://theresanaiforthat.com/launch/ | Free listing, 2M+ monthly visitors |
| **Futurepedia** | https://www.futurepedia.io/submit-tool | DA 65+ directory |
| **Toolify.ai** | https://www.toolify.ai | Form submission |
| **Product Hunt** | https://www.producthunt.com/launch | Best: launch Tuesday–Thursday 9 AM PST, post demo video |

**Product Hunt tips:** Post the walkthrough GIF/video. Tag `#ai-safety #mcp #developer-tools`. Get a few friends to engage in comments in the first hour.

---

### Community Posts (write once, post everywhere)

| Platform | Channel | Best time |
|----------|---------|-----------|
| **Hacker News Show HN** | https://news.ycombinator.com/show | Tue–Thu 9–11 AM ET |
| **r/LocalLLaMA** | https://reddit.com/r/LocalLLaMA | Technical demo with code |
| **r/LLMDevs** | https://reddit.com/r/LLMDevs | Tool announcement |
| **r/MachineLearning** | https://reddit.com/r/MachineLearning | Research framing |
| **MCP Discord** | https://discord.gg/modelcontextprotocol | #show-and-tell |
| **Anthropic Discord** | https://discord.gg/anthropic | Developer channels |
| **X / Twitter** | — | Tag @AnthropicAI @modelcontextprotocol |
| **LinkedIn** | — | Copy LAUNCH_POST.md |

**Show HN title:** `Show HN: Glass Box – MCP server that wraps any AI answer in a trust score`

---

### Claude Desktop Extension (DXT)
Package as `.mcpb` (Desktop Extension), submit to Anthropic for review.  
Docs: https://www.anthropic.com/engineering/desktop-extensions  
This gets you into Claude Desktop Settings → Extensions → Browse.

---

### Docker Hub
```bash
docker login
docker build -t thebarmaeffect/glassbox-mcp:1.0.3 -t thebarmaeffect/glassbox-mcp:latest .
docker push thebarmaeffect/glassbox-mcp --all-tags
```
Then visit https://hub.docker.com/repository/docker/thebarmaeffect/glassbox-mcp and add a description.

### GitHub Container Registry (GHCR)
Already in the Dockerfile — set up GitHub Actions to auto-push on every release.  
Add to `.github/workflows/docker.yml`:
```yaml
on:
  release:
    types: [published]
jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/thebarmaeffect/glassbox-mcp:${{ github.event.release.tag_name }}
```

---

### AI Alignment Forum / LessWrong
Write a post about the Glass Box approach to runtime constitutional verification.  
Frame it as: "What would it look like if every AI claim came with an explicit epistemic receipt?"  
- https://www.alignmentforum.org
- https://www.lesswrong.com

High-value: this community includes researchers at Anthropic, DeepMind, ARC.

---

### arXiv Preprint (cs.AI)
Write a 4–6 page paper describing the framework — ECS formula, Glassbox Court methodology, deterministic audit hashing. Submit to cs.AI.  
Once live, submit to **Papers With Code**: https://paperswithcode.com

---

## 📦 Package Manager Backlog

| Channel | Effort | Notes |
|---------|--------|-------|
| **conda-forge** | Done (PR #33462) | Awaiting reviewer approval |
| **Nixpkgs** | Medium | PR to NixOS/nixpkgs with a Nix derivation |
| **winget** | N/A | Requires Windows EXE/MSI installer — not applicable for Node |
| **homebrew-core** | Medium | PR to Homebrew/homebrew-core (requires stable 30-day-old release) |

---

## 🤖 AI Framework Integrations (PRs to write)

| Framework | What to submit |
|-----------|---------------|
| **LangChain** | Add a `GlassboxTool` wrapper in langchain-community |
| **LlamaIndex** | Add a tool in llama-hub |
| **OpenAI Agents SDK** | Add to MCP examples in openai/openai-agents-python |
| **CrewAI** | Add a GlassboxTool in crewAI-tools |

---

## 📊 Score Tracking

Once you've done the community posts, track:
- GitHub stars: https://github.com/TheBarmaEffect/glassbox
- npm weekly downloads: https://www.npmjs.com/package/@glassbox-framework/mcp
- PyPI stats: https://pypistats.org/packages/glassbox-framework
- Snyk Advisor score: https://snyk.io/advisor/npm-package/@glassbox-framework/mcp

---

Built by Karthik Barma · MS AI · Northeastern University | Powered by Aura.
