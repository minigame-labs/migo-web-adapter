// Finding elements in the adapter's own tree: getElementsByTagName / ClassName, querySelector(All), matches, closest. Engines
// create elements and look them up again -- p5.js makes a <main>, appends it to <body> and asks for it back by tag name,
// and Babylon, Phaser and PlayCanvas look their canvas up by id or selector.
//
// The selector grammar is the part of CSS those lookups use: a comma list of complex selectors; each a chain of compound
// selectors joined by descendant (space) or child (`>`) combinators; each compound a type (or `*`), `#id`, `.class` and
// `[attr]`, `[attr=v]`, `[attr~=v]`, `[attr|=v]`, `[attr^=v]`, `[attr$=v]`, `[attr*=v]`. Anything else (pseudo-classes, `+`
// and `~`) is a SyntaxError that says so, not a silent miss.

const exception = (message, name) => new (globalThis.DOMException || Error)(message, name);
const unsupported = (what, selector) => exception(`'${selector}' is not a selector this adapter supports (${what}).`, "SyntaxError");

const IDENT = /^-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*/;

function parseCompound(text, selector) {
  const compound = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  if (text[0] === "*") i = 1;
  else {
    const m = IDENT.exec(text);
    if (m) { compound.tag = m[0].toLowerCase(); i = m[0].length; }
  }
  while (i < text.length) {
    const c = text[i];
    if (c === "#" || c === ".") {
      const m = IDENT.exec(text.slice(i + 1));
      if (!m) throw exception(`'${selector}' is not a valid selector.`, "SyntaxError");
      if (c === "#") compound.id = m[0]; else compound.classes.push(m[0]);
      i += 1 + m[0].length;
    } else if (c === "[") {
      const end = text.indexOf("]", i);
      if (end === -1) throw exception(`'${selector}' is not a valid selector.`, "SyntaxError");
      const body = text.slice(i + 1, end).trim();
      const m = /^([-_a-zA-Z0-9:]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?$/.exec(body);
      if (!m) throw exception(`'${selector}' is not a valid selector.`, "SyntaxError");
      compound.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] });
      i = end + 1;
    } else if (c === ":") {
      throw unsupported("pseudo-classes", selector);
    } else {
      throw exception(`'${selector}' is not a valid selector.`, "SyntaxError");
    }
  }
  return compound;
}

const cache = new Map();

/// A selector parsed to a list of chains; each chain is [{ compound, combinator }] left to right, `combinator` being how that
/// compound relates to the one before it (" " or ">"; null for the first).
export function parse(selector) {
  const source = String(selector);
  let parsed = cache.get(source);
  if (parsed) return parsed;
  if (/[+~](?![=])/.test(source.replace(/\[[^\]]*\]/g, ""))) throw unsupported("sibling combinators", source);
  parsed = source.split(",").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) throw exception(`'${source}' is not a valid selector.`, "SyntaxError");
    const chain = [];
    // Split on whitespace and `>` outside brackets and quotes.
    const tokens = [];
    let depth = 0, quote = null, current = "";
    for (const ch of trimmed) {
      if (quote) { current += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (depth === 0 && (ch === " " || ch === "\t" || ch === "\n" || ch === ">")) {
        if (current) { tokens.push(current); current = ""; }
        if (ch === ">") tokens.push(">");
        continue;
      }
      current += ch;
    }
    if (current) tokens.push(current);
    let combinator = null;
    for (const token of tokens) {
      if (token === ">") { combinator = ">"; continue; }
      chain.push({ compound: parseCompound(token, source), combinator: chain.length === 0 ? null : (combinator || " ") });
      combinator = null;
    }
    if (chain.length === 0 || combinator === ">") throw exception(`'${source}' is not a valid selector.`, "SyntaxError");
    return chain;
  });
  if (cache.size > 200) cache.clear();
  cache.set(source, parsed);
  return parsed;
}

