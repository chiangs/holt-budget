import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, apply } from "../commands/apply.ts";
import { type LocalDate, type Month, addMonths, monthRange } from "../dates.ts";
import { evenedMonthlyAmount } from "../even-out.ts";
import type { Facts } from "../facts.ts";
import { bucketTransferId, moveId } from "../ids.ts";
import type { Money } from "../money.ts";
import { testId } from "../testing/facts-builder.ts";
import { type VariableCostCase, arbitraryVariableCost } from "../testing/variable-cost-household.ts";
import { type EvenOutStartOffer, type EvenedOutOffer, evenOutOffer, startNowCommands } from "./even-out-offer.ts";
import { type JobForecast, forecastMonths, jobForecast } from "./forecast.ts";
import { computeFigures } from "./index.ts";
import { jobEstimate } from "./job-estimate.ts";

const runs = { numRuns: 400 };

function suppliers() {
  let n = 5_000;
  return { transfer: () => bucketTransferId(testId(n++)), move: () => moveId(testId(n++)) };
}

const applied = (facts: Facts, asOf: LocalDate, command: Command): Facts => {
  const result = apply(facts, command, { asOf });
  if (!result.ok) throw new Error(`Refused (${result.refusal.code}): ${result.refusal.message}`);
  return result.facts;
};

function offerOf(c: VariableCostCase) {
  return evenOutOffer(c.facts, c.job, c.asOf);
}

/** The offers to start, with the household each came from. */
function starts(c: VariableCostCase): EvenOutStartOffer | null {
  const offer = offerOf(c);
  return offer?.kind === "start" ? offer : null;
}

function evened(c: VariableCostCase): EvenedOutOffer | null {
  const offer = offerOf(c);
  return offer?.kind === "evenedOut" ? offer : null;
}

/**
 * The forecast after evening out from the month at `index`, worked out by running core's own commands: the plan,
 * then each open month's assignment (the estimate before the start, the monthly amount from it).
 * It shares no code with the offer, so the two agree only if both are right.
 */
function forecastAfterEvenOutFrom(c: VariableCostCase, monthly: Money, index: number): JobForecast {
  const figures = computeFigures(c.facts, c.asOf, { horizonMonths: forecastMonths - 1 }).jobs.get(c.job);
  const months = monthRange(c.current, addMonths(c.current, forecastMonths - 1));
  const startMonth = months[index] as Month;
  const commands: Command[] = [{ kind: "changeJob", jobId: c.job, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly, startMonth } } } }];
  months.forEach((m, i) => {
    const state = c.facts.budgetMonths.get(m)?.state;
    if (state !== "open" && state !== "reopened") return;
    const cost = figures?.months.get(m)?.cost;
    const estimate = cost?.kind === "estimate" ? cost.estimate.amount : 0;
    commands.push({ kind: "assign", month: m, jobId: c.job, amount: (i < index ? estimate : monthly) as Money });
  });
  const forecast = jobForecast(applied(c.facts, c.asOf, { kind: "batch", commands }), c.job, c.asOf);
  if (forecast === null) throw new Error("An evened-out job keeps its money");
  return forecast;
}

describe("the random households reach every kind of offer", () => {
  it("offers seeds and none, a later start, each reason the seed is blocked, and each kind of proposal", () => {
    const seen = { seed: 0, noSeed: 0, later: 0, monthNotStarted: 0, bufferHoldsLess: 0, noBuffer: 0, source: 0, evenedOut: 0, proposal: 0, dryWithoutProposal: 0, closedMonth: 0 };
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const start = starts(c);
        if (start !== null) {
          if (start.startNow.seed > 0) seen.seed += 1;
          else seen.noSeed += 1;
          if (start.startLater !== null) seen.later += 1;
          if (start.startNow.blockedBy !== null) seen[start.startNow.blockedBy] += 1;
          if (start.startNow.source !== null) seen.source += 1;
          if (c.facts.budgetMonths.get(c.current)?.state === "closed") seen.closedMonth += 1;
        }
        const even = evened(c);
        if (even !== null) {
          seen.evenedOut += 1;
          if (even.proposal !== null) seen.proposal += 1;
          else if (even.forecast.runsDryIn !== null) seen.dryWithoutProposal += 1;
        }
      }),
      { numRuns: 1_500 },
    );
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThanOrEqual(4);
  });
});

