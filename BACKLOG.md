# Backlog

Ordered. Each milestone ends with something Stephen can run. Product details are in `docs/`; don't re-decide them here.

## Milestone 0: Spikes (about one week)
Findings go in `docs/decisions/` as new records. Run them in the order S1, S2, S4, S5, S3.

- [x] **S1 Electron on Hyprland with the RTX 4090.** Native Wayland, frameless window with client-side decorations, fractional scaling, focus and keyboard. Then a transparent window (`transparent: true`) under tiling: does it resize, and does Hyprland blur what's behind it? *Done when:* a record says whether "Show the desktop behind Holt" is viable.
- [x] **S2 Encrypted SQLite in Electron.** better-sqlite3-multiple-ciphers prebuilt for the current Electron ABI (add it to `allowBuilds`), WAL mode, the backup API, and one data key in two copies: the keyring via `--password-store=gnome-libsecret` (confirm `getSelectedStorageBackend()`) and the recovery code. Add the Argon2id passphrase fallback. Open the database in `$XDG_DATA_HOME/holt`, or `holt-dev` under `pnpm dev`. *Done when:* the packaged AppImage and the `install.sh` build open, write, back up and restore an encrypted database, refuse `basic_text`, and restore a backup on a fresh user account with only the recovery code.
- [x] **S3 Model bake-off.** Runs after S4 and S5. Qwen 3.8 27B against Gemma 4 26B-A4B, through both llama-server and llmster. About 200 real transactions to categorise, labelled with jobs by the family first and kept in `private/` (all of October 2026, so the job questions have a whole month, plus about 30 others); the 24 questions in `private/questions.md` to turn into S5 queries, including the ones a query can't answer, which the model should route rather than force; 3 review drafts by the family, in `private/reviews/`, scored on content (which facts are mentioned and what is put up for decision), not tone: the assistant keeps Holt's calm voice from the writing conventions (Stephen, 9 November 2026). Measure accuracy, valid-JSON rate, how often a reply passes the placeholder rule first time, and latency. *Done when:* a record names the default model and the prompt and schema shapes that worked. Then remove the runtime and the model that lost, so this machine keeps one engine and one copy of each model.
- [x] **S4 Bank exports.** Real CSVs from Bulder and SpareBank 1 SR-Bank for January to October, kept in `private/fixtures/` and never committed. Write a script that generates synthetic files in each bank's exact format, and commit those. Check whether each CSV carries a closing balance and states its currency, and whether SR-Bank exports the loan account or splits interest and principal. *Done when:* `packages/importers` has a format profile for both banks, with tests that pass on the synthetic files, and on the real ones when `private/fixtures/` exists.
- [x] **S5 Ask query language v0.** Two kinds of query, as a Zod schema in core. **Transaction queries** filter by accounts, jobs, dates, weekdays, counterparty, text, amount range, direction, foreign currency and transfers between the household's own accounts. They total as a sum, count, average, monthly average or list, grouped by month, counterparty, job, account or currency, with the largest groups first. A pure evaluator runs them. **Figure queries** ask core for a figure it works out, such as a job's assigned, spent, left or over amount, over-assigned money or a bucket's balance; core evaluates these from Milestone 2. A question can need two queries side by side, or be answered elsewhere in Holt. *Done when:* the 24 questions in `private/questions.md` can be written by hand as queries.

## Milestone 1: Walking skeleton
- [x] Window with the sidebar (keys A O T P R M I S), routes for every screen, the Holt icon, and Hearth light, dark and glass from generated tokens. Following S1 (0040): frameless with no window buttons on Hyprland and a drag strip along the top; no `minWidth` or `minHeight`; a layout that works down to about 900 px, with the sidebar collapsing to icons and key letters when narrow.
- [x] Typed IPC bridge, with arguments checked by Zod in the main process. The main process opens the encrypted database and runs plain SQL migrations (`PRAGMA user_version`).
- [x] Network lock-down: CSP; a renderer `session.webRequest` filter that no longer allows loopback; one loopback-only `net.fetch` function for all main-process HTTP; a lint rule banning other network modules in main; the CI no-network test in a loopback-only network namespace.
- [x] Message files (en-GB) wired up; no hard-coded strings. Format money in the message layer from the household's currency (`formatKroner` has already left core), following `Intl` for each language and currency, with "amount kr" kept for kroner in English as in the mockups (`technical-decisions.md` §3).
- [x] Ask or find opens over the current screen, not as a route.
- [x] Packaging: the AppImage, and `install.sh` and `uninstall.sh` (added in S2) checked in CI. Leave out the prebuilt SQLite binaries for other platforms (about 20 MB). The AUR package waits until Holt goes public (0042).
- [ ] Fix the app icon in the AppImage. `linux.icon` in `apps/desktop/electron-builder.yml` isn't picked up, so electron-builder warns that it uses the default Electron icon. Not a priority.

