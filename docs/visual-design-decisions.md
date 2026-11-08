# Holt: visual design decisions (v0.6, 8 Nov 2026)

Companion to the other documents in `docs/`. This records the visual direction chosen from the mockup canvas, and the app's name and icon.

**The design tokens live in the design system.** In this repository: `design/design-system/` (`tokens.json`, `themes.md`, `charts.md`, `README.md`, and component previews). Online: https://claude.ai/artifact/64ysnMJp3LqYpk4CcYkGPB ("Holt — design system"). It holds:
- the colour roles for every theme, with the Material 3 mapping for "Follow my desktop"
- the type scale, spacing, radii, shadows and glass
- chart rules, plus six components with live previews (Button, NavItem, TickScale, ProportionBar, MonthRibbon, Suggestion)

The design system is the single source for values. This document records the decisions behind them.

**Mockups:** https://claude.ai/artifact/Jv8Qd23PCU7tUBaFQS5Z1g ("Holt — design canvas"). Screenshots are in `design/mockups/`, and the mockup source files (with the exact interface copy) in `design/mockups/source/`. The core screens (v0.3) use the design system: Hearth light by default, with Hearth dark and Hearth dark with glass as tweaks. Three boards check the Overview in Instrument dark, Instrument light and Fjord.

## Name and identity

### Name: Holt (decided 7 Nov 2026)
- **Meanings:**
  - In Old English and Old Norse, a small wood or grove. It is also a common Norwegian place name and surname.
  - In British English, an otter's den by the water. The Eurasian otter, the one found in Norway, lives in holts.
  - A variant of "hold": a refuge or stronghold.
- **Why it fits:**
  - It means a home, and a safe place for the household's reserves, kept on the family's own computer.
  - It is one syllable and easy to say in Norwegian and English.
  - It is calm rather than cute.
- **Rejected:**
  - Varde (too close to *vorte*, wart).
  - Oter (reads as "Otter", which is crowded, including Otter.ai and the Otter browser in the AUR).
  - Felles, Stabbur and Pott.
  - Larder, Keel, Kitty, Tun, Hearth, Allot, Tally and Ledger, all for collisions.
- **Repository and app ID:** `holt-budget` and `ink.chiang.holt` (decided 8 Nov 2026). "Holt" is a common surname, so the fuller handle keeps search results useful. The app itself is simply "Holt".
- **Before going public:** check availability on the AUR and Flathub, and with Patentstyret (Norway) and EUIPO.

### What Holt is
- **Category:** a *household budget planner*, not a "manager".
  - It never connects to the banks, moves money or pays anything.
  - It reads imports, tracks what actually happened against the plan, and helps decide what happens next.
- **Purpose statement:** *Holt helps a household give every unit of money a job, showing where the shared money comes from, where it goes and what it's set aside for, from this month's spending to the long-term plan. It runs entirely on your own computer, with an AI assistant that explains and suggests but never decides.*
- **Tagline:** "Every unit of money a job". The cover preview and the Plan mockups still carry the older "krone" wording and are not regenerated yet.

