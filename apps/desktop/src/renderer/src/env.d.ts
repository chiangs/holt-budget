import type { HoltBridge } from "../../shared/bridge.ts";

declare global {
  interface Window {
    holt: HoltBridge;
  }
}

export {};
