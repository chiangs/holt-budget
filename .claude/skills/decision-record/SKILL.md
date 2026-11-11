---
name: decision-record
description: Write or update a decision record in docs/decisions/ when a spike lands, a decision is made or changes, or the code must differ from a document. Use before committing any such change.
---

# Decision record

Holt records its decisions as short files in `docs/decisions/`, indexed in `docs/decisions/README.md`. The record and the change it records go into the repository in the same change.

## When to use

- A spike in `BACKLOG.md` is done and its *Done when* asks for a record.
- A decision in `docs/` is made or changes.
- The code needs to differ from a document (CLAUDE.md: "change the document in the same change and say why").
- A finding constrains later work, for example "SpareBank 1 doesn't export loans, so their balances are entered by hand".

Do not use for plain implementation detail that the tests already show, or for wording fixes.

## How to write one

1. Read the index in `docs/decisions/README.md` and the two or three newest records for number and style. The new record must sit alongside them.
2. Take the next sequential number, zero-padded to four digits. Name the file `NNNN-slug.md`; the slug is a short kebab-case phrase that names the decision.
3. Start from `references/template.md`. Keep the fixed lines (`#`, `Status:`, `Date:`, `## Question`) and choose the rest of the sections for the content: `Setup`, `Findings`, `Decision`, `Shape`, `Conventions`, `What was built`, `Limits found`, `Consequences for ...`, `Open for ...`.
4. Put the conclusion before the reasoning where it helps. Write numbers as facts. Use a table for measured results.
5. Append one row to the index table, newest last: `| NNNN | date | the decision in one sentence | status | link |`. The link points to the record file.
6. Commit the record in the same change as the code or document it records.

## Statuses

- `accepted.` — the family agreed.
- `proposed.` — the code does it, but Stephen has not confirmed the interpretations. Name what waits and on whom.
- A decision that changes is **superseded, never edited**: add a new record and note the old row in the index, as `Superseded by 0042` or `Accepted; the key part is superseded by 0030`. Never rewrite a past record to make the current state true.

## Rules that never bend

- Nothing from `private/` enters a record. Paraphrase. Real exports stay in `private/fixtures/`; examples use invented names, numbers and amounts. If `private/check-public.sh` exists, it passes before the change is done.
- The status must be honest. A record the family has not seen is `proposed.`
- The record is a document the family reads, not agent notes.

## Writing conventions

British English, sentence case, no exclamation marks. Active voice, naming who acts: Stephen, the app, the bank, the family. Use the glossary's words (Job, Bucket, Assignment). No "smart", "magic" or "AI-powered".
