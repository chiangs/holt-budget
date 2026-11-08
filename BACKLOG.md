# Backlog

Ordered. Each milestone ends with something Stephen can run. Product details are in `docs/`; don't re-decide them here.

## Milestone 0: Spikes (about one week)
Findings go in `docs/decisions/` as new records.

- [ ] **S1 Electron on Hyprland with the RTX 4090.** Native Wayland, frameless window with client-side decorations, fractional scaling, focus and keyboard. Then a transparent window (`transparent: true`) under tiling: does it resize, and does Hyprland blur what's behind it? *Done when:* a record says whether "Show the desktop behind Holt" is viable.
- [ ] **S2 Encrypted SQLite in Electron.** better-sqlite3-multiple-ciphers prebuilt for the current Electron ABI, WAL mode, the backup API, a key from the keyring via `--password-store=gnome-libsecret` (confirm `getSelectedStorageBackend()`), and the Argon2id passphrase fallback. *Done when:* the app opens, writes, backs up and restores an encrypted database, and refuses `basic_text`.
- [ ] **S3 Model bake-off.** Qwen 3.8 27B against Gemma 4 26B-A4B, through both llama-server and llmster. About 200 anonymised transactions to categorise, 20 questions to turn into filters, 3 review drafts. Measure accuracy, valid-JSON rate and latency. *Done when:* a record names the default model and the prompt and schema shapes that worked.
- [ ] **S4 Bank exports.** Real CSVs from Bulder and SpareBank 1 SR-Bank for January to October. Anonymise them (names, references) and commit them as fixtures. *Done when:* `packages/importers` has a format profile and passing tests for both banks.

## Milestone 1: Walking skeleton
- [ ] Window with the sidebar (keys A O T P R M I S), routes for every screen, the Holt icon, and Hearth light, dark and glass from generated tokens.
- [ ] Typed IPC bridge; the main process opens the encrypted database and runs migrations.
- [ ] Network lock-down: CSP, `session.webRequest` filter, and the CI no-network test.
- [ ] Message files (en-GB) wired up; no hard-coded strings.
- [ ] Packaging: AppImage and a PKGBUILD for `holt-budget-bin` that installs the icon and `.desktop` file under `ink.chiang.holt`.

## Milestone 2: Core money model
- [ ] `packages/core`: money (øre), household, accounts, groups, jobs (three kinds), the buffer, assignments, buckets, unassigned and over-assigned, next month's money.
- [ ] Change records and undo/redo.
- [ ] Tests for every rule in "Rules that must always hold".

## Milestone 3: Transactions
- [ ] Import CSV/OFX with format profiles, duplicate detection, balance check, undo a whole import.
- [ ] Needs you, All and Imports tabs. Confirm or change a job, split, mark as transfer (pair matching), refund, note.
- [ ] Rules ("always do this") and "same as last time" suggestions; the model only for the rest, as proposals.
- [ ] "Up to date" status per account and import reminders.

## Milestone 4: Plan
- [ ] Jobs table by group with assigned, spent and status. Assign and move money.
- [ ] New job flow with "where it comes from" and knock-on effects.
- [ ] Where the money sits (accounts and buckets), Money in (contributions), children's accounts.
- [ ] Job panel: history, 12-month estimate with method, Follow the bills or Even it out, start now or start in April, Apply and Undo (see the `PlanElectricity` mockup).

## Milestone 5: Overview and Monthly review
- [ ] Vital signs with reference lines; Money Map; next 12 months with estimates marked ≈; assistant notes.
- [ ] Monthly review: calculated figures, assistant draft, decisions applied on approval, markdown export, completeness.

## Milestone 6: Setup, Recurring costs, Ask or find, Settings, Backup
- [ ] Setup (7 steps), including the first import of the year so far and runtime detection.
- [ ] Recurring costs: detection, subscriptions shelf, cancel-and-watch, price-rise and new-charge flags, contract reminders.
- [ ] Ask or find: Find (no AI) and Ask (filter → core → words), with show working.
- [ ] Settings list, Follow my desktop (Caelestia), encrypted backup and restore.

## v1.x (after three real monthly cycles)
- [ ] Insurance.
- [ ] Occasions and gifts (decision 9 in the scope document).
- [ ] What-ifs in Ask or find.
- [ ] Household cash-flow forecast.
- [ ] PDF statements read by the local model.
- [ ] Build project scenarios.
- [ ] Norwegian (Bokmål) interface.
