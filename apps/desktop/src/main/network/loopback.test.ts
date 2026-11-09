import { describe, expect, it } from "vitest";
import { isLoopbackUrl } from "./loopback.ts";

describe("N1 loopback rule", () => {
  it.each(["http://127.0.0.1:8080/v1/models", "http://127.0.0.1/", "http://[::1]:11434/api", "https://127.0.0.1:8443", "HTTP://127.0.0.1:1"])(
    "accepts %s",
    (url) => expect(isLoopbackUrl(url)).toBe(true),
  );

  it.each([
    "http://localhost:8080/",
    "http://127.0.0.2/",
    "http://127.1/",
    "http://0x7f.0.0.1/",
    "http://2130706433/",
    "http://127.0.0.1.evil.com/",
    "http://127.evil.com/",
    "http://127.0.0.1@evil.com/",
    "http://user:pw@127.0.0.1/",
    "http://127.0.0.1\\@evil.com/",
    "http://evil.com#@127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.10/",
    "http://169.254.169.254/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::2]/",
    "http://0.0.0.0/",
    "http://example.com/",
    "ws://127.0.0.1/",
    "file:///etc/passwd",
    "127.0.0.1",
    "",
  ])("refuses %s", (url) => expect(isLoopbackUrl(url)).toBe(false));
});
