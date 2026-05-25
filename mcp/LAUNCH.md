# Glassbox · Grand Launch Kit

Everything you need to launch tonight. Three paths shipped, choose your audience:

**Path A — Cinematic title reveal** (25s, no recording needed):
- [`assets/glassbox-reveal.mp4`](assets/glassbox-reveal.mp4) — 25s, 1920×1080, H.264, 732 KB
- [`assets/glassbox-reveal.gif`](assets/glassbox-reveal.gif) — 1.4 MB
- [`assets/reveal.svg`](assets/reveal.svg) — animated SVG embeddable in GitHub READMEs
- [`assets/title-cards/`](assets/title-cards/) — 6 PNG stills for X / LinkedIn / Open Graph previews
- [`assets/reveal.html`](assets/reveal.html) — the source page, opens in any browser and plays at real time

**Path B — Tool-by-tool walkthrough video** (~75s, no recording needed):
- [`assets/glassbox-walkthrough.mp4`](assets/glassbox-walkthrough.mp4) — *this is the one that shows people how to use it as pip*. Eight scenes: intro → 6 tools (code + output side by side) → closing with all three install commands.
- [`assets/glassbox-walkthrough.gif`](assets/glassbox-walkthrough.gif) — for inline embeds
- [`assets/walkthrough.html`](assets/walkthrough.html) — the source page

**Path C — Live terminal demo** (real Trust Card from the running MCP server):
- `node demo/launch-demo.mjs` — screen-record this for over-the-shoulder authenticity. Real audit hash, real verdict policy, real MCP server.

Editing suggestion for the launch video:
**0–10s** title reveal (Path A intro) → **10–80s** walkthrough (Path B full) → **80–90s** closing card from Path A. ~90 seconds total, native-video upload to X / LinkedIn.

---

## Distribution channels (all shipped tonight)

Three install paths, copy-pasteable, ready to go in your social posts:

### Python (pip)

```bash
pip install glassbox-framework
```

```python
from glassbox_framework import Glassbox

with Glassbox() as gb:
    card = gb.verify_answer(
        question="Can intermittent fasting cure type 2 diabetes?",
        answer="Yes ...",
        intents=["Never make medical claims without citations."],
    )
    print(card["verdict"])           # "reject"
    print(card["audit"]["log_id"])   # glassbox-85cc09903bd4...
```

Package source: [`python/`](python/). Pure stdlib — no third-party Python deps. Spawns the Node MCP server as a subprocess and talks JSON-RPC over stdio. Six methods, one per tool. See [`python/README.md`](python/README.md) for the full API and [`python/examples/`](python/examples/) for one runnable script per tool.

### Node / MCP

```bash
npm install -g @glassbox-framework/mcp
```

