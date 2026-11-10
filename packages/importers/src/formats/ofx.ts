import { type Currency, DateError, type LocalDate, MoneyError, type StatementRow, currency, localDate } from "@holt/core";
import { cleanCounterparty } from "../counterparty.ts";
import { accountNumber, amount, startOf } from "../fields.ts";
import { type BankFormat, ImportError, type StatedBalance } from "../types.ts";

/** One element of an OFX file: an aggregate with children, or a leaf with a value. */
interface Element {
  readonly name: string;
  readonly line: number;
  readonly children: Element[];
  text: string | undefined;
}

const entities: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const newlines = (text: string) => text.split("\n").length - 1;

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi, (whole, dec, hex, named) => {
    if (named !== undefined) return entities[named.toLowerCase()]!;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Reads OFX 1.x (SGML, where a leaf has no closing tag and the next tag ends it) and 2.x (XML, where every element closes)
 * into one tree. A leaf is an element with text and no children.
 */
function readElements(text: string, start: number): Element {
  const tagPattern = /<(\/?)([A-Za-z][\w.-]*)\s*(\/?)>|<[?!][^>]*>/g;
  const root: Element = { name: "#file", line: 1, children: [], text: undefined };
  const open = [root];
  const top = () => open[open.length - 1]!;
  let line = 1 + newlines(text.slice(0, start));
  let position = start;
  tagPattern.lastIndex = start;

  for (let match = tagPattern.exec(text); match !== null; match = tagPattern.exec(text)) {
    const gap = text.slice(position, match.index).trim();
    const tagLine = line + newlines(text.slice(position, match.index));
    line = tagLine + newlines(match[0]);
    position = tagPattern.lastIndex;
    if (gap !== "" && top() !== root && top().children.length === 0) top().text = decodeEntities(gap);
    const [, closing, rawName, selfClosing] = match;
    if (rawName === undefined) continue;
    const name = rawName.toUpperCase();

    if (closing === "/") {
      while (top() !== root && top().text !== undefined && top().name !== name) open.pop();
      if (top().name !== name) {
        if (open.some((e) => e.name === name)) throw new ImportError(`<${top().name}> is never closed.`, top().line);
        throw new ImportError(`There is a </${name}> with no <${name}> before it.`, tagLine);
      }
      open.pop();
      continue;
    }
    if (top() !== root && top().text !== undefined) open.pop();
    const element: Element = { name, line: tagLine, children: [], text: undefined };
    top().children.push(element);
    if (selfClosing !== "/") open.push(element);
  }
  while (top() !== root && top().text !== undefined) open.pop();
  if (top() !== root) throw new ImportError(`<${top().name}> is never closed.`, top().line);
  return root;
}

const child = (element: Element | undefined, name: string) => element?.children.find((c) => c.name === name);
const childrenNamed = (element: Element | undefined, name: string) => element?.children.filter((c) => c.name === name) ?? [];
const value = (element: Element | undefined, name: string) => child(element, name)?.text;

function find(element: Element, names: readonly string[]): Element[] {
  return names.includes(element.name) ? [element] : element.children.flatMap((c) => find(c, names));
}

function required(element: Element, name: string): string {
  const text = value(element, name);
  if (text === undefined || text === "") throw new ImportError(`The <${element.name}> element has no <${name}> element.`, element.line);
  return text;
}

/** An OFX date or datetime. The bank's own calendar day is the first eight digits; a time zone only moves the clock. */
function ofxDate(text: string, line: number): LocalDate {
  const parts = /^(\d{4})(\d{2})(\d{2})(?:\d{4}(?:\d{2})?)?(?:\.\d{1,3})?(?:\[[^\]]*\])?$/.exec(text);
  try {
    if (parts) return localDate(`${parts[1]}-${parts[2]}-${parts[3]}`);
  } catch (error) {
    if (!(error instanceof DateError)) throw error;
  }
  throw new ImportError(`"${text}" isn't an OFX date.`, line);
}

/** Amounts have a leading sign and one decimal separator. The published structure allows a dot or a comma. */
function ofxAmount(text: string, code: Currency, line: number) {
  return amount(text, code, line, text.includes(",") && !text.includes(".") ? "," : ".");
}

function ofxCurrency(text: string, line: number): Currency {
  try {
    return currency(text.trim().toUpperCase());
  } catch (error) {
    if (error instanceof MoneyError) throw new ImportError(`"${text}" isn't a currency code.`, line);
    throw error;
  }
}

/** Banks write an OFX account as the bare 11 digits or as a Norwegian IBAN ("NO" and two check digits first). */
function ofxAccount(text: string, line: number) {
  const iban = /^NO\d{2}(\d{11})$/i.exec(text.replace(/\s/g, ""));
  return accountNumber(iban?.[1] ?? text, line);
}

