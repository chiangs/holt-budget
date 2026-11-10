import { FamilyCommandSchema, IdSchemas, LocalDateSchema, MoneySchema, TreatmentInputSchema } from "@holt/core";
import { z } from "zod";
import type { ImportCommitted, ImportEntry, ImportOpened, ImportPlanned, SessionId } from "./import-types.ts";
import type { RunResult, SnapshotResult } from "./ledger-types.ts";
import type { ChannelName } from "./channel-names.ts";

export const AppInfo = z.object({ version: z.string(), storageBackend: z.string() });
export type AppInfo = z.infer<typeof AppInfo>;

/** Where the encrypted database stands. Setup (Milestone 6) is what moves "not-set-up" to "ready". */
export const DatabaseState = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-set-up") }),
  z.object({ state: z.literal("locked"), reason: z.enum(["needs-passphrase", "wrong-passphrase", "keyring-unavailable"]) }),
  z.object({ state: z.literal("refused"), reason: z.literal("newer-than-app"), found: z.number().int(), supported: z.number().int() }),
  z.object({ state: z.literal("ready") }),
]);
export type DatabaseState = z.infer<typeof DatabaseState>;

const SessionIdSchema = z.string().min(1).max(100);

const ImportEntrySchema: z.ZodType<ImportEntry> = z.strictObject({
  balances: z.array(z.strictObject({ accountId: IdSchemas.account, value: MoneySchema, asOf: LocalDateSchema })).max(100),
  choices: z.array(z.strictObject({ line: z.number().int().min(1), treatment: TreatmentInputSchema })).max(50_000),
  suggest: z.boolean(),
});

/** Results come from typed code in the main process, and the dispatcher doesn't parse them. */
const result = <T>() => z.custom<T>();

/** The one table of channels. Arguments are checked in the main process before a handler runs. */
export const channels = {
  "holt:app-info": { args: z.tuple([]), result: AppInfo },
  "holt:database-state": { args: z.tuple([]), result: DatabaseState },
  "holt:facts-snapshot": { args: z.tuple([]), result: result<SnapshotResult>() },
  /** Every command except `importFile`, so the page can't inject rows. */
  "holt:run": { args: z.tuple([FamilyCommandSchema]), result: result<RunResult>() },
  "holt:history-step": { args: z.tuple([z.enum(["undo", "redo"])]), result: result<RunResult>() },
  "holt:import-open": { args: z.tuple([]), result: result<ImportOpened>() },
  "holt:import-plan": { args: z.tuple([SessionIdSchema, ImportEntrySchema]), result: result<ImportPlanned>() },
  "holt:import-commit": { args: z.tuple([SessionIdSchema, ImportEntrySchema]), result: result<ImportCommitted>() },
} as const satisfies Record<ChannelName, { args: z.ZodTuple; result: z.ZodType }>;

export type Args<C extends ChannelName> = z.output<(typeof channels)[C]["args"]>;
export type Result<C extends ChannelName> = z.output<(typeof channels)[C]["result"]>;

export type { SessionId };
export type IpcErrorCode = "unknown-channel" | "invalid-arguments" | "handler-failed";
export type IpcError = { code: IpcErrorCode; message: string };
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };
