import { isLoopbackUrl } from "./loopback.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type LoopbackFetch = (url: string, init?: Omit<RequestInit, "redirect">) => Promise<Response>;

export class LoopbackError extends Error {
  override readonly name = "LoopbackError";
}

// The only HTTP client in the main process. The check runs before `netFetch`
// is called, so a refused URL never reaches a socket. Redirects are never
// followed: a loopback server has no reason to send one, and following would
// let it choose the next host.
export function createLoopbackFetch(netFetch: FetchLike): LoopbackFetch {
  return async (url, init) => {
    if (!isLoopbackUrl(url)) throw new LoopbackError("Holt only talks to 127.0.0.1 or ::1");
    const response = await netFetch(url, { ...init, redirect: "manual" });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new LoopbackError("The loopback server sent a redirect, which Holt does not follow");
    }
    return response;
  };
}

export const loopbackFetch: LoopbackFetch = createLoopbackFetch(async (url, init) => {
  const { net } = await import("electron");
  return net.fetch(url, init);
});
