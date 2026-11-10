# 0046 Core: facts, figures and the patch (Milestone 2)

Status: proposed. The code does all of this. Stephen confirms the interpretations (1 to 7, and the decisions under "The command layer").
Date: 2026-11-09

## Question
Milestone 2 builds the money model in `packages/core`. The domain model says what the objects are and which rules hold. It leaves exact formulas open: how unassigned money carries from month to month, what a bucket is for a job that doesn't keep its money, what "the monthly move at the bank" is as a number. This record fixes them, so that the figures function, the commands and the tests all agree.

## Shape
- **Facts** (`facts.ts`) are nine tables of plain immutable rows, one registry (`TableTypes`) for the row and key types. Everything else is a figure.
- **`computeFigures(facts, asOf)`** (`figures/`) is one pure function from facts and a date to every figure. It never reads a clock.
- **A patch** (`patch.ts`) is a list of `{ table, key, before, after }`. Applying a patch checks each `before` against the current row. Inverting one swaps `before` and `after`. Undo and redo are patches, so they work the same for every command.
- **`apply(facts, command)`** (phase 2) returns the new facts and the patch, or a refusal. Previews, proposals and saved changes all call it.
- **IDs come in.** Core never makes an ID, because that needs a clock and randomness. A command carries the IDs of the rows it creates.

## Conventions
- **Sign.** Money in is positive and money out is negative, on transactions and allocations. A job's **spent** is minus the sum of its allocations, so a refund reduces it.
- **A transaction's month** is the month of its booking date.
- **Plan months** run from `household.planStart`. A month's **state** is `open`, `closed` or `reopened` when it has a `budgetMonths` row, and `planned` when it has none. A month before the plan start has no state (history).
- **`asOf`** is today, given by the caller. `current` is the month of `asOf`. A month has **ended** when it is before `current`.
- **Horizon.** Figures cover the plan start to `current + 12` months. A month after `current` has no spending, only projections.

## Figures, exactly
For job `j` and plan month `m`:

**Assigned.** In an open, closed or reopened month: the assignment row's amount, or 0. In a planned month, the projection:

| Job | Projection |
|---|---|
| Spend, set amount | the plan's amount |
| Spend, follow the bills | the estimate for `m` |
| Spend, even it out | the plan's `monthly` from `startMonth` on, the estimate before it |
| Save up, amount by month | `ceil((amount − bucket at the end of m−1) ÷ months from m to readyBy, both included)`, at least 0, and 0 after `readyBy` |
| Save up, monthly, and the buffer | the `monthly` amount |
| Pay into | `monthly` |
| Paused, finished or archived | 0 |

**Bucket.** Only a job that keeps its money has one. Keepers are save-up jobs (including the buffer), pay-into jobs, evened-out spend jobs, and spend jobs with `keepsMoney`. `bucketEnd(j, m) = bucketEnd(j, m−1) + assigned(j, m) − spent(j, m)`, starting from `job.opening` before the plan start. A bucket below zero is **short**.

**Leftover, for a spend job that doesn't keep its money.** `leftover(j, m) = assigned − spent`. If the month has ended and the leftover is positive, it is **returned** to unassigned. A negative leftover is **over**. It is shown and stays until the family changes the month's assignments. It never reduces the next month's money (decision 13).

**Money available.** `available(m) = carriedIn(m) + income(m)`, where `income(m)` is the sum of income transactions whose funds month is `m`, whenever they arrived. `carriedIn(plan start) = 0` and `carriedIn(m) = max(0, unassigned(m−1)) + returned(m−1)`.

**Unassigned.** `unassigned(m) = available(m) − Σ assigned(j, m)`. When it is negative, `overAssigned(m)` is its absolute value, and it does not carry forward (rule 4).

**Next month's money.** The sum of income transactions with funds month `current + 1` and a booking date up to `asOf`. It is never part of any bucket, the buffer or the runway (rule 11).

