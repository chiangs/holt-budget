import { computeFigures, localDate, month } from "@holt/core";
import { NOK, kr } from "@holt/core/testing";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { locale, messages } from "../../i18n/messages.ts";
import { planMonthOf } from "./PlanMonth.model.ts";
import { moneyText, needsAttention, statusText } from "./PlanStatus.ts";
import { type StatusLine, planGroups, rowsOf } from "./PlanTable.model.ts";
import { buildWorld, today } from "./PlanTestWorld.ts";

const intl = createIntl({ locale, messages });
const text = (line: StatusLine) => statusText(intl, line, NOK);

describe("the words in the Status column", () => {
  it("says what is left, and how far over", () => {
    expect(text({ kind: "left", left: kr(2_560) })).toBe("2,560 kr left");
    expect(text({ kind: "over", over: kr(640) })).toBe("Over by 640 kr");
    expect(text({ kind: "returned", amount: kr(300) })).toBe("300 kr went back to unassigned");
  });

  it("says what a bucket holds, against its target and the month it should be ready", () => {
    expect(text({ kind: "bucket", balance: kr(10_400), target: null, readyBy: null })).toBe("Bucket 10,400 kr");
    expect(text({ kind: "bucket", balance: kr(9_600), target: kr(38_000), readyBy: null })).toBe("Bucket 9,600 kr of 38,000 kr");
    expect(text({ kind: "bucket", balance: kr(9_600), target: kr(38_000), readyBy: month("2027-05") })).toBe("Bucket 9,600 kr of 38,000 kr by May 2027");
    expect(text({ kind: "bucketShort", short: kr(2_800) })).toBe("Bucket short by 2,800 kr");
  });

  it("says how far the buffer is from its target, in months", () => {
    expect(text({ kind: "bufferGoal", balance: kr(86_000), target: kr(158_460), months: 3 })).toBe("86,000 kr of 158,460 kr (3 months)");
    expect(text({ kind: "bufferGoal", balance: kr(1), target: kr(2), months: 1 })).toBe("1 kr of 2 kr (1 month)");
  });

  it("says where a pay-into job pays and whether it has", () => {
    expect(text({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "paid", on: localDate("2026-10-20") } })).toBe("To Eldest's savings · paid 20 Oct");
    expect(text({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "notYet" } })).toBe("To Eldest's savings · not paid yet");
    expect(text({ kind: "payInto", accountName: "Eldest's savings", paid: { kind: "paid", on: null } })).toBe("To Eldest's savings · paid");
  });

  it("says a job is paused, finished or archived, and what its bucket still holds", () => {
    expect(text({ kind: "inactive", status: "paused", bucket: null })).toBe("Paused");
    expect(text({ kind: "inactive", status: "finished", bucket: null })).toBe("Finished");
    expect(text({ kind: "inactive", status: "archived", bucket: kr(500) })).toBe("Archived · bucket 500 kr");
  });

  it("marks only a job that is over or short for the eye, so the table adds an icon as well as colour", () => {
    expect(needsAttention({ kind: "over", over: kr(1) })).toBe(true);
    expect(needsAttention({ kind: "bucketShort", short: kr(1) })).toBe(true);
    expect(needsAttention({ kind: "left", left: kr(1) })).toBe(false);
  });

  it("gives every job in a household its own line, with words, from the real figures", () => {
    const world = buildWorld();
    const month = planMonthOf(world.facts, computeFigures(world.facts, today));
    if (month === null) throw new Error("No month");
    const lines = rowsOf(planGroups(world.facts, world.figures, month)).map((row) => [row.name, text(row.line)]);
    expect(lines).toContainEqual(["Food and household", "12,060 kr left"]);
    expect(lines).toContainEqual(["Confirmation", "Bucket 9,600 kr of 38,000 kr by May 2027"]);
    expect(lines).toContainEqual(["Buffer", "42,000 kr of 95,250 kr (3 months)"]);
    expect(lines).toContainEqual(["Eldest", "To Eldest's savings · paid 4 Nov"]);
    expect(lines).toContainEqual(["Union fees", "Paused"]);
    expect(lines).toContainEqual(["Books and games", "Archived"]);
  });

  it("writes an amount in the household's currency", () => {
    expect(moneyText(intl, kr(68_048), NOK)).toBe("68,048 kr");
  });
});

describe("money below zero", () => {
  it("is written with a true minus sign", () => {
    expect(moneyText(intl, kr(-12_181), NOK)).toBe("−12,181 kr");
  });
});
