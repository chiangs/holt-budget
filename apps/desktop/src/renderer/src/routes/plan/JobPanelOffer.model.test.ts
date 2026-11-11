import { computeFigures } from "@holt/core";
import { evenOut, followBills, kr } from "@holt/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbitraryVariableCost } from "../../../../../../../packages/core/src/testing/variable-cost-household.ts";
import { electricityHousehold, electricityToday } from "../../../../../../../packages/core/src/testing/electricity-household.ts";
import { seriesOf, layoutChart } from "./JobChart.model.ts";
import { type Selection, type SpendPanelData, chartInputOf, panelOf } from "./JobPanel.model.ts";
import { evenedOutViewOf, followViewOf, offerViewOf } from "./JobPanelOffer.model.ts";

const select = (mode: Selection["mode"], start: Selection["start"] = "now", raise = false): Selection => ({ mode, start, raise });

function spend(options: Parameters<typeof electricityHousehold>[0] = {}): SpendPanelData {
  const { facts, jobs } = electricityHousehold({ plan: followBills(), ...options });
  const found = panelOf(facts, computeFigures(facts, electricityToday), jobs.electricity, electricityToday);
  if (found?.kind !== "spend") throw new Error("Not a spend panel");
  return found;
}

describe("the offer to start evening out Electricity", () => {
  const panel = spend();

  it("has a card for starting now and one for starting later, each with its month", () => {
    const view = offerViewOf(panel, select("evenOut"));
    expect(view?.cards.map((c) => [c.key, c.month, c.blockedBy])).toEqual([
      ["now", "2026-11", null],
      ["later", "2027-04", null],
    ]);
    expect(view?.cards[0]).toMatchObject({ seed: panel.offer?.kind === "start" ? panel.offer.startNow.seed : -1, source: "Buffer" });
    expect(view?.cards[1]).toMatchObject({ seed: null, source: null });
  });

  it("says why a bucket that starts with nothing moved in would run dry, from core's forecast without a seed", () => {
    const view = offerViewOf(panel, select("evenOut"));
    expect(view?.intro).toMatchObject({ kind: "runsDry", month: "2026-11" });
    expect(view?.intro.lowest.month).toBe("2027-03");
    expect(view?.intro.lowest.amount).toBeLessThan(0);
  });

  it("says what starting now does: the seed, the lowest the bucket gets, where it ends and what the buffer holds after", () => {
    const view = offerViewOf(panel, select("evenOut", "now"));
    const offer = panel.offer;
    if (view?.explanation.kind !== "now" || offer?.kind !== "start") throw new Error("expected the explanation of starting now");
    expect(view.chosen).toBe("now");
    expect(view.explanation.seed).toBe(offer.startNow.seed);
    expect(view.explanation.course.lowest).toEqual({ month: "2027-03", amount: kr(50) });
    expect(view.explanation.course.last).toEqual({ month: "2027-10", amount: offer.startNow.forecast.months.at(-1)?.bucketEnd });
    expect(view.explanation.source).toEqual({ name: "Buffer", holds: kr(86_000) });
    expect(view.explanation.bankMove).toBe(true);
    expect(view.explanation.bufferAfter).toEqual(offer.startNow.bufferAfter);
    expect(view.explanation.bufferAfter?.balance).toBe(kr(86_000) - offer.startNow.seed);
    expect(view.explanation.blockedBy).toBeNull();
  });

  it("shows the monthly amount, the step it is rounded up to and the estimate's own average, which differ", () => {
    const view = offerViewOf(panel, select("evenOut"));
    expect(view).toMatchObject({ monthly: kr(3_050), step: kr(50), average: kr(3_025) });
  });

  it("says what starting later does: which months follow the bills, what changes in the open month and where the bucket ends", () => {
    const view = offerViewOf(panel, select("evenOut", "later"));
    const offer = panel.offer;
    if (view?.explanation.kind !== "later" || offer?.kind !== "start" || offer.startLater === null) throw new Error("expected the explanation of starting later");
    expect(view.chosen).toBe("later");
    expect(view.explanation.startMonth).toBe("2027-04");
    expect(view.explanation.followsUntil).toBe("2027-03");
    expect(view.explanation.changes).toEqual([{ month: "2026-11", from: kr(2_900), to: kr(3_300) }]);
    expect(view.explanation.course).toEqual({ lowest: offer.startLater.forecast.lowest, last: { month: "2027-10", amount: offer.startLater.forecast.months.at(-1)?.bucketEnd } });
  });

  it("reads the explanation from the offer it is given, so a change to the facts changes it", () => {
    const before = offerViewOf(spend(), select("evenOut", "now"));
    const after = offerViewOf(spend({ bufferBalance: kr(60_000) }), select("evenOut", "now"));
    expect(before?.explanation.kind === "now" && before.explanation.source?.holds).toBe(kr(86_000));
    expect(after?.explanation.kind === "now" && after.explanation.source?.holds).toBe(kr(60_000));
  });

  it("is not there for a plan that is not Even it out, or for a job that is already evened out", () => {
    expect(offerViewOf(panel, select("followBills"))).toBeNull();
    expect(offerViewOf(panel, select("setAmount"))).toBeNull();
    expect(offerViewOf(spend({ plan: evenOut(kr(3_050), "2026-11"), opening: kr(3_800) }), select("evenOut"))).toBeNull();
  });
});

