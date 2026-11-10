/**
 * Run by `crash.test.ts` as a separate process. It makes two changes through the real store and kills itself
 * with SIGKILL just before the write numbered `killAt`, so the parent can check what a crash leaves behind.
 * Usage: node crash-child.ts <database file> <key in hex> <killAt> <rows in the first change (an import)>
 */

import { localDate } from "@holt/core";
import { createMint } from "../../shared/ids.ts";
import { openDatabase } from "../storage/database.ts";
import { dataKeyFromBytes } from "../storage/keys.ts";
import { crashDay, importOf, oneTransaction } from "./crash-fixtures.ts";
import { openFactsStore } from "./store.ts";
import { trapWrites } from "./trap-writes.ts";

const [file, keyHex, killAt, rows] = process.argv.slice(2);
if (file === undefined || keyHex === undefined || killAt === undefined || rows === undefined) throw new Error("Usage: crash-child.ts <file> <key> <killAt> <rows>");

const db = openDatabase(file, dataKeyFromBytes(Buffer.from(keyHex, "hex")));
const trapped = trapWrites(db, (count) => {
  if (count === Number(killAt)) process.kill(process.pid, "SIGKILL");
});
const store = openFactsStore(trapped, { clock: { today: () => localDate(crashDay), now: () => new Date(`${crashDay}T09:00:00Z`) }, mint: createMint() });
if (store === null) throw new Error("No household");
store.run(importOf(store.facts(), Number(rows)));
store.run(oneTransaction(store.facts(), 900_000));
