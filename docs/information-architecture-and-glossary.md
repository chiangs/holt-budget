# Holt: information architecture and glossary (v0.6, 8 Nov 2026)

Companion to `product-direction.md` and `v1-scope-and-domain-model.md`. This document covers four things:
- where each thing lives
- how you get there
- what everything is called, in British English, with Norwegian (Bokmål) equivalents
- the words the interface and the assistant must use and avoid

## Decisions made
**7 Nov 2026**
- The "Import" screen is renamed **Transactions**, with Import as its main button.
- The Norwegian term for "job" is **post** (budsjettpost). "Hver krone får en jobb" may still be used as a slogan.
- The Norwegian term for "bucket" is **pott**.
- **Keyboard:** single-letter shortcuts with no modifiers, based on the first letter of each sidebar item. Chosen to suit small (40%) keyboards.
- **Writing:** active voice, naming who acts (see Writing conventions).

**8 Nov 2026**
- The mockups had their copy pass: active voice and glossary terms throughout (canvas v0.3).
- Occasions and gifts (v1.x) live in Plan, inside the Gifts and occasions job. Glossary terms are below.

There are no open questions in this document.

## Principles
1. **Few screens.** Six main screens, a palette over everything, a one-off setup, and a settings page. Add a screen only when a real need appears.
2. **Every object has one home.** Other screens show it and link to it, but you change it in one place. For example, you edit a job only in Plan.
3. **Every figure can show its working.** Select any calculated number and the app shows how it worked it out: the filter and the transactions behind it.
4. **Everything is reachable from Ask or find (A).** Screens, jobs, transactions, contracts, gifts and settings.
5. **One vocabulary.** The interface, the assistant, exports and documentation all use the glossary below. The app gives the assistant the glossary, and the assistant must not invent synonyms.

## Navigation

```
Sidebar (always visible; each item shows its key)
├─ Ask or find                 A        (opens over the current screen; Ctrl K also works)
├─ Overview                    O
├─ Transactions                T        badge: "Due" · count of "needs you"
├─ Plan                        P        badge: unassigned or over-assigned money
├─ Recurring costs             R        badge: flags to look at
├─ Monthly review              M        badge: "Ready" when a draft is waiting
├─ (Insurance                  I        v1.x)
└─ Bottom: assistant status · Settings (S)

First run only: Setup (7 steps). You can revisit any step from Settings.
```

### Transactions
Transactions need a permanent home where you browse, correct, split and annotate them. Importing is only one thing that happens there.
- **Header:** whether each account is up to date, with **Import** as the main button (key N).
- **Tabs:**
  - **Needs you:** transactions waiting for your decision. The app opens this tab first when there are any.
  - **All:** every transaction, with search and filters.
  - **Imports:** the history of your imports. You can undo any of them.

### The job panel (in Plan)
Selecting a job opens a panel beside the list: its history by month, its estimate for the next 12 months with how the app worked it out, and, for variable costs, the choice between Follow the bills and Even it out. For Gifts and occasions (v1.x), the panel also lists the year's occasions and the gifts planned for each.

## Screen map
| Screen | The question it answers | What lives here | Main actions | Reached from |
|---|---|---|---|---|
| **Overview** | How are we doing? | Nothing is edited here. Shows vital signs, Money Map, assistant notes, the next 12 months, reminders | Open the working behind any figure; act on an assistant note | Sidebar; O; home on launch |
| **Transactions** | Is our data complete and correct? | Transactions, allocations, import batches, format profiles | Import; confirm or change a job; split; mark as transfer; link to a gift; add a note; "always do this" (creates a rule); undo an import | Sidebar; T; "Import due" reminder; Overview notes; Ask or find |
| **Plan** | What is each krone for? | Groups, jobs (including the buffer), assignments, buckets, accounts ("Where the money sits"), contributions, stage, build project, children's timeline, milestones; occasions and gifts (v1.x) | New job; assign or move money; change a job; follow the bills or even it out; add an account or bucket; withdraw from the buffer; add an occasion or a gift | Sidebar; P; Money Map blocks; "unassigned" badge |
| **Recurring costs** | What do we pay again and again, and is it still worth it? | Recurring series, contracts | Keep / I'll cancel it / ask later; set a renewal reminder; open the transactions in a series | Sidebar; R; Overview notes; Review |
| **Monthly review** | How did last month go, and what do we change? | Reviews (current draft and past months), decisions | Edit the wording; tick decisions; approve; reopen; export as markdown | Sidebar; M; "Review ready" reminder; Overview note |
| **Ask or find** | Where is …? How much …? | Question history | Search; ask; follow up; open a result in its home screen | A or Ctrl K anywhere; sidebar |
| **Settings** | — | Household, people and contributions, gift recipients (v1.x), accounts, rules for sorting transactions, reference lines, figures you entered, assistant, reminders, appearance, keyboard, data (backup, export, change history) | Edit; re-run a setup step; back up and restore | Sidebar (bottom); S |
| **Setup** | — | First-run flow | 7 steps; you can skip step 6 | First launch only |
| **Insurance** (v1.x) | What are we covered for, and at what cost? | Policies, quotes, bundle discounts | Add a policy; enter a quote; compare | Sidebar; I; renewal reminder |