describe("when the buffer cannot pay the seed", () => {
  const poor = spend({ bufferBalance: kr(1_000) });

  it("disables the card for starting now, says what the buffer holds, and starts later by default", () => {
    const view = offerViewOf(poor, select("evenOut", "later"));
    expect(view?.cards[0]).toMatchObject({ key: "now", blockedBy: "bufferHoldsLess" });
    expect(view?.cards[1]).toMatchObject({ key: "later", blockedBy: null });
    const now = offerViewOf(poor, select("evenOut", "now"));
    expect(now?.explanation).toMatchObject({ kind: "now", blockedBy: "bufferHoldsLess", source: null, bufferHolds: kr(1_000), bufferAfter: null });
  });

  it("says that a month which is not open has nowhere to record the move", () => {
    const view = offerViewOf(spend({ november: "planned" }), select("evenOut", "now"));
    expect(view?.cards[0]?.blockedBy).toBe("monthNotStarted");
  });

  it("says the buffer holds too little when it is empty", () => {
    const view = offerViewOf(spend({ bufferBalance: kr(0) }), select("evenOut", "now"));
    expect(view?.cards[0]?.blockedBy).toBe("bufferHoldsLess");
  });

  it("says there is no buffer to take from when the household has none", () => {
    const { facts, jobs } = electricityHousehold({ plan: followBills() });
    const jobsWithoutBuffer = new Map(facts.jobs);
    jobsWithoutBuffer.delete(jobs.buffer);
    const without = { ...facts, jobs: jobsWithoutBuffer };
    const found = panelOf(without, computeFigures(without, electricityToday), jobs.electricity, electricityToday);
    if (found?.kind !== "spend") throw new Error("Not a spend panel");
    const view = offerViewOf(found, select("evenOut", "now"));
    expect(view?.cards[0]).toMatchObject({ blockedBy: "noBuffer", source: null });
    expect(view?.explanation).toMatchObject({ kind: "now", blockedBy: "noBuffer", bufferHolds: null });
  });
});

describe("when the bucket needs no seed", () => {
  it("offers only to start now, with nothing to move", () => {
    const rich = spend({ opening: kr(5_000), keepsMoney: true });
    const view = offerViewOf(rich, select("evenOut"));
    expect(view?.cards.map((c) => c.key)).toEqual(["now"]);
    expect(view?.cards[0]?.seed).toBe(0);
    expect(view?.intro.kind).toBe("holds");
    expect(view?.explanation).toMatchObject({ kind: "now", seed: 0, source: null, bankMove: false });
  });
});

describe("Follow the bills", () => {
  it("says which month the plan peaks in and which it is lowest in, as the estimate has them", () => {
    expect(followViewOf(spend())).toEqual({ highest: { month: "2027-01", amount: kr(4_420) }, lowest: { month: "2027-07", amount: kr(1_820) } });
  });
});

describe("a job that is already evened out", () => {
  const proposing = spend({ plan: evenOut(kr(2_500), "2026-11"), opening: kr(0) });

  it("says where its bucket goes and when it would run dry", () => {
    const view = evenedOutViewOf(proposing.offer);
    expect(view).toMatchObject({ monthly: kr(2_500), startMonth: "2026-11" });
    expect(view?.runsDryIn).not.toBeNull();
    expect(view?.course.lowest.amount).toBeLessThan(0);
  });

  it("proposes a higher amount that keeps the bucket above zero, and says what it changes", () => {
    const view = evenedOutViewOf(proposing.offer);
    expect(view?.proposal?.monthly).toBeGreaterThan(kr(2_500));
    expect(view?.proposal?.course.lowest.amount).toBeGreaterThanOrEqual(0);
    expect(view?.proposal?.changes.length).toBeGreaterThan(0);
  });

  it("proposes nothing when the bucket holds, and nothing for a job that is not evened out", () => {
    expect(evenedOutViewOf(spend({ plan: evenOut(kr(3_050), "2026-11"), opening: kr(3_800) }).offer)?.proposal).toBeNull();
    expect(evenedOutViewOf(spend().offer)).toBeNull();
    expect(evenedOutViewOf(null)).toBeNull();
  });
});

describe("for any household around a variable cost", () => {
  it("says the lowest point and the end of the year that the chart draws for the chosen start", () => {
    let seen = 0;
    fc.assert(
      fc.property(arbitraryVariableCost(), fc.constantFrom("now" as const, "later" as const), (c, start) => {
        const figures = computeFigures(c.facts, c.asOf);
        const panel = panelOf(c.facts, figures, c.job, c.asOf);
        if (panel?.kind !== "spend") return;
        const selection = select("evenOut", start);
        const view = offerViewOf(panel, selection);
        if (view === null) return;
        const input = chartInputOf(panel, selection);
        if (input === null) return;
        seen += 1;
        const series = seriesOf(input);
        const layout = layoutChart(series, { width: 360, height: 236 }, 100);
        const course = view.explanation.course;
        expect(layout.lowest).toMatchObject({ month: course.lowest.month, amount: course.lowest.amount });
        expect(series.points.at(-1)?.bucket).toBe(course.last.amount);
        expect(series.points.at(-1)?.month).toBe(course.last.month);
        expect(view.cards.some((card) => card.key === view.chosen)).toBe(true);
      }),
      { numRuns: 150 },
    );
    expect(seen, "the property reached offers").toBeGreaterThan(20);
  });
});
