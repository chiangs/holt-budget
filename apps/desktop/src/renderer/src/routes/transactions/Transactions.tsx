import { Upload } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router";
import { useFactsView, useFigures, useLedger, useLedgerStatus } from "../../data/ledger.tsx";
import { AccountStatus } from "./AccountStatus.tsx";
import { AllTab } from "./AllTab.tsx";
import controls from "./Controls.module.css";
import { useDecisions } from "./decisions.ts";
import { ImportDialog } from "./ImportDialog.tsx";
import { ImportsTab } from "./ImportsTab.tsx";
import { pressOf } from "./keys.ts";
import { isImportKey } from "./keys.model.ts";
import { NeedsYouTab } from "./NeedsYouTab.tsx";
import { Tabs, panelDomId, tabDomId } from "./Tabs.tsx";
import { type TabId, activeTab, paramOf, tabCounts, tabFromParam } from "./transactions.model.ts";
import styles from "./Transactions.module.css";

function Skeleton() {
  const intl = useIntl();
  return (
    <div className={styles["skeleton"]} role="status" aria-busy="true" aria-label={intl.formatMessage({ id: "tx.loading" })}>
      <div className={styles["block"]} style={{ width: "16rem" }} />
      <div className={styles["blockCards"]}>
        <div className={styles["blockCard"]} />
        <div className={styles["blockCard"]} />
        <div className={styles["blockCard"]} />
      </div>
      <div className={styles["block"]} style={{ width: "100%" }} />
      <div className={styles["block"]} style={{ width: "100%" }} />
    </div>
  );
}

/** The Transactions screen: whether every account is up to date, and the three views of the family's transactions. */
export function Transactions() {
  const intl = useIntl();
  const status = useLedgerStatus();
  const view = useFactsView();
  const figures = useFigures();
  const { reload } = useLedger();
  const decisions = useDecisions();
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const importButton = useRef<HTMLButtonElement>(null);

  const ready = status.kind === "ready" && view !== null && figures !== null;

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!ready || importing || !isImportKey(pressOf(event))) return;
    event.preventDefault();
    setImporting(true);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const closeImport = () => {
    setImporting(false);
    importButton.current?.focus();
  };

  // Decided once, when the data first arrives, so sorting the last waiting transaction doesn't move the family to another tab.
  const [opening, setOpening] = useState<TabId | null>(null);
  if (ready && opening === null) setOpening(activeTab(null, figures.needsYou.length));
  const tab = tabFromParam(params.get("tab")) ?? opening ?? "all";
  const choose = (next: TabId) => setParams({ tab: paramOf(next) });

  return (
    <div className={styles["page"]}>
      <header className={styles["header"]}>
        <div className={styles["heading"]}>
          <h1 className="type-title-screen">{intl.formatMessage({ id: "screen.transactions.title" })}</h1>
          <p className="muted">{intl.formatMessage({ id: "screen.transactions.question" })}</p>
        </div>
        {ready && (
          <button ref={importButton} type="button" className={`${controls["button"]} ${controls["primary"]} ${controls["large"]}`} aria-keyshortcuts="N" aria-haspopup="dialog" onClick={() => setImporting(true)}>
            <Upload size={16} strokeWidth={2} aria-hidden="true" />
            {intl.formatMessage({ id: "tx.import" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "tx.key.import" })}
            </span>
          </button>
        )}
      </header>

      {status.kind === "loading" && <Skeleton />}

      {status.kind === "empty" && (
        <section className={styles["notice"]} aria-labelledby="tx-empty-title">
          <h2 id="tx-empty-title" className="type-title-section">
            {intl.formatMessage({ id: "tx.empty.title" })}
          </h2>
          <p className="muted">{intl.formatMessage({ id: "tx.empty.body" })}</p>
        </section>
      )}

      {status.kind === "failed" && (
        <section className={styles["notice"]} aria-labelledby="tx-failed-title">
          <h2 id="tx-failed-title" className="type-title-section">
            {intl.formatMessage({ id: "tx.failed.title" })}
          </h2>
          <p className="muted">{intl.formatMessage({ id: "tx.failed.body" })}</p>
          <button type="button" className={controls["button"]} onClick={() => void reload()}>
            {intl.formatMessage({ id: "tx.failed.retry" })}
          </button>
        </section>
      )}

      {ready && (
        <>
          <AccountStatus facts={view.facts} status={figures.importStatus} today={view.today} />
          <Tabs active={tab} counts={tabCounts(view.facts, figures)} onChange={choose} />
          <div role="tabpanel" id={panelDomId(tab)} aria-labelledby={tabDomId(tab)} className={styles["panel"]}>
            {tab === "needsYou" && <NeedsYouTab facts={view.facts} figures={figures} decisions={decisions} />}
            {tab === "all" && <AllTab />}
            {tab === "imports" && <ImportsTab />}
          </div>
        </>
      )}

      {importing && <ImportDialog onClose={closeImport} onShowNeedsYou={() => choose("needsYou")} />}
    </div>
  );
}
