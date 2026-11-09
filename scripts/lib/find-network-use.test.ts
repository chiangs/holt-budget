import { describe, expect, it } from "vitest";
import { findNetworkUse } from "./find-network-use.mjs";

const flagged = (source: string) => findNetworkUse(source, "x.ts").map((p) => p.message);

describe("network lint (N4)", () => {
  it.each([
    'import http from "node:http";',
    'import { request } from "https";',
    'import net from "node:net";',
    'import dgram from "node:dgram";',
    'import tls from "node:tls";',
    'import { fetch } from "undici";',
    'import axios from "axios";',
    'import nodeFetch from "node-fetch";',
    'import WebSocket from "ws";',
    'const http = require("node:http");',
    'const m = await import("node:https");',
    'export * from "node:net";',
    'import http from "node:http/promises";',
  ])("flags %s", (source) => {
    expect(flagged(source)).toHaveLength(1);
  });

  it.each([
    'await fetch("https://example.com");',
    'globalThis.fetch("http://127.0.0.1");',
    'const ws = new WebSocket("ws://127.0.0.1");',
    'const x = new XMLHttpRequest();',
  ])("flags the global in %s", (source) => {
    expect(flagged(source)).toHaveLength(1);
  });

  it("reports the line of each problem", () => {
    const source = 'import path from "node:path";\n\nimport http from "node:http";\n';
    expect(findNetworkUse(source, "x.ts")).toEqual([{ line: 3, message: 'imports "node:http"' }]);
  });

  it.each([
    'import { net } from "electron"; net.fetch(url);',
    'import path from "node:path"; import fs from "node:fs";',
    'import Database from "better-sqlite3-multiple-ciphers";',
    'const url = "see node:http and fetch(...) in prose";',
    '// import http from "node:http";',
    'import type { Server } from "node:fs";',
    'import { httpLike } from "./http-like.ts";',
  ])("lets %s pass", (source) => {
    expect(flagged(source)).toEqual([]);
  });
});
