import { type Facts, type Job, type JobId, type SpendJob, type Transaction, computeFigures, money } from "@holt/core";
import { evenOut, followBills, kr, setAmount } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { electricityHousehold, electricityToday } from "../../../../../../../packages/core/src/testing/electricity-household.ts";
import { seriesOf } from "./JobChart.model.ts";
import {
  type PanelData,
  type SaveUpPanelData,
  type Selection,
  type SpendPanelData,
  choiceOf,
  chartInputOf,
  defaultStart,
  initialSelection,
  modesOf,
  panelKindOf,
  panelOf,
  payeeOf,
  plannedNowOf,
  raiseOf,
  savingsChartInput,
  spendTilesOf,
  startOf,
} from "./JobPanel.model.ts";
import { buildWorld, today } from "./PlanTestWorld.ts";

function panel(facts: Facts, jobId: JobId, asOf = electricityToday): PanelData {
  const found = panelOf(facts, computeFigures(facts, asOf), jobId, asOf);
  if (found === null) throw new Error("No panel");
  return found;
}

function spend(options: Parameters<typeof electricityHousehold>[0] = {}): { readonly data: SpendPanelData; readonly facts: Facts; readonly id: JobId } {
  const world = electricityHousehold(options);
  const data = panel(world.facts, world.jobs.electricity);
  if (data.kind !== "spend") throw new Error("Not a spend panel");
  return { data, facts: world.facts, id: world.jobs.electricity };
}

const select = (mode: Selection["mode"], start: Selection["start"] = "now", raise = false): Selection => ({ mode, start, raise });

describe("the kinds of job", () => {
  it("each have a panel, and the buffer is a save-up job with its own header", () => {
    const world = buildWorld();
    const kinds = Object.fromEntries(Object.entries(world.jobs).map(([name, id]) => [name, panelKindOf(world.facts.jobs.get(id) as Job)]));
    expect(kinds).toMatchObject({ electricity: "spend", mortgage: "spend", confirmation: "saveUp", christmas: "saveUp", buffer: "buffer", eldest: "payInto" });
  });

  it("gives a panel to a job of every kind, and none to a job that does not exist", () => {
    const world = buildWorld();
    for (const id of Object.values(world.jobs)) expect(panelOf(world.facts, world.figures, id, today)).not.toBeNull();
    expect(panelOf(world.facts, world.figures, "00000000-0000-7000-8000-0000000000ff" as JobId, today)).toBeNull();
  });

  it("show a spend job's header from its group, its payee and where it is paid from", () => {
    const { data } = spend();
    expect(data.header).toMatchObject({ group: "Fixed costs", kind: "spend", account: "Regninger", into: null });
  });

  it("name the other party of the job's latest payment in the header", () => {
    const { facts, id } = spend();
    expect(payeeOf(facts, id)).toBeNull();
    const withPayee = (date: string, name: string): Facts => {
      const transactions = new Map(facts.transactions);
      for (const [key, t] of transactions) {
        if (t.treatment.kind === "split" && t.bookingDate === date && t.treatment.allocations.some((a) => a.jobId === id)) transactions.set(key, { ...t, counterparty: name } as Transaction);
      }
      return { ...facts, transactions };
    };
    expect(payeeOf(withPayee("2026-09-19", "Lyse"), id)).toBe("Lyse");
    expect(payeeOf(withPayee("2026-10-19", "Fjordkraft"), id)).toBe("Fjordkraft");
  });
});

