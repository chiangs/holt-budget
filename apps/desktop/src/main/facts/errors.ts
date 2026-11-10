/** A write found the database different from the facts in memory. The transaction rolls back and nothing changes. */
export class StoreDivergence extends Error {
  override name = "StoreDivergence";
  readonly table: string;
  readonly key: string;

  constructor(table: string, key: string) {
    super(`The app found that ${table} ${key} in the database is not what it expected, so it changed nothing.`);
    this.table = table;
    this.key = key;
  }
}

/** The change would write something the app couldn't read back, such as a batch past the size core accepts. Nothing was written. */
export class UnstorableChangeError extends Error {
  override name = "UnstorableChangeError";

  constructor(cause: unknown) {
    super("The app can't store this change, because it wouldn't be able to read it back.", { cause });
  }
}

export class HouseholdExistsError extends Error {
  override name = "HouseholdExistsError";

  constructor() {
    super("The app can't create a household, because this database already holds one.");
  }
}
