#!/usr/bin/env bash
# N7: run the built app in a network namespace that has no route to anywhere
# except loopback, and fail on any attempt to reach another address.
#
# A namespace with only `lo` would make every outside connection fail silently,
# so nothing could be seen. Instead the namespace has a dummy interface that
# swallows every packet sent to it, and tcpdump records what arrives there.
# Anything recorded is a connection attempt (TCP or UDP, which includes DNS)
# to a non-loopback address.
#
# Needs: unshare, ip, tcpdump, bash. Build first: pnpm --filter @holt/desktop build
# The app must accept --holt-smoke-exit: log "[holt] smoke-exit: window loaded"
# once the main window has loaded, then quit with status 0.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
marker="[holt] smoke-exit: window loaded"

die() { echo "no-network: $*" >&2; exit 1; }

if [[ "${1:-}" != "--inside" ]]; then
  [[ -f "$root/apps/desktop/out/main/index.js" ]] || die "no build found. Run: pnpm --filter @holt/desktop build"
  for tool in unshare ip tcpdump; do
    command -v "$tool" >/dev/null || die "$tool is required"
  done
  display=()
  if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    command -v xvfb-run >/dev/null || die "no display and no xvfb-run. Install xorg-server-xvfb or run inside a session"
    display=(xvfb-run -a)
  fi
  exec "${display[@]}" unshare --map-root-user --net "$0" --inside
fi

work="$(mktemp -d)"
cleanup() {
  [[ -n "${dump_pid:-}" ]] && kill "$dump_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

ip link set lo up
ip link add sink0 type dummy
ip link set sink0 up
ip addr add 10.255.255.1/24 dev sink0
ip -6 addr add fd00:ffff::1/64 dev sink0 nodad
ip route add default dev sink0
ip -6 route add default dev sink0

capture="$work/capture.txt"
tcpdump -Z root -l -n -i sink0 -Q out '(tcp or udp)' >"$capture" 2>"$work/tcpdump.err" &
dump_pid=$!
for _ in $(seq 50); do grep -q 'listening on' "$work/tcpdump.err" && break; sleep 0.1; done
grep -q 'listening on' "$work/tcpdump.err" || die "tcpdump could not start: $(cat "$work/tcpdump.err")"

# Positive control: if this attempt is not seen, the check below proves nothing.
timeout 1 bash -c 'exec 3<>/dev/tcp/192.0.2.1/80' 2>/dev/null || true
sleep 0.5
grep -q '192.0.2.1' "$capture" || die "control failed: the capture did not see a test connection"
seen_before=$(wc -l <"$capture")

electron="$root/apps/desktop/node_modules/.bin/electron"
[[ -x "$electron" ]] || die "electron not found at $electron. Run: pnpm install"
log="$work/app.log"
status=0
# --map-root-user makes the app run as root, which Chromium refuses with its sandbox on.
timeout 90 "$electron" --no-sandbox "$root/apps/desktop" --holt-smoke-exit >"$log" 2>&1 || status=$?

sleep 0.5
if [[ $(wc -l <"$capture") -gt $seen_before ]]; then
  echo "no-network: the app tried to reach a non-loopback address:" >&2
  tail -n +"$((seen_before + 1))" "$capture" >&2
  exit 1
fi
if [[ $status -ne 0 ]]; then
  tail -n 30 "$log" >&2
  die "the app exited with status $status (124 means it never finished: does it support --holt-smoke-exit?)"
fi
grep -qF "$marker" "$log" || { tail -n 30 "$log" >&2; die "the app exited but never reported that its window loaded"; }
echo "no-network: ok. The window loaded, the app exited cleanly and no packet left the machine."
