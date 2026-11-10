# 0047 Transactions: import, matching, treatments and rules (Milestone 3)

Status: accepted on 10 Nov 2026.
Date: 2026-11-10

## Question
How does a bank file become decided, undoable transactions? This record fixes the domain half, which is pure `packages/core` and `packages/importers`. The storage and screen half is in the second part, written after the design sketches.

## Shape
Three new fact tables join the nine from 0046, each with a branded ID (`facts.ts`, `ids.ts`).
- **`importBatches`.** One per file: name, fingerprint (SHA-256 of the bytes), format, when, the first and last booking dates, and the counts. `undone` marks an undone import. A batch is never deleted.
- **`importRows`.** One per row of the file, kept as the file had it. A row has a fingerprint, a `pending` flag, and `backs`, the one transaction it backs or null.
- **`rules`.** "Always do this". A match (counterparty, optional account, optional signed amount range), a result (one job, or a split by integer weights), an origin and a priority.

`Transaction` gains five optional fields: `counterparty`, `transactionDate`, `reference`, `note` and `ruleId`.

Proposals are not a fact table. A proposal is a command waiting for approval, and accepting one changes only its own status (0046). The store decides how they persist.

## Conventions
- **A rule is the family's standing approval.** A rule that matches a new transaction gives it its treatment at once, and the transaction records the rule (`ruleId`) so the screen can say which rule applied. "Same as last time" is a suggestion. In the import preview it applies when you press Add, because you have seen each one with its reason and can change any of them. Everywhere else it waits for Space.
- **Only the highest priority rule applies.** Ties go to the rule with the smaller ID, so the same facts always give the same result. Rules run before anything else (domain model, "Categorisation rule").
- **A transaction before the plan start is history.** A matching rule gives it that job as history, so the estimates can use it. It never waits in needs you (decision 10).

## Matching, exactly
An incoming row has a **key**: account, amount, booking date and the description with its whitespace collapsed and lower-cased. The bank's reference is not part of the key, because a KID repeats on every payment of a recurring bill, and neither bank gives a transaction number. A reference never matches on its own.

For each key, with `n` incoming rows in file order and `m` existing transactions on the account with that key (backed by a live import or recorded by hand):
- The first `min(n, m)` rows back the existing transactions in ID order. They create nothing.
- The remaining `n − m` rows create new transactions.
- A transaction is backed by at most one row from one batch, so an overlapping file needs two matching rows to back two transactions.
- Two identical rows in one file are two transactions.

A **near match** is a new row with no exact match, where an existing transaction on the same account has the same amount and description and a booking date one day apart that no row of this file backs. The row creates its transaction and waits in needs you. A figure lists the near matches for every needs-you transaction, and accepting one is a `mergeTransactions` command. Once the family gives the transaction any other treatment, the suggestion disappears.

**Pending rows** are kept and back nothing. A later file that books the same row creates its transaction.

**The same file twice** is refused when a live batch has its fingerprint. A batch that was undone doesn't count, so the family can import that file again.

**A file in another currency** is refused before any row is read. A file that doesn't state a currency is assumed to use the household's (decision 15).

## The balance check
Neither bank gives a closing balance (0043), so the import asks for the balance the family sees at the bank, per account, with its date. That is an entered value (rule 10). The check compares it with the balance core works out at that date from the opening balance and the transactions. A mismatch is flagged and the figure lists likely causes (a period missing from the import, a duplicate, a pending row, a move at the bank not yet made). Nothing adjusts a balance (rule 5).

## Undoing an import
`undoImport(batch)` has a preview and then runs as one command.
- It sets `undone` on the batch and sets `backs` to null on its rows.
- A transaction that no live row backs and that was created by this import is removed with its treatment. A transaction that another batch also backs stays.
- A transaction the family recorded by hand stays, backed by no file, even if an import matched it. Removing it would lose an entry the family typed, and would break "undo right after the import restores the facts".
- A removed transaction that gained a note or a treatment the import didn't give it is listed first in the preview, so the family sees what the undo takes with it.
- A transaction an import creates takes the ID of the row that creates it, so the facts always say which import brought it.
- A move at the bank that one of those transactions completed goes back to "to do".
- A transfer's partner that stays loses its link and waits for its other side.

