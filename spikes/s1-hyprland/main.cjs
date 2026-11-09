// Spike S1: Electron on Hyprland. Run through run.sh, which drives this window and reads its log.
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

const mode = process.env.S1_MODE === "transparent" ? "transparent" : "opaque";
const log = (event, data = {}) => process.stdout.write(`S1 ${JSON.stringify({ t: Date.now(), event, ...data })}\n`);

app.whenReady().then(async () => {
  log("platform", {
    mode,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    ozonePlatform: app.commandLine.getSwitchValue("ozone-platform") || null,
    ozoneHint: app.commandLine.getSwitchValue("ozone-platform-hint") || null,
    session: process.env.XDG_SESSION_TYPE,
  });
  log("displays", { displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })) });
  screen.on("display-metrics-changed", (_e, d, changed) => log("display-metrics-changed", { scaleFactor: d.scaleFactor, changed }));

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    ...(process.env.S1_MIN ? { minWidth: 1024, minHeight: 700 } : {}),
    frame: false,
    transparent: mode === "transparent",
    title: `Holt S1 ${mode}`,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  for (const ev of ["show", "resize", "focus", "blur", "maximize", "unmaximize", "minimize", "restore"]) {
    win.on(ev, () => log(`window-${ev}`, { bounds: win.getBounds() }));
  }
  win.webContents.on("console-message", (e) => log("page", JSON.parse(e.message)));

  ipcMain.on("s1:control", (_e, action) => {
    if (action === "minimize") win.minimize();
    if (action === "maximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
    if (action === "close") win.close();
  });

  await win.loadFile(path.join(__dirname, "page.html"), { query: { mode } });
  const gpu = await app.getGPUInfo("basic");
  log("gpu", { devices: gpu.gpuDevice.map((d) => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: d.active })), features: app.getGPUFeatureStatus() });
  setTimeout(async () => {
    const complete = await app.getGPUInfo("complete");
    log("gpu-settled", { features: app.getGPUFeatureStatus(), glRenderer: complete.auxAttributes?.glRenderer, glImplementation: complete.auxAttributes?.glImplementationParts, switches: app.commandLine.getSwitchValue("use-angle") || null });
  }, 4000);
  app.on("child-process-gone", (_e, d) => log("child-process-gone", d));

  // SIGUSR2 presses the page's next window button, the way a click would: Maximise, Maximise again, then Minimise.
  const buttons = ["max", "max", "min"];
  let press = 0;
  process.on("SIGUSR2", async () => {
    const id = buttons[press++ % buttons.length];
    await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
    setTimeout(() => log("button", { id, maximized: win.isMaximized(), minimized: win.isMinimized(), visible: win.isVisible(), bounds: win.getBounds() }), 500);
  });

  // SIGUSR1 saves Electron's own render of the page, which works even while the session is locked.
  let shot = 0;
  process.on("SIGUSR1", async () => {
    const image = await win.webContents.capturePage();
    const file = path.join(process.env.S1_SHOTS ?? "/tmp", `${mode}-${++shot}.png`);
    require("node:fs").writeFileSync(file, image.toPNG());
    log("capture", { file, size: image.getSize(), dpr: await win.webContents.executeJavaScript("devicePixelRatio"), bounds: win.getBounds() });
  });
});

app.on("window-all-closed", () => app.quit());
