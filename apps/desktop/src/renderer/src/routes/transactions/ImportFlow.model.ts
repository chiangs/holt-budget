import type { AccountId, Currency, ImportBatchId, ImportBlock, ImportPreview, LeftOutAccount, LocalDate } from "@holt/core";
import type { ImportCommitted, ImportOpened, ImportPlanned, SessionId } from "../../../../shared/import-types.ts";
import type { Failed, ImportFailed } from "../../data/client.ts";
import { type BuiltEntry, type EntryDraft, type JobChoice, buildEntry, sameEntry, withBalanceDate, withBalanceText, withChoice, withSuggest, withoutChoice } from "./ImportEntry.model.ts";
import { balanceView } from "./ImportBalance.model.ts";
import { stableOrder } from "./ImportPreview.model.ts";
import type { Words } from "./ImportSay.ts";
import type { MessageId } from "../../i18n/messages.ts";

/** Why the file can't go on. The family can only choose another file. */
export type Refused =
  | Extract<ImportOpened, { readonly kind: "unreadable" | "unrecognised" | "unparseable" | "blocked" }>
  | { readonly kind: "expired" }
  | ImportFailed;

/** A plain message above the Add button. `retry` offers to ask for the preview again. */
export interface Message {
  readonly tone: "problem" | "note";
  readonly words: Words;
  readonly retry: boolean;
}

/** A file the family is checking: what the app read, and everything they have told the app about it since. */
export interface Checking {
  readonly session: SessionId;
  readonly fileName: string;
  readonly preview: ImportPreview;
  readonly currency: Currency;
  readonly today: LocalDate;
  readonly draft: EntryDraft;
  /** The lines of the rows on show, in the order they first appeared. */
  readonly order: readonly number[];
  /** Counts each change to the entry, so a reply to an older request can be told from the reply to the latest. */
  readonly version: number;
  /** The version of the entry the preview shows. */
  readonly plannedVersion: number;
  readonly lastEdit: "balance" | "other";
  /** The preview is out of date and the app could not update it, so Add waits. */
  readonly stale: boolean;
  readonly message: Message | null;
}

export type Stage =
  /** The file window is open. `back` is the preview to return to when the family cancels it. */
  | { readonly kind: "waiting"; readonly back: Checking | null }
  | { readonly kind: "closed" }
  | { readonly kind: "refused"; readonly refused: Refused }
  | { readonly kind: "checking"; readonly check: Checking }
  | { readonly kind: "adding"; readonly check: Checking }
  | { readonly kind: "added"; readonly check: Checking; readonly batchId: ImportBatchId | null; readonly undone: number | null }
  /** The app stored the file, and this window could not catch up with it. */
  | { readonly kind: "behind"; readonly check: Checking };

export interface Flow {
  readonly stage: Stage;
  /** What a screen reader hears next. */
  readonly announcement: Words | null;
}

export const startFlow: Flow = { stage: { kind: "waiting", back: null }, announcement: null };

export type Action =
  | { readonly type: "choose" }
  | { readonly type: "opened"; readonly result: ImportOpened | ImportFailed; readonly currency: Currency; readonly today: LocalDate }
  | { readonly type: "typed"; readonly accountId: AccountId; readonly text: string }
  | { readonly type: "dated"; readonly accountId: AccountId; readonly asOf: string }
  | { readonly type: "chose"; readonly choice: JobChoice }
  | { readonly type: "suggested"; readonly on: boolean }
  | { readonly type: "retry" }
  | { readonly type: "planned"; readonly version: number; readonly result: ImportPlanned | ImportFailed }
  | { readonly type: "adding" }
  | { readonly type: "committed"; readonly result: ImportCommitted | Failed }
  | { readonly type: "undone"; readonly removed: number };

