# 0040 Electron on Hyprland with the RTX 4090 (spike S1)

Status: accepted.
Date: 2026-11-08 to 2026-11-09

## Question
Does Electron 45 work well on Stephen's Hyprland session (Wayland, RTX 4090)? Is "Show the desktop behind Holt" viable: does a transparent window resize under tiling, and does Hyprland blur what's behind it?

## Setup
- Electron 45.2.3 (Chromium 156), Hyprland 0.57.1 with a Lua config and Caelestia, NVIDIA open driver 615.78.08, two 2560 × 1440 monitors at scale 1.
- The harness is in `spikes/s1-hyprland/`. `launch.sh` starts a frameless window in `opaque` or `transparent` mode, and the window logs what it sees as JSON lines. `check-unlocked.sh` runs the checks that need the unlocked screen.
- The tests run on a headless output (`hyprctl output create headless`), so Stephen's screens and windows stay as they are, and scaling can change without touching a real monitor.

## Findings
- **Native Wayland by default.** Electron chose `--ozone-platform=wayland` with no flags, and Hyprland lists the window with `xwayland: false`. Holt needs no Wayland flags.
- **The 4090 renders.** GPU compositing and rasterisation are enabled with default flags. The GPU process holds memory on the 4090 through `/dev/dri/renderD128`.
  - `getGPUFeatureStatus()` reports `disabled_software` if you read it before the GPU process starts. Read it a few seconds after launch.
  - The log line "'--ozone-platform=wayland' is not compatible with Vulkan" is harmless. Chromium leaves Vulkan off and uses GL.
- **Fractional scaling works.** At scales 1.25 and 1.5, `devicePixelRatio` follows the output live, and Electron renders at device pixels, not upscaled. A 1428 × 802 window at 1.25 renders 1785 × 1003. Text is sharp. Repeating 1 px lines look uneven at 1.25, because each one snaps to one or two device pixels. Hairline borders are fine, but avoid dense 1 px patterns.
- **A transparent window resizes under tiling.** Alone, split with another window, alone again, and floating at 900 × 600: each resize reaches the page, and the render matches the new size. Electron's documented warning that transparent windows may not resize doesn't apply, because Hyprland sets the size.
- **The transparency is real.** In the render, the opaque header has alpha 1, and a panel at 55% surface has alpha 0.549.
- **Hyprland blurs what's behind the window.** `check-unlocked.sh blur` compares the wallpaper's fine detail with what shows through an empty part of the page, using normalised cross-correlation, which ImageMagick 7 reports as a distortion. Near 0 means the detail shows through, and near 0.5 means it's gone.

  | Image | Distortion |
  |---|---|
  | Wallpaper under a 55% panel, no blur (control) | 0.019 |
  | Wallpaper under a 55% panel, blurred with sigma 8 (control) | 0.485 |
  | Behind the transparent Holt window | 0.500 |

  This used Stephen's settings: blur size 8 with 2 passes. A measure of raw detail (the spread of a Laplacian) couldn't tell the cases apart, because grain and dithering dominate it.
- **Keyboard and focus work.** Hyprland gives the window focus and the page sees it. Single keys, Ctrl+K (with `ctrlKey` set), Tab order through the header buttons to a text field, and typed text all arrive with the right `key`.
  - `wtype` builds its own keymap, so `code` is meaningless in these tests. Holt reads `key`, which is also correct for a Norwegian layout.
  - The keyboard check sends real keys. In one run, focus moved to another window part way through, and the rest of the keys went there. The script now checks focus before every key and stops if the spike window doesn't have it. Run it only when nobody is using the computer.
- **Window buttons don't fit a tiling compositor.**
  - Hyprland tells Electron that a tiled window is maximised, so `isMaximized()` is `true` before anyone presses Maximise.
  - Hyprland ignores Minimise. The window stays on screen, while Electron reports it minimised and hidden.
  - The mockups draw no title bar or window buttons, so leaving them out matches the design.
- **A minimum size breaks tiling.** With `minWidth: 1024` (as in `apps/desktop/src/main/index.ts`), a tile 908 px wide gets a page 1044 px wide, which spills past its tile. Hyprland doesn't honour a client's minimum size for tiled windows.
- **Stephen's config makes every window 95% opaque** (`windowOpacity = 0.95`, with blur on). Even an opaque Holt shows a little of the desktop on his machine. That slightly lowers the contrast that the tokens guarantee, and Holt can't control it.

## Checked by hand
Stephen ran the transparent window on his own monitor at 165 Hz. He resized it, floated it and dragged it by its header, and it works.

## Decisions (Stephen, 2026-11-09)
1. **No window buttons on Hyprland.** Holt stays frameless and draws no Minimise, Maximise or Close buttons. The compositor's own keys manage the window. A drag strip along the top still lets a floating window move. What to show on desktops that expect buttons, such as GNOME, can wait until Holt targets them.
2. **No minimum window size.** Remove `minWidth` and `minHeight`. The layout stays usable down to about 900 px wide, the width of a half tile on a 1920 px screen. The sidebar collapses to icons and key letters when narrow. Both changes are in Milestone 1 in `BACKLOG.md`.

## Verdict on "Show the desktop behind Holt"
Viable on Hyprland. The transparent window resizes under tiling, its alpha is correct, and Hyprland blurs the desktop behind it. It depends on the compositor: with blur off, or on a compositor without blur, the desktop shows through sharp. So the in-app backdrop from `technical-decisions.md` §9 stays the default, and showing the desktop remains an option to build later.
