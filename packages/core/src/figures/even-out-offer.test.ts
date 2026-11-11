import { describe, expect, it } from "vitest";
import { type Command, apply } from "../commands/apply.ts";
import { localDate } from "../dates.ts";
import { minimumSeed } from "../even-out.ts";
import { bucketTransferId, moveId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { electricityEstimatesKroner, electricityHousehold, electricityToday } from "../testing/electricity-household.ts";
import { evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount, testId } from "../testing/facts-builder.ts";
import { snapshotOf } from "../testing/variable-cost-household.ts";
import { type EvenedOutOffer, evenOutOffer, startNowCommands } from "./even-out-offer.ts";
import { jobForecast } from "./forecast.ts";

/** An ID supplier that records what it was asked for, in order. */
function idsFor() {
  const asked: string[] = [];
  let n = 700;
  return {
    asked,
    ids: {
      transfer: () => (asked.push("transfer"), bucketTransferId(testId(n++))),
      move: () => (asked.push("move"), moveId(testId(n++))),
    },
  };
}

function startOffer(options: Parameters<typeof electricityHousehold>[0] = { assignedBefore: "matchingBills" }) {
  const h = electricityHousehold(options);
  const offer = evenOutOffer(h.facts, h.jobs.electricity, electricityToday);
  if (offer?.kind !== "start") throw new Error(`Expected an offer to start, got ${offer?.kind}`);
  return { ...h, offer };
}

function evenedOffer(offer: ReturnType<typeof evenOutOffer>): EvenedOutOffer {
  if (offer?.kind !== "evenedOut") throw new Error(`Expected an evened-out job, got ${offer?.kind}`);
  return offer;
}

const run = (facts: ReturnType<typeof electricityHousehold>["facts"], command: Command) => {
  const result = apply(facts, command, { asOf: electricityToday });
  if (!result.ok) throw new Error(`Refused (${result.refusal.code}): ${result.refusal.message}`);
  return result.facts;
};

describe("the Electricity offer, with the mockup's numbers", () => {
  const { offer, facts, jobs, accounts } = startOffer();

  it("works the monthly amount out of the twelve estimates: 36,300 kr ÷ 12 = 3,025 kr, rounded up to the 50 kr step, 3,050 kr", () => {
    expect(offer.monthly).toBe(kr(3_050));
    expect(offer.step).toBe(kr(50));
  });

  it("shows the bucket if evening out started now with nothing moved in: below zero from November, 3,950 kr short in March", () => {
    expect(offer.withoutSeed.months.map((m) => m.bucketEnd)).toEqual([-250, -1400, -2770, -3700, -3950, -3600, -2744, -1564, -334, -44, 96, 300].map(kr));
    expect(offer.withoutSeed.runsDryIn).toBe("2026-11");
    expect(offer.withoutSeed.lowest).toEqual({ month: "2027-03", amount: kr(-3_950) });
  });

  it("offers a seed of 4,000 kr to start now: the 3,950 kr it needs and one 50 kr step to spare, not the mockup's 4,100 kr", () => {
    expect(offer.startNow.seed).toBe(kr(4_000));
    expect(offer.startNow.forecast.lowest).toEqual({ month: "2027-03", amount: kr(50) });
    expect(offer.startNow.forecast.months.map((m) => m.bucketEnd)).toEqual([3750, 2600, 1230, 300, 50, 400, 1256, 2436, 3666, 3956, 4096, 4300].map(kr));
    expect(offer.startNow.forecast.runsDryIn).toBeNull();
  });

  it("is the rule of `minimumSeed`: the mockup's 4,100 kr is the same rule with a margin of 150 kr, three steps", () => {
    const bills = electricityEstimatesKroner.map(kr);
    expect(minimumSeed(bills, kr(3_050), { step: kr(50), margin: kr(50) })).toBe(offer.startNow.seed);
    expect(minimumSeed(bills, kr(3_050), { step: kr(50), margin: kr(150) })).toBe(kr(4_100));
  });

  it("takes the seed from the buffer, which holds 86,000 kr, leaving 82,000 kr and a runway of 1.5 months", () => {
    expect(offer.startNow.source).toEqual({ jobId: jobs.buffer, name: "Buffer", accountId: accounts.savings, holds: kr(86_000) });
    expect(offer.startNow.bufferAfter).toEqual({ balance: kr(82_000), runway: { kind: "tenthsOfAMonth", tenths: 15 } });
    expect(offer.startNow.blockedBy).toBeNull();
  });

  it("needs a move at the bank, because the buffer is in the savings account and Electricity is paid from the bills account", () => {
    expect(offer.startNow.bankMove).toEqual({ from: accounts.savings, to: accounts.bills });
  });

  it("raises November from 2,900 kr to 3,050 kr, the one open month the plan now covers", () => {
    expect(offer.startNow.assignments).toEqual([{ month: "2026-11", from: kr(2_900), to: kr(3_050) }]);
  });

  it("offers to start in April: the bills until then, 3,050 kr from April, and the bucket at 4,250 kr by October with no seed", () => {
    expect(offer.startLater?.startMonth).toBe("2027-04");
    const months = offer.startLater?.forecast.months ?? [];
    expect(months.map((m) => m.planned)).toEqual([3300, 4200, 4420, 3980, 3300, 3050, 3050, 3050, 3050, 3050, 3050, 3050].map(kr));
    expect(months.at(-1)?.bucketEnd).toBe(kr(4_250));
    expect(offer.startLater?.forecast.runsDryIn).toBeNull();
    expect(offer.startLater?.assignments).toEqual([{ month: "2026-11", from: kr(2_900), to: kr(3_300) }]);
  });

  it("reads the facts and changes none", () => {
    const before = snapshotOf(facts);
    evenOutOffer(facts, jobs.electricity, electricityToday);
    expect(snapshotOf(facts)).toEqual(before);
  });
});

describe("the commands that start now", () => {
  const { offer, facts, jobs, accounts } = startOffer();

  it("are one batch: the plan, November's assignment, the move between buckets and the move at the bank, with the IDs asked for in that order", () => {
    const { ids, asked } = idsFor();
    const batch = startNowCommands(offer, { ids, reason: "Start evening out Electricity" });
    expect(asked).toEqual(["transfer", "move"]);
    expect(batch).toEqual({
      kind: "batch",
      commands: [
        { kind: "changeJob", jobId: jobs.electricity, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly: kr(3_050), startMonth: "2026-11" } } } },
        { kind: "assign", month: "2026-11", jobId: jobs.electricity, amount: kr(3_050) },
        {
          kind: "moveBucket",
          transfer: { id: testId(700), month: "2026-11", from: jobs.buffer, to: jobs.electricity, amount: kr(4_000), reason: "Start evening out Electricity" },
        },
        {
          kind: "addMove",
          move: { id: testId(701), from: accounts.savings, to: accounts.bills, amount: kr(4_000), month: "2026-11", reason: "Start evening out Electricity" },
        },
      ],
    });
  });

  it("are accepted, and leave the bucket exactly as the offer shows it", () => {
    const batch = startNowCommands(offer, { ids: idsFor().ids, reason: "Start evening out Electricity" });
    if (batch === null) throw new Error("Expected commands");
    const after = run(facts, batch);
    expect(jobForecast(after, jobs.electricity, electricityToday)).toEqual(offer.startNow.forecast);
    expect([...after.bucketTransfers.values()]).toMatchObject([{ amount: kr(4_000), from: jobs.buffer, to: jobs.electricity }]);
    expect([...after.moves.values()]).toMatchObject([{ amount: kr(4_000), from: accounts.savings, to: accounts.bills, status: "todo" }]);
  });

  it("leave the buffer at 82,000 kr with the runway the offer shows", () => {
    const batch = startNowCommands(offer, { ids: idsFor().ids, reason: "Start evening out Electricity" });
    if (batch === null) throw new Error("Expected commands");
    const after = run(facts, batch);
    const buffer = jobForecast(after, jobs.buffer, electricityToday);
    expect(buffer?.months[0]?.bucketEnd).toBe(kr(82_000));
  });

  it("make no move at the bank when the buffer and the job share an account", () => {
    const shared = startOffer({ assignedBefore: "matchingBills", paidFrom: "savings" });
    expect(shared.offer.startNow.bankMove).toBeNull();
    const { ids, asked } = idsFor();
    const batch = startNowCommands(shared.offer, { ids, reason: "Start evening out" });
    expect(asked).toEqual(["transfer"]);
    expect(batch?.commands.map((c) => c.kind)).toEqual(["changeJob", "assign", "moveBucket"]);
    expect(run(shared.facts, batch as Command).moves.size).toBe(0);
  });

  it("are the same for the same offer, so a screen can build them again", () => {
    expect(startNowCommands(offer, { ids: idsFor().ids, reason: "r" })).toEqual(startNowCommands(offer, { ids: idsFor().ids, reason: "r" }));
  });
});

