// Minimal DOM node tree.
// Real games rarely walk the DOM tree, but engines (Cocos/Egret/Pixi) do call
// appendChild / removeChild / parentNode during canvas setup. We track
// parent + children just well enough to make those calls non-throwing.

import { CSSStyleDeclaration } from "./css-style.js";
import { pointerCaptureMethods } from "./pointer.js";
import { ClassList } from "./class-list.js";
import { byTagName, byClassName, byId, queryAll, queryFirst, matches, closest } from "./query.js";
import EventTarget from "./event-target.js";
import DOMException from "./dom-exception.js";
import { hostImages } from "./image-registry.js";
import { withinPackage } from "./origin.js";
import { parseHtmlFragment } from "./html-fragment.js";
import { reportException } from "./report.js";

// Browser boot pages commonly load the engine/game via a `<script src>` that
// webpack/rollup emit (e.g. Phaser/Egret HTML output: an index.html whose only
// job is `<script src="main.<hash>.js">`). A mini-game host has no HTML parser,
// so nothing loads that chunk and the game never boots. Mini-game runtimes
// (correctly, as the reference platform does) forbid loading REMOTE scripts, but a script that
// points at a LOCAL file bundled inside the game package is safe: read it via
// the host filesystem and execute it in global scope, then fire the element's
// `load` event so the boot sequence continues. Remote (http/https) srcs are
// refused. This runs once per connected <script src>, deferred to a microtask
// so an `onload` assigned right after `appendChild` is observed.
//
// As HTML runs a script element: a script that cannot be had fires `error` and runs nothing; one that runs and throws
// has its exception reported, and its `load` still fires (the script was fetched and executed -- that is what `load`
// says); an `onload` or `load` listener that throws is reported too. All three were one failure: a loader whose own
// `onload` threw (a Unity build's, on a URL it could not make) was logged as a script that failed to load, its `error`
// fired, and nothing that watches for errors heard of it.
function maybeLoadScript(node) {
  if (!node || node.tagName !== "SCRIPT" || !node.src || node._migoLoaded) return;
  node._migoLoaded = true;
  Promise.resolve().then(() => {
    const src = withinPackage(String(node.src));
    let code;
    try {
      if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
        throw new Error("non-local script blocked");
      }
      const path = src.replace(/^\.?\//, "").split("?")[0].split("#")[0];
      const fs = typeof migo !== "undefined" && migo.getFileSystemManager && migo.getFileSystemManager();
      if (!fs || typeof fs.readFileSync !== "function") {
        throw new Error("no filesystem manager to read local script");
      }
      code = fs.readFileSync(path, "utf8");
    } catch (e) {
      console.warn("[migo-web-adapter] the script " + src + " could not be loaded:", e);
      fireScriptEvent(node, "error", e);
      return;
    }
    try {
      // Indirect eval → global scope: webpack/engine bundles are top-level
      // IIFEs that install globals; they must not run in a nested lexical scope.
      (0, eval)(code);
    } catch (e) {
      reportException(e);
    }
    fireScriptEvent(node, "load");
  });
}

// The element's `on<type>` handler, then its listeners; whatever either throws is reported, and the rest still run.
function fireScriptEvent(node, type, error) {
  const handler = node["on" + type];
  if (typeof handler === "function") {
    try {
      type === "error" ? handler.call(node, error) : handler.call(node);
    } catch (e) {
      reportException(e);
    }
  }
  if (node.dispatchEvent) node.dispatchEvent({ type });
}

