/**
 * The family's first import at the real size: one bank file of thousands of rows over nine accounts, with
 * transfers between the household's accounts that appear on both sides, small automatic savings that repeat
 * several times a day, and card purchases. Every name, number and amount is invented, and the same spec
 * always gives the same file. The plan starts in the first month of the file, so nothing is history and
 * every row can pair or wait in needs you, which is the most work an import can ask of the plan.
 */

import { type AccountNumber, accountNumber } from "../account-number.ts";
import { addDays, localDate } from "../dates.ts";
import type { Facts, Rule } from "../facts.ts";
import { type AccountId, type RuleId, ruleId } from "../ids.ts";
import type { ImportInput, TypedBalance } from "../import/plan.ts";
import type { StatementFile, StatementRow } from "../import/statement.ts";
import { money } from "../money.ts";
import { NOK, factsBuilder, kr, setAmount, testId } from "./facts-builder.ts";
import { countingIds, today, withAccountNumbers } from "./synthetic-statement.ts";

export interface FirstImportSpec {
  /** Rows in the file. */
  readonly rows: number;
  /** Transfers with a distinct amount, so each has exactly one other side and import pairs it. Each is two rows. */
  readonly pairs: number;
  /** Groups of identical rows, sized 2, 3 and 4 in turn. Two thirds are automatic savings transfers, whose sides stay ambiguous and wait in needs you. */
  readonly repeatGroups: number;
  /** The first booking day. */
  readonly from?: string;
  /** How many days the file covers. */
  readonly days?: number;
}

export const bulderLikeSize: FirstImportSpec = { rows: 9_000, pairs: 1_700, repeatGroups: 135 };

const accountCount = 9;
const shopNames = Array.from({ length: 40 }, (_, i) => `Butikk ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`);

export interface FirstImport {
  readonly facts: Facts;
  readonly file: StatementFile;
  readonly accounts: readonly AccountId[];
  /** A balance typed for each account, so the plan checks each one. */
  readonly balances: readonly TypedBalance[];
  readonly spec: Required<FirstImportSpec>;
  /** Input for `planImport`. IDs count up from `firstId`, so the same call gives the same IDs. */
  input(firstId?: number): ImportInput;
}

export function firstImport(options: FirstImportSpec): FirstImport {
  const spec = { from: "2026-01-01", days: 300, ...options };
  const start = localDate(spec.from);
  const b = factsBuilder({ planStart: spec.from.slice(0, 7) });
  const accounts: AccountId[] = [];
  const numbers: AccountNumber[] = [];
  for (let i = 0; i < accountCount; i++) {
    accounts.push(b.account({ name: `Konto ${i + 1}`, kind: i === 0 ? "everyday" : "savings", openingBalance: kr(10_000), openingDate: "2025-12-31" }));
    numbers.push(accountNumber(`9701.11.${String(10_001 + i).padStart(5, "0")}`));
  }
  b.group({ name: "Living" });
  b.buffer({ monthly: kr(1_000), accountId: accounts[1] as AccountId });
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(6_000)), accountId: accounts[0] as AccountId });
  const built = b.facts();
  const rules = new Map<RuleId, Rule>(
    shopNames.slice(0, 6).map((shop, i) => {
      const id = ruleId(testId(80_000 + i));
      return [id, { id, match: { counterparty: shop.toLowerCase() }, result: { kind: "job", jobId: food }, origin: "set", priority: 1 }];
    }),
  );
  const facts: Facts = withAccountNumbers({ ...built, rules }, new Map(accounts.map((id, i) => [id, numbers[i] as AccountNumber])));

  const numberOf = (i: number): AccountNumber => numbers[i % accountCount] as AccountNumber;
  const dayOf = (k: number, total: number) => addDays(start, Math.floor((k * spec.days) / Math.max(1, total)));
  type Draft = Omit<StatementRow, "line">;
  const drafts: Draft[] = [];

  for (let k = 0; k < spec.pairs; k++) {
    const from = k % accountCount;
    const to = (from + 1 + ((k >> 3) % (accountCount - 1))) % accountCount;
    const size = 1_000 + k * 13;
    const date = dayOf(k, spec.pairs);
    const common = { bookingDate: date, description: `Overføring ${k}`, counterparty: "Overføring", bankType: "Overføring", pending: false };
    drafts.push({ ...common, account: numberOf(from), amount: money(-size), counterpartAccount: numberOf(to) });
    drafts.push({ ...common, account: numberOf(to), amount: money(size), counterpartAccount: numberOf(from) });
  }

  let repeated = 0;
  for (let g = 0; g < spec.repeatGroups; g++) {
    const copies = 2 + (g % 3);
    const date = dayOf(g, spec.repeatGroups);
    const size = 500_000 + g * 17;
    if (g % 3 === 2) {
      const row: Draft = { bookingDate: date, description: `Kaffe ${g}`, counterparty: "Kaffebaren", bankType: "Betaling", pending: false, account: numberOf(g), amount: money(-size) };
      for (let i = 0; i < copies; i++) drafts.push(row);
      repeated += copies;
    } else {
      const from = g % accountCount;
      const to = (from + 1) % accountCount;
      const common = { bookingDate: date, description: "Automatisk sparing", counterparty: "Automatisk sparing", bankType: "Overføring", pending: false };
      for (let i = 0; i < copies; i++) {
        drafts.push({ ...common, account: numberOf(from), amount: money(-size), counterpartAccount: numberOf(to) });
        drafts.push({ ...common, account: numberOf(to), amount: money(size), counterpartAccount: numberOf(from) });
      }
      repeated += 2 * copies;
    }
  }

  const singles = spec.rows - 2 * spec.pairs - repeated;
  if (singles < 0) throw new Error(`A file of ${spec.rows} rows can't hold ${spec.pairs} pairs and ${spec.repeatGroups} repeat groups.`);
  for (let i = 0; i < singles; i++) {
    const date = dayOf(i, singles);
    const income = i % 40 === 39;
    const shop = shopNames[i % shopNames.length] as string;
    drafts.push({
      bookingDate: date,
      description: income ? `Lønn ${i}` : `${shop} ${i}`,
      counterparty: income ? "Eksempel AS" : shop,
      bankType: income ? "Inntekt" : "Betaling",
      reference: String(4_000_000 + i),
      pending: false,
      account: numberOf(i),
      amount: money(income ? 3_000_000 + i : -(3_000 + i * 37)),
    });
  }

  const ordered = drafts.map((row, index) => ({ row, index })).sort((x, y) => (x.row.bookingDate < y.row.bookingDate ? -1 : x.row.bookingDate > y.row.bookingDate ? 1 : x.index - y.index));
  const file: StatementFile = { format: "bulder-csv", accountCurrency: NOK, rows: ordered.map(({ row }, i) => ({ ...row, line: i + 2 })) };
  const balances = accounts.map((accountId): TypedBalance => ({ accountId, value: kr(1), asOf: today }));
  return {
    facts,
    file,
    accounts,
    balances,
    spec,
    input: (firstId = 1_000_000) => ({ fileName: "first-import.csv", fingerprint: (spec.rows * 100_000 + spec.pairs).toString(16).padStart(64, "0"), importedAt: "2026-11-09T10:00:00Z", balances, asOf: today, ids: countingIds(firstId) }),
  };
}
