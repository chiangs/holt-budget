/**
 * The change log in SQLite. It has no copy in memory: undo reads the top `done` row and redo the top
 * `undone` row. The two stacks share one table and one counter. `done` rows ordered by `seq` ascending and
 * `undone` rows ordered by `seq` descending are the stacks with the newest on top. Undo flips the highest
 * `done` row, so every `undone` seq stays above every `done` seq; a new change deletes the `undone` rows
 * first, so it takes a seq above everything left. `autoincrement` never reuses a seq.
 */

import { type CommandKind, type StoredChange, StoredChangeSchema, commandKinds } from "@holt/core";
import { z } from "zod";
import type { ChangeSummary, LogHead } from "../../shared/ledger-types.ts";
import type { Db } from "../storage/database.ts";
import { StoreDivergence } from "./errors.ts";

export type ChangeStatus = "done" | "undone";

export interface StoredRow {
  readonly seq: number;
  readonly record: StoredChange;
}

const SummarySchema = z.strictObject({
  id: StoredChangeSchema.shape.id,
  at: StoredChangeSchema.shape.at,
  kind: z.custom<CommandKind>((value) => typeof value === "string" && (commandKinds as readonly string[]).includes(value), "Not a command kind"),
  by: StoredChangeSchema.shape.by,
});

export function summaryOf(record: StoredChange): ChangeSummary {
  return { id: record.id, at: record.at, kind: record.command.kind, by: record.by };
}

export interface ChangeLogStore {
  /** The newest `done` row (to undo) or the most recently undone row (to redo), with its command and patch checked by core's schemas. */
  top(status: ChangeStatus): StoredRow | null;
  heads(): LogHead;
  append(record: StoredChange): void;
  discardUndone(): void;
  /** Moves one row between the stacks. Throws `StoreDivergence` unless the row was there with the status it was read with. */
  move(seq: number, from: ChangeStatus, to: ChangeStatus): void;
}

export function openChangeLog(db: Db): ChangeLogStore {
  const topDone = db.prepare("select seq, id, at, author, command, patch from changes where status = 'done' order by seq desc limit 1");
  const topUndone = db.prepare("select seq, id, at, author, command, patch from changes where status = 'undone' order by seq asc limit 1");
  const headDone = db.prepare("select id, at, kind, author from changes where status = 'done' order by seq desc limit 1");
  const headUndone = db.prepare("select id, at, kind, author from changes where status = 'undone' order by seq asc limit 1");
  const insert = db.prepare("insert into changes (id, at, kind, author, command, patch, status) values (?, ?, ?, ?, ?, ?, 'done')");
  const discard = db.prepare("delete from changes where status = 'undone'");
  const flip = db.prepare("update changes set status = ? where seq = ? and status = ?");

  type Raw = { seq: number; id: string; at: string; author: string; command: string; patch: string };
  type RawHead = { id: string; at: string; kind: string; author: string };

  const head = (statement: typeof headDone): ChangeSummary | null => {
    const row = statement.get() as RawHead | undefined;
    return row === undefined ? null : SummarySchema.parse({ id: row.id, at: row.at, kind: row.kind, by: JSON.parse(row.author) });
  };

  return {
    top(status) {
      const row = (status === "done" ? topDone : topUndone).get() as Raw | undefined;
      if (row === undefined) return null;
      const record = StoredChangeSchema.parse({ id: row.id, at: row.at, by: JSON.parse(row.author), command: JSON.parse(row.command), patch: JSON.parse(row.patch) });
      return { seq: row.seq, record };
    },
    heads: () => ({ undo: head(headDone), redo: head(headUndone) }),
    append(record) {
      insert.run(record.id, record.at, record.command.kind, JSON.stringify(record.by), JSON.stringify(record.command), JSON.stringify(record.patch));
    },
    discardUndone() {
      discard.run();
    },
    move(seq, from, to) {
      if (flip.run(to, seq, from).changes !== 1) throw new StoreDivergence("changes", String(seq));
    },
  };
}