## Where each object lives
| Object | Home (you edit it here) | Also shown in |
|---|---|---|
| Household, person, contribution agreement | Settings → Household | Plan (Money in), Overview (Money Map) |
| Account | Settings → Accounts (setup details) · Plan (balances and buckets) | Transactions (up to date or not) |
| Asset (house, plot) | Settings → Figures you entered | Overview (net worth, loan to value), Plan (build project) |
| Group, job, assignment | Plan | Overview, Transactions (job picker), Review |
| Estimate | Plan (job panel), where you can override a month | Overview (12-month ribbon, marked ≈) |
| The buffer | Plan | Overview ("How long could we last?") |
| Bucket | Plan | — |
| Transaction, allocation | Transactions | Ask or find, any "show working" panel |
| Import batch, format profile | Transactions → Imports | — |
| Rule for sorting transactions | Settings → Rules (or create one from a transaction with "always do this") | Transactions (shows which rule applied) |
| Recurring series, contract | Recurring costs | Plan (linked jobs), Overview (next 12 months) |
| Reference setting, figure you entered | Settings | Wherever the app uses it, labelled "entered by you on …" or "your setting" |
| Milestone, children's timeline | Plan | Overview (next 12 months) |
| Build project | Plan | Overview ("Could we build?") |
| Occasion, gift (v1.x) | Plan → Gifts and occasions panel | Overview (12-month ribbon), Monthly review (coming up), Transactions (link a payment to a gift) |
| Gift recipient (v1.x) | Settings → Household → Gift recipients (or added while planning a gift) | Plan (gift list) |
| Monthly review, decision | Monthly review | Overview note when ready |
| Suggestion (proposal) | Wherever it applies: a job suggestion in Transactions, a plan change in Plan, a cut in Recurring costs | Monthly review (decisions), Overview (assistant notes) |
| Reminder | Settings → Reminders (configuration) | Overview, desktop notifications, sidebar badges |
| Question | Ask or find (history) | — |
| Change record | Settings → Data → Change history | Undo appears inline right after each change |
| Policy, quote (v1.x) | Insurance | Recurring costs (contracts), Overview |

## Recurring patterns
- **Show working.** Every calculated figure opens a small panel with the filter the app used (as chips) and a "Show the transactions" link.
- **Undo inline.** After every change, Undo appears where you made it and stays while you're on that screen. After that, use Change history.
- **Suggestions look the same everywhere.** Each says what the assistant or the app suggests, why (the evidence), and offers Accept / Change / Dismiss. A small label says who made it: "Suggested by the assistant" or "Found by the app".
- **Entered by you.** Any value you typed, rather than one the app calculated, carries "entered by you on [date]" or "your setting".
- **Estimates are marked.** "≈" or "est." on every estimated amount, linking to how the app worked it out.
- **Badges are facts, not alarms.** "Due", "3 need you", "228 kr unassigned". No red dots for their own sake.

## Keyboard
Single keys, no modifiers, designed for small keyboards.

