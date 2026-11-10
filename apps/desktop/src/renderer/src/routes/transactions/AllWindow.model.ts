/**
 * The arithmetic of a windowed list. Every row has the same height, so which rows are on screen follows from
 * the scroll position alone, and the page renders only those and a few more either side.
 */

export interface WindowSpec {
  readonly rowHeight: number;
  readonly count: number;
  /** Extra rows rendered above and below what is on screen, so a fast scroll never shows a blank. */
  readonly overscan: number;
}

export interface Viewport {
  readonly scrollTop: number;
  readonly height: number;
}

export interface RowRange {
  /** The first row to render. */
  readonly start: number;
  /** One past the last row to render. */
  readonly end: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

export function totalHeight({ rowHeight, count }: Pick<WindowSpec, "rowHeight" | "count">): number {
  return rowHeight * count;
}

/** The most rows `visibleRange` ever returns for a viewport this tall. */
export function maxRendered(height: number, { rowHeight, overscan }: Pick<WindowSpec, "rowHeight" | "overscan">): number {
  return Math.ceil(Math.max(height, 0) / rowHeight) + 1 + 2 * overscan;
}

/** The rows to render: every row that shows, plus the overscan, never outside the list. A scroll position past the end counts as the end. */
export function visibleRange({ scrollTop, height }: Viewport, { rowHeight, count, overscan }: WindowSpec): RowRange {
  const viewport = Math.max(height, 0);
  const top = clamp(scrollTop, 0, Math.max(0, rowHeight * count - viewport));
  const first = Math.floor(top / rowHeight);
  const after = Math.ceil((top + viewport) / rowHeight);
  return { start: clamp(first - overscan, 0, count), end: clamp(after + overscan, 0, count) };
}

/** The scroll position that brings a row fully into view with the least movement, or the current one when it already shows. */
export function scrollTopToReveal(index: number, { scrollTop, height }: Viewport, { rowHeight }: Pick<WindowSpec, "rowHeight">): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}

export type Move = "next" | "previous" | "first" | "last" | "pageDown" | "pageUp";

/** Where the highlight goes for a key. From nothing, a move forward or back lands on the first row. Null only when the list is empty. */
export function moveHighlight(highlighted: number | null, move: Move, count: number, pageSize: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const page = Math.max(1, pageSize);
  const current = highlighted === null ? null : clamp(highlighted, 0, last);
  switch (move) {
    case "first":
      return 0;
    case "last":
      return last;
    case "next":
      return current === null ? 0 : Math.min(current + 1, last);
    case "previous":
      return current === null ? 0 : Math.max(current - 1, 0);
    case "pageDown":
      return current === null ? Math.min(page - 1, last) : Math.min(current + page, last);
    case "pageUp":
      return current === null ? 0 : Math.max(current - page, 0);
  }
}
