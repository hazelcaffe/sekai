#!/usr/bin/env bash
# Starts the Sekai server the way you would from a terminal: with your login PATH (nvm's node and bun, agent CLIs,
# tailscale, ssh, Playwright's browsers), from the repository it lives in. Used by the sekai systemd service.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
command -v bun >/dev/null || { echo "Can't find bun on PATH ($PATH)" >&2; exit 1; }
cd "$root/apps/server"
exec bun run src/index.ts
