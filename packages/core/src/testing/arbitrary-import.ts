/**
 * Random bank histories for import properties. A list of bank events (with many exact repeats, transfers
 * between the household's accounts, pending rows and an account the household doesn't have) is cut into
 * two files that may overlap, as two exports from the same bank would. The household may already hold
 * transactions recorded by hand, moves at the bank still to do, and a rule.
 */

import fc from "fast-check";
import { type AccountNumber } from "../account-number.ts";
import { type LocalDate, addDays, localDate } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { type AccountId, ruleId } from "../ids.ts";
import type { StatementFile, StatementRow } from "../import/statement.ts";
import { type Money, money } from "../money.ts";
import { NOK, kr, testId } from "./facts-builder.ts";
import { importHousehold, numbers } from "./synthetic-statement.ts";

export interface ImportScenario {
  readonly facts: Facts;
  /** The household's shared accounts with a number, in the order the events name them. */
  readonly accounts: readonly AccountId[];
  readonly files: readonly [StatementFile, StatementFile];
  readonly asOf: LocalDate;
}

/** The first day events fall on. The plan starts six days later, on 1 October 2026. */
const firstDay = localDate("2026-09-25");
const lastDayIndex = 13;
const dayAt = (index: number): LocalDate => addDays(firstDay, index);

const texts = ["Rema 1000", "Kiwi", "Automatisk sparing", "Overføring"] as const;
const amounts: readonly Money[] = [kr(-10), kr(-99), kr(-250), kr(250), kr(1_000)];
const knownNumbers = [numbers.everyday, numbers.savings, numbers.bills] as const;
const accountNumbers: readonly AccountNumber[] = [...knownNumbers, numbers.stranger];

/** How a file writes a description. The bank may change case and spacing between exports, and matching ignores both. */
function written(text: string, variant: number): string {
  if (variant === 1) return text.toUpperCase();
  if (variant === 2) return `  ${text.replace(" ", "   ")} `;
  return text;
}

const event = fc.record({
  account: fc.integer({ min: 0, max: 3 }),
  day: fc.integer({ min: 0, max: lastDayIndex }),
  amount: fc.constantFrom(...amounts),
  text: fc.constantFrom(...texts),
  pending: fc.boolean(),
  transferTo: fc.option(fc.integer({ min: 0, max: 2 }), { nil: null }),
  /** The two sides of the transfer sit in different banks, so each file holds one side. */
  otherBank: fc.boolean(),
  /** The second file books it a day later, as a bank can when it settles a card payment. */
  laterInSecond: fc.constantFrom(false, false, false, true),
  variants: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 })),
});

const window = fc.record({ start: fc.integer({ min: 0, max: lastDayIndex }), width: fc.integer({ min: 2, max: lastDayIndex }) }).map(({ start, width }) => [start, Math.min(lastDayIndex, start + width)] as const);

const recipe = fc.record({
  events: fc.array(event, { minLength: 3, maxLength: 40 }),
  /** Repeat some events exactly, as Bulder repeats small automatic savings several times a day. */
  repeats: fc.array(fc.record({ of: fc.nat(), times: fc.integer({ min: 1, max: 3 }) }), { maxLength: 6 }),
  windows: fc.tuple(window, window),
  /** Transactions the family recorded by hand, each a copy of an event, on its day or a day either side. */
  byHand: fc.array(fc.record({ of: fc.nat(), shift: fc.constantFrom(0, 0, 1, -1) }), { maxLength: 4 }),
  /** Moves at the bank still to do, each for the accounts and amount of an event. */
  moves: fc.array(fc.nat(), { maxLength: 3 }),
  rule: fc.boolean(),
});

type Event = typeof event extends fc.Arbitrary<infer E> ? E : never;

function isTransfer(e: Event): e is Event & { readonly transferTo: number } {
  return e.transferTo !== null && e.transferTo !== e.account;
}

function rowsOf(e: Event, file: 0 | 1, pending: boolean): Omit<StatementRow, "line">[] {
  const description = written(e.text, e.variants[file]);
  const base = { bookingDate: dayAt(file === 1 && e.laterInSecond ? e.day + 1 : e.day), description, counterparty: e.text, pending };
  const from = accountNumbers[e.account] ?? numbers.stranger;
  if (!isTransfer(e)) return [{ ...base, account: from, amount: e.amount }];
  const size = money(Math.abs(e.amount));
  const outgoing = { ...base, account: from, amount: money(-size) };
  const incoming = { ...base, account: knownNumbers[e.transferTo] ?? numbers.everyday, amount: size };
  if (e.otherBank) return [file === 0 ? outgoing : incoming];
  return [outgoing, incoming];
}

export function arbitraryImportScenario(): fc.Arbitrary<ImportScenario> {
  return recipe.map((r) => {
    const h = importHousehold();
    const accounts = [h.accounts.everyday, h.accounts.savings, h.accounts.bills];
    const accountAt = (i: number): AccountId => accounts[i] ?? h.accounts.everyday;
    const eventAt = (n: number): Event | undefined => r.events[n % r.events.length];
    for (const copy of r.byHand) {
      const e = eventAt(copy.of);
      if (e === undefined || e.account > 2) continue;
      const date = dayAt(Math.max(0, e.day + copy.shift));
      const spec = { accountId: accountAt(e.account), date, amount: isTransfer(e) ? money(-Math.abs(e.amount)) : e.amount, description: e.text };
      if (date < "2026-10-01") h.builder.history(spec);
      else h.builder.needsYou(spec);
    }
    for (const n of r.moves) {
      const e = eventAt(n);
      if (e !== undefined && isTransfer(e) && e.account <= 2) h.builder.move({ from: accountAt(e.account), to: accountAt(e.transferTo), amount: money(Math.abs(e.amount)), month: "2026-10" });
    }
    const built = h.facts();
    const facts: Facts = r.rule
      ? {
          ...built,
          rules: new Map([[ruleId(testId(90_000)), { id: ruleId(testId(90_000)), match: { counterparty: "rema 1000" }, result: { kind: "job", jobId: h.jobs.food }, origin: "set", priority: 1 }]]),
        }
      : built;

    const events: Event[] = [...r.events];
    for (const repeat of r.repeats) {
      const original = eventAt(repeat.of);
      if (original !== undefined) for (let i = 0; i < repeat.times; i++) events.push(original);
    }
    const ordered = events.map((e, index) => ({ e, index })).sort((a, b) => a.e.day - b.e.day || a.index - b.index);

    const file = (n: 0 | 1): StatementFile => {
      const [start, end] = r.windows[n];
      const rows = ordered.filter(({ e }) => e.day >= start && e.day <= end).flatMap(({ e }) => rowsOf(e, n, e.pending && e.day === end));
      return { format: "test-csv", accountCurrency: NOK, rows: rows.map((row, i) => ({ ...row, line: i + 2 })) };
    };
    return { facts, accounts, files: [file(0), file(1)], asOf: localDate("2026-11-09") };
  });
}
