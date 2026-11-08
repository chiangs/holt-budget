# Backlog

Ordered. Each milestone ends with something Stephen can run. Product details are in `docs/`; don't re-decide them here.

## Milestone 0: Spikes (about one week)
Findings go in `docs/decisions/` as new records. Run them in the order S1, S2, S4, S5, S3.

- [ ] **S1 Electron on Hyprland with the RTX 4090.** Native Wayland, frameless window with client-side decorations, fractional scaling, focus and keyboard. Then a transparent window (`transparent: true`) under tiling: does it resize, and does Hyprland blur what's behind it? *Done when:* a record says whether "Show the desktop behind Holt" is viable.
- [ ] **S2 Encrypted SQLite in Electron.** better-sqlite3-multiple-ciphers prebuilt for the current Electron ABI (add it to `allowBuilds`), WAL mode, the backup API, and one data key in two copies: the keyring via `--password-store=gnome-libsecret` (confirm `getSelectedStorageBackend()`) and the recovery code. Add the Argon2id passphrase fallback. Open the database in `$XDG_DATA_HOME/holt`, or `holt-dev` under `pnpm dev`. *Done when:* the packaged AppImage and pacman builds open, write, back up and restore an encrypted database, refuse `basic_text`, and restore a backup on a fresh user account with only the recovery code.
- [ ] **S3 Model bake-off.** Runs after S4 and S5. Qwen 3.8 27B against Gemma 4 26B-A4B, through both llama-server and llmster. About 200 real transactions to categorise, labelled with jobs by the family first and kept in `private/`; 20 questions to turn into S5 queries; 3 review drafts written with placeholders. Measure accuracy, valid-JSON rate, how often a reply passes the placeholder rule first time, and latency. *Done when:* a record names the default model and the prompt and schema shapes that worked.
- [ ] **S4 Bank exports.** Real CSVs from Bulder and SpareBank 1 SR-Bank for January to October, kept in `private/fixtures/` and never committed. Write a script that generates synthetic files in each bank's exact format, and commit those. Check whether each CSV carries a closing balance and states its currency, and whether SR-Bank exports the loan account or splits interest and principal. *Done when:* `packages/importers` has a format profile for both banks, with tests that pass on the synthetic files, and on the real ones when `private/fixtures/` exists.
- [ ] **S5 Ask query language v0.** The filters (accounts, jobs, dates, counterparty, amount range) and aggregates (sum, count, average, by month) that Ask turns a question into, as a Zod schema in core with a pure evaluator. *Done when:* S3's 20 questions can be written by hand as queries.

## Milestone 1: Walking skeleton
- [ ] Window with the sidebar (keys A O T P R M I S), routes for every screen, the Holt icon, and Hearth light, dark and glass from generated tokens.
- [ ] Typed IPC bridge, with arguments checked by Zod in the main process. The main process opens the encrypted database and runs plain SQL migrations (`PRAGMA user_version`).
- [ ] Network lock-down: CSP; a renderer `session.webRequest` filter that no longer allows loopback; one loopback-only `net.fetch` function for all main-process HTTP; a lint rule banning other network modules in main; the CI no-network test in a loopback-only network namespace.
- [ ] Message files (en-GB) wired up; no hard-coded strings. Format money in the message layer from the household's currency (`formatKroner` has already left core), following `Intl` for each language and currency, with "amount kr" kept for kroner in English as in the mockups (`technical-decisions.md` §3).
- [ ] Ask or find opens over the current screen, not as a route.
- [ ] Packaging: AppImage and a PKGBUILD for `holt-budget-bin` that installs the icon and `.desktop` file under `ink.chiang.holt`.

## Milestone 2: Core money model
- [ ] `packages/core`: money (minor units of the household's one currency), branded dates (`LocalDate`, `Month`) and IDs, household, accounts, groups, jobs (three kinds, each with the account where its money sits; spend jobs planned with Set amount, Follow the bills or Even it out), the buffer, budget months (planned, open, closed, reopened), assignments, buckets as the money a job keeps, unassigned and over-assigned, next month's money, moves at the bank, entered values.
- [ ] One pure function that works out every figure from the facts. Measure it on a year of synthetic data.
- [ ] Commands: one `apply` for previews, proposals and changes; change records with each row before and after; undo and redo.
- [ ] Tests for every rule in "Rules that must always hold", with fast-check property tests where the rule is an invariant.

## Milestone 3: Transactions
- [ ] Import CSV/OFX with format profiles: import rows kept per file, duplicate matching that counts, the balance check, refusing a file in another currency, and undoing an import as a new command with a preview.
- [ ] Transaction treatments (needs you, income with its funds month, transfer, split, history) and the plan start month.
- [ ] Needs you, All and Imports tabs. Confirm or change a job, split, mark as transfer (pair matching), refund, note.
- [ ] Rules ("always do this") and "same as last time" suggestions; the model only for the rest, as proposals.
- [ ] "Up to date" status per account and import reminders.

## Milestone 4: Plan
- [ ] Jobs table by group with assigned, spent and status. Assign and move money.
- [ ] New job flow with "where it comes from" and knock-on effects.
- [ ] Where the money sits (accounts and buckets) with the moves at the bank, one-off and monthly, matched against imported transfers; Money in (contributions); children's accounts.
- [ ] Job panel: history, 12-month estimate with method, Follow the bills or Even it out, start now or start in April, Apply and Undo (see the `PlanElectricity` mockup).

## Milestone 5: Overview and Monthly review
- [ ] Vital signs with reference lines; Money Map; next 12 months with estimates marked ≈; assistant notes.
- [ ] Monthly review: calculated figures, assistant draft, decisions applied on approval, markdown export, completeness.

## Milestone 6: Setup, Recurring costs, Ask or find, Settings, Backup
- [ ] Setup (7 steps), including the household's currency, the first import of the year so far, the plan start month with each account's balance split into buckets, runtime detection, the backup folder and the recovery code.
- [ ] Recurring costs: detection, subscriptions shelf, cancel-and-watch, price-rise and new-charge flags, contract reminders.
- [ ] Ask or find: Find (no AI) and Ask (filter → core → words), with show working.
- [ ] Settings list, Follow my desktop (Caelestia), and backups: automatic and versioned, written to a temporary file and renamed into place, restored with the recovery code.

## v1.x (after three real monthly cycles)
- [ ] Insurance.
- [ ] Occasions and gifts (decision 9 in the scope document).
- [ ] What-ifs in Ask or find.
- [ ] Household cash-flow forecast.
- [ ] PDF statements read by the local model.
- [ ] Build project scenarios.
- [ ] Norwegian (Bokmål) interface.
