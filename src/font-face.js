// FontFace and document.fonts -- the CSS Font Loading API -- over `migo.loadFont`.
//
// A browser game loads a web font with `new FontFace(family, "url(...)")`, `await face.load()` and
// `document.fonts.add(face)`; PixiJS v8's web-font loader is exactly that, and without a FontFaceSet it warns "FontFace
// API is not supported" and its text falls back to the default font. The runtime registers a font file by path
// (`migo.loadFont(path, family)`, which reads TTF, OTF, WOFF and WOFF2), so:
//
//   a package URL (relative, origin-relative, https://game/...)   registered by its package path, nothing copied
//   any other URL (http(s), data:, blob:)                          fetched (resource.js), then as bytes
//   bytes (an ArrayBuffer or a view, as source or after a fetch)   written to the runtime's temporary directory,
//                                                                  registered from there, and the file removed
//
// The font is registered under the face's family when it loads. What this does not model: a face that is not in
// document.fonts still renders once loaded (the runtime has no per-document font scope), deleting a face does not
// unregister it, and `local(...)` sources are skipped (the runtime offers no system font by name).

import DOMException from "./dom-exception.js";
import EventTarget from "./event-target.js";
import { Event } from "./events.js";
import { kindOf, loadResource, packagePath } from "./resource.js";
import { withinPackage } from "./origin.js";

const runtime = () => (typeof migo !== "undefined" ? migo : null);

// A CSS family name as the runtime registers it: no surrounding quotes, no surrounding space.
function familyName(value) {
  const name = String(value).trim();
  const quoted = /^(["'])(.*)\1$/.exec(name);
  return quoted ? quoted[2] : name;
}

// The `url(...)` entries of a `src` descriptor, in order: `url("a.woff2") format("woff2"), url(a.woff), local(A)`.
// `null` when the value is not a list of url()/local() entries -- the specification's SyntaxError.
export function sourceUrls(src) {
  const urls = [];
  const entry = /\s*(?:url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)"'\s]*))\s*\)|local\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\))(?:\s*(?:format|tech)\([^)]*\))*\s*(,|$)/y;
  let at = 0;
  const text = String(src);
  if (text.trim() === "") return null;
  while (at < text.length) {
    entry.lastIndex = at;
    const m = entry.exec(text);
    if (!m) return null;
    const url = m[1] ?? m[2] ?? m[3];
    if (url !== undefined) urls.push(url.replace(/\\(.)/g, "$1"));
    at = entry.lastIndex;
    if (m[4] === "") break;
  }
  return urls;
}

// The family list of a CSS `font` shorthand ("bold 16px/1.2 'My Font', sans-serif" -> ["My Font", "sans-serif"]):
// everything after the size (and its optional line height), split on commas.
export function shorthandFamilies(font) {
  const m = /(?:^|\s)(?:[\d.]+(?:px|pt|pc|em|rem|ex|ch|vw|vh|vmin|vmax|%|cm|mm|in|q)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(String(font).trim());
  if (!m) return [];
  return m[1].split(",").map((family) => familyName(family).toLowerCase()).filter(Boolean);
}

let temporaryFiles = 0;

// Register a font file's bytes: the runtime reads fonts by path, so they go through a temporary file.
function registerBytes(bytes, family) {
  const host = runtime();
  if (!host || typeof host.loadFont !== "function" || typeof host.getFileSystemManager !== "function") return null;
  const fs = host.getFileSystemManager();
  const dir = (host.env && (host.env.TEMP_PATH || host.env.USER_DATA_PATH)) || "/tmp";
  const path = `${dir}/migo-font-face-${++temporaryFiles}.font`;
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    fs.writeFileSync(path, buffer);
  } catch (_) {
    return null;
  }
  try {
    return host.loadFont(path, family);
  } finally {
    try { fs.unlinkSync(path); } catch (_) { /* the directory is the session's and is cleared anyway */ }
  }
}

// Register the font one URL names; resolves to the runtime's family name or null.
async function registerUrl(url, family) {
  const host = runtime();
  if (!host || typeof host.loadFont !== "function") return null;
  const within = withinPackage(url);
  if (kindOf(within) === "file") return host.loadFont(packagePath(within), family) || null;
  const response = await loadResource({ url }).promise;
  if (response.status < 200 || response.status > 299 || !(response.body instanceof ArrayBuffer) || response.body.byteLength === 0) return null;
  return registerBytes(response.body, family) || null;
}

const DESCRIPTORS = {
  style: "normal", weight: "normal", stretch: "normal", unicodeRange: "U+0-10FFFF", variant: "normal",
  featureSettings: "normal", variationSettings: "normal", display: "auto",
  ascentOverride: "normal", descentOverride: "normal", lineGapOverride: "normal",
};

const isBinary = (source) => source instanceof ArrayBuffer || ArrayBuffer.isView(source);

export class FontFace {
  constructor(family, source, descriptors = {}) {
    if (arguments.length < 2) throw new TypeError("Failed to construct 'FontFace': 2 arguments required");
    this.family = familyName(family);
    for (const key of Object.keys(DESCRIPTORS)) {
      this[key] = descriptors && descriptors[key] !== undefined ? String(descriptors[key]) : DESCRIPTORS[key];
    }
    this.status = "unloaded";
    this._sets = new Set();
    this.loaded = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
    // A face nobody awaits is not an unhandled rejection; `face.loaded` still rejects for whoever does.
    this.loaded.catch(() => {});
    if (isBinary(source)) {
      // Bytes need no fetch: the specification starts loading them at once.
      const bytes = source instanceof ArrayBuffer ? source.slice(0) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
      // Bytes that are not a font are the specification's SyntaxError; a source that could not be fetched, a NetworkError.
      this._start(() => Promise.resolve(registerBytes(bytes, this.family)), "SyntaxError");
    } else {
      this._urls = sourceUrls(source);
      if (this._urls === null) this._settle(false, new DOMException(`Failed to construct 'FontFace': '${source}' is not a valid src`, "SyntaxError"));
    }
  }

  load() {
    if (this.status === "unloaded") {
      const urls = this._urls;
      this._start(async () => {
        for (const url of urls) {
          try {
            const name = await registerUrl(url, this.family);
            if (name) return name;
          } catch (_) { /* the next source */ }
        }
        return null;
      }, "NetworkError");
    }
    return this.loaded;
  }

  _start(register, errorName) {
    this.status = "loading";
    for (const set of this._sets) set._began(this);
    queueMicrotask(() => {
      register().then(
        (name) => this._settle(!!name, name ? null : new DOMException(`The font '${this.family}' could not be loaded`, errorName)),
        (error) => this._settle(false, new DOMException(String((error && error.message) || error), errorName)),
      );
    });
  }

  _settle(ok, error) {
    this.status = ok ? "loaded" : "error";
    if (ok) this._resolve(this);
    else this._reject(error);
    for (const set of this._sets) set._ended(this);
  }
}

export class FontFaceSetLoadEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.fontfaces = Array.isArray(init.fontfaces) ? init.fontfaces.slice() : [];
  }
}

