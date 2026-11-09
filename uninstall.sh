#!/bin/bash
# Removes Holt. Your budget stays unless you say otherwise.
#   ./uninstall.sh          remove the app, then ask about your budget
#   ./uninstall.sh --purge  also delete your budget, without asking
#   ./uninstall.sh --yes    remove the app, keep your budget, no questions
LIB="$HOME/.local/lib/holt"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/holt"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/holt"     # the few settings needed before unlocking (technical-decisions.md §13)
ELECTRON_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/Holt"   # Electron's own cache and settings for the app
ICONS="$HOME/.local/share/icons/hicolor"
PURGE=0; YES=0
for a in "$@"; do case "$a" in --purge) PURGE=1;; --yes|-y) YES=1;; esac; done

echo ""
echo "  Removing Holt…"
if pkill -f "^$LIB/app/holt( |$)" 2>/dev/null; then
  for _ in $(seq 20); do pgrep -f "^$LIB/app/holt( |$)" >/dev/null || break; sleep 0.5; done
fi
rm -rf "$LIB"
rm -f "$HOME/.local/bin/holt" "$HOME/.local/share/applications/ink.chiang.holt.desktop"
find "$ICONS" -name 'ink.chiang.holt*' -delete 2>/dev/null || true
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
echo "  The app is gone."

rm -rf "$ELECTRON_CONF"
if [ -d "$DATA" ] || [ -d "$CONF" ]; then
  if [ "$PURGE" = 1 ]; then REPLY=y
  elif [ "$YES" = 1 ]; then REPLY=n
  else
    echo "  Your budget is in $DATA."
    echo "  Your backups are in the folder you chose in Setup, and they open with your recovery code."
    read -r -p "  Also delete your budget and settings from this computer? This can't be undone. [y/N]: " REPLY
  fi
  if [[ "$REPLY" =~ ^[Yy] ]]; then rm -rf "$DATA" "$CONF"; echo "  Your budget and settings are deleted from this computer. Your backups are untouched."
  else echo "  Your budget is still in $DATA. Reinstall any time and it'll be right there."; fi
fi
echo ""
