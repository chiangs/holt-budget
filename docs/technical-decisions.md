# Holt: technical decisions (v0.5, 8 Nov 2026)

Companion to the other documents in `docs/`. Each decision states what was chosen, why, what it costs, and what would change it. Status is **Decided** unless marked otherwise. Short decision records live in `docs/decisions/`.

**The reference machine (8 Nov 2026).** These facts shaped the choices below. Checks that are specific to the family's own machine live in `private/`, outside the repository.
- **GPU:** NVIDIA RTX 4090 (24 GB). Qwen 3.8 27B runs on it with about 55,000 tokens of context.
- **Desktop:** Hyprland on Wayland, with a Secret Service keyring running. Hyprland is why §5 forces the keyring backend.
- **Runtime:** still testing llama.cpp and LM Studio's `llmster`. Holt supports both.
- **Builder:** Stephen, with Claude Code, comfortable in TypeScript. Open to any framework.
- **Repository:** `holt-budget`. **App ID:** `ink.chiang.holt`.

## Summary
| # | Decision | Choice | Status |
|---|---|---|---|
| 1 | App shell | **Electron** (latest stable, 45.x in Nov 2026) | Decided |
| 2 | UI layer | **React 19 + React Router (v8) in SPA data mode + Vite.** No HTTP server. | Decided |
| 3 | Process architecture | Domain core in pure TypeScript that stores nothing: changes are commands, and figures are worked out from facts. Main process owns data, imports, AI and all network access; sandboxed renderer; typed IPC | Decided |
| 4 | Storage | **SQLite**, encrypted with **better-sqlite3-multiple-ciphers**; plain SQL migrations, no ORM | Decided (spike 2 confirms the build) |
| 5 | Encryption key | One data key in two copies: the desktop keyring (forced, see 5) for daily unlock, and a recovery code for backups; passphrase when there's no keyring; never `basic_text` | Decided |
| 6 | Local AI | **OpenAI-compatible endpoint on localhost**: llama-server and LM Studio/llmster both supported; JSON-schema output | Decided |
| 7 | Model | Qwen 3.8 27B by default on the 4090; bake-off against Gemma 4 26B-A4B | Proposed (spike 3) |
| 8 | Themes and Caelestia | Tokens compiled to CSS variables; "Follow my desktop" watches Caelestia's `scheme.json` | Decided |
| 9 | Glass | v1: in-app glass. Compositor blur of the real desktop: experimental. Review Stephen's frosted-glass experiment | Open |
| 10 | Packaging | **AUR first**, AppImage second, Flatpak later | Decided |
| 11 | Mobile access | **Neither dsh nor RustDesk.** Not in v1. Later: read-only view served by Holt over a private network | Decided (direction) |
| 12 | Name | Repository `holt-budget`, app ID `ink.chiang.holt` | Decided |
| 13 | Code and data | The public repository holds code and docs only. Household data stays in XDG folders; dev uses its own; real exports stay in `private/` | Decided |
| 14 | Backups | Automatic, versioned and encrypted, to a folder you choose; your own sync tool may upload it | Decided |
| 15 | Schemas | **Zod 4**: one definition per shape for model replies, IPC arguments and database rows | Decided |

---

## 1. App shell: Electron
**Why Electron over Tauri for Holt:**
- **The NVIDIA GPU.** On Linux, Tauri renders through WebKitGTK, and on NVIDIA that combination is the most common source of blank windows, flicker and crashes on resize. The usual workarounds turn off WebKitGTK's faster rendering path. Electron bundles its own Chromium, so rendering is the same on every machine.
- **Wayland is native.** Electron defaults to Wayland from 38.2. Since 41, frameless windows with custom title bars get proper client-side decorations.
- **One engine, one language.** The whole stack is TypeScript, and the design (backdrop blur, Plex Mono figures, SVG charts) renders exactly as in the mockups.
- **Native modules** such as encrypted SQLite have well-trodden Electron builds.

**What it costs:** a larger install (around 85–100 MB) and more idle memory than Tauri. Published figures disagree. Most benchmarks put Electron at roughly 2× Tauri's idle RAM (about 150–250 MB against 50–80 MB); some real-world measurements found WebKitGTK using more memory than Chromium under load. Acceptable for a single-window desktop app.

