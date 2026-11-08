# Holt: product direction (v0.8, 8 Nov 2026)

**Holt** is a household budget planner for Linux (Arch, CachyOS, Hyprland with Caelestia), open source under MIT. It runs entirely on the family's own computer, with a local AI assistant that explains and suggests but never decides.

*Holt helps a household give every unit of money a job, showing where the shared money comes from, where it goes and what it's set aside for, from this month's spending to the long-term plan.*

Status: working draft from the discovery conversation (7–8 Nov 2026). The technical choices are in `technical-decisions.md`.

**Mockups (canvas v0.3):** https://claude.ai/artifact/Jv8Qd23PCU7tUBaFQS5Z1g. Screens: Setup, Overview, Transactions, Plan (with the Electricity job panel), Recurring costs, Insurance, Monthly review, Ask or find; plus theme checks, visual directions and the app icon. Screenshots are in `design/mockups/`.

## The first household
Holt is designed around one real household first. Its private details stay in `private/household.md`, which is never committed. These are the facts that shaped the design:
- Two adults and several school-age children, with one adult running the shared money day to day. Children are why Holt has children's savings accounts and a children's timeline, which covers child-linked income that ends and milestones such as konfirmasjon.
- Banks: Bulder and SpareBank 1 SR-Bank. They are the first import profiles.
- Property: a home, plus a plot of land the family plans to build on, with no timeline yet. This is why the build project measures readiness rather than counting down to a date.
- Money model: each adult has individual accounts, and the household has shared accounts. **The app covers the shared household economy only.** Individual finances are out of scope; they might become a separate, private space later.
- Each child has their own savings account, which the household pays into.
- Shared accounts are funded by a **fixed monthly contribution from each adult**, tracked separately for each adult.
- UI language: British English first, Norwegian (Bokmål) later.

## Guiding principle: the family's reality is the source of truth
- Nothing is hard-coded from outside data. Amounts such as barnetrygd, salaries and bills are **learned from imports** (detected as recurring income or costs) and can always be edited.
- Where the app uses a reference value (for example the 5× debt rule or the 90% loan-to-value cap), it is an **editable setting**. Each one shows where it came from and when it was last checked by the user. Nothing updates itself, consistent with local-only.
- Built-in knowledge of Norwegian schemes (barnetrygd, feriepenger, BSU, IPS and so on) is only a **template**: a name, a typical rhythm, and a prompt to confirm. The family's own data fills it in.
- Estimates use the family's own history, never outside rates such as inflation.

