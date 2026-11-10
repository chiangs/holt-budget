/**
 * The formats that have never read a real file from a bank's own export. The import screen tells the family
 * so, and asks them to check the rows and the balance with extra care. Remove a format from this list once it has read
 * a real file. It is its own tiny module so the page can import it without bundling the parsers.
 */
export const unprovenFormats: readonly string[] = ["ofx"];

export function isUnprovenFormat(formatId: string): boolean {
  return unprovenFormats.includes(formatId);
}