describe("the commands that start later", () => {
  it("are one batch that needs no IDs: the plan from April and November following the estimate, 3,300 kr", () => {
    const { offer, facts, jobs } = startOffer();
    expect(offer.startLater?.command).toEqual({
      kind: "batch",
      commands: [
        { kind: "changeJob", jobId: jobs.electricity, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly: kr(3_050), startMonth: "2027-04" } } } },
        { kind: "assign", month: "2026-11", jobId: jobs.electricity, amount: kr(3_300) },
      ],
    });
    const after = run(facts, offer.startLater?.command as Command);
    expect(jobForecast(after, jobs.electricity, electricityToday)).toEqual(offer.startLater?.forecast);
    expect(after.bucketTransfers.size).toBe(0);
  });
});

describe("the Electricity job as the mockup tells it, planned at 2,900 kr every month", () => {
  it("counts the 200 kr it was under-spent from January to October as already in the bucket, so the seed is 200 kr lower", () => {
    const { offer } = startOffer({ assignedBefore: "mockup" });
    expect(offer.withoutSeed.startsWith).toBe(kr(200));
    expect(offer.startNow.seed).toBe(kr(3_800));
    expect(offer.startNow.forecast.lowest).toEqual({ month: "2027-03", amount: kr(50) });
  });
});

