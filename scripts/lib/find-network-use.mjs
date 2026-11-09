import { parseSource, walk } from "./walk.mjs";

const bannedModules = new Set([
  "http", "https", "http2", "net", "tls", "dgram", "dns", "undici", "axios", "node-fetch", "cross-fetch",
  "isomorphic-fetch", "got", "ky", "superagent", "request", "needle", "follow-redirects", "ws", "socket.io-client",
]);
const bannedGlobals = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
const globalObjects = new Set(["globalThis", "window", "self", "global"]);

function moduleName(specifier) {
  return specifier.replace(/^node:/, "").split("/")[0];
}

/** Finds imports of network modules and uses of network globals. Returns [{ line, message }]. */
export function findNetworkUse(source, file) {
  const problems = [];
  const report = (node, message) => problems.push({ line: node.loc.start.line, message });
  const checkModule = (node, specifier) => {
    if (typeof specifier === "string" && bannedModules.has(moduleName(specifier))) {
      report(node, `imports "${specifier}"`);
    }
  };
  walk(parseSource(source, file).program, (node) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source) {
      checkModule(node, node.source.value);
    } else if (node.type === "ImportExpression") {
      if (node.source.type === "StringLiteral") checkModule(node, node.source.value);
    } else if (node.type === "CallExpression") {
      const [first] = node.arguments;
      const isRequire = node.callee.type === "Identifier" && node.callee.name === "require";
      if ((isRequire || node.callee.type === "Import") && first?.type === "StringLiteral") checkModule(node, first.value);
      if (node.callee.type === "Identifier" && bannedGlobals.has(node.callee.name)) report(node, `calls global ${node.callee.name}()`);
    } else if (node.type === "NewExpression" && node.callee.type === "Identifier" && bannedGlobals.has(node.callee.name)) {
      report(node, `uses global ${node.callee.name}`);
    } else if (
      node.type === "MemberExpression" &&
      node.object.type === "Identifier" &&
      globalObjects.has(node.object.name) &&
      node.property.type === "Identifier" &&
      bannedGlobals.has(node.property.name)
    ) {
      report(node, `uses ${node.object.name}.${node.property.name}`);
    }
  });
  return problems;
}
