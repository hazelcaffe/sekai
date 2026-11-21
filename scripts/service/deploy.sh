#!/usr/bin/env bash
# Puts the code in this checkout live: installs dependencies, checks it, builds the web app, restarts
# the service (migrations run as it starts) and waits until it answers.
#   --fast   skip lint, typecheck and tests
#   --here   deploy on this machine even if SEKAI_DEPLOY_HOST is set
# With SEKAI_DEPLOY_HOST=user@host (in the environment or .env), the code is copied to ~/sekai on that machine first
# (not data/, .env or node_modules) and deployed there: develop here, run Sekai on a server.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
fast=""
here=""
for a in "$@"; do
	case "$a" in
		--fast) fast="--fast" ;;
		--here) here=1 ;;
	esac
done
host="${SEKAI_DEPLOY_HOST:-$(grep -E '^SEKAI_DEPLOY_HOST=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
if [ -n "$host" ] && [ -z "$here" ]; then
	if [ -z "$fast" ]; then bun run check; fi
	echo "Copying to $host:~/sekai"
	rsync -az --delete --exclude node_modules --exclude '/data/' --exclude dist --exclude 'apps/desktop/release' \
		--exclude '.env' -e "ssh -o BatchMode=yes" ./ "$host:sekai/"
	exec ssh -o BatchMode=yes "$host" "cd ~/sekai && PATH=\$HOME/.bun/bin:\$PATH bash scripts/service/deploy.sh --here --fast"
fi
bun install
if [ -z "$fast" ]; then bun run check; fi
bun run build:web
if ! systemctl --user cat sekai.service >/dev/null 2>&1; then
	echo "Sekai isn't installed as a service yet: running scripts/service/install.sh"
	exec "$root/scripts/service/install.sh"
fi
systemctl --user restart sekai.service
for _ in $(seq 1 90); do
	if curl -fsS --max-time 3 "http://127.0.0.1:${SEKAI_PORT:-7420}/api/health" >/dev/null 2>&1; then
		echo "Deployed: Sekai is up ($(git -C "$root" log --oneline -1 | cut -c1-80))"
		exit 0
	fi
	sleep 1
done
echo "Sekai didn't come back within 90 seconds. See: journalctl --user -u sekai -n 80" >&2
exit 1