## Milestone 2: Core money model
- [x] `packages/core`: money (minor units of the household's one currency), branded dates (`LocalDate`, `Month`) and IDs, household, accounts, groups, jobs (three kinds, each with the account where its money sits; spend jobs planned with Set amount, Follow the bills or Even it out), the buffer, budget months (planned, open, closed, reopened), assignments, buckets as the money a job keeps, unassigned and over-assigned, next month's money, moves at the bank, entered values.
- [x] One pure function that works out every figure from the facts. Measure it on a year of synthetic data.
- [x] Commands: one `apply` for previews, proposals and changes; change records with each row before and after; undo and redo.
- [x] Tests for every rule in "Rules that must always hold", with fast-check property tests where the rule is an invariant.

## Milestone 3: Transactions
Built as decision 0047 describes. The model's job suggestions wait for the model adapter in Milestone 6.
- [x] Import CSV/OFX with format profiles: import rows kept per file, duplicate matching that counts, the balance check, refusing a file in another currency, and undoing an import as a new command with a preview. (Formats are code and are recognised by their header, so no account stores a profile. Neither bank offers OFX; that reader was built from the format's published structure and has never met a real file.)
- [x] Transaction treatments (needs you, income with its funds month, transfer, split, history) and the plan start month. (The plan start command exists and is tested. Its screen is Setup, Milestone 6.)
- [x] Needs you, All and Imports tabs. Confirm or change a job, split, mark as transfer (pair matching), refund, note.
- [x] Rules ("always do this") and "same as last time" suggestions. The model suggesting jobs for the rest, as proposals, moves to Milestone 6, with the model adapter.
- [x] "Up to date" status per account and import reminders. (In the app: the account cards and the "Due" badge. Desktop notifications come with Settings in Milestone 6.)

## Milestone 4: Plan
- [ ] Jobs table by group with assigned, spent and status. Assign and move money.
- [ ] New job flow with "where it comes from" and knock-on effects.
- [ ] Where the money sits (accounts and buckets) with the moves at the bank, one-off and monthly, matched against imported transfers; Money in (contributions); children's accounts.
- [ ] Job panel: history, 12-month estimate with method, Follow the bills or Even it out, start now or start in April, Apply and Undo (see the `PlanElectricity` mockup).

## Milestone 5: Overview and Monthly review
- [ ] Vital signs with reference lines; Money Map; next 12 months with estimates marked ≈; assistant notes.
- [ ] Monthly review: calculated figures, assistant draft, decisions applied on approval, markdown export, completeness. A trend for the jobs the family chooses to follow (Stephen named Food and household and Eating out): this month, the two months before, and the average of the three before. Each month says how much of its spending has a job, so a month with gaps never looks complete.

## Milestone 6: Setup, Recurring costs, Ask or find, Settings, Backup
- [ ] Setup (7 steps), including the household's currency, the first import of the year so far, the plan start month with each account's balance split into buckets, runtime detection, the backup folder and the recovery code.
- [ ] Recurring costs: detection, subscriptions shelf, cancel-and-watch, price-rise and new-charge flags, contract reminders.
- [ ] The model suggests jobs for the transactions no rule and no earlier choice covers, as proposals with their evidence, from Milestone 3's Needs you list (moved here from Milestone 3 because it needs the model adapter). A dismissal for a suggestion (key X) needs somewhere to be remembered, so decide that with it.
- [ ] Ask or find: Find (no AI) and Ask (filter → core → words), with show working.
- [ ] Settings list, Follow my desktop (Caelestia), and backups: automatic and versioned, written to a temporary file and renamed into place, restored with the recovery code.

## To decide
- [ ] **An updater for the installed copy** (Stephen, 9 Nov 2026: "like it does in Fenmyr"). It conflicts with "No auto-updater" and "nothing leaves the machine" (`technical-decisions.md` §3, decision 0042), so it needs a decision before any code. Options:
  - Keep `./install.sh --update` (git pull and rebuild, exists today), and add a menu or Settings line that shows how to run it. No network call from Holt.
  - A button in Settings → Data that runs the update on request, with no background check. The one network call is `git` talking to GitHub, started by you, and outside Holt's own process.
  - A background check for a new version. This is a network call from Holt and needs a written exception to the rule and a switch in Settings.

## v1.x (after three real monthly cycles)
- [ ] Prove the OFX reader on a real bank file when one is available, then take `ofx` out of `unprovenFormats` (`packages/importers/src/proven.ts`) so the import screen stops warning (decision 0047, item 8).
- [ ] Insurance.
- [ ] Occasions and gifts (decision 9 in the scope document).
- [ ] What-ifs in Ask or find.
- [ ] Household cash-flow forecast.
- [ ] PDF statements read by the local model.
- [ ] Build project scenarios.
- [ ] Norwegian (Bokmål) interface.