## Transfers
Two transactions in different household accounts with the same amount and opposite signs, booked within 3 days, are a **transfer pair**. Import pairs them when exactly one candidate exists on each side. When there are several candidates, they stay in needs you as suggestions. A pair that matches a move at the bank (same accounts, same amount) marks the move done. A transfer whose other side isn't imported yet shows as "transfer, other side not yet imported". Import never creates a transfer that is not a pair.

## Rules and suggestions
- **Rules** are facts, created and changed by commands, and undoable.
- **Suggestions** are figures. For each needs-you transaction, the first of these that applies:
  1. a rule matched, so it wouldn't be waiting; this only arises when the rule was created later, and then it is offered as "apply the rule";
  2. **same as last time**: the most recent earlier transaction with the same counterparty and a job or split, offered with that treatment;
  3. none. The model is Milestone 6.
- **Accepting suggestions** goes through the `batch` command, so "accept all 21" is one change with one undo.

## Found while designing (the code does what this says, and a test pins it)
8. **Counterparty cleaning is a pure function in the importers** (`cleanCounterparty`), tested on synthetic names only. It strips payment-method words, dates, card fragments and trailing digits, and keeps what is left in the bank's own words.
9. **A rule's amount range is on the signed amount.** A refund from the same shop has the opposite sign, so a rule for the purchase doesn't swallow the refund.
10. **A rule can't produce income or a transfer.** Contributions and the children's money come with recurring series in Milestone 6. Until then the family confirms them once a month.
11. **A `batch` command is atomic.** One refusal refuses the whole batch and changes nothing. The commands run in order on one working copy, each seeing what the one before did, and the batch is checked once, against the facts it started from: it is refused if it leaves a rule broken that the start did not, and accepted if it ends sound even when a step in the middle was not.

## Open
- **Rules apply on import.** The alternative is a suggestion for every rule match, accepted in bulk. The documents say rules "give the same result every time", which I read as applying. It is a product call.
- **Near-match window** is one day, from the domain model. A bank that books a card payment two days late would show as two transactions.

# Part 2: storage, the bridge and the screen

Two independent design sketches (opus xhigh and the session model) reached the same architecture, and this part records the synthesis.

## Who holds the facts
- **SQLite is the durable copy** and the only home of the change log.
- **`FactsStore` in the main process is the one writer.** `run(command)` is core `commit`, then one SQLite transaction holding the patch's rows and the change record, then a swap of the in-memory facts. `step("undo" | "redo")` reads the top stored record, runs core's `undo` or `redo` on a one-record log, and persists the inverse patch. The author is set by the store, never by the caller. A crash leaves the old state or the new state, never a mix.
- **The renderer holds a read-only replica** of the same `Facts`, loaded once from a snapshot and advanced only by the patch each change returns, guarded by a revision number. A revision gap or a `PatchConflict` takes a new snapshot. The renderer runs core's `computeFigures`, `apply` (previews) and the Ask filter (search) locally, so no screen needs a read channel. A figure pass took 1.7 ms on 3,500 transactions when 0046 was written. With the needs-you and import-status figures it took 20 to 22 ms with about 50 transactions waiting and 40 to 45 ms with all 8,556 waiting (measured on 18,500 rows under load). Both figures are now indexed and worked out when first read, and a pass takes about 3 ms and 4 ms at those counts, reading both ("Found while speeding up the figures" below). The page's own bench (`replica.bench.test.ts`) must read `needsYou` and `importStatus` inside its timed passes, or it times a pass the page never makes.
- **The change log has no in-memory copy.** Undo reads the top `done` row and redo the top `undone` row.
- **Suggestions are figures, not stored proposals.** Pressing Space on a rule or "same as last time" suggestion is the family's approval, and the change record says the family made it. Persisted proposals are for the model (Milestone 6). Core's `isStale` compares a proposal with the log's last change, so accepting 21 stored proposals one by one would fail after the first.

## Storage
- **Real columns for scalars and one JSON column for each tagged union.** The unions are a transaction's `treatment` (a split's allocations live inside it, so a split and its transaction can't be written apart), a job's `plan` and `target`, a rule's `result`, and a change record's `by`, `command` and `patch`. No child tables.
- **Every foreign key is `deferrable initially deferred`**, so a patch applies in any order, and the database checks it at commit as a second wall behind `checkFacts`.
- **The database also enforces two import rules.** A partial unique index on the fingerprint of live batches means the same file twice adds nothing. A unique index on an import row's batch and `backs` means one file backs a transaction at most once.
- **Migration `0002_facts.sql`** replaces the empty `household` table from 0001, because no code path has ever written to it. A migration that reshapes a table must rewrite or delete the change records that touch it, and say which in its header.
- **A private `columns` registry**, typed over `TableName`, maps fields to columns, so a new Facts table fails to compile until it has its columns. A test compares it with `PRAGMA table_xinfo`.
- **Zod schemas for every row and every command live in core** (`packages/core/src/schema/`), typed with `satisfies` over the table names and command kinds. Main uses them at the edges (IPC arguments, database rows, stored change records). Core's own logic trusts its types.