**The buffer.** Target = buffer months × the monthly total of essential spend jobs, where buffer months is the latest `reference` entered value `buffer-months` (3 when there is none) and the monthly total is the sum of `assigned` over active essential spend jobs. Runway in tenths of a month = `floor(max(0, buffer bucket) × 10 ÷ monthly total)`, and none when the total is zero.

**Accounts, as of `asOf`.**
- *Shared account balance* = opening balance + every transaction on the account with a booking date after the opening date and up to `asOf`.
- *Paid-into account balance* = the latest `accountBalance` entered value + deposits since its date, where a deposit is minus an allocation to a pay-into job that pays into the account.
- *Buckets in an account* = the sum of `bucketEnd(j, current)` for keepers whose money sits there.
- *Unbucketed remainder* = balance − buckets. When it is negative (rule 6), the figure lists the to-do one-off moves into the account and the account's monthly move for `current`.

**Monthly move at the bank, for account `a` and month `m`.** `Σ assigned(j, m)` over jobs whose money sits in `a`, minus the income transactions on `a` with funds month `m`. Positive means money must be moved in, and negative means there is a surplus to move out. One-off moves are stored rows and are not part of this number.

**Stale entered values (rule 10).** The latest row for each (kind, subject) is stale when `asOf` is after the date twelve months later than its `asOf` (a 29 February clamps to 28 February).

**Estimates.** `estimate(job, m)` picks a method per the domain model: an override wins and is marked "entered by you"; otherwise a seasonal job with twelve or more months of history uses the same month last year times the trend (the last three months against the same three a year earlier); a seasonal job with less uses the nearest comparable months and is marked rough; an irregular job uses the average of the last three to six months. A job with `seasonality: "auto"` is seasonal when its history has at least 12 months and the highest month is at least 1.3 times the lowest. Planned items and fixed amounts are optional inputs and win over the history when given. An estimate carries its method and a `rough` flag, is never stored, and is never an actual (rule 12). The Electricity figures in `design/README.md` are the fixtures.

## Interpretations (Stephen to confirm)
1. **The first month starts with nothing carried in.** Money in the account at the plan start sits in buckets and the unbucketed remainder, not in the first month's unassigned. Setup could instead enter an opening unassigned amount.
2. **Over-assigned money doesn't carry.** If November is over-assigned by 500, December starts at its own money, and rule 6 flags that buckets exceed the account. The alternative is to carry the shortfall as a negative.
3. **Over never carries.** An overspent job shows as over until the family changes that month's assignments. A job's next month is not reduced.
4. **Runway is in tenths of a month**, not a decimal, so no float enters a figure. The interface turns it into words.
5. **The monthly move is one net number per account.** It doesn't name which account the money comes from. Matching a surplus to a shortfall is the interface's job in Milestone 4.
6. **The 1.3 seasonality ratio** for "auto" is my starting value. It's a setting-sized number, not a rule from the documents.
7. **Transactions and their treatments are in core now**, not in Milestone 3, because spent, income funds and buckets can't be worked out without them. Milestone 3 adds importing, matching and rules on top.

## Found while building (the code does this, and each is pinned by a test)
8. **Same month last year, even with under a year of history.** A seasonal job uses the same month a year earlier whenever that month is in the history, and the estimate isn't marked rough. The Electricity mockup needs it: January 2027 equals January 2026 from ten months of history. The nearest-months rule applies only when that month is missing. This refines the table above.
9. **The nearest-months rule, generalised.** Take the history's peak month (the latest on a tie) and assume the seasonal curve is symmetric around it. The comparable month is the target's mirror across the peak, so with a January peak November mirrors March. A target within one month of the peak averages in the peak too, so December averages January and February. If the mirror has no data, the calendar months closest to it stand in.
10. **A transaction booked after `asOf` counts nowhere:** not in spending, income, balances, next month's money or the estimate history. Bucket sums and balances share one cut-off.
11. **The latest entered value** is the newest one dated on or before `asOf`. Two on the same day are told apart by the newer ID (UUIDv7).
12. **An assignment row stored in a planned month is ignored.** The projection is used.
13. **A remainder below zero names every to-do move into the account,** whatever its month.
14. **Two buffer jobs make `computeFigures` throw.** None gives "no buffer". `checkFacts` refuses a command that would create two.
15. **An empty planned-items list wins and gives 0,** rather than falling through to the history.
16. **A negative zero never appears in an amount.** `money()` turns it into zero, because `Math.ceil` of a small negative number gives `-0`, which a property test found and which differs from 0 under `Object.is`.

