import type { ImportBatchId } from "@holt/core";
import { householdOf } from "@holt/core";
import { FileUp, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView } from "../../data/ledger.tsx";
import { formatDay } from "../../i18n/dates.ts";
import { importRows } from "./ImportsList.model.ts";
import { ImportUndoDialog } from "./ImportUndoDialog.tsx";
import { say } from "./ImportSay.ts";
import kit from "./ImportKit.module.css";
import styles from "./ImportsTab.module.css";

/** The history of imports: one row for each file, newest first, each with Undo import and the preview of what that would remove. */
export function ImportsTab() {
  const intl = useIntl();
  const view = useFactsView();
  const rows = useMemo(() => (view === null ? [] : importRows(view.facts, view.today)), [view]);
  const [undoing, setUndoing] = useState<ImportBatchId | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [focusBatch, setFocusBatch] = useState<ImportBatchId | null>(null);
  const items = useRef(new Map<ImportBatchId, HTMLLIElement>());

  useEffect(() => {
    if (focusBatch === null) return;
    items.current.get(focusBatch)?.focus();
    setFocusBatch(null);
  }, [focusBatch, rows]);

  if (view === null) return null;
  const currency = householdOf(view.facts).currency;

  return (
    <section className={styles.section} aria-labelledby="imports-title">
      <h2 id="imports-title" className={styles.title}>
        {intl.formatMessage({ id: "import.list.title" })}
      </h2>
      <p className={styles.intro}>{intl.formatMessage({ id: "import.list.intro" })}</p>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <FileUp size={24} strokeWidth={1.75} aria-hidden="true" />
          <h3 className={styles.emptyTitle}>{intl.formatMessage({ id: "import.list.empty.title" })}</h3>
          <p className={styles.intro}>{intl.formatMessage({ id: "import.list.empty.body" })}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li
              key={row.batchId}
              ref={(element) => {
                if (element === null) items.current.delete(row.batchId);
                else items.current.set(row.batchId, element);
              }}
              tabIndex={-1}
              className={styles.row}
            >
              <div className={styles.top}>
                <div>
                  <h3 className={styles.name}>{row.fileName}</h3>
                  <p className={styles.meta}>
                    {say(intl, currency, row.bank)}
                    {row.accounts.length > 0 && ` · ${intl.formatList(row.accounts, { type: "conjunction" })}`}
                  </p>
                </div>
                <div className={styles.actions}>
                  <span className={row.undone ? `${styles.state} ${styles.stateUndone}` : styles.state}>
                    {row.undone && <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />}
                    {intl.formatMessage({ id: row.undone ? "import.list.state.undone" : "import.list.state.added" })}
                  </span>
                  {!row.undone && (
                    <button type="button" className={kit.secondary} aria-label={intl.formatMessage({ id: "import.list.undoAria" }, { fileName: row.fileName })} onClick={() => setUndoing(row.batchId)}>
                      {intl.formatMessage({ id: "import.list.undo" })}
                    </button>
                  )}
                </div>
              </div>
              <p className={styles.meta}>
                {intl.formatMessage({ id: "import.list.period" }, { from: formatDay(row.from, intl.locale), to: formatDay(row.to, intl.locale) })} · {say(intl, currency, row.when)}
              </p>
              <p className={styles.counts}>
                {intl.formatMessage(
                  { id: row.needsYou === null ? "import.list.countsUndone" : "import.list.counts" },
                  { created: row.created, matched: row.matched, pending: row.pending, needsYou: row.needsYou ?? 0 },
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div role="status" aria-live="polite" className={kit.srOnly}>
        {announcement}
      </div>

      {undoing !== null && (
        <ImportUndoDialog
          batchId={undoing}
          onClose={() => setUndoing(null)}
          onUndone={(removed, fileName) => {
            const batch = undoing;
            setUndoing(null);
            setAnnouncement(intl.formatMessage({ id: "import.list.undone" }, { fileName, count: removed }));
            setFocusBatch(batch);
          }}
        />
      )}
    </section>
  );
}
