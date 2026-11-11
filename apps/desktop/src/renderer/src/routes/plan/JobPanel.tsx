import type { JobId } from "@holt/core";

export interface JobPanelProps {
  readonly jobId: JobId;
  readonly onClose: () => void;
}

/** A job's history, its 12-month estimate and how the app worked it out, and for a variable cost the choice to follow the bills or even it out. Owned by the job panel work (not built yet). */
export function JobPanel(_props: JobPanelProps): null {
  return null;
}
