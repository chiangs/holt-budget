import type { AccountId, Facts } from "@holt/core";
import { Info, TriangleAlert } from "lucide-react";
import { type Dispatch, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { entryOf, type Action, type Checking } from "./ImportFlow.model.ts";
import { ImportBalances } from "./ImportBalances.tsx";
import { ImportPreviewTable } from "./ImportPreviewTable.tsx";
import { chipsOf, dottedAccountNumber, leftOutNotice, nearMatchNotice, pickableJobs, rowViews, shownWords, type RowView } from "./ImportPreview.model.ts";
import { say } from "./ImportSay.ts";
import { type WhyContext, signedAmount } from "./ImportWhy.model.ts";
import { formatMoney } from "../../i18n/money.ts";
import { JobPicker } from "./JobPicker.tsx";
import kit from "./ImportKit.module.css";
import styles from "./ImportCheck.module.css";

export interface ImportCheckProps {
  readonly check: Checking;
  readonly facts: Facts;
  /** Add is under way, so nothing can change. */
  readonly busy: boolean;
  readonly dispatch: Dispatch<Action>;
}

/** What the app read from the file, for the family to check: the counts, the balances, and every new row with the job it gives and why. */
export function ImportCheck({ check, facts, busy, dispatch }: ImportCheckProps) {
  const intl = useIntl();
  const base = useId();
  const root = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState<RowView | null>(null);
  const { preview, currency } = check;
  const updating = check.version !== check.plannedVersion;

  const accountName = (id: AccountId): string => facts.accounts.get(id)?.name ?? "";
  const context = useMemo<WhyContext>(() => ({ jobName: (id) => facts.jobs.get(id)?.name ?? "", transaction: (id) => facts.transactions.get(id) }), [facts]);
  const jobs = useMemo(() => pickableJobs(facts), [facts]);
  const rows = useMemo(() => rowViews(check.order, preview.sample, context), [check.order, preview.sample, context]);
  const { problems } = entryOf(check);
  const leftOut = leftOutNotice(preview);
  const near = nearMatchNotice(preview);

  /** The picker returns focus to what opened it, and this makes sure of it: the row's button is the same element after the plan moves on. */
  const backToRow = (line: number): void => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-job-line="${line}"]`)?.focus());
  };

  return (
    <div ref={root} className={styles.check}>
      <ul className={kit.chips} aria-label={intl.formatMessage({ id: "import.chips.label" })}>
        {chipsOf(preview.counts, preview.completedMoves.length).map((chip) => (
          <li key={chip.key} className={chip.tone === "attention" ? `${kit.chip} ${kit.chipAttention}` : kit.chip}>
            {chip.tone === "attention" && <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />}
            {say(intl, currency, chip.words)}
          </li>
        ))}
      </ul>

      {leftOut !== null && (
        <div className={kit.notice}>
          <Info size={18} strokeWidth={1.75} aria-hidden="true" />
          <div className={kit.noticeBody}>
            <p>{say(intl, currency, leftOut.words)}</p>
            <ul className={kit.list} aria-label={intl.formatMessage({ id: "import.leftOut.title" })}>
              {leftOut.accounts.map((account) => (
                <li key={account.account}>
                  <span className={kit.mono}>{dottedAccountNumber(account.account)}</span>
                  {account.accountName !== undefined && <span> {account.accountName}</span>}
                  <span className={kit.muted}> ({intl.formatMessage({ id: "import.leftOut.rows" }, { rows: account.rows })})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {near !== null && (
        <div className={`${kit.notice} ${kit.noticeNote}`}>
          <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          <p className={kit.noticeBody}>{say(intl, currency, near)}</p>
        </div>
      )}

      <label className={styles.suggest}>
        <input type="checkbox" checked={check.draft.suggest} disabled={busy} aria-describedby={`${base}-help`} onChange={(event) => dispatch({ type: "suggested", on: event.target.checked })} />
        <span>
          <span className={kit.strong}>{intl.formatMessage({ id: "import.suggest.label" })}</span>
          <span id={`${base}-help`} className={styles.help}>
            {intl.formatMessage({ id: "import.suggest.help" })}
          </span>
        </span>
      </label>

      <ImportBalances
        preview={preview}
        fields={check.draft.balances}
        problems={problems}
        accountName={accountName}
        currency={currency}
        today={check.today}
        updating={updating}
        disabled={busy}
        onText={(accountId, text) => dispatch({ type: "typed", accountId, text })}
        onDate={(accountId, asOf) => dispatch({ type: "dated", accountId, asOf })}
      />

      {preview.counts.created > 0 && (
        <section aria-labelledby={`${base}-rows`} className={styles.rows}>
          <h3 id={`${base}-rows`} className={kit.sectionTitle}>
            {intl.formatMessage({ id: "import.table.title" })}
          </h3>
          <ImportPreviewTable rows={rows} currency={currency} disabled={busy} onPick={setPicking} />
          <p className={kit.muted}>{say(intl, currency, shownWords(preview, check.draft.suggest))}</p>
        </section>
      )}

      {picking !== null && (
        <JobPicker
          jobs={jobs}
          titleId="import.pick.title"
          subject={intl.formatMessage(
            { id: "import.pick.subject" },
            { description: picking.description, amount: `${signedAmount(picking.amount).sign}${formatMoney(signedAmount(picking.amount).figure, currency, intl.locale)}` },
          )}
          onPick={(jobId) => {
            dispatch({ type: "chose", choice: { line: picking.line, jobId, amount: picking.amount } });
            setPicking(null);
            backToRow(picking.line);
          }}
          onClose={() => {
            setPicking(null);
            backToRow(picking.line);
          }}
        />
      )}
    </div>
  );
}
