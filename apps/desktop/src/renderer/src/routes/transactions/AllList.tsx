import type { Transaction, TransactionId } from "@holt/core";
import { ScrollText } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { type Move, moveHighlight, scrollTopToReveal, totalHeight, visibleRange } from "./AllWindow.model.ts";
import { type Names, signedMoney, titleOf, treatmentWords } from "./AllLabels.model.ts";
import controls from "./AllControls.module.css";
import styles from "./AllList.module.css";

/** Every row is this tall, which is what lets the list render only the rows in view. */
export const rowHeight = 56;
const overscan = 6;

export interface AllListProps {
  readonly rows: readonly Transaction[];
  readonly names: Names;
  readonly currency: string;
  /** The row the keys moved to. */
  readonly highlightedId: TransactionId | null;
  /** The row shown in the detail panel. */
  readonly openId: TransactionId | null;
  readonly onHighlight: (id: TransactionId) => void;
  readonly onOpen: (id: TransactionId) => void;
  /** Esc, when a detail panel is open. */
  readonly onDismiss: () => void;
  /** E: change the job of this row. */
  readonly onEdit: (id: TransactionId) => void;
}

const keyMoves: Readonly<Record<string, Move>> = {
  ArrowDown: "next",
  j: "next",
  J: "next",
  ArrowUp: "previous",
  k: "previous",
  K: "previous",
  Home: "first",
  End: "last",
  PageDown: "pageDown",
  PageUp: "pageUp",
};

/**
 * A windowed list: the page holds a handful of rows however many transactions there are. The list itself
 * takes focus, and the highlighted row is its active descendant, so Tab goes from the list to the detail panel
 * beside it, and the keys (arrows, J and K, Home, End, Page Up and Down) move the highlight.
 */
export function AllList({ rows, names, currency, highlightedId, openId, onHighlight, onOpen, onDismiss, onEdit }: AllListProps) {
  const intl = useIntl();
  const listId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = (): void => setViewport((v) => (v.height === element.clientHeight ? v : { ...v, height: element.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The header sits outside the scroller, so it gives up the scroll bar's width to stay above its columns.
  useLayoutEffect(() => {
    const element = scroller.current;
    frame.current?.style.setProperty("--scrollbar", `${element === null ? 0 : element.offsetWidth - element.clientWidth}px`);
  });

  const range = visibleRange(viewport, { rowHeight, count: rows.length, overscan });
  const highlightedIndex = highlightedId === null ? -1 : rows.findIndex((t) => t.id === highlightedId);
  const optionId = (id: TransactionId): string => `${listId}-${id}`;

  useEffect(() => {
    const element = scroller.current;
    if (element === null || highlightedIndex < 0) return;
    element.scrollTop = scrollTopToReveal(highlightedIndex, { scrollTop: element.scrollTop, height: element.clientHeight }, { rowHeight });
    // The scroll event arrives with the next frame, so the window is told now: the row must be rendered before it can be the active descendant.
    setViewport((v) => (v.scrollTop === element.scrollTop ? v : { ...v, scrollTop: element.scrollTop }));
  }, [highlightedIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const current = highlightedIndex < 0 ? null : highlightedIndex;
    const move = keyMoves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const page = Math.max(1, Math.floor(viewport.height / rowHeight) - 1);
      const next = moveHighlight(current, move, rows.length, page);
      const target = next === null ? undefined : rows[next];
      if (target !== undefined) onHighlight(target.id);
      return;
    }
    const row = current === null ? undefined : rows[current];
    if (event.key === "Enter" && row !== undefined) {
      event.preventDefault();
      onOpen(row.id);
    } else if ((event.key === "e" || event.key === "E") && row !== undefined) {
      event.preventDefault();
      onEdit(row.id);
    } else if (event.key === "Escape" && openId !== null) {
      event.preventDefault();
      onDismiss();
    }
  };

  const active = highlightedIndex >= range.start && highlightedIndex < range.end && highlightedId !== null ? optionId(highlightedId) : undefined;

  return (
    <div className={styles.frame} ref={frame}>
      <div className={styles.header} aria-hidden="true">
        <span>{intl.formatMessage({ id: "browse.list.date" })}</span>
        <span>{intl.formatMessage({ id: "browse.list.what" })}</span>
        <span>{intl.formatMessage({ id: "browse.list.decided" })}</span>
        <span className={styles.right}>{intl.formatMessage({ id: "browse.list.amount" })}</span>
      </div>
      <div
        ref={scroller}
        className={styles.scroller}
        role="listbox"
        tabIndex={0}
        aria-label={intl.formatMessage({ id: "browse.list.label" })}
        aria-activedescendant={active}
        aria-keyshortcuts="J K"
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          const scrollTop = event.currentTarget.scrollTop;
          setViewport((v) => (v.scrollTop === scrollTop ? v : { ...v, scrollTop }));
        }}
      >
        <div role="presentation" className={styles.space} style={{ height: totalHeight({ rowHeight, count: rows.length }) }}>
          {rows.slice(range.start, range.end).map((transaction, offset) => {
            const index = range.start + offset;
            return (
              <Row
                key={transaction.id}
                id={optionId(transaction.id)}
                transaction={transaction}
                index={index}
                count={rows.length}
                names={names}
                currency={currency}
                highlighted={transaction.id === highlightedId}
                open={transaction.id === openId}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  readonly id: string;
  readonly transaction: Transaction;
  readonly index: number;
  readonly count: number;
  readonly names: Names;
  readonly currency: string;
  readonly highlighted: boolean;
  readonly open: boolean;
  readonly onOpen: (id: TransactionId) => void;
}

function Row({ id, transaction, index, count, names, currency, highlighted, open, onOpen }: RowProps) {
  const intl = useIntl();
  const words = treatmentWords(transaction, names);
  const waiting = transaction.treatment.kind === "needsYou";
  const classes = [styles.row, waiting ? styles.waiting : "", open ? styles.open : "", highlighted ? styles.highlighted : ""].join(" ");
  return (
    <div
      id={id}
      role="option"
      aria-selected={open}
      aria-posinset={index + 1}
      aria-setsize={count}
      data-transaction={transaction.id}
      className={classes}
      style={{ height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
      onClick={() => onOpen(transaction.id)}
    >
      <span className={`${styles.date} ${controls.figure}`}>{formatDay(transaction.bookingDate, intl.locale)}</span>
      <span className={styles.main}>
        <span className={styles.title}>{titleOf(transaction)}</span>
        <span className={styles.sub}>
          {names.account(transaction.accountId)}
          <span className={styles.description}>
            <span aria-hidden="true"> · </span>
            {transaction.description}
          </span>
        </span>
      </span>
      <span className={styles.words}>
        <span className={styles.wordsText}>{intl.formatMessage({ id: words.id }, words.values)}</span>
        {transaction.ruleId !== undefined && (
          <span className={styles.rule} title={intl.formatMessage({ id: "browse.list.rule" })}>
            <ScrollText size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className={controls.hidden}>{intl.formatMessage({ id: "browse.list.rule" })}</span>
          </span>
        )}
      </span>
      <span className={`${styles.amount} ${controls.figure}`}>{signedMoney(transaction.amount, currency, intl.locale)}</span>
    </div>
  );
}
