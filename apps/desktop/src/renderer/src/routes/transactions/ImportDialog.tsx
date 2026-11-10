import { householdOf } from "@holt/core";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView, useFigures, useLedger } from "../../data/ledger.tsx";
import { ImportCheck } from "./ImportCheck.tsx";
import { type Checking, type Flow, canAdd, entryOf, flowReducer, refusedView, startFlow } from "./ImportFlow.model.ts";
import { ImportModal } from "./ImportModal.tsx";
import { addWords, readAsWords } from "./ImportPreview.model.ts";
import { ImportRefused } from "./ImportRefused.tsx";
import { ImportResult } from "./ImportResult.tsx";
import { resultView } from "./ImportResult.model.ts";
import { whenWords } from "./ImportsList.model.ts";
import { ImportUndoDialog } from "./ImportUndoDialog.tsx";
import { say } from "./ImportSay.ts";
import kit from "./ImportKit.module.css";

export interface ImportDialogProps {
  readonly onClose: () => void;
  /** Shows the Needs you tab, for the button in the result that takes the family to the rows still waiting for a job. Without it the button is not shown. */
  readonly onShowNeedsYou?: () => void;
}

const checkingOf = (flow: Flow): Checking | null => {
  const { stage } = flow;
  return stage.kind === "checking" || stage.kind === "adding" || stage.kind === "added" || stage.kind === "behind" ? stage.check : null;
};

