import { type KeyboardEvent, useRef } from "react";
import { useIntl } from "react-intl";
import { type TabCounts, type TabId, paramOf, tabIds } from "./transactions.model.ts";
import styles from "./Transactions.module.css";

const labels: Record<TabId, string> = {
  needsYou: "tx.tab.needsYou",
  all: "tx.tab.all",
  imports: "tx.tab.imports",
};

export const tabDomId = (tab: TabId): string => `tx-tab-${paramOf(tab)}`;
export const panelDomId = (tab: TabId): string => `tx-panel-${paramOf(tab)}`;

export interface TabsProps {
  readonly active: TabId;
  readonly counts: TabCounts;
  readonly onChange: (tab: TabId) => void;
}

/** The three views of Transactions. Left and Right move between them and open the one they land on. */
export function Tabs({ active, counts, onChange }: TabsProps) {
  const intl = useIntl();
  const buttons = useRef(new Map<TabId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const at = tabIds.indexOf(active);
    const next =
      event.key === "ArrowRight" ? tabIds[(at + 1) % tabIds.length] : event.key === "ArrowLeft" ? tabIds[(at - 1 + tabIds.length) % tabIds.length] : event.key === "Home" ? tabIds[0] : event.key === "End" ? tabIds.at(-1) : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div role="tablist" aria-label={intl.formatMessage({ id: "tx.tabs.label" })} className={styles["tabs"]} onKeyDown={onKeyDown}>
      {tabIds.map((tab) => (
        <button
          key={tab}
          ref={(element) => {
            if (element === null) buttons.current.delete(tab);
            else buttons.current.set(tab, element);
          }}
          type="button"
          role="tab"
          id={tabDomId(tab)}
          aria-selected={tab === active}
          aria-controls={panelDomId(tab)}
          tabIndex={tab === active ? 0 : -1}
          className={styles["tab"]}
          onClick={() => onChange(tab)}
        >
          {intl.formatMessage({ id: labels[tab] })}
          <span className={styles["count"]} data-tone={tab === "needsYou" && counts.needsYou > 0 ? "attention" : "plain"}>
            {counts[tab]}
          </span>
        </button>
      ))}
    </div>
  );
}