## The bridge
Six channels. Results use `z.custom<T>()`, because the dispatcher doesn't parse results and the data comes from typed main code.

| Channel | Arguments | Result |
|---|---|---|
| `holt:facts-snapshot` | none | `SnapshotResult`: empty (no household yet) or the snapshot (revision, today, all tables as arrays, the undo and redo heads) |
| `holt:run` | `FamilyCommand` | `RunResult`: applied (with the patch and the new heads), refused (with the refusal), or conflict |
| `holt:history-step` | `"undo"` or `"redo"` | `RunResult` |
| `holt:import-open` | none | `ImportOpened`: cancelled, unreadable, unrecognised, unparseable (with the line), or opened (a session and a preview) |
| `holt:import-plan` | session, balances | the preview again, with the balance check |
| `holt:import-commit` | session, balances | `RunResult`, or blocked, or expired |

`FamilyCommand` is every command kind except `importFile`, so a compromised page can't inject rows. From the page, a `batch` holds at most 500 commands in all, counting those in nested batches and each pair in a `pairTransfers`, and nests at most two levels. A `pairTransfers` on its own holds at most 500 pairs. The app's own stored changes may hold up to 100,000, which leaves room for a first import.

## The import session
Main shows the native file dialog, reads the file (refusing over 32 MB), hashes it with SHA-256, decodes it (UTF-8, else Windows-1252, and says which), recognises the format, parses and plans. The renderer never sees a path, the bytes or the parsed rows. Cancelling stores nothing. Confirming re-runs `planImport` on the current facts and commits the plan's own command, so a change made after the preview is seen. A second confirm finds no session and returns `expired`.

## `planImport`
Pure, in core (`import/plan.ts`). It takes the facts, a `StatementFile`, and an input of file name, fingerprint, time, the family's typed balances, `asOf` and an `ids` supplier for the batch, the rows and the entered values. It returns a preview and one `batch` command (the import, one `pairTransfers` holding every pairing and the moves they complete, and the typed balances), or a block (duplicate file, wrong currency, no rows).
- Rows whose account number matches no household account are left out and reported, so the family can add the account and import again.
- A row before the plan start becomes history. A row from it on gets, in order, the treatment the family chose, the best matching rule's treatment, then (unless suggestions are off) the treatment of the last transaction from the same payee, and otherwise waits in needs you. A near match waits unless the family chose its job.

## The development seed
Setup is Milestone 6, so nothing creates a household yet.
- `seedDevData(folder)` exists only when the build defines `__HOLT_DEV_SEED__` (every mode except `production`), and it refuses any folder not named `holt-dev`. It creates the keys with a fixed passphrase (the keyring when there is one), builds a household with accounts, jobs and a plan start from core's deterministic test builders, and imports the committed synthetic bank files through the real `planImport` path.
- `pnpm dev` and the Playwright smoke tests pass `--holt-seed`. A test searches the production bundle for the seed's sentinel and fails if it finds one.

## Found while building the store
12. **A reopened WAL database starts at `synchronous=NORMAL`.** The store sets `FULL` and `foreign_keys=ON` itself on every open, and a test pins it.
13. **A change must be readable back before it is written.** Core `commit` accepts any batch, but the stored-change schema caps one at 100,000 commands, counted as the page's 500 is. The page's cap lives on `FamilyCommandSchema` alone, because it bounds what a page can ask of the app in one `holt:run`. `run` parses the whole record first and throws `UnstorableChangeError` rather than commit a change whose record could not be read, which would block every older undo.
14. **A patch is written as deletes, then updates, then inserts**, so unique values hand over in any order. Each update and delete matches the old values, not just the key, so a drifted row throws `StoreDivergence` and rolls back.
15. **The four foreign-key child indexes are needed.** A 4,000-row import and its undo take about 210 ms and 250 ms with them and 1.8 s each without.
16. **The change record's author is stored in a column named `author`**, because `by` is an SQL keyword.
17. **Migration 0002 fails if a v1 household row exists** instead of dropping it. No code path has ever written one.