describe("the seed to start now", () => {
  it("keeps the bucket at or above zero with one step to spare, and is the smallest seed in whole steps that does", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null) return;
        const { seed, forecast } = offer.startNow;
        const step = offer.step;
        expect(seed % step).toBe(0);
        expect(forecast.lowest.amount).toBeGreaterThanOrEqual(0);
        if (seed === 0) {
          expect(offer.withoutSeed.lowest.amount).toBeGreaterThanOrEqual(0);
        } else {
          expect(offer.withoutSeed.lowest.amount).toBeLessThan(0);
          expect(forecast.lowest.amount).toBeGreaterThanOrEqual(step);
          expect(forecast.lowest.amount).toBeLessThan(2 * step);
        }
      }),
      runs,
    );
  });

  it("changes every month's bucket by the seed and nothing else, and shows the seed as money moved in this month", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null) return;
        const { startNow, withoutSeed } = offer;
        startNow.forecast.months.forEach((row, i) => {
          const bare = withoutSeed.months[i];
          expect(row.bucketEnd - (bare?.bucketEnd ?? Number.NaN)).toBe(startNow.seed);
          expect(row.transfersIn - (bare?.transfersIn ?? Number.NaN)).toBe(i === 0 ? startNow.seed : 0);
          expect([row.planned, row.bill, row.estimate]).toEqual([bare?.planned, bare?.bill, bare?.estimate]);
        });
        expect(startNow.forecast.startsWith).toBe(withoutSeed.startsWith);
      }),
      runs,
    );
  });

  it("starts from the monthly amount the next twelve months' bills give, rounded up to the step", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        const estimate = jobEstimate(c.facts, c.job, c.asOf);
        if (offer === null || estimate === null) return;
        expect(offer.monthly).toBe(evenedMonthlyAmount(estimate.months.map((m) => m.bill), offer.step));
        expect(offer.withoutSeed.months.map((m) => m.bill)).toEqual(estimate.months.map((m) => m.bill));
      }),
      runs,
    );
  });

  it("agrees with the forecast after evening out from now, worked out through core's commands", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null) return;
        expect(forecastAfterEvenOutFrom(c, offer.monthly, 0)).toEqual(offer.withoutSeed);
      }),
      { numRuns: 150 },
    );
  });
});

describe("the commands that start now", () => {
  it("are accepted, and leave exactly the bucket path the offer shows, the move at the bank the offer names, and the buffer as the offer says", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null) return;
        const batch = startNowCommands(offer, { ids: suppliers(), reason: "Start evening out" });
        if (batch === null) {
          expect(offer.startNow.blockedBy).not.toBeNull();
          expect(offer.startNow.seed).toBeGreaterThan(0);
          return;
        }
        const after = applied(c.facts, c.asOf, batch);
        expect(jobForecast(after, c.job, c.asOf)).toEqual(offer.startNow.forecast);
        const { source, seed, bankMove, bufferAfter } = offer.startNow;
        expect(after.bucketTransfers.size - c.facts.bucketTransfers.size).toBe(source === null ? 0 : 1);
        expect(after.moves.size - c.facts.moves.size).toBe(bankMove === null ? 0 : 1);
        if (source === null) {
          expect(seed).toBe(0);
        } else {
          const buffer = computeFigures(after, c.asOf, { horizonMonths: 0 }).buffer;
          if (buffer.kind !== "buffer") throw new Error("The seed came from the buffer");
          expect([buffer.balance, buffer.runway]).toEqual([bufferAfter?.balance, bufferAfter?.runway]);
          expect(source.jobId).toBe(buffer.jobId);
        }
      }),
      runs,
    );
  });

  it("are withheld only when the app would refuse the seed's move: the month hasn't started, or the buffer holds less", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null || offer.startNow.blockedBy === null) return;
        expect(startNowCommands(offer, { ids: suppliers(), reason: "r" })).toBeNull();
        const buffer = computeFigures(c.facts, c.asOf, { horizonMonths: 0 }).buffer;
        if (offer.startNow.blockedBy === "noBuffer") {
          expect(buffer.kind).toBe("noBuffer");
          return;
        }
        if (buffer.kind !== "buffer") return;
        const seedMove: Command = { kind: "moveBucket", transfer: { id: bucketTransferId(testId(9_000)), month: c.current, from: buffer.jobId, to: c.job, amount: offer.startNow.seed, reason: "r" } };
        const switchPlan: Command = { kind: "changeJob", jobId: c.job, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly: offer.monthly, startMonth: c.current } } } };
        const result = apply(c.facts, { kind: "batch", commands: [switchPlan, seedMove] }, { asOf: c.asOf });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.refusal.code).toBe(offer.startNow.blockedBy === "monthNotStarted" ? "transferMonthNotStarted" : "bucketHoldsLess");
      }),
      runs,
    );
  });
});

