import { type ChannelName, channelMethods, channelNames } from "./channel-names.ts";
import type { Args, IpcResult, Result } from "./channels.ts";

/**
 * Every call resolves to a result the page branches on. Plain data crosses the context bridge intact,
 * but an Error's name and custom fields do not, so a refusal is data, not a rejection.
 */
export type HoltBridge = {
  [C in ChannelName as (typeof channelMethods)[C]]: (...args: Args<C>) => Promise<IpcResult<Result<C>>>;
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** The preload's whole surface: one method per registered channel, nothing else. */
export function createBridge(invoke: Invoke): HoltBridge {
  const entries = channelNames.map((channel) => [
    channelMethods[channel],
    (...args: unknown[]) => invoke(channel, ...args) as Promise<IpcResult<unknown>>,
  ]);
  return Object.fromEntries(entries) as HoltBridge;
}