**Keeping it lean:** one window; routes loaded lazily; virtualised long lists; no heavyweight UI kit; startup time measured in CI.

**Would change the decision:** a requirement for a mobile app from the same codebase (Tauri 2 targets iOS and Android), or WebKitGTK's NVIDIA problems being fixed upstream.

**Version policy:** track the latest stable Electron. The Electron team supports only the three newest majors, which roll every eight weeks.

## 2. UI layer: React + React Router (SPA) + Vite, with no server
- **Plain TypeScript was rejected.** Holt has many interdependent, stateful views (panels, the New job flow, Apply and Undo, live theme switching). Without a framework, hand-built reactivity becomes the project.
- **React 19** is what Claude Code knows best, and the data volumes are small (thousands of transactions).
- **React Router in SPA data mode** (`createHashRouter` or `createMemoryRouter`, both still in v8). Loaders and actions call Holt's typed bridge to the main process, so the data-loading pattern needs no server.
- **Why there's no HTTP server:**
  - In Electron the main process already is the back end, reached through IPC with no network port.
  - A local HTTP server opens a port on localhost that other programs, or a web page in the browser, can try to reach. For financial data, that's attack surface with nothing gained.
  - Server rendering helps first load over a network and search ranking. Holt has neither.
  - React Router's framework mode injects an inline bootstrap script, which conflicts with a strict Content Security Policy.
  - The only future server is the read-only phone view (11). It will be a small, separate service, off by default, and doesn't shape v1.
- **Vite** through electron-vite for main, preload and renderer builds.
- **Styling:** CSS custom properties generated from `design/design-system/tokens.json` (see `packages/ui/scripts/build-tokens.mjs`), plus CSS Modules. No utility framework.
- **Charts:** Holt's own SVG components (tick scale, proportion bar, month ribbon, job history), with d3-scale and d3-shape for maths only.
- **Icons:** lucide-react. **Fonts:** Figtree and IBM Plex Mono bundled as files.
- **Text:** ICU messages (FormatJS) from day one, in en-GB, so Norwegian is a translation rather than a rewrite.

## 3. Process architecture and security
```
packages/core       pure TypeScript: money (integer minor units), jobs, buckets, rules, estimates,
                    reconciliation, undo log. No Electron, no I/O. Fully unit-tested.
packages/importers  CSV and OFX parsing, bank format profiles, duplicate detection
packages/ui         design-system components built from tokens.json
apps/desktop        Electron main (database, imports, AI client, files), preload (typed bridge),
                    renderer (React)
```
- **The renderer is sandboxed:** `contextIsolation`, `sandbox: true`, no Node integration, and a small typed IPC surface.
- **Network is denied by default.** A strict CSP and a `session.webRequest` filter block every request from the renderer. That filter only sees Chromium's traffic, from the renderer and from Electron's `net`. Node's own `fetch`, `http` and `net` in the main process bypass it, and that is where the model client and every main-process dependency run. So:
  - all main-process HTTP goes through one function that uses `net.fetch` and refuses any address but 127.0.0.1 or ::1;
  - a lint rule bans `node:http`, `node:https`, `node:net`, `undici` and the global `fetch` in `apps/desktop/src/main`, apart from that one function;
  - the no-network test runs the packaged app in a network namespace with only loopback, and fails on any outbound connection attempt;
  - the renderer's filter allows only the app's own files and, while developing, the dev server. Today it also allows loopback, which Milestone 1 removes.

  No auto-updater (the package manager updates Holt), no telemetry, no remote fonts.
