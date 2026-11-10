import type { z } from "zod";

/** Where each problem is and what it says, as a reader of a log would see it: `path: message`. */
export function problems(result: z.ZodSafeParseResult<unknown>): string[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}
