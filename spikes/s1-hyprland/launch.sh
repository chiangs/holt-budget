#!/usr/bin/env bash
# Usage: launch.sh <opaque|transparent> <log-file> [electron flags...]
# Starts the spike window and waits until Hyprland lists it. Prints the client as JSON.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mode=$1 logfile=$2
shift 2
electron=$(cd "$here/../../apps/desktop" && node -p 'require("electron")')

S1_MODE=$mode setsid "$electron" "$here/main.cjs" "$@" >"$logfile" 2>&1 </dev/null &
for _ in $(seq 1 60); do
  if hyprctl clients -j | jq -e '.[] | select(.title | test("^Holt S1"))' >/dev/null; then break; fi
  sleep 0.25
done
sleep 1
hyprctl clients -j | jq -c '.[] | select(.title | test("^Holt S1")) | {title, xwayland, workspace: .workspace.name, monitor, at, size, floating, pid}'