Measured on about 18,500 rows on a real NVMe disk: opening the store takes about 100 ms (about 70 ms of it is Zod parsing), a one-row commit takes 3.7 to 4.2 ms with `synchronous=FULL` (7 ms at the 95th percentile), and the snapshot is 7 MB as JSON.

## Found while measuring the first import
The family's first import brings about 9,000 rows (a synthetic file in `packages/core/src/testing/first-import.ts`, in Bulder's shape: 9 accounts, 1,700 transfer pairs, 135 groups of identical rows). `pnpm bench:import` measures it on a real disk and checks that every step did the work.
18. **A transfer pair is not a command.** The import used to add one `pairTransfers` per pair to its batch: 1,710 commands, past the 500 the stored record allowed, so the first import could not be saved. It took 2.5 s to plan and 2.1 s to apply, because every command copied the whole `transactions` table and ran `checkFacts` again. `pairTransfers` now carries a list of pairs, applied in order with each pair seeing the pairs before it, so it gives what the same pairs one by one give (a property test compares the three ways). The batch of an import is 11 commands whatever the file holds.
19. **A batch runs on one working copy.** A table is copied the first time a command touches it, and every later command changes the copy in place. The batch is checked once, at the end (decision 11 above). Sorting 500 transactions among 18,000 rows in one batch fell from about 700 ms to under 10 ms.
20. **The change record is larger than the facts it changes.** A 9,000-row import adds 6.3 MB of rows (18,010 of them), and its record is 14.3 MB: 6.3 MB of command and 8.0 MB of patch, because both hold every row. A record that held the patch alone would be about 8 MB. Undo and redo never use the command, yet they read it and spend about 65 ms checking it.
21. **Undo of an import is bound by the record, not the rows.** Of its 820 ms: about 200 ms reading and checking the 14 MB record, 40 ms in core, 240 ms deleting 18,010 rows, and 330 ms flipping the record's `status`, because SQLite rewrites the whole 14 MB row to change one column. A side table for the large columns should remove that last part (not tried). Nothing needs it yet.

