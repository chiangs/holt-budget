import { z } from "zod";
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

/** The one table of channels. Arguments are checked in the main process before a handler runs. */
export const channels = {
  "holt:app-info": { args: z.tuple([]), result: AppInfo },
  "holt:database-state": { args: z.tuple([]), result: DatabaseState },
} as const satisfies Record<ChannelName, { args: z.ZodTuple; result: z.ZodType }>;

export type Args<C extends ChannelName> = z.output<(typeof channels)[C]["args"]>;
export type Result<C extends ChannelName> = z.output<(typeof channels)[C]["result"]>;

export type IpcErrorCode = "unknown-channel" | "invalid-arguments" | "handler-failed";
export type IpcError = { code: IpcErrorCode; message: string };
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };
