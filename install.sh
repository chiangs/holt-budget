#!/bin/bash
# Holt installer for Linux: builds Holt from this copy, puts it in ~/.local, adds it to your app launcher and opens it.
#   ./install.sh            install (or reinstall) and open
#   ./install.sh --update   get the newest version from GitHub first
#   ./install.sh --yes      no questions: installs what's missing with pacman when it can
#   ./install.sh --no-open  install without opening it
# Your budget lives in ~/.local/share/holt and the installer never touches it. To remove Holt: ./uninstall.sh
set -e
cd "$(dirname "$0")"
REPO="$PWD"
LIB="$HOME/.local/lib/holt"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"
YES=0; OPEN=1; UPDATE=0
for a in "$@"; do case "$a" in --update) UPDATE=1;; --yes|-y) YES=1;; --no-open) OPEN=0;; esac; done
ask() { if [ "$YES" = 1 ]; then REPLY="${2:-y}"; else read -r -p "$1" REPLY || true; REPLY="${REPLY:-${2:-y}}"; fi; }

if [ "$UPDATE" = 1 ]; then echo "  Getting the newest Holt…"; git pull --ff-only; fi

echo ""
echo "  Installing Holt…"

# --- 1. what Holt is built with ---
# Holt carries its own Electron, the version it was tested on, so it doesn't use the system's electron package.
need() {
  if ! command -v "$1" >/dev/null && command -v pacman >/dev/null; then
    ask "  Holt is built with $2. Install it with pacman (sudo pacman -S $3)? [Y/n]: " y
    # $3 is a list of packages, so it must split into words.
    # shellcheck disable=SC2086
    if [[ "$REPLY" =~ ^[Yy] ]]; then sudo pacman -S --needed --noconfirm $3; fi
  fi
  command -v "$1" >/dev/null || { echo "  Holt is built with $2. Install it (Arch: sudo pacman -S $3), then run ./install.sh again."; exit 1; }
}
need node "Node.js" nodejs
need pnpm "pnpm" pnpm
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || { echo "  Holt needs Node.js 24 or newer (you have $(node -v)). Update it, then run ./install.sh again."; exit 1; }

# --- 2. build it ---
LOG="$REPO/apps/desktop/release/install.log"
mkdir -p "$(dirname "$LOG")"
fail() { echo "  $1 The details are in $LOG:"; tail -n 15 "$LOG" | sed 's/^/    /'; exit 1; }
echo "  Building Holt (a few minutes the first time)…"
{ pnpm install --frozen-lockfile && pnpm build && pnpm --filter @holt/desktop exec electron-builder --linux dir --publish never; } >"$LOG" 2>&1 \
  || fail "The build didn't work."

# --- 3. the app itself ---
# Let a running Holt finish quitting before replacing it, so it can close the database cleanly.
if pkill -f "^$LIB/app/holt( |$)" 2>/dev/null; then
  for _ in $(seq 20); do pgrep -f "^$LIB/app/holt( |$)" >/dev/null || break; sleep 0.5; done
fi
rm -rf "$LIB/app"; mkdir -p "$LIB"
cp -R apps/desktop/release/linux-unpacked "$LIB/app"
# Where this copy came from and which commit it is, for updates later.
printf '{ "repo": "%s", "commit": "%s" }\n' "$REPO" "$(git rev-parse HEAD 2>/dev/null || true)" > "$LIB/app/install.json"

# --- 4. a command, the icon, and an entry in your app launcher ---
mkdir -p "$BIN" "$APPS"
cat > "$BIN/holt" <<SH
#!/bin/sh
# Holt (installed by $REPO/install.sh). Extra Electron flags, one per line, go in ~/.config/holt-flags.conf
FLAGS=""
[ -f "\${XDG_CONFIG_HOME:-\$HOME/.config}/holt-flags.conf" ] && FLAGS="\$(grep -v '^\s*#' "\${XDG_CONFIG_HOME:-\$HOME/.config}/holt-flags.conf")"
exec "$LIB/app/holt" \$FLAGS "\$@"
SH
chmod +x "$BIN/holt"
for size in 16 24 32 48 64 128 256 512; do
  install -Dm644 "design/icon/png/holt-$size.png" "$ICONS/${size}x$size/apps/ink.chiang.holt.png"
done
install -Dm644 design/icon/holt.svg "$ICONS/scalable/apps/ink.chiang.holt.svg"
install -Dm644 design/icon/holt-symbolic.svg "$ICONS/symbolic/apps/ink.chiang.holt-symbolic.svg"
sed -e "s#^Exec=.*#Exec=$BIN/holt %U#" packaging/ink.chiang.holt.desktop > "$APPS/ink.chiang.holt.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" >/dev/null 2>&1 || true

echo "  Holt is installed. Open it from your app launcher, or run: holt"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  (~/.local/bin isn't on your PATH, so run it as $BIN/holt or add that folder to PATH.)";; esac

# --- 5. open it ---
if [ "$OPEN" = 1 ] && { [ -n "$WAYLAND_DISPLAY" ] || [ -n "$DISPLAY" ]; }; then
  nohup "$BIN/holt" >/dev/null 2>&1 &
  echo "  Opening Holt…"
fi
echo ""
