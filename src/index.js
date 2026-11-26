// migo-web-adapter entry point. Layers a browser-style BOM/DOM surface on top of
// the migo runtime so that engines built for browser-like environments
// (Cocos Creator, Egret, Laya, Pixi, raw WebGL) can run unchanged.
//
// Usage (game side, before the engine boots):
//
//   import "@minigame-labs/migo-web-adapter";          // ESM
//   // or, in CommonJS / require-style:
//   require("@minigame-labs/migo-web-adapter");
//
// One-shot: idempotent on re-entry.

import * as bom from "./bom.js";
import { getComputedStyle } from "./computed-style.js";
import navigator from "./navigator.js";
import location from "./location.js";
import document from "./document.js";
import HTMLElement, { Node, Element, HTMLImageElement, HTMLCanvasElement,
                       HTMLAudioElement, HTMLMediaElement, HTMLVideoElement } from "./element.js";
import EventTarget from "./event-target.js";
import { Event, TouchEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, CompositionEvent, DeviceMotionEvent, ProgressEvent } from "./events.js";
import { GamepadEvent, connectGamepadEvents } from "./gamepad.js";
import Image from "./image.js";
import Canvas from "./canvas.js";
import Audio from "./audio.js";
import localStorage from "./local-storage.js";
import XMLHttpRequest from "./xhr.js";
import WebSocket from "./websocket.js";
import FileReader from "./file-reader.js";
import Intl from "./intl.js";
import DOMException from "./dom-exception.js";
import { DOMParser, XMLSerializer } from "./dom-parser.js";
import { ScreenOrientation } from "./screen-orientation.js";
import { Window, adoptWindowPrototype } from "./window.js";
import { ResizeObserver, ResizeObserverEntry, ResizeObserverSize, requestResizeCheck } from "./resize-observer.js";
import {
  createIndexedDB, fileStorage, IDBFactory, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor,
  IDBCursorWithValue, IDBKeyRange, IDBRequest, IDBOpenDBRequest, IDBVersionChangeEvent, DOMStringList,
} from "./idb/api.js";
import { atob, btoa } from "./base64.js";
import { TextEncoder, TextDecoder } from "./text-codec.js";
import { Blob, File } from "./blob.js";
import { AbortController, AbortSignal } from "./abort.js";
import { Headers, Request, Response, fetch } from "./fetch.js";
import Worker from "./worker.js";
import { FontFace, FontFaceSet, FontFaceSetLoadEvent } from "./font-face.js";
import { ReadableStream, ReadableStreamDefaultReader } from "./streams.js";
import { MediaQueryList, createMatchMedia } from "./match-media.js";
import { installDisplay } from "./display.js";
import { installObjectURLs } from "./blob-url.js";
import { installAudioWorklet } from "./audio-worklet.js";
import { installCrypto } from "./crypto.js";
import { CSSStyleDeclaration } from "./css-style.js";
import { wrapCreateImageBitmap } from "./image.js";
import { Touch, touchList } from "./touch.js";
import { createPointerBridge, installPointerCapture, pointerCaptureMethods } from "./pointer.js";