describe("when no seed is needed", () => {
  it("says so with a seed of 0, offers nothing to wait for, and the commands move nothing", () => {
    const { offer, facts, jobs } = startOffer({ assignedBefore: "matchingBills", keepsMoney: true, opening: kr(10_000) });
    expect(offer.startNow.seed).toBe(0);
    expect([offer.startNow.source, offer.startNow.bankMove, offer.startNow.bufferAfter, offer.startNow.blockedBy]).toEqual([null, null, null, null]);
    expect(offer.startLater).toBeNull();
    const { ids, asked } = idsFor();
    const batch = startNowCommands(offer, { ids, reason: "unused" });
    expect(asked).toEqual([]);
    expect(batch?.commands.map((c) => c.kind)).toEqual(["changeJob", "assign"]);
    expect(jobForecast(run(facts, batch as Command), jobs.electricity, electricityToday)).toEqual(offer.startNow.forecast);
  });

  it("needs none when the bucket touches zero exactly, but a full seed of two steps one øre below", () => {
    const touching = startOffer({ assignedBefore: "matchingBills", keepsMoney: true, opening: kr(3_950) });
    expect(touching.offer.withoutSeed.lowest.amount).toBe(0);
    expect(touching.offer.startNow.seed).toBe(0);
    const below = startOffer({ assignedBefore: "matchingBills", keepsMoney: true, opening: money(kr(3_950) - 1) });
    expect(below.offer.withoutSeed.lowest.amount).toBe(-1);
    expect(below.offer.startNow.seed).toBe(kr(100));
    expect(below.offer.startNow.forecast.lowest.amount).toBe(kr(100) - 1);
  });
});

describe("when the seed can't be moved yet", () => {
  it("says the buffer holds less, keeps the numbers, still offers April, and gives no commands to start now", () => {
    const { offer } = startOffer({ assignedBefore: "matchingBills", bufferBalance: kr(3_000) });
    expect(offer.startNow).toMatchObject({ seed: kr(4_000), source: null, bankMove: null, bufferAfter: null, blockedBy: "bufferHoldsLess" });
    expect(startNowCommands(offer, { ids: idsFor().ids, reason: "r" })).toBeNull();
    expect(offer.startLater?.startMonth).toBe("2027-04");
  });

  it("takes the seed from a buffer that holds exactly that much", () => {
    const { offer } = startOffer({ assignedBefore: "matchingBills", bufferBalance: kr(4_000) });
    expect(offer.startNow.blockedBy).toBeNull();
    expect(offer.startNow.bufferAfter?.balance).toBe(0);
    const short = startOffer({ assignedBefore: "matchingBills", bufferBalance: money(kr(4_000) - 1) });
    expect(short.offer.startNow.blockedBy).toBe("bufferHoldsLess");
  });

  it("says the month hasn't started when this month has no budget month to record the move in", () => {
    const { offer } = startOffer({ assignedBefore: "matchingBills", november: "planned" });
    expect(offer.startNow.blockedBy).toBe("monthNotStarted");
    expect(startNowCommands(offer, { ids: idsFor().ids, reason: "r" })).toBeNull();
    expect(offer.startNow.assignments).toEqual([]);
  });

  it("says there is no buffer in a household that has none", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills" });
    const withoutBuffer = { ...h.facts, jobs: new Map([...h.facts.jobs].filter(([id]) => id !== h.jobs.buffer)) };
    const offer = evenOutOffer(withoutBuffer, h.jobs.electricity, electricityToday);
    expect(offer?.kind === "start" && offer.startNow.blockedBy).toBe("noBuffer");
  });
});

