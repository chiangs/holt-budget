import type { JobId, NewTransactionLine, Transaction, TransactionId, Treatment, Why } from "@holt/core";
import type { Words } from "./ImportSay.ts";

/** What the words about a new row need to know about everything else. */
export interface WhyContext {
  jobName(id: JobId): string;
  /** A transaction the household already has. */
  transaction(id: TransactionId): Transaction | undefined;
}

type WhyOf<K extends Why["kind"]> = Extract<Why, { readonly kind: K }>;
type WhyWords = { readonly [K in Why["kind"]]: (why: WhyOf<K>, line: NewTransactionLine, context: WhyContext) => Words };

/** One entry for every kind of reason core gives, so a new kind does not compile until it has words. */
const whyTable: WhyWords = {
  chosen: () => ({ id: "import.why.chosen" }),
  rule: () => ({ id: "import.why.rule" }),
  sameAsLast: (why) => ({ id: "import.why.sameAsLast", values: { times: why.times } }),
  priceChange: (why, line) => ({
    id: Math.abs(line.amount) > Math.abs(why.from) ? "import.why.priceUp" : "import.why.priceDown",
    values: { from: { money: Math.abs(why.from) } },
  }),
  transferMatch: (_why, line) => ({ id: line.amount > 0 ? "import.why.transferOutgoing" : "import.why.transferIncoming" }),
  nearMatch: (why, _line, context) => {
    const other = context.transaction(why.of);
    return other === undefined ? { id: "import.why.nearMatch" } : { id: "import.why.nearMatchOn", values: { day: { day: other.bookingDate } } };
  },
  ambiguous: (why, _line, context) => ({
    id: "import.why.ambiguous",
    values: { jobs: { list: why.jobs.map((id) => context.jobName(id)), type: "disjunction" } },
  }),
  firstPayment: () => ({ id: "import.why.firstPayment" }),
  history: () => ({ id: "import.why.history" }),
  none: () => ({ id: "import.why.none" }),
};

export function whyWords(line: NewTransactionLine, context: WhyContext): Words {
  const { why } = line;
  return (whyTable[why.kind] as (why: Why, line: NewTransactionLine, context: WhyContext) => Words)(why, line, context);
}

/** What the Job column shows: the job's own name, words for the rest, or the prompt to choose one. */
export type JobCell = { readonly kind: "choose" } | { readonly kind: "job"; readonly name: string } | { readonly kind: "words"; readonly words: Words };

type TreatmentOf<K extends Treatment["kind"]> = Extract<Treatment, { readonly kind: K }>;
type JobCells = { readonly [K in Treatment["kind"]]: (treatment: TreatmentOf<K>, context: WhyContext) => JobCell };

const jobCells: JobCells = {
  needsYou: () => ({ kind: "choose" }),
  income: () => ({ kind: "words", words: { id: "import.job.income" } }),
  transfer: () => ({ kind: "words", words: { id: "import.job.transfer" } }),
  split: (treatment, context) => {
    const [only, ...more] = treatment.allocations;
    return more.length === 0 ? { kind: "job", name: context.jobName(only.jobId) } : { kind: "words", words: { id: "import.job.split", values: { count: treatment.allocations.length } } };
  },
  history: (treatment, context) => (treatment.jobId === null ? { kind: "words", words: { id: "import.job.history" } } : { kind: "job", name: context.jobName(treatment.jobId) }),
};

export function jobCell(treatment: Treatment, context: WhyContext): JobCell {
  return (jobCells[treatment.kind] as (treatment: Treatment, context: WhyContext) => JobCell)(treatment, context);
}

/** An amount as the mockup shows it: a real minus sign, and a plus for money in. The page formats the figure. */
export function signedAmount(minor: number): { readonly sign: "−" | "+"; readonly figure: number } {
  return { sign: minor < 0 ? "−" : "+", figure: Math.abs(minor) };
}
