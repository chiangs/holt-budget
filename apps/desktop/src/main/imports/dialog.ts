import { BrowserWindow, app, dialog } from "electron";

/** The native file dialog over the focused window. Null means the family cancelled. */
export async function chooseStatementFile(): Promise<string | null> {
  // Only the e2e build reads this variable. Playwright can't drive a native dialog, so it names the file instead.
  const fixed = __HOLT_E2E__ ? process.env["HOLT_E2E_PICK_FILE"] : undefined;
  if (fixed !== undefined && fixed !== "") return fixed;

  const options = {
    defaultPath: app.getPath("downloads"),
    properties: ["openFile" as const],
    filters: [{ name: "CSV and OFX", extensions: ["csv", "ofx", "qfx"] }],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return canceled ? null : (filePaths[0] ?? null);
}
