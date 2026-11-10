/**
 * A database handle that tells a callback about every write the store makes, before it happens. A test uses it
 * to fail or kill the process at the k-th write, which is how it shows a crash never leaves half a change.
 */

import type { Db } from "../storage/database.ts";

export function trapWrites(db: Db, beforeWrite: (count: number) => void): Db {
  let count = 0;
  const bound = (target: object, property: string | symbol): unknown => {
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const watched = (statement: object): object =>
    new Proxy(statement, {
      get(target, property) {
        if (property !== "run") return bound(target, property);
        return (...params: unknown[]) => {
          count += 1;
          beforeWrite(count);
          return (target as { run(...p: unknown[]): unknown }).run(...params);
        };
      },
    });
  return new Proxy(db, {
    get(target, property) {
      if (property !== "prepare") return bound(target, property);
      return (sql: string) => watched(target.prepare(sql));
    },
  });
}
