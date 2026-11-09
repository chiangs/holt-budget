# 0044 Ask's query language (spike S5)

Status: accepted.
Date: 2026-11-09

## Question
What does the assistant write when the family asks a question, so that core can work out every figure in the answer? The language has to express the family's real questions, which are drafted in `private/questions.md` and stay private because they name real payees.

## The questions
Stephen asked for 24 questions in four groups:
- 16 about transactions, such as "What did we pay Tibber each month this year?" and "How much did we spend on food at weekends in October?";
- 4 about overspending, such as "Which jobs are over this month?" and "Did we spend more on groceries this month than we usually do?";
- 2 that need a figure Holt keeps outside transactions: the loan's balance, and what's left in a job;
- 2 that belong to Recurring costs: subscriptions and price rises.

Overspending questions mostly ask about the plan, not about transactions. "Which jobs are over" compares what was assigned with what was spent, which is a figure core works out, and no transaction filter can find it. That is why the language has two kinds of query.

## Decision
The assistant replies with `AskReply` (`packages/core/src/ask/query.ts`), a Zod schema that also becomes the JSON Schema for the runtime's constrained decoding. A reply has one to three steps:
- **Transaction query.**
  - Filters: a period, accounts, jobs, counterparties (by name or account number), text in the bank's description, direction (in or out), and an amount range in whole kroner. Also weekdays, purchases abroad, and transfers between the household's own accounts (leave out, include, or only those).
  - Measures: sum, count, average, monthly average, or a list.
  - Grouping: by month, counterparty, job, account or currency, optionally keeping only the largest few groups.
- **Figure query.** It asks core for a figure: a job's assigned, spent or left amount for a month; the jobs that are over; the month's money available, unassigned or over-assigned money; a bucket's balance or estimate; or an account's balance (a loan's is entered by hand, see 0043).
- **Elsewhere.** The question belongs to a screen, such as Recurring costs for subscriptions.
- **Cannot.** Holt can't answer it, because it asks for advice (Holt suggests, never advises), it's outside the household's data, or it's unclear.

Two steps side by side cover comparisons ("October compared with September", "more than usual") without a comparison operator in the language. This matches the mockup's "Compare with September" chip.

Periods can be relative ("this month", "the last three months", "this year"). Core resolves them against today's date, so the model never does date arithmetic. Amount thresholds are in whole major units because that's how people say them. Core converts them to minor units.

## What was built
- `evaluateTransactionQuery` (`packages/core/src/ask/evaluate.ts`) is pure. It works on `QueryableTransaction`, a small shape that Milestone 2's transaction will satisfy. It keeps the counterparty's name and account number apart, because Bulder gives a bill's payee as an account number and puts the payee's name in the description.
- Figure queries have a schema but no evaluator yet. Core needs the plan first (Milestone 2).
- 15 tests in core cover the schema, the periods, every filter and measure, and two fast-check properties: group totals add up to the overall total, and money in plus money out is every row that isn't zero.
- `packages/importers/src/questions.test.ts` reads `private/questions.json`, the 24 questions written by hand as replies. It checks every reply against the schema and runs every transaction step on the family's real exports. The 11 questions answerable today all find their transactions. A spot check against known amounts matches: one loan payment a month, and money in against money out for the year.

## Limits found
- **Without jobs, a query can't tell shops from people.** "Which shops did we spend most at in October?" puts a transfer to a private person first. Once transactions have jobs (Milestone 3), the question filters by the spending jobs.
- **Questions that need jobs** (9 to 13, 22 and 23) parse and run but match nothing until transactions have jobs. S3 labels all of October so it can score them.
- **"What did we spend" includes the mortgage payment** that leaves the SR-Bank account. That is correct: the mortgage is a fixed cost.

## Consequences for S3
The bake-off scores a reply by running it, not by comparing JSON. Two replies are equal when they produce the same figures and the same transactions. For questions 17 to 21, it scores whether the model picks the right kind of step: a figure, elsewhere, or cannot.
