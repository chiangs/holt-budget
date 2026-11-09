import { session } from "electron";
import { isRequestAllowed } from "./network/request-policy.ts";

// ── 2. Network lock-down: nothing leaves the machine (§3) ───────────────────
// The renderer may load the app's own files and, while developing, the dev
// server. Everything else is cancelled, loopback included.
export const devServerUrl = process.env["ELECTRON_RENDERER_URL"];

export function allowed(url: string): boolean {
  return isRequestAllowed(url, { devServerUrl });
}

export function lockDownNetwork(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const ok = allowed(details.url);
    if (!ok) console.warn(`[holt] blocked request: ${details.url}`);
    callback({ cancel: !ok });
  });
  // Chromium downloads spellcheck dictionaries from a Google host on first use.
  // Both calls are needed: disabling alone still fetches the default language.
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setSpellCheckerLanguages([]);
  // No permission prompts (camera, notifications from web content, etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}
