// document — minimal surface that engines initialise against.
// createElement(canvas|img|audio) returns a real host object via the wrappers;
// other tags return a plain HTMLElement. getElementById/querySelector return
// null unless asking for the global canvas (engines do `getElementById('GameCanvas')`).

import HTMLElement from "./element.js";
import Image from "./image.js";
import Canvas from "./canvas.js";
import Audio from "./audio.js";
import location from "./location.js";
import EventTarget from "./event-target.js";

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
  ontouchstart: null,
  ontouchmove: null,
  ontouchend: null,
  ontouchcancel: null,
  style: {},

  head,
  body,

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
      // the document is ready.
      if (this._domReady && !this._mainCanvasRouted
          && globalThis.canvas && !globalThis.canvas._context) {
        this._mainCanvasRouted = true;
        return globalThis.canvas;
      }
      return new Canvas();
    }
    if (t === "img" || t === "image") return new Image();
    if (t === "audio") return new Audio();
    return new HTMLElement(tag);
  },

  createElementNS(_ns, tag) { return this.createElement(tag); },

  createTextNode(text) { return { nodeType: 3, textContent: String(text), nodeValue: String(text) }; },

  getElementById(id) {
    // Engines often request the on-screen canvas by id. The global canvas is
    // exposed by index.js as both `globalThis.canvas` and bound to a
    // well-known id on first creation.
    if (globalThis.canvas && (globalThis.canvas.id === id || id === "GameCanvas")) {
      return globalThis.canvas;
    }
    return null;
  },

  getElementsByTagName(_tag) { return []; },
  getElementsByName(_name) { return []; },
  getElementsByClassName(_cls) { return []; },
  querySelector(_q) { return null; },
  querySelectorAll(_q) { return []; },

  addEventListener(type, listener) { _docTarget.addEventListener(type, listener); },
  removeEventListener(type, listener) { _docTarget.removeEventListener(type, listener); },
  dispatchEvent(event) { return _docTarget.dispatchEvent(event); },
};

export default document;