- **All figures come from `core`.** The AI client can only return validated JSON: a filter, a proposal or words. Core stores nothing. It applies commands to facts and works out every figure with one pure function (see "Facts and figures" and "Changes are commands" in the domain model).
- **Core types.** Dates are branded strings, `LocalDate` ("2026-11-08") and `Month` ("2026-11"), never `Date`, which can shift a day across time zones. Each kind of object has its own branded ID (UUIDv7 text), so a job's ID can't be passed where an account's belongs.
- **Money:** whole minor units of the household's one currency (øre, cents, or whole yen), held as JavaScript numbers. The branded `Money` type carries no currency, because a household has exactly one. A mix can't be built and nothing converts. The currency is an ISO 4217 code on the household. Core reads the number of minor-unit digits from `Intl` (`resolvedOptions().maximumFractionDigits`), so there is no currency table to keep, and checks codes against `Intl.supportedValuesOf("currency")`. Display formatting belongs in the renderer's message layer (FormatJS), so Norwegian can show "68 048 kr". Core parses and does arithmetic only. `formatKroner` has left core, and the message layer takes over its job in Milestone 1. Display follows `Intl` for the language and currency ("$68,048", "€68,048"), with one override. Kroner in English are written "68,048 kr", as in the mockups.
- **Bundling the main process.** electron-vite leaves `dependencies` out of the main and preload bundles. `@holt/core` and `@holt/importers` export TypeScript source, so `electron.vite.config.ts` lists them in `build.externalizeDeps.exclude` and they are bundled. Without that, the built main process would import TypeScript at runtime.

## 4. Storage: SQLite, encrypted
- **One database file** in `$XDG_DATA_HOME/holt/` (usually `~/.local/share/holt/`), in WAL mode. `pnpm dev` uses `holt-dev` instead, filled with synthetic data, so development never opens the family's database (§13).
- **Migrations** are plain SQL files, applied in order and tracked with `PRAGMA user_version`. No ORM. Each table has a small typed module in the main process, and rows are parsed with Zod (§15) as they leave SQLite. A test compares each row schema with `PRAGMA table_info`, so a migration and its type can't drift apart.
- **Library: better-sqlite3-multiple-ciphers** (MIT): fast, synchronous, page-level encryption (default ChaCha20-Poly1305, with a SQLCipher-compatible mode). Plain `node:sqlite` has no encryption, and node-sqlite3 was archived in July 2026. The fallback is @signalapp/sqlcipher.
- **Backups:** see §14.
- **Undo** is built on the change-record table. Each record holds the command and every affected row before and after, as in the domain model.

- **The currency** is a column on the household row. A CHECK keeps it to three capital letters, and Zod checks it against `Intl.supportedValuesOf("currency")` (§15). It never changes once data exists (domain model, decision 15).

## 5. The encryption key on Hyprland
- **The catch:** Electron's `safeStorage` picks a key store by recognising the desktop environment. Hyprland isn't on its list, so it falls back to `basic_text` (a hard-coded password that protects nothing) **even when a keyring is running**.
- **The keyring lives on the same disk.** gnome-keyring keeps its file in `~/.local/share/keyrings/`, and KWallet in `~/.local/share/kwalletd/`. If the disk fails, the keyring goes with the database. A key kept only in the keyring can't open a backup on a new machine.
- **Holt's behaviour:**
  1. Setup creates one random 256-bit data key. It encrypts the database and every backup.
  2. At start-up, check whether `org.freedesktop.secrets` is on the session D-Bus (or KWallet is running).
  3. If so, start Electron with `--password-store=gnome-libsecret` (or `kwallet6`) before the app is ready. Then confirm `safeStorage.getSelectedStorageBackend()` reports the keyring. The keyring holds one copy of the data key, so Holt opens without a prompt.
  4. If no keyring is found, ask for a passphrase at launch. An Argon2id key derived from it protects that copy instead.
  5. Setup always shows a recovery code, keyring or not. An Argon2id key derived from it protects a second copy of the data key, and every backup carries that copy (§14). The family keeps the code in a password manager or on paper, never in the same cloud folder as the backups. Settings can make a new code. Backups made before then keep opening with the old one.
  6. Never accept `basic_text`.
- **Restoring on a new machine.** Install Holt, choose a backup and type the recovery code. The new machine's keyring then takes over the daily unlock.
- **A synced keyring is a bonus, not a plan.** If the Secret Service is backed by a synced store, such as KeePassXC with a synced database, the keyring's copy also survives a lost disk. Holt works with that, but never relies on it.
- **Argon2id implementation:** chosen in spike S2. Prefer one that doesn't add a second native module.
- **Checks for any machine:**
  - Keyring visible to apps: `busctl --user list | grep org.freedesktop.secrets` should print a line.
  - Disk encryption: `lsblk -o NAME,TYPE,FSTYPE,MOUNTPOINTS` shows `crypto_LUKS` and a `crypt` device above root (and home, if separate) when encrypted. `findmnt -no SOURCE /` printing `/dev/mapper/…` points the same way.
