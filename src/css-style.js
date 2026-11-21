// `element.style`: a CSSStyleDeclaration, as a browser's inline style is.
//
// It was a plain object: properties set by name (`style.width = "100%"`, which three.js, Pixi and Phaser do) worked, and
// every method a style has threw. lil-gui -- three.js's examples build their debug panels with it -- sets a custom
// property through `style.setProperty("--width", ...)` while it constructs, so in games_fps the panel's constructor threw
// inside the level loader's callback. Properties stay own, enumerable, camel-cased strings (what getComputedStyle and the
// display compositor read with Object.keys); the methods and the computed members are on the prototype.
//
//   setProperty(name, value, priority)  name in CSS form (`background-color`, `--custom`); an empty value removes it
//   getPropertyValue(name) / removeProperty(name) / getPropertyPriority(name)
//   cssText (read: the declarations; write: replaces them), length, item(i), [Symbol.iterator]
//
// There is no cascade: a style says what was set on it, which is all the adapter's one layout reads.

const priorities = new WeakMap();

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (name) => name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/// The own property a CSS name is kept under: a custom property as written, any other camel-cased (`float` is `cssFloat`).
function keyOf(name) {
  const text = String(name).trim();
  if (text.startsWith("--")) return text;
  const lower = text.toLowerCase();
  return lower === "float" ? "cssFloat" : camel(lower);
}

/// The CSS name of an own property.
function nameOf(key) {
  if (key.startsWith("--")) return key;
  return key === "cssFloat" ? "float" : kebab(key);
}

function declared(style) {
  return Object.keys(style).filter((key) => typeof style[key] === "string" && style[key] !== "");
}

/// `a: b; c: d !important` -> [[name, value, priority]]; semicolons inside parentheses or quotes are not separators.
function parseDeclarations(text) {
  const out = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const source = String(text);
  const push = (end) => {
    const part = source.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) {
      let value = part.slice(colon + 1).trim();
      let priority = "";
      const important = /\s*!\s*important\s*$/i.exec(value);
      if (important) { value = value.slice(0, important.index).trim(); priority = "important"; }
      out.push([part.slice(0, colon).trim(), value, priority]);
    }
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "\"" || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) { push(i); start = i + 1; }
  }
  push(source.length);
  return out;
}

export class CSSStyleDeclaration {
  setProperty(name, value, priority = "") {
    const key = keyOf(name);
    const text = value === null || value === undefined ? "" : String(value);
    if (text === "") { this.removeProperty(name); return; }
    this[key] = text;
    const map = priorities.get(this);
    if (String(priority).toLowerCase() === "important") {
      (map || priorities.set(this, new Map()).get(this)).set(key, "important");
    } else if (map) {
      map.delete(key);
    }
  }

  getPropertyValue(name) {
    const value = this[keyOf(name)];
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  getPropertyPriority(name) {
    const map = priorities.get(this);
    return (map && map.get(keyOf(name))) || "";
  }

  removeProperty(name) {
    const key = keyOf(name);
    const previous = this.getPropertyValue(name);
    delete this[key];
    const map = priorities.get(this);
    if (map) map.delete(key);
    return previous;
  }

  get cssText() {
    return declared(this)
      .map((key) => `${nameOf(key)}: ${this[key]}${this.getPropertyPriority(nameOf(key)) ? " !important" : ""};`)
      .join(" ");
  }

  set cssText(text) {
    for (const key of Object.keys(this)) delete this[key];
    priorities.delete(this);
    for (const [name, value, priority] of parseDeclarations(text)) this.setProperty(name, value, priority);
  }

  get length() { return declared(this).length; }

  item(index) {
    const key = declared(this)[index];
    return key === undefined ? "" : nameOf(key);
  }

  *[Symbol.iterator]() {
    for (const key of declared(this)) yield nameOf(key);
  }

  get [Symbol.toStringTag]() { return "CSSStyleDeclaration"; }
}

/// A CSSStyleDeclaration holding what `existing` (a plain style object, or nothing) holds.
export function styleDeclaration(existing) {
  if (existing instanceof CSSStyleDeclaration) return existing;
  const style = new CSSStyleDeclaration();
  if (existing && typeof existing === "object") {
    for (const key of Object.keys(existing)) style[key] = existing[key];
  }
  return style;
}
