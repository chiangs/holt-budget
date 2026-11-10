#!/bin/bash
# Packaging checks P1 to P6 (docs/milestone-1-test-plan.md). Builds Holt, so it takes a few minutes.
#   scripts/check-packaging.sh
# install.sh and uninstall.sh run against a scratch HOME. The real one is never touched.
set -u
cd "$(dirname "$0")/.." || exit 2
REPO="$PWD"
RELEASE="$REPO/apps/desktop/release"
FAILS=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
skip() { echo "SKIP  $1"; }
check() { if "${@:2}"; then pass "$1"; else fail "$1"; fi; }

REAL_HOME="$HOME"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/holt-packaging.XXXXXX")"
[ -n "$SCRATCH" ] && [ "$SCRATCH" != "$REAL_HOME" ] || { echo "No scratch folder."; exit 2; }
trap 'rm -rf "$SCRATCH"' EXIT

# P1. The AppImage. This is what `pnpm dist` runs, without the pacman target (see the report).
rm -rf "$RELEASE"
if ! { pnpm build && pnpm --filter @holt/desktop exec electron-builder --linux AppImage --publish never; } >"$SCRATCH/build.log" 2>&1; then
  tail -n 20 "$SCRATCH/build.log"; fail "P1 the build"; exit 1
fi
APPIMAGE="$(find "$RELEASE" -maxdepth 1 -name 'Holt-*.AppImage' 2>/dev/null | head -n 1)"
check "P1 an AppImage exists" test -x "$APPIMAGE"
[ -x "$APPIMAGE" ] || exit 1

# P2. Look inside the AppImage itself, not the unpacked folder next to it.
EXTRACT="$SCRATCH/appimage"
mkdir -p "$EXTRACT"
(cd "$EXTRACT" && "$APPIMAGE" --appimage-extract >/dev/null 2>&1)
APP="$EXTRACT/squashfs-root"
check "P2 the AppImage extracts" test -x "$APP/holt"
NODES="$(find "$APP" -name '*.node' 2>/dev/null | sed "s#^$APP/##" | sort)"
echo "      native binaries: ${NODES:-none}"
check "P2 the only native binary is the Linux x64 SQLite build" \
  test "$NODES" = "resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/prebuilds/linux-x64.node"
FOREIGN="$(find "$APP" \( -name '*darwin*' -o -name '*win32*' -o -name '*linuxmusl*' -o -name '*arm64*' \) -path '*node_modules*' 2>/dev/null)"
check "P2 no foreign-platform files under node_modules" test -z "$FOREIGN"
ASAR_FOREIGN="$(cd "$REPO" && pnpm dlx @electron/asar list "$APP/resources/app.asar" 2>/dev/null | grep -E 'prebuilds/(darwin|win32|linuxmusl|linux-arm64)|\.(dll|dylib)$' || true)"
check "P2 no foreign-platform binaries inside app.asar" test -z "$ASAR_FOREIGN"

# P6. The development seed and the end-to-end file picker are build options. The shipped bundle holds neither, and no invented household.
ASAR_DIR="$SCRATCH/asar"
(cd "$REPO" && pnpm dlx @electron/asar extract "$APP/resources/app.asar" "$ASAR_DIR" >/dev/null 2>&1)
holds_no_seed() {
  [ -f "$ASAR_DIR/out/main/index.js" ] && ! grep -rqE 'holt-dev-seed|HOLT_E2E_PICK_FILE|HOLT_RESEED|sample-imports' "$ASAR_DIR/out"
}
check "P6 the packaged app holds no development seed and no test file picker" holds_no_seed

# The packaged app opens the encrypted database (decision 0041). It needs a keyring, so it uses a passphrase when there is none.
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  mkdir -p "$SCRATCH/s2"
  S2="$(HOLT_PASSPHRASE=packaging-check timeout 90 "$APP/holt" --no-sandbox --holt-s2-check=full --holt-s2-dir="$SCRATCH/s2" 2>&1 | grep '^HOLT-S2 ' || true)"
  check "P2 the packaged app opens the encrypted database" grep -q '"ok":true' <<<"$S2"
