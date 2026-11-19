#!/usr/bin/env bash
# Compile an unsigned, universal macOS host app. Store signing and notarization are deliberately separate.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-$root/dist/safari}"
if [[ "$(uname -s)" != Darwin ]]; then
    echo "Building the Safari app requires macOS and Xcode. The portable source build is bun run build:extension." >&2
    exit 1
fi
if [[ ! -f "$source_dir/manifest.json" ]]; then
    echo "Build or unpack the Safari WebExtension source first." >&2
    exit 1
fi

version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$root/package.json")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Use an X.Y.Z extension version before packaging." >&2
    exit 1
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/sekai-safari.XXXXXX")"
# Only this script's unique temporary directory is removed.
trap 'rm -rf "$work"' EXIT

# The same id as the iOS and Android apps; the extension's must start with the app's.
app_id="${SEKAI_SAFARI_APP_ID:-io.github.hazelcaffe.sekai.browser}"
tool=safari-web-extension-converter
if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
    tool=safari-web-extension-packager
fi
xcrun "$tool" "$source_dir" \
    --project-location "$work/project" \
    --app-name Sekai --bundle-identifier "$app_id" \
    --macos-only --swift --no-open --no-prompt

project="$(find "$work/project" -name '*.xcodeproj' -type d -print -quit)"
if [[ -z "$project" ]]; then
    echo "Apple's converter did not produce an Xcode project." >&2
    exit 1
fi
xcodebuild -project "$project" -list -json > "$work/project.json"
scheme="$(python3 - "$work/project.json" <<'PY'
import json, sys
schemes = json.load(open(sys.argv[1]))["project"]["schemes"]
apps = [s for s in schemes if "extension" not in s.lower()]
matches = [s for s in apps if "macos" in s.lower()] or [s for s in apps if s == "Sekai"] or apps
if not matches:
    raise SystemExit("No Safari macOS app scheme was generated.")
print(matches[0])
PY
)"
# Some converter versions give the host app a different id from the one asked for: set both, so the
# extension's id always starts with the app's (Xcode refuses to embed it otherwise).
pbxproj="$project/project.pbxproj"
python3 - "$pbxproj" "$app_id" <<'PY'
import re, sys
path, app_id = sys.argv[1], sys.argv[2]
text = open(path).read()
def fix(m):
    value = m.group(2).strip('"')
    new = f"{app_id}.Extension" if value.lower().endswith("extension") else app_id
    return f'{m.group(1)}"{new}";'
text = re.sub(r'(PRODUCT_BUNDLE_IDENTIFIER = )("?[^;\n]+"?);', fix, text)
open(path, "w").write(text)
PY
grep -h "PRODUCT_BUNDLE_IDENTIFIER" "$pbxproj" | sort -u
xcodebuild -project "$project" -scheme "$scheme" -configuration Release \
    -sdk macosx -derivedDataPath "$work/build" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
    ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
    MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION=1 build

app="$work/build/Build/Products/Release/Sekai.app"
if [[ ! -d "$app/Contents/PlugIns" ]]; then
    echo "The Safari host app or its bundled extension was not built." >&2
    exit 1
fi
mkdir -p "$root/release"
ditto -c -k --sequesterRsrc --keepParent "$app" "$root/release/sekai-safari-macos-unsigned-$version.zip"
