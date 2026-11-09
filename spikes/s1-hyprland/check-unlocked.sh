#!/usr/bin/env bash
# Spike S1 checks that need the unlocked screen: blur behind a transparent window, and keyboard input.
# Runs on a headless output so your own screens and windows stay as they are.
# The keyboard check sends real keys. Run it only when you aren't using the computer:
# it stops at the first key it can't send to the spike window.
# Usage: check-unlocked.sh <output-dir> [blur|keyboard|all]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$1
part=${2:-blur}
mkdir -p "$out"
export S1_SHOTS=$out

if [ "$(timeout 5 qs ipc -c caelestia call lock isLocked 2>/dev/null)" = "true" ]; then
  echo "The session is locked. Unlock it and run again; this script types keys and takes screenshots." >&2
  exit 1
fi

stop() { pkill -f '[d]ist/electron .*main[.]cjs' || true; sleep 1; }
created=""
if ! hyprctl monitors -j | jq -e '.[] | select(.name | startswith("HEADLESS"))' >/dev/null; then
  hyprctl output create headless >/dev/null
  created=yes
  sleep 1
fi
headless=$(hyprctl monitors -j | jq -r '[.[] | select(.name | startswith("HEADLESS"))][0].name')
workspace=$(hyprctl monitors -j | jq -r --arg m "$headless" '.[] | select(.name == $m) | .activeWorkspace.id')
hyprctl eval "hl.window_rule({ match = { title = '^Holt S1' }, workspace = '$workspace silent' })" >/dev/null
previous=$(hyprctl activewindow -j | jq -r '.address // empty')
cleanup() {
  stop
  if [ -n "$previous" ]; then hyprctl dispatch "hl.dsp.focus({ window = 'address:$previous' })" >/dev/null || true; fi
  if [ -n "$created" ]; then hyprctl output remove "$headless" >/dev/null || true; fi
}
trap cleanup EXIT
stop

# Fine detail only: the image minus a blurred copy of itself.
highpass() { magick "$1" -colorspace gray \( +clone -blur 0x3 \) -compose Mathematics -define compose:args=0,-1,1,0.5 -composite "$2"; }
# ImageMagick 7 reports NCC as a distortion: near 0 when the wallpaper's fine detail shows through, near 0.5 when it's gone.
distortion() { { magick compare -metric NCC "$1" "$2" null: 2>&1 || true; } | sed -E 's/.*\(([0-9.e-]+)\).*/\1/'; }

blur_check() {
echo "== Blur"
mon=$(hyprctl monitors -j | jq -c --arg m "$headless" '.[] | select(.name == $m) | {x, y}')
grim -o "$headless" "$out/wallpaper.png"
"$here/launch.sh" transparent "$out/transparent.log" >/dev/null
sleep 2
client=$(hyprctl clients -j | jq -c '.[] | select(.title | test("^Holt S1"))')
read -r x y w h < <(jq -r '"\(.at[0]) \(.at[1]) \(.size[0]) \(.size[1])"' <<<"$client")
# An empty part of the page, below its content, on the output and in the wallpaper shot.
top=$((y + 480)) height=$((h - 520)) width=$((w - 60))
grim -g "$((x + 30)),$top ${width}x$height" "$out/behind-window.png"
magick "$out/wallpaper.png" -crop "${width}x$height+$((x + 30 - $(jq .x <<<"$mon")))+$((top - $(jq .y <<<"$mon")))" "$out/wallpaper-region.png"
# Controls: the wallpaper under a 55% panel, without blur and with a blur of sigma 8.
magick "$out/wallpaper-region.png" -colorspace gray -evaluate multiply 0.45 -evaluate add 50% "$out/control-unblurred.png"
magick "$out/wallpaper-region.png" -colorspace gray -blur 0x8 -evaluate multiply 0.45 -evaluate add 50% "$out/control-blurred.png"
highpass "$out/wallpaper-region.png" "$out/hp-wallpaper.png"
for f in control-unblurred control-blurred behind-window; do
  highpass "$out/$f.png" "$out/hp-$f.png"
  printf '%-20s %s\n' "$f" "$(distortion "$out/hp-wallpaper.png" "$out/hp-$f.png")"
done
behind=$(distortion "$out/hp-wallpaper.png" "$out/hp-behind-window.png")
awk -v b="$behind" 'BEGIN { exit !(b > 0.25) }' && echo "Hyprland blurs behind the window." || echo "The wallpaper's detail shows through: no blur."
stop
}

keyboard_check() {
echo "== Keyboard"
"$here/launch.sh" opaque "$out/keyboard.log" >/dev/null
sleep 2
pid=$(pgrep -f '[d]ist/electron .*main[.]cjs' | head -1)
hyprctl dispatch "hl.dsp.focus({ window = 'pid:$pid' })" >/dev/null
sleep 0.5
# Send each key only while the spike window has focus, so no key can reach another window.
send() {
  if [ "$(hyprctl activewindow -j | jq -r .pid)" != "$pid" ]; then
    echo "The spike window lost focus. Stopped before sending: wtype $*" >&2
    return 1
  fi
  wtype "$@"
  sleep 0.2
}
send o && send t && send -M ctrl k -m ctrl && send -k Tab && send -k Tab && send -k Tab && send -k Tab &&
  for c in H o l t; do send "$c" || break; done
sleep 0.5
grep -E '"(focus|blur|keydown)"' "$out/keyboard.log" | sed 's/^S1 //' | jq -c '{event, key, ctrl, target, focused}'
}

case $part in
  blur) blur_check ;;
  keyboard) keyboard_check ;;
  all) blur_check; keyboard_check ;;
  *) echo "Unknown part: $part" >&2; exit 2 ;;
esac
