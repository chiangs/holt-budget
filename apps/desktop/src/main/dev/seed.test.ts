import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Facts, type Job, type LocalDate, type Month, addMonths, apply, checkFacts, computeFigures, contributionStatuses, householdOf, localDate, monthOf, monthsBetween, money, moneyIn } from "@holt/core";
import { kr } from "@holt/core/testing";
import { syntheticAccounts, syntheticElectricityBills } from "@holt/importers/synthetic";
import { createMint } from "../../shared/ids.ts";
import type { Clock } from "../clock.ts";
import { openFactsStore } from "../facts/index.ts";
import { createImports } from "../imports/imports.ts";
import { openDatabase } from "../storage/database.ts";
import { type DataKey, newDataKey } from "../storage/keys.ts";
import { type SeedDeps, devPassphrase, seedDevData } from "./seed.ts";

let parent: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "holt-seed-"));
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

const clockOn = (date: string): Clock => ({ today: () => localDate(date), now: () => new Date(`${date}T09:30:00.000Z`) });

/** The real key store needs Electron's keyring, so the tests stand in a marker file and remember the key. */
function setup(overrides: Partial<SeedDeps> = {}, date = "2026-11-10") {
  const clock = clockOn(date);
  const issued: { key: DataKey | null; passphrase: string | null; created: number } = { key: null, passphrase: null, created: 0 };
  const deps: SeedDeps = {
    clock,
    mint: createMint(),
    packaged: false,
    reseed: false,
    keys: {
      exists: (folder) => existsSync(join(folder, "keys.json")),
      create: async (folder, passphrase) => {
        writeFileSync(join(folder, "keys.json"), "{}");
        issued.key = newDataKey();
        issued.passphrase = passphrase;
        issued.created += 1;
        return { key: issued.key };
      },
    },
    ...overrides,
  };
  const folder = join(parent, "holt-dev");
  const load = (): Facts => {
    const db = openDatabase(join(folder, "holt.db"), issued.key!);
    try {
      return openFactsStore(db, { clock, mint: deps.mint })!.facts();
    } finally {
      db.close();
    }
  };
  return { deps, folder, issued, clock, load };
}

describe("where the seed will write", () => {
  it("refuses a folder not named holt-dev, and touches nothing", async () => {
    const { deps, issued } = setup();
    for (const name of ["holt", "holt-dev-copy", "Holt-Dev", "family"]) {
      const folder = join(parent, name);
      await expect(seedDevData(folder, deps)).rejects.toThrow(/holt-dev/);
      expect(existsSync(folder)).toBe(false);
    }
    expect(issued.created).toBe(0);
  });

  it("refuses to run in the packaged app", async () => {
    const { deps, folder, issued } = setup({ packaged: true });
    await expect(seedDevData(folder, deps)).rejects.toThrow(/packaged/);
    expect(existsSync(folder)).toBe(false);
    expect(issued.created).toBe(0);
  });

  it("refuses to clear a folder it would refuse to seed", async () => {
    const family = join(parent, "holt");
    mkdirSync(family);
    writeFileSync(join(family, "holt.db"), "the family's data");
    const { deps } = setup({ reseed: true });
    await expect(seedDevData(family, deps)).rejects.toThrow();
    expect(readFileSync(join(family, "holt.db"), "utf8")).toBe("the family's data");

    const packaged = setup({ reseed: true, packaged: true });
    mkdirSync(packaged.folder);
    writeFileSync(join(packaged.folder, "holt.db"), "kept");
    await expect(seedDevData(packaged.folder, packaged.deps)).rejects.toThrow();
    expect(readFileSync(join(packaged.folder, "holt.db"), "utf8")).toBe("kept");
  });
});

