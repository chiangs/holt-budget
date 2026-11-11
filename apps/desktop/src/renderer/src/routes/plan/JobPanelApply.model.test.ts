import {
  type BucketTransferId,
  type Command,
  type Facts,
  type JobId,
  type LocalDate,
  type MoveId,
  apply,
  bucketTransferId,
  computeFigures,
  jobForecast,
  moveId,
} from "@holt/core";
import { evenOut, followBills, kr, setAmount } from "@holt/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { electricityHousehold, electricityToday } from "../../../../../../../packages/core/src/testing/electricity-household.ts";
import { seriesOf } from "./JobChart.model.ts";
import { type Selection, type SpendPanelData, chartInputOf, panelOf, plannedByMonth } from "./JobPanel.model.ts";
import { type Applying, applyOf, effectRows, effectsOf, familyOf, shownAs } from "./JobPanelApply.model.ts";

const reason = "Start evening out Electricity";
const select = (mode: Selection["mode"], start: Selection["start"] = "now", raise = false): Selection => ({ mode, start, raise });

function ids(): { readonly transfer: () => BucketTransferId; readonly move: () => MoveId; readonly made: string[] } {
  let n = 0;
  const made: string[] = [];
  const next = (): string => {
    n += 1;
    const id = `00000000-0000-7000-8000-${String(900 + n).padStart(12, "0")}`;
    made.push(id);
    return id;
  };
  return { transfer: () => bucketTransferId(next()), move: () => moveId(next()), made };
}

function world(options: Parameters<typeof electricityHousehold>[0] = {}) {
  const household = electricityHousehold({ plan: followBills(), ...options });
  const figures = computeFigures(household.facts, electricityToday);
  const found = panelOf(household.facts, figures, household.jobs.electricity, electricityToday);
  if (found?.kind !== "spend") throw new Error("Not a spend panel");
  return { ...household, panel: found satisfies SpendPanelData };
}

function ready(applying: Applying) {
  if (applying.kind !== "ready") throw new Error(`Expected a command to apply, got ${applying.kind}`);
  return applying;
}

const kindsOf = (command: Command): string[] => (command.kind === "batch" ? command.commands.map((c) => c.kind) : [command.kind]);

describe("the commands Apply runs", () => {
  it("run nothing when the plan the family looks at is the plan the job has", () => {
    const { panel } = world();
    expect(applyOf(panel, select("followBills"), { ids: ids(), reason }).kind).toBe("nothing");
    expect(applyOf(panel, select("setAmount"), { ids: ids(), reason }).kind).toBe("nothing");
    const evened = world({ plan: evenOut(kr(3_050), "2026-11"), opening: kr(3_800) }).panel;
    expect(applyOf(evened, select("evenOut"), { ids: ids(), reason }).kind).toBe("nothing");
  });

  it("start now as one batch: the plan, the open month's assignment, the move between buckets and the move at the bank", () => {
    const { panel, jobs } = world();
    const made = ids();
    const applying = ready(applyOf(panel, select("evenOut", "now"), { ids: made, reason }));
    expect(applying.command.kind).toBe("batch");
    expect(kindsOf(applying.command)).toEqual(["changeJob", "assign", "moveBucket", "addMove"]);
    const [, , transfer, move] = applying.command.kind === "batch" ? applying.command.commands : [];
    if (transfer?.kind !== "moveBucket" || move?.kind !== "addMove") throw new Error("expected the transfer and the move");
    expect(transfer.transfer).toMatchObject({ from: jobs.buffer, to: jobs.electricity, month: "2026-11", reason, amount: panel.offer?.kind === "start" ? panel.offer.startNow.seed : -1 });
    expect(move.move).toMatchObject({ amount: transfer.transfer.amount, month: "2026-11", reason });
    expect(made.made).toEqual([transfer.transfer.id, move.move.id]);
    expect(applying.done).toMatchObject({ kind: "evenNow", source: "Buffer", bankMove: true });
    expect(applying.label).toEqual({ kind: "evenOut", month: "2026-11" });
  });

  it("leave out the move at the bank when the buffer and the job sit in the same account", () => {
    const { panel } = world({ paidFrom: "savings" });
    const applying = ready(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason }));
    expect(kindsOf(applying.command)).toEqual(["changeJob", "assign", "moveBucket"]);
    expect(applying.done).toMatchObject({ kind: "evenNow", bankMove: false });
  });

  it("start later without touching the buffer", () => {
    const { panel } = world();
    const made = ids();
    const applying = ready(applyOf(panel, select("evenOut", "later"), { ids: made, reason }));
    expect(kindsOf(applying.command)).not.toContain("moveBucket");
    expect(kindsOf(applying.command)).not.toContain("addMove");
    expect(kindsOf(applying.command)[0]).toBe("changeJob");
    expect(made.made).toEqual([]);
    expect(applying.label).toEqual({ kind: "evenOut", month: panel.offer?.kind === "start" && panel.offer.startLater !== null ? panel.offer.startLater.startMonth : "" });
    expect(applying.done.kind).toBe("evenLater");
  });

  it("start later when the family chooses it, and now when it chooses now, from the same offer", () => {
    const { panel } = world();
    const later = ready(applyOf(panel, select("evenOut", "later"), { ids: ids(), reason }));
    const now = ready(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason }));
    expect(kindsOf(later.command)).not.toEqual(kindsOf(now.command));
    expect(later.label).not.toEqual(now.label);
  });

  it("go back to following the bills with one plain change to the job", () => {
    const { panel, jobs } = world({ plan: evenOut(kr(3_050), "2026-11"), opening: kr(3_800) });
    const applying = ready(applyOf(panel, select("followBills"), { ids: ids(), reason }));
    expect(applying.command).toEqual({ kind: "changeJob", jobId: jobs.electricity, changes: { ofKind: { kind: "spend", plan: { mode: "followBills" } } } });
    expect(applying.label).toEqual({ kind: "followBills" });
  });

  it("raise the monthly amount only when the family asks to see the proposal, with the command core built", () => {
    const { panel } = world({ plan: evenOut(kr(2_500), "2026-11"), opening: kr(0) });
    const offer = panel.offer;
    if (offer?.kind !== "evenedOut" || offer.proposal === null) throw new Error("expected a proposal");
    expect(applyOf(panel, select("evenOut"), { ids: ids(), reason }).kind).toBe("nothing");
    const applying = ready(applyOf(panel, select("evenOut", "now", true), { ids: ids(), reason }));
    expect(familyOf(offer.proposal.command)).toEqual(applying.command);
    expect(applying.label).toEqual({ kind: "raise", monthly: offer.proposal.monthly });
  });

  it("say plainly why a start now cannot be applied, and run nothing", () => {
    const { panel } = world({ bufferBalance: kr(1_000) });
    const offer = panel.offer;
    if (offer?.kind !== "start") throw new Error("expected an offer");
    expect(offer.startNow.blockedBy).toBe("bufferHoldsLess");
    expect(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason })).toEqual({ kind: "blocked", reason: "bufferHoldsLess" });
    expect(applyOf(panel, select("evenOut", "later"), { ids: ids(), reason }).kind).toBe("ready");
  });

  it("say that a month that is not open yet has nowhere to record the move", () => {
    const { panel } = world({ november: "planned" });
    expect(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason })).toEqual({ kind: "blocked", reason: "monthNotStarted" });
  });

  it("never lets the page send an import", () => {
    expect(() => familyOf({ kind: "importFile" } as unknown as Command)).toThrow(/importFile/);
    expect(familyOf({ kind: "batch", commands: [{ kind: "assign", month: "2026-11" as never, jobId: "x" as JobId, amount: kr(1) }] }).kind).toBe("batch");
  });
});

