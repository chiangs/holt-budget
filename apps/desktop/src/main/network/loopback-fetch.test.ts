import { describe, expect, it, vi } from "vitest";
import { createLoopbackFetch, LoopbackError } from "./loopback-fetch.ts";

function setup(respond: () => Response = () => new Response("ok")) {
  const netFetch = vi.fn(async () => respond());
  return { netFetch, loopbackFetch: createLoopbackFetch(netFetch) };
}

describe("N2 loopback fetch", () => {
  it("passes a loopback request to the network layer", async () => {
    const { netFetch, loopbackFetch } = setup();
    const response = await loopbackFetch("http://127.0.0.1:8080/v1/models");
    expect(await response.text()).toBe("ok");
    expect(netFetch).toHaveBeenCalledOnce();
  });

  it.each(["https://example.com/", "http://localhost:8080/", "http://127.0.0.1@evil.com/", "http://127.evil.com/", "http://10.0.0.5/", "http://[::2]/"])(
    "refuses %s before any socket opens",
    async (url) => {
      const { netFetch, loopbackFetch } = setup();
      await expect(loopbackFetch(url)).rejects.toBeInstanceOf(LoopbackError);
      expect(netFetch).not.toHaveBeenCalled();
    },
  );

  it("asks the network layer not to follow redirects", async () => {
    const { netFetch, loopbackFetch } = setup();
    await loopbackFetch("http://127.0.0.1:1/", { redirect: "follow" } as RequestInit);
    expect(netFetch).toHaveBeenCalledWith("http://127.0.0.1:1/", expect.objectContaining({ redirect: "manual" }));
  });

  it.each([301, 302, 307, 308])("refuses a %i redirect to another host", async (status) => {
    const { loopbackFetch } = setup(() => new Response(null, { status, headers: { location: "http://evil.com/" } }));
    await expect(loopbackFetch("http://127.0.0.1:1/")).rejects.toBeInstanceOf(LoopbackError);
  });

  it("refuses an opaque redirect", async () => {
    const opaque = Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" });
    const { loopbackFetch } = setup(() => opaque);
    await expect(loopbackFetch("http://127.0.0.1:1/")).rejects.toBeInstanceOf(LoopbackError);
  });
});