/**
 * Open Financial Exchange statements, read from the published structure of OFX 1.x and 2.x (section 11.4 of the 2.2 specification).
 * Neither of the household's banks offers OFX, so this has never met a real file: it is tested on synthetic files only.
 *
 * Each statement (STMTRS for a bank account, CCSTMTRS for a card) names its account (ACCTID) and its currency (CURDEF), so the
 * currency check in the import is exercised by a real field here. LEDGERBAL is a closing balance the file states.
 * A posted transaction (STMTTRN) is booked on DTPOSTED. A pending transaction (STMTTRNP, OFX 2.2) is the only pending marker
 * the format defines: it has no FITID and is booked on DTTRAN, the day it started, and it backs no transaction.
 * A transaction in another currency than its statement's (CURRENCY) is refused, because Holt never mixes currencies.
 * The original-currency aggregate (ORIGCURRENCY) is not carried: the format gives a rate but not the original amount.
 */
export const ofx: BankFormat = {
  id: "ofx",
  bank: "OFX",
  recognises: (text) => {
    const head = startOf(text);
    return /^OFXHEADER\s*:/i.test(head) || /^(?:<\?xml[^>]*\?>\s*)?(?:<\?OFX[^>]*\?>\s*)?<OFX[\s>]/i.test(head);
  },
  parse(text) {
    const start = text.search(/<OFX[\s>]/i);
    if (start === -1) throw new ImportError("The file has no <OFX> section.");
    const statements = find(readElements(text, start), ["STMTRS", "CCSTMTRS"]);
    if (statements.length === 0) throw new ImportError("The file has no account statement.");

    let accountCurrency: Currency | undefined;
    const rows: StatementRow[] = [];
    const closingBalances: StatedBalance[] = [];

    for (const statement of statements) {
      const curdef = child(statement, "CURDEF");
      if (curdef?.text === undefined) throw new ImportError("The statement doesn't state its currency.", statement.line);
      const statementCurrency = ofxCurrency(curdef.text, curdef.line);
      if (accountCurrency !== undefined && statementCurrency !== accountCurrency) {
        throw new ImportError(`This statement is in ${statementCurrency}, but the file's first is in ${accountCurrency}. Export one currency at a time.`, statement.line);
      }
      accountCurrency = statementCurrency;
      const accountElement = child(statement, "BANKACCTFROM") ?? child(statement, "CCACCTFROM");
      if (accountElement === undefined) throw new ImportError("The statement names no account.", statement.line);
      const account = ofxAccount(required(accountElement, "ACCTID"), child(accountElement, "ACCTID")?.line ?? accountElement.line);

      const transactions = [
        ...childrenNamed(child(statement, "BANKTRANLIST"), "STMTTRN").map((element) => ({ element, pending: false })),
        ...childrenNamed(child(statement, "BANKTRANLISTP"), "STMTTRNP").map((element) => ({ element, pending: true })),
      ];
      for (const { element, pending } of transactions) {
        if (child(element, "CORRECTFITID") !== undefined) {
          throw new ImportError("This transaction corrects an earlier one, and Holt can't apply a correction to a file it imported before.", element.line);
        }
        const foreign = value(child(element, "CURRENCY"), "CURSYM");
        if (foreign !== undefined && ofxCurrency(foreign, element.line) !== statementCurrency) {
          throw new ImportError(`This transaction is in ${foreign}, but the account is in ${statementCurrency}. Holt doesn't mix currencies.`, element.line);
        }
        const name = value(element, "NAME") ?? value(child(element, "PAYEE"), "NAME") ?? "";
        const memo = value(element, "MEMO") ?? "";
        const description = name === memo ? name : [name, memo].filter((part) => part !== "").join(" ");
        const counterparty = cleanCounterparty({ description, counterpartName: name || undefined });
        const bankType = value(element, "TRNTYPE");
        const reference = value(element, "CHECKNUM") ?? value(element, "REFNUM");
        rows.push({
          line: element.line,
          account,
          bookingDate: ofxDate(required(element, pending ? "DTTRAN" : "DTPOSTED"), element.line),
          description,
          ...(counterparty ? { counterparty } : {}),
          amount: ofxAmount(required(element, "TRNAMT"), statementCurrency, element.line),
          ...(name ? { counterpartName: name } : {}),
          ...(reference ? { reference } : {}),
          ...(bankType ? { bankType } : {}),
          pending,
        });
      }

      const ledger = child(statement, "LEDGERBAL");
      if (ledger !== undefined) {
        closingBalances.push({
          account,
          date: ofxDate(required(ledger, "DTASOF"), ledger.line),
          balance: ofxAmount(required(ledger, "BALAMT"), statementCurrency, ledger.line),
        });
      }
    }
    return { format: "ofx", accountCurrency: accountCurrency!, rows, closingBalances };
  },
};
