# Handover: from design to code (8 Nov 2026)

This repository was assembled at the end of the design phase. Everything decided so far is in `docs/` and `design/`; the code is a verified skeleton.

## What works now
- `pnpm install`, `pnpm test` (21 tests in `packages/core`: money in the minor units of any one currency, and the evening-out bucket maths checked against the Electricity mockup), `pnpm typecheck`, `pnpm build`.
- `pnpm dev` opens Holt: the sidebar with Lucide icons, the Holt icon, single-key navigation (A O T P R M I S, Ctrl K), placeholder screens, Hearth light tokens, bundled Figtree and Plex Mono.
- The main process already forces the GNOME keyring when a Secret Service is running, blocks every non-loopback request that goes through Chromium, denies permission prompts and new windows, and keeps the renderer sandboxed with a strict CSP.

## Not done yet (by design)
- Encrypted SQLite isn't installed: it's spike S2, because its native build is the thing being tested.
- No model client yet: spike S3.
- No importers yet: spike S4 needs your real exports.
- Electron's binary was skipped when this was verified (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`). Your first `pnpm install` downloads it.

## Getting started
```
git clone git@github.com:chiangs/holt-budget.git && cd holt-budget
pnpm install        # or: npx pnpm@12 install
pnpm test && pnpm dev
```
Put the first household's details and any real bank exports in `private/`, which git ignores.

## A first prompt for Claude Code
> Read CLAUDE.md and the documents it lists. Then start spike S1 from BACKLOG.md: check Holt on my Hyprland session (Wayland, RTX 4090), including a frameless window with client-side decorations and a transparent window under tiling. Write what you find as a new decision record in docs/decisions/.

## Still open
- Glass: review the frosted-glass experiment (experiments.chiang.ink, "frosted-glass-card").
