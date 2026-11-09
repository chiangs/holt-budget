import { describe, expect, it } from "vitest";
import { findHardcodedStrings } from "./find-hardcoded-strings.mjs";

const texts = (source: string) => findHardcodedStrings(source, "x.tsx").map((p) => p.text);

describe("hard-coded string lint (M1)", () => {
  it("flags visible text in JSX", () => {
    expect(texts("const a = <h1>Overview</h1>;")).toEqual(["Overview"]);
    expect(texts("const a = <p>\n  Runs on this computer.\n</p>;")).toEqual(["Runs on this computer."]);
  });

  it("flags text beside an element", () => {
    expect(texts("const a = <p><b>{x}</b> and more</p>;")).toEqual(["and more"]);
  });

  it("flags string literals in expression containers", () => {
    expect(texts('const a = <p>{"Overview"}</p>;')).toEqual(["Overview"]);
    expect(texts("const a = <p>{`Overview`}</p>;")).toEqual(["Overview"]);
  });

  it.each(["aria-label", "aria-description", "title", "placeholder", "alt", "label"])("flags a literal %s", (name) => {
    expect(texts(`const a = <input ${name}="Search" />;`)).toEqual(["Search"]);
    expect(texts(`const a = <input ${name}={"Search"} />;`)).toEqual(["Search"]);
  });

  it("lets message-layer text, symbols and empty alt through", () => {
    expect(texts("const a = <h1><FormattedMessage id=\"nav.overview\" /></h1>;")).toEqual([]);
    expect(texts("const a = <h1>{intl.formatMessage({ id: 'nav.overview' })}</h1>;")).toEqual([]);
    expect(texts('const a = <img src="./holt-small.svg" alt="" />;')).toEqual([]);
    expect(texts("const a = <span>·</span>;")).toEqual([]);
    expect(texts("const a = <span>{count}</span>;")).toEqual([]);
    expect(texts('const a = <div className="nav-row" data-theme="hearth-light" />;')).toEqual([]);
    expect(texts("const a = <Icon aria-label={label} title={intl.formatMessage(m)} />;")).toEqual([]);
  });

  it("does not mistake generics and comparisons for JSX text", () => {
    expect(texts("const [a] = useState<string>('x'); const ok = 1 > 0 && 2 < 3; type T = Promise<void> | Promise<string>;")).toEqual([]);
  });

  it("reports the line", () => {
    expect(findHardcodedStrings("const a = (\n  <div>\n    <p>Hello</p>\n  </div>\n);", "x.tsx")[0]?.line).toBe(3);
  });
});
