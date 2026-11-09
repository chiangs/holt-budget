import { type ChannelName, channelNames } from "../shared/channel-names.ts";
import { type Args, type IpcResult, type Result, channels } from "../shared/channels.ts";

export type Handlers = {
  [C in ChannelName]: (...args: Args<C>) => Result<C> | Promise<Result<C>>;
};

const known = new Set<string>(channelNames);

function isChannel(name: string): name is ChannelName {
  return known.has(name);
}

/** Checks the channel and its arguments, then runs the handler. The handler body never sees unchecked input. */
export function createDispatcher(handlers: Handlers): (channel: string, args: unknown[]) => Promise<IpcResult<unknown>> {
  return async (channel, args) => {
    if (!isChannel(channel)) return { ok: false, error: { code: "unknown-channel", message: `No channel named ${channel}.` } };
    const parsed = channels[channel].args.safeParse(args);
    if (!parsed.success) return { ok: false, error: { code: "invalid-arguments", message: parsed.error.message } };
    try {
      const handler = handlers[channel] as (...a: unknown[]) => unknown;
      return { ok: true, value: await handler(...(parsed.data as unknown[])) };
    } catch (error) {
      console.error(`[holt] ${channel} failed`, error);
      return { ok: false, error: { code: "handler-failed", message: "The app couldn't complete that." } };
    }
  };
}

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
};

/** Registers exactly the channels in the shared table. */
export function registerHandlers(ipcMain: IpcMainLike, handlers: Handlers): void {
  const dispatch = createDispatcher(handlers);
  for (const channel of channelNames) {
    ipcMain.handle(channel, (_event, ...args) => dispatch(channel, args));
  }
}