Measured at 9,000 rows, 1,700 pairs and 18,010 rows added, median of 7 runs on a real NVMe disk with 32 cores: plan 430 ms (of which about 75% is the balance check recomputing the household's figures for each of the 9 accounts), core apply 16 ms, `run` (core, check the record reads back, write) 580 ms, reopen 115 ms, undo 820 ms, redo 830 ms. Before the change the plan took 2.5 s, the apply 2.1 s, and the save failed.

## Found while speeding up the figures
A pass reads the facts again after every change, so typing and pressing Space in needs you need a pass in single-digit milliseconds at the family's volume. The measurements use `familyVolume` (`packages/core/src/testing/family-volume.ts`), the same facts as the page's bench: 8,556 transactions, 8,500 import rows, 40 jobs, 6 accounts and 33 months of assignments.
27. **The cost came from indexes built over every row to answer a few.** In node, with the code as it was, a pass took a median of 14.5 ms with 51 transactions waiting (range 10.9 to 21.8, 30 runs) and 36.5 ms with all 8,556 waiting (30.7 to 46.6), and the page's bench (vitest) 23.5 and 42.5 ms. A CPU profile (`node --cpu-prof`) of all waiting put 73% of a pass in the near-match code: 33% in `addDays`, which built a `Date` and an ISO string twice for each waiting transaction, and 16% in `normaliseDescription`, which ran twice for every transaction, once to build the index and once to look up. With 51 waiting it put 41% in building that index over all 8,556 transactions (21% of the pass normalising every description), 19% in building and sorting same-as-last-time precedents for all 300 counterparties to answer 51 lookups, and 5% in listing the live backing of all 8,500 import rows. The work grew with the rows and the answers grew with the waiting transactions.
28. **Each function now looks only at rows that can matter.** Near matches group the transactions by amount (only amounts a waiting transaction has), put each group in date order and read the rows a day either side, so no description is normalised until a row has the same account, amount and a date one day apart. The batches that back a transaction are listed only when such a row exists. Transfer candidates group the unpaired sides by amount in date order and read the window of 3 days with a binary search. Same-as-last-time lists precedents only for the counterparties that a waiting transaction names, and finds the latest earlier one by binary search. The rules are keyed by counterparty once, and the list is put newest first by grouping on the date. Days are numbers worked out once per date (`dayNumbers`), not `Date` objects. Every function returns exactly what the plain definition returns, and a property test checks that against a brute-force version of each on generated households (identical rows, dates a day apart across month ends, a leap day and a year end, ties, other accounts, files that list both rows, counterparties that differ by case).
29. **`needsYou` and `importStatus` are worked out when first read.** `computeFigures` returns them as memoised getters on the figures object, with the same names and types. A caller that spreads or clones what it read gets plain data. A pass that reads neither (the balance check, closing a month) no longer pays for them: the plan of a first import fell from 430 ms to about 110 ms (median of 5 runs, load average 7.6), because its balance check works out the household's figures for each of 9 accounts and read neither.
30. **After.** Median of 100 runs on one core of a 32-thread desktop (AMD Ryzen 9 5950X), load average 5 to 8 from other work, three repeats. With 51 waiting: 2.8 to 3.0 ms reading both figures and 1.9 to 2.0 ms reading neither. With all 8,556 waiting: 3.6 to 4.5 ms reading both and 0.9 to 1.0 ms reading neither. The same without pinning to a core: 3.0 to 3.6 ms and 4.2 to 4.9 ms. The first pass in a new process takes 14 to 23 ms and passes 2 to 9 take 3.8 to 5.1 ms (51 waiting) and 6.0 to 8.9 ms (all waiting), while V8 optimises the code. Under vitest, which the page's bench uses, the first pass takes 21 to 26 ms and passes 2 to 9 take 6.5 to 9.3 ms (51 waiting) and 6.1 to 7.1 ms (all waiting), reading both figures. A pass over the synthetic year takes 1.1 ms with the stand-in estimate and 1.8 ms with the real ones, from 2.1 and 3.4 ms.
31. **What is left is mostly the plan.** With 51 waiting, the 3.2 ms pass splits into 1.0 ms indexing the transactions, 1.2 ms for 40 jobs over 45 months with their estimates, 0.1 ms for the accounts, 0.6 ms for needs you and 0.25 ms for the import status. With all waiting, the 4.1 ms pass is 2.7 to 2.9 ms for needs you (transfer candidates 0.75, near matches 0.4, the rest listing and sorting 8,556 items) and 0.8 ms for the plan.

## Found while building the import session and the seed
22. **The build has three modes.** `production` (what ships) has no seed and no file-picker override. `development` has the seed behind `--holt-seed` (`__HOLT_DEV_SEED__`). `e2e` (what `pnpm test:e2e` builds into `out/`) adds `HOLT_E2E_PICK_FILE`, which replaces the native file dialog (`__HOLT_E2E__`). So run `pnpm build` before `pnpm test:no-network` or `pnpm dist`, as CI does. A test builds all three modes and searches the bundles for the seed's sentinel and the override.
23. **The seed makes its bank files, it doesn't read the committed ones.** It calls `syntheticStatements` for the months the plan covers, ending yesterday, and imports them through the real import path, so the data is what a real import produces. The committed fixtures are the same generator with fixed dates. One overlapping file is left to import, and the committed files are copied to `<folder>/sample-imports/`.
24. **The seed runs only in a folder named `holt-dev`, never when packaged.** `HOLT_RESEED=1` clears the folder first, under the same checks. The Playwright launches pass `--password-store=basic` and use a throwaway `XDG_DATA_HOME`; the dev passphrase is a constant that is not a secret.
25. **A cancelled file dialog keeps the page's pending preview.** Any other file replaces it. A session is cleared only after an applied add, not after a blocked or refused one. A second Add finds no session and returns `expired`.
26. **`pnpm test:no-network` has a seeded mode** (`HOLT_NO_NETWORK_SEEDED=1`, on an e2e build) so the check also covers the app with the store open and figures worked out. CI runs both.

## Reminders
Import reminders in Milestone 3 are the in-app "Due" badge on Transactions and each account's status. Desktop notifications come with Settings in Milestone 6.

## Decisions (Stephen, 10 Nov 2026)
Stephen confirmed every item. Item 1 comes with a clarification, and item 8 was decided last: keep OFX, marked as unproven.

1. **Rules apply on import** (above). The alternative is a suggestion for each rule match. Stephen: the line "rules give the same result every time" is about consistency, not about whether a rule applies by itself, so how a rule is applied is left to performance and consistency. Applying once on import, and storing the result with the rule that gave it, serves both.
2. **Rows for an unknown account are left out and reported.** The alternative is to refuse the whole file.
3. **Typing a balance is optional.** An account with no typed balance still shows "Up to date" by its dates, with a line saying "Not checked against your bank" (or "Checked against your bank on 6 Nov" after one is typed). The alternative is to withhold "Up to date" until a balance is typed.
4. **A balance mismatch flags the account and doesn't block the import** (rule 5).
5. **"Same as last time" applies when you press Add on an import, and waits for Space everywhere else.** The mockup decides it: the preview shows the job the app suggests for each new row and why, you can change any of them, and Add applies what you saw. A row stays in needs you when the payee's last two transactions went to different jobs, and the preview flags a changed amount only after two equal ones, so a bill that varies is not flagged every month. Those two thresholds are the app's proposal, for Stephen to confirm.
6. **Income from before the plan start keeps its funds month** when that month is on or after the plan start (the fix proposed in 0046). Otherwise October's contributions could never fund November.
7. **A fixed passphrase for the dev seed**, in non-production builds only.
8. **OFX is kept and marked as unproven.** It is built from the format's published structure, with synthetic fixtures, and neither of the family's banks offers it, so it has never read a real file. Stephen: keep it, but mark it as unproven. The mark is in three places: `proven: false` on the format and its comment in `packages/importers`, the `unprovenFormats` list in `packages/importers/src/proven.ts` (a test keeps the two equal), and a notice in the import screen's file check that says the app has only read files like this from invented examples and asks you to check the rows and your bank's balance carefully. Remove the format from the list once a real file has read cleanly.
9. **The model's suggestions wait for Milestone 6.** The backlog's Milestone 3 item "the model only for the rest, as proposals" needs the model adapter, which is Milestone 6. Rules and "same as last time" are built.
10. **Undo on the Needs you screen undoes only changes made there**, and only while the change is still the log's last, so a key press can't undo an import. There is no Dismiss for a suggestion, because suggestions are figures with nowhere to remember a dismissal.
11. **A new rule's defaults.** It is limited to the transaction's direction, so a rule for a purchase doesn't take a refund. It covers every account unless you tick "Only in this account". Its origin is "learned" when you pick a job other than the suggestion, otherwise "set". Its priority is one above the best rule already matching the transaction. It also sorts the other waiting transactions it matches, in the same change, unless you untick that.
12. **Income defaults.** The funds month is the month after booking and the source is a contribution.
13. **Accept all is capped at 500 suggestions**, the most one change from the page can hold. Above that the button says "Accept the first 500".
14. **Undoing an import keeps a transaction you recorded by hand**, and a transaction an import paired with one that was waiting stays a transfer waiting for its other side. It does not return to Needs you. The Undo button right after an import (a step back in the change log) restores everything exactly.
15. **A batch is checked once, at the end.** Each command used to be checked against the one before. A batch whose middle step is unsound but whose end is sound is now accepted. Per-command checking costs about 700 ms per 500-command batch.
16. **`Figures.needsYou` and `Figures.importStatus` are lazy getters**, so a screen that doesn't read them pays nothing. Spreading or cloning a `Figures` gives plain data.
17. **Dates are written day first.** The app sets Chromium's language to en-GB, so a date field reads 09/11/2026 as 9 November. Norwegian arrives with the message files.

## Work breakdown
| Workstream | Files | Needs |
|---|---|---|
| Core import | `packages/core/src/import/`, `commands/imports.ts` and its messages | the contract above |
| Core rules, batch, plan start, needs-you figures | `rules/`, `commands/rules.ts` and its messages, `figures/needs-you.ts`, `figures/import-status.ts`, `check-facts.ts` for decision 6 | near matches and transfer candidates from the import work |
| Importers | `packages/importers/` | `StatementRow` from core |
| Schemas | `packages/core/src/schema/`, `tables.ts` | the command and row types |
| Storage and store | `apps/desktop/src/main/facts/`, `0002_facts.sql` | the schemas |
| Bridge, import session, seed | `ipc.ts`, `shared/`, `main/imports/`, `main/dev/` | the store, `planImport` |
| Renderer data layer, then screens | `renderer/src/data/` (`bridge.ts`, `replica.ts`, `client.ts`, `ledger.tsx`), `routes/transactions/`, messages | the bridge types |