describe("a month the family has closed", () => {
  it("keeps its assignment, so the plan can't raise it, and the seed grows to cover the difference", () => {
    const { offer, facts, jobs } = startOffer({ assignedBefore: "matchingBills", november: "closed" });
    expect(offer.startNow.assignments).toEqual([]);
    expect(offer.startNow.forecast.months[0]?.planned).toBe(kr(2_900));
    expect(offer.startNow.seed).toBe(kr(4_150));
    const batch = startNowCommands(offer, { ids: idsFor().ids, reason: "r" });
    expect(jobForecast(run(facts, batch as Command), jobs.electricity, electricityToday)).toEqual(offer.startNow.forecast);
  });
});

describe("what moves the monthly amount", () => {
  it("rounds up to a household's own step", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills" });
    const hundred = { ...h.facts, household: new Map([...h.facts.household].map(([id, row]) => [id, { ...row, evenOutStep: kr(100) }] as const)) };
    const offer = evenOutOffer(hundred, h.jobs.electricity, electricityToday);
    expect(offer?.kind === "start" && [offer.monthly, offer.step, offer.startNow.seed]).toEqual([kr(3_100), kr(100), kr(3_800)]);
  });

  it("follows a figure you typed for a month", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills" });
    h.b.enteredValue({ kind: "estimateOverride", subject: `${h.jobs.electricity}/2027-01`, value: kr(10_000), asOf: "2026-11-02" });
    const offer = evenOutOffer(h.b.facts(), h.jobs.electricity, electricityToday);
    expect(offer?.kind === "start" && offer.monthly).toBe(kr(3_500));
  });

  it("counts the bill already paid this month when it is more than the estimate", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills" });
    h.b.spend({ date: "2026-11-05", amount: kr(-4_300), jobId: h.jobs.electricity, accountId: h.accounts.bills });
    const offer = evenOutOffer(h.b.facts(), h.jobs.electricity, electricityToday);
    expect(offer?.kind === "start" && offer.monthly).toBe(kr(3_150));
  });

  it("is 0 a month, with no seed, for a job with no bills to go on, and still reads as an offer", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    b.account({ name: "Bills" });
    b.group({ name: "Fixed" });
    const job = b.spendJob({ plan: followBills() });
    b.buffer({ monthly: kr(0), opening: kr(1_000) });
    const offer = evenOutOffer(b.facts(), job, localDate("2026-01-10"));
    expect(offer?.kind === "start" && [offer.monthly, offer.startNow.seed, offer.startLater]).toEqual([0, 0, null]);
  });
});

describe("both ways of planning a job offer to even it out", () => {
  it("gives a job that follows the bills the same offer as one with a set amount", () => {
    const setAmountOffer = startOffer({ assignedBefore: "matchingBills", plan: setAmount(kr(2_900)) }).offer;
    const followOffer = startOffer({ assignedBefore: "matchingBills", plan: followBills() }).offer;
    expect(followOffer.monthly).toBe(setAmountOffer.monthly);
    expect(followOffer.startNow.seed).toBe(setAmountOffer.startNow.seed);
    expect(followOffer.startLater?.startMonth).toBe("2027-04");
  });

  it("starts from what a job that keeps its money already holds", () => {
    const { offer } = startOffer({ assignedBefore: "matchingBills", keepsMoney: true, opening: kr(1_000) });
    expect(offer.withoutSeed.startsWith).toBe(kr(1_000));
    expect(offer.startNow.seed).toBe(kr(3_000));
  });
});

