import { parseSource, walk } from "./walk.mjs";

const textAttributes = new Set([
  "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext",
  "title", "placeholder", "alt", "label",
]);
const hasLetters = (text) => /\p{L}/u.test(text);

function literalText(node) {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? "").join("");
  return null;
}

/** Finds visible text written directly in JSX. Returns [{ line, text }]. */
export function findHardcodedStrings(source, file) {
  const problems = [];
  const report = (node, text) => problems.push({ line: node.loc.start.line, text: text.trim().replace(/\s+/g, " ") });
  walk(parseSource(source, file).program, (node) => {
    if (node.type === "JSXText" && hasLetters(node.value)) report(node, node.value);
    else if (node.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && textAttributes.has(node.name.name)) {
      const value = node.value?.type === "JSXExpressionContainer" ? node.value.expression : node.value;
      const text = literalText(value);
      if (text !== null && hasLetters(text)) report(node, text);
    } else if (node.type === "JSXElement" || node.type === "JSXFragment") {
      for (const child of node.children) {
        const text = child.type === "JSXExpressionContainer" ? literalText(child.expression) : null;
        if (text !== null && hasLetters(text)) report(child, text);
      }
    }
  });
  return problems;
}