describe("the household it makes", () => {
  it("is a household in kroner with six shared accounts, four the household pays into, forty-six jobs and a plan that starts three months before today", async () => {
    const { deps, folder, load } = setup();
    expect(await seedDevData(folder, deps)).toMatchObject({ seeded: true, imported: 3 });
    const facts = load();
    const household = [...facts.household.values()][0]!;
    expect(household).toMatchObject({ currency: "NOK", planStart: "2026-08" });
    expect(facts.jobs.size).toBe(46);
    expect(checkFacts(facts)).toEqual([]);
    const shared = [...facts.accounts.values()].filter((a) => a.scope === "shared");
    const { bulder, sparebank1 } = syntheticAccounts;
    expect(shared.map((a) => a.number).sort()).toEqual([bulder.everyday, bulder.bills, bulder.food, bulder.holiday, sparebank1.loanPayments, sparebank1.deposit].map((a) => a.number).sort());
    expect(shared.map((a) => a.name).sort()).toEqual(["Bills", "Deposit", "Everyday", "Food", "Holiday", "Loan payments"]);
    expect([...facts.accounts.values()].filter((a) => a.scope === "paidInto")).toHaveLength(4);
  });

  it("has things waiting for the family and an account that is due, as the real import left them", async () => {
    const { deps, folder, load, clock } = setup();
    await seedDevData(folder, deps);
    const facts = load();
    const figures = computeFigures(facts, clock.today());
    expect(figures.needsYou.length).toBeGreaterThan(10);
    expect(figures.importStatus.due).toBeGreaterThan(0);
    expect([...facts.importBatches.values()].map((b) => b.fileName).sort()).toEqual(["bulder.csv", "sparebank1-deposit.csv", "sparebank1-loan-payments.csv"]);
    expect([...facts.transactions.values()].some((t) => t.ruleId !== undefined)).toBe(true);
    expect([...facts.budgetMonths.values()].map((m) => m.state)).toEqual(["closed", "closed", "closed", "open"]);
  });

  it("still has them years from now, because the bank files follow the clock", async () => {
    const { deps, folder, load, clock } = setup({}, "2029-05-20");
    await seedDevData(folder, deps);
    const figures = computeFigures(load(), clock.today());
    expect(figures.needsYou.length).toBeGreaterThan(10);
    expect(figures.importStatus.due).toBeGreaterThan(0);
  });

  it("leaves one overlapping bank file for a developer to import by hand", async () => {
    const { deps, folder, load, issued, clock } = setup();
    await seedDevData(folder, deps);
    const samples = readdirSync(join(folder, "sample-imports")).sort();
    expect(samples).toEqual(["bulder-later.csv", "bulder.csv", "sparebank1-deposit.csv", "sparebank1-loan-payments.csv"]);

    const db = openDatabase(join(folder, "holt.db"), issued.key!);
    const store = openFactsStore(db, { clock, mint: deps.mint })!;
    const imports = createImports(store, { clock, mint: deps.mint, pickFile: async () => null, readFile: async () => ({ kind: "unreadable", reason: "missing" }) });
    const bytes = readFileSync(join(folder, "sample-imports", "bulder-later.csv"));
    const opened = imports.planBytes(bytes, "bulder-later.csv");
    db.close();
    expect(opened).toMatchObject({ kind: "opened", preview: { counts: { matched: expect.any(Number) } } });
    if (opened.kind !== "opened") return;
    expect(opened.preview.counts.matched).toBeGreaterThan(0);
    expect(opened.preview.counts.created).toBeGreaterThan(0);
    expect(load().importBatches.size).toBe(3);
  });

  it("protects the keys with the development passphrase", async () => {
    const { deps, folder, issued } = setup();
    await seedDevData(folder, deps);
    expect(issued.passphrase).toBe(devPassphrase);
  });
});

describe("starting again", () => {
  it("does nothing when the keys are already there", async () => {
    const { deps, folder, issued, load } = setup();
    await seedDevData(folder, deps);
    const before = JSON.stringify([...load().transactions.keys()]);
    expect(await seedDevData(folder, deps)).toEqual({ seeded: false });
    expect(issued.created).toBe(1);
    expect(JSON.stringify([...load().transactions.keys()])).toBe(before);
  });

  it("clears the folder and seeds again when asked", async () => {
    const first = setup();
    await seedDevData(first.folder, first.deps);
    writeFileSync(join(first.folder, "stale.txt"), "left over");
    const again = setup({ reseed: true });
    expect(await seedDevData(again.folder, again.deps)).toMatchObject({ seeded: true });
    expect(existsSync(join(again.folder, "stale.txt"))).toBe(false);
    expect(again.load().jobs.size).toBe(46);
  });

  it("leaves nothing behind when it fails, so the next launch tries again", async () => {
    const { deps, folder } = setup();
    const failing: SeedDeps = {
      ...deps,
      keys: {
        ...deps.keys,
        create: async (where, passphrase) => {
          await deps.keys.create(where, passphrase);
          throw new Error("the keyring went away");
        },
      },
    };
    await expect(seedDevData(folder, failing)).rejects.toThrow("keyring");
    expect(existsSync(folder)).toBe(false);
    expect(await seedDevData(folder, deps)).toMatchObject({ seeded: true });
  });
});