export class Node extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.ownerDocument = null;
  }

  // The parent, when it is an element (Defold's loader removes its progress bar through it).
  get parentElement() {
    const parent = this.parentNode;
    return parent && parent.nodeType === 1 ? parent : null;
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

  // ChildNode.remove(): out of its parent, if it has one. PixiJS v8 removes the elements it created this way (a
  // detached element is a no-op, as in a browser), and a game whose frame callback called it threw on every frame.
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

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

// Element.insertAdjacentHTML, insertAdjacentElement and insertAdjacentText (DOM Parsing and Serialization 2.4, DOM 4.9),
// for the adapter's elements and the host's canvases alike. Defold's loader puts its progress bar after the canvas with
// `canvas.insertAdjacentHTML("afterend", ...)`; without it the start-up script threw and the engine was never fetched.
const ADJACENT_POSITIONS = ["beforebegin", "afterbegin", "beforeend", "afterend"];

function adjacentPosition(method, where) {
  const position = String(where).toLowerCase();
  if (!ADJACENT_POSITIONS.includes(position)) {
    throw new DOMException(`Failed to execute '${method}' on 'Element': The value provided ('${where}') is not one of ` +
      "'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.", "SyntaxError");
  }
  return position;
}

// A node that can hold children: the adapter's own, or a host canvas given the list a <canvas> has for its fallback content.
function withChildren(node) {
  if (!Array.isArray(node.children)) {
    const children = [];
    Object.defineProperty(node, "children", { value: children, configurable: true, writable: true });
    if (!("childNodes" in node)) Object.defineProperty(node, "childNodes", { value: children, configurable: true, writable: true });
  }
  return node;
}

const appendChildTo = (parent, child) => Node.prototype.appendChild.call(withChildren(parent), child);

// Where `position` puts nodes relative to `target`: the parent they go into and the node they go before (null: the end).
// Null when the position is outside the target and it has no parent to hold them.
function adjacentSlot(target, position) {
  if (position === "afterbegin") return { parent: withChildren(target), before: withChildren(target).children[0] || null };
  if (position === "beforeend") return { parent: withChildren(target), before: null };
  const parent = target.parentNode;
  if (!parent || parent.nodeType === 9) return null;
  const siblings = withChildren(parent).children;
  if (position === "beforebegin") return { parent, before: target };
  return { parent, before: siblings[siblings.indexOf(target) + 1] || null };
}

// Node's own methods, called on the parent: a host canvas has neither of its own.
const insertInSlot = (slot, node) => (slot.before
  ? Node.prototype.insertBefore.call(slot.parent, node, slot.before)
  : Node.prototype.appendChild.call(slot.parent, node));

export const insertAdjacentMembers = {
  insertAdjacentHTML(position, text) {
    const where = adjacentPosition("insertAdjacentHTML", position);
    const slot = adjacentSlot(this, where);
    if (!slot) {
      throw new DOMException("Failed to execute 'insertAdjacentHTML' on 'Element': The element has no parent.", "NoModificationAllowedError");
    }
    for (const node of parseHtmlFragment(String(text), globalThis.document, appendChildTo)) insertInSlot(slot, node);
  },
  insertAdjacentElement(position, element) {
    const where = adjacentPosition("insertAdjacentElement", position);
    if (!element || typeof element !== "object" || element.nodeType !== 1) {
      throw new TypeError("Failed to execute 'insertAdjacentElement' on 'Element': parameter 2 is not of type 'Element'.");
    }
    const slot = adjacentSlot(this, where);
    if (!slot) return null;
    insertInSlot(slot, element);
    return element;
  },
  insertAdjacentText(position, data) {
    const where = adjacentPosition("insertAdjacentText", position);
    const slot = adjacentSlot(this, where);
    if (slot) insertInSlot(slot, globalThis.document.createTextNode(String(data)));
  },
};

export class Element extends Node {
  constructor() {
    super();
    this.style = new CSSStyleDeclaration();
    this.classList = new ClassList(this);
    this.className = "";
    this.id = "";
    this.dataset = {};
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }

  // ELEMENT_NODE, as Node.prototype.nodeType answers for an element (a host canvas carries the same, canvas.js).
  get nodeType() { return 1; }
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
    else if (key === "style") this.style.cssText = text;
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
for (const [name, value] of Object.entries(insertAdjacentMembers)) {
  Object.defineProperty(HTMLElement.prototype, name, { value, writable: true, configurable: true });
}

export class HTMLImageElement extends HTMLElement {
  constructor() { super("img"); }

  // `new Image()` and `document.createElement('img')` hand out the runtime's host image (image.js), which is not in this
  // class hierarchy; `instanceof HTMLImageElement` is how engines tell an image from a canvas or a bitmap.
  static [Symbol.hasInstance](obj) {
    if (obj == null || typeof obj !== "object") return false;
    if (hostImages.has(obj)) return true;
    for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
      if (p === HTMLImageElement.prototype) return true;
    }
    return false;
  }
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

// A media element this adapter cannot play. Sound is the Audio class's (audio.js, through the runtime's decoders); a
// <video> has no backing here, so it says so the way a browser says it about a format it lacks, instead of missing the
// methods: canPlayType answers "" for every type, a source fails with MEDIA_ERR_SRC_NOT_SUPPORTED, and play() rejects.
// PixiJS v8 asks a <video> what it can play while it sets up its loaders; with no canPlayType that rejection stopped
// its asset system, and the game it belonged to never left its loading screen.
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
export class HTMLMediaElement extends HTMLElement {
  constructor(tag = "media") {
    super(tag);
    this._src = "";
    this.error = null;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.muted = false;
    this.volume = 1;
    this.loop = false;
    this.autoplay = false;
    this.preload = "auto";
    this.crossOrigin = null;
  }

  get readyState() { return 0; } // HAVE_NOTHING
  get networkState() { return this._src ? 3 : 0; } // NETWORK_NO_SOURCE once a source was refused, else NETWORK_EMPTY
  get currentSrc() { return ""; }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    if (this._src) this._refuse();
  }

  canPlayType(_type) { return ""; }
  load() { if (this._src) this._refuse(); }
  pause() {}
  play() {
    return Promise.reject(new DOMException("this media element has no playback here", "NotSupportedError"));
  }

  // The source's failure, after the call that set it returns, as a browser's media element reports it.
  _refuse() {
    setTimeout(() => {
      this.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED, message: "no playback for this media element" };
      const event = { type: "error", target: this, currentTarget: this };
      if (typeof this.onerror === "function") this.onerror(event);
      this.dispatchEvent(event);
    }, 0);
  }
}
HTMLMediaElement.MEDIA_ERR_SRC_NOT_SUPPORTED = MEDIA_ERR_SRC_NOT_SUPPORTED;

export class HTMLVideoElement extends HTMLMediaElement {
  constructor() {
    super("video");
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.playsInline = false;
    this.poster = "";
  }
}

// Pointer capture on every element, as engines call it on whatever they were handed (pointer.js).
for (const name of Object.keys(pointerCaptureMethods)) {
  Object.defineProperty(HTMLElement.prototype, name, { value: pointerCaptureMethods[name], writable: true, configurable: true });
}
