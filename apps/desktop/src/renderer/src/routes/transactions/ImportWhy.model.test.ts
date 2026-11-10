import { type JobId, type NewTransactionLine, type Transaction, type Why, accountId, jobId, localDate, money, transactionId, treatmentFor } from "@holt/core";
import { describe, expect, it } from "vitest";
import { kr, testId } from "@holt/core/testing";
import { english } from "./ImportTestKit.ts";
import { type WhyContext, jobCell, signedAmount, whyWords } from "./ImportWhy.model.ts";

const jobs = new Map<JobId, string>([
  [jobId(testId(1)), "Activities and SFO"],
  [jobId(testId(2)), "Municipal charges"],
  [jobId(testId(3)), "Gifts"],
]);
const [sfo, municipal, gifts] = [...jobs.keys()] as [JobId, JobId, JobId];
const earlier = transactionId(testId(50));
const known: Transaction = { id: earlier, accountId: accountId(testId(9)), bookingDate: localDate("2026-10-18"), amount: kr(-1_980), description: "Stavanger kommune", treatment: { kind: "needsYou" } };

const context: WhyContext = {
  jobName: (id) => jobs.get(id) ?? "",
  transaction: (id) => (id === earlier ? known : undefined),
};

const line = (why: Why, amount = kr(-1_980)): NewTransactionLine => ({
  transactionId: transactionId(testId(60)),
  line: 7,
  accountId: accountId(testId(9)),
  bookingDate: localDate("2026-10-28"),
  amount,
  description: "Stavanger kommune",
  treatment: { kind: "needsYou" },
  why,
});

/** A case for every kind of reason core gives. The type makes a new kind fail to compile here until it has a case. */
const everyWhy = {
  chosen: { why: { kind: "chosen" }, says: "Chosen by you" },
  rule: { why: { kind: "rule", ruleId: "00000000-0000-7000-8000-000000000070" as never }, says: "A rule you made" },
  sameAsLast: { why: { kind: "sameAsLast", from: earlier, times: 8 }, says: "Same as the last 8 times" },
  priceChange: { why: { kind: "priceChange", from: kr(-399) }, amount: kr(-449), says: "Up from 399 kr" },
  transferMatch: { why: { kind: "transferMatch", partner: earlier }, amount: kr(28_000), says: "Matches the outgoing transfer" },
  nearMatch: { why: { kind: "nearMatch", of: earlier }, says: "May be the same as one you already have, booked on 18 Oct" },
  ambiguous: { why: { kind: "ambiguous", jobs: [sfo, municipal] }, says: "Could be Activities and SFO or Municipal charges" },
  firstPayment: { why: { kind: "firstPayment" }, says: "First payment to this payee" },
  history: { why: { kind: "history" }, says: "History: before the plan start" },
  none: { why: { kind: "none" }, says: "The app has nothing to suggest for this one" },
} as const satisfies { readonly [K in Why["kind"]]: { readonly why: Extract<Why, { readonly kind: K }>; readonly amount?: number; readonly says: string } };

describe("the words for why a new row has its job", () => {
  for (const [kind, { why, says, ...rest }] of Object.entries(everyWhy)) {
    it(`${kind}: "${says}"`, () => {
      const amount = "amount" in rest ? (rest.amount as number) : kr(-1_980);
      expect(english(whyWords(line(why as Why, money(amount)), context))).toBe(says);
    });
  }

  it("counts a run of one as 'last time' and a longer run as a number of times", () => {
    expect(english(whyWords(line({ kind: "sameAsLast", from: earlier, times: 1 }), context))).toBe("Same as last time");
    expect(english(whyWords(line({ kind: "sameAsLast", from: earlier, times: 2 }), context))).toBe("Same as the last 2 times");
  });

  it("says down when a changed amount is lower than before, and compares sizes, not signs", () => {
    expect(english(whyWords(line({ kind: "priceChange", from: kr(-399) }, kr(-349)), context))).toBe("Down from 399 kr");
    expect(english(whyWords(line({ kind: "priceChange", from: kr(-399) }, kr(-449)), context))).toBe("Up from 399 kr");
  });

  it("names the other side of a transfer by which way the money went in this row", () => {
    expect(english(whyWords(line({ kind: "transferMatch", partner: earlier }, kr(28_000)), context))).toBe("Matches the outgoing transfer");
    expect(english(whyWords(line({ kind: "transferMatch", partner: earlier }, kr(-28_000)), context))).toBe("Matches the incoming transfer");
  });

  it("lists up to three jobs the payee has gone to, with 'or' before the last", () => {
    expect(english(whyWords(line({ kind: "ambiguous", jobs: [sfo, municipal, gifts] }), context))).toBe("Could be Activities and SFO, Municipal charges or Gifts");
  });

  it("still warns about a near match when the other transaction is not among the facts", () => {
    const unknown = transactionId(testId(51));
    expect(english(whyWords(line({ kind: "nearMatch", of: unknown }), context))).toBe("May be the same as one you already have");
  });
});

describe("the Job column", () => {
  const split = (...jobIds: JobId[]) => {
    const each = kr(-1_000);
    const treatment = treatmentFor({ kind: "split", allocations: jobIds.map((id) => ({ jobId: id, amount: each })) as never }, money(each * jobIds.length));
    if (treatment === null) throw new Error("the split should add up");
    return treatment;
  };

  it("asks the family to choose when the row needs them", () => {
    expect(jobCell({ kind: "needsYou" }, context)).toEqual({ kind: "choose" });
  });

  it("shows the job's own name for one job, and a count for a split", () => {
    expect(jobCell(split(sfo), context)).toEqual({ kind: "job", name: "Activities and SFO" });
    const several = jobCell(split(sfo, gifts), context);
    expect(several.kind === "words" && english(several.words)).toBe("Split across 2 jobs");
  });

  it("says transfer and history in words, and names the job a history row carries", () => {
    const transfer = jobCell({ kind: "transfer", partner: null }, context);
    const history = jobCell({ kind: "history", jobId: null }, context);
    expect([transfer.kind === "words" && english(transfer.words), history.kind === "words" && english(history.words)]).toEqual(["Transfer", "History"]);
    expect(jobCell({ kind: "history", jobId: gifts }, context)).toEqual({ kind: "job", name: "Gifts" });
  });
});

describe("amounts", () => {
  it("gives money out a real minus sign and money in a plus", () => {
    expect(signedAmount(kr(-2_846))).toEqual({ sign: "−", figure: kr(2_846) });
    expect(signedAmount(kr(28_000))).toEqual({ sign: "+", figure: kr(28_000) });
  });
});
