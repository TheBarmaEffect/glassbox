# Glassbox · Distribution channels

Every place a developer can install Glassbox. Status as of this commit.

## Live

### PyPI

```bash
pip install glassbox-framework
```

- **Status**: ✅ **PUBLISHED** — https://pypi.org/project/glassbox-framework/1.0.0/
- Verified: fresh-venv install + end-to-end `generate_trust_card` returns the canonical deterministic audit log_id (`glassbox-85cc09903bd4b3f8022a4087`).

## Ready, awaiting credentials

### npm (`@glassbox-framework/mcp`)

```bash
npm install -g @glassbox-framework/mcp
glassbox-mcp          # runs the MCP server on stdio
```

- **Status**: ⏸  ready, blocked on a 2FA-bypass token. The token Karthik supplied was a Classic token; npm now requires either a **Granular Access Token with "Bypass 2FA" enabled** or an **Automation Token**. Create one at https://www.npmjs.com/settings/<user>/tokens and re-publish.
- Dry-run publish confirmed clean: 34.4 KB tarball, 15 files, name reserved.

### Homebrew (`brew install glassbox-mcp`)

```bash
brew tap thebarmaeffect/glassbox
brew install glassbox-mcp
```

- **Status**: ⏸ formula written ([`homebrew/glassbox-mcp.rb`](homebrew/glassbox-mcp.rb)), tap setup steps documented ([`homebrew/README.md`](homebrew/README.md)).
- Depends on the npm publish above (the formula installs the `@glassbox-framework/mcp` npm package). Becomes live once npm is unblocked and Karthik pushes the formula to `TheBarmaEffect/homebrew-glassbox`.

### Docker / GitHub Container Registry

```bash
docker run --rm -i \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  ghcr.io/thebarmaeffect/glassbox-mcp:latest
```

- **Status**: ⏸  [`Dockerfile`](Dockerfile) + [`.dockerignore`](.dockerignore) shipped, multi-stage build (node:20-alpine → ~80 MB final image).
- To publish:
  ```bash
  cd /Users/hungrycheetah/Documents/GlassBox/mcp
  docker build -t ghcr.io/thebarmaeffect/glassbox-mcp:1.0.0 .
  docker tag ghcr.io/thebarmaeffect/glassbox-mcp:1.0.0 ghcr.io/thebarmaeffect/glassbox-mcp:latest

  # one-time auth (PAT with write:packages scope, from github.com/settings/tokens)
  echo "$GHCR_TOKEN" | docker login ghcr.io -u TheBarmaEffect --password-stdin

  docker push ghcr.io/thebarmaeffect/glassbox-mcp:1.0.0
  docker push ghcr.io/thebarmaeffect/glassbox-mcp:latest
  ```
- Karthik to provide a GitHub PAT with `write:packages` scope to publish.

### Smithery.ai (the MCP marketplace)

- **Status**: ⏸ [`smithery.yaml`](smithery.yaml) manifest shipped at the repo root. Registers the four configuration options (API key, model, max-tokens, ECS mode) with their schema.
- To register:
  1. Sign in to https://smithery.ai with GitHub
  2. Add the `TheBarmaEffect/glassbox` repo
  3. Smithery auto-detects `smithery.yaml` and lists Glassbox in the marketplace
- Smithery is how MCP-aware tools (Claude Desktop, Cursor, Cline, Continue) discover servers without manual config. Highest-leverage non-package channel right now.

### MCP Servers official registry

- **Status**: ⏸  ready to submit. The official MCP servers list lives at https://github.com/modelcontextprotocol/servers. Submission is a single PR adding a row to README.md.
- Submission template (Karthik to PR):
  ```markdown
  - **[Glassbox](https://github.com/TheBarmaEffect/glassbox)** —
    Runtime constitutional verification for AI answers. Claim-level reasoning
    chains, formal Epistemic Confidence Score, 7-angle red team (Glassbox
    Court), deterministic audit logs.
  ```

### conda-forge

```bash
conda install -c conda-forge glassbox-framework
```

- **Status**: ⏸ feedstock not yet submitted. Add later via a PR to https://github.com/conda-forge/staged-recipes with a `recipes/glassbox-framework/meta.yaml`. Low priority — the audience overlaps heavily with the PyPI users.

## What's intentionally NOT in scope

- **Cargo / Rust** — no Rust client written; would require a separate impl
- **Maven / Java / Kotlin** — same, big lift, no demand signal yet
- **NuGet / .NET** — same
- **Snap / Flatpak / AUR** — Linux distribution; users can already use the Docker image
- **Chocolatey (Windows)** — possible later; npm install works on Windows via PowerShell already

## Token rotation reminder (read carefully)

The PyPI token used for this publish was visible in the chat transcript. **Rotate it now**:

1. Visit https://pypi.org/manage/account/token/
2. Revoke the token starting `pypi-AgEIcHlwaS5vcmcC...`
3. Create a new one, scoped to the `glassbox-framework` project only (not account-wide)
4. Store it in `~/.pypirc` or an env-var loader, not in chat

Same drill for the npm token once you create the 2FA-bypass version.

---

## Order of next operations (when you're back at the keyboard)

```bash
# 1. Make a new npm Automation Token, then:
NPM_TOKEN_NEW=npm_xxxxxxxxxxxx
TMP=$(mktemp); echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN_NEW" > "$TMP"
cd /Users/hungrycheetah/Documents/GlassBox/mcp
npm publish --userconfig "$TMP" --access public
rm "$TMP"

# 2. Capture the npm tarball SHA-256 for the Homebrew formula
SHA=$(curl -fsSL https://registry.npmjs.org/@glassbox-framework/mcp/-/mcp-1.0.0.tgz | shasum -a 256 | awk '{print $1}')
echo "Paste this into homebrew/glassbox-mcp.rb: $SHA"

# 3. Update the brew formula's sha256 field and push to tap repo
#    (see homebrew/README.md)

# 4. Build + push Docker image (needs GHCR_TOKEN from github.com/settings/tokens)
docker build -t ghcr.io/thebarmaeffect/glassbox-mcp:1.0.0 .
echo "$GHCR_TOKEN" | docker login ghcr.io -u TheBarmaEffect --password-stdin
docker push ghcr.io/thebarmaeffect/glassbox-mcp:1.0.0

# 5. Submit to Smithery.ai (one-click via the website)

# 6. Open PR to modelcontextprotocol/servers (README addition)

# 7. Rotate both tokens
```

Built by **Karthik Barma** · MS AI · Northeastern University. **Powered by Aura.**