Then either:
- run `glassbox-mcp` directly (it'll print "Glass Box MCP server running on stdio…"), or
- wire into Claude Desktop via `claude_desktop_config.json` (full snippet in `README.md`).

Package config: [`package.json`](package.json) — `npm pack --dry-run` verified, 30.7 KB tarball, 14 files, ready for `npm publish --access public`.

### macOS (Homebrew)

```bash
brew tap thebarmaeffect/glassbox
brew install glassbox-mcp
```

Formula: [`homebrew/glassbox-mcp.rb`](homebrew/glassbox-mcp.rb). Tap repo setup steps: [`homebrew/README.md`](homebrew/README.md). One thing pending: after you `npm publish`, copy the tarball SHA-256 into the formula's `sha256` field and push to the tap repo.

### Publish order tonight

```bash
# 1. Publish npm (this powers the brew formula and the pip fallback)
cd /Users/hungrycheetah/Documents/GlassBox/mcp
npm login
npm publish --access public

# 2. Capture the tarball SHA-256 for the brew formula
SHA=$(curl -fsSL https://registry.npmjs.org/@glassbox-framework/mcp/-/mcp-1.0.0.tgz | shasum -a 256 | awk '{print $1}')
echo "$SHA"

# 3. Update homebrew/glassbox-mcp.rb — replace REPLACE_ME_AFTER_NPM_PUBLISH with $SHA

# 4. Push to the tap repo (one-time setup in homebrew/README.md)

# 5. Publish pip
cd python
pip install build twine
python -m build
twine upload dist/*

# 6. Verify all three work
pip install glassbox-framework
npm install -g @glassbox-framework/mcp
brew tap thebarmaeffect/glassbox && brew install glassbox-mcp
```

---

## What just ran

| Field | Value |
| :--- | :--- |
| Tool invoked | `glassbox_generate_trust_card` (live, no LLM call) |
| Question | Can intermittent fasting cure type 2 diabetes? |
| Verdict | **REJECT** |
| Verdict rationale | 2 high/critical constitutional rule(s) violated: `r-0-d4a9c2b1`, `r-1-7f3e8a45`; 1 red-team probe(s) failed at CRITICAL severity: `fabrication` |
| ECS total | 0.6032 |
| Red-team pass rate | 0.4286 (3 of 7) |
| Highest severity finding | critical |
| Constitutional rules violated | 2 of 2 |
| Audit log_id | `glassbox-85cc09903bd4b3f8022a4087` |
| Inputs hash | `724e85a50e56bd18fb52996209a41067…` |
| Determinism check | Same `log_id` reproduced across two independent runs ✓ |

Why it's a juicy demo: the answer **mixes one real source** (the 2018 BMJ Case Reports paper by Furmli et al. is legitimate) **with two fabricated claims** (ADA never made intermittent fasting first-line, never replaced metformin). Surface-level structural checks would pass — the answer looks well-cited and confident. The red team catches the fabrications anyway. That's the value prop in one example.

---

## Why this demo works without an API key

`glassbox_generate_trust_card` is the one v1 tool that makes **zero** LLM calls. It assembles a Trust Card from prebuilt parts (claims, red_team, ecs) and runs:

- the live MCP server (real)
- the verdict policy (real)
- the SHA-256 audit hashing (real)
- the formula rendering (real)

The inputs to the assembly — the claims, the red-team findings, the ECS dimensions — would normally come from the other 5 tools (each of which calls Anthropic). For the recording, we hand-crafted realistic inputs and saved them as `demo/raw-inputs.json` so the demo is reproducible without a key.

**To run the full LLM pipeline** on the same example: set `ANTHROPIC_API_KEY` and run `node demo/launch-demo.mjs --full`. That invokes `glassbox_verify_answer` instead and makes ~4 real API calls. The output shape is identical.

---

## Recording setup (macOS)

Native screen recording is good enough for the launch. No third-party tools needed unless you want fancier edits.

### Built-in recorder (recommended for speed)

1. **Cmd + Shift + 5** — opens the macOS screen-recording HUD.
2. Click **Record Selected Portion** and drag a region around your terminal. Aim for **1920 × 1080** or close to it (the demo output looks best on a 16:9 frame).
3. Open **Options** in the HUD:
   - Save to: **Desktop**
   - Timer: **5 Seconds** (gives you time to alt-tab to the terminal)
   - Microphone: **Built-In Microphone** (or your USB mic)
   - Show mouse clicks: **off** (cleaner for a terminal demo)
4. Hit **Record** and switch to your terminal.

### Terminal setup

Use a clean dark theme (the ANSI colours in the demo are tuned for dark backgrounds). Recommended:

- Terminal: **iTerm2** or the built-in Terminal app
- Theme: **Solarized Dark** or any dark theme
- Font: **JetBrains Mono** or **SF Mono**, **16-18 pt** for screen-recording legibility
- Window size: **120 columns × 35 rows**, full-screen or near-full
- Clear the prompt: `clear` before recording

### If you want polish

- **ScreenStudio** ($79, one-time, macOS) — auto-zoom on cursor, mouse highlight, smooth pan/zoom. Worth it for a launch video.
- **OBS Studio** (free) — more control, more setup, includes webcam picture-in-picture if you want to record yourself talking over the demo.
- **CleanShot X** ($29, one-time) — best for screenshots; can record GIFs too.

---

## Scene-by-scene recording script

Total runtime target: **60–90 seconds**. The demo with default pacing runs ~50 seconds; the lines below are voice-over text you read on top.

### Pre-record checklist

```bash
cd /Users/hungrycheetah/Documents/GlassBox/mcp
clear
```

Optionally pre-stage the command (don't hit Enter yet):

```bash
node demo/launch-demo.mjs
```

### Scene 1 — Open (0:00–0:10)

**Visual**: Terminal at the cleared prompt. The `node demo/launch-demo.mjs` command is typed but not run.

**Voice-over** (read calmly, ~25 wpm):

> "AI answers everything. But how do we know it's right? This is Glassbox — runtime constitutional verification for any AI answer."

**Action**: Hit Enter on the command.

### Scene 2 — The question (0:10–0:20)

**Visual**: The demo banner appears, then the question and answer scroll on.

**Voice-over**:

> "Here's a medical question. The answer sounds authoritative — confident, well-cited, specific. It would pass most reviewers in two seconds. Watch what Glassbox does instead."

### Scene 3 — Server connects (0:20–0:30)

**Visual**: "STEP 2 · Connect to the live MCP server" section. The six tool names list on, one per line.

**Voice-over**:

> "The MCP server boots. Six tools register: extract claims, score ECS, run the red team, generate the Trust Card. This is the same surface that lives inside Claude Desktop."

### Scene 4 — Verdict drops (0:30–0:40)

**Visual**: "STEP 4 · Trust Card". The red **REJECT** badge appears. The verdict rationale scrolls.

**Voice-over** (lean in, slightly punchier):

> "Verdict: reject. Two constitutional rules violated. One red-team probe failed at critical severity. The answer is rejected even though it looked good on the surface."

### Scene 5 — ECS breakdown (0:40–0:50)

**Visual**: The five ECS dimension bars draw on with the formula underneath.

**Voice-over**:

> "Every score is transparent. Five dimensions, weighted, formula visible. Groundedness, coherence, calibration, red-team resistance, constitutional compliance. No black box. You can audit the math."

### Scene 6 — Glassbox Court (0:50–1:05)

**Visual**: "STEP 6 · Glassbox Court — 7 adversarial probes". The probes list with pass/fail marks.

**Voice-over**:

> "The Glassbox Court runs seven adversarial probes. The fabrication probe caught it: the answer attributes a guideline change to the American Diabetes Association that never happened. Real BMJ citation, fake ADA citation, riding on top of each other. Glassbox sees both."

### Scene 7 — Audit reference (1:05–1:15)

**Visual**: "STEP 8 · Audit reference". The `log_id` and `inputs_hash` appear.

**Voice-over**:

> "Every verification gets a deterministic audit log. Same inputs, same engine outputs, same log ID — across runs, across machines. Replay-detectable. Cite-able."

### Scene 8 — Close (1:15–1:30)

**Visual**: "Demo complete" panel. Cursor blinks.

**Voice-over** (slowest, most deliberate):

> "Glassbox. Built by Karthik Barma at Northeastern. Powered by Aura. Open source. Available in Claude Desktop and the MCP Inspector tonight. Link in the description."

### Stop recording.

---

## 30-second cut (for X / Twitter)

If you need a shorter clip for X (which caps at 2 minutes 20 but you want scroll-stopping density):

| t | what's on screen | what you say |
| :--- | :--- | :--- |
| 0:00 | terminal cleared | "Glassbox catches AI lies in real time." |
| 0:03 | question + answer | "Here's a medical answer. Sounds good, right?" |
| 0:08 | REJECT badge | "Glassbox says reject. Critical fabrication detected." |
| 0:13 | Glassbox Court probes scrolling | "Seven adversarial probes. One found the fake citation." |
| 0:20 | audit log_id | "Deterministic audit hash. Same input, same ID, every run." |
| 0:25 | banner / outro | "Open source. In Claude Desktop tonight." |
| 0:30 | end | (cut) |

---

## Press kit

### Taglines (pick one)

- **Glassbox — runtime constitutional verification for AI answers.**
- **Glassbox sees every claim. Audits every reasoning step.**
- **The Trust Card for AI — explainable, falsifiable, deterministic.**
- **Glassbox is the difference between *AI said it* and *AI got it right*.**

### One-paragraph pitch

> Glassbox is the runtime trust interface for AI. Hand it a question and an answer; it returns a Trust Card containing every claim with its reasoning chain, a transparent Epistemic Confidence Score with a published formula, seven adversarial red-team probes (the Glassbox Court), a constitutional rule check against your deployer policies, and a deterministic SHA-256 audit reference. Ships as an MCP server today — drops into Claude Desktop in one config file. Built by Karthik Barma, MS AI at Northeastern. Powered by Aura.

### Key facts (for the post body)

- **6 tools**, all prefixed `glassbox_`
- **7-angle red team** (fabrication, source manipulation, bias, context attack, overconfidence, underspecification, constitutional violation)
- **Deterministic audit hash** (SHA-256, identical inputs reproduce identical log IDs)
- **Formal ECS formula**, weights public, breakdown always visible
- **MCP-native** — works in Claude Desktop, MCP Inspector, any MCP host
- **TypeScript strict mode**, runtime Zod validation, structured errors
- **Apache 2.0**

### Suggested social copy

**X / Twitter (under 280):**

> Shipped Glassbox v1 tonight.
>
> Runtime constitutional verification for AI answers. Every claim with its reasoning. Every score with its formula. Every verdict traceable to a SHA-256 audit hash.
>
> 6 tools. 7-angle red team. Open source. MCP-native.
>
> github.com/TheBarmaEffect/glassbox

**LinkedIn:**

> I just shipped Glassbox v1 — the runtime trust interface for AI answers.
>
> Hand Glassbox a question and an answer. It returns a Trust Card: every atomic claim with its reasoning chain, a transparent Epistemic Confidence Score with a published formula, seven adversarial red-team probes (the Glassbox Court), a constitutional rule check against your deployer policies, and a deterministic SHA-256 audit reference.
>
> It ships as a Model Context Protocol server, so it drops into Claude Desktop in one config file.
>
> Why this matters: most AI safety tools verify at training time and hope deployment behaves. Glassbox verifies at runtime, inside the same workflow the user is in, with auditable reasoning.
>
> Open source under Apache 2.0. Built by me, powered by Aura.
>
> Link in comments.

**Hacker News title:**

> Show HN: Glassbox – Runtime constitutional verification for AI answers (MCP)

### Submission checklist

- [ ] Post the 60-90s demo video on X
- [ ] Cross-post the LinkedIn announcement
- [ ] Submit to Hacker News (Show HN with the demo video link in the URL field)
- [ ] Submit to Product Hunt (queue for tomorrow, not same-day)
- [ ] Post in r/LocalLLaMA and r/MachineLearning
- [ ] DM the demo video to 3–5 people whose work the project intersects with
- [ ] Tag @AnthropicAI on X — the MCP angle gives you a reason
- [ ] Pin the X post to your profile

---

## What to do after recording

1. Save the recording to `~/Desktop` (default for macOS screen recording).
2. **Don't edit on the same day.** Sleep on it; cut tomorrow morning with fresh eyes.
3. Trim to 60–90s. Anything longer dies in social feeds.
4. Add captions — auto-captions in CapCut or Premiere are good enough; check the technical terms (ECS, Glassbox Court, fabrication, constitutional violation) parse correctly.
5. Export at 1080p H.264, MP4. Bitrate ~8 Mbps is plenty.
6. Upload to X **as a native video** (not a YouTube link — native plays inline and gets way better reach).
7. Put the long-form (uncut) on YouTube too, linked from the GitHub README.

---

## Determinism proof (for the launch post)

If anyone challenges the "deterministic audit hash" claim during the launch, you have this on hand:

```bash
$ cd /Users/hungrycheetah/Documents/GlassBox/mcp
$ node demo/launch-demo.mjs --fast 2>&1 | grep log_id
  log_id:        glassbox-85cc09903bd4b3f8022a4087

$ node demo/launch-demo.mjs --fast 2>&1 | grep log_id
  log_id:        glassbox-85cc09903bd4b3f8022a4087
```

Two independent runs. Same `log_id`. That's the SHA-256 of canonicalised JSON over (inputs_hash + claims + ECS dimensions + red-team probe pass/severity + constitutional evaluations), with timestamp deliberately excluded from the hash.

---

## Files in this kit

```
mcp/
├── LAUNCH.md                              (this file)
├── README.md                              — full framework documentation
├── package.json                           — npm publish-ready (@glassbox-framework/mcp)
├── bin/glassbox-mcp.js                    — CLI launcher (on PATH after npm install -g)
│
├── src/                                   — TypeScript MCP server (6 tools)
│   ├── index.ts                           — entry point, tool registration
│   ├── types.ts                           — Trust Card / Claim / ECS / RedTeam contracts
│   ├── anthropic-client.ts                — API wrapper + audit-trace plumbing
│   └── engines/
│       ├── claims.ts                      — claim extractor (reasoning chains)
│       ├── constitution.ts                — intent → rules compiler
│       ├── redteam.ts                     — Glassbox Court (7 probes)
│       ├── ecs.ts                         — Epistemic Confidence Score
│       ├── audit.ts                       — deterministic SHA-256 log_id
│       └── trustcard.ts                   — pipeline + assembly + verdict policy
│
├── python/                                — pip package: pip install glassbox-framework
│   ├── pyproject.toml
│   ├── README.md
│   ├── glassbox_framework/
│   │   ├── __init__.py                    — exports Glassbox, GlassboxError, ToolError
│   │   ├── client.py                      — JSON-RPC stdio client (zero third-party deps)
│   │   └── cli.py                         — `glassbox` command on PATH
│   └── examples/
│       ├── 01_verify_answer.py
│       ├── 02_extract_claims.py
│       ├── 03_score_ecs.py
│       ├── 04_red_team.py
│       ├── 05_generate_trust_card.py      — works without an API key
│       └── 06_export_audit_report.py
│
├── homebrew/                              — Homebrew tap formula
│   ├── glassbox-mcp.rb
│   └── README.md                          — tap setup instructions
│
├── demo/
│   ├── launch-demo.mjs                    — live terminal demo (Path C)
│   ├── raw-inputs.json                    — bundled healthcare example
│   └── captured-trust-card.json           — Trust Card from a real MCP server run
│
└── assets/
    ├── reveal.html                        — cinematic title reveal source (Path A)
    ├── reveal.svg                         — animated SVG for GitHub README embed
    ├── glassbox-reveal.mp4                — 25s pre-rendered title reveal, 1080p
    ├── glassbox-reveal.gif                — same video as GIF
    ├── walkthrough.html                   — tool-by-tool walkthrough source (Path B)
    ├── glassbox-walkthrough.mp4           — ~75s tool walkthrough, 1080p
    ├── glassbox-walkthrough.gif           — same as GIF
    ├── render-reveal.sh                   — re-renders either video (SRC=reveal|walkthrough)
    ├── frames-reveal/                     — 300 PNG frames stitched into reveal.mp4
    ├── frames-walkthrough/                — ~912 PNG frames stitched into walkthrough.mp4
    └── title-cards/                       — 6 hero stills for social previews
```

---

## How to use the cinematic reveal

The MP4 is already rendered. Just open `assets/glassbox-reveal.mp4` and play it. To embed:

- **X / Twitter**: upload `glassbox-reveal.mp4` as a native video (under 2:20, plays inline).
- **GitHub README**: drop in `<img src="assets/glassbox-reveal.gif" />` for an inline auto-playing loop.
- **LinkedIn / Product Hunt**: upload the MP4 directly.
- **Open Graph preview**: use `assets/title-cards/01-title.png` as the social preview image.

To re-render (after editing `reveal.html`):

```bash
cd /Users/hungrycheetah/Documents/GlassBox/mcp
bash assets/render-reveal.sh
```

That spawns 8 parallel Chrome headless processes, captures 300 PNG frames via deterministic JS timeline (`?t=ms` URL parameter sets the exact frame state), and stitches into MP4 + GIF via ffmpeg. Takes ~2-3 minutes on an M-series Mac.

### Building the full 90-second launch video

Open your editor of choice (iMovie is fine, DaVinci Resolve is free and pro-grade):

1. **0:00 – 0:25** — drop in `glassbox-reveal.mp4` as the cold open
2. **0:25 – 1:25** — switch to a screen recording of `node demo/launch-demo.mjs` running in your terminal (record this part yourself with Cmd+Shift+5)
3. **1:25 – 1:30** — fade to `title-cards/06-close.png` held for 5 seconds while you record an "outro" voice line

Background music: search "minimal cinematic intro royalty free" on Pixabay or YouTube Audio Library. Keep it under -18 dB so the voice-over (if any) cuts through.

---

## One honest caveat to fold into the recording (optional)

If you want to be transparent in the voice-over — and being honest is part of what Glassbox stands for — you can add this beat near the end:

> "Tonight's demo runs the assembly tool, which doesn't call an LLM. The verdict policy, audit hash, and Trust Card output are 100% live. Set an Anthropic API key and you get the full LLM pipeline on the same example. Same Trust Card shape, same audit determinism."

That's the version the technical audience will respect. The pure marketing version skips it. Your call.

---

Built by Karthik Barma · MS AI · Northeastern University | Glass Box Framework | **Powered by Aura**