/** What a reply from the main process means for the screen. */
export type Outcome =
  | { readonly kind: "planned"; readonly preview: ImportPreview }
  /** `batchId` is the import the app stored, which is not the preview's: every plan makes its own IDs, and the one that was added is the last. */
  | { readonly kind: "added"; readonly batchId: ImportBatchId | null }
  /** The job the family chose for this line can't be given, so the app lets it go and plans again. */
  | { readonly kind: "dropChoice"; readonly line: number }
  | { readonly kind: "refused"; readonly refused: Refused }
  /** The file stays, and the family can try again. */
  | { readonly kind: "trouble"; readonly words: Words; readonly retry: boolean }
  | { readonly kind: "behind" };

const troubleOf = (failure: ImportFailed["failure"]): Words =>
  failure.code === "unreachable" || failure.code === "bad-reply" ? { id: "import.trouble.unsure" } : { id: "import.trouble.failed" };

export function planOutcome(result: ImportPlanned | ImportFailed, fileName: string): Outcome {
  switch (result.kind) {
    case "planned":
      return { kind: "planned", preview: result.preview };
    case "blocked":
      return result.block.kind === "badChoice" ? { kind: "dropChoice", line: result.block.line } : { kind: "refused", refused: { kind: "blocked", fileName, block: result.block } };
    case "expired":
      return { kind: "refused", refused: { kind: "expired" } };
    case "failed":
      return { kind: "trouble", words: { id: "import.trouble.planFailed" }, retry: true };
  }
}

export function commitOutcome(result: ImportCommitted | Failed, fileName: string): Outcome {
  switch (result.status) {
    case "applied": {
      const stored = result.patch.flatMap((change) => (change.table === "importBatches" && change.before === null && change.after !== null ? [change.after.id] : []));
      return { kind: "added", batchId: stored[0] ?? null };
    }
    case "refused":
      return { kind: "trouble", words: { id: "import.trouble.refused", values: { reason: { refusal: result.refusal } } }, retry: false };
    case "conflict":
      return { kind: "trouble", words: { id: "import.trouble.conflict" }, retry: false };
    case "blocked":
      return result.block.kind === "badChoice" ? { kind: "dropChoice", line: result.block.line } : { kind: "refused", refused: { kind: "blocked", fileName, block: result.block } };
    case "expired":
      return { kind: "refused", refused: { kind: "expired" } };
    case "failed":
      return result.failure.code === "out-of-sync" ? { kind: "behind" } : { kind: "trouble", words: troubleOf(result.failure), retry: false };
  }
}

export const canAdd = (check: Checking): boolean => check.version === check.plannedVersion && !check.stale;

export function entryOf(check: Checking): BuiltEntry {
  return buildEntry(check.draft, check.currency, check.today);
}

function opening(opened: Extract<ImportOpened, { readonly kind: "opened" }>, currency: Currency, today: LocalDate): Checking {
  const { preview } = opened;
  return {
    session: opened.session,
    fileName: opened.fileName,
    preview,
    currency,
    today,
    draft: { balances: preview.accounts.map((line) => ({ accountId: line.accountId, text: "", asOf: preview.to })), choices: [], suggest: true },
    order: preview.sample.map((line) => line.line),
    version: 0,
    plannedVersion: 0,
    lastEdit: "other",
    stale: false,
    message: null,
  };
}

const readWords = (check: Checking): Words => ({
  id: "import.announce.read",
  values: { fileName: check.fileName, created: check.preview.counts.created, matched: check.preview.counts.matched, needsYou: check.preview.counts.needsYou },
});

function plannedWords(check: Checking): Words {
  if (check.lastEdit === "balance") {
    const views = check.preview.accounts.map((line) => balanceView(line.balance, ""));
    const matches = views.filter((view) => view.status === "matches").length;
    const differs = views.filter((view) => view.status === "differs").length;
    if (matches + differs > 0) return { id: "import.announce.balances", values: { matches, differs } };
  }
  return { id: "import.announce.updated", values: { needsYou: check.preview.counts.needsYou } };
}

