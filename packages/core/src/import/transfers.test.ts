import { describe, expect, it } from "vitest";
import { kr } from "../testing/facts-builder.ts";
import { importHousehold } from "../testing/synthetic-statement.ts";
import { transferCandidates } from "./transfers.ts";

describe("transferCandidates", () => {
  it("lists, for each unpaired transaction, those in other shared accounts with the same amount the other way within 3 days", () => {
    const h = importHousehold();
    const out = h.builder.needsYou({ date: "2026-11-02", amount: kr(-2_000) });
    const into = h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-05", amount: kr(2_000) });
    const waiting = h.builder.unmatchedTransfer({ accountId: h.accounts.bills, date: "2026-11-01", amount: kr(2_000) });
    h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-06", amount: kr(2_000) });
    h.builder.needsYou({ date: "2026-11-02", amount: kr(2_000) });
    h.builder.needsYou({ accountId: h.accounts.child, date: "2026-11-02", amount: kr(2_000) });
    h.builder.spend({ accountId: h.accounts.bills, date: "2026-11-02", amount: kr(2_000), jobId: h.jobs.electricity });
    h.builder.transfer({ from: h.accounts.everyday, to: h.accounts.savings, date: "2026-11-02", amount: kr(2_000) });
    const candidates = transferCandidates(h.facts());
    expect(candidates.get(out)).toEqual([into, waiting]);
    expect(candidates.get(into)).toEqual([out]);
    expect(candidates.get(waiting)).toEqual([out]);
    expect([...candidates.keys()].sort()).toEqual([out, into, waiting].sort());
  });
});