const attr = (el, name) => {
  if (typeof el.getAttribute === "function") {
    const value = el.getAttribute(name);
    if (value !== null && value !== undefined) return String(value);
  }
  if (name === "id") return el.id ? String(el.id) : null;
  if (name === "class") return el.className ? String(el.className) : null;
  return null;
};

function matchesCompound(el, c) {
  if (!el || el.nodeType === 3) return false;
  if (c.tag !== null && String(el.tagName || el.nodeName || "").toLowerCase() !== c.tag) return false;
  if (c.id !== null && String(el.id || "") !== c.id) return false;
  if (c.classes.length) {
    const have = String(el.className || "").split(/\s+/);
    for (const cls of c.classes) if (!have.includes(cls)) return false;
  }
  for (const { name, op, value } of c.attrs) {
    const actual = attr(el, name);
    if (actual === null) return false;
    if (op === null) continue;
    if (op === "=" && actual !== value) return false;
    if (op === "~=" && !actual.split(/\s+/).includes(value)) return false;
    if (op === "|=" && actual !== value && !actual.startsWith(value + "-")) return false;
    if (op === "^=" && !(value !== "" && actual.startsWith(value))) return false;
    if (op === "$=" && !(value !== "" && actual.endsWith(value))) return false;
    if (op === "*=" && !(value !== "" && actual.includes(value))) return false;
  }
  return true;
}

function matchesChain(el, chain, index) {
  const { compound, combinator } = chain[index];
  if (!matchesCompound(el, compound)) return false;
  if (index === 0) return true;
  if (combinator === ">") return !!el.parentNode && matchesChain(el.parentNode, chain, index - 1);
  for (let ancestor = el.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (matchesChain(ancestor, chain, index - 1)) return true;
  }
  return false;
}

export function matches(el, selector) {
  return parse(selector).some((chain) => matchesChain(el, chain, chain.length - 1));
}

export function closest(el, selector) {
  for (let node = el; node; node = node.parentNode) {
    if (node.nodeType !== 3 && matches(node, selector)) return node;
  }
  return null;
}

/// Descendants of `root` in document order.
function* descendants(root) {
  const kids = root.children || [];
  for (let i = 0; i < kids.length; i++) {
    yield kids[i];
    yield* descendants(kids[i]);
  }
}

export function queryAll(root, selector) {
  const chains = parse(selector);
  const out = [];
  for (const el of descendants(root)) {
    if (chains.some((chain) => matchesChain(el, chain, chain.length - 1))) out.push(el);
  }
  return out;
}

export function queryFirst(root, selector) {
  const chains = parse(selector);
  for (const el of descendants(root)) {
    if (chains.some((chain) => matchesChain(el, chain, chain.length - 1))) return el;
  }
  return null;
}

export function byTagName(root, name) {
  const wanted = String(name).toLowerCase();
  const out = [];
  for (const el of descendants(root)) {
    if (el.nodeType === 3) continue;
    if (wanted === "*" || String(el.tagName || el.nodeName || "").toLowerCase() === wanted) out.push(el);
  }
  return withItem(out);
}

export function byClassName(root, names) {
  const wanted = String(names).split(/\s+/).filter(Boolean);
  const out = [];
  if (wanted.length === 0) return withItem(out);
  for (const el of descendants(root)) {
    if (el.nodeType === 3) continue;
    const have = String(el.className || "").split(/\s+/);
    if (wanted.every((cls) => have.includes(cls))) out.push(el);
  }
  return withItem(out);
}

export function byId(root, id) {
  for (const el of descendants(root)) if (el.nodeType !== 3 && String(el.id || "") === String(id)) return el;
  return null;
}

// An HTMLCollection is array-like with item() and namedItem(); this is an array with those.
function withItem(list) {
  Object.defineProperty(list, "item", { value: (i) => list[i] || null });
  Object.defineProperty(list, "namedItem", { value: (name) => list.find((el) => el.id === name || (el.getAttribute && el.getAttribute("name") === name)) || null });
  return list;
}
