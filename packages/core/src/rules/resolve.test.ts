import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { treatmentFor } from "../commands/transactions.ts";
import type { Rule, RuleResult, RuleShare } from "../facts.ts";
import { type JobId, accountId, jobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { type RuleProbe, resolveRule, splitByWeights, treatmentOfRule } from "./resolve.ts";
import { ruleOf } from "./rule-fixtures.ts";

const everyday = accountId(testId(1));
const savings = accountId(testId(2));
const food = jobId(testId(11));
const eatingOut = jobId(testId(12));
const car = jobId(testId(13));
const toFood: RuleResult = { kind: "job", jobId: food };

const probe = (counterparty: string | undefined, amount: Money, account = everyday): RuleProbe => ({ accountId: account, counterparty, amount });

describe("resolveRule", () => {
  it("matches the counterparty ignoring case and the whitespace around it", () => {
    const rule = ruleOf({ n: 1, counterparty: "Kiwi", result: toFood });
    for (const name of ["Kiwi", "KIWI", "kiwi", "  Kiwi  ", "\tkIwI\n"]) expect(resolveRule([rule], probe(name, kr(-100)))).toBe(rule);
    for (const name of ["Kiwi 123", "Kiw", "Ki wi", "Rema 1000"]) expect(resolveRule([rule], probe(name, kr(-100)))).toBeNull();
  });

  it("matches a rule written with different case or spacing than the transaction", () => {
    const rule = ruleOf({ n: 1, counterparty: "  ÆØÅ Bakeri ", result: toFood });
    expect(resolveRule([rule], probe("æøå bakeri", kr(-100)))).toBe(rule);
  });

  it("never matches a transaction that has no counterparty", () => {
    expect(resolveRule([ruleOf({ n: 1, counterparty: "Kiwi", result: toFood })], probe(undefined, kr(-100)))).toBeNull();
  });

  it("applies a rule only to its account when it names one", () => {
    const rule = ruleOf({ n: 1, counterparty: "Kiwi", accountId: everyday, result: toFood });
    expect(resolveRule([rule], probe("Kiwi", kr(-100), everyday))).toBe(rule);
    expect(resolveRule([rule], probe("Kiwi", kr(-100), savings))).toBeNull();
  });

  it("includes both ends of the amount range, on the signed amount", () => {
    const rule = ruleOf({ n: 1, counterparty: "Kiwi", min: kr(-500), max: kr(-100), result: toFood });
    for (const amount of [kr(-500), kr(-300), kr(-100)]) expect(resolveRule([rule], probe("Kiwi", amount))).toBe(rule);
    for (const amount of [money(kr(-500) - 1), money(kr(-100) + 1), kr(0), kr(100)]) expect(resolveRule([rule], probe("Kiwi", amount))).toBeNull();
  });

  it("lets a rule for a purchase leave a refund from the same shop alone (decision 9)", () => {
    const purchase = ruleOf({ n: 1, counterparty: "Kiwi", max: kr(-1), result: toFood });
    expect(resolveRule([purchase], probe("Kiwi", kr(-250)))).toBe(purchase);
    expect(resolveRule([purchase], probe("Kiwi", kr(250)))).toBeNull();
  });

  it("takes a bound on one side only", () => {
    const atLeast = ruleOf({ n: 1, counterparty: "Vy", min: kr(-100), result: toFood });
    const atMost = ruleOf({ n: 2, counterparty: "Vy", max: kr(-100), result: toFood });
    expect(resolveRule([atLeast], probe("Vy", kr(5_000)))).toBe(atLeast);
    expect(resolveRule([atLeast], probe("Vy", kr(-101)))).toBeNull();
    expect(resolveRule([atMost], probe("Vy", kr(-5_000)))).toBe(atMost);
    expect(resolveRule([atMost], probe("Vy", kr(-99)))).toBeNull();
  });

  it("gives the highest priority rule, whichever is listed first", () => {
    const low = ruleOf({ n: 1, counterparty: "Kiwi", priority: 1, result: toFood });
    const high = ruleOf({ n: 2, counterparty: "Kiwi", priority: 5, result: { kind: "job", jobId: eatingOut } });
    expect(resolveRule([low, high], probe("Kiwi", kr(-1)))).toBe(high);
    expect(resolveRule([high, low], probe("Kiwi", kr(-1)))).toBe(high);
  });

  it("breaks a tie by the smaller ID, whichever is listed first", () => {
    const first = ruleOf({ n: 1, counterparty: "Kiwi", priority: 3, result: toFood });
    const second = ruleOf({ n: 2, counterparty: "Kiwi", priority: 3, result: { kind: "job", jobId: eatingOut } });
    expect(resolveRule([second, first], probe("Kiwi", kr(-1)))).toBe(first);
    expect(resolveRule([first, second], probe("Kiwi", kr(-1)))).toBe(first);
  });

  it("does not let a higher priority rule that doesn't match win", () => {
    const wrongAccount = ruleOf({ n: 1, counterparty: "Kiwi", accountId: savings, priority: 9, result: toFood });
    const applies = ruleOf({ n: 2, counterparty: "Kiwi", priority: 1, result: toFood });
    expect(resolveRule([wrongAccount, applies], probe("Kiwi", kr(-1)))).toBe(applies);
  });

  it("finds nothing when there are no rules", () => {
    expect(resolveRule([], probe("Kiwi", kr(-1)))).toBeNull();
  });

  describe("on generated rules", () => {
    const names = ["Kiwi", "kiwi", " KIWI ", "Rema 1000", "rema 1000", "Vy", "Coop Extra", "coop extra "];
    const amounts = fc.integer({ min: -100_000, max: 100_000 }).map(money);
    const ruleArbitrary = (n: number): fc.Arbitrary<Rule> =>
      fc
        .record({
          counterparty: fc.constantFrom(...names),
          accountId: fc.option(fc.constantFrom(everyday, savings), { nil: undefined }),
          bounds: fc.option(fc.tuple(amounts, amounts), { nil: undefined }),
          priority: fc.integer({ min: 0, max: 3 }),
        })
        .map(({ counterparty, accountId: account, bounds, priority }) => {
          const [min, max] = bounds === undefined ? [undefined, undefined] : bounds[0] <= bounds[1] ? bounds : [bounds[1], bounds[0]];
          return ruleOf({ n, counterparty, priority, result: toFood, ...(account === undefined ? {} : { accountId: account }), ...(min === undefined || max === undefined ? {} : { min, max }) });
        });
    const rulesArbitrary = fc.integer({ min: 0, max: 8 }).chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => ruleArbitrary(i + 1))));
    const probeArbitrary = fc.record({ accountId: fc.constantFrom(everyday, savings), counterparty: fc.option(fc.constantFrom(...names, "Other"), { nil: undefined }), amount: amounts });

    const fieldsHold = (rule: Rule, p: RuleProbe): boolean =>
      p.counterparty !== undefined &&
      rule.match.counterparty.trim().toLowerCase() === p.counterparty.trim().toLowerCase() &&
      (rule.match.accountId === undefined || rule.match.accountId === p.accountId) &&
      (rule.match.min === undefined || p.amount >= rule.match.min) &&
      (rule.match.max === undefined || p.amount <= rule.match.max);

    it("gives a rule whose every field holds, that nothing matching beats on priority or ID", () => {
      fc.assert(
        fc.property(rulesArbitrary, probeArbitrary, (rules, p) => {
          const matching = rules.filter((r) => fieldsHold(r, p));
          const winner = resolveRule(rules, p);
          if (matching.length === 0) {
            expect(winner).toBeNull();
            return;
          }
          expect(winner).not.toBeNull();
          expect(matching).toContain(winner);
          for (const other of matching) {
            expect(other.priority <= (winner as Rule).priority).toBe(true);
            if (other.priority === (winner as Rule).priority) expect(other.id >= (winner as Rule).id).toBe(true);
          }
        }),
      );
    });

    it("is a function of its inputs, whatever order the rules are held in", () => {
      fc.assert(
        fc.property(
          rulesArbitrary.chain((rules) => fc.record({ rules: fc.constant(rules), shuffled: fc.shuffledSubarray(rules, { minLength: rules.length, maxLength: rules.length }) })),
          probeArbitrary,
          ({ rules, shuffled }, p) => {
            expect(resolveRule(shuffled, p)).toBe(resolveRule(rules, p));
            expect(resolveRule(new Map(shuffled.map((r) => [r.id, r])).values(), p)).toBe(resolveRule(rules, p));
            expect(resolveRule(rules, p)).toBe(resolveRule(rules, p));
          },
        ),
      );
    });
  });
});