/** A seeded household and its figures for a day. */
async function householdOn(date: string) {
  const world = setup({}, date);
  await seedDevData(world.folder, world.deps);
  const facts = world.load();
  const today = world.clock.today();
  return { facts, today, current: monthOf(today), figures: computeFigures(facts, today) };
}

const jobNamed = (facts: Facts, name: string): Job => {
  const found = [...facts.jobs.values()].find((j) => j.name === name);
  if (found === undefined) throw new Error(`The seed has no job ${name}`);
  return found;
};
const accountNamed = (facts: Facts, name: string) => [...facts.accounts.values()].find((a) => a.name === name)!;

describe.each(["2026-11-10", "2026-12-01", "2027-02-01", "2029-05-20"])("what the Plan screens need, on %s", (date) => {
  it("is sound, and the open month is the current one with the months before it closed", async () => {
    const { facts, current, figures } = await householdOn(date);
    expect(checkFacts(facts)).toEqual([]);
    const states = [...facts.budgetMonths.values()];
    expect(states.map((m) => m.month)).toEqual([-3, -2, -1, 0].map((n) => addMonths(current, n)));
    expect(states.map((m) => m.state)).toEqual(["closed", "closed", "closed", "open"]);
    expect(householdOf(facts).planStart).toBe(addMonths(current, -3));
    expect(figures.months.get(current)?.state).toBe("open");
  });

  it("has two adults and four children, whose birth months give the ages 15, 11, 8 and 4", async () => {
    const { facts, current } = await householdOn(date);
    const people = [...facts.people.values()];
    expect(people.filter((p) => p.kind === "adult").map((p) => p.name)).toEqual(["Stephen", "Partner"]);
    const children = people.filter((p) => p.kind === "child");
    expect(children.map((p) => p.name)).toEqual(["Eldest", "Second", "Third", "Youngest"]);
    expect(children.map((p) => Math.floor(monthsBetween(p.birthMonth!, current) / 12))).toEqual([15, 11, 8, 4]);
  });

  it("has an agreement for each adult, into the everyday account on the 20th, from the plan start", async () => {
    const { facts, current } = await householdOn(date);
    const everyday = accountNamed(facts, "Everyday");
    const named = (name: string) => [...facts.people.values()].find((p) => p.name === name)!;
    const agreements = [...facts.contributionAgreements.values()];
    expect(agreements.map((a) => [facts.people.get(a.personId)?.name, a.amount, a.day, a.accountId, a.from, a.to])).toEqual([
      ["Stephen", kr(32_000), 20, everyday.id, addMonths(current, -3), undefined],
      ["Partner", kr(28_000), 20, everyday.id, addMonths(current, -3), undefined],
    ]);
    expect(named("Stephen").kind).toBe("adult");
  });

  it("shows this month's money as arrived for Stephen and in two parts for Partner, and next month's as expected", async () => {
    const { facts, today, current } = await householdOn(date);
    const status = (name: string, month: Month) => contributionStatuses(facts, today).find((c) => c.personName === name && c.fundsMonth === month);
    expect(status("Stephen", current)).toMatchObject({ state: "arrived", agreed: kr(32_000), arrived: kr(32_000), expectedOn: `${addMonths(current, -1)}-20` });
    expect(status("Partner", current)).toMatchObject({ state: "parts", agreed: kr(28_000), arrived: kr(28_000) });
    expect(status("Partner", current)?.transactionIds).toHaveLength(2);
    const next = addMonths(current, 1);
    const nextState = (name: string) => status(name, next)?.state;
    expect(nextState("Stephen")).toBe(today.slice(8) > "20" ? "arrived" : "expected");
    expect(moneyIn(facts, today, 1)[0]).toMatchObject({ month: current, actual: kr(60_000), expected: money(0) });
  });

  it("links each contribution to its agreement as income that funds the month after it was booked", async () => {
    const { facts, current } = await householdOn(date);
    const linked = [...facts.transactions.values()].filter((t) => t.treatment.kind === "income");
    expect(linked.length).toBeGreaterThanOrEqual(3);
    for (const t of linked) {
      if (t.treatment.kind !== "income") continue;
      const agreement = t.treatment.agreement === undefined ? undefined : facts.contributionAgreements.get(t.treatment.agreement);
      expect(agreement, `${t.bookingDate} ${t.description}`).toBeDefined();
      expect(facts.people.get(agreement!.personId)?.name).toBe(t.counterparty);
      expect(t.treatment).toMatchObject({ source: "contribution", fundsMonth: addMonths(monthOf(t.bookingDate), 1) });
      expect(t.treatment.fundsMonth >= current).toBe(true);
    }
  });

  it("leaves 228 kr of the open month without a job", async () => {
    const { current, figures } = await householdOn(date);
    expect(figures.months.get(current)?.unassigned).toEqual({ kind: "unassigned", amount: kr(228) });
    expect(figures.months.get(current)?.income).toBeGreaterThanOrEqual(kr(60_000));
  });

  it("has an Electricity job that follows the bills, paid from Bills, with a year of bills in the history", async () => {
    const { facts, current, figures } = await householdOn(date);
    const electricity = jobNamed(facts, "Electricity");
    const fixed = [...facts.groups.values()].find((g) => g.name === "Fixed costs")!;
    expect(electricity).toMatchObject({ kind: "spend", essential: true, groupId: fixed.id, accountId: accountNamed(facts, "Bills").id, plan: { mode: "followBills" }, seasonality: "seasonal" });

    const billed = new Map<string, number>();
    for (const t of facts.transactions.values()) {
      const to = t.treatment.kind === "history" ? t.treatment.jobId : t.treatment.kind === "split" ? t.treatment.allocations[0]?.jobId : undefined;
      if (to === electricity.id) billed.set(monthOf(t.bookingDate), (billed.get(monthOf(t.bookingDate)) ?? 0) - t.amount);
    }
    const months = [...billed.keys()].sort();
    expect(months).toHaveLength(10);
    expect(months.at(-1)).toBe(addMonths(current, -1));
    for (const m of months) expect(billed.get(m), m).toBe(kr(syntheticElectricityBills[Number(m.slice(5)) - 1]!));

    const ahead = [...figures.jobs.get(electricity.id)!.months.values()].filter((m) => m.month >= current).slice(0, 12);
    expect(ahead).toHaveLength(12);
    expect(ahead.filter((m) => m.cost.kind === "estimate" && m.cost.estimate.method === "sameMonthLastYear").length).toBeGreaterThanOrEqual(10);
  });

  it("has the Buffer, Konfirmasjon and Christmas and gifts in one account, and a transfer between the last two this month", async () => {
    const { facts, current, figures } = await householdOn(date);
    const deposit = accountNamed(facts, "Deposit");
    const [buffer, konfirmasjon, christmas] = ["Buffer", "Konfirmasjon", "Christmas and gifts"].map((name) => jobNamed(facts, name));
    for (const job of [buffer, konfirmasjon, christmas]) expect(job?.accountId, job?.name).toBe(deposit.id);
    expect(konfirmasjon).toMatchObject({ kind: "saveUp", target: { kind: "amountByMonth", amount: kr(38_000), readyBy: addMonths(current, 6) } });
    expect(christmas).toMatchObject({ kind: "spend", plan: { mode: "evenOut", monthly: kr(1_200) } });

    const transfers = [...facts.bucketTransfers.values()];
    expect(transfers).toEqual([expect.objectContaining({ month: current, from: christmas!.id, to: konfirmasjon!.id, amount: kr(500) })]);
    expect(transfers[0]!.reason.length).toBeGreaterThan(10);
    const held = (job: Job) => figures.jobs.get(job.id)!.bucket;
    expect(held(konfirmasjon!)).toEqual({ kind: "kept", balance: kr(9_600) });
    expect(held(christmas!)).toEqual({ kind: "kept", balance: kr(10_400) });
    const months = (job: Job) => figures.months.get(current)!.jobs.get(job.id)!;
    expect([months(konfirmasjon!).transfersIn, months(christmas!).transfersOut]).toEqual([kr(500), kr(500)]);
  });

  it("is a transfer the command would have accepted", async () => {
    const { facts, today } = await householdOn(date);
    const [transfer] = [...facts.bucketTransfers.values()];
    const without = { ...facts, bucketTransfers: new Map() };
    expect(apply(without, { kind: "moveBucket", transfer: transfer! }, { asOf: today }).ok).toBe(true);
  });

  it("keeps every account's buckets and remainder equal to its balance, with no account short except the two the household has always had", async () => {
    const { figures } = await householdOn(date);
    for (const a of figures.accounts.values()) {
      const signed = a.remainder.kind === "unbucketed" ? a.remainder.amount : -a.remainder.amount;
      expect(a.bucketed + signed, a.account.name).toBe(a.balance.amount);
    }
    const short = [...figures.accounts.values()].filter((a) => a.remainder.kind === "bucketsExceedBalance").map((a) => a.account.name);
    expect(short.sort()).toEqual(["Bills", "Holiday"]);
  });

  it("pays into four children's accounts, 500 kr a month each from a job in the Saving group, with a balance you entered on a date", async () => {
    const { facts, current, figures } = await householdOn(date);
    const saving = [...facts.groups.values()].find((g) => g.name === "Saving")!;
    const typedOn = `${addMonths(current, -1)}-05`;
    for (const [name, balance] of [["Eldest", 24_500], ["Second", 18_200], ["Third", 9_800], ["Youngest", 6_100]] as const) {
      const account = accountNamed(facts, `${name}'s savings`);
      expect(account).toMatchObject({ scope: "paidInto", kind: "savings" });
      const job = jobNamed(facts, name);
      expect(job).toMatchObject({ kind: "payInto", monthly: kr(500), payInto: account.id, groupId: saving.id });
      const typed = [...facts.enteredValues.values()].filter((v) => v.kind === "accountBalance" && v.subject === account.id);
      expect(typed, name).toHaveLength(1);
      expect(typed[0]).toMatchObject({ asOf: typedOn, source: "entered by you" });
      expect(figures.accounts.get(account.id)?.balance, name).toMatchObject({ kind: "depositsSince", baseDate: typedOn, base: typed[0]!.value });
      if (date === "2026-11-10") expect(figures.accounts.get(account.id)?.balance.amount, name).toBe(kr(balance));
    }
  });
});

