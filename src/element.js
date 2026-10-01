// Minimal DOM node tree.
// Real games rarely walk the DOM tree, but engines (Cocos/Egret/Pixi) do call
// appendChild / removeChild / parentNode during canvas setup. We track
// parent + children just well enough to make those calls non-throwing.

import { pointerCaptureMethods } from "./pointer.js";
import { ClassList } from "./class-list.js";
import { byTagName, byClassName, byId, queryAll, queryFirst, matches, closest } from "./query.js";
import EventTarget from "./event-target.js";

// Browser boot pages commonly load the engine/game via a `<script src>` that
// webpack/rollup emit (e.g. Phaser/Egret HTML output: an index.html whose only
// job is `<script src="main.<hash>.js">`). A mini-game host has no HTML parser,
// so nothing loads that chunk and the game never boots. Mini-game runtimes
// (correctly, like WeChat) forbid loading REMOTE scripts, but a script that
// points at a LOCAL file bundled inside the game package is safe: read it via
// the host filesystem and execute it in global scope, then fire the element's
// `load` event so the boot sequence continues. Remote (http/https) srcs are
// refused. This runs once per connected <script src>, deferred to a microtask
// so an `onload` assigned right after `appendChild` is observed.
function maybeLoadScript(node) {
  if (!node || node.tagName !== "SCRIPT" || !node.src || node._migoLoaded) return;
  node._migoLoaded = true;
  Promise.resolve().then(() => {
    const src = String(node.src);
    try {
      if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
        console.warn("[migo-web-adapter] refusing to load non-local script:", src);
        if (typeof node.onerror === "function") node.onerror(new Error("non-local script blocked"));
        node.dispatchEvent && node.dispatchEvent({ type: "error" });
        return;
      }
      const path = src.replace(/^\.?\//, "").split("?")[0].split("#")[0];
      const fs = typeof migo !== "undefined" && migo.getFileSystemManager && migo.getFileSystemManager();
      if (!fs || typeof fs.readFileSync !== "function") {
        throw new Error("no filesystem manager to read local script");
      }
      const code = fs.readFileSync(path, "utf8");
      // Indirect eval → global scope: webpack/engine bundles are top-level
      // IIFEs that install globals; they must not run in a nested lexical scope.
      (0, eval)(code);
      if (typeof node.onload === "function") node.onload();
      node.dispatchEvent && node.dispatchEvent({ type: "load" });
    } catch (e) {
      console.error("[migo-web-adapter] local script load failed:", src, e);
      if (typeof node.onerror === "function") node.onerror(e);
      node.dispatchEvent && node.dispatchEvent({ type: "error" });
    }
  });
}

export class Node extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.ownerDocument = null;
  }

  // The root of the tree this node is in: the document when it is attached under it, else the topmost ancestor
  // (the node itself when it has none). three.js's OrbitControls asks it to find where to listen for pointer-up.
  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  appendChild(node) {
    if (!node) return null;
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.push(node);
    node.parentNode = this;
    maybeLoadScript(node);
    return node;
  }

  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i !== -1) {
      this.children.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }

  insertBefore(newNode, refNode) {
    if (!refNode) return this.appendChild(newNode);
    const i = this.children.indexOf(refNode);
    if (i === -1) return this.appendChild(newNode);
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    this.children.splice(i, 0, newNode);
    newNode.parentNode = this;
    maybeLoadScript(newNode);
    return newNode;
  }

  cloneNode() { return null; }

  // Lookups in this node's own subtree (query.js).
  getElementsByTagName(name) { return byTagName(this, name); }
  getElementsByClassName(names) { return byClassName(this, names); }
  getElementById(id) { return byId(this, id); }
  querySelector(selector) { return queryFirst(this, selector); }
  querySelectorAll(selector) { return queryAll(this, selector); }
  matches(selector) { return matches(this, selector); }
  closest(selector) { return closest(this, selector); }

  // `node.contains(other)` — engines (e.g. PixiJS CanvasSource) call
  // `document.body.contains(canvas)` to decide if a canvas is live in the DOM.
  contains(node) {
    if (node == null) return false;
    if (node === this) return true;
    for (const c of this.children) {
      if (c === node || (typeof c.contains === "function" && c.contains(node))) return true;
    }
    return false;
  }
}

