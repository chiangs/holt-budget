/**
 * A Norwegian account number as 11 digits, whatever dots or spaces the bank wrote ("1234.56.78901" and
 * "12345678901" are the same account). Bulder and SpareBank 1 write it differently, and a row is placed in
 * the household's account by this number (decision 0043).
 */

export type AccountNumber = string & { readonly __brand: "AccountNumber" };

export class AccountNumberError extends Error {
  override name = "AccountNumberError";
}

/** The number's 11 digits, or null when the text isn't an account number. */
export function parseAccountNumber(text: string): AccountNumber | null {
  const digits = text.replace(/[.\s]/g, "");
  return /^\d{11}$/.test(digits) ? (digits as AccountNumber) : null;
}

export function accountNumber(text: string): AccountNumber {
  const parsed = parseAccountNumber(text);
  if (parsed === null) throw new AccountNumberError(`Not an account number: "${text}"`);
  return parsed;
}
