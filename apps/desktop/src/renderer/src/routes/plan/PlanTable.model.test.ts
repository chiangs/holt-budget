import { type Facts, type Figures, type JobId, type LocalDate, computeFigures, localDate, month } from "@holt/core";
import { factsBuilder, followBills, kr, setAmount } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { planMonthOf } from "./PlanMonth.model.ts";
import { type PlanGroup, type PlanRow, planGroups, percentOf, rowsOf } from "./PlanTable.model.ts";
import { assignedInNovember, buildWorld, today, type PlanWorld } from "./PlanTestWorld.ts";

function tableOf(world: Pick<PlanWorld, "facts" | "figures">): PlanGroup[] {
  const shown = planMonthOf(world.facts, world.figures);
  if (shown === null) throw new Error("No month");
  return planGroups(world.facts, world.figures, shown);
}

function row(groups: readonly PlanGroup[], id: JobId): PlanRow {
  const found = rowsOf(groups).find((r) => r.jobId === id);
  if (found === undefined) throw new Error(`No row for ${id}`);
  return found;
}

describe("the groups", () => {
  const world = buildWorld();
  const groups = tableOf(world);

  it("come in the family's order, each with its jobs", () => {
    expect(groups.map((g) => g.name)).toEqual(["Fixed costs", "Living", "Saving", "Children's savings"]);
    expect(groups.find((g) => g.name === "Fixed costs")?.rows.map((r) => r.name)).toEqual(["Mortgage", "Electricity", "Union fees"]);
  });

  it("list live jobs first, then paused, finished and archived ones", () => {
    const living = groups.find((g) => g.name === "Living")?.rows.map((r) => r.name);
    expect(living).toEqual(["Food and household", "Car running costs", "Confirmation", "Holidays", "Christmas", "Books and games"]);
  });

  it("total what their jobs have assigned and spent", () => {
    const fixed = groups.find((g) => g.name === "Fixed costs");
    expect(fixed?.assigned).toBe(kr(14_500 + 3_050));
    const living = groups.find((g) => g.name === "Living");
    expect(living?.assigned).toBe(kr(14_200 + 3_200 + 1_500 + 3_000 + 1_200));
    expect(living?.spent).toBe(kr(2_140 + 640));
  });

  it("together total what the month has assigned", () => {
    const total = groups.reduce((sum, g) => sum + g.assigned, 0);
    expect(total).toBe(kr(assignedInNovember));
    expect(total).toBe(planMonthOf(world.facts, world.figures)?.figures.assigned);
  });
});

describe("a job that spends and keeps nothing", () => {
  const world = buildWorld();
  const groups = tableOf(world);

  it("says how much is left, with a bar for how much is spent", () => {
    const food = row(groups, world.jobs.food);
    expect(food.assigned).toBe(kr(14_200));
    expect(food.spent).toBe(kr(2_140));
    expect(food.line).toEqual({ kind: "left", left: kr(12_060) });
    expect(food.progress).toBe(15);
  });

  it("shows a spend job that hasn't spent a krone as 0 spent, with no bar", () => {
    const mortgage = row(groups, world.jobs.mortgage);
    expect(mortgage.spent).toBe(kr(0));
    expect(mortgage.line).toEqual({ kind: "left", left: kr(14_500) });
    expect(mortgage.progress).toBeNull();
  });

  it("says how far over it is when it spent more than it had", () => {
    const over = buildWorld();
    const bigger = bigSpend(over.facts, over.jobs.mortgage, 16_000);
    const mortgage = row(tableOf({ facts: bigger, figures: computeFigures(bigger, today) }), over.jobs.mortgage);
    expect(mortgage.line).toEqual({ kind: "over", over: kr(1_500) });
    expect(mortgage.progress).toBe(100);
  });
});

function bigSpend(facts: Facts, jobId: JobId, kroner: number, date: LocalDate = localDate("2026-11-06")): Facts {
  const some = [...facts.transactions.values()][0];
  if (some === undefined) throw new Error("No transaction to copy");
  const id = `00000000-0000-7000-8000-${String(900_000 + facts.transactions.size).padStart(12, "0")}` as typeof some.id;
  const added = {
    ...some,
    id,
    bookingDate: date,
    amount: kr(-kroner),
    description: "Big spend",
    treatment: { kind: "split", allocations: [{ jobId, amount: kr(-kroner) }] },
  } as unknown as typeof some;
  return { ...facts, transactions: new Map(facts.transactions).set(id, added) };
}

