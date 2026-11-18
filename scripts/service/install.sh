#!/usr/bin/env bash
# Installs Sekai as a systemd user service that starts with this machine (WSL included), restarts if it crashes,
# and gets restarted if it stops answering. Safe to run again. Needs sudo once, for "linger" (start without a login).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$units"
# Installed before the rename (Feesh → Sekai): stop and remove the old units so two servers never share port 7420.
for old in feesh-watchdog.timer feesh-watchdog.service feesh.service; do
	if [ -f "$units/$old" ]; then
		systemctl --user disable --now "$old" >/dev/null 2>&1 || true
		rm -f "$units/$old"
	fi
done
chmod +x "$root/scripts/service/"*.sh
for f in sekai.service sekai-watchdog.service sekai-watchdog.timer; do
	sed "s|@ROOT@|$root|g" "$root/scripts/service/$f" > "$units/$f"
done
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
	echo "Letting your services run without a login (sudo):"
	sudo loginctl enable-linger "$USER"
fi
systemctl --user daemon-reload
systemctl --user enable sekai.service sekai-watchdog.timer >/dev/null
systemctl --user restart sekai.service
systemctl --user start sekai-watchdog.timer
for _ in $(seq 1 90); do
	if curl -fsS --max-time 3 "http://127.0.0.1:${SEKAI_PORT:-7420}/api/health" >/dev/null 2>&1; then
		echo "Sekai is running as a service. Logs: bun run logs · restart: systemctl --user restart sekai"
		exit 0
	fi
	sleep 1
done
echo "Sekai didn't answer within 90 seconds. See: journalctl --user -u sekai -n 80" >&2
exit 1
