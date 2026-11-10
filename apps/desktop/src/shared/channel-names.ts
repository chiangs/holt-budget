/**
 * Every IPC channel and the bridge method that calls it. This file holds no
 * schemas so the sandboxed preload can import it without bundling Zod.
 * `channels.ts` must give each name here a schema, and the compiler checks it.
 */
export const channelMethods = {
  "holt:app-info": "appInfo",
  "holt:database-state": "databaseState",
  "holt:facts-snapshot": "factsSnapshot",
  "holt:run": "run",
  "holt:history-step": "historyStep",
  "holt:import-open": "importOpen",
  "holt:import-plan": "importPlan",
  "holt:import-commit": "importCommit",
} as const;

export type ChannelName = keyof typeof channelMethods;
export type MethodName = (typeof channelMethods)[ChannelName];

export const channelNames = Object.keys(channelMethods) as ChannelName[];
