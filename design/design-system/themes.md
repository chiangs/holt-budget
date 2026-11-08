# Themes and glass

## The four choices users see
| In Settings → Appearance | Token theme(s) | Character |
|---|---|---|
| **Hearth** (default) | hearth-light, hearth-dark | Warm neutrals, deep green-teal accent, terracotta attention. Light or dark follows the desktop's mode. |
| **Instrument** | instrument-dark, instrument-light | Cool, near-monochrome, one cold accent, amber attention. For people who want maximum calm and density. |
| **Follow my desktop** | desktop (runtime) · example: desktop-fjord | Takes Caelestia's Material 3 palette and updates live when the wallpaper changes. |
| **Glass** (a switch, not a theme) | any theme | Frosted panels over a blurred backdrop. Off by default. |

The fresh-install default is **Hearth, following the desktop's light or dark mode, glass off.**

## Follow my desktop: Material 3 mapping
Caelestia keeps its current palette in `~/.local/state/caelestia/scheme.json` (Material 3 roles). The app watches that file and maps roles to tokens:

| Token | Material 3 role |
|---|---|
| bg | surface |
| surface | surfaceContainer |
| surface-raised | surfaceContainerHigh |
| line | outlineVariant |
| text | onSurface |
| text-muted | onSurfaceVariant |
| accent | primary |
| accent-ink | onPrimary |
| accent-soft | secondaryContainer |
| attention | tertiary |
| attention-soft | tertiaryContainer |
| danger | error |
| danger-soft | errorContainer |
| chart-2 | primaryContainer |
| chart-3 | secondaryContainer |
| chart-track | surfaceContainerHigh |
| chart-grid | outlineVariant |
| scrim | scrim |

### Guard rails
Generated palettes are not under the app's control. Before applying one, the app checks:
1. text and text-muted reach 4.5:1 on bg, surface and surface-raised;
2. accent and attention differ clearly in lightness (attention must never read as the same thing as accent);
3. accent-ink reaches 4.5:1 on accent.

If a check fails, the app nudges that role's tone within the same hue. If that's not enough, it uses Hearth for that role. Settings → Appearance says when this has happened ("Your desktop's palette was adjusted for readability").

On desktops without Caelestia, Follow my desktop uses Hearth and says so.

## Glass
- **Panels:** glass-panel (glass-panel-strong for text-heavy panels: assistant notes, the review draft, Ask or find), a 1px glass-edge border, shadow-glass, and a backdrop blur of glass-blur at saturate 140%.
- **Backdrop:**
  - **On Hyprland:** the compositor can blur the real wallpaper behind a transparent window. Whether the chosen app framework supports this on Wayland is a technical question still to answer.
  - **Fallback:** an in-app backdrop of three soft colour fields from the theme's palette, blurred.
- **Readability:** opacities are set so text stays at 4.5:1 over any backdrop. Tables, the Transactions list and data entry always use the stronger panel.
- **Turning it off:** a switch in Settings → Appearance, also reached by the desktop's reduce-transparency preference where one exists.