describe("the choice between the plans", () => {
  const steady = (): SpendJob => {
    const world = buildWorld();
    return world.facts.jobs.get(world.jobs.mortgage) as SpendJob;
  };

  it("is always offered to a job that follows the bills or is evened out, because the way to the other must stay", () => {
    const job = steady();
    expect(choiceOf({ ...job, plan: { mode: "followBills" }, seasonality: "auto" }, null)).toBe("offered");
    expect(choiceOf({ ...job, plan: { mode: "evenOut", monthly: kr(100), startMonth: "2026-11" as never }, seasonality: "auto" }, null)).toBe("offered");
  });

  it("is offered to a set amount only when the family says the cost moves, or the history shows a season", () => {
    const job = steady();
    expect(choiceOf({ ...job, seasonality: "seasonal" }, null)).toBe("offered");
    expect(choiceOf({ ...job, seasonality: "irregular" }, null)).toBe("offered");
    expect(choiceOf({ ...job, seasonality: "auto" }, null)).toBe("steady");
  });

  it("follows the estimate's method for a job the app judges", () => {
    const { data } = spend({ plan: followBills() });
    const job = { ...(data.job as SpendJob), plan: setAmount(kr(2900)), seasonality: "auto" as const };
    expect(data.estimate?.months.some((m) => m.estimate.method === "sameMonthLastYear" || m.estimate.method === "nearestMonths")).toBe(true);
    expect(choiceOf(job, data.estimate)).toBe("offered");
    const flat = data.estimate === null ? null : { ...data.estimate, months: data.estimate.months.map((m) => ({ ...m, estimate: { ...m.estimate, method: "average" as const } })) };
    expect(choiceOf(job, flat)).toBe("steady");
  });

  it("is never offered to a job that is paused, finished or archived", () => {
    for (const status of ["paused", "finished", "archived"] as const) {
      expect(choiceOf({ ...steady(), plan: { mode: "followBills" }, status }, null)).toBe("inactive");
    }
  });

  it("lists the plans a job can switch between, with the set amount only when it is the plan it has", () => {
    const job = steady();
    expect(modesOf({ ...job, plan: setAmount(kr(100)) }, "offered")).toEqual(["setAmount", "followBills", "evenOut"]);
    expect(modesOf({ ...job, plan: { mode: "followBills" } }, "offered")).toEqual(["followBills", "evenOut"]);
    expect(modesOf(job, "steady")).toEqual([]);
    expect(modesOf(job, "inactive")).toEqual([]);
  });

  it("is steady for a plain set amount the app finds no season in, and offered for the seasonal Electricity", () => {
    const world = buildWorld();
    const jobs = new Map(world.facts.jobs);
    jobs.set(world.jobs.mortgage, { ...(jobs.get(world.jobs.mortgage) as SpendJob), seasonality: "auto" });
    const facts = { ...world.facts, jobs };
    const mortgage = panelOf(facts, computeFigures(facts, today), world.jobs.mortgage, today);
    expect(mortgage?.kind === "spend" && mortgage.choice).toBe("steady");
    expect(mortgage?.kind === "spend" && mortgage.modes).toEqual([]);
    const { data } = spend();
    expect(data.choice).toBe("offered");
    expect(data.modes).toEqual(["setAmount", "followBills", "evenOut"]);
  });
});

describe("the tiles for Electricity, as in the Plan mockup", () => {
  const { data } = spend({ plan: followBills() });
  const tiles = spendTilesOf(data);

  it("say what was paid in the months that have ended, and the average", () => {
    expect(tiles.actual).toEqual({ from: "2026-01", to: "2026-10", months: 10, paid: kr(28_800), average: kr(2_880) });
  });

  it("say what the next twelve months are expected to cost and the monthly average, which are estimates", () => {
    expect(tiles.estimate).toEqual({ total: kr(36_300), monthlyAverage: kr(3_025) });
    expect(data.estimate?.total.kind).toBe("estimate");
    expect(data.estimate?.monthlyAverage.kind).toBe("estimate");
  });

  it("say what is planned now and since when", () => {
    expect(tiles.planned).toEqual({ month: "2026-11", amount: kr(2_900), source: "assignment", sameSince: "2026-01" });
  });

  it("have no actual tile for a job whose plan has not had a month end, and still say what is planned", () => {
    const world = buildWorld();
    const cars = panelOf(world.facts, world.figures, world.jobs.cars, today);
    if (cars?.kind !== "spend") throw new Error("Not a spend panel");
    expect(spendTilesOf(cars).actual).toBeNull();
    expect(spendTilesOf(cars).planned).toMatchObject({ amount: kr(3_200), sameSince: null });
  });
});

describe("planned now", () => {
  it("counts back the months that gave the same amount, and stops at the first that did not", () => {
    const { data } = spend({ plan: followBills() });
    const history = { ...data.history, months: data.history.months.map((m) => (m.month === "2026-08" ? { ...m, planned: kr(2_800) } : m)) };
    const assigned = { kind: "assignment" as const, amount: kr(2_900) };
    expect(plannedNowOf(data.history, assigned, data.current)?.sameSince).toBe("2026-01");
    expect(plannedNowOf(history, assigned, data.current)?.sameSince).toBe("2026-09");
    expect(plannedNowOf(history, { kind: "assignment", amount: kr(3_000) }, data.current)?.sameSince).toBeNull();
    expect(plannedNowOf(history, undefined, data.current)).toBeNull();
  });

  it("calls the amount an estimate when the job follows the bills in a month the family hasn't opened", () => {
    const { data } = spend({ plan: followBills(), november: "planned" });
    expect(data.planned?.source).toBe("estimate");
    expect(data.planned?.amount).toBe(kr(3_300));
  });
});

