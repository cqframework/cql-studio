# Build from the monorepo root:
#   docker build -f opencode/Dockerfile -t hlseven/quality-cql-studio-opencode:latest .

FROM node:26-bookworm-slim

LABEL maintainer="Preston Lee"
WORKDIR /app

COPY package.json package-lock.json ./
COPY core/package.json core/tsconfig.json ./core/
COPY core/src ./core/src
COPY opencode/package.json opencode/tsconfig.json ./opencode/
COPY opencode/src ./opencode/src
COPY server/package.json ./server/
COPY ui/package.json ./ui/

# opencode-ai ships a platform stub plus optionalDeps (opencode-linux-x64 /
# opencode-linux-arm64, …). Its postinstall links the matching native binary for
# the build arch. Drone builds amd64 and arm64 on native runners (not QEMU), so
# npm selects the correct optionalDep per image. Root package.json allowScripts
# permits the postinstall during npm ci; re-run it after prune because
# --ignore-scripts would otherwise leave the stub and cause spawn ENOEXEC.
RUN npm ci --workspace=@cql-studio/opencode --workspace=@cql-studio/core --include-workspace-root
RUN npm run build --workspace=@cql-studio/core \
  && npm run build --workspace=@cql-studio/opencode \
  && npm prune --omit=dev --ignore-scripts --workspace=@cql-studio/opencode --workspace=@cql-studio/core --include-workspace-root \
  && node node_modules/opencode-ai/postinstall.mjs \
  && node_modules/.bin/opencode --version

# MarkItDown converts PDF and DOCX attachments to bounded Markdown before they
# are exposed to the OpenCode session. Keep it in an isolated virtualenv so
# the Node runner remains the only application process.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && python3 -m venv /opt/markitdown \
  && /opt/markitdown/bin/pip install --no-cache-dir 'markitdown[pdf,docx]==0.1.7' \
  && rm -rf /var/lib/apt/lists/*

# MarkItDown must resolve on PATH at runner startup (assertMarkitdownAvailable).
ENV PATH="/opt/markitdown/bin:/app/node_modules/.bin:${PATH}"
ENV CQL_STUDIO_OPENCODE_NODE_ENV=production
ENV CQL_STUDIO_OPENCODE_RUNNER_PORT=4097
ENV CQL_STUDIO_OPENCODE_INTERNAL_PORT=4096
ENV CQL_STUDIO_OPENCODE_WORKSPACE_ROOT=/workspaces

# Production images require a non-default runner token (≥32 bytes). Compose
# overrides CQL_STUDIO_OPENCODE_NODE_ENV=development for local stacks that use
# the shared dev token.
RUN mkdir -p /workspaces && chown -R node:node /app /workspaces
USER node
WORKDIR /app/opencode

EXPOSE 4097
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4097/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/runner.js"]
