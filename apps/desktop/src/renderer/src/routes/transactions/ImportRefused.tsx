import { useIntl } from "react-intl";
import type { RefusedView } from "./ImportFlow.model.ts";
import { dottedAccountNumber } from "./ImportPreview.model.ts";
import { say } from "./ImportSay.ts";
import kit from "./ImportKit.module.css";

/** Why the app can't use this file, in plain words. The only way on is to choose another file, which the dialog's footer offers. */
export function ImportRefused({ view, currency }: { readonly view: RefusedView; readonly currency: string }) {
  const intl = useIntl();
  return (
    <>
      <p>{say(intl, currency, view.detail)}</p>
      {view.note !== null && <p className={kit.muted}>{view.note}</p>}
      {view.leftOut.length > 0 && (
        <div>
          <h3 className={kit.sectionTitle}>{intl.formatMessage({ id: "import.leftOut.title" })}</h3>
          <ul className={kit.list}>
            {view.leftOut.map((account) => (
              <li key={account.account}>
                <span className={kit.mono}>{dottedAccountNumber(account.account)}</span>
                {account.accountName !== undefined && <span> {account.accountName}</span>}
                <span className={kit.muted}> ({intl.formatMessage({ id: "import.leftOut.rows" }, { rows: account.rows })})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
