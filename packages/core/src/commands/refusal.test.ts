import { describe, expect, it } from "vitest";
import { accountNumber } from "../account-number.ts";
import { emptyChangeLog } from "../change-log.ts";
import { month } from "../dates.ts";
import { accountId, groupId, jobId, moveId, proposalId, transactionId } from "../ids.ts";
import { currency, money } from "../money.ts";
import { type DecideResult, accept, commitProposal, suggest } from "../proposal.ts";
import { changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type ApplyResult, type Command, type CommitResult, apply, commit } from "./apply.ts";
import { bucketTransferMessages } from "./bucket-transfers.messages.ts";
import { contributionMessages } from "./contributions.messages.ts";
import { importMessages } from "./imports.messages.ts";
import { personMessages } from "./people.messages.ts";
import { type Refusal, type RefusalCode, messageFor, refusalCodes } from "./refusal.ts";
import { ruleMessages } from "./rules.messages.ts";

const h = commandHousehold();
const run = (command: Command): ApplyResult => apply(h.facts, command, { asOf: today });
const unknown = testId(999_999);
const shoppingAmount = h.facts.transactions.get(h.transactions.shopping)!.amount;

const proposal = suggest<Command>({
  id: proposalId(testId(500_000)),
  command: { kind: "assign", month: month("2026-11"), jobId: h.jobs.unused, amount: kr(200) },
  evidence: { transactions: [h.transactions.shopping], filter: null },
  origin: { kind: "assistant", model: "test-model" },
  basedOn: null,
});
const accepted = accept(proposal, "2026-11-09T10:00:00Z");
if (!accepted.ok) throw new Error("A suggested proposal can be accepted");

type Result = ApplyResult | CommitResult | DecideResult<Command>;

/** One way to reach each refusal. The type makes a new code fail to compile until it has a case. */
type CodesHere = Exclude<RefusalCode, keyof typeof importMessages | keyof typeof ruleMessages | keyof typeof personMessages | keyof typeof contributionMessages | keyof typeof bucketTransferMessages>;
const ownedElsewhere = [importMessages, ruleMessages, personMessages, contributionMessages, bucketTransferMessages];
const codesHere = refusalCodes.filter((code): code is CodesHere => !ownedElsewhere.some((messages) => code in messages));

