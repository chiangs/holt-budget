import { parse } from "@babel/parser";

export function parseSource(source, file) {
  return parse(source, {
    sourceType: "module",
    sourceFilename: file,
    errorRecovery: true,
    plugins: ["typescript", ...(file.endsWith("x") ? ["jsx"] : [])],
  });
}

export function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end" || key.endsWith("Comments")) continue;
    walk(value, visit);
  }
}
