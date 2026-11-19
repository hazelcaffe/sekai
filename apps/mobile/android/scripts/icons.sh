#!/usr/bin/env bash
# Makes the launcher icons and the splash icon from apps/mobile/shared/icon.png (needs ImageMagick 7: `magick`).
# The art is Colorful Stage's: it's only resized, never cropped or recolored. Run it again if icon.png changes.
set -euo pipefail
cd "$(dirname "$0")/.."
art=../shared/icon.png
res=app/src/main/res

declare -A scale=([mdpi]=1 [hdpi]=1.5 [xhdpi]=2 [xxhdpi]=3 [xxxhdpi]=4)
px() { awk -v dp="$1" -v s="$2" 'BEGIN { printf "%d", dp * s + 0.5 }'; }
# The art, resized to $2 px, centred on a transparent $3 px square.
place() { magick "$art" -resize "$2x$2" -background none -gravity center -extent "$3x$3" -strip "$1"; }

for d in "${!scale[@]}"; do
	s=${scale[$d]}
	mkdir -p "$res/mipmap-$d"
	# The launcher and round icons are adaptive (mipmap-anydpi), which every Android the app runs on (9 and later)
	# uses, so there are no legacy PNGs. The foreground: a 108dp layer with the whole circle inside the 66dp safe
	# zone (launchers mask the rest; the background is plain white).
	place "$res/mipmap-$d/ic_launcher_foreground.png" "$(px 66 "$s")" "$(px 108 "$s")"
	# Splash: a 288dp icon whose visible part is a 192dp circle; the art is 176dp, as big as the launcher icon's
	# would be there. Up to xxhdpi only (the art is 512px; xxxhdpi screens scale that one up).
	if [[ $d != xxxhdpi ]]; then
		mkdir -p "$res/drawable-$d"
		place "$res/drawable-$d/splash_icon.png" "$(px 176 "$s")" "$(px 288 "$s")"
	fi
done
echo "Icons written to $res"