- **Full-disk encryption (LUKS)** is recommended in addition, not instead. Without it, Holt's database is still encrypted. Adding it means a reinstall (CachyOS's installer has an encryption option) or an in-place `cryptsetup reencrypt`, which is risky, so do a full backup first.

## 6. Local AI: bring your own runtime, on localhost only
- Holt connects to any **OpenAI-compatible endpoint on 127.0.0.1 or ::1**:
  - llama.cpp's `llama-server` (default port 8080)
  - LM Studio's server or its headless `llmster` daemon (1234)
  - Ollama (11434)
- Setup probes these ports, identifies the runtime and checks what it supports. You can set another port. **Non-loopback addresses are refused.**
- **A small adapter layer** covers the runtimes' differences. For example, llama-server takes the JSON schema directly in `response_format`, while LM Studio uses the OpenAI-style `json_schema` wrapper. Both constrain decoding so replies always parse. Holt still validates every reply, because a grammar guarantees syntax, not sense.
- **What the model is used for, and what it isn't:**
  - *Suggesting a job for a transaction:* only after rules and "what did you choose last time for this counterparty" have failed.
  - *Ask:* turning a question into a query in Holt's query language (JSON, defined in core by spike S5) that `core` runs and calculates.
  - *Words:* drafting the monthly review and notes from figures `core` calculated.
  - *Never:* producing a number.
- **Prompts include only the rows a task needs**, at low temperature for structured tasks.
- **One schema per reply shape.** Each task's reply is described by one Zod schema (§15). Holt converts it to JSON Schema with `z.toJSONSchema()` for the runtime's constrained decoding, and parses the reply with the same schema.
- **Words never carry figures (rule 2).** When the model writes words (an Ask answer, the review draft, notes), it receives the calculated figures as named values and writes placeholders such as `{food.spent}`. The app fills each placeholder with the formatted figure. A validator rejects any reply with a digit outside a placeholder, retries once, then falls back to a plain template. Dates and counts come through placeholders too. Spike S3 measures how often the first reply passes.
- **v1.x option:** a "managed" mode in which Holt runs `llama-server` itself, for users without a runtime.
- **LM Studio's licence:** its app is not open source (the `lms` CLI is MIT). Holt supports it, but the docs present llama.cpp as the fully open route.

## 7. Model
- **Default on the 4090:** Qwen 3.8 27B, which current lists name as the pick for 24 GB cards. The measured 55,000-token context is plenty, because Holt's tasks need roughly 4,000–16,000.
- **Bake-off (spike 3):** Qwen 3.8 27B against Gemma 4 26B-A4B. Gemma is a mixture-of-experts model that activates only part of itself per token, so it should be faster for batch categorisation after an import.
  - About 200 real, anonymised transactions to categorise.
  - 20 questions to turn into filters.
  - 3 review drafts.
  - Measure accuracy against the family's choices (target 90%, the v1 success measure), valid-JSON rate and latency.
- **For other users' hardware** (guidance in Setup): 8 GB → Qwen3.5-9B or Gemma 4 E4B; 12 GB → Gemma 4 12B; 16 GB → gpt-oss-20b.

## 8. Themes and Caelestia
- `tokens.json` is compiled at build time to CSS variables per theme: Hearth light and dark, Instrument light and dark.
- **Follow my desktop:** the main process reads Caelestia's Material 3 scheme from `~/.local/state/caelestia/scheme.json`, watches it for changes, and maps the roles as in `design/design-system/themes.md`, with the contrast and accent/attention guard rails. It falls back to Hearth when the file is missing.
- Light or dark follows the desktop through Electron's `nativeTheme` and the XDG settings portal.

