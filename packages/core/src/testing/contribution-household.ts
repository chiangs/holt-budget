/**
 * A household for the tests of contributions, with money that can be checked by hand. The plan starts in
 * January 2026 and today is 10 November 2026. Robin pays 20,000 kr into Everyday on the 15th and Sam pays
 * 10,000 kr on the 25th, both from the start of the plan. So December's money is expected on 15 and 25
 * November, and an `asOf` of 18 November is the third day of Robin's grace.
 *
 * `arbitraryContributions` builds households of agreements and payments of every shape, for the properties.
 */

import fc from "fast-check";
import { type LocalDate, addDays, addMonths, localDate, month, monthOf } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { expectedDate } from "../figures/contributions.ts";
import { money } from "../money.ts";
import { factsBuilder, kr } from "./facts-builder.ts";

export function contributionHousehold() {
  const b = factsBuilder({ planStart: "2026-01" });
  const everyday = b.account({ name: "Everyday" });
  const regninger = b.account({ name: "Regninger", kind: "bills" });
  const robin = b.person({ name: "Robin" });
  const sam = b.person({ name: "Sam" });
  const robinPays = b.agreement({ person: robin, accountId: everyday, amount: kr(20_000), day: 15, from: "2026-01" });
  const samPays = b.agreement({ person: sam, accountId: everyday, amount: kr(10_000), day: 25, from: "2026-01" });
  return { b, accounts: { everyday, regninger }, people: { robin, sam }, agreements: { robin: robinPays, sam: samPays } };
}

export const planStart = month("2026-01");

export interface ContributionWorld {
  readonly facts: Facts;
  readonly asOf: LocalDate;
}

const names = ["Robin", "Sam", "Robin", "Kit"] as const;

const agreementSpec = fc.record({
  person: fc.integer({ min: 0, max: names.length - 1 }),
  amount: fc.integer({ min: 2, max: 5_000_000 }),
  day: fc.integer({ min: 1, max: 28 }),
  from: fc.integer({ min: 0, max: 10 }),
  length: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
});

const amountKinds = ["whole", "whole", "whole", "plusOne", "minusOne", "half", "rest", "double", "tiny", "refund"] as const;

const paymentSpec = fc.record({
  /** The agreement it names (wrapping), or null for a contribution nobody linked. */
  link: fc.option(fc.nat(), { nil: null }),
  /** The agreement whose schedule and amount it is shaped after. */
  shape: fc.nat(),
  source: fc.constantFrom("contribution", "contribution", "contribution", "contribution", "recurring", "other"),
  /** The month it funds, counted from the current month. */
  funds: fc.integer({ min: -3, max: 3 }),
  /** Days from the day the money is expected to the day it is booked. */
  offset: fc.integer({ min: -6, max: 12 }),
  kind: fc.constantFrom(...amountKinds),
});

/**
 * Agreements and payments around the dates the agreements expect them, and an `asOf` among them. Payments
 * sit on the edges: exactly the amount, a cent either side, half and the other half, double, a few cents,
 * and a refund when `refunds` is set. Some are linked to an agreement and some are not.
 */
export function arbitraryContributions(options: { readonly refunds?: boolean } = {}): fc.Arbitrary<ContributionWorld> {
  const refunds = options.refunds ?? false;
  return fc
    .record({
      agreements: fc.array(agreementSpec, { minLength: 1, maxLength: 4 }),
      payments: fc.array(paymentSpec, { maxLength: 16 }),
      asOf: fc.integer({ min: 40, max: 420 }),
    })
    .map(({ agreements, payments, asOf: days }) => {
      const asOf = addDays(localDate("2026-01-01"), days);
      const current = monthOf(asOf);
      const b = factsBuilder({ planStart: "2026-01" });
      const everyday = b.account({ name: "Everyday" });
      const regninger = b.account({ name: "Regninger", kind: "bills" });
      const people = names.map((name) => b.person({ name }));
      const rows = agreements.map((a) => ({
        spec: a,
        id: b.agreement({
          person: people[a.person] as (typeof people)[number],
          accountId: a.amount % 2 === 0 ? everyday : regninger,
          amount: money(a.amount),
          day: a.day,
          from: addMonths(planStart, a.from),
          ...(a.length === null ? {} : { to: addMonths(planStart, a.from + a.length) }),
        }),
      }));
      for (const payment of payments) {
        const shaped = rows[payment.shape % rows.length] as (typeof rows)[number];
        const whole = shaped.spec.amount;
        const amount = {
          whole,
          plusOne: whole + 1,
          minusOne: whole - 1,
          half: Math.floor(whole / 2),
          rest: whole - Math.floor(whole / 2),
          double: whole * 2,
          tiny: 1,
          refund: refunds ? -Math.max(1, Math.floor(whole / 10)) : whole,
        }[payment.kind];
        const fundsMonth = addMonths(current, payment.funds);
        const linked = payment.link === null ? undefined : (rows[payment.link % rows.length] as (typeof rows)[number]).id;
        b.income({
          date: addDays(expectedDate({ day: shaped.spec.day }, fundsMonth), payment.offset),
          amount: money(amount),
          fundsMonth,
          source: payment.source,
          ...(linked === undefined ? {} : { agreement: linked }),
        });
      }
      return { facts: b.facts(), asOf };
    });
}