else
  skip "P2 packaged encrypted-database check (no display)"
fi

# P3 and P4. Real install.sh and uninstall.sh with a scratch HOME. The caches stay shared so nothing downloads twice.
HOME_DIR="$SCRATCH/home"
mkdir -p "$HOME_DIR/.local/share/holt" "$HOME_DIR/.config/holt"
echo "kept" > "$HOME_DIR/.local/share/holt/budget.marker"
echo "kept" > "$HOME_DIR/.config/holt/settings.marker"
real_state() { stat -c '%n %Y' "$REAL_HOME/.local/bin/holt" "$REAL_HOME/.local/lib/holt/app" "$REAL_HOME/.local/share/applications/ink.chiang.holt.desktop" 2>&1; }
REAL_BEFORE="$(real_state)"
STORE="$(pnpm store path 2>/dev/null || true)"
scratch_env() {
  env -u XDG_DATA_HOME -u XDG_CONFIG_HOME -u XDG_CACHE_HOME -u XDG_STATE_HOME -u WAYLAND_DISPLAY -u DISPLAY \
    HOME="$HOME_DIR" XDG_CACHE_HOME="${XDG_CACHE_HOME:-$REAL_HOME/.cache}" npm_config_store_dir="$STORE" "$@"
}

if scratch_env ./install.sh --yes --no-open >"$SCRATCH/install.out" 2>&1; then pass "P3 install.sh exits cleanly"
else tail -n 20 "$SCRATCH/install.out"; fail "P3 install.sh exits cleanly"; fi
check "P3 the app is installed" test -x "$HOME_DIR/.local/lib/holt/app/holt"
check "P3 the holt command exists" test -x "$HOME_DIR/.local/bin/holt"
check "P3 the command points at the scratch install" grep -q "$HOME_DIR/.local/lib/holt/app/holt" "$HOME_DIR/.local/bin/holt"
DESKTOP="$HOME_DIR/.local/share/applications/ink.chiang.holt.desktop"
check "P3 the desktop entry exists" test -f "$DESKTOP"
check "P3 the desktop entry runs the scratch command" grep -qx "Exec=$HOME_DIR/.local/bin/holt %U" "$DESKTOP"
check "P3 the icon is installed" test -f "$HOME_DIR/.local/share/icons/hicolor/scalable/apps/ink.chiang.holt.svg"
check "P3 the real home was not touched" test "$(real_state)" = "$REAL_BEFORE"

scratch_env ./uninstall.sh <<<"n" >"$SCRATCH/uninstall.out" 2>&1
check "P4 the app is gone" test ! -e "$HOME_DIR/.local/lib/holt"
check "P4 the holt command is gone" test ! -e "$HOME_DIR/.local/bin/holt"
check "P4 the desktop entry is gone" test ! -e "$DESKTOP"
check "P4 the icons are gone" test -z "$(find "$HOME_DIR/.local/share/icons" -name 'ink.chiang.holt*' 2>/dev/null)"
check "P4 the budget folder is left alone" test "$(cat "$HOME_DIR/.local/share/holt/budget.marker" 2>/dev/null)" = kept
check "P4 the settings folder is left alone" test "$(cat "$HOME_DIR/.config/holt/settings.marker" 2>/dev/null)" = kept

# P5
if command -v shellcheck >/dev/null; then
  check "P5 shellcheck passes on install.sh and uninstall.sh" shellcheck install.sh uninstall.sh scripts/check-packaging.sh
else
  skip "P5 shellcheck is not installed"
fi

echo ""
if [ "$FAILS" = 0 ]; then echo "Packaging checks passed."; else echo "$FAILS packaging check(s) failed."; exit 1; fi