describe("a job that keeps its money", () => {
  const world = buildWorld();
  const groups = tableOf(world);

  it("says what its bucket holds against its target and when it should be ready", () => {
    expect(row(groups, world.jobs.confirmation).line).toEqual({ kind: "bucket", balance: kr(9_600), target: kr(38_000), readyBy: month("2027-05") });
    expect(row(groups, world.jobs.confirmation).progress).toBe(25);
  });

  it("says only what its bucket holds when it has no target", () => {
    expect(row(groups, world.jobs.christmas).line).toEqual({ kind: "bucket", balance: kr(11_600), target: null, readyBy: null });
    expect(row(groups, world.jobs.cars).line).toEqual({ kind: "bucket", balance: kr(2_560), target: null, readyBy: null });
    expect(row(groups, world.jobs.electricity).line).toEqual({ kind: "bucket", balance: kr(5_050), target: null, readyBy: null });
  });

  it("shows the buffer against the buffer's own target in months, not the save-up job's", () => {
    const buffer = row(groups, world.jobs.buffer);
    expect(buffer.line).toEqual({ kind: "bufferGoal", balance: kr(42_000), target: kr(95_250), months: 3 });
    expect(buffer.progress).toBe(44);
    expect(world.figures.buffer.kind === "buffer" && world.figures.buffer.target).toBe(kr(95_250));
  });

  it("says how short it is when the bucket is below zero", () => {
    const facts = bigSpend(world.facts, world.jobs.cars, 6_000);
    const cars = row(tableOf({ facts, figures: computeFigures(facts, today) }), world.jobs.cars);
    expect(cars.line).toEqual({ kind: "bucketShort", short: kr(640 + 6_000 - 3_200) });
  });

  it("shows a dash for spending when it hasn't spent, and the amount when it has", () => {
    expect(row(groups, world.jobs.confirmation).spent).toBeNull();
    expect(row(groups, world.jobs.cars).spent).toBe(kr(640));
    const facts = bigSpend(world.facts, world.jobs.confirmation, 3_000);
    const confirmation = row(tableOf({ facts, figures: computeFigures(facts, today) }), world.jobs.confirmation);
    expect(confirmation.spent).toBe(kr(3_000));
  });
});

describe("a job that pays into another account", () => {
  it("says where, and when it was paid", () => {
    const world = buildWorld();
    expect(row(tableOf(world), world.jobs.eldest).line).toEqual({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "paid", on: localDate("2026-11-04") } });
  });

  it("says it isn't paid yet when nothing went", () => {
    const world = buildWorld({ paidEldest: null });
    expect(row(tableOf(world), world.jobs.eldest).line).toEqual({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "notYet" } });
  });

  it("names the latest payment when more than one was made", () => {
    const world = buildWorld({ paidEldest: "2026-11-04" });
    const facts = bigSpend(world.facts, world.jobs.eldest, 100, localDate("2026-11-08"));
    const line = row(tableOf({ facts, figures: computeFigures(facts, today) }), world.jobs.eldest).line;
    expect(line).toEqual({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "paid", on: localDate("2026-11-08") } });
  });
});

describe("a job that isn't active", () => {
  const world = buildWorld();
  const groups = tableOf(world);

  it("says it is paused or archived", () => {
    expect(row(groups, world.jobs.union).line).toEqual({ kind: "inactive", status: "paused", bucket: null });
    expect(row(groups, world.jobs.books).line).toEqual({ kind: "inactive", status: "archived", bucket: null });
  });

  it("still says what a paused job's bucket holds, because that money has a home until the family moves it", () => {
    const facts = { ...world.facts, jobs: new Map(world.facts.jobs).set(world.jobs.holidays, { ...world.facts.jobs.get(world.jobs.holidays)!, status: "finished" as const, opening: kr(5_000) }) };
    const holidays = row(tableOf({ facts, figures: computeFigures(facts, today) }), world.jobs.holidays);
    expect(holidays.line).toEqual({ kind: "inactive", status: "finished", bucket: kr(8_000) });
  });
});

describe("an amount that is only projected", () => {
  it("is marked as an estimate when the app estimated it, and not when the family's own plan gave it", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    const everyday = b.account({ name: "Everyday", openingDate: "2026-10-31" });
    const fixed = b.group({ name: "Fixed costs" });
    const water = b.spendJob({ name: "Water", groupId: fixed, accountId: everyday, plan: followBills() });
    const rent = b.spendJob({ name: "Rent", groupId: fixed, accountId: everyday, plan: setAmount(kr(9_000)) });
    const facts = b.facts();
    const figures: Figures = computeFigures(facts, today);
    const groups = tableOf({ facts, figures });
    expect(row(groups, water).estimated).toBe(true);
    expect(row(groups, rent).estimated).toBe(false);
    expect(row(groups, rent).assigned).toBe(kr(9_000));
  });

  it("is not marked once the month is open, because then it is the family's assignment", () => {
    const world = buildWorld();
    expect(rowsOf(tableOf(world)).some((r) => r.estimated)).toBe(false);
  });
});

describe("percentOf", () => {
  it("is a whole percent from 0 to 100 and never goes past either end", () => {
    expect(percentOf(kr(1), kr(3))).toBe(33);
    expect(percentOf(kr(5), kr(3))).toBe(100);
    expect(percentOf(kr(-5), kr(3))).toBe(0);
    expect(percentOf(kr(5), kr(0))).toBe(0);
  });
});