## The command layer (`commands/`, `proposal.ts`)
- **`apply(facts, command, { asOf })`** returns `{ ok: true, facts, patch }` or `{ ok: false, refusal }`. It is pure. The new facts come from the patch alone, so a preview and a saved change can't disagree. `commit(facts, log, command, meta, context)` applies and records in one step, and a change with an empty patch is still recorded.
- **18 command kinds**, from one handler table, so a kind can't exist without a handler: change the household; add and change accounts and groups; add, change and delete jobs; assign and move an assignment; open, close and reopen a month; add a move and set its status; enter a value; record a transaction and set its treatment. No kind adjusts a balance (rule 5), and none edits or removes an entered value (rule 10).
- **29 refusal codes**, each with a plain-English message from one table, so a code can't lack a message.
- **`checkFacts(facts)`** is the single list of structural invariants. `apply` refuses a command that introduces a violation the facts didn't already have. Besides references and amounts it covers one buffer, no budget month before the plan start, splits that add up (rule 3), and history before the plan start and never after (decision 10).
- **Proposals** are a small state machine (suggested, then accepted, rejected or expired, once). A proposal never changes facts. `commitProposal` refuses unless it is accepted and its `basedOn` change is still the log's last, and it records the proposal as the author (rule 8).
- **An assignment of 0 is no row.** Opening a month writes only non-zero amounts, and the figures read a missing row as 0.
- **Decisions for Stephen**
  - *The first plan month has no money from before it.* Decision 1 says October's contributions fund November. Rule 3 and decision 10 say anything before the plan start is history. So with a November plan start those contributions never fund November, and the first month starts with nothing. One fix is to keep income before the plan start as income when it funds a month on or after it.
  - *Bucket money from Setup can only leave by spending.* Assignments can't be negative, so a job with an opening amount can be archived but not deleted. Moving it between jobs would need a new command.
  - *A stale accepted proposal is stuck.* Accepted is final, so the app works out a new proposal. Letting accepted become expired is one line.

## Open (needs a decision before Milestone 4)
- **A forecast for buckets that keep their money.** Months ahead have no spending, so their bucket end only adds the assigned amount. The Electricity job panel and "heading below zero" need a figure that subtracts each month's estimate. Today a screen would have to feed `bucketPath` with each month's estimate. I propose a `forecast` figure.
- **Monthly moves before payday.** Only income that has arrived counts in an account's monthly move, so the account the contributions land in shows the whole month's assignments as a move in until payday arrives. The alternative is to count expected contributions, which needs the contribution agreements from Milestone 4.

## Verification
Each rule in the domain model has a test (`rules.test.ts`), with fast-check properties for the invariants: money stays whole (1), the splits sum (3), unassigned = available − assigned (4), buckets plus remainder equal the balance (6), transfers change nothing in the plan (7), undo then redo gives the same figures (9), next month's money stays out of the buffer (11), no stored estimates (12). `pnpm bench:core` measures `computeFigures` on a synthetic year: 3,547 transactions, 40 jobs, 6 accounts and 24 months took a median of 1.7 ms (range 1.6 to 3.4 ms over 60 runs), linear in the number of rows, about a third of it in the estimates. Milestone 3 added the needs-you and import-status figures (0047), which raised that year to 2.1 ms with the stand-in estimate and 3.4 ms with the real ones, and the family's 8,556 transactions to 14 ms with 51 waiting and 36 ms with all waiting. They are now indexed and worked out when first read (0047, "Found while speeding up the figures"). The same year takes a median of 1.1 ms and 1.8 ms again, and the family's volume 3 ms and 4 ms, counting the two figures (100 runs on one core).