export class Element extends Node {
  constructor() {
    super();
    this.style = {};
    this.classList = new ClassList(this);
    this.className = "";
    this.id = "";
    this.dataset = {};
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }
}

export default class HTMLElement extends Element {
  constructor(tagName = "") {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.innerHTML = "";
  }

  get clientWidth() { return globalThis.innerWidth || 0; }
  get clientHeight() { return globalThis.innerHeight || 0; }
  get offsetWidth() { return this.clientWidth; }
  get offsetHeight() { return this.clientHeight; }

  // Attributes are strings in a map of their own; the ones engines also read as properties are mirrored (class -> className,
  // id, data-* -> dataset, and any name that is a plain identifier -- `width`, `src`, `type` -- as a property).
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    const text = String(value);
    (this._attrs || (this._attrs = new Map())).set(key, text);
    if (key === "class") this.className = text;
    else if (key === "id") this.id = text;
    else if (key === "style") { for (const rule of text.split(";")) { const colon = rule.indexOf(":"); if (colon > 0) this.style[rule.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rule.slice(colon + 1).trim(); } }
    else if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = text;
    else if (/^[a-z_$][a-z0-9_$]*$/.test(key)) this[key] = text;
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (this._attrs && this._attrs.has(key)) return this._attrs.get(key);
    if (key === "id") return this.id ? String(this.id) : null;
    if (key === "class") return this.className ? String(this.className) : null;
    return null;
  }
  removeAttribute(name) {
    const key = String(name).toLowerCase();
    if (this._attrs) this._attrs.delete(key);
    if (key === "class") this.className = "";
    else if (key === "id") this.id = "";
    else if (key.startsWith("data-")) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    else if (/^[a-z_$][a-z0-9_$]*$/.test(key)) delete this[key];
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  getAttributeNames() { return this._attrs ? [...this._attrs.keys()] : []; }

  getBoundingClientRect() {
    const w = this.clientWidth, h = this.clientHeight;
    return { top: 0, left: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 };
  }

  focus() {}
  blur() {}
  click() {}
}

export class HTMLImageElement extends HTMLElement {
  constructor() { super("img"); }
}

export class HTMLCanvasElement extends HTMLElement {
  constructor() { super("canvas"); }

  // `document.createElement('canvas')` / `new Canvas()` returns the native
  // `migo.createCanvas()` object, which is NOT in this class hierarchy. Engines
  // detect canvases via `resource instanceof HTMLCanvasElement` (e.g. PixiJS
  // CanvasSource.test → otherwise "Could not find a source type for resource").
  // Duck-type so a native migo canvas passes, while still accepting any real
  // prototype-chain instance (Symbol.hasInstance replaces the default check).
  static [Symbol.hasInstance](obj) {
    if (obj == null) return false;
    if (
      typeof obj.getContext === "function" &&
      typeof obj.width === "number" &&
      typeof obj.height === "number"
    ) {
      return true;
    }
    for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
      if (p === HTMLCanvasElement.prototype) return true;
    }
    return false;
  }
}

export class HTMLAudioElement extends HTMLElement {
  constructor() { super("audio"); }
}

export class HTMLMediaElement extends HTMLElement {
  constructor(tag = "media") { super(tag); }
}

export class HTMLVideoElement extends HTMLElement {
  constructor() { super("video"); }
}

// Pointer capture on every element, as engines call it on whatever they were handed (pointer.js).
for (const name of Object.keys(pointerCaptureMethods)) {
  Object.defineProperty(HTMLElement.prototype, name, { value: pointerCaptureMethods[name], writable: true, configurable: true });
}