### Rules
- **Typing always wins.** Shortcuts never fire while the cursor is in a text field. Esc leaves the field first.
- **Navigation letters are reserved.** A, O, T, P, R, M, I and S always mean the same place, on every screen. The app never uses them for actions.
- **Every key is visible.** Each sidebar item shows its key in a small chip, and every button with a key shows it in the button or its tooltip.
- **You can turn them off or change them.** Settings → Keyboard turns single-key shortcuts off, or lets you reassign any of them. This also meets the accessibility requirement for character-key shortcuts (WCAG 2.1.4).
- **Keys follow the interface language.** In Norwegian they become O (Oversikt), T (Transaksjoner), P (Plan), G (Gjentakende kostnader), M (Månedsgjennomgang), F (Forsikring), S (Spør eller søk) and I (Innstillinger), with no clashes. You can keep the English letters if you prefer.

### Go to
| Key | Goes to |
|---|---|
| A | Ask or find (Ctrl K also works) |
| O | Overview |
| T | Transactions |
| P | Plan |
| R | Recurring costs |
| M | Monthly review |
| I | Insurance (v1.x) |
| S | Settings |

### Act on the current screen
| Key | Action |
|---|---|
| N | The screen's main "new" action: Import on Transactions, New job on Plan, Add a quote on Insurance |
| J / K | Next / previous item in a list |
| Enter | Open the selected item |
| E | Edit the selected item |
| Space | Accept the selected suggestion (Transactions, Recurring costs) |
| X | Dismiss the selected suggestion |
| U | Undo the last change |
| Shift U | Redo |
| / | Filter or search within the current screen |
| ? or H | Show all shortcuts |
| Esc | Close a panel or the palette; leave a text field |

Ctrl Z and Ctrl Shift Z also undo and redo, for anyone who expects them.

---

# Glossary

Norwegian terms marked **decided** are settled. The rest are proposals for a native speaker (ideally the family) to check before we build the Norwegian interface.

## Money and planning
| English (UI) | Meaning | Norwegian | Notes |
|---|---|---|---|
| Household | The family whose shared money the app manages | Husstand | |
| Shared accounts | The household's joint bank accounts | Felles kontoer | |
| Account | A real bank account | Konto | |
| Account you pay into | An account outside the shared economy that the household pays into, such as a child's savings | Konto dere betaler inn til | |
| Bucket | Part of one account set aside for one job | **Pott** · decided | In English, always "bucket", never "pot". Combines naturally: Bufferpotten, Feriepotten. |
| Job | What part of each month's money is for | **Post** (budsjettpost) · decided | Slogan may still say "Hver krone får en jobb" |
| Group | A set of related jobs (Fixed costs, Living, Saving) | Gruppe | |
| Fixed costs | | Faste kostnader | |
| Living | | Levekostnader | |
| Saving | | Sparing | |
| Spend each month | A job kind | Bruk hver måned | |
| Save up for something | A job kind with a target and a date | Spar til noe | |
| Pay into another account | A job kind | Betal inn til en annen konto | |
| Follow the bills | Plan a spend job at each month's estimate | Følg regningene | |
| Even it out | Plan the same amount every month, with a bucket for the swings | Jevn det ut | |
| Estimate | The app's forecast for a future month, marked ≈ | Anslag | |
| Target | The amount a save-up job aims for | Mål | |
| Ready by | The date a save-up job aims for | Klart innen | |
| Assign | Give money a job | Fordele | Verb used in Plan |
| Unassigned | Money with no job yet | Ikke fordelt | |
| Over-assigned | More assigned than available | Overfordelt | |
| Money available | What you can assign this month | Penger til fordeling | |
| Next month's money | Money already received for next month | Neste måneds penger | Never counted as buffer |
| Money in | Everything arriving in the shared accounts | Penger inn | |
| Contribution | An adult's fixed monthly payment into the shared accounts | Fast innbetaling | Avoid "bidrag" (confusable with barnebidrag) |
| Buffer | The household's safety money; a save-up job with a fixed role | Buffer | |
| Essential | A job needed to keep the household running | Nødvendig | |
| Carry over | Keep a spend job's leftover money for next month | Ta med til neste måned | |
| Over | A job that has spent more than assigned | Over | Never "overspent!" |
| Stage | Where the household is in the plan | Trinn | |
| Breathing room · Debt down · Foundations · Growth | The four stages | Pusterom · Ned med gjelden · Grunnmur · Vekst | |
| Build project | The plan to build on the plot | Byggeprosjektet | |
| Readiness | How close the household is to being able to build | Hvor klare vi er | |
| Milestone | A dated event with a cost, such as konfirmasjon | Milepæl | |

