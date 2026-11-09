import type { Db } from "./database.ts";

export type Migration = { version: number; name: string; sql: string };

export class DatabaseTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`This database is at version ${found}, but this version of Holt only knows up to ${supported}.`);
  }
}

/** Reads `migrations/NNNN_name.sql`. The numbers must run 1, 2, 3 with no gap, so the version says exactly what is applied. */
export function loadMigrations(files: Record<string, string> = import.meta.glob("./migrations/*.sql", { query: "?raw", import: "default", eager: true })): Migration[] {
  const migrations = Object.entries(files)
    .map(([path, sql]) => {
      const match = /(\d{4})_([a-z0-9_]+)\.sql$/.exec(path);
      if (match === null) throw new Error(`Migration ${path} must be named NNNN_name.sql.`);
      return { version: Number(match[1]), name: match[2] as string, sql };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations must be numbered 1, 2, 3 with no gap; found ${m.version} at position ${i + 1}.`);
  });
  return migrations;
}

export function latestVersion(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.version ?? 0;
}

export function currentVersion(db: Db): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * Applies each pending migration in its own transaction, in order.
 * The version moves with the migration's changes, so a failure leaves the previous version and none of them.
 */
export function migrate(db: Db, migrations: readonly Migration[] = loadMigrations()): number {
  const supported = latestVersion(migrations);
  const found = currentVersion(db);
  if (found > supported) throw new DatabaseTooNewError(found, supported);
  for (const m of migrations) {
    if (m.version <= found) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return supported;
}