describe("a job already evened out", () => {
  const evened = (seed: Money | null, novemberAssigned: Money = kr(3_050)) => {
    const h = electricityHousehold({ assignedBefore: "matchingBills", plan: evenOut(kr(3_050), "2026-11"), novemberAssigned });
    if (seed !== null) h.b.bucketTransfer({ month: "2026-11", from: h.jobs.buffer, to: h.jobs.electricity, amount: seed, reason: "Start evening out" });
    return { ...h, facts: h.b.facts() };
  };

  it("proposes the smallest higher amount that keeps the bucket at or above zero: 4,000 kr, not 3,050 kr, for a bucket that started empty", () => {
    const h = evened(null);
    const offer = evenedOffer(evenOutOffer(h.facts, h.jobs.electricity, electricityToday));
    expect(offer).toMatchObject({ monthly: kr(3_050), startMonth: "2026-11" });
    expect(offer.forecast.runsDryIn).toBe("2026-11");
    expect(offer.proposal?.monthly).toBe(kr(4_000));
    expect(offer.proposal?.forecast.lowest).toEqual({ month: "2027-01", amount: kr(80) });
    expect(offer.proposal?.assignments).toEqual([{ month: "2026-11", from: kr(3_050), to: kr(4_000) }]);
  });

  it("makes a proposal that, once the family applies it, gives the forecast it shows, and changes nothing before", () => {
    const h = evened(null);
    const before = snapshotOf(h.facts);
    const offer = evenedOffer(evenOutOffer(h.facts, h.jobs.electricity, electricityToday));
    expect(snapshotOf(h.facts)).toEqual(before);
    const after = run(h.facts, offer.proposal?.command as Command);
    expect(jobForecast(after, h.jobs.electricity, electricityToday)).toEqual(offer.proposal?.forecast);
  });

  it("proposes nothing when the bucket stays at or above zero, and gives the forecast as it stands", () => {
    const h = evened(kr(4_100));
    const offer = evenedOffer(evenOutOffer(h.facts, h.jobs.electricity, electricityToday));
    expect(offer.proposal).toBeNull();
    expect(offer.forecast).toEqual(jobForecast(h.facts, h.jobs.electricity, electricityToday));
    expect(offer.forecast.lowest).toEqual({ month: "2027-03", amount: kr(150) });
  });

  it("proposes nothing for a dip that comes before evening out starts, because no monthly amount can fill it", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills", plan: evenOut(kr(3_050), "2027-04") });
    const offer = evenedOffer(evenOutOffer(h.facts, h.jobs.electricity, electricityToday));
    expect(offer.forecast.runsDryIn).toBe("2026-11");
    expect(offer.proposal).toBeNull();
  });

  it("proposes nothing when the dip is only a month the family assigned less to, because the plan's own amount would hold", () => {
    const h = evened(kr(4_100), kr(500));
    const offer = evenedOffer(evenOutOffer(h.facts, h.jobs.electricity, electricityToday));
    expect(offer.forecast.runsDryIn).toBe("2027-01");
    expect(offer.proposal).toBeNull();
  });
});

describe("a job already evened out in a household that never opened its months", () => {
  it("counts the months before this one, which project the monthly amount too, so a higher amount also lifts the bucket the month starts with", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    b.account({ name: "Bills" });
    b.group({ name: "Fixed" });
    const job = b.spendJob({ plan: evenOut(kr(1_000), "2026-01") });
    b.buffer({ monthly: kr(0), opening: kr(1_000) });
    for (const m of ["2025-11", "2025-12"]) b.history({ date: `${m}-10`, amount: kr(-3_000), jobId: job });
    const facts = b.facts();
    const offer = evenedOffer(evenOutOffer(facts, job, localDate("2026-02-10")));
    expect(offer.forecast.startsWith).toBe(kr(1_000));
    expect(offer.proposal?.monthly).toBe(kr(2_800));
    expect(offer.proposal?.forecast.startsWith).toBe(kr(2_800));
    expect(offer.proposal?.forecast.lowest.amount).toBeGreaterThanOrEqual(0);
    expect(offer.proposal?.command).toMatchObject({ commands: [{ kind: "changeJob" }] });
  });
});

describe("which jobs get an offer", () => {
  const h = electricityHousehold({ assignedBefore: "matchingBills" });

  it("is nothing for a paused job, a save-up job, a job that isn't there, and a plan that hasn't started", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const paused = b.spendJob({ plan: followBills(), status: "paused" });
    const holiday = b.saveUpJob({ target: monthlySaving(kr(500)) });
    expect(evenOutOffer(b.facts(), paused, localDate("2026-02-10"))).toBeNull();
    expect(evenOutOffer(b.facts(), holiday, localDate("2026-02-10"))).toBeNull();
    expect(evenOutOffer(h.facts, "00000000-0000-7000-8000-00000000ffff" as typeof h.jobs.buffer, electricityToday)).toBeNull();
    const later = factsBuilder({ planStart: "2027-03" });
    const job = later.spendJob({ plan: followBills() });
    expect(evenOutOffer(later.facts(), job, localDate("2026-11-10"))).toBeNull();
  });
});
