# syntax=docker/dockerfile:1.7

# Firecrawl Local, the web engine (Settings → Bots → Web reading), is left out by default because building it needs Rust
# and a few minutes. Build it in with: docker compose build --build-arg WITH_WEB_ENGINE=1
ARG WITH_WEB_ENGINE=0

# ---- install workspace dependencies ----
FROM oven/bun:1.4.4 AS deps
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/extension/package.json apps/extension/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --ignore-scripts

# ---- build the web app ----
FROM deps AS web
COPY . .
RUN bun run build:web

# ---- the web engine, when it was asked for (WITH_WEB_ENGINE=1) ----
FROM oven/bun:1.4.4-slim AS webengine-0
RUN mkdir -p /out/bin

FROM rust:1 AS webengine-1
RUN cargo install firecrawl-local --locked --root /out

FROM webengine-${WITH_WEB_ENGINE} AS webengine

# ---- runtime: API server + built web app ----
FROM oven/bun:1.4.4-slim AS runtime
# Node/npm, git and curl let stdio MCP servers run via npx (most are published that way).
# ssh reaches bots' computers and devboxes; Chromium is the browser for bots without a computer.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git nodejs npm openssh-client chromium fonts-noto-core \
	&& rm -rf /var/lib/apt/lists/*
ENV SEKAI_BROWSER_PATH=/usr/bin/chromium
# Empty unless the image was built with WITH_WEB_ENGINE=1.
COPY --from=webengine /out/bin/ /usr/local/bin/
WORKDIR /app
ENV NODE_ENV=production ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json bun.lock biome.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/extension/package.json apps/extension/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @sekai/server
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=web /app/apps/web/dist apps/web/dist

ENV SEKAI_HOST=0.0.0.0 SEKAI_PORT=7420 SEKAI_DATA_DIR=/data
EXPOSE 7420
VOLUME ["/data"]
CMD ["bun", "run", "apps/server/src/index.ts"]
