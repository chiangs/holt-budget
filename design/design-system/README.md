# Holt

Every krone a job. Calm, precise, and kept on your own computer.

Holt is an open-source (MIT) household budget planner for a family's shared money. It runs on Linux (Arch, CachyOS, Hyprland with Caelestia), with a local AI assistant that explains and suggests but never acts on its own. This design system is the single reference for how the app looks, reads and behaves. Read it before designing a screen or writing a line of interface copy.

**App icon:** the grove. Four trunks on one orange ground line, on a dark green plate (#1f5446). It reads as both a small wood and a bar chart. The icon is the same in every theme. There are three masters (48 px and up, 16/32 px on a pixel grid, and 24 px) plus a one-colour symbolic version.

Product decisions behind it live in the project documents: product direction, v1 scope and domain model, information architecture and glossary, and visual design decisions.

## Principles
1. **Precise where it counts, warm everywhere else.** Figures, tables and instruments are exact and dense (Plex Mono, tick scales). Everything around them is calm and roomy (Figtree, generous spacing, rounded panels).
2. **Every figure can show its working.** Select any number to see the filter and the transactions behind it. Design every figure with that in mind.
3. **Facts, not alarms.** Attention colour marks what needs the family. Nothing turns red because money was spent.
4. **The family decides.** Suggestions look like suggestions, carry their evidence, and wait for Accept / Change / Dismiss.
5. **Themes are skins, not layouts.** Changing theme changes colour and transparency only. Layout, type, icons and spacing never change.

## Content fundamentals
- **Voice:** helpful, warm, slightly dry. A capable family finance assistant, not a mascot. No exclamation marks, no "magic", no praise inflation.
- **Active voice, naming who acts:** you, the app, the assistant or the bank.
  - Write "You last imported Regninger on 17 Oct", not "Regninger hasn't been imported since 17 Oct".
  - Write "The app skipped 2 duplicates", not "2 duplicates were skipped".
  - Short status labels of two to four words may drop the verb if they still name the actor: "Entered by you", "Suggested by the assistant".
- **One vocabulary:** account, bucket, job, group, unassigned, buffer, suggestion. Never category, envelope, pot, expense, recommend or advise. The full glossary, with Norwegian equivalents (post, pott), is in the information architecture document.
- **British English** and sentence case. Norwegian terms that lose meaning in translation stay Norwegian: barnetrygd, feriepenger, konfirmasjon, kommunale avgifter, EU-kontroll.
- **Numbers:** "68,048 kr" in English, "68 048 kr" in Norwegian. No decimals unless øre matter. Dates "7 Nov", "7 November 2026", ranges "Dec–Jun".
- **Provenance on every figure:** calculated by the app, entered by you, or found in an import.

## Visual foundations
- **Colour themes.** Five token themes cover the four choices users see:
  - Hearth (light and dark), the default
  - Instrument (dark and light)
  - Follow my desktop, shown here with an example Caelestia scheme, Fjord. In the app this theme reads the live palette from Caelestia.
  - Each theme fills the same roles: bg, surface, surface-raised, line, text, text-muted, accent, attention, danger and the chart tokens. See the "Themes and glass" section.
- **Colour use:**
  - **accent:** the one thing to act on, or "this" in a chart.
  - **attention:** needs the family (import due, short, over).
  - **danger:** only for destructive actions and real errors.
  - **Never colour alone:** every state also has words, an icon or a position.
- **Type.**
  - Figtree for the interface: title-screen, title-section, body, label, caption.
  - IBM Plex Mono for data: figure-xl, figure-l, table, data-caption.
  - One screen title per screen. No sizes between the steps.
- **Spacing:** a 4px base, dense within, spacious between.
  - Cards pad space-4 in dense areas and space-5 in summaries.
  - Sections sit space-8 apart.
- **Radii:** radius-xs for instrument bars, radius-sm for key chips, radius-md for controls, radius-lg for cards, radius-xl for panels, radius-full for pills.
- **Elevation:**
  - Hearth light uses shadow-card.
  - Dark themes and Instrument separate with surface and line, not shadows.
- **Glass:** a setting, off by default. When on, panels use glass-panel (or glass-panel-strong for text-heavy panels), glass-edge and a backdrop blur of glass-blur, with shadow-glass. "Reduce transparency" (glass off) is always available.
- **Motion:**
  - **Durations:** 120ms for hover and press, 200ms for panels and expanding rows, 280ms for overlays (Ask or find).
  - **Easing:** cubic-bezier(0.2, 0, 0, 1).
  - **What moves:** only what changed (a bar growing to its new value, a row arriving after an import).
  - **Reduced motion:** with prefers-reduced-motion, changes are instant.

## Iconography
- **Lucide** (ISC licence; a few icons MIT, from Feather): 20px (icon-md) in navigation, 16px (icon-sm) in buttons and chips.
  - Stroke 1.75 in Hearth and Follow my desktop, 1.5 in Instrument.
  - Icons inherit text colour.
- **Key chips:** each sidebar item shows its single-letter shortcut in a key-chip-sized box (radius-sm, 1px line border; accent border when active).
- **No brand logos** for banks or insurers. Use plain names or initials.
- **No emoji** anywhere in the interface.

## Accessibility
- **Contrast:** text meets 4.5:1 on bg, surface and surface-raised in every theme (3:1 at 24px and above). Glass opacities are set so this holds over any wallpaper.
- **Targets:** at least target-min (44px).
- **Focus:** a visible 2px focus ring, never removed.
- **Shortcuts:** single-key shortcuts never fire inside text fields, and can be turned off or reassigned (WCAG 2.1.4).
- **Charts:** every chart labels its values directly, and never relies on colour alone.

## Using the tokens
- **Theme switching:** set `data-theme` on the root to one of hearth-light, hearth-dark, instrument-dark, instrument-light, or the desktop theme. Every role is a CSS custom property (`--accent`, `--surface` and so on). Type styles are classes (`.body`, `.figure-xl`).
- **No hard-coded colours.** Colour literals (hex, `rgb()`, `hsl()`, `oklch()`, named colours) live only in the top-level token declarations in `tokens.json`, and in the CSS generated from it. Components, CSS Modules, charts and inline SVG use `var(--token)`, `currentColor` or `inherit`. Need a translucent or blended colour? Use `color-mix()` on tokens, or add a token for every theme. Changing a theme or the palette then means editing one file. The app icon masters are the only exception.
- **Follow my desktop:** the app writes the desktop theme's values at runtime from Caelestia's Material 3 palette, using the mapping in "Themes and glass". The Fjord values here are only an example.
- **Fonts and icons:** bundle Figtree and IBM Plex Mono (both SIL Open Font License 1.1) and Lucide inside the app. Never load anything from the internet at runtime. The previews in this system load the fonts from Google Fonts only because they are previews.

## Licences
| Asset | Licence |
|---|---|
| Holt code, app icon and this system | MIT |
| Figtree | SIL OFL 1.1 |
| IBM Plex Mono | SIL OFL 1.1 (Reserved Font Name "Plex") |
| Lucide | ISC (some icons MIT, from Feather) |
