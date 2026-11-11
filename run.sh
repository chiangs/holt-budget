#!/bin/bash
# Holt from source: builds this copy as it is now (committed or not) and opens it on the synthetic household.
#   ./run.sh            build and open
#   ./run.sh --reseed   start the synthetic household again from nothing first
#   ./run.sh --no-build open the last build without building again
# It installs nothing and makes no network calls. Unlike the installed Holt, it has the development seed,
# so it opens with a household to look at (the installed one has none until Setup arrives in Milestone 6).
# Its data is in ~/.local/share/holt-dev, never the family's ~/.local/share/holt. For hot reload use: pnpm dev
set -e
cd "$(dirname "$0")"
BUILD=1
for a in "$@"; do case "$a" in --reseed) export HOLT_RESEED=1;; --no-build) BUILD=0;; esac; done

command -v pnpm >/dev/null || { echo "  Holt is built with pnpm. Install it (Arch: sudo pacman -S pnpm), then run ./run.sh again."; exit 1; }

if [ "$BUILD" = 1 ]; then
  echo "  Building Holt from $(git rev-parse --short HEAD 2>/dev/null || echo "this copy")$(git diff --quiet HEAD 2>/dev/null || echo " plus your uncommitted changes")…"
  LOG="$PWD/apps/desktop/release/run.log"
  mkdir -p "$(dirname "$LOG")"
  # The development mode keeps the seed. A production build never has it.
  { pnpm install --frozen-lockfile && pnpm tokens && pnpm --filter @holt/desktop exec electron-vite build --mode development; } >"$LOG" 2>&1 \
    || { echo "  The build didn't work. The details are in $LOG:"; tail -n 15 "$LOG" | sed 's/^/    /'; exit 1; }
fi

echo "  Opening Holt…"
# --skipBuild: preview would otherwise build again in production mode, which has no seed.
exec pnpm --filter @holt/desktop exec electron-vite preview --skipBuild -- --holt-seed