## 9. Glass (open)
- **v1: in-app glass,** as in the mockups: frosted panels over a backdrop Holt draws itself. Works on every compositor.
- **Experimental: the real desktop behind Holt.** Hyprland blurs translucent windows itself when blur is on. Electron documents limits for transparent windows (they may not resize, and clicks don't pass through), which could break tiling. Spike 1 tests this.
- **To do:** review Stephen's frosted-glass card experiment (experiments.chiang.ink, "frosted-glass-card") for the panel recipe.

## 10. Packaging and releases
- **AUR first:** `holt-budget-bin` from release builds, then `holt-budget-git`. This covers Arch and CachyOS.
- **AppImage** for everyone else. **Flatpak later:** its sandbox and Secret portal suit Holt, but local-model access needs extra work.
- Built with electron-builder in GitHub Actions; releases come with checksums.
- **Desktop integration:** the icon goes into the hicolor theme as `ink.chiang.holt` (scalable SVG, PNGs from 16 to 512, and `ink.chiang.holt-symbolic.svg`), with `ink.chiang.holt.desktop`.

## 11. Mobile access
**Not in v1.** Both named options are rejected for Holt:
- **DeepSeek Harness (dsh)** is an open-source coding agent that reads and edits files and runs commands. Its remote-access plugins route through public relays, sign-in services or tunnels. One popular plugin disables Harness's own trust check for remote clients and supplies its own access control instead. Linking a phone to an agent with shell access to the machine that holds the family's finances is the wrong risk.
- **RustDesk** is full remote desktop. It can self-host its relay, but it gives the phone control of the whole computer, and a desktop budgeting interface on a phone screen is poor to use.
- **Direction for later:** a small, **read-only** phone view served by Holt itself, reachable only over a private network you control (WireGuard or Tailscale), after pairing each device with a one-time code. It would show the Overview, jobs left this month and the review. Writing from the phone is a separate decision, after the read-only view has proved itself.

## 12. Testing and quality
- **Vitest for `core`:** money rules, reconciliation, buckets, estimates (with golden files for the Electricity example), undo.
- **Property tests** with fast-check for the rules that are invariants: splits sum to the amount (rule 3), money available reconciles (4), buckets fit their account (6), and undo then redo gives the same figures (9).
- **Importer tests** against synthetic files in each bank's exact format, generated by a script and committed. The same tests run against the family's real exports in `private/fixtures/` when that folder exists, and skip otherwise. Real exports are never committed, even anonymised, because amounts, dates and merchants still describe the family.
- **Playwright for Electron** smoke tests on the main flows, with axe accessibility checks.
- A **"no network" test** in CI, in a loopback-only network namespace (§3).

## 13. Code and data are separate
The repository is public, and the household's data never enters it.
- **Runtime data** lives in XDG folders outside the repository. The database, its WAL files and the protected key copies are in `$XDG_DATA_HOME/holt/`. Settings live in the encrypted database, so a backup carries them. The only settings outside it are the few needed before unlocking, such as the data folder's location and the unlock screen's theme, in `$XDG_CONFIG_HOME/holt/`.
- **Development** uses `holt-dev` folders and synthetic data, so a half-finished migration can't touch the family's database.
- **Real bank exports** stay in `private/fixtures/`, which is gitignored. The committed fixtures are synthetic.
- **The first household's details** live in `private/household.md`. The public docs keep only the facts that explain a decision.
- **Bank format profiles** that ship with Holt are code. Profiles the family creates are data.

## 14. Backups
- **Where.** A folder the family chooses. Holt only writes files there and makes no network call. If the family's own sync tool (Syncthing, Nextcloud or Proton Drive, for example) uploads that folder, the backups survive a lost disk, and Holt itself still sends nothing anywhere.
- **When.** Automatically after each import and each approved review, and whenever the family asks.
- **Versions.** Each backup is a new dated file, and Holt keeps the most recent ones (the number is a setting). A synced folder uploads a corrupted file as readily as a good one, so one overwritten file isn't enough.
- **Written in one step.** Holt writes to a temporary file in the same folder and renames it into place, so a sync tool never uploads half a backup.
- **Format.** An encrypted copy of the database made with SQLite's backup API, with a header holding the copy of the data key that the recovery code protects (§5).
- **Restore** opens a backup with the recovery code. It is on the release checklist.

## 15. Schemas: Zod 4
One Zod schema per shape gives both the TypeScript type and the runtime check, at each boundary:
- model replies, converted to JSON Schema with `z.toJSONSchema()` for constrained decoding, then parsed with the same schema;
- IPC arguments, checked in the main process before a handler runs;
- database rows, parsed as they leave SQLite.

Inside core, code trusts these types and doesn't check them again.

---

## Spikes before committing (about one week)
Run them in the order S1, S2, S4, S5, S3. S3 needs S4's data and S5's query language.
1. **S1 Electron 45 on Hyprland with the 4090:** native Wayland, frameless window with CSD, fractional scaling, and a transparent window resized under tiling with Hyprland blur.
2. **S2 Encrypted SQLite in Electron 45:** prebuilt binaries for the current Electron ABI, WAL, the backup API, the data key's two copies (the keyring via forced `gnome-libsecret`, and the recovery code), and the passphrase fallback. It must work in the packaged AppImage and pacman builds, not only in dev, because packaging is where native modules break. A backup must restore on a fresh user account with only the recovery code.
3. **S3 Model bake-off:** Qwen 3.8 27B against Gemma 4 26B-A4B on the family's own data, through both llama-server and llmster. The family labels the 200 transactions first, and the data stays in `private/`.
4. **S4 Bank exports:** real CSVs from Bulder and SpareBank 1 SR-Bank for January to October, kept in `private/fixtures/`. Build the format profiles, and a script that writes synthetic files in each format for the committed tests. Check whether each CSV carries a closing balance (rule 5), and whether SR-Bank exports the loan account or splits interest and principal.
5. **S5 Ask query language v0:** the filters and aggregates that Ask turns a question into, as a Zod schema in core with a pure evaluator.

## Open questions
1. Glass: review the frosted-glass experiment (9).

## Sources
- [Tauri: Linux graphics issues (WebKitGTK and NVIDIA)](https://v2.tauri.app/develop/debug/linux-graphics/)
- [Electron: How Electron went Wayland-native](https://electronjs.org/blog/tech-talk-wayland)
- [Electron releases](https://releases.electronjs.org/)
- [electron-vite: dependency handling](https://electron-vite.org/guide/dependency-handling)
- [Electron: Custom window styles (transparent window limits)](https://electronjs.org/ru/docs/latest/tutorial/custom-window-styles)
- [Electron: safeStorage](https://electronjs.org/docs/latest/api/safe-storage)
- [Comparing encrypted SQLite libraries for Electron (2026)](https://codenote.net/en/posts/electron-encrypted-sqlite-libraries-comparison/)
- [better-sqlite3-multiple-ciphers](https://www.github.com/m4heshd/better-sqlite3-multiple-ciphers)
- [llama.cpp structured output (Liquid AI docs)](https://docs.liquid.ai/deployment/on-device/llama-cpp/structured-output)
- [provider-llamacpp: llama-server schema format](https://iii.dev/registry/workers/provider-llamacpp.md)
- [LM Studio: structured output](https://www.lmstudio.ai/docs/developer/openai-compat/structured-output)
- [LM Studio: developer docs and llmster](https://lmstudio.ai/docs/developer)
- [React Router v8 changelog](https://reactrouter.com/8.0.0/changelog)
- [React Router: createHashRouter](https://reactrouter.com/api/data-routers/createHashRouter.md)
- [Best local LLMs by VRAM tier (2026)](https://www.promptquorum.com/local-llms)
- [Best local LLM by VRAM (October 2026)](https://vdf.ai/blog/best-local-llm-by-vram/)
- [Tauri vs Electron memory discussion (tauri#5889)](https://github.com/tauri-apps/tauri/issues/5889)
- [Tauri vs Electron 2026 benchmarks](https://tech-insider.org/tauri-vs-electron-2026/)
- [DeepSeek Harness Remote](https://raw.githubusercontent.com/liguobao/ds-harness-remote/c374397dea2bea0e5a81adc993553be992102bc6/README.md)
- [dsh-full-remote security model](https://socket.dev/npm/package/dsh-full-remote/overview/0.2.5)
- [Running DeepSeek Harness (what dsh is)](https://exe.dev/deploy/deepseek-harness)
- [kui-native: how Hyprland blurs translucent windows](https://docs.rs/crate/kui-native/latest/source/src/linux_blur.rs)
- [React Router v7 SPA mode and strict CSP](https://www.technetexperts.com/react-router-v7-strict-csp-guide/amp/)