## Decisions so far
| Topic | Decision |
|---|---|
| Name | **Holt**. Repository `holt-budget`, app ID `ink.chiang.holt`. A *household budget planner*, not a "manager": it never moves money. |
| Market | A family in Norway first (NOK, Norwegian money year). Then privacy-minded Linux users. Possibly macOS later. |
| Currency | One currency for the whole household: any ISO 4217 code, chosen in Setup and fixed once data exists. Holt never mixes or converts currencies. |
| Scope of accounts | Shared household accounts only. Money from individual accounts arrives as contributions. Accounts the household pays into (for example children's savings) are tracked by deposits; importing them is optional. |
| Contributions | A fixed amount from each adult, tracked against each adult's target. |
| Off-app figures | Gross incomes, individual debts and credit limits are entered by hand for the lending ratios, and labelled "entered by you, last updated …". |
| Data in | Import only for v1: CSV / OFX statements (PDF read by the local model in v1.x). The app reminds the family when an import is due. Bank sync is out of scope but not ruled out: imports sit behind a "source" abstraction. First import profiles: Bulder and SpareBank 1 SR-Bank. The first import can cover the year so far (about 10 months). |
| Method | Every unit of money gets a job, applied flexibly. The plan matures as the family's position improves (see Stages). |
| Scope | Day-to-day budgeting **and** the full picture (net worth, debt, savings schemes, forecasting, the build project). |
| Variable costs | Plan each one by **following the bills** or **evening it out** with a bucket. The plan always reconciles with the real bills. |
| Forecasts | v1: in each job's panel in Plan, and as estimates in the Overview's 12-month ribbon. A household-wide forecast view in v1.x. |
| Cost cutting | The app suggests where to cut and detects recurring costs and subscriptions. |
| Insurance | First-class policy register with aggregation and a side-by-side view for comparing quotes. The human does the comparing; the app never searches for offers. (v1.x) |
| Gifts | Occasions and gifts planned by recipient, amount, occasion and who it's from, funded by one evened-out bucket. Manual entry, no link to wishlist services. (v1.x) |
| Asking questions | An "Ask or find" palette (A or Ctrl K) over any screen, not a chat-first app. |
| Obsidian | Optional companion at most. Deferred until it shows value the app can't provide itself. A plain markdown export of the monthly review instead. |
| AI | Local only and not agentic in v1 (see the autonomy levels below). It proposes; the family approves. It never changes figures silently. Everything can be undone. |
| UI | British English, four colour themes (Hearth light and dark, Instrument, Follow my desktop), glass off by default. i18n-ready. See `visual-design-decisions.md`. |
| Mobile | Not in v1. Neither dsh nor RustDesk (both rejected on security grounds). Later: a read-only phone view served by Holt over a private network. |
| Backup | Encrypted, automatic and versioned, to a folder you choose. Your own sync tool can upload that folder; Holt never does. A recovery code opens a backup on any computer, because the keyring sits on the same disk as the data. |
| Code and data | The repository is public and holds code and docs only. The household's data and details never enter it. |

## Money model: accounts, buckets and jobs
Three separate concepts, named consistently everywhere:
- **Account**: a real bank account. Shared accounts are imported. Accounts the household pays into (children's savings) are tracked by what is paid in; importing them is optional, with balances otherwise entered by hand.
- **Bucket**: the money a job keeps, set aside in one account. For example, the Buffer account holds Buffer, Christmas, Konfirmasjon and Holidays. The buckets in an account, plus the money in no bucket, add up to the account's balance.
- **Job**: what part of each month's money is for. A job belongs to a group (Fixed costs, Living, Saving, or a new group). There are three kinds:
  1. **Spend each month**: food, activities, fuel. Planned with a set amount, by following the bills, or by evening it out.
  2. **Save up for something**: a target and a date. The app calculates the monthly amount (or the user sets it), and the money sits in a bucket.
  3. **Pay into another account**: for example a child's savings account. This counts as saving for the household, not spending.

### Adding a job (the "New job" flow)
- Started from the "New job" button (key N), or "+ Add a line" under any group.
- Pick the kind, name it, choose a group, and set an amount or a target and date.
- Choose where the money sits (a bucket in an existing account, or an account of its own).
- **Where it comes from.** Because every unit of money already has a job, the flow shows:
  - the unassigned amount it uses first
  - the shortfall, with options for where to take it (split, or from a single job)
  - the knock-on effects (for example savings rate 14.0% → 9.9%, and a goal finishing later)
- Nothing changes until "Add job". Undo is always available.

### The job panel
Select any job in Plan to see its history by month and its estimate for the next 12 months, with how the app worked it out. For variable costs (electricity is the example in the mockups), choose Follow the bills or Even it out. When evening out starts just before winter, the app offers a starting amount or a later start. Apply and Undo.

## Setup flow (first run)
1. **Welcome**: what the app is (local, private), what you need (a statement per shared account, about 15 minutes), language, currency (one for the whole household, fixed once data exists), theme.
2. **Household**: adults with their fixed contribution and the day it usually arrives; children with birth month (used for the children's timeline).
3. **Accounts**: shared accounts (bank, kind, import rhythm), plus accounts the household pays into.
4. **First import**: drop statements (the year so far is best). The app matches contributions, asks the family to confirm detected income (for example "NAV 8,048 kr: is this barnetrygd?"), and counts the recurring costs it found. Transactions before the plan's first month become history. The estimates use them, and none of them wait in Needs you.
5. **First plan**: broad jobs suggested from the history; an option to keep Living as one job; a suggested stage with its reasoning, which the family can override; the month the plan starts, with each account's balance split into buckets.
6. **Bigger picture (optional, skippable)**: house and plot values, mortgage, gross incomes, other debts and credit limits; reference lines pre-filled and editable. Vital signs that need these stay hidden until they are entered.
7. **Assistant and reminders**: local runtime and model status; what it will and won't do; reminder settings; then a backup folder and the recovery code, which the family keeps somewhere other than the backups.

## Ask or find (A or Ctrl K)
- One palette that handles both searching and questions.
  - **Find**: plain search across transactions, jobs, contracts and policies. No AI involved, and labelled as such.
  - **Ask**: the assistant turns the question into a filter; the app calculates; the assistant writes the sentence. Every answer shows how the app worked it out: the filter chips, plus the matching transactions on demand.
  - **What if** (v1.x): calculated, clearly marked "nothing has changed", with "Draft this change in Plan".
- Follow-up chips (compare with last month, change the filter, add to the review). Questions and answers stay on this computer.

## AI character
- Helpful, warm and slightly dry. A capable family finance assistant, not a mascot.
- Plain about what it is: a local model that can be wrong. It shows its working (which transactions, which period).
- Honest about confidence: it says "not enough data" or "I'm not sure" rather than guessing.
- No sparkle icons, no "magic", no exclamation marks, no gamified praise, no invented feelings. Wins are acknowledged briefly and in proportion.
- It sets out options and the numbers behind them; the family decides. It is not a financial adviser.
- **Figures never come from the language model.** Balances, ratios and forecasts are calculated deterministically. The model explains and drafts; it does not do the sums.

## AI autonomy levels
| Level | What it means | v1? |
|---|---|---|
| 0 Calculate | Deterministic maths, no AI involved | Yes |
| 1 Read and explain | Answers and explanations grounded in the family's data | Yes |
| 2 Propose | Categorisations, recurring-cost flags, cut suggestions, drafts, what-ifs. The human approves each one. | Yes |
| 3 Act in the app on instruction | Makes changes when asked, every one undoable | Later, maybe |
| 4 Act outside the app | — | No |

## The shared-account model
- **Household income** is what actually arrives in the shared accounts: each adult's fixed contribution, plus any income paid in directly. An income such as barnetrygd may arrive directly, or bundled inside a contribution, depending on where it is paid.
- **Contributions** are tracked for each adult against a fixed monthly target. The app shows on track / late / short for each adult. It is a record, not a judge.
- **Shared debts and assets** are in scope: the mortgage, the house, the plot, and any build financing.
- **Moves at the bank.** Holt never moves money. When the plan needs money in another account, Holt lists the move for the family to make at the bank, including each account's monthly move worked out from the plan. An import that shows the transfer marks it done.
- **Ratios that need the whole picture** (gjeldsgrad needs gross income and all debts) use manually entered figures for things outside the app: gross salaries, individual debts, credit limits. Each one is clearly marked as "entered by you, last updated …", and the app prompts a yearly review of them (for example after the skattemelding).

## Core concepts
- **The Norwegian money year (as templates).** The app recognises the typical yearly rhythm: feriepenger in June, half-tax months in Nov/Dec, monthly benefits, the skattemelding in spring, year-end BSU/IPS deadlines, and lumpy bills (insurance, EU-kontroll, kommunale avgifter, eiendomsskatt). It confirms each one against imports rather than assuming.
- **Children's timeline.** Uses birth dates entered by the family and the benefit amounts actually observed in imports. It projects when child-linked income ends and flags milestones the family chooses (for example konfirmasjon, driving licence, russ, moving out) as savings prompts. Everything is editable.
- **The build project (no timeline yet).** An open-ended goal measured as **readiness**, not a countdown:
  - the plot as an asset
  - equity built up for the build
  - borrowing headroom against the family's editable reference limits
  - a building budget and contingency, once there are figures
  - scenarios (sell first, build first, bridging finance), shown as "what would need to be true"
- **Stages (the plan grows with the family).** 1 Breathing room → 2 Debt down → 3 Foundations (buffer, BSU, IPS) → 4 Growth. Categories start coarse and get finer as the family progresses. "Unassigned" is a state, not a failure.
- **Import freshness.** Each account shows when it was last imported and what period it covers. Reminders follow payday and each account's cadence. Duplicates are removed and the balance reconciled after every import.

## Occasions and gifts (v1.x)
- **The need:** birthdays, Christmas and other occasions shouldn't land as one big hit in a single month. Spread them across the year.
- **How:** one "Gifts and occasions" job, evened out with a bucket, like electricity. Its yearly estimate is the sum of the gifts planned for each occasion in the next 12 months.
- **Gift-level detail:** each gift records who it's for (anyone, inside or outside the household), the amount, the occasion, and who it's from (for example "from the children", when buying on someone else's behalf). Status runs idea → planned → bought → given.
- **Manual entry:** gifts are typed in. Wishlist services such as Ønsk have no public API, and fetching from them would break the no-network rule.
- **Paying:** when an import allocates a transaction to Gifts and occasions, Holt offers to link it to a planned gift, so planned and actual amounts are both visible.
- Details are in `v1-scope-and-domain-model.md` (decision 9 and the Occasion, Gift and Gift recipient objects).

## Insurance (v1.x)
- **Policy register.** For each policy:
  - insurer and type (house, contents, car, travel, life, disability, children's, accident, plot/liability)
  - what or who it covers
  - premium and billing frequency
  - excess (egenandel) and sum insured
  - renewal date
  - the policy document (key fields extracted locally from the PDF)
- **Matching payments.** Payments to insurers are matched to policies. One combined invoice can be split across several policies.
- **Aggregation.** Total per year and as a share of household income; breakdowns by type, by insurer (shows how much bundle discount you depend on), and by person or object; premium trend year on year.
- **Coverage vs exposure (facts, not advice).** For example: shared debt against total life cover; whether the plot and the build are covered at each stage.
- **Overlaps.** Flag likely duplicate cover.
- **Quote comparison.** The human enters quotes. The app lines them up like for like (premium, excess, cover) and shows the knock-on effect on any bundle discount (the "real cost a year" row). Renewal reminders are timed so there's room to compare.

## Cost cutting and recurring costs
- **Detection.** Spot recurring charges by merchant, amount and cadence, including annual charges (the easiest to forget). Flag:
  - free trials that have turned into paid subscriptions
  - price creep
  - overlaps
- **Subscriptions shelf.** Every recurring cost shown at its yearly price, with the prompt "still worth it?" and the options Keep / I'll cancel it / Ask in 3 months.
- **Closed loop for cancellations.** The app gives a cancellation checklist, marks the item "cancelling, watching", and confirms on the next import that the charge has actually stopped. If it hasn't, the app flags it.
- **Suggestions tied to the plan.** Rank by impact versus effort and express each cut as progress towards a goal. Comparisons are against the family's own baseline, with an optional, user-supplied benchmark.
- **Renegotiation calendar.** Reminders before insurance renewals, electricity and mobile contracts, and mortgage rate checks. The family does the comparing; the app never fetches anything.
- **Tone.** Suggestions, never scolding. Dismiss / snooze / "don't ask again" are always respected.

## Visualisation concepts
No rings, pies or donuts. Every chart answers one question (see the design system's chart rules).
- **Money Map.** Contributions and income → shared accounts → jobs, with blocks sized by monthly flow. It doubles as navigation.
- **Vital signs.** Instruments with a target, a trend, and "what moves this". Reference lines are editable settings.
  - buffer runway (months of essential shared spending covered)
  - gjeldsgrad (uses manually entered incomes and debts)
  - belåningsgrad
  - savings rate (of household income)
  - net worth, and debt-to-equity (shared)
  - build readiness
- **Next 12 months.** Known large costs, estimated winter bills and occasions, month by month.
- **Job history and estimate.** Actual bars, estimated outlined bars, and the bucket's balance as a line (the Electricity panel).
- **Goal glide paths.** Plan versus actual.

## Open questions
- None in this document. Open technical items are listed in `technical-decisions.md`.
