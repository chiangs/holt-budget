import { z } from "zod";

const currencies = new Set(Intl.supportedValuesOf("currency"));

/** One schema per table, named after it. A test compares each with `PRAGMA table_info`. */
export const HouseholdRow = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/).refine((c) => currencies.has(c), "Not an ISO 4217 currency code."),
  created_at: z.string().min(1),
});
export type HouseholdRow = z.infer<typeof HouseholdRow>;

export const rowSchemas = { household: HouseholdRow } as const;
