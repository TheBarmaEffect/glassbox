# Homebrew tap for Glassbox MCP

This directory holds the Homebrew formula that lets anyone install Glassbox MCP with a single command.

End users will run:

```bash
brew tap thebarmaeffect/glassbox
brew install glassbox-mcp
```

## How to publish the tap (one-time, done by Karthik)

Homebrew taps are just public GitHub repos with the prefix `homebrew-`. Three steps to get this live:

### 1. Publish the npm package first

The formula installs the package from npm, so the npm publish has to happen first.

```bash
cd /Users/hungrycheetah/Documents/GlassBox/mcp
npm login    # if not already logged in
npm publish --access public
```

After publish, get the SHA-256 for the tarball:

```bash
npm view @glassbox/mcp dist.tarball
# https://registry.npmjs.org/@glassbox/mcp/-/mcp-1.0.0.tgz
curl -fsSL $(npm view @glassbox/mcp dist.tarball) | shasum -a 256
# <hex>  -
```

### 2. Update the formula

Open `glassbox-mcp.rb` in this directory and replace the line:

```ruby
sha256 "REPLACE_ME_AFTER_NPM_PUBLISH"
```

with the SHA-256 you got above.

### 3. Push the tap repo

Create a new GitHub repo named **exactly** `homebrew-glassbox` under your account:

```bash
# https://github.com/new → repo name: homebrew-glassbox  (public, no README)

# Then locally:
mkdir -p ~/Documents/homebrew-glassbox/Formula
cp glassbox-mcp.rb ~/Documents/homebrew-glassbox/Formula/glassbox-mcp.rb
cd ~/Documents/homebrew-glassbox
git init
git add Formula/glassbox-mcp.rb
git commit -m "Glassbox MCP v1.0.0"
git remote add origin git@github.com:TheBarmaEffect/homebrew-glassbox.git
git push -u origin main
```

That's it. Anyone in the world can now do:

```bash
brew tap thebarmaeffect/glassbox
brew install glassbox-mcp
```

## How to update after a new release

1. Bump `version` in `mcp/package.json` and re-publish to npm.
2. Update `url` and `sha256` in `glassbox-mcp.rb`.
3. Commit and push the tap repo.

Users update with `brew upgrade glassbox-mcp`.

## Testing the formula locally before publishing the tap

```bash
brew install --build-from-source ./glassbox-mcp.rb
brew test glassbox-mcp
glassbox-mcp     # should print: "Glass Box MCP server running on stdio. Model: claude-sonnet-4-6"
```

Ctrl-C to exit.

## Caveats users will see

After install, the formula prints how to set `ANTHROPIC_API_KEY` and how to wire Glassbox into Claude Desktop. The one tool that works without an API key — `glassbox_generate_trust_card` — is called out so users can try the framework before they commit a key.

## Credit

Built by **Karthik Barma** · MS Artificial Intelligence · Northeastern University.
**Powered by Aura.**
