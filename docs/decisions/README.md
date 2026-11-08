# Decision records

Short records of decisions, newest last. The full reasoning lives in the documents linked from each row. When a decision changes, add a new record that supersedes the old one rather than editing history.

| # | Date | Decision | Status | Details |
|---|---|---|---|---|
| 0001 | 2026-11-07 | Shared household money only; individual finances out of scope | Accepted | `product-direction.md` |
| 0002 | 2026-11-07 | Import only (CSV/OFX); bank sync not ruled out behind a "source" abstraction | Accepted | `product-direction.md` |
| 0003 | 2026-11-07 | Accounts, buckets and jobs; the buffer is a save-up job with a fixed role | Accepted | `v1-scope-and-domain-model.md` |
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
| 0015 | 2026-11-08 | Encrypted SQLite (better-sqlite3-multiple-ciphers); key in the keyring via forced gnome-libsecret, passphrase fallback, never basic_text | Accepted | `technical-decisions.md` §4–5 |
| 0016 | 2026-11-08 | Bring-your-own local runtime (llama-server, LM Studio/llmster, Ollama) on loopback only, JSON-schema output | Accepted | `technical-decisions.md` §6 |
| 0017 | 2026-11-08 | Model: Qwen 3.8 27B default on the 4090, confirmed by bake-off | Proposed | `technical-decisions.md` §7 |
| 0018 | 2026-11-08 | Glass: in-app in v1; compositor blur experimental | Open | `technical-decisions.md` §9 |
| 0019 | 2026-11-08 | AUR first, then AppImage, Flatpak later | Accepted | `technical-decisions.md` §10 |
| 0020 | 2026-11-08 | Mobile: neither dsh nor RustDesk; later a read-only view over a private network | Accepted | `technical-decisions.md` §11 |
