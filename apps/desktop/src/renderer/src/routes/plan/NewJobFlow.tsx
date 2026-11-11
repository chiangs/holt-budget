import { type ChangeId, type GroupId, householdOf } from "@holt/core";
import { Check, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { mintId } from "../../../../shared/ids.ts";
import { useFactsView, useFigures, useLedger } from "../../data/ledger.tsx";
import controls from "../transactions/Controls.module.css";
import { pressOf } from "../transactions/keys.ts";
import { problemText as outcomeText, refusalText } from "../transactions/refusal.ts";
import styles from "./NewJob.module.css";
import { type NewJobIds, addedOf, planOf } from "./NewJobBatch.model.ts";
import { NewJobEffects } from "./NewJobEffects.tsx";
import { previewOf } from "./NewJobEffects.model.ts";
import { NewJobFields } from "./NewJobFields.tsx";
import { NewJobFunding } from "./NewJobFunding.tsx";
import { keepsToFlow, flowKey } from "./NewJobKeys.model.ts";
import { type Draft, type JobKind, type Start, changeKind, contextOf, firstMonthOf, jobKinds, startingDraft } from "./NewJob.model.ts";
import { addedText, problemText } from "./NewJob.text.ts";
import { planMonthOf } from "./PlanMonth.model.ts";
import { moneyText } from "./PlanStatus.ts";

export interface NewJobFlowProps {
  /** The group the job starts in, when the flow was opened from "+ Add a line to <group>". */
  readonly initialGroupId?: GroupId;
  /** The kind the flow starts on, when it was opened for an account or a bucket. */
  readonly initialKind?: JobKind;
  /** Start a pay-into job with "Add an account…" already chosen. */
  readonly startWithNewAccount?: boolean;
  readonly onClose: () => void;
}

type Phase =
  | { readonly kind: "form"; readonly notice: string | null }
  | { readonly kind: "added"; readonly text: string; readonly name: string; readonly change: ChangeId };

const kindWords = {
  spend: { name: "plan.new.kind.spend", hint: "plan.new.kind.spendHint" },
  saveUp: { name: "plan.new.kind.saveUp", hint: "plan.new.kind.saveUpHint" },
  payInto: { name: "plan.new.kind.payInto", hint: "plan.new.kind.payIntoHint" },
} as const satisfies Record<JobKind, { readonly name: string; readonly hint: string }>;

const newIds = (): NewJobIds => ({ job: mintId("job"), group: mintId("group"), account: mintId("account"), balance: mintId("enteredValue") });

/**
 * The New job flow, as the mockup's inline panel above the table (an inline panel, not a modal: the table stays
 * in view, so the family sees the new line arrive and the unassigned money it used). Pick the kind, name it, say
 * where its money sits, see where the money for it comes from and what the change would do, then Add job.
 * Nothing changes until Add job, which runs one batch, so one Undo takes all of it back.
 */
export function NewJobFlow(props: NewJobFlowProps) {
  const view = useFactsView();
  const figures = useFigures();
  const shown = useMemo(() => (view === null || figures === null ? null : planMonthOf(view.facts, figures)), [view, figures]);
  if (view === null || figures === null || shown === null) return null;
  return <Flow {...props} facts={view.facts} figures={figures} shown={shown} />;
}

function Flow({ initialGroupId, initialKind, startWithNewAccount, onClose, facts, figures, shown }: NewJobFlowProps & { readonly facts: NonNullable<ReturnType<typeof useFactsView>>["facts"]; readonly figures: NonNullable<ReturnType<typeof useFigures>>; readonly shown: NonNullable<ReturnType<typeof planMonthOf>> }) {
  const intl = useIntl();
  const { run, step, head } = useLedger();
  const { currency } = householdOf(facts);
  const titleId = useId();
  const kindName = useId();
  const reasonId = useId();
  const root = useRef<HTMLElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const working = useRef(false);

  const context = useMemo(() => contextOf(facts, figures, shown, currency), [facts, figures, shown, currency]);
  const [ids] = useState(newIds);
  const [draft, setDraft] = useState<Draft>(() => {
    const start: Start = { ...(initialKind === undefined ? {} : { kind: initialKind }), ...(initialGroupId === undefined ? {} : { groupId: initialGroupId }), ...(startWithNewAccount === true ? { newAccount: true } : {}) };
    return startingDraft(facts, figures, figures.asOf, start);
  });
  const [phase, setPhase] = useState<Phase>({ kind: "form", notice: null });
  const [attempted, setAttempted] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => planOf(draft, context, figures, ids), [draft, context, figures, ids]);
  const command = phase.kind === "form" && plan.kind === "ready" ? plan.command : null;
  const deferred = useDeferredValue(command);
  const previewed = useMemo(() => (deferred === null ? null : previewOf(facts, deferred, figures.asOf, ids.job)), [facts, deferred, figures.asOf, ids.job]);
  const previewRefusal = previewed !== null && !previewed.ok && deferred === command ? refusalText(intl, previewed.refusal) : null;

  const problems = attempted && plan.kind === "problems" ? plan.problems : [];
  const shortfall = plan.kind === "shortfall" ? plan.funding.options.shortfall : null;
  const reason =
    shortfall !== null
      ? intl.formatMessage({ id: "plan.new.from.reason" }, { short: moneyText(intl, shortfall, currency) })
      : previewRefusal === null
        ? null
        : intl.formatMessage({ id: "plan.new.effects.refused" }, { reason: previewRefusal });

  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (phase.kind === "added") done.current?.focus();
    else if (phase.notice !== null) notice.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (attempts > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working.current || phase.kind !== "form") return;
    setAttempted(true);
    setAttempts((count) => count + 1);
    if (plan.kind !== "ready" || previewRefusal !== null) return;
    working.current = true;
    setBusy(true);
    try {
      const outcome = await run(plan.command);
      if (outcome.status === "applied") {
        const added = addedOf(plan.job, context, plan.funding.kind === "options" ? plan.funding.chosen : null);
        setRefusal(null);
        setPhase({ kind: "added", change: outcome.change.id, name: plan.job.name, text: addedText(intl, added, currency) });
      } else setRefusal(outcomeText(intl, outcome));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const undo = async () => {
    if (working.current || phase.kind !== "added") return;
    working.current = true;
    setBusy(true);
    try {
      const outcome = await step("undo");
      if (outcome.status === "applied") {
        setRefusal(null);
        setPhase({ kind: "form", notice: intl.formatMessage({ id: "plan.new.undone" }, { name: phase.name }) });
      } else setRefusal(outcomeText(intl, outcome, "undo"));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const intent = flowKey(pressOf(event.nativeEvent), { added: phase.kind === "added", busy });
    if (intent !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (intent.kind === "close") onClose();
      else void undo();
      return;
    }
    if (keepsToFlow(event)) event.stopPropagation();
  };

  if (phase.kind === "added") {
    const canUndo = head?.undo?.id === phase.change;
    return (
      <div className={styles["flowDone"]} onKeyDown={onKeyDown}>
        <div ref={done} tabIndex={-1} role="status" className={styles["done"]}>
          <p className={styles["doneText"]}>{phase.text}</p>
          <div className={styles["actions"]}>
            {canUndo && (
              <button type="button" className={controls["button"]} aria-keyshortcuts="U" disabled={busy} onClick={() => void undo()}>
                {intl.formatMessage({ id: "plan.undo" })}
                <span className={controls["key"]} aria-hidden="true">
                  {intl.formatMessage({ id: "plan.key.u" })}
                </span>
              </button>
            )}
            <button type="button" className={controls["button"]} onClick={onClose}>
              {intl.formatMessage({ id: "plan.new.done.dismiss" })}
            </button>
          </div>
        </div>
        <div role="alert" className={styles["alert"]}>
          {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
        </div>
      </div>
    );
  }

  return (
    <section ref={root} aria-labelledby={titleId} className={styles["flow"]} onKeyDown={onKeyDown}>
      <div className={styles["head"]}>
        <div className={styles["titles"]}>
          <h2 id={titleId} className="type-title-section">
            {intl.formatMessage({ id: "plan.new.title" })}
          </h2>
          <p className={styles["lead"]}>{intl.formatMessage({ id: "plan.new.lead" })}</p>
        </div>
        <button type="button" className={`${controls["button"]} ${styles["close"]}`} aria-label={intl.formatMessage({ id: "plan.new.close" })} onClick={onClose}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {phase.notice !== null && (
        <p ref={notice} tabIndex={-1} role="status" className={styles["notice"]}>
          {phase.notice}
        </p>
      )}

      <form ref={form} className={styles["body"]} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className={styles["kinds"]}>
          <legend className={controls["visuallyHidden"]}>{intl.formatMessage({ id: "plan.new.kind.label" })}</legend>
          {jobKinds.map((kind) => (
            <label key={kind} className={styles["kind"]}>
              <input type="radio" name={kindName} value={kind} checked={draft.kind === kind} data-autofocus={draft.kind === kind ? "" : undefined} onChange={() => setDraft(changeKind(draft, kind, facts))} />
              <span className={styles["kindName"]}>
                <span>{intl.formatMessage({ id: kindWords[kind].name })}</span>
                <Check className={styles["tick"]} size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className={styles["kindHint"]}>{intl.formatMessage({ id: kindWords[kind].hint })}</span>
            </label>
          ))}
        </fieldset>

        <NewJobFields draft={draft} onChange={setDraft} facts={facts} figures={figures} context={context} problems={problems} />
        <NewJobFunding funding={plan.funding} facts={facts} currency={currency} month={context.month} onChoose={(key) => setDraft({ ...draft, funding: key })} />
        <NewJobEffects previewed={previewed} currency={currency} />

        {reason !== null && (
          <p id={reasonId} className={styles["problem"]}>
            {reason}
          </p>
        )}
        <div className={styles["actions"]}>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]} ${controls["large"]}`} disabled={busy || reason !== null} aria-describedby={reason === null ? undefined : reasonId}>
            {intl.formatMessage({ id: "plan.new.add" })}
          </button>
          <button type="button" className={`${controls["button"]} ${controls["large"]}`} onClick={onClose}>
            {intl.formatMessage({ id: "plan.new.cancel" })}
          </button>
        </div>
        <div role="alert" className={styles["alert"]}>
          {problems.length > 0 && <p className={styles["problem"]}>{intl.formatMessage({ id: "plan.new.summary" }, { count: problems.length })}</p>}
          {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
        </div>
      </form>
    </section>
  );
}
