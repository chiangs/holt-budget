import type { ChangeId, FamilyCommand } from "@holt/core";
import { useCallback, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { StepDirection } from "../../../../shared/ledger-types.ts";
import { useLedger } from "../../data/ledger.tsx";
import { type Message, canStep, report } from "./decisions.model.ts";

export interface Decisions {
  /** The latest thing to tell the family: what the last change did, or why it didn't happen. */
  readonly message: Message | null;
  /** A change is being saved. */
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Runs one command and says `done` once it is saved. Refuses to start while another change is saving. */
  decide(command: FamilyCommand, done: string): Promise<boolean>;
  stepBy(direction: StepDirection): Promise<void>;
  /** A word to the family that isn't about a change. */
  say(text: string): void;
}

/**
 * Every change the family makes on Transactions goes through here, so each one is announced, can be undone
 * and, when core refuses it or the call fails, says so. The ledger queues changes in order. This also holds
 * a second decision back while one is saving, so pressing Space twice can't accept one row twice.
 */
export function useDecisions(): Decisions {
  const intl = useIntl();
  const { run, step, head, reload } = useLedger();
  const [made, setMade] = useState<ReadonlySet<ChangeId>>(() => new Set());
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const guarded = useCallback(async (work: () => Promise<boolean>): Promise<boolean> => {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  const decide = useCallback(
    (command: FamilyCommand, done: string) =>
      guarded(async () => {
        const result = report(intl, await run(command), done);
        const { made } = result;
        if (made !== null) setMade((previous) => new Set(previous).add(made));
        if (result.refresh) void reload();
        setMessage(result.message);
        return made !== null;
      }),
    [guarded, run, reload, intl],
  );

  const stepBy = useCallback(
    async (direction: StepDirection) => {
      await guarded(async () => {
        const done = intl.formatMessage({ id: direction === "undo" ? "needsYou.done.undone" : "needsYou.done.redone" });
        const result = report(intl, await step(direction), done, direction);
        if (result.refresh) void reload();
        setMessage(result.message);
        return result.made !== null;
      });
    },
    [guarded, step, reload, intl],
  );

  return {
    message,
    busy,
    canUndo: canStep("undo", head, made),
    canRedo: canStep("redo", head, made),
    decide,
    stepBy,
    say: useCallback((text: string) => setMessage({ kind: "hint", text }), []),
  };
}
