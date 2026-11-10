import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Move, maxRendered, moveHighlight, scrollTopToReveal, totalHeight, visibleRange } from "./AllWindow.model.ts";

const spec = fc.record({
  rowHeight: fc.integer({ min: 20, max: 120 }),
  count: fc.integer({ min: 0, max: 20_000 }),
  overscan: fc.integer({ min: 0, max: 12 }),
});
const view = fc.record({ scrollTop: fc.integer({ min: -500, max: 3_000_000 }), height: fc.integer({ min: 0, max: 2_000 }) });

describe("the rendered window", () => {
  it("covers every row that shows in the viewport (property)", () => {
    fc.assert(
      fc.property(spec, view, ({ rowHeight, count, overscan }, { scrollTop, height }) => {
        const { start, end } = visibleRange({ scrollTop, height }, { rowHeight, count, overscan });
        const top = Math.min(Math.max(scrollTop, 0), Math.max(0, rowHeight * count - height));
        for (let row = Math.max(0, Math.floor(top / rowHeight) - 1); row < Math.min(count, Math.ceil((top + height) / rowHeight) + 1); row += 1) {
          const showsInViewport = row * rowHeight < top + height && (row + 1) * rowHeight > top;
          if (showsInViewport) expect(row >= start && row < end).toBe(true);
        }
      }),
    );
  });

  it("never renders more rows than a viewport and its overscan can hold, however long the list is (property)", () => {
    fc.assert(
      fc.property(spec, view, ({ rowHeight, count, overscan }, { scrollTop, height }) => {
        const { start, end } = visibleRange({ scrollTop, height }, { rowHeight, count, overscan });
        expect(end - start).toBeLessThanOrEqual(maxRendered(height, { rowHeight, overscan }));
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(count);
        expect(start).toBeLessThanOrEqual(end);
      }),
    );
  });

  it("renders a few dozen rows of 8,556 at the top, in the middle and at the end", () => {
    const list = { rowHeight: 56, count: 8_556, overscan: 6 };
    const viewport = { height: 640 };
    const bound = maxRendered(viewport.height, list);
    expect(bound).toBeLessThan(30);
    for (const scrollTop of [0, 250_000, totalHeight(list) - viewport.height, totalHeight(list) * 2]) {
      const { start, end } = visibleRange({ ...viewport, scrollTop }, list);
      expect(end - start).toBeGreaterThan(0);
      expect(end - start).toBeLessThanOrEqual(bound);
    }
    expect(visibleRange({ ...viewport, scrollTop: totalHeight(list) * 2 }, list).end).toBe(8_556);
  });

  it("renders nothing for an empty list", () => {
    expect(visibleRange({ scrollTop: 0, height: 600 }, { rowHeight: 56, count: 0, overscan: 6 })).toEqual({ start: 0, end: 0 });
  });
});

describe("keeping a row in view", () => {
  const list = { rowHeight: 50 };
  it("leaves the scroll alone when the row already shows", () => {
    expect(scrollTopToReveal(5, { scrollTop: 200, height: 400 }, list)).toBe(200);
  });
  it("scrolls up just far enough for a row above, and down just far enough for a row below", () => {
    expect(scrollTopToReveal(2, { scrollTop: 200, height: 400 }, list)).toBe(100);
    expect(scrollTopToReveal(20, { scrollTop: 200, height: 400 }, list)).toBe(650);
  });
  it("never scrolls above the top", () => {
    expect(scrollTopToReveal(0, { scrollTop: 0, height: 400 }, list)).toBe(0);
  });
});

describe("moving the highlight with the keys", () => {
  const moves: readonly Move[] = ["next", "previous", "first", "last", "pageDown", "pageUp"];

  it("always lands on a row of the list, or on nothing when the list is empty (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), fc.option(fc.nat(600), { nil: null }), fc.constantFrom(...moves), fc.integer({ min: 0, max: 40 }), (count, current, move, page) => {
        const from = current === null ? null : current;
        const next = moveHighlight(from, move, count, page);
        if (count === 0) expect(next).toBeNull();
        else {
          expect(next).not.toBeNull();
          expect(next!).toBeGreaterThanOrEqual(0);
          expect(next!).toBeLessThan(count);
        }
      }),
    );
  });

  it("steps one row, stops at the ends, and starts at the first row from nothing", () => {
    expect(moveHighlight(3, "next", 10, 5)).toBe(4);
    expect(moveHighlight(3, "previous", 10, 5)).toBe(2);
    expect(moveHighlight(9, "next", 10, 5)).toBe(9);
    expect(moveHighlight(0, "previous", 10, 5)).toBe(0);
    expect(moveHighlight(null, "next", 10, 5)).toBe(0);
    expect(moveHighlight(null, "previous", 10, 5)).toBe(0);
    expect(moveHighlight(3, "first", 10, 5)).toBe(0);
    expect(moveHighlight(3, "last", 10, 5)).toBe(9);
    expect(moveHighlight(3, "pageDown", 100, 8)).toBe(11);
    expect(moveHighlight(3, "pageUp", 100, 8)).toBe(0);
  });
});
