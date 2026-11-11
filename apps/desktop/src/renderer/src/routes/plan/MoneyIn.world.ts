/**
 * A small invented household for the Money in and Moves tests. November 2026 is the current month and today is
 * the 10th, so the money that funds November arrived in October. Two adults pay 32,000 kr and 28,000 kr into
 * Everyday on the 20th, from October, and a child has no agreement. The tests read the real statuses and moves
 * from it, so what they check is what core gives. Every name and amount is made up.
 */

import { type AccountId, type AgreementId, type Facts, type Figures, type JobId, type LocalDate, type PersonId, type TransactionId, computeFigures, localDate } from "@holt/core";
import { type FactsBuilder, factsBuilder, kr, setAmount } from "@holt/core/testing";

export const today: LocalDate = localDate("2026-11-10");

export interface MoneyWorld {
  readonly b: FactsBuilder;
  readonly accounts: { readonly everyday: AccountId; readonly bills: AccountId; readonly deposit: AccountId };
  readonly people: { readonly stephen: PersonId; readonly partner: PersonId; readonly eldest: PersonId };
  readonly agreements: { readonly stephen: AgreementId; readonly partner: AgreementId };
  readonly jobs: { readonly mortgage: JobId; readonly buffer: JobId };
  /** The payments of November's money, linked to the agreements. */
  readonly payments: { readonly stephen: TransactionId; readonly partnerFirst: TransactionId; readonly partnerSecond: TransactionId };
}

export interface BuiltMoneyWorld extends MoneyWorld {
  readonly facts: Facts;
  readonly figures: Figures;
}

export interface WorldOptions {
  /** The day the screen is read, which decides whether a payment still expected is late. */
  readonly asOf?: string;
  /** Leave out what November's money arrived as, so the tests can add their own payments. */
  readonly noNovemberPayments?: boolean;
}

/** The world with the adults' contributions linked as November's income, plus whatever `extend` adds before the facts are taken. */
export function moneyWorld(extend: (world: MoneyWorld) => void = () => undefined, options: WorldOptions = {}): BuiltMoneyWorld {
  const b = factsBuilder({ planStart: "2026-10" });
  const everyday = b.account({ name: "Everyday", openingBalance: kr(20_000), openingDate: "2026-09-30" });
  const bills = b.account({ name: "Bills", kind: "bills", openingBalance: kr(0), openingDate: "2026-09-30" });
  const deposit = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(30_000), openingDate: "2026-09-30" });
  const fixed = b.group({ name: "Fixed costs" });
  const saving = b.group({ name: "Saving", countsTowardsSavingsRate: true });
  const mortgage = b.spendJob({ name: "Mortgage", groupId: fixed, accountId: bills, plan: setAmount(kr(15_000)), essential: true });
  const buffer = b.buffer({ name: "Buffer", groupId: saving, accountId: deposit, monthly: kr(3_000), opening: kr(30_000) });

  const stephen = b.person({ name: "Stephen" });
  const partner = b.person({ name: "Partner" });
  const eldest = b.person({ name: "Eldest", kind: "child", birthMonth: "2012-03" });
  const stephenPays = b.agreement({ person: stephen, accountId: everyday, amount: kr(32_000), day: 20, from: "2026-10" });
  const partnerPays = b.agreement({ person: partner, accountId: everyday, amount: kr(28_000), day: 20, from: "2026-10" });

  b.budgetMonth("2026-10", "closed");
  b.assign("2026-10", mortgage, kr(15_000));
  b.assign("2026-10", buffer, kr(3_000));
  b.budgetMonth("2026-11", "open");
  b.assign("2026-11", mortgage, kr(15_000));
  b.assign("2026-11", buffer, kr(3_000));

  b.income({ date: "2026-09-20", amount: kr(32_000), accountId: everyday, fundsMonth: "2026-10", agreement: stephenPays });
  b.income({ date: "2026-09-20", amount: kr(28_000), accountId: everyday, fundsMonth: "2026-10", agreement: partnerPays });
  const none = options.noNovemberPayments === true;
  const paid = (date: string, amount: number, agreement: AgreementId): TransactionId =>
    none ? ("" as TransactionId) : b.income({ date, amount: kr(amount), accountId: everyday, fundsMonth: "2026-11", agreement });
  const payments = {
    stephen: paid("2026-10-20", 32_000, stephenPays),
    partnerFirst: paid("2026-10-20", 20_000, partnerPays),
    partnerSecond: paid("2026-10-22", 8_000, partnerPays),
  };

  const world: MoneyWorld = {
    b,
    accounts: { everyday, bills, deposit },
    people: { stephen, partner, eldest },
    agreements: { stephen: stephenPays, partner: partnerPays },
    jobs: { mortgage, buffer },
    payments,
  };
  extend(world);
  const facts = b.facts();
  return { ...world, facts, figures: computeFigures(facts, localDate(options.asOf ?? today)) };
}

/** The same facts read on another day, for the tests of a status that depends on how long ago it was expected. */
export function readOn(facts: Facts, asOf: string): Figures {
  return computeFigures(facts, localDate(asOf));
}