describe("what the Plan screens need, on the day the figures were drawn from", () => {
  it("has the electricity bills the Plan mockup shows: 28,800 kr from January to October, then 36,300 kr estimated for the next twelve months", async () => {
    const { facts, figures } = await householdOn("2026-11-10");
    const electricity = jobNamed(facts, "Electricity");
    const months = [...figures.jobs.get(electricity.id)!.months.values()];
    const paid = months.filter((m) => m.month < "2026-11");
    expect(paid.map((m) => m.spent)).toEqual([kr(2_760), kr(2_910), kr(2_846)]);
    const ahead = months.filter((m) => m.month >= "2026-11").slice(0, 12);
    expect(ahead.reduce((sum, m) => sum + (m.cost.kind === "estimate" ? m.cost.estimate.amount : 0), 0)).toBe(kr(36_300));
    const billed = [...facts.transactions.values()].filter((t) => t.counterparty === "Fjordstrøm Energi" && t.bookingDate < "2026-11-01");
    expect(billed.reduce((sum, t) => sum - t.amount, 0)).toBe(kr(28_800));
    expect(billed).toHaveLength(10);
  });

  it("leaves the earlier months' contributions waiting for the family, so months of unspent money are not carried in", async () => {
    const { facts, today, figures } = await householdOn("2026-11-10");
    const waiting = figures.needsYou.filter((n) => n.transaction.counterparty === "Stephen" || n.transaction.counterparty === "Partner");
    expect(waiting.length).toBeGreaterThanOrEqual(6);
    for (const w of waiting) expect(monthOf(w.transaction.bookingDate) < addMonths(monthOf(today), -1)).toBe(true);
    expect(facts.transactions.size).toBeGreaterThan(300);
  });
});