describe("the commands that start later", () => {
  it("name the earliest month from which no seed is needed, and leave the bucket path the offer shows", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = starts(c);
        if (offer === null) return;
        if (offer.startNow.seed === 0) {
          expect(offer.startLater).toBeNull();
          return;
        }
        const months = monthRange(c.current, addMonths(c.current, forecastMonths - 1));
        const chosen = offer.startLater === null ? forecastMonths : months.indexOf(offer.startLater.startMonth);
        for (let index = 1; index < chosen; index++) {
          expect(forecastAfterEvenOutFrom(c, offer.monthly, index).lowest.amount, `starting in ${months[index]}`).toBeLessThan(0);
        }
        if (offer.startLater === null) return;
        const { forecast, command } = offer.startLater;
        expect(forecast.lowest.amount).toBeGreaterThanOrEqual(0);
        expect(forecastAfterEvenOutFrom(c, offer.monthly, chosen)).toEqual(forecast);
        expect(jobForecast(applied(c.facts, c.asOf, command), c.job, c.asOf)).toEqual(forecast);
        expect(chosen).toBeGreaterThan(0);
      }),
      { numRuns: 150 },
    );
  });
});

describe("a job already evened out", () => {
  it("gives the forecast as it stands, and proposes a higher amount only when the bucket is heading below zero", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = evened(c);
        if (offer === null) return;
        expect(offer.forecast).toEqual(jobForecast(c.facts, c.job, c.asOf));
        if (offer.forecast.runsDryIn === null) expect(offer.proposal).toBeNull();
        if (offer.proposal === null) return;
        expect(offer.forecast.runsDryIn).not.toBeNull();
        expect(offer.proposal.monthly).toBeGreaterThan(offer.monthly);
        expect(offer.proposal.monthly % stepOf(c.facts)).toBe(0);
      }),
      runs,
    );
  });

  it("makes a proposal that keeps the bucket at or above zero once applied, and is the smallest in whole steps that does", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = evened(c);
        if (offer?.proposal == null) return;
        const { proposal } = offer;
        expect(jobForecast(applied(c.facts, c.asOf, proposal.command), c.job, c.asOf)).toEqual(proposal.forecast);
        expect(proposal.forecast.lowest.amount).toBeGreaterThanOrEqual(0);
        const lower: Command = {
          kind: "batch",
          commands: proposal.command.commands.map((command) => {
            if (command.kind === "assign") return { ...command, amount: (command.amount - stepOf(c.facts)) as Money };
            if (command.kind === "changeJob" && command.changes.ofKind?.kind === "spend" && command.changes.ofKind.plan?.mode === "evenOut") {
              return { ...command, changes: { ofKind: { kind: "spend", plan: { ...command.changes.ofKind.plan, monthly: (proposal.monthly - stepOf(c.facts)) as Money } } } } as Command;
            }
            return command;
          }),
        };
        expect(jobForecast(applied(c.facts, c.asOf, lower), c.job, c.asOf)?.lowest.amount).toBeLessThan(0);
      }),
      runs,
    );
  });

  it("withholds a proposal only when the plan's own amount would hold, or no amount could help", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const offer = evened(c);
        if (offer === null || offer.proposal !== null || offer.forecast.runsDryIn === null) return;
        const job = c.facts.jobs.get(c.job);
        if (job?.kind !== "spend" || job.plan.mode !== "evenOut") throw new Error("An evened-out job");
        const everyMonth = (monthly: Money): JobForecast => {
          const figures = computeFigures(c.facts, c.asOf, { horizonMonths: forecastMonths - 1 });
          const commands: Command[] = [{ kind: "changeJob", jobId: c.job, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly, startMonth: (job.plan as { startMonth: Month }).startMonth } } } }];
          for (const m of monthRange(c.current, addMonths(c.current, forecastMonths - 1))) {
            const state = figures.months.get(m)?.state;
            if ((state === "open" || state === "reopened") && m >= (job.plan as { startMonth: Month }).startMonth) commands.push({ kind: "assign", month: m, jobId: c.job, amount: monthly });
          }
          return jobForecast(applied(c.facts, c.asOf, { kind: "batch", commands }), c.job, c.asOf) as JobForecast;
        };
        const holds = everyMonth(job.plan.monthly).lowest.amount >= 0;
        if (!holds) expect(everyMonth(1_000_000_000 as Money).lowest.amount, "no amount, however large, would hold").toBeLessThan(0);
      }),
      runs,
    );
  });
});

describe("an offer reads the facts and changes none", () => {
  it("is the same offer when asked again", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        expect(offerOf(c)).toEqual(offerOf(c));
      }),
      { numRuns: 100 },
    );
  });
});

function stepOf(facts: Facts): Money {
  for (const household of facts.household.values()) return household.evenOutStep;
  throw new Error("No household");
}