/** Everything the chart showed for the months ahead: the bill, what the plan gives, and the bucket when there is one. */
function shown(panel: SpendPanelData, selection: Selection) {
  const input = chartInputOf(panel, selection);
  if (input === null) throw new Error("No chart");
  return seriesOf(input).points.filter((p) => p.kind === "estimate");
}

const options = fc.record({
  plan: fc.constantFrom(followBills(), setAmount(kr(2_900))),
  assignedBefore: fc.constantFrom("mockup" as const, "matchingBills" as const),
  novemberAssigned: fc.integer({ min: 2_500, max: 3_500 }).map((n) => kr(Math.round(n / 50) * 50)),
  bufferBalance: fc.integer({ min: 0, max: 120_000 }).map(kr),
  paidFrom: fc.constantFrom("bills" as const, "savings" as const),
  opening: fc.integer({ min: 0, max: 3_000 }).map(kr),
  november: fc.constantFrom("open" as const, "reopened" as const, "closed" as const),
});

describe("applying what the chart showed", () => {
  it("gives exactly the forecast the chart drew, whichever way the family starts and whatever the household", () => {
    let applied = 0;
    fc.assert(
      fc.property(options, fc.constantFrom("now" as const, "later" as const), (setup, start) => {
        const { facts, panel, jobs } = world(setup);
        const selection = select("evenOut", start);
        const applying = applyOf(panel, selection, { ids: ids(), reason });
        if (applying.kind !== "ready") return;
        const after = apply(facts, applying.command, { asOf: electricityToday });
        expect(after.ok, JSON.stringify(after)).toBe(true);
        if (!after.ok) return;
        applied += 1;
        const forecast = jobForecast(after.facts, jobs.electricity, electricityToday);
        expect(forecast).not.toBeNull();
        const drawn = shown(panel, selection);
        expect(drawn.map((p) => [p.month, p.bucket, p.planned, p.value])).toEqual((forecast?.months ?? []).map((m) => [m.month, m.bucketEnd, m.planned, m.bill]));
      }),
      { numRuns: 120 },
    );
    expect(applied, "the property reached the commands").toBeGreaterThan(20);
  });

  it("gives the plan the chart drew for following the bills", () => {
    fc.assert(
      fc.property(options, (setup) => {
        const { facts, panel, jobs } = world({ ...setup, plan: evenOut(kr(3_050), "2026-11") });
        const applying = applyOf(panel, select("followBills"), { ids: ids(), reason });
        if (applying.kind !== "ready") return;
        const after = apply(facts, applying.command, { asOf: electricityToday });
        expect(after.ok).toBe(true);
        if (!after.ok) return;
        const planned = plannedByMonth(computeFigures(after.facts, electricityToday), jobs.electricity);
        for (const point of shown(panel, select("followBills"))) {
          expect(point.planned).toBe(planned.get(point.month)?.amount);
          expect(point.plannedIsEstimate).toBe(planned.get(point.month)?.estimated);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("gives the forecast the chart drew for a raised monthly amount", () => {
    const { facts, panel, jobs } = world({ plan: evenOut(kr(2_500), "2026-11"), opening: kr(0) });
    const selection = select("evenOut", "now", true);
    const applying = ready(applyOf(panel, selection, { ids: ids(), reason }));
    const after = apply(facts, applying.command, { asOf: electricityToday });
    if (!after.ok) throw new Error(JSON.stringify(after));
    const forecast = jobForecast(after.facts, jobs.electricity, electricityToday);
    expect(shown(panel, selection).map((p) => [p.month, p.bucket, p.planned])).toEqual((forecast?.months ?? []).map((m) => [m.month, m.bucketEnd, m.planned]));
  });

  it("reaches the bucket the explanation promises: the seed leaves the buffer and the bucket holds what the offer says", () => {
    const { facts, panel, jobs } = world();
    const applying = ready(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason }));
    const after = apply(facts, applying.command, { asOf: electricityToday });
    if (!after.ok || panel.offer?.kind !== "start") throw new Error("expected the offer to apply");
    const figures = computeFigures(after.facts, electricityToday);
    expect(figures.buffer.kind === "buffer" && figures.buffer.balance).toBe(panel.offer.startNow.bufferAfter?.balance);
    expect(figures.buffer.kind === "buffer" && figures.buffer.runway).toEqual(panel.offer.startNow.bufferAfter?.runway);
    expect(figures.jobs.get(jobs.electricity)?.months.get(figures.current)?.transfersIn).toBe(panel.offer.startNow.seed);
  });
});

describe("what it would change", () => {
  const asOf: LocalDate = electricityToday;

  it("says what moves for starting now: the job's amount, the money with no job and the buffer, from core's preview", () => {
    const { facts, panel, jobs } = world();
    const applying = ready(applyOf(panel, select("evenOut", "now"), { ids: ids(), reason }));
    const result = effectsOf(facts, applying.command, asOf);
    if (result.kind !== "shown") throw new Error("expected effects");
    const offer = panel.offer;
    if (offer?.kind !== "start") throw new Error("expected an offer");
    expect(result.month).toBe("2026-11");
    const assigned = result.rows.find((r) => r.kind === "assigned");
    expect(assigned).toMatchObject({ jobId: jobs.electricity, before: kr(2_900), after: offer.monthly });
    const buffer = result.rows.find((r) => r.kind === "buffer");
    expect(buffer).toMatchObject({ before: kr(86_000), after: offer.startNow.bufferAfter?.balance, runwayAfter: offer.startNow.bufferAfter?.runway });
    expect(result.rows.some((r) => r.kind === "unassigned")).toBe(true);
  });

  it("says nothing moved when a start later leaves this month as it is", () => {
    const { facts, panel } = world({ novemberAssigned: kr(3_300) });
    const applying = ready(applyOf(panel, select("evenOut", "later"), { ids: ids(), reason }));
    const result = effectsOf(facts, applying.command, asOf);
    expect(result.kind === "shown" && result.rows.filter((r) => r.kind === "buffer")).toEqual([]);
  });

  it("has a row for every part of the effects that can be shown, so a new part must be shown or left out on purpose", () => {
    expect(Object.keys(shownAs).sort()).toEqual(["buffer", "goals", "jobs", "month", "savingsRate", "unassigned"]);
    expect(effectRows({ month: "2026-11" as never, unassigned: { before: { kind: "unassigned", amount: kr(0) }, after: { kind: "unassigned", amount: kr(0) } }, jobs: [], savingsRate: { before: 100, after: 100 }, goals: [], buffer: { before: { kind: "noBuffer" }, after: { kind: "noBuffer" } } })).toEqual([]);
  });

  it("shows the savings rate and the months to go only when they move", () => {
    const rows = effectRows({
      month: "2026-11" as never,
      unassigned: { before: { kind: "unassigned", amount: kr(228) }, after: { kind: "overAssigned", amount: kr(172) } },
      jobs: [],
      savingsRate: { before: 140, after: 99 },
      goals: [],
      buffer: { before: { kind: "noBuffer" }, after: { kind: "noBuffer" } },
    });
    expect(rows.map((r) => r.kind)).toEqual(["unassigned", "savingsRate"]);
    expect(rows[1]).toEqual({ kind: "savingsRate", before: 140, after: 99 });
  });

  it("returns core's refusal as it is when the command would be refused", () => {
    const { facts, jobs } = world();
    const refused = effectsOf(facts, { kind: "changeJob", jobId: jobs.electricity, changes: { ofKind: { kind: "saveUp" } } }, asOf);
    expect(refused.kind).toBe("refused");
  });
});
