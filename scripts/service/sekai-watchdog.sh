#!/usr/bin/env bash
# Restarts Sekai when it's running but stopped answering (stuck rather than crashed: systemd handles crashes).
# Two failed checks in a row, and never in its first 10 minutes (a restore at startup can take a while).
set -uo pipefail
systemctl --user is-active --quiet sekai || exit 0
pid="$(systemctl --user show -p MainPID --value sekai)"
age="$(ps -o etimes= -p "${pid:-0}" 2>/dev/null | tr -d ' ')"
[ "${age:-0}" -lt 600 ] && exit 0
state="${XDG_RUNTIME_DIR:-/tmp}/sekai-watchdog.failed"
if curl -fsS --max-time 15 "http://127.0.0.1:${SEKAI_PORT:-7420}/api/health" >/dev/null 2>&1; then
	rm -f "$state"
	exit 0
fi
if [ -f "$state" ]; then
	rm -f "$state"
	echo "Sekai didn't answer twice in a row: restarting it"
	systemctl --user restart sekai
else
	touch "$state"
	echo "Sekai didn't answer; checking again in a couple of minutes"
fi