### Why pott for bucket (decided 7 Nov 2026)
A bucket is money set aside inside an account. It is not a type of spending, and not a separate bank account. Options considered:
| Option | Verdict |
|---|---|
| Kategori | No. Norwegian bank apps use "kategori" for types of spending, which is what a post is. It would merge the two ideas. |
| Delkonto | Clear, but means a real sub-account at the bank. It would blur the line between accounts and buckets. |
| Lomme | Friendly, but too close to "lommepenger" (pocket money), which matters in a household with children. |
| Beholder | Literal "container"; reads as technical or physical (a tank, a bin). |
| Konvolutt | Ties to envelope budgeting, where the envelope is the spending line itself, which is closer to a post. |
| **Pott** | Chosen. Everyday Norwegian for a pool of money set aside ("felles pott", "legge i potten"). Short, and it combines naturally. |

## Occasions and gifts (v1.x)
| English (UI) | Meaning | Norwegian (proposed) | Notes |
|---|---|---|---|
| Gifts and occasions | The job that funds every occasion, evened out with one bucket | Gaver og anledninger | Replaces "Christmas and gifts" |
| Occasion | Something the household gives gifts for | Anledning | Birthday, Christmas, konfirmasjon, wedding… |
| Gift | One planned or bought gift | Gave | |
| For | Who the gift is for | Til | |
| From | Who the gift is from | Fra | "All of us" = "Fra alle oss" |
| Gift recipient | Anyone the household gives to | Mottaker | Stored only on this computer |
| Idea · Planned · Bought · Given | A gift's status | Idé · Planlagt · Kjøpt · Gitt | Ideas don't count towards the estimate |
| Default budget | An occasion's amount until gifts are planned | Standardbeløp | |

## Transactions and import
| English (UI) | Meaning | Norwegian (proposed) | Notes |
|---|---|---|---|
| Transaction | One line from a bank statement | Transaksjon | |
| Transactions (screen) | | Transaksjoner | |
| Import | Bring in a statement file | Importer (verb) · Import (noun) | |
| Import due | An account is older than its rhythm | Tid for import | |
| Up to date | An account imported within its rhythm | Oppdatert | |
| Covers to | The last date an account's data reaches | Dekker til | |
| Needs you | A transaction waiting for your decision | Må sjekkes | |
| Duplicate | A transaction already imported | Duplikat | |
| Balance check | Comparing the app's balance with the bank's | Saldokontroll | |
| Split | Divide one transaction across jobs | Del opp | |
| Transfer | Money moved between shared accounts | Overføring | |
| Refund | Money back against a cost | Tilbakebetaling | |
| Rule | "Always give this counterparty this job" | Regel | |
| Always do this | Turn a correction into a rule | Gjør alltid dette | |

## Recurring costs and contracts
| English (UI) | Meaning | Norwegian (proposed) | Notes |
|---|---|---|---|
| Recurring cost | Anything charged on a regular rhythm | Gjentakende kostnad | |
| Subscription | A recurring cost you can cancel yourself | Abonnement | |
| Price rise | | Prisøkning | |
| New charge | First charge after a free trial | Ny belastning | |
| Keep · I'll cancel it · Ask in 3 months | The three choices for a subscription | Behold · Jeg sier det opp · Spør om 3 måneder | |
| Cancelling, watching | You've cancelled; the app is checking the charge stops | Sagt opp – følger med | |
| Cancelled, and checked | The app has confirmed the charge stopped | Sagt opp og bekreftet | |
| Contract | An agreement with a renewal or end date | Avtale | |
| Renews | | Fornyes | |
| Compare by | Reminder date for comparing offers | Sammenlign innen | |

