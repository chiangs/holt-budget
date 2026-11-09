import { describe, expect, it } from "vitest";
import { isRequestAllowed } from "./request-policy.ts";

const production = { devServerUrl: undefined };
const development = { devServerUrl: "http://localhost:5173/" };

describe("N3 renderer request filter", () => {
  it.each(["file:///opt/holt/renderer/index.html", "devtools://devtools/bundled/inspector.html", "data:image/svg+xml;base64,AAAA", "blob:null/1234"])(
    "allows the app's own %s",
    (url) => {
      expect(isRequestAllowed(url, production)).toBe(true);
      expect(isRequestAllowed(url, development)).toBe(true);
    },
  );

  it.each([
    "http://127.0.0.1:8080/v1/models",
    "http://[::1]:11434/",
    "ws://127.0.0.1:8080/",
    "wss://127.0.0.1/",
    "http://localhost:8080/",
    "http://example.com/",
    "https://example.com/",
    "ws://example.com/",
    "wss://example.com/",
    "ftp://example.com/",
    "not a url",
  ])("cancels %s in production and development", (url) => {
    expect(isRequestAllowed(url, production)).toBe(false);
    expect(isRequestAllowed(url, development)).toBe(false);
  });

  it("allows the dev server, and its hot reload socket, only while developing", () => {
    expect(isRequestAllowed("http://localhost:5173/src/main.tsx", development)).toBe(true);
    expect(isRequestAllowed("ws://localhost:5173/", development)).toBe(true);
    expect(isRequestAllowed("http://localhost:5173/src/main.tsx", production)).toBe(false);
    expect(isRequestAllowed("ws://localhost:5173/", production)).toBe(false);
  });

  it("allows nothing near the dev server except its exact host and port", () => {
    expect(isRequestAllowed("http://localhost:5174/", development)).toBe(false);
    expect(isRequestAllowed("http://localhost.evil.com:5173/", development)).toBe(false);
    expect(isRequestAllowed("https://localhost:5173/", development)).toBe(false);
    expect(isRequestAllowed("http://localhost:5173@evil.com/", development)).toBe(false);
  });
});
