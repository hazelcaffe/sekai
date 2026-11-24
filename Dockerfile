# syntax=docker/dockerfile:1.7

# Firecrawl Local, the web engine (Settings → Bots → Web reading), is left out by default because building it needs Rust
# and a few minutes. Build it in with: docker compose build --build-arg WITH_WEB_ENGINE=1
ARG WITH_WEB_ENGINE=0
# signal-cli, for bots' Signal accounts (a bot's Accounts → Signal), is left out by default too (it's about 400 MB).
# Build it in with: docker compose build --build-arg WITH_SIGNAL=1 (x86_64 only: it's signal-cli's native build).
ARG WITH_SIGNAL=0

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

# ---- signal-cli, when it was asked for (WITH_SIGNAL=1): the release and checksum Sekai pins (signal/engine.ts) ----
FROM oven/bun:1.4.4-slim AS signal-0
RUN mkdir -p /out/bin

FROM debian:trixie-slim AS signal-1
ARG TARGETARCH
ARG SIGNAL_CLI_VERSION=0.14.10
ARG SIGNAL_CLI_SHA256=db9297789c5bbc6131df505d2f37abe43efa0b54200585f5e56b478e1cd93916
RUN if [ "${TARGETARCH:-amd64}" != "amd64" ]; then \
		echo "signal-cli's native build is x86_64 only. On ${TARGETARCH}, install Java 21+ and its JVM build in the image yourself and set SIGNAL_CLI." >&2; \
		exit 1; \
	fi \
	&& apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
	&& curl -fsSL -o /tmp/signal-cli.tar.gz "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz" \
	&& echo "${SIGNAL_CLI_SHA256}  /tmp/signal-cli.tar.gz" | sha256sum -c - \
	&& mkdir -p /out/bin && tar -xzf /tmp/signal-cli.tar.gz -C /out/bin && chmod 755 /out/bin/signal-cli \
	&& /out/bin/signal-cli --version

FROM signal-${WITH_SIGNAL} AS signal

# ---- runtime: API server + built web app ----
FROM oven/bun:1.4.4-slim AS runtime
# Node/npm, git and curl let stdio MCP servers run via npx (most are published that way).
# ssh reaches bots' computers and devboxes; Chromium is the browser for bots without a computer.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git nodejs npm openssh-client chromium fonts-noto-core python3 bubblewrap zlib1g \
	&& rm -rf /var/lib/apt/lists/*
ENV SEKAI_BROWSER_PATH=/usr/bin/chromium
# Empty unless the image was built with WITH_WEB_ENGINE=1 / WITH_SIGNAL=1.
COPY --from=webengine /out/bin/ /usr/local/bin/
COPY --from=signal /out/bin/ /usr/local/bin/
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
