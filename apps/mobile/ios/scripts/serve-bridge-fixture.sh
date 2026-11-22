#!/usr/bin/env bash
# A loopback-only origin for the simulator UI test; no accounts, cookies or live server state needed.
set -eu
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/api/auth"
echo '{"setupRequired":false}' > "$dir/api/auth/status"
cp "$(dirname "$0")/bridge-fixture.html" "$dir/index.html"
python3 -m http.server 7491 --bind 127.0.0.1 --directory "$dir"
