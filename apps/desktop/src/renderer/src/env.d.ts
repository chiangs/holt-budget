import type { HoltBridge } from "../../preload/index.ts";

declare global {
  interface Window {
    holt: HoltBridge;
  }
}

export {};
