// window.matchMedia and MediaQueryList (CSSOM View 4.2), answered against the game's own window.
//
// A game asks its page's media queries about the screen it draws on: Defold's loader watches
// `(resolution: <devicePixelRatio>dppx)` to learn when the pixel ratio changes, and engines size their UI by
// `(orientation: portrait)` or `(max-width: ...)`. The queries are Media Queries Level 4's: a comma-separated list, each
// an optional `not`/`only` and media type, conditions joined by `and` or `or`, `not (...)`, the plain, `min-`/`max-` and
// range forms (`(width >= 600px)`, `(400px < width < 800px)`). `matches` is evaluated when it is read; a `change` event
// fires when a resize flips it. A query that does not parse, or names a feature this list does not know, matches nothing
// (it serializes as `not all`, as a browser's does).
//
// What the window is: `innerWidth`/`innerHeight` in CSS pixels, `devicePixelRatio`, `screen` -- the adapter's window
// metrics -- a touch screen (`navigator.maxTouchPoints` > 0: no hover, a coarse pointer) or a mouse, light colours and no
// preference for reduced motion or contrast, a full-screen display mode, eight bits per colour component.

import EventTarget from "./event-target.js";
import { reportException } from "./report.js";

const LENGTH_UNITS = { px: 1, em: 16, rem: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
const RESOLUTION_UNITS = { dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 };

function environment(win) {
  const screen = win.screen || {};
  const touch = !!(win.navigator && win.navigator.maxTouchPoints > 0);
  const width = Number(win.innerWidth) || 0;
  const height = Number(win.innerHeight) || 0;
  return {
    width, height,
    "device-width": Number(screen.width) || width,
    "device-height": Number(screen.height) || height,
    resolution: Number(win.devicePixelRatio) || 1,
    touch,
  };
}

// Each feature: its kind and what it is in `env`. "range" features take min-/max- and the range forms.
const FEATURES = {
  width: { kind: "length", value: (e) => e.width },
  height: { kind: "length", value: (e) => e.height },
  "device-width": { kind: "length", value: (e) => e["device-width"] },
  "device-height": { kind: "length", value: (e) => e["device-height"] },
  "aspect-ratio": { kind: "ratio", value: (e) => (e.height ? e.width / e.height : 0) },
  "device-aspect-ratio": { kind: "ratio", value: (e) => (e["device-height"] ? e["device-width"] / e["device-height"] : 0) },
  resolution: { kind: "resolution", value: (e) => e.resolution },
  "-webkit-device-pixel-ratio": { kind: "number", value: (e) => e.resolution },
  color: { kind: "integer", value: () => 8 },
  "color-index": { kind: "integer", value: () => 0 },
  monochrome: { kind: "integer", value: () => 0 },
  grid: { kind: "discrete", value: () => "0" },
  orientation: { kind: "discrete", value: (e) => (e.height >= e.width ? "portrait" : "landscape") },
  hover: { kind: "discrete", value: (e) => (e.touch ? "none" : "hover") },
  "any-hover": { kind: "discrete", value: (e) => (e.touch ? "none" : "hover") },
  pointer: { kind: "discrete", value: (e) => (e.touch ? "coarse" : "fine") },
  "any-pointer": { kind: "discrete", value: (e) => (e.touch ? "coarse" : "fine") },
  "prefers-color-scheme": { kind: "discrete", value: () => "light" },
  "prefers-reduced-motion": { kind: "discrete", value: () => "no-preference" },
  "prefers-reduced-transparency": { kind: "discrete", value: () => "no-preference" },
  "prefers-contrast": { kind: "discrete", value: () => "no-preference" },
  "forced-colors": { kind: "discrete", value: () => "none" },
  "inverted-colors": { kind: "discrete", value: () => "none" },
  "display-mode": { kind: "discrete", value: () => "fullscreen" },
  "color-gamut": { kind: "gamut", value: () => "srgb" },
  "dynamic-range": { kind: "discrete", value: () => "standard" },
  scan: { kind: "discrete", value: () => "progressive" },
  update: { kind: "discrete", value: () => "fast" },
  scripting: { kind: "discrete", value: () => "enabled" },
};
const RANGE_KINDS = new Set(["length", "ratio", "resolution", "number", "integer"]);

class Unknown extends Error {}

// A feature's value as written, in the units `env` holds: CSS pixels, dppx, a plain number or a keyword.
function parseValue(kind, text) {
  const t = text.trim().toLowerCase();
  if (kind === "ratio") {
    const m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/.exec(t);
    if (!m) throw new Unknown();
    const den = m[2] === undefined ? 1 : Number(m[2]);
    return den === 0 ? Infinity : Number(m[1]) / den;
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/.exec(t);
  if (kind === "discrete" || kind === "gamut") {
    if (!/^[a-z0-9-]+$/.test(t)) throw new Unknown();
    return t;
  }
  if (!m) throw new Unknown();
  const n = Number(m[1]);
  const unit = m[2];
  if (kind === "length") {
    if (unit === "" && n === 0) return 0;
    if (!(unit in LENGTH_UNITS)) throw new Unknown();
    return n * LENGTH_UNITS[unit];
  }
  if (kind === "resolution") {
    if (!(unit in RESOLUTION_UNITS)) throw new Unknown();
    return n * RESOLUTION_UNITS[unit];
  }
  if (unit !== "" || (kind === "integer" && !Number.isInteger(n))) throw new Unknown();
  return n;
}

const GAMUTS = ["srgb", "p3", "rec2020"];
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const compare = (a, op, b) => (op === "=" ? near(a, b) : op === "<" ? a < b && !near(a, b) : op === "<=" ? a <= b || near(a, b)
  : op === ">" ? a > b && !near(a, b) : a >= b || near(a, b));

// One parenthesized feature test, without its parentheses.
function evaluateFeature(text, env) {
  const t = text.trim();
  // The range forms: `width >= 600px`, `600px <= width`, `400px < width < 800px`.
  const range = /^(.+?)\s*(<=|>=|<|>|=)\s*(.+?)(?:\s*(<=|>=|<|>|=)\s*(.+))?$/.exec(t);
  if (range && !t.includes(":")) {
    const [, a, op1, b, op2, c] = range;
    const name = (s) => s.trim().toLowerCase();
    const flip = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
    if (op2 === undefined) {
      if (FEATURES[name(a)]) return rangeTest(name(a), op1, b, env);
      if (FEATURES[name(b)]) return rangeTest(name(b), flip[op1], a, env);
      throw new Unknown();
    }
    const feature = name(b);
    if (!FEATURES[feature] || (op1[0] !== op2[0]) || op1 === "=" || op2 === "=") throw new Unknown();
    return rangeTest(feature, flip[op1], a, env) && rangeTest(feature, op2, c, env);
  }
  const colon = t.indexOf(":");
  const rawName = (colon === -1 ? t : t.slice(0, colon)).trim().toLowerCase();
  let name = rawName;
  let op = "=";
  if (rawName.startsWith("min-") || rawName.startsWith("-webkit-min-")) { name = rawName.replace(/^(-webkit-)?min-/, "$1"); op = ">="; }
  else if (rawName.startsWith("max-") || rawName.startsWith("-webkit-max-")) { name = rawName.replace(/^(-webkit-)?max-/, "$1"); op = "<="; }
  const feature = FEATURES[name];
  if (!feature) throw new Unknown();
  if (colon === -1) {
    if (op !== "=") throw new Unknown();
    // Boolean context: true unless the feature's value is zero or "none".
    const v = feature.value(env);
    return !(v === 0 || v === "0" || v === "none" || v === "no-preference");
  }
  if (op !== "=") {
    if (!RANGE_KINDS.has(feature.kind)) throw new Unknown();
    return rangeTest(name, op, t.slice(colon + 1), env);
  }
  const want = parseValue(feature.kind, t.slice(colon + 1));
  const have = feature.value(env);
  if (feature.kind === "gamut") {
    if (!GAMUTS.includes(want)) throw new Unknown();
    return GAMUTS.indexOf(have) >= GAMUTS.indexOf(want);
  }
  return typeof want === "number" ? near(have, want) : have === want;
}

function rangeTest(name, op, valueText, env) {
  const feature = FEATURES[name];
  if (!RANGE_KINDS.has(feature.kind)) throw new Unknown();
  return compare(feature.value(env), op, parseValue(feature.kind, valueText));
}

// A media condition: `(feature)`, `not <condition>`, and conditions joined by one of `and` / `or` (not mixed without
// parentheses). `pos` walks the string.
function evaluateCondition(s, env) {
  const parts = [];
  const joiners = [];
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  while (true) {
    skip();
    let negate = false;
    if (/^not\s*\(/i.test(s.slice(i))) { negate = true; i += 3; skip(); }
    if (s[i] !== "(") throw new Unknown();
    let depth = 0, start = i;
    for (; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) break;
    }
    if (depth !== 0) throw new Unknown();
    const inner = s.slice(start + 1, i);
    i++;
    const value = /^\s*(not\s*)?\(/i.test(inner) ? evaluateCondition(inner, env) : evaluateFeature(inner, env);
    parts.push(negate ? !value : value);
    skip();
    if (i >= s.length) break;
    const word = /^(and|or)\b/i.exec(s.slice(i));
    if (!word) throw new Unknown();
    joiners.push(word[1].toLowerCase());
    i += word[1].length;
  }
  if (new Set(joiners).size > 1) throw new Unknown();
  return joiners[0] === "or" ? parts.some(Boolean) : parts.every(Boolean);
}

const MEDIA_TYPES = new Set(["all", "screen", "print", "speech", "tty", "tv", "projection", "handheld", "braille", "embossed", "aural"]);

function evaluateQuery(query, env) {
  const q = query.trim();
  if (q === "") return true;
  if (q.startsWith("(") || /^not\s*\(/i.test(q)) return evaluateCondition(q, env);
  const m = /^(?:(not|only)\s+)?([a-z-]+)(?:\s+and\s+([\s\S]+))?$/i.exec(q);
  if (!m) throw new Unknown();
  const type = m[2].toLowerCase();
  if (!MEDIA_TYPES.has(type)) throw new Unknown();
  let result = (type === "all" || type === "screen") && (m[3] === undefined || evaluateCondition(m[3], env));
  if (m[1] && m[1].toLowerCase() === "not") result = !result;
  return result;
}

// Split on the commas at the top level (not inside parentheses).
function splitQueries(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

// [matches, serialization] of a media query list against `env`.
export function evaluateMediaQueryList(text, env) {
  const source = String(text).trim();
  if (source === "") return [true, ""];
  let any = false;
  const serialized = [];
  for (const query of splitQueries(source)) {
    try {
      if (evaluateQuery(query, env)) any = true;
      serialized.push(query.trim().replace(/\s+/g, " "));
    } catch (error) {
      if (!(error instanceof Unknown)) throw error;
      serialized.push("not all");
    }
  }
  return [any, serialized.join(", ")];
}

export class MediaQueryList extends EventTarget {
  constructor(media, win) {
    super();
    this._query = String(media);
    this._win = win;
    this._onchange = null;
    this._last = this.matches;
    this._watching = false;
  }
  get media() { return evaluateMediaQueryList(this._query, environment(this._win))[1]; }
  get matches() { return evaluateMediaQueryList(this._query, environment(this._win))[0]; }
  get onchange() { return this._onchange; }
  set onchange(handler) { this._onchange = typeof handler === "function" ? handler : null; this._watch(); }
  addEventListener(type, listener, options) { super.addEventListener(type, listener, options); if (type === "change") this._watch(); }
  // The legacy pair: addListener(l) is addEventListener("change", l).
  addListener(listener) { if (typeof listener === "function") this.addEventListener("change", listener); }
  removeListener(listener) { if (typeof listener === "function") this.removeEventListener("change", listener); }

  _watch() {
    if (this._watching || !this._win || typeof this._win.addEventListener !== "function") return;
    this._watching = true;
    this._last = this.matches;
    this._win.addEventListener("resize", () => {
      const now = this.matches;
      if (now === this._last) return;
      this._last = now;
      const event = { type: "change", matches: now, media: this.media, target: this, currentTarget: this };
      if (this._onchange) { try { this._onchange.call(this, event); } catch (error) { reportException(error); } }
      this.dispatchEvent(event);
    });
  }
}

export function createMatchMedia(win) {
  return function matchMedia(query) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to execute 'matchMedia' on 'Window': 1 argument required, but only 0 present.");
    }
    return new MediaQueryList(query, win);
  };
}
