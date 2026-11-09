import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {} }));
vi.mock("./network.ts", () => ({ allowed: () => false, devServerUrl: undefined }));

const { windowOptions } = await import("./window.ts");

describe("windowOptions", () => {
  it("W5: sets no minimum size, so a tiling compositor can size it freely", () => {
    const options = windowOptions();
    expect(options).not.toHaveProperty("minWidth");
    expect(options).not.toHaveProperty("minHeight");
  });

  it("W5: is frameless", () => {
    expect(windowOptions().frame).toBe(false);
  });

  it("W5: keeps the renderer sandboxed", () => {
    expect(windowOptions().webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
  });
});
