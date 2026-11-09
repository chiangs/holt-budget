// Where the renderer's Chromium traffic may go. The renderer needs no network
// at all, so loopback is not on the list: the model endpoint is reached from
// the main process through loopback-fetch.ts.
export interface RequestPolicy {
  /** Origin of the Vite dev server while developing, otherwise undefined. */
  readonly devServerUrl: string | undefined;
}

const LOCAL_SCHEMES: ReadonlySet<string> = new Set(["file:", "devtools:", "data:", "blob:"]);
const DEV_SCHEMES: ReadonlySet<string> = new Set(["http:", "ws:"]);

export function isRequestAllowed(rawUrl: string, policy: RequestPolicy): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.has(url.protocol)) return true;
  if (policy.devServerUrl === undefined || !DEV_SCHEMES.has(url.protocol)) return false;
  let dev: URL;
  try {
    dev = new URL(policy.devServerUrl);
  } catch {
    return false;
  }
  return dev.protocol === "http:" && url.host === dev.host;
}