/** The whole import flow: choose a file, check what the app read, type the balances, press Add, see the result. Mount it to open it and unmount it to close it. */
export function ImportDialog({ onClose, onShowNeedsYou }: ImportDialogProps) {
  const intl = useIntl();
  const { importer, reload } = useLedger();
  const view = useFactsView();
  const figures = useFigures();
  const titleId = useId();
  const [flow, dispatch] = useReducer(flowReducer, startFlow);
  const [undoing, setUndoing] = useState(false);
  const shell = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trouble = useRef<HTMLParagraphElement>(null);
  const alive = useRef(true);
  const started = useRef(false);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });

  const { stage } = flow;
  const check = checkingOf(flow);
  const facts = view?.facts ?? null;
  const currency = facts === null ? "NOK" : householdOf(facts).currency;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The native file window runs in the main process. A cancelled window changes nothing. */
  const choose = useCallback(async () => {
    const result = await importer.open();
    const current = latest.current;
    if (!alive.current || current === null) return;
    dispatch({ type: "opened", result, currency: householdOf(current.facts).currency, today: current.today });
  }, [importer]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void choose();
  }, [choose]);

  const finish = useCallback(() => {
    shell.current?.close();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (stage.kind === "closed") finish();
  }, [stage.kind, finish]);

  /** A changed balance or choice plans again: a balance after a pause for typing, a job or the switch at once. */
  const planning = stage.kind === "checking" ? stage.check : null;
  useEffect(() => {
    if (planning === null || planning.version === planning.plannedVersion) return;
    const { session, version } = planning;
    const entry = entryOf(planning).entry;
    const timer = window.setTimeout(
      () => {
        void importer.plan(session, entry).then((result) => {
          if (alive.current) dispatch({ type: "planned", version, result });
        });
      },
      planning.lastEdit === "balance" ? 350 : 0,
    );
    return () => window.clearTimeout(timer);
    // The plan is asked for once for each version of the entry. Other changes to the check, such as a message, must not ask again.
  }, [planning?.session, planning?.version, planning?.plannedVersion, importer]);

  const add = async (): Promise<void> => {
    if (stage.kind !== "checking" || !canAdd(stage.check)) return;
    const { session } = stage.check;
    const entry = entryOf(stage.check).entry;
    dispatch({ type: "adding" });
    const result = await importer.commit(session, entry);
    if (alive.current) dispatch({ type: "committed", result });
  };

  const refused = stage.kind === "refused" && facts !== null && view !== null
    ? refusedView(stage.refused, {
        importedOn: (batchId) => {
          const batch = facts.importBatches.get(batchId);
          return batch === undefined ? null : whenWords(batch.importedAt, view.today).on;
        },
      })
    : null;
  const result = useMemo(
    () =>
      stage.kind === "added" && facts !== null && view !== null
        ? resultView({
            preview: stage.check.preview,
            accountName: (id) => facts.accounts.get(id)?.name ?? "",
            statuses: figures?.importStatus ?? null,
            today: view.today,
            planStart: householdOf(facts).planStart,
          })
        : null,
    [stage, facts, view, figures],
  );

  const stageKey = stage.kind === "adding" ? "checking" : stage.kind;
  const undone = stage.kind === "added" ? stage.undone : null;
  useEffect(() => {
    if (stageKey !== "waiting") heading.current?.focus();
  }, [stageKey, undone]);
  const problem = check?.message?.tone === "problem" ? check.message : null;
  useEffect(() => {
    if (problem !== null) trouble.current?.focus();
  }, [problem]);

  const title: ReactNode = (() => {
    switch (stage.kind) {
      case "waiting":
      case "closed":
        return intl.formatMessage({ id: "import.dialog.waitingTitle" });
      case "refused":
        return refused === null ? null : say(intl, currency, refused.title);
      case "checking":
      case "adding":
        return intl.formatMessage({ id: "import.dialog.checkTitle" });
      case "added":
        return result === null ? null : say(intl, currency, result.title);
      case "behind":
        return intl.formatMessage({ id: "import.behind.title" });
    }
  })();

  const busy = stage.kind === "adding";
  const updating = check !== null && stage.kind === "checking" && check.version !== check.plannedVersion && !check.stale;
  const requestClose = () => {
    if (!busy) finish();
  };

  return (
    <ImportModal labelId={titleId} dialogRef={shell} onRequestClose={requestClose}>
      <div className={kit.head}>
        <div>
          <h2 id={titleId} ref={heading} tabIndex={-1} className={kit.title}>
            {title}
          </h2>
          {check !== null && (stage.kind === "checking" || stage.kind === "adding") && (
            <p className={kit.sub}>{intl.formatMessage({ id: "import.file" }, { fileName: check.fileName, readAs: say(intl, currency, readAsWords(check.preview.format)) })}</p>
          )}
        </div>
        {(stage.kind === "checking" || stage.kind === "adding") && (
          <button
            type="button"
            className={kit.secondary}
            disabled={busy}
            onClick={() => {
              dispatch({ type: "choose" });
              void choose();
            }}
          >
            {intl.formatMessage({ id: "import.chooseAnother" })}
          </button>
        )}
      </div>

      <div className={kit.body}>
        {(stage.kind === "waiting" || stage.kind === "closed") && <p>{intl.formatMessage({ id: "import.dialog.waiting" })}</p>}
        {refused !== null && <ImportRefused view={refused} currency={currency} />}
        {(stage.kind === "checking" || stage.kind === "adding") && facts !== null && <ImportCheck check={stage.check} facts={facts} busy={busy} dispatch={dispatch} />}
        {stage.kind === "added" && result !== null && <ImportResult view={result} currency={currency} undone={stage.undone} />}
        {stage.kind === "behind" && <p>{intl.formatMessage({ id: "import.trouble.outOfSync" })}</p>}
      </div>

      <div className={kit.foot}>
        {problem !== null && (
          <div className={`${kit.notice} ${kit.noticeProblem} ${kit.fullRow}`}>
            <p ref={trouble} tabIndex={-1} className={kit.noticeBody}>
              {say(intl, currency, problem.words)}
            </p>
            {problem.retry && (
              <button type="button" className={kit.secondary} onClick={() => dispatch({ type: "retry" })}>
                {intl.formatMessage({ id: "import.trouble.retry" })}
              </button>
            )}
          </div>
        )}
        {check?.message?.tone === "note" && (
          <div className={`${kit.notice} ${kit.noticeNote} ${kit.fullRow}`}>
            <p className={kit.noticeBody}>{say(intl, currency, check.message.words)}</p>
          </div>
        )}

        {(stage.kind === "checking" || stage.kind === "adding") && (
          <>
            <button type="button" className={kit.primary} aria-disabled={busy || !canAdd(stage.check)} onClick={() => void add()}>
              {say(intl, currency, busy ? { id: "import.adding", values: { count: stage.check.preview.counts.created } } : addWords(stage.check.preview))}
            </button>
            <button type="button" className={kit.secondary} disabled={busy} onClick={finish}>
              {intl.formatMessage({ id: "import.cancel" })}
            </button>
            <span className={kit.footNote}>{intl.formatMessage({ id: updating ? "import.updating" : "import.undoLater" })}</span>
          </>
        )}
        {(stage.kind === "waiting" || stage.kind === "closed") && (
          <button type="button" className={kit.secondary} onClick={finish}>
            {intl.formatMessage({ id: "import.cancel" })}
          </button>
        )}
        {stage.kind === "refused" && (
          <>
            <button
              type="button"
              className={kit.primary}
              onClick={() => {
                dispatch({ type: "choose" });
                void choose();
              }}
            >
              {intl.formatMessage({ id: "import.chooseAnother" })}
            </button>
            <button type="button" className={kit.secondary} onClick={finish}>
              {intl.formatMessage({ id: "import.close" })}
            </button>
          </>
        )}
        {stage.kind === "added" && (
          <>
            <button type="button" className={kit.primary} onClick={finish}>
              {intl.formatMessage({ id: "import.result.done" })}
            </button>
            {stage.undone === null && stage.batchId !== null && (
              <button type="button" className={kit.secondary} onClick={() => setUndoing(true)}>
                {intl.formatMessage({ id: "import.result.undo" })}
              </button>
            )}
            {stage.undone === null && result !== null && result.needsYou > 0 && onShowNeedsYou !== undefined && (
              <button
                type="button"
                className={kit.secondary}
                onClick={() => {
                  finish();
                  onShowNeedsYou();
                }}
              >
                {intl.formatMessage({ id: "import.result.showNeedsYou" })}
              </button>
            )}
          </>
        )}
        {stage.kind === "behind" && (
          <>
            <button
              type="button"
              className={kit.primary}
              onClick={() =>
                void reload().then((failure) => {
                  if (failure === null && alive.current) finish();
                })
              }
            >
              {intl.formatMessage({ id: "import.trouble.refresh" })}
            </button>
            <button type="button" className={kit.secondary} onClick={finish}>
              {intl.formatMessage({ id: "import.close" })}
            </button>
          </>
        )}
      </div>

      <div role="status" aria-live="polite" className={kit.srOnly}>
        {flow.announcement === null ? null : say(intl, currency, flow.announcement)}
      </div>

      {undoing && stage.kind === "added" && stage.batchId !== null && (
        <ImportUndoDialog
          batchId={stage.batchId}
          onClose={() => setUndoing(false)}
          onUndone={(removed) => {
            setUndoing(false);
            dispatch({ type: "undone", removed });
          }}
        />
      )}
    </ImportModal>
  );
}