describe("what the chart draws for each plan", () => {
  const follow = spend({ plan: followBills() }).data;

  it("shows the bills and what the plan gives, with no bucket and no level, for Follow the bills", () => {
    const input = chartInputOf(follow, select("followBills"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.hasBucket).toBe(false);
    expect(series.level).toBeNull();
    expect(series.points.slice(10).map((p) => p.value)).toEqual([3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846].map(kr));
  });

  it("shows the level and the bucket from core's offer for Even it out, before anything is applied", () => {
    const offer = follow.offer;
    if (offer?.kind !== "start") throw new Error("expected an offer to start");
    const input = chartInputOf(follow, select("evenOut"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.level).toEqual({ amount: offer.monthly, from: offer.startMonth });
    expect(series.points.slice(10).map((p) => p.bucket)).toEqual(offer.startNow.forecast.months.map((m) => m.bucketEnd));
    expect(series.points.slice(10).map((p) => p.planned)).toEqual(offer.startNow.forecast.months.map((m) => m.planned));
  });

  it("takes the seed into the bucket line, so it is higher than it would be with no seed", () => {
    const offer = follow.offer;
    if (offer?.kind !== "start") throw new Error("expected an offer to start");
    expect(offer.startNow.seed).toBeGreaterThan(0);
    const input = chartInputOf(follow, select("evenOut"));
    const first = seriesOf(input as NonNullable<typeof input>).points[10];
    expect(first?.bucket).toBe(offer.withoutSeed.months[0]?.bucketEnd === undefined ? undefined : money(offer.withoutSeed.months[0].bucketEnd + offer.startNow.seed));
  });

  it("follows the bills until the start month, then pays the monthly amount, for Start later", () => {
    const offer = follow.offer;
    if (offer?.kind !== "start" || offer.startLater === null) throw new Error("expected a later start");
    const input = chartInputOf(follow, select("evenOut", "later"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.level).toEqual({ amount: offer.monthly, from: offer.startLater.startMonth });
    const before = series.points.filter((p) => p.kind === "estimate" && p.month < (offer.startLater?.startMonth ?? ""));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((p) => p.plannedIsEstimate)).toBe(true);
    expect(series.points.filter((p) => p.kind === "estimate" && p.month >= (offer.startLater?.startMonth ?? "")).every((p) => !p.plannedIsEstimate && p.planned === offer.monthly)).toBe(true);
    expect(series.points.slice(10).map((p) => p.bucket)).toEqual(offer.startLater.forecast.months.map((m) => m.bucketEnd));
  });

  it("draws the set amount as the level for a set-amount job, and the bills as they are expected", () => {
    const { data } = spend();
    const input = chartInputOf(data, select("setAmount"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.level).toEqual({ amount: kr(2_900), from: data.current });
  });

  it("marks the months where the plan is the estimate, never as an actual", () => {
    const input = chartInputOf(follow, select("followBills"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.points.filter((p) => p.kind === "actual").every((p) => !p.plannedIsEstimate)).toBe(true);
    expect(series.points.filter((p) => p.kind === "estimate")).toHaveLength(12);
  });

  it("draws the plan a job would have if it followed the bills while it is evened out", () => {
    const evened = spend({ plan: evenOut(kr(3_050), "2026-11"), opening: kr(3_800) }).data;
    expect(evened.offer?.kind).toBe("evenedOut");
    const input = chartInputOf(evened, select("followBills"));
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.hasBucket).toBe(false);
    expect(series.points.slice(11).every((p) => p.plannedIsEstimate)).toBe(true);
  });
});

describe("a job that is already evened out", () => {
  const tooLow = spend({ plan: evenOut(kr(2_500), "2026-11"), opening: kr(0) }).data;

  it("shows its forecast as the plan stands, with the monthly amount as the level", () => {
    const offer = tooLow.offer;
    if (offer?.kind !== "evenedOut") throw new Error("expected an evened-out job");
    const series = seriesOf(chartInputOf(tooLow, select("evenOut")) as NonNullable<ReturnType<typeof chartInputOf>>);
    expect(series.level).toEqual({ amount: kr(2_500), from: "2026-11" });
    expect(series.points.slice(10).map((p) => p.bucket)).toEqual(offer.forecast.months.map((m) => m.bucketEnd));
  });

  it("proposes a higher monthly amount when the bucket would run dry, and draws it only when asked", () => {
    const offer = tooLow.offer;
    if (offer?.kind !== "evenedOut" || offer.proposal === null) throw new Error("expected a proposal");
    expect(offer.forecast.runsDryIn).not.toBeNull();
    expect(raiseOf(offer, select("evenOut"))).toBeNull();
    expect(raiseOf(offer, select("evenOut", "now", true))?.monthly).toBe(offer.proposal.monthly);
    const series = seriesOf(chartInputOf(tooLow, select("evenOut", "now", true)) as NonNullable<ReturnType<typeof chartInputOf>>);
    expect(series.level?.amount).toBe(offer.proposal.monthly);
    expect(series.points.slice(10).map((p) => p.bucket)).toEqual(offer.proposal.forecast.months.map((m) => m.bucketEnd));
    expect(offer.proposal.forecast.runsDryIn).toBeNull();
  });

  it("looks at the plan it has when the family has not asked to see the proposal", () => {
    expect(initialSelection(tooLow)).toEqual({ mode: "evenOut", start: "now", raise: false });
  });
});

describe("the way to start", () => {
  it("is now, unless the buffer cannot pay the seed and the job can start later", () => {
    const rich = spend({ plan: followBills() }).data;
    expect(defaultStart(rich.offer)).toBe("now");
    const poor = spend({ plan: followBills(), bufferBalance: kr(1_000) }).data;
    expect(poor.offer?.kind === "start" && poor.offer.startNow.blockedBy).toBe("bufferHoldsLess");
    expect(defaultStart(poor.offer)).toBe("later");
  });

  it("starts now when the family asks for a later start that does not exist", () => {
    const rich = spend({ plan: followBills() }).data;
    const offer = rich.offer;
    if (offer?.kind !== "start") throw new Error("expected an offer");
    const without = { ...offer, startLater: null };
    expect(startOf(without, select("evenOut", "later"))).toBe("now");
    expect(startOf(offer, select("evenOut", "later"))).toBe("later");
    expect(startOf(null, select("evenOut", "later"))).toBe("now");
  });

  it("starts from the plan the job has", () => {
    expect(initialSelection(spend({ plan: followBills() }).data)).toEqual({ mode: "followBills", start: "now", raise: false });
    expect(initialSelection(spend().data)).toEqual({ mode: "setAmount", start: "now", raise: false });
  });
});

describe("a job that saves up, and the buffer", () => {
  const world = buildWorld();
  const save = (id: JobId): SaveUpPanelData => {
    const found = panelOf(world.facts, world.figures, id, today);
    if (found?.kind !== "saveUp" && found?.kind !== "buffer") throw new Error("Not a save-up panel");
    return found;
  };

  it("shows the goal of a job with a date, from core's figures", () => {
    const data = save(world.jobs.confirmation);
    expect(data.kind).toBe("saveUp");
    expect(data.goal).toMatchObject({ target: kr(38_000), monthly: kr(1_500) });
    expect(data.goal?.monthsToGo).not.toBeNull();
  });

  it("has no target for a plain monthly amount, and says what the bucket holds", () => {
    const data = save(world.jobs.christmas);
    expect(data.goal?.target).toBeNull();
    expect(data.goal?.saved).toBe(kr(10_400 + 1_200));
  });

  it("shows how long the buffer would last, and only for the buffer", () => {
    expect(save(world.jobs.buffer).kind).toBe("buffer");
    expect(save(world.jobs.buffer).runway?.kind).toBe("tenthsOfAMonth");
    expect(save(world.jobs.confirmation).runway).toBeNull();
  });

  it("draws what the plan puts in as columns and the bucket as a line, with no bills", () => {
    const data = save(world.jobs.confirmation);
    const input = savingsChartInput(data);
    expect(input?.bars).toBe("planned");
    const series = seriesOf(input as NonNullable<typeof input>);
    expect(series.hasBucket).toBe(true);
    expect(series.points.slice(series.nowIndex).map((p) => p.value)).toEqual(series.points.slice(series.nowIndex).map((p) => p.planned));
    expect(series.points.slice(series.nowIndex).map((p) => p.bucket)).toEqual(data.forecast?.months.map((m) => m.bucketEnd));
  });
});

describe("a job that pays into an account", () => {
  const world = buildWorld();

  it("shows what it pays each month and into which account, with the day each payment was booked", () => {
    const data = panelOf(world.facts, world.figures, world.jobs.eldest, today);
    expect(data?.kind).toBe("payInto");
    if (data?.kind !== "payInto") return;
    expect(data.monthly).toBe(kr(500));
    expect(data.header.into).toBe("Eldest's savings");
    expect(data.paidOn.get("2026-11" as never)).toBe("2026-11-04");
    expect(data.history.months.at(-1)?.paid).toBe(kr(500));
  });
});