if (!globalThis.__migoWebAdapterInjected) {
  globalThis.__migoWebAdapterInjected = true;

  // 1. Global on-screen canvas. Engines do `document.getElementById('GameCanvas')`
  //    or grab `window.canvas`. Create once, reuse.
  const canvas = new Canvas();
  canvas.id = "GameCanvas";
  globalThis.canvas = canvas;

  // 2. Forward host touch events to the canvas + document + window.
  //    Browsers fire touch events on the target element AND they bubble to
  //    document AND window, so games listen on any of the three. Migo's
  //    globalThis has no native EventTarget, so back `window` with our own.
  const _winTarget = new EventTarget();

  // Dispatch a real (cancelable) Event to canvas + document + window + the
  // `on<type>` sinks engines sometimes set directly. Returns whether a listener
  // called preventDefault() -- real Event objects are required so that call
  // works at all (the previous plain-object spread had no preventDefault, so a
  // touchstart handler calling it threw and was swallowed).
  const _emit = (ev) => {
    ev.target = canvas;
    canvas.dispatchEvent && canvas.dispatchEvent(ev);
    // Bubbling, as a browser does: the canvas's ancestors -- or, for a canvas
    // no one attached, <body> and <html>, where the page's hit test lands --
    // then document and window.
    for (let node = canvas.parentNode || document.body; node; node = node.parentNode) {
      node.dispatchEvent(ev);
    }
    document.dispatchEvent(ev);
    _winTarget.dispatchEvent(ev);
    const sink = document["on" + ev.type];
    if (typeof sink === "function") try { sink(ev); } catch {}
    const wsink = globalThis["on" + ev.type];
    if (typeof wsink === "function") try { wsink(ev); } catch {}
    return ev.defaultPrevented;
  };

  // Pointer events for every contact, ahead of the touch or mouse events of the same contact (pointer.js).
  installPointerCapture(canvas);
  const _pointers = createPointerBridge(_emit, canvas);

  // ---- Touch -> DOM touch events, tracking W3C compat-mouse suppression. ----
  // `_touchCompat` is null when no touch interaction is concurrent; otherwise it
  // is the current interaction's touchstart `defaultPrevented`, which decides
  // whether the paired compatibility mouse events are dropped.
  let _touchCompat = null;
  const _forwardTouch = (type) => (e) => {
    const changed = touchList(canvas, e.changedTouches || e.touches);
    // A cancelled pointerdown stops this contact's compatibility mouse events, like a cancelled touchstart.
    const pointerPrevented = _pointers.touch(type, changed, e.timeStamp);
    const touches = touchList(canvas, e.touches);
    const ev = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches,
      // Every point is on the one canvas the app owns, so each one is also a target touch.
      targetTouches: touches,
      changedTouches: changed,
    });
    ev.timeStamp = e.timeStamp;
    const prevented = _emit(ev);
    if (type === "touchstart") {
      _touchCompat = prevented || pointerPrevented;
    } else if (type === "touchend" || type === "touchcancel") {
      // Keep the flag through the (microtask-deferred) compat-mouse burst, then
      // clear on a macrotask so a later standalone mouse click is not gated.
      setTimeout(() => { _touchCompat = null; }, 0);
    }
  };
  if (typeof migo.onTouchStart === "function") migo.onTouchStart(_forwardTouch("touchstart"));
  if (typeof migo.onTouchMove === "function") migo.onTouchMove(_forwardTouch("touchmove"));
  if (typeof migo.onTouchEnd === "function") migo.onTouchEnd(_forwardTouch("touchend"));
  if (typeof migo.onTouchCancel === "function") migo.onTouchCancel(_forwardTouch("touchcancel"));

  // ---- Mouse -> DOM as W3C compatibility mouse events. ----------------------
  // The embedded layer delivers mouse synchronously but touch on a microtask,
  // so the adapter sees mouse before touch regardless of host send order.
  // Deferring the mouse dispatch by TWO microtasks guarantees it runs after the
  // single-microtask touch drain, so the touchstart's preventDefault is known
  // before we decide whether this compat mouse event is suppressed.
  // `mouseSuppressed`: the contact's pointerdown was cancelled, which stops its mousedown / mousemove / mouseup (the
  // `click` that follows a mouseup is not affected: UI Events, "Mouse events and pointer events").
  const _emitCompatMouse = (type, src, extra, mouseSuppressed) => {
    Promise.resolve().then().then(() => {
      if (_touchCompat === true) return; // paired touch was preventDefault()ed
      if (!mouseSuppressed) {
        const ev = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: src.x,
          clientY: src.y,
          button: src.button,
          buttons: type === "mouseup" ? 0 : 1,
          ...extra,
        });
        ev.timeStamp = src.timeStamp;
        _emit(ev);
      }
      if (type === "mouseup") {
        // DOM fires `click` after `mouseup`; it is part of the same suppressible
        // compat burst, so it only reaches content when the mouse was not dropped.
        const click = new MouseEvent("click", {
          bubbles: true, cancelable: true, clientX: src.x, clientY: src.y, button: src.button,
        });
        click.timeStamp = src.timeStamp;
        _emit(click);
      }
    });
  };
  // The pointer event goes first, synchronously; the compatibility mouse event follows two microtasks later.
  let _mousePointerPrevented = false;
  const _forwardMouse = (type, extra) => (e) => {
    const prevented = _pointers.mouse(type, e);
    if (type === "mousedown") _mousePointerPrevented = prevented;
    const suppressed = _mousePointerPrevented;
    if (type === "mouseup") _mousePointerPrevented = false;
    _emitCompatMouse(type, e, extra && extra(e), suppressed);
  };
  if (typeof migo.onMouseDown === "function") migo.onMouseDown(_forwardMouse("mousedown"));
  if (typeof migo.onMouseMove === "function") migo.onMouseMove(_forwardMouse("mousemove", (e) => ({ movementX: e.movementX, movementY: e.movementY })));
  if (typeof migo.onMouseUp === "function") migo.onMouseUp(_forwardMouse("mouseup"));

  // ---- Wheel -> DOM wheel event (no touch equivalent, no compat gating). ----
  if (typeof migo.onWheel === "function") {
    migo.onWheel((e) => {
      const ev = new WheelEvent("wheel", {
        bubbles: true, cancelable: true,
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      });
      ev.timeStamp = e.timeStamp;
      _emit(ev);
    });
  }

  // Dispatch to document + window + `on<type>` sinks, NOT the canvas: keyboard
  // and IME composition target the document/window, not the drawing surface.
  const _emitDocWin = (ev) => {
    ev.target = document;
    document.dispatchEvent(ev);
    _winTarget.dispatchEvent(ev);
    const sink = document["on" + ev.type];
    if (typeof sink === "function") try { sink(ev); } catch {}
    const wsink = globalThis["on" + ev.type];
    if (typeof wsink === "function") try { wsink(ev); } catch {}
  };

  // ---- Physical keyboard -> DOM keydown/keyup. ------------------------------
  // HTML5 games listen via `window`/`document` addEventListener (WASD, arrows).
  // migo.onKeyDown/onKeyUp already carry DOM `key`/`code`/modifiers.
  const _forwardKey = (type) => (e) => {
    const ev = new KeyboardEvent(type, {
      bubbles: true, cancelable: true,
      key: e.key, code: e.code,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      repeat: e.repeat,
    });
    ev.timeStamp = e.timeStamp;
    _emitDocWin(ev);
  };
  if (typeof migo.onKeyDown === "function") migo.onKeyDown(_forwardKey("keydown"));
  if (typeof migo.onKeyUp === "function") migo.onKeyUp(_forwardKey("keyup"));

  // ---- IME composition -> DOM compositionstart/update/end. ------------------
  // CJK text input reads `event.data` (the running preedit) on these events.
  // migo publishes onComposition* with `{type, data}`.
  const _forwardComposition = (type) => (e) => {
    _emitDocWin(new CompositionEvent(type, { bubbles: true, cancelable: true, data: e.data }));
  };
  if (typeof migo.onCompositionStart === "function") migo.onCompositionStart(_forwardComposition("compositionstart"));
  if (typeof migo.onCompositionUpdate === "function") migo.onCompositionUpdate(_forwardComposition("compositionupdate"));
  if (typeof migo.onCompositionEnd === "function") migo.onCompositionEnd(_forwardComposition("compositionend"));

  // ---- App lifecycle -> DOM Page Visibility (document.hidden + change event). -
  // HTML5 games pause audio and their loop on `visibilitychange` and read
  // `document.hidden`. migo fires onShow/onHide; wire them to the visibility
  // state and event. The state is set BEFORE dispatch so a handler reading
  // `document.hidden` sees the new value, as the spec requires.
  const _setVisibility = (hidden) => {
    document.hidden = hidden;
    document.visibilityState = hidden ? "hidden" : "visible";
    const ev = new Event("visibilitychange", { bubbles: true, cancelable: false });
    ev.target = document;
    document.dispatchEvent(ev);
    if (typeof document.onvisibilitychange === "function") try { document.onvisibilitychange(ev); } catch {}
  };
  if (typeof migo.onHide === "function") migo.onHide(() => _setVisibility(true));
  if (typeof migo.onShow === "function") migo.onShow(() => _setVisibility(false));

  // 2b. Gamepad connection events. Browsers fire these on window only -- not on
  //     document and not on the canvas -- so unlike touch above this routes to
  //     exactly one target.
  connectGamepadEvents((event) => {
    _winTarget.dispatchEvent(event);
    const sink = globalThis["on" + event.type];
    if (typeof sink === "function") try { sink(event); } catch {}
  });

  // 3. Publish the BOM/DOM surface on globalThis. Properties go through
  //    Object.defineProperty so that subsequent assignment by engine code
  //    (e.g. `window.innerWidth = ...`) works (writable: true).
  const surface = {
    // BOM scalars (data values, snapshotted; bom.js refreshes on resize)
    innerWidth: bom.innerWidth, innerHeight: bom.innerHeight,
    outerWidth: bom.outerWidth, outerHeight: bom.outerHeight,
    screenWidth: bom.screenWidth, screenHeight: bom.screenHeight,
    devicePixelRatio: bom.devicePixelRatio,
    screen: bom.screen,
    // Nothing scrolls: the game is the viewport. Engines add these to a touch's page coordinates.
    pageXOffset: 0, pageYOffset: 0, scrollX: 0, scrollY: 0,
    // The page's origin is https://game (origin.js): a secure context, as an https page is. Not cross-origin isolated:
    // no host sends the headers that would make SharedArrayBuffer a page's to use.
    isSecureContext: true, crossOriginIsolated: false,
    scrollTo() {}, scroll() {}, scrollBy() {},
    // The game's window is the focused one while it is shown, so focusing it does nothing and so does blurring it
    // (Excalibur focuses the window when it starts).
    focus() {}, blur() {},
    getComputedStyle,
    // A touch host's window has the touch handlers, as `document` already does here (navigator.maxTouchPoints is 5):
    // `'ontouchstart' in window` is how engines tell a touch screen from a mouse.
    ontouchstart: null, ontouchmove: null, ontouchend: null, ontouchcancel: null,
    // BOM stubs
    navigator, location,
    // DOM
    document,
    // Constructors / classes
    HTMLElement, Element, Node,
    HTMLImageElement, HTMLCanvasElement, HTMLAudioElement,
    HTMLMediaElement, HTMLVideoElement,
    EventTarget, Event, Touch, TouchEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, CompositionEvent, DeviceMotionEvent, GamepadEvent,
    Image, Audio,
    XMLHttpRequest, WebSocket, FileReader,
    localStorage,
    // window EventTarget surface (touch/resize/etc.). Games commonly do
    // `window.addEventListener('touchstart', ...)`.
    addEventListener: (type, listener, opts) => _winTarget.addEventListener(type, listener, opts),
    removeEventListener: (type, listener, opts) => _winTarget.removeEventListener(type, listener, opts),
    dispatchEvent: (event) => _winTarget.dispatchEvent(event),
  };

  // `Intl` is absent under Migo's no-i18n V8; provide the polyfill, but never
  // clobber a real `Intl` (e.g. a future ICU-enabled build or a host browser).
  if (!globalThis.Intl) surface.Intl = Intl;

  // Standard globals a browser has and Migo's V8 does not. Published only when absent, so a host that has the real
  // ones (a browser, Node under test) keeps them.
  if (typeof globalThis.DOMException !== "function") surface.DOMException = DOMException;
  if (typeof globalThis.atob !== "function") surface.atob = atob;
  if (typeof globalThis.btoa !== "function") surface.btoa = btoa;
  // Loaders assume these: TextDecoder for JSON and glTF, Blob and fetch for assets, AbortController for cancelling them.
  // DOMParser and XMLSerializer: Egret builds a parser while its web platform loads; Cocos and Laya read .fnt/.tmx/.plist with them.
  // Worker: PixiJS v8 loads textures through one; three.js's and Babylon's decoders run in one (worker.js).
  // FontFace: PixiJS's web-font loader, and any game that loads a font the way a page does (font-face.js).
  // ReadableStream: a body read as it arrives, and a body made of one (Godot's loader, three.js's FileLoader; streams.js).
  const standard = { CSSStyleDeclaration, TextEncoder, TextDecoder, Blob, File, AbortController, AbortSignal, Headers, Request, Response, fetch, DOMParser, XMLSerializer, Worker, FontFace, FontFaceSet, FontFaceSetLoadEvent, ReadableStream, ReadableStreamDefaultReader, ProgressEvent, ScreenOrientation, ResizeObserver, ResizeObserverEntry, ResizeObserverSize };
  for (const name of Object.keys(standard)) {
    if (typeof globalThis[name] === "undefined") surface[name] = standard[name];
  }
  // matchMedia: Defold's loader watches the pixel ratio through one, and engines size their UI by orientation and width
  // (match-media.js). Answered against this window's metrics.
  if (typeof globalThis.matchMedia !== "function") {
    surface.matchMedia = createMatchMedia(globalThis);
    surface.MediaQueryList = MediaQueryList;
  }
  // crypto.getRandomValues / randomUUID: content calls them synchronously (Emscripten's /dev/urandom and getentropy --
  // Godot's mbedTLS entropy -- uuid, nanoid); the platform's random source answers through a callback, so they come from
  // a ChaCha20 generator keyed from it (crypto.js).
  const random = installCrypto(globalThis);
  if (random) {
    surface.crypto = random.crypto;
    if (typeof globalThis.Crypto === "undefined") surface.Crypto = random.Crypto;
  }
  // AudioWorklet: the platform's WebAudioContext has none; Godot 4's web export loads a processor whatever its audio
  // driver. Run on the runtime's ScriptProcessorNode (audio-worklet.js); AudioWorkletNode is the window global.
  const worklet = installAudioWorklet(globalThis);
  if (worklet.AudioWorkletNode && typeof globalThis.AudioWorkletNode === "undefined") surface.AudioWorkletNode = worklet.AudioWorkletNode;
  // IndexedDB: a Unity build mounts its persistent data path on it (emscripten's IDBFS) and aborts without one; Godot,
  // Construct and localForage keep saves there. Kept in the game's user data (idb/api.js).
  if (typeof globalThis.indexedDB === "undefined") {
    surface.indexedDB = createIndexedDB(fileStorage(globalThis.migo));
    Object.assign(surface, {
      IDBFactory, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBKeyRange,
      IDBRequest, IDBOpenDBRequest, IDBVersionChangeEvent, DOMStringList,
    });
  }
  // `URL.createObjectURL` throws in the runtime's URL; Phaser 3 loads all its images through it. And `createImageBitmap`
  // takes a Blob (Pixi: fetch -> blob -> createImageBitmap).
  installObjectURLs(globalThis.URL);
  if (typeof globalThis.createImageBitmap === "function" && !globalThis.createImageBitmap._migoBlobAware) {
    const wrapped = wrapCreateImageBitmap(globalThis.createImageBitmap);
    wrapped._migoBlobAware = true;
    surface.createImageBitmap = wrapped;
  }

  for (const key of Object.keys(surface)) {
    try {
      Object.defineProperty(globalThis, key, {
        value: surface[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch {
      // some host-defined globals may be non-configurable; skip them.
    }
  }

  // 4. Window self-references that engines depend on, and the global object a Window (window.js).
  if (typeof globalThis.Window !== "function") {
    globalThis.Window = Window;
    adoptWindowPrototype(globalThis);
  }
  if (!globalThis.window) globalThis.window = globalThis;
  if (!globalThis.self) globalThis.self = globalThis;
  if (!globalThis.parent) globalThis.parent = globalThis;
  if (!globalThis.top) globalThis.top = globalThis;

  // 5. addEventListener on the window: route to document.
  if (typeof globalThis.addEventListener !== "function") {
    globalThis.addEventListener = (t, l) => document.addEventListener(t, l);
    globalThis.removeEventListener = (t, l) => document.removeEventListener(t, l);
    globalThis.dispatchEvent = (e) => document.dispatchEvent(e);
  }

  // 6. What the window shows: the canvases in the document (display.js). The page's frame callbacks run here, so the
  //    screen can show a canvas the engine put in the document once they have drawn.
  installDisplay(globalThis, document);
  // A resize of the window is a size an observed element may have changed with (resize-observer.js).
  globalThis.addEventListener("resize", requestResizeCheck);

  // 7. DOM lifecycle events. Browser-targeted engines commonly boot from
  //    `window.addEventListener('load', ...)` or `DOMContentLoaded` (e.g.
  //    Phaser's game entry is `window.addEventListener('load', () => new
  //    Phaser.Game(cfg))`). A real browser fires these AFTER a `<script defer>`
  //    game has run and registered its listeners. The adapter+game prelude runs
  //    in one synchronous turn, so defer to a macrotask — by then the game's
  //    top-level code has registered its listeners. readyState walks
  //    "loading" → "interactive" (DOMContentLoaded) → "complete" (load),
  //    matching the sequence a deferred script observes on the web. Fires once
  //    (the whole block is guarded by `__migoWebAdapterInjected`).
  const _setReadyState = (state) => {
    document.readyState = state;
    const ev = { type: "readystatechange", target: document, currentTarget: document };
    document.dispatchEvent(ev);
    if (typeof document.onreadystatechange === "function") {
      try { document.onreadystatechange(ev); } catch {}
    }
  };
  const _fireDomLifecycle = () => {
    // The document is ready from here: canvases engines create now (Phaser boots on DOMContentLoaded) are
    // display candidates; the ones made while the script loaded were feature probes (document.js).
    document._domReady = true;
    _setReadyState("interactive");
    const domReady = { type: "DOMContentLoaded", target: document, currentTarget: document };
    document.dispatchEvent(domReady);
    _winTarget.dispatchEvent(domReady); // some libs listen for it on window
    _setReadyState("complete");
    const load = { type: "load", target: globalThis, currentTarget: globalThis };
    _winTarget.dispatchEvent(load);     // window 'load' listeners
    document.dispatchEvent(load);        // and document, for engines that listen there
    if (typeof globalThis.onload === "function") { try { globalThis.onload(load); } catch {} }
    if (typeof document.onload === "function") { try { document.onload(load); } catch {} }
  };
  // Defer past the current synchronous turn. Prefer a macrotask (matches the
  // browser, where load is a task, not a microtask); fall back if unavailable.
  if (typeof setTimeout === "function") setTimeout(_fireDomLifecycle, 0);
  else if (typeof queueMicrotask === "function") queueMicrotask(_fireDomLifecycle);
  else Promise.resolve().then(_fireDomLifecycle);
}

export default globalThis;