function edited(flow: Flow, check: Checking, draft: EntryDraft, lastEdit: Checking["lastEdit"]): Flow {
  const changed = !sameEntry(entryOf(check).entry, buildEntry(draft, check.currency, check.today).entry);
  return { ...flow, stage: { kind: "checking", check: { ...check, draft, lastEdit, version: check.version + (changed ? 1 : 0), message: null } } };
}

const droppedNote = (line: number): Message => ({ tone: "note", words: { id: "import.note.choiceDropped", values: { line } }, retry: false });

function dropped(flow: Flow, check: Checking, line: number): Flow {
  const draft = withoutChoice(check.draft, line);
  return { stage: { kind: "checking", check: { ...check, draft, lastEdit: "other", version: check.version + 1, message: droppedNote(line) } }, announcement: droppedNote(line).words };
}

export function flowReducer(flow: Flow, action: Action): Flow {
  const { stage } = flow;
  switch (action.type) {
    case "choose":
      if (stage.kind === "checking") return { ...flow, stage: { kind: "waiting", back: stage.check } };
      if (stage.kind === "refused") return { ...flow, stage: { kind: "waiting", back: null } };
      return flow;

    case "opened": {
      if (stage.kind !== "waiting") return flow;
      const { result } = action;
      if (result.kind === "cancelled") return { ...flow, stage: stage.back === null ? { kind: "closed" } : { kind: "checking", check: stage.back } };
      if (result.kind === "opened") {
        const check = opening(result, action.currency, action.today);
        return { stage: { kind: "checking", check }, announcement: readWords(check) };
      }
      return { ...flow, stage: { kind: "refused", refused: result } };
    }

    case "typed":
      return stage.kind === "checking" ? edited(flow, stage.check, withBalanceText(stage.check.draft, action.accountId, action.text), "balance") : flow;
    case "dated":
      return stage.kind === "checking" ? edited(flow, stage.check, withBalanceDate(stage.check.draft, action.accountId, action.asOf), "balance") : flow;
    case "chose":
      return stage.kind === "checking" ? edited(flow, stage.check, withChoice(stage.check.draft, action.choice), "other") : flow;
    case "suggested":
      return stage.kind === "checking" ? edited(flow, stage.check, withSuggest(stage.check.draft, action.on), "other") : flow;

    case "retry":
      return stage.kind === "checking" ? { ...flow, stage: { kind: "checking", check: { ...stage.check, version: stage.check.version + 1, message: null } } } : flow;

    case "planned": {
      if (stage.kind !== "checking" || action.version !== stage.check.version) return flow;
      const { check } = stage;
      const outcome = planOutcome(action.result, check.fileName);
      switch (outcome.kind) {
        case "planned": {
          const next: Checking = { ...check, preview: outcome.preview, order: stableOrder(check.order, outcome.preview.sample), plannedVersion: action.version, stale: false, message: null };
          return { stage: { kind: "checking", check: next }, announcement: plannedWords(next) };
        }
        case "dropChoice":
          return dropped(flow, check, outcome.line);
        case "refused":
          return { ...flow, stage: { kind: "refused", refused: outcome.refused } };
        case "trouble":
          return { stage: { kind: "checking", check: { ...check, stale: true, message: { tone: "problem", words: outcome.words, retry: outcome.retry } } }, announcement: outcome.words };
        case "added":
        case "behind":
          return flow;
      }
      return flow;
    }

    case "adding":
      return stage.kind === "checking" && canAdd(stage.check) ? { stage: { kind: "adding", check: stage.check }, announcement: { id: "import.announce.adding" } } : flow;

    case "committed": {
      if (stage.kind !== "adding") return flow;
      const { check } = stage;
      const outcome = commitOutcome(action.result, check.fileName);
      switch (outcome.kind) {
        case "added":
          return { stage: { kind: "added", check, batchId: outcome.batchId, undone: null }, announcement: { id: "import.announce.added", values: { count: check.preview.counts.created } } };
        case "trouble":
          return { stage: { kind: "checking", check: { ...check, message: { tone: "problem", words: outcome.words, retry: outcome.retry } } }, announcement: outcome.words };
        case "dropChoice":
          return dropped(flow, check, outcome.line);
        case "refused":
          return { ...flow, stage: { kind: "refused", refused: outcome.refused } };
        case "behind":
          return { stage: { kind: "behind", check }, announcement: { id: "import.trouble.outOfSync" } };
        case "planned":
          return flow;
      }
      return flow;
    }

    case "undone":
      return stage.kind === "added" ? { stage: { ...stage, undone: action.removed }, announcement: { id: "import.announce.undone", values: { count: action.removed } } } : flow;
  }
}

