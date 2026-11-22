#!/usr/bin/env bash
# The iOS smoke test: installs a simulator build, opens it fresh in light and dark (no server, an unreachable one,
# and a real one when given), checks it's still running each time, and saves screenshots.
# Usage: smoke-test.sh <simulator udid> <path to Sekai.app> <screenshot folder> [server url]
set -euo pipefail

UDID=$1
APP=$2
OUT=$3
SERVER=${4:-}
mkdir -p "$OUT"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist")

xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
	--cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
xcrun simctl install "$UDID" "$APP"

# shot <name> <light|dark> [launch arguments…]: a fresh launch, a screenshot once it has settled.
# Launch arguments like "-serverUrl <url>" stand in for a saved server (UserDefaults reads them first).
shot() {
	local name=$1 appearance=$2
	shift 2
	xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
	xcrun simctl ui "$UDID" appearance "$appearance"
	xcrun simctl launch "$UDID" "$BUNDLE_ID" "$@" >/dev/null
	sleep "${WAIT:-6}"
	xcrun simctl io "$UDID" screenshot --type=png "$OUT/$name.png" >/dev/null 2>&1
	running "$name"
	echo "Saved $name.png"
}

running() {
	local processes
	processes=$(xcrun simctl spawn "$UDID" launchctl list)
	if [[ $processes != *"$BUNDLE_ID"* ]]; then
		echo "::error::Sekai stopped running ($1)"
		return 1
	fi
}

# logged <text>: the app logged this in the last minute (see Sekai/App/Log.swift).
logged() {
	xcrun simctl spawn "$UDID" log show --last 1m --style compact \
		--predicate "subsystem == \"$BUNDLE_ID\" AND eventMessage CONTAINS \"$1\"" | grep -F "$1" >/dev/null
}

shot 1-connect-light light
shot 2-connect-dark dark
shot 3-unreachable-light light -serverUrl https://sekai.invalid
shot 3-unreachable-dark dark -serverUrl https://sekai.invalid
if [ -n "$SERVER" ]; then
	WAIT=12 shot 4-server-light light -serverUrl "$SERVER"
	WAIT=10 shot 5-server-dark dark -serverUrl "$SERVER"
	# bridge.js ran in the server's page and reached the app.
	if ! logged "page is connected to the bridge"; then
		echo "::error::The server's page never reached the app's bridge"
		exit 1
	fi
	echo "The server's page reached the bridge"
	# sekai:// links belong to the app: iOS asks "Open in Sekai?" (which a script can't answer).
	xcrun simctl openurl "$UDID" "sekai://c/smoke-test"
	sleep 2
	xcrun simctl io "$UDID" screenshot --type=png "$OUT/6-link-prompt.png" >/dev/null 2>&1
	running "sekai:// link"
	echo "Saved 6-link-prompt.png"
fi
