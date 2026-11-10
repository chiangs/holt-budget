/**
 * The family's facts and their change log, kept in the encrypted database. This is the only file code
 * outside `main/facts/` may import (`pnpm lint:facts` checks it).
 */

export { type FactsStore, type StoreDeps, HouseholdExistsError, StoreDivergence, UnstorableChangeError, createFactsStore, openFactsStore } from "./store.ts";
