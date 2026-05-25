# Glass Box Framework — MCP server image.
#
# Single-command Docker install:
#
#   docker run --rm -i \
#     -e ANTHROPIC_API_KEY="sk-ant-..." \
#     ghcr.io/thebarmaeffect/glassbox-mcp:latest
#
# The container speaks MCP over stdio (the protocol's standard transport),
# so `-i` is required. Pipe JSON-RPC requests to stdin and read responses
# from stdout. Or wire into Claude Desktop as a Docker-launched server:
#
#   "mcpServers": {
#     "glass-box": {
#       "command": "docker",
#       "args": ["run", "--rm", "-i",
#                "-e", "ANTHROPIC_API_KEY",
#                "ghcr.io/thebarmaeffect/glassbox-mcp:latest"],
#       "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
#     }
#   }

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /build

# Install only what's needed to compile TS → JS.
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npx tsc --outDir /build/dist && \
    cp -r src /build/src-original

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app

# Non-root user — MCP servers don't need root.
RUN addgroup -S glassbox && adduser -S glassbox -G glassbox

# Bring in only the production deps + compiled JS.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && \
    rm -rf /root/.npm
COPY --from=builder /build/dist ./dist
COPY README.md LICENSE ./

# Run as non-root.
USER glassbox

# MCP servers speak over stdio. There's no port to expose.
# stdin/stdout is the transport.
ENV NODE_ENV=production
ENV GLASSBOX_MODEL=claude-sonnet-4-6

# Single entry — the compiled MCP server.
ENTRYPOINT ["node", "dist/index.js"]

# Labels for the GitHub Container Registry UI.
LABEL org.opencontainers.image.title="Glass Box Framework MCP server"
LABEL org.opencontainers.image.description="Runtime constitutional verification for AI answers — 6 tools, ECS scoring, 7-angle red team, deterministic audit logs."
LABEL org.opencontainers.image.authors="Karthik Barma <thebarmaeffect@gmail.com>"
LABEL org.opencontainers.image.source="https://github.com/TheBarmaEffect/glassbox"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.version="1.0.0"
