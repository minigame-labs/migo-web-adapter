// document — minimal surface that engines initialise against.
// createElement(canvas|img|audio) returns a real host object via the wrappers;
// other tags return a plain HTMLElement. getElementById/querySelector return
// null unless asking for the global canvas (engines do `getElementById('GameCanvas')`).

import { CSSStyleDeclaration } from "./css-style.js";
import HTMLElement, { HTMLVideoElement } from "./element.js";
import Image from "./image.js";
import Canvas from "./canvas.js";
import Audio from "./audio.js";
import location from "./location.js";
import { BASE_URI } from "./origin.js";
import EventTarget from "./event-target.js";
import { FontFaceSet } from "./font-face.js";
import { byTagName, byClassName, byId, queryAll, queryFirst } from "./query.js";

const _docTarget = new EventTarget();

// The page's element tree: <html> holding <head> and <body>. Engines measure
// against it -- Phaser on iOS appends a 100vh probe to documentElement to read
// the viewport height -- so it is an element, not the window.
const head = new HTMLElement("head");
const body = new HTMLElement("body");
const documentElement = new HTMLElement("html");
documentElement.appendChild(head);
documentElement.appendChild(body);

const document = {
  // Starts "loading"; index.js walks it "loading" → "interactive" (fires
  // DOMContentLoaded) → "complete" (fires window `load`) on a deferred
  // macrotask, mirroring how a browser drives a `<script defer>` page. Browser
  // engines (Phaser, Egret, …) boot from those events, so they must fire.
  readyState: "loading",
  onreadystatechange: null,
  visibilityState: "visible",
  hidden: false,
  documentElement,
  location,
  // The game's origin root (origin.js): what a relative asset path is resolved against.
  baseURI: BASE_URI,
  // The document's address: its location's (location.js), absolute, as a browser's is.
  get URL() { return location.href; },
  get documentURI() { return location.href; },
  // The document's FontFaceSet (font-face.js): PixiJS's web-font loader adds the faces it loads here.
  fonts: new FontFaceSet(),
  ontouchstart: null,
  ontouchmove: null,
  ontouchend: null,
  ontouchcancel: null,
  style: new CSSStyleDeclaration(),

  head,
  body,
  // The element with focus; `canvas.focus()` sets it.
  activeElement: body,

  // Set true by index.js when the document becomes ready (just before DOMContentLoaded is dispatched); gates
  // display-canvas routing below so it only applies to canvases created while an engine boots, not to the
  // feature-detection canvases an engine makes while its script loads.
  _domReady: false,
  _mainCanvasRouted: false,

  createElement(tag) {
    const t = String(tag).toLowerCase();
    if (t === "canvas") {
      // Migo presents only the onscreen canvas (rid 1, exposed as
      // `globalThis.canvas`). Browser engines that create their own render
      // canvas via `document.createElement('canvas')` (e.g. Phaser) would
      // otherwise draw into an offscreen buffer that is never shown. So the
      // first canvas created once the document is ready (DOMContentLoaded and
      // later: Phaser boots on DOMContentLoaded, other engines in a `load`
      // handler), while the onscreen canvas is still unclaimed (no rendering
      // context), is treated as the engine's display canvas and backed by the
      // onscreen surface. Engines that instead reuse the global `canvas`
      // (Pixi/Cocos) claim it before this fires and are unaffected;
      // feature-detection canvases are created while the script loads, before
      // the document is ready. And a page that already has a canvas of its own
      // in its document has its display canvas: a canvas it makes later is a
      // probe or a buffer -- Defold's loader checks for WebGL with one once its
      // assets have arrived -- and handed the screen it would hold the screen's
      // context, so the composite (display.js) could never show the page's
      // canvas on it. And an onscreen canvas the page has sized itself
      // (`canvas.width = ...`, which the runtime records) is the page's
      // already: Kaplay, handed it as its `canvas`, sizes it and then makes its
      // font cache's canvas before it asks for a context -- handed the screen,
      // that 2D canvas left the engine none (`getContext('webgl')` was null).
      if (this._domReady && !this._mainCanvasRouted
          && globalThis.canvas && !globalThis.canvas._context && !globalThis.canvas._sizedByContent
          && this.getElementsByTagName("canvas").length === 0) {
        this._mainCanvasRouted = true;
        return globalThis.canvas;
      }
      return new Canvas();
    }
    if (t === "img" || t === "image") return new Image();
    if (t === "audio") return new Audio();
    if (t === "video") return new HTMLVideoElement();
    return new HTMLElement(tag);
  },

  createElementNS(_ns, tag) { return this.createElement(tag); },

  // A game owns the whole window: it has focus while it is visible. p5.js calls this while it loads.
  hasFocus() { return this.visibilityState === "visible"; },

  createTextNode(text) { return { nodeType: 3, textContent: String(text), nodeValue: String(text) }; },

  getElementById(id) {
    // Engines often request the on-screen canvas by id. The global canvas is
    // exposed by index.js as both `globalThis.canvas` and bound to a
    // well-known id on first creation.
    if (globalThis.canvas && (globalThis.canvas.id === id || id === "GameCanvas")) {
      return globalThis.canvas;
    }
    return byId(documentElement, id);
  },

  // Lookups walk the tree under <html> (query.js): what an engine appended to <head> or <body> can be found again.
  getElementsByTagName(tag) { return byTagName(documentElement, tag); },
  getElementsByName(name) { return queryAll(documentElement, `[name="${String(name).replace(/"/g, "")}"]`); },
  getElementsByClassName(names) { return byClassName(documentElement, names); },
  querySelector(selector) { return queryFirst(documentElement, selector); },
  querySelectorAll(selector) { return queryAll(documentElement, selector); },

  addEventListener(type, listener) { _docTarget.addEventListener(type, listener); },
  removeEventListener(type, listener) { _docTarget.removeEventListener(type, listener); },
  dispatchEvent(event) { return _docTarget.dispatchEvent(event); },
};

export default document;