const sharesOf = (shares: readonly (readonly [JobId, number])[]): [RuleShare, ...RuleShare[]] => {
  const [first, ...rest] = shares.map(([job, weight]) => ({ jobId: job, weight }));
  if (first === undefined) throw new Error("A split needs a share");
  return [first, ...rest];
};

const splitOf = (shares: readonly (readonly [JobId, number])[]): RuleResult => ({ kind: "split", shares: sharesOf(shares) });

const allocationsOf = (result: RuleResult, amount: Money): number[] => {
  const treatment = treatmentOfRule(ruleOf({ n: 1, counterparty: "x", result }), amount);
  if (treatment.kind !== "split") throw new Error(`A rule gave ${treatment.kind}`);
  return treatment.allocations.map((a) => a.amount);
};

describe("treatmentOfRule", () => {
  it("gives the whole amount to the one job, with its sign", () => {
    expect(allocationsOf(toFood, kr(-250))).toEqual([kr(-250)]);
    expect(allocationsOf(toFood, kr(80))).toEqual([kr(80)]);
    const treatment = treatmentOfRule(ruleOf({ n: 1, counterparty: "x", result: toFood }), kr(-250));
    expect(treatment).toEqual({ kind: "split", allocations: [{ jobId: food, amount: kr(-250) }] });
  });

  it("splits by weights and gives the units left over to the largest remainders", () => {
    const twoToOne = splitOf([[food, 2], [eatingOut, 1]]);
    expect(allocationsOf(twoToOne, money(100))).toEqual([67, 33]);
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 2]]), money(100))).toEqual([33, 67]);
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 1], [car, 1]]), money(100))).toEqual([34, 33, 33]);
  });

  it("gives the remainder to the first share when remainders tie", () => {
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 1]]), money(101))).toEqual([51, 50]);
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 1], [car, 1]]), money(101))).toEqual([34, 34, 33]);
    expect(allocationsOf(splitOf([[food, 3], [eatingOut, 3]]), money(7))).toEqual([4, 3]);
  });

  it("carries the sign of the amount through", () => {
    expect(allocationsOf(splitOf([[food, 2], [eatingOut, 1]]), money(-100))).toEqual([-67, -33]);
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 1]]), money(-101))).toEqual([-51, -50]);
  });

  it("gives zeros, never negative zero, for an amount of zero", () => {
    for (const part of allocationsOf(splitOf([[food, 1], [eatingOut, 2]]), money(0))) expect(Object.is(part, 0)).toBe(true);
    for (const part of allocationsOf(splitOf([[food, 1], [eatingOut, 2]]), money(-1))) expect(Object.is(part, -0)).toBe(false);
  });

  it("can give a share nothing when the amount is too small to divide", () => {
    expect(allocationsOf(splitOf([[food, 1], [eatingOut, 1], [car, 1]]), money(-1))).toEqual([-1, 0, 0]);
  });

  describe("on generated rules", () => {
    const shareArbitrary = fc.integer({ min: 1, max: 1_000_000_000 });
    const sharesArbitrary = fc.array(fc.tuple(fc.constantFrom(food, eatingOut, car), shareArbitrary), { minLength: 1, maxLength: 5 });
    const wholeAmounts = fc.oneof(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })).map(money);

    it("always gives allocations that add up to the amount exactly, so a split can be built (rule 3)", () => {
      fc.assert(
        fc.property(sharesArbitrary, wholeAmounts, (shares, amount) => {
          const rule = ruleOf({ n: 1, counterparty: "x", result: splitOf(shares) });
          const treatment = treatmentOfRule(rule, amount);
          if (treatment.kind !== "split") throw new Error("not a split");
          expect(treatment.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(amount);
          expect(treatmentFor(treatment, amount)).not.toBeNull();
        }),
      );
    });

    it("gives each share its job, in order, with the amount's sign, within one unit of its exact share", () => {
      fc.assert(
        fc.property(sharesArbitrary, wholeAmounts, (shares, amount) => {
          const parts = splitByWeights(amount, sharesOf(shares));
          expect(parts.map((p) => p.jobId)).toEqual(shares.map(([job]) => job));
          const total = shares.reduce((sum, [, w]) => sum + BigInt(w), 0n);
          parts.forEach((part, i) => {
            const weight = BigInt(shares[i]?.[1] ?? 0);
            expect(part.amount === 0 || Math.sign(part.amount) === Math.sign(amount)).toBe(true);
            expect(Object.is(part.amount, -0)).toBe(false);
            const exact = BigInt(Math.abs(amount)) * weight;
            const difference = BigInt(Math.abs(part.amount)) * total - exact;
            expect(difference > -total && difference < total).toBe(true);
          });
        }),
      );
    });

    it("never produces income or a transfer (decision 0047, item 10)", () => {
      fc.assert(
        fc.property(sharesArbitrary, wholeAmounts, fc.boolean(), (shares, amount, single) => {
          const result = single ? toFood : splitOf(shares);
          expect(treatmentOfRule(ruleOf({ n: 1, counterparty: "x", result }), amount).kind).toBe("split");
        }),
      );
    });

    it("gives the same allocations however many times it runs", () => {
      fc.assert(
        fc.property(sharesArbitrary, wholeAmounts, (shares, amount) => {
          const rule = ruleOf({ n: 1, counterparty: "x", result: splitOf(shares) });
          expect(treatmentOfRule(rule, amount)).toEqual(treatmentOfRule(rule, amount));
        }),
      );
    });
  });
});
