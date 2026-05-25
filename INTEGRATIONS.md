# Glassbox · MCP Client Integrations

The Glassbox server (`@glassbox-framework/mcp`) is **plain MCP over stdio** — anything that speaks the protocol can use it. Below are copy-paste configs for every major MCP host.

Common prerequisites (one-time per machine):
- Node 18+
- `ANTHROPIC_API_KEY` in your environment (the one exception, `glassbox_generate_trust_card`, works without a key)

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop. The six tools appear under the 🔌 menu.

## Claude Code (CLI)

`~/.claude.json` (global) or `.claude.json` (per-project):

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

Tools surface as `mcp__glass-box__glassbox_*`.

## Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

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

Settings → MCP → reload. The tools appear in the model picker.

## Cline (VS Code extension)

VS Code → Cline panel → ⚙️ → MCP Servers → Edit:

```json
{
  "glass-box": {
    "command": "npx",
    "args": ["-y", "@glassbox-framework/mcp"],
    "env": { "ANTHROPIC_API_KEY": "sk-ant-..." },
    "disabled": false,
    "autoApprove": []
  }
}
```

## Continue.dev

`~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: glass-box
    command: npx
    args:
      - "-y"
      - "@glassbox-framework/mcp"
    env:
      ANTHROPIC_API_KEY: sk-ant-...
```

## Zed

`~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "glass-box": {
      "command": {
        "path": "npx",
        "args": ["-y", "@glassbox-framework/mcp"],
        "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
      }
    }
  }
}
```

## Roo Code / Cody / other VS Code MCP-aware extensions

Same JSON shape as Cline above; consult the extension's settings UI for where to paste.

## Direct via the Anthropic API

Pseudo-code; the Anthropic SDK MCP helpers handle the mechanics:

```python
from glassbox_framework import Glassbox
import anthropic

with Glassbox() as gb:
    tools = gb.list_tools()
    response = anthropic.Anthropic().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        tools=tools,
        messages=[{"role": "user", "content": "Verify this answer: ..."}],
    )
```

## Docker (any host, any OS)

```json
{
  "mcpServers": {
    "glass-box": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "ANTHROPIC_API_KEY",
        "ghcr.io/thebarmaeffect/glassbox-mcp:latest"
      ],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

(Image push to GHCR is documented in [`mcp/DISTRIBUTION.md`](mcp/DISTRIBUTION.md).)

## Connectors (claude.ai web)

Anthropic's web app's **Connectors** tab will surface MCP Registry-listed servers. Glassbox is listed as `io.github.TheBarmaEffect/glassbox-framework` — search "Glassbox" in the connectors dialog and click Connect.

## Smithery.ai

If your MCP host integrates with the Smithery marketplace (Cursor and Cline both do as of 2026), search "glassbox-framework" in their built-in marketplace UI and click Install. Smithery auto-injects the same npx-based config above.

## Verification command (works for all of the above)

After adding the config and restarting your host:

```
Ask: "verify_answer on the question 'Can intermittent fasting cure type 2 diabetes?' against the AI response 'Yes, the ADA officially recommends fasting as first-line treatment.' with the intent 'never make medical claims without citing sources'"
```

You should get a Trust Card back with `verdict: reject` and a detailed Glassbox Court breakdown identifying the fabricated ADA citation.

---

Built by **Karthik Barma** · MS AI · Northeastern University. **Powered by Aura.**
