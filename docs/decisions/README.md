# Decision records

Short records of decisions, newest last. The full reasoning lives in the documents linked from each row. When a decision changes, add a new record that supersedes the old one rather than editing history.

| # | Date | Decision | Status | Details |
|---|---|---|---|---|
| 0001 | 2026-11-07 | Shared household money only; individual finances out of scope | Accepted | `product-direction.md` |
| 0002 | 2026-11-07 | Import only (CSV/OFX); bank sync not ruled out behind a "source" abstraction | Accepted | `product-direction.md` |
| 0003 | 2026-11-07 | Accounts, buckets and jobs; the buffer is a save-up job with a fixed role | Accepted; the bucket part is superseded by 0023 | `v1-scope-and-domain-model.md` |
| 0004 | 2026-11-07 | Budget month = calendar month funded by the previous month's money | Accepted | `v1-scope-and-domain-model.md`, decision 1 |
| 0005 | 2026-11-07 | Single-letter keyboard shortcuts; Import renamed Transactions; Norwegian post and pott | Accepted | `information-architecture-and-glossary.md` |
| 0006 | 2026-11-07 | AI autonomy levels 0–2 only in v1; figures never come from the model | Accepted | `product-direction.md` |
| 0007 | 2026-11-08 | Name Holt; repository `holt-budget`; app ID `ink.chiang.holt`; icon "the grove" | Accepted | `visual-design-decisions.md` |
| 0008 | 2026-11-08 | Four themes, Hearth light default, glass off; Figtree and Plex Mono; Lucide; no rings, pies or donuts | Accepted | `visual-design-decisions.md` |
| 0009 | 2026-11-08 | Variable costs: Follow the bills or Even it out with a bucket; estimates from the family's own history | Accepted | `v1-scope-and-domain-model.md`, decisions 6–8 |
| 0010 | 2026-11-08 | Forecasts in each job's panel in v1; household forecast view in v1.x | Accepted | `v1-scope-and-domain-model.md`, decision 7 |
| 0011 | 2026-11-08 | Occasions and gifts in v1.x: manual entry, one evened-out bucket, gift-level detail | Accepted | `v1-scope-and-domain-model.md`, decision 9 |
| 0012 | 2026-11-08 | Electron (not Tauri) | Accepted | `technical-decisions.md` §1 |
| 0013 | 2026-11-08 | React 19 + React Router SPA data mode + Vite; no HTTP server | Accepted | `technical-decisions.md` §2 |
| 0014 | 2026-11-08 | Pure TypeScript core; sandboxed renderer; network denied except the loopback model endpoint | Accepted | `technical-decisions.md` §3 |
| 0015 | 2026-11-08 | Encrypted SQLite (better-sqlite3-multiple-ciphers); key in the keyring via forced gnome-libsecret, passphrase fallback, never basic_text | Accepted; the key part is superseded by 0030 | `technical-decisions.md` §4–5 |
| 0016 | 2026-11-08 | Bring-your-own local runtime (llama-server, LM Studio/llmster, Ollama) on loopback only, JSON-schema output | Accepted | `technical-decisions.md` §6 |
| 0017 | 2026-11-08 | Model: Qwen 3.8 27B default on the 4090, confirmed by bake-off | Proposed | `technical-decisions.md` §7 |
| 0018 | 2026-11-08 | Glass: in-app in v1; compositor blur experimental | Open | `technical-decisions.md` §9 |
| 0019 | 2026-11-08 | AUR first, then AppImage, Flatpak later | Accepted | `technical-decisions.md` §10 |
| 0020 | 2026-11-08 | Mobile: neither dsh nor RustDesk; later a read-only view over a private network | Accepted | `technical-decisions.md` §11 |
| 0021 | 2026-11-08 | Code and data are separate: the public repository holds code and docs; household details and real exports stay in `private/`; dev uses its own data folder | Accepted | `technical-decisions.md` §13 |
| 0022 | 2026-11-08 | Store facts, derive figures; every change is a command, shared by previews, proposals, change records and undo | Accepted | `v1-scope-and-domain-model.md`, "Facts and figures" and "Changes are commands" |
| 0023 | 2026-11-08 | A bucket is the money a job keeps in the account where its money sits, not a separate object | Accepted | `v1-scope-and-domain-model.md`, Job and Bucket |
| 0024 | 2026-11-08 | Plan start month; earlier transactions are history and never wait in "needs you" | Accepted | `v1-scope-and-domain-model.md`, decision 10 |
| 0025 | 2026-11-08 | Moves at the bank, one-off and monthly, matched against imported transfers | Accepted | `v1-scope-and-domain-model.md`, decision 11 |
| 0026 | 2026-11-08 | Spend jobs use Set amount, Follow the bills or Even it out; budget months are planned, open, closed or reopened; amounts stop moving when a month opens | Accepted | `v1-scope-and-domain-model.md`, decision 12 |
| 0027 | 2026-11-08 | An over job keeps its negative balance until the review | Accepted | `v1-scope-and-domain-model.md`, decision 13 |
| 0028 | 2026-11-08 | Import rows kept per file; duplicate matching counts; undoing an import is a new command | Accepted | `v1-scope-and-domain-model.md`, Import batch and Import row |
| 0029 | 2026-11-08 | Each transaction has exactly one treatment; income carries the month it funds; the booking date decides the month | Accepted | `v1-scope-and-domain-model.md`, Transaction |
| 0030 | 2026-11-08 | One data key in two copies: the keyring for daily unlock, a recovery code for backups | Accepted | `technical-decisions.md` §5, `v1-scope-and-domain-model.md` decision 14 |
| 0031 | 2026-11-08 | Automatic, versioned, encrypted backups to a folder you choose; your own sync tool may upload it | Accepted | `technical-decisions.md` §14 |
| 0032 | 2026-11-08 | Main-process HTTP through one loopback-only `net.fetch` function, a lint rule, and a no-network test in a network namespace | Accepted | `technical-decisions.md` §3 |
| 0033 | 2026-11-08 | Words from the model name figures by placeholder; a validator rejects digits | Accepted | `technical-decisions.md` §6 |
| 0034 | 2026-11-08 | Zod 4 schemas at every boundary; plain SQL migrations, no ORM; branded dates and IDs | Accepted | `technical-decisions.md` §3, §4, §15 |
| 0035 | 2026-11-08 | Entered values share one append-only shape | Accepted | `v1-scope-and-domain-model.md`, Entered value |
| 0036 | 2026-11-08 | Spikes run S1, S2, S4, S5, S3; real exports are never committed, even anonymised | Accepted | `technical-decisions.md`, Spikes |
| 0037 | 2026-11-08 | One currency for the household, chosen in Setup and fixed once data exists; money in minor units; no conversion | Accepted | `v1-scope-and-domain-model.md`, decision 15 |
| 0038 | 2026-11-08 | Money is displayed as `Intl` writes it for the language and currency, with "68,048 kr" kept for kroner in English as the one override; the tagline becomes "Every unit of money a job" | Accepted | `technical-decisions.md` §3 |
| 0039 | 2026-11-08 | Model behaviour is tested in three layers: fake-model contract tests and recorded replies in CI, and a live `pnpm eval` on your machine scored against the S3 baseline | Proposed | `technical-decisions.md` §12 |
