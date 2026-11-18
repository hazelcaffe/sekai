#!/bin/sh
# Sekai runs a bot's server browser through this wrapper.
#
# Playwright launches browsers with --enable-automation, which makes sites treat the visitor as a
# bot (navigator.webdriver, empty client hints, blocked sign-ins). The switch can't be turned off
# from Playwright, and anything in the command line also shows up in /proc, which pages can read.
# So here we drop the automation switch and start the browser inside a bubblewrap sandbox with a
# fresh /proc/self/fd, so what remains of the control channel isn't visible from inside.
#
# The control channel itself (--remote-debugging-pipe) must stay or Playwright loses the browser.
# $SEKAI_CHROME_REAL is the real browser binary.
set -eu

ARGS=""
for a in "$@"; do
	case "$a" in
	--enable-automation) ;;
	*) ARGS="$ARGS '$(printf "%s" "$a" | sed "s/'/'\\\\''/g")'" ;;
	esac
done
eval "set -- $ARGS"

if command -v bwrap >/dev/null 2>&1; then
	exec bwrap --dev-bind / / --tmpfs /proc/self/fd -- "$SEKAI_CHROME_REAL" "$@"
fi
exec "$SEKAI_CHROME_REAL" "$@"
