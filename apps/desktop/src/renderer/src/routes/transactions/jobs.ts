import type { Facts, Group, JobId } from "@holt/core";

/** A job as a picker lists it: its name, and the group it sits in. Owned by the Needs you work. */
export interface PickableJob {
  readonly id: JobId;
  readonly name: string;
  readonly groupName: string;
}

export interface JobGroup {
  readonly name: string;
  readonly jobs: readonly PickableJob[];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

const inGroupOrder = (a: Group | undefined, b: Group | undefined): number =>
  (a?.order ?? Number.MAX_SAFE_INTEGER) - (b?.order ?? Number.MAX_SAFE_INTEGER) || collator.compare(a?.name ?? "", b?.name ?? "") || (a?.id ?? "").localeCompare(b?.id ?? "");

/**
 * The jobs a transaction can go to: the active ones, in group order and then by name. A paused, finished or
 * archived job takes no new transactions. The buffer is an active job like any other.
 */
export function pickableJobs(facts: Facts): PickableJob[] {
  return [...facts.jobs.values()]
    .filter((job) => job.status === "active")
    .map((job) => ({ job, group: facts.groups.get(job.groupId) }))
    .sort((a, b) => inGroupOrder(a.group, b.group) || collator.compare(a.job.name, b.job.name) || a.job.id.localeCompare(b.job.id))
    .map(({ job, group }) => ({ id: job.id, name: job.name, groupName: group?.name ?? "" }));
}

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Jobs whose name or group name holds every word typed, in the order given. An empty search keeps them all. */
export function searchJobs(jobs: readonly PickableJob[], query: string): PickableJob[] {
  const words = plain(query).split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [...jobs];
  return jobs.filter((job) => {
    const text = `${plain(job.name)} ${plain(job.groupName)}`;
    return words.every((word) => text.includes(word));
  });
}

/** Neighbouring jobs from the same group, which `pickableJobs` already keeps together. */
export function groupedJobs(jobs: readonly PickableJob[]): JobGroup[] {
  const groups: { name: string; jobs: PickableJob[] }[] = [];
  for (const job of jobs) {
    const last = groups.at(-1);
    if (last !== undefined && last.name === job.groupName) last.jobs.push(job);
    else groups.push({ name: job.groupName, jobs: [job] });
  }
  return groups;
}

/** The job at `index` in the order the picker shows them (group by group), or null when the index is out of range. */
export function jobAt(groups: readonly JobGroup[], index: number): PickableJob | null {
  return groups.flatMap((group) => group.jobs)[index] ?? null;
}

/** Moves the highlighted option by `step`, stopping at the first and last rather than wrapping. */
export function moveActive(index: number, step: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, index + step));
}