export class FontFaceSet extends EventTarget {
  constructor(initialFaces = []) {
    super();
    this._faces = new Set();
    this._loading = new Set();
    this._loaded = [];
    this._failed = [];
    this.onloading = null;
    this.onloadingdone = null;
    this.onloadingerror = null;
    this.ready = Promise.resolve(this);
    for (const face of initialFaces) this.add(face);
  }

  get size() { return this._faces.size; }
  get status() { return this._loading.size > 0 ? "loading" : "loaded"; }

  add(face) {
    if (!(face instanceof FontFace)) throw new TypeError("Failed to execute 'add' on 'FontFaceSet': parameter 1 is not of type 'FontFace'");
    if (!this._faces.has(face)) {
      this._faces.add(face);
      face._sets.add(this);
      if (face.status === "loading") this._began(face);
    }
    return this;
  }

  delete(face) {
    if (!this._faces.delete(face)) return false;
    face._sets.delete(this);
    if (this._loading.delete(face)) this._maybeDone();
    return true;
  }

  clear() { for (const face of [...this._faces]) this.delete(face); }
  has(face) { return this._faces.has(face); }
  forEach(callback, thisArg) { for (const face of [...this._faces]) callback.call(thisArg, face, face, this); }
  values() { return this._faces.values(); }
  keys() { return this._faces.values(); }
  entries() { return [...this._faces].map((face) => [face, face])[Symbol.iterator](); }
  [Symbol.iterator]() { return this._faces.values(); }

  _matching(font) {
    const families = shorthandFamilies(font);
    if (families.length === 0) return null;
    return [...this._faces].filter((face) => families.includes(face.family.toLowerCase()));
  }

  /// Loads the faces the shorthand names; resolves to them once all have loaded, rejects if one fails.
  load(font, _text) {
    const faces = this._matching(font);
    if (faces === null) return Promise.reject(new DOMException(`Could not parse '${font}' as a font`, "SyntaxError"));
    return Promise.all(faces.map((face) => face.load()));
  }

  /// Whether text in the shorthand's font can be drawn without a load: every face it names has loaded. A family no
  /// face in the set has needs no load, as in a browser.
  check(font, _text) {
    const faces = this._matching(font);
    if (faces === null) throw new DOMException(`Could not parse '${font}' as a font`, "SyntaxError");
    return faces.every((face) => face.status === "loaded");
  }

  _began(face) {
    if (this._loading.has(face)) return;
    const wasIdle = this._loading.size === 0;
    this._loading.add(face);
    if (wasIdle) {
      this.ready = new Promise((resolve) => { this._readyResolve = resolve; });
      this._fire("loading", []);
    }
  }

  _ended(face) {
    if (!this._loading.delete(face)) return;
    (face.status === "loaded" ? this._loaded : this._failed).push(face);
    this._maybeDone();
  }

  _maybeDone() {
    if (this._loading.size > 0) return;
    const loaded = this._loaded.splice(0);
    const failed = this._failed.splice(0);
    this._fire("loadingdone", loaded);
    if (failed.length > 0) this._fire("loadingerror", failed);
    const resolve = this._readyResolve;
    this._readyResolve = null;
    if (resolve) resolve(this);
  }

  _fire(type, fontfaces) {
    const event = new FontFaceSetLoadEvent(type, { fontfaces });
    event.target = this;
    event.currentTarget = this;
    this.dispatchEvent(event);
    const handler = this["on" + type];
    if (typeof handler === "function") try { handler.call(this, event); } catch (_) { /* a handler's error is its own */ }
  }
}
