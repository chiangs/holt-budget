# Design files

Everything here is reference material for building Holt's interface. The decisions behind it are in `docs/visual-design-decisions.md`.

| Folder | What it holds |
|---|---|
| `design-system/` | The design system: `tokens.json` (every colour, type, spacing, radius, shadow, size and blur token, per theme), `README.md` (principles and usage), `themes.md` (the four themes, glass, and the Caelestia Material 3 mapping with guard rails), `charts.md` (which chart answers which question; no rings, pies or donuts), and `components/` (live HTML previews of Button, NavItem, TickScale, ProportionBar, MonthRibbon, Suggestion and the Cover). |
| `icon/` | The app icon, the grove: `holt.svg` (48 px and up), `holt-small.svg` (16 and 32 px, pixel-fitted), `holt-24.svg`, `holt-symbolic.svg`, PNGs from 16 to 512, `icon-sheet.png` (every size, dock, sidebar, themes) and a README with install paths. |
| `mockups/` | Screenshots of the core screens in Hearth light, plus the Overview in Hearth dark, dark with glass, and the three theme checks. |
| `mockups/source/` | The mockup source files from the design canvas. They use the canvas's template syntax (`{{…}}`, `<sc-for>`, `<sc-if>`), so they don't open as plain web pages, but they hold the **exact interface copy** and the sample data. Treat the copy as the starting point for the app's message files. |

## Online versions
- Design canvas (mockups, directions, icon): https://claude.ai/artifact/Jv8Qd23PCU7tUBaFQS5Z1g
- Design system: https://claude.ai/artifact/64ysnMJp3LqYpk4CcYkGPB

## How the mockups map to the app
| Mockup | Screen | Notes |
|---|---|---|
| `Setup` | Setup (first run) | 7 steps; the screenshot shows step 1 |
| `Main` | Overview | Vital signs, Money Map, assistant notes, next 12 months with winter electricity estimates |
| `Transactions` | Transactions | Imports tab with a new import being checked |
| `Plan` | Plan | New job flow open; jobs table; where the money sits; money in; the build; the children |
| `PlanElectricity` | Plan with the job panel | Follow the bills / Even it out; start now / start in April; Apply and Undo |
| `Recurring` | Recurring costs | |
| `Insurance` | Insurance (v1.x) | |
| `Review` | Monthly review | |
| `Ask` | Ask or find | Four example answers |

## Sample data
All figures in the mockups are invented sample data for a family of six in Norway, in NOK. Bank, insurer and merchant names are illustrative. The Electricity figures are internally consistent (Jan–Oct actuals sum to 28,800 kr; the 12-month estimate is 36,300 kr) and make good test fixtures for the estimate and bucket logic in `packages/core`.
