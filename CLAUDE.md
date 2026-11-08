# Holt

Holt is a household budget planner for Linux (Arch, CachyOS, Hyprland with Caelestia), open source under MIT. It runs entirely on the family's own computer, with a local AI assistant that explains and suggests but never decides. The first household is a family in Norway (NOK, banks Bulder and SpareBank 1 SR-Bank). Its private details are in `private/household.md` when that folder exists. Never copy anything from `private/` into a tracked file.

The product, design and technical decisions were made before any code. **Read the documents before changing behaviour**, and keep them true as the code evolves.

## Documents (read in this order)
1. `docs/product-direction.md`: what Holt is, for whom, and the decisions so far.
2. `docs/v1-scope-and-domain-model.md`: what's in v1, the objects, the 13 rules that must always hold, and the awkward cases.
3. `docs/information-architecture-and-glossary.md`: screens, where each object lives, keyboard, the glossary, and the writing conventions.
4. `docs/visual-design-decisions.md` and `design/`: themes, type, charts, icons, and mockups.
5. `docs/technical-decisions.md` and `docs/decisions/`: the stack, the architecture, security, spikes.
6. `BACKLOG.md`: what to build, in order.

## Rules that are never broken
- **Nothing leaves the machine.** No network calls except to the local model endpoint on 127.0.0.1 or ::1. No telemetry, no auto-update, no remote fonts or assets, no fetching URLs that users type in. Any new dependency that phones home is rejected.
- **Figures come only from `packages/core`.** The language model may choose a filter, propose a change or draft words. It never produces a number the family sees. Every reply from the model is validated against a schema.
- **Money is integer øre.** Never floats for amounts. Format only at the edge, with `Intl.NumberFormat('en-GB')` plus " kr".
- **Nothing changes without approval.** Suggestions are proposals with evidence; only an accepted proposal changes data. Every change is recorded and can be undone.
- **Estimates are never actuals.** Mark them (≈, est.), show their method, replace them when the real transaction arrives.
- **Never accept `safeStorage`'s `basic_text` backend.** See `technical-decisions.md` §5.
- **The renderer stays sandboxed:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict CSP, and only the typed bridge in `apps/desktop/src/preload`.

## Stack
- Electron (latest stable; 45.x at handover), pnpm workspaces, TypeScript everywhere.
- Renderer: React 19, React Router in SPA data mode (`createHashRouter`), Vite via electron-vite. No HTTP server.
- Storage: SQLite via better-sqlite3-multiple-ciphers (encrypted), in the main process only.
- AI: any OpenAI-compatible local runtime (llama-server, LM Studio/llmster, Ollama), through an adapter in the main process.
- Styling: CSS custom properties generated from `design/design-system/tokens.json`, plus CSS Modules. Icons: lucide-react. Fonts: Figtree and IBM Plex Mono, bundled.
- Tests: Vitest (core, importers), Playwright for Electron (smoke), axe for accessibility.

## Repository layout
```
apps/desktop/          Electron app: src/main (database, imports, AI, files), src/preload (typed bridge), src/renderer (React)
packages/core/         Pure TypeScript domain logic: money, jobs, buckets, rules, estimates, reconciliation, undo. No Electron, no I/O.
packages/importers/    CSV and OFX parsing, bank format profiles, duplicate detection
packages/ui/           Design-system components; scripts/build-tokens.mjs turns tokens.json into CSS variables
design/                Design system, icon, mockup screenshots and source (exact interface copy)
docs/                  Product, scope, IA, visual and technical decisions; decision records
private/               Gitignored: the first household's details and real bank exports. Never committed.
```
`packages/core` must not import from Electron, Node's `fs`, the network, or React. If something needs I/O, it belongs in `apps/desktop/src/main` and calls into core.

## Commands
```
pnpm install
pnpm tokens          # regenerate packages/ui/src/tokens.css from design/design-system/tokens.json
pnpm test            # Vitest across packages
pnpm typecheck
pnpm dev             # run the desktop app with hot reload
pnpm build           # production build
pnpm dist            # package (AppImage, pacman) with electron-builder
```

## Writing conventions (interface text, docs, commit messages)
- British English, sentence case, no exclamation marks.
- **Active voice, naming who acts:** you, the app, the assistant, or the bank. "The app skipped 2 duplicates", not "2 duplicates were skipped". Short status labels may drop the verb ("Up to date", "Entered by you").
- Use the glossary's words. Job, not category. Bucket, not pot or fund. Suggest, never recommend or advise. No "smart", "magic" or "AI-powered".
- The mockup source files in `design/mockups/source/` hold the agreed interface copy. Start from them.
- All interface strings go through the message files (FormatJS ICU), never hard-coded, so Norwegian is a translation later.

## Code conventions
- Strict TypeScript. No `any` in core. Prefer plain functions and data over classes in core.
- Name things with the glossary's terms (`Job`, `Bucket`, `Assignment`, `Allocation`, `Estimate`), not synonyms.
- Every rule in `v1-scope-and-domain-model.md` ("Rules that must always hold") should have tests in core.
- Use the Electricity figures in `design/README.md` as fixtures for the estimate and bucket logic.
- Accessibility: keyboard-first (see the IA keyboard section), visible focus, 4.5:1 contrast, no meaning by colour alone, respects reduced motion and reduced transparency.

## How to work
- Start with the spikes in `BACKLOG.md`. Record what each spike found in `docs/decisions/` (a new record, or an update to an open one).
- If the code needs to differ from a document, change the document in the same change and say why. Don't let them drift.
- Product decisions (what Holt does, what it's called, what it shows) belong to Stephen. Propose; don't decide silently.
- Keep the app lean: one window, lazy routes, virtualised long lists, no heavyweight UI kits.

## Definition of done
- Tests pass, types check, and the no-network test passes.
- Interface text follows the writing conventions and comes from the message files.
- Works in Hearth light, Hearth dark and with glass on, and with the keyboard alone.
- Docs updated if behaviour or decisions changed.