const reach: { readonly [C in CodesHere]: () => Result } = {
  accountNumberTaken: () => {
    const numbered = apply(h.facts, { kind: "changeAccount", accountId: h.accounts.everyday, changes: { number: accountNumber("12345678901") } }, { asOf: today });
    if (!numbered.ok) throw new Error("A free account number can be set");
    return apply(numbered.facts, { kind: "addAccount", account: { ...numbered.facts.accounts.get(h.accounts.everyday)!, id: accountId(unknown) } }, { asOf: today });
  },
  splitDoesNotAddUp: () => run({ kind: "setTreatment", transactionId: h.transactions.shopping, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount: money(-1) }] } }),
  idTaken: () => run({ kind: "addAccount", account: { ...h.facts.accounts.get(h.accounts.everyday)!, name: "Another" } }),
  nameMissing: () => run({ kind: "addGroup", group: { id: groupId(unknown), name: "  ", order: 3, countsTowardsSavingsRate: false } }),
  negativeAmount: () => run({ kind: "assign", month: month("2026-11"), jobId: h.jobs.food, amount: money(-1) }),
  amountNotPositive: () => run({ kind: "addMove", move: { id: moveId(unknown), from: h.accounts.everyday, to: h.accounts.savings, amount: money(0), month: month("2026-11"), reason: "Seed a bucket" } }),
  accountNotFound: () => run({ kind: "changeAccount", accountId: accountId(unknown), changes: { name: "Bills" } }),
  groupNotFound: () => run({ kind: "changeGroup", groupId: groupId(unknown), changes: { name: "Saving" } }),
  jobNotFound: () => run({ kind: "assign", month: month("2026-11"), jobId: jobId(unknown), amount: kr(100) }),
  moveNotFound: () => run({ kind: "setMoveStatus", moveId: moveId(unknown), status: "skipped" }),
  transactionNotFound: () => run({ kind: "setTreatment", transactionId: transactionId(unknown), treatment: { kind: "needsYou" } }),
  currencyFixed: () => run({ kind: "changeHousehold", changes: { currency: currency("EUR") } }),
  planStartFixed: () => run({ kind: "changeHousehold", changes: { planStart: month("2026-12") } }),
  jobKindFixed: () => run({ kind: "changeJob", jobId: h.jobs.food, changes: { ofKind: { kind: "saveUp", target: { kind: "monthly", amount: kr(100) } } } }),
  bufferStaysActive: () => run({ kind: "changeJob", jobId: h.jobs.buffer, changes: { status: "archived" } }),
  bufferCannotBeDeleted: () => run({ kind: "deleteJob", jobId: h.jobs.buffer }),
  bucketHoldsMoney: () => run({ kind: "deleteJob", jobId: h.jobs.holiday }),
  jobInUse: () => run({ kind: "deleteJob", jobId: h.jobs.food }),
  monthNotNext: () => run({ kind: "openMonth", month: month("2027-01") }),
  monthNotOpen: () => run({ kind: "closeMonth", month: month("2026-12") }),
  monthNotClosed: () => run({ kind: "reopenMonth", month: month("2026-11") }),
  sameJob: () => run({ kind: "moveAssignment", month: month("2026-11"), from: h.jobs.food, to: h.jobs.food, amount: kr(100) }),
  moveExceedsAssignment: () => run({ kind: "moveAssignment", month: month("2026-11"), from: h.jobs.food, to: h.jobs.unused, amount: kr(5_001) }),
  sameAccount: () => run({ kind: "addMove", move: { id: moveId(unknown), from: h.accounts.everyday, to: h.accounts.everyday, amount: kr(100), month: month("2026-11"), reason: "Seed a bucket" } }),
  moveNotToDo: () => run({ kind: "setMoveStatus", moveId: h.moves.done, status: "skipped" }),
  historyFromPlanStart: () =>
    run({ kind: "recordTransaction", transaction: { id: transactionId(unknown), accountId: h.accounts.everyday, bookingDate: today, amount: kr(-80), description: "Kiosk", treatment: { kind: "history", jobId: null } } }),
  notHistoryBeforePlanStart: () => run({ kind: "setTreatment", transactionId: h.transactions.earlier, treatment: { kind: "needsYou" } }),
  breaksFacts: () => run({ kind: "setTreatment", transactionId: h.transactions.shopping, treatment: { kind: "split", allocations: [{ jobId: jobId(unknown), amount: shoppingAmount }] } }),
  proposalNotSuggested: () => accept(accepted.proposal, "2026-11-09T11:00:00Z"),
  proposalNotAccepted: () => commitProposal(h.facts, emptyChangeLog(), proposal, changeMeta(1), { asOf: today }),
  proposalStale: () => {
    const first = commit(h.facts, emptyChangeLog(), { kind: "changeGroup", groupId: h.living, changes: { name: "Daily life" } }, changeMeta(2), { asOf: today });
    if (!first.ok) throw new Error("The first change was refused");
    return commitProposal(first.facts, first.log, accepted.proposal, changeMeta(3), { asOf: today });
  },
};

function codeOf(result: Result): RefusalCode | "accepted" {
  return result.ok ? "accepted" : result.refusal.code;
}

describe("refusals", () => {
  it.each(codesHere)("the app can refuse with %s", (code) => {
    expect(codeOf(reach[code]())).toBe(code);
  });

  it("a refusal that breaks the facts names what it would break", () => {
    const result = reach.breaksFacts();
    if (result.ok) throw new Error("expected a refusal");
    const refusal: Refusal = result.refusal;
    expect(refusal.code === "breaksFacts" && refusal.violations).toEqual([{ code: "missingReference", table: "transactions", key: h.transactions.shopping, field: "allocations" }]);
  });

  it("the same commands are accepted when nothing stands in their way", () => {
    expect(codeOf(run({ kind: "assign", month: month("2026-11"), jobId: h.jobs.food, amount: kr(0) }))).toBe("accepted");
    expect(codeOf(run({ kind: "moveAssignment", month: month("2026-11"), from: h.jobs.food, to: h.jobs.unused, amount: kr(5_000) }))).toBe("accepted");
    expect(codeOf(run({ kind: "openMonth", month: month("2026-12") }))).toBe("accepted");
    expect(codeOf(run({ kind: "deleteJob", jobId: h.jobs.unused }))).toBe("accepted");
    expect(codeOf(run({ kind: "changeJob", jobId: h.jobs.food, changes: { ofKind: { kind: "spend", plan: setAmount(kr(6_000)) } } }))).toBe("accepted");
  });

  describe("messages follow the writing conventions", () => {
    it.each(refusalCodes)("%s", (code) => {
      const text = messageFor(code);
      expect(text).toMatch(/^[A-Z][^!]*\.$/);
      expect(text).toMatch(/\b(you|your|the app)\b/i);
      expect(text).not.toMatch(/\b(recommend|advise|should|category|categories|envelope|pot|fund|expense|smart|magic|failed|warning|error|invalid)\b/i);
      expect(text).not.toMatch(/\b(was|were|been) \w+ed\b/);
    });
  });
});
