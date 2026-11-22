#!/usr/bin/env bash
# A throwaway Sekai server on this Mac for the iOS smoke test (GitHub's macOS runners, or your own Mac): Postgres 17
# with pgvector from Homebrew, and the server and web app from this checkout (or from the public repo when the
# checkout is only the mobile apps). It sets the server up with a first account, so the app shows the sign-in page.
# Touches $SEKAI_CI_DIR/ready when it's up, or $SEKAI_CI_DIR/failed; logs are in that folder too.
set -euo pipefail

DIR=${SEKAI_CI_DIR:-/tmp/sekai-ci}
PORT=${SEKAI_CI_PORT:-7420}
PG_PORT=${SEKAI_CI_PG_PORT:-5433}
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
mkdir -p "$DIR"
trap 'touch "$DIR/failed"' ERR

if [ -f "$ROOT/apps/server/package.json" ]; then
	SRC=$ROOT
else
	git clone --quiet --depth 1 https://github.com/hazelcaffe/sekai "$DIR/sekai"
	SRC=$DIR/sekai
fi

echo "Postgres…"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1
brew install --quiet postgresql@17 pgvector >"$DIR/brew.log" 2>&1
PG=$(brew --prefix postgresql@17)/bin
"$PG/initdb" -D "$DIR/pg" -U sekai --auth=trust >"$DIR/initdb.log"
"$PG/pg_ctl" -D "$DIR/pg" -o "-p $PG_PORT -k $DIR" -l "$DIR/postgres.log" -w start >/dev/null
"$PG/createdb" -h 127.0.0.1 -p "$PG_PORT" -U sekai sekai

echo "Sekai…"
cd "$SRC"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install --frozen-lockfile >"$DIR/install.log" 2>&1
bun run build:web >"$DIR/build-web.log" 2>&1
DATABASE_URL="postgres://sekai@127.0.0.1:$PG_PORT/sekai" SEKAI_DATA_DIR="$DIR/data" SEKAI_PORT=$PORT \
	nohup bun run --cwd apps/server start >"$DIR/server.log" 2>&1 &

URL="http://127.0.0.1:$PORT"
for _ in $(seq 1 90); do
	curl -sf "$URL/api/auth/status" >/dev/null && break
	sleep 1
done
curl -sf "$URL/api/auth/status" >/dev/null

# The first account, with the setup code the server printed, so the app opens on the sign-in page.
CODE=$(grep -o 'setup code there: [A-Z0-9]*' "$DIR/server.log" | tail -1 | awk '{print $NF}')
curl -sf -X POST "$URL/api/auth/setup" -H "Content-Type: application/json" -H "Origin: $URL" \
	-d "{\"username\":\"miku\",\"name\":\"Miku\",\"password\":\"negi-and-leeks-39\",\"code\":\"$CODE\"}" >/dev/null

echo "Sekai is up at $URL"
touch "$DIR/ready"