### App icon: the grove (decided 8 Nov 2026)
- **Concept:** four trunks of a small wood standing on one strip of ground. The trunks also read as a bar chart.
- **Colours:** dark green plate (#1f5446, the Hearth accent). Trunks in three light tones (#f3f1ee, #c0cfcb, #84a199). One orange ground line (#e09a73), the only accent, matching the app's rule that accent means "needs you".
- **Three masters,** so every size renders crisply:
  - *Main* (48 px and up): four trunks 32 wide with gaps of 10, a ground line 12 thick, centred in the plate (256-unit grid, plate 16–240, corner radius 52).
  - *Small* (16 and 32 px): three trunks drawn on whole pixels of a 16 px grid.
  - *24 px*: its own file on a 24 px grid.
- **Symbolic icon:** one colour, no plate, for the bar, tray and notifications. It takes the bar's text colour.
- **One icon for every theme:** the launcher and sidebar icon is the same in all five themes. The themes change around it.
- **Tried and dropped:** making the tallest trunk a tree (round, spruce and tiered versions). The spruce worked technically, but it weakened the double reading as a chart and hinted at "money grows". The plain grove stays.
- **Files:** `design/icon/` holds `holt.svg`, `holt-small.svg`, `holt-24.svg`, `holt-symbolic.svg`, PNGs at 16–512, and a README with install paths. Install them under the app ID (`ink.chiang.holt.svg` and so on).

## Direction
- **One layout and one set of components**, mixing A (Instrument) and B (Hearth):
  - **From A:** precision. Tick-scale instruments, tabular figures, the boxed key letters, density where data is dense.
  - **From B:** warmth. Generous spacing on summary screens, rounded corners, plain-sentence captions.
- **Colour themes are interchangeable skins** over that one layout. Only colour and transparency change between them; structure, type and icons stay the same.

## Colour themes (all available)
| Theme | Token themes | Notes |
|---|---|---|
| **Hearth** (default) | hearth-light, hearth-dark | Warm neutrals, deep green-teal accent, terracotta for attention. Light or dark follows the desktop's mode. |
| **Instrument** | instrument-dark, instrument-light | Cool, near-monochrome, one cold accent, amber for attention. |
| **Follow my desktop** | desktop (runtime), example desktop-fjord | Reads Caelestia's Material 3 palette from `~/.local/state/caelestia/scheme.json` and updates live. Uses Hearth on desktops without Caelestia. Guard rails check contrast and the accent/attention difference, nudging or falling back where needed. |
| *(Glass)* | any theme | Not a theme: a setting, off by default. |

**Accent and attention differ in lightness** in every theme (a luminance ratio of at least about 1.5), not just in hue. That way "this" and "needs you" can be told apart with any colour vision. Every text role meets 4.5:1 on bg, surface and surface-raised in all five token themes.

**Glass (transparency)** is a separate setting, **off by default**.
- When on, panels are frosted and partly see-through, 55–80% opaque so text keeps its contrast. Dialogs, such as Ask or find, use the stronger 72% panel.
- On Hyprland, the desktop compositor could blur the real wallpaper behind the window. Whether this works with Electron's transparent windows under tiling is spike 1 (see `technical-decisions.md`). Without it, the app uses an in-app blurred backdrop.
- Stephen has a frosted-glass card experiment (experiments.chiang.ink, "frosted-glass-card") to review for the panel recipe.
- "Reduce transparency" (glass off) is always available.

**Default for a fresh install:** Hearth, following the desktop's light or dark mode, glass off.

## Type
| Use | Font | Licence |
|---|---|---|
| Interface: headings, labels, sentences, buttons | **Figtree** | SIL Open Font License 1.1 |
| Tables and data: figures, amounts, dates in tables, transaction lists, instrument values, key letters | **IBM Plex Mono** | SIL Open Font License 1.1, with "Plex" as a Reserved Font Name |

- **Rule as applied in the mockups:** a figure that stands on its own (an instrument value, a table cell, an amount in a list) uses Plex Mono. A number inside a sentence stays in Figtree with tabular figures, so prose never switches font mid-line.
- **Bundle both fonts with the app.** It must never load fonts from the internet at runtime (local-only rule). The mockups and design-system previews load them from Google Fonts only because they are previews.
- Ship each font's OFL licence file alongside the fonts.
- If the fonts are ever modified (beyond plain subsetting), a modified Plex must not be called "Plex". Shipping unmodified files avoids the question.
- Scale: five interface styles (title-screen 32, title-section 19, body 15, label 13, caption 12) and four data styles (figure-xl 28, figure-l 20, table 13, data-caption 11). The Overview instruments in the mockups use 30 px figures; use figure-xl when building.

## Charts
**Rule:** no rings, pies or donuts anywhere. Every chart answers one question, labels its values directly, shows figures in Plex Mono, never relies on colour alone, and opens its working on selection. The full table of which chart answers which question is in `design/design-system/charts.md`.

## Icons (interface)
- **Chosen pack: Lucide.** The restyled mockups use real Lucide icons (v1.70): search, layout-dashboard, arrow-left-right, list-checks, repeat, calendar-check, shield, settings, cpu and upload.
  - **Licence:** ISC, a permissive licence that sits comfortably inside an MIT project. A few icons derived from Feather are under MIT.
  - **Obligation:** keep Lucide's copyright and licence notice in the repository and in the app's open-source notices (Settings → About).
  - **Size and stroke:** 18px in navigation, 16px in buttons. Stroke 1.75, or 1.5 in Instrument.
- **One icon set for all themes.** Themes change colour, never icons.
- **Alternatives if Lucide falls short:** Phosphor (MIT) or Tabler (MIT).
- **No brand logos** for banks or insurers.

## Sidebar (as restyled)
- Holt icon and wordmark at the top.
- Ask or find (A), then Overview (O), Transactions (T), Plan (P), Recurring costs (R), Monthly review (M) and Insurance (I). Each row shows its key letter in a small Plex Mono chip, filled with the accent on the current screen.
- Badges are facts: "Due" on Transactions, the unassigned amount on Plan, the number of flags on Recurring costs, "Ready" on Monthly review.
- At the bottom: assistant status, then Settings (S).
- The main "new" action on a screen shows N in its button (Import on Transactions, New job on Plan).

## Licence summary for the repository (MIT)
| Asset | Licence | What to ship |
|---|---|---|
| App code and app icon | MIT | `LICENSE` |
| Figtree | SIL OFL 1.1 | `fonts/Figtree/OFL.txt` |
| IBM Plex Mono | SIL OFL 1.1 (Reserved Font Name "Plex") | `fonts/IBMPlexMono/OFL.txt` |
| Lucide icons | ISC (some icons MIT, from Feather) | Lucide licence text in `THIRD_PARTY_NOTICES.md` |

All third-party notices are also shown in the app under Settings → About → Open-source notices.

## History
- **8 Nov 2026:** renamed the design system and the canvas to Holt. Restyled the core screens with the design system: Import renamed to Transactions (with Needs you, All and Imports tabs), key chips, Lucide icons, the Holt icon, Figtree and Plex Mono, and an active-voice copy pass. Added the Electricity job panel and winter estimates on the Overview.

## Next
- Review the frosted-glass experiment for the glass recipe.
- Design the Gifts and occasions panel (v1.x) when its turn comes.