## Review, assistant and figures
| English (UI) | Meaning | Norwegian (proposed) | Notes |
|---|---|---|---|
| Monthly review | The month-end summary and decisions | Månedsgjennomgang | |
| Draft | | Utkast | |
| Approve · Reopen | | Godkjenn · Åpne igjen | |
| Decision | A ticked change the app applies when you approve | Beslutning | |
| Suggestion | Anything the assistant or the app proposes | Forslag | Never "recommendation" or "advice" |
| Assistant | The local model | Assistenten | No personal name |
| Local model | | Lokal modell | |
| Ask or find | The palette you open with A | Spør eller søk | Key S in the Norwegian interface |
| Show working | How the app calculated a figure | Vis utregning | |
| Vital signs | The instruments on Overview | Nøkkeltall | |
| How long could we last? | Buffer runway, in months of essentials | Hvor lenge klarer vi oss? | |
| Debt to income | All debt ÷ gross income | Gjeldsgrad | |
| Loan to value | Mortgage ÷ house value | Belåningsgrad | |
| Savings rate | Saving ÷ money in | Spareandel | |
| Net worth | Assets − debts (shared) | Nettoformue | |
| Debt to equity | Debt ÷ net worth | Gjeld mot egenkapital | |
| Reference line | An editable limit or target shown on an instrument | Referanselinje | |
| Your setting | A reference line the family controls | Din innstilling | |
| Entered by you | A value you typed rather than one the app calculated | Lagt inn av deg | |
| Next 12 months | The forecast ribbon | De neste 12 månedene | |
| Backup · Restore | | Sikkerhetskopi · Gjenopprett | |
| Undo · Redo | | Angre · Gjør om | |

## Words the interface and the assistant avoid
| Avoid | Use instead | Why |
|---|---|---|
| Category, envelope, pot, fund | Job, bucket | One vocabulary |
| Expense | Cost, spending | One vocabulary |
| Income (for contributions) | Money in, contribution | The app only sees what arrives in shared accounts |
| Budget (for a single line) | Job | "Budget" is the whole plan |
| Recommend, advise, should | Suggest, could, option | Not a financial adviser |
| Smart, magic, AI-powered, insights | Say what it does: "found", "worked out", "suggested" | Honest about function |
| Overspent!, warning, failed, bad | Over, short, not yet | Calm, never scolding |
| Great job!, amazing, well done! | A plain statement of the fact | Proportionate warmth, no praise inflation |
| Fresh | Up to date | Plainer |

## Writing conventions
- **Active voice, naming who acts.** Every sentence says who did or will do something: you, the app, the assistant, or the bank. This keeps responsibility visible, which matters when some actions are yours, some are calculations and some are suggestions.
  - **Exception:** short status labels of two to four words may drop the verb, as long as they still name the actor or the state: "Up to date", "Entered by you", "Suggested by the assistant".

  | Avoid (passive) | Use (active) |
  |---|---|
  | 2 duplicates were skipped | The app skipped 2 duplicates |
  | Regninger hasn't been imported since 17 Oct | You last imported Regninger on 17 Oct |
  | Some figures may be changed | These figures will change when you import Regninger |
  | The review was approved on 7 Nov | You approved the review on 7 Nov |
  | A job has been suggested for 21 transactions | The assistant suggests jobs for 21 transactions |
  | Audible has been cancelled | You cancelled Audible on 3 Oct. The app has seen no charge since. |
  | Holidays was added | You added Holidays: 3,000 kr a month from December |
  | Ticked items are applied when approved | The app applies the ticked items when you approve |

- **Spelling and case:** British spelling and sentence case everywhere. No exclamation marks.
- **Money:** English shows "68,048 kr", Norwegian shows "68 048 kr". No decimals unless øre matter.
- **Dates:** short form "7 Nov", full form "7 November 2026", months in a range "Dec–Jun". Norwegian: "7. nov.", "7. november 2026".
- **Norwegian terms in the English interface:** "barnetrygd", "feriepenger", "konfirmasjon", "kommunale avgifter" and "EU-kontroll" stay in Norwegian, because translating them makes them less clear. Lending terms appear in English, with the Norwegian term in "show working" (for example "Debt to income (gjeldsgrad)").
- **Every number says where it came from:** the app calculated it, you entered it, or the app found it in an import.