/** What the dialog says about a file it can't use, and which accounts it names when none of them are the household's. */
export interface RefusedView {
  readonly title: Words;
  readonly detail: Words;
  /** The bank's own words, such as the parser's reason, shown under the detail. */
  readonly note: string | null;
  readonly leftOut: readonly LeftOutAccount[];
}

export interface RefusedContext {
  /** When the household imported the batch, for a file it already holds. */
  importedOn(batchId: ImportBatchId): LocalDate | null;
}

function blockedView(fileName: string, block: ImportBlock, context: RefusedContext): Omit<RefusedView, "title" | "note"> {
  switch (block.kind) {
    case "wrongCurrency":
      return { detail: { id: "import.refused.wrongCurrency", values: { file: block.file, household: block.household } }, leftOut: [] };
    case "duplicateFile": {
      const day = context.importedOn(block.batchId);
      return { detail: day === null ? { id: "import.refused.duplicateFile" } : { id: "import.refused.duplicateFileOn", values: { day: { fullDay: day } } }, leftOut: [] };
    }
    case "noRows":
      return { detail: { id: "import.refused.noRows", values: { fileName } }, leftOut: [] };
    case "noKnownAccounts":
      return { detail: { id: "import.refused.noKnownAccounts", values: { fileName } }, leftOut: block.leftOut };
    case "badChoice":
      return { detail: { id: "import.refused.badChoice", values: { line: block.line } }, leftOut: [] };
  }
}

const unreadableIds = {
  missing: "import.refused.unreadable.missing",
  denied: "import.refused.unreadable.denied",
  tooLarge: "import.refused.unreadable.tooLarge",
  notText: "import.refused.unreadable.notText",
} as const satisfies Record<Extract<ImportOpened, { readonly kind: "unreadable" }>["reason"], MessageId>;

export function refusedView(refused: Refused, context: RefusedContext): RefusedView {
  switch (refused.kind) {
    case "unreadable":
      return { title: { id: "import.refused.title.unreadable" }, detail: { id: unreadableIds[refused.reason], values: { fileName: refused.fileName } }, note: null, leftOut: [] };
    case "unrecognised":
      return { title: { id: "import.refused.title.unrecognised" }, detail: { id: "import.refused.unrecognised", values: { fileName: refused.fileName } }, note: null, leftOut: [] };
    case "unparseable":
      return {
        title: { id: "import.refused.title.unparseable" },
        detail: refused.line === null ? { id: "import.refused.unparseable", values: { fileName: refused.fileName } } : { id: "import.refused.unparseableLine", values: { fileName: refused.fileName, line: refused.line } },
        note: refused.message,
        leftOut: [],
      };
    case "blocked":
      return { title: { id: "import.refused.title.blocked" }, note: null, ...blockedView(refused.fileName, refused.block, context) };
    case "expired":
      return { title: { id: "import.refused.title.expired" }, detail: { id: "import.refused.expired" }, note: null, leftOut: [] };
    case "failed":
      return { title: { id: "import.refused.title.failed" }, detail: { id: "import.refused.failed" }, note: null, leftOut: [] };
  }
}
