# migo-web-adapter

[English](README.md) | [中文](README.zh-CN.md)

A browser-style BOM/DOM adapter layered on top of the [migo](https://github.com/minigame-labs/migo-runtime) mini-game runtime. Lets games written for browser-like environments run on migo, by mapping `window.*`, `document.*`, `Image`, `XMLHttpRequest`, etc. onto the corresponding `migo.*` APIs.

The migo runtime intentionally ships **no BOM/DOM** — it offers only `migo.*` plus standard JavaScript. Browser-style globals are this adapter's job. If your content is wx-shaped instead (calls `wx.*` directly), see [`migo-wx-adapter`](https://github.com/minigame-labs/migo-wx-adapter) — the two compose freely, since they touch disjoint globals.

## When to use

- Your game uses browser globals (`document.createElement`, `new Image()`, `window.innerWidth`, `XMLHttpRequest`, `localStorage`, `WebSocket`, etc.).
- Your engine is built against a browser-like environment (Pixi / Phaser / three.js / Babylon.js / PlayCanvas / a custom WebGL stack: see **Verified engines** below for what has actually been run).
- You want to drop a wx-style game onto migo with minimal changes.

If your game uses only `migo.*` APIs directly (no `window`, no `document`), you don't need this adapter.

## Verified engines

Everything below is run, unmodified, through the real macOS host by the conformance `engines/` suite (pinned versions; scenes that draw known colours and read the pixels back, play taps and drags, load assets from the game package, and play sounds).

| Engine | Version | What is checked |
|---|---|---|
| Pixi | 7.4.3 | rendering (graphics, sprites, text, render textures), ticker, pointer events |
| Phaser | 3.90.0 | rendering, scene input (`pointerdown` at the exact tap), the loader (images, spritesheet, JSON, text, audio, a missing file), a sound to its `complete` event |
| three.js | 0.186.1 | rendering, shadows, MSAA targets, PMREM environments, instancing, skinning, depth textures, multiple render targets, OrbitControls, FileLoader / TextureLoader / AudioLoader / GLTFLoader |
| Babylon.js | 9.29.0 | rendering, a lit scene, dynamic textures, pointer picking |
| PlayCanvas | 2.22.6 | rendering, touch input |
| Howler.js | 2.2.4 | loading, decoding, playing and ending a sound through WebAudio and through an `<audio>` element |
| Egret | 5.4.1 | rendering (shapes, alpha and blend modes, transforms, scroll rects, canvas and file textures, text), XML assets through `DOMParser`, tweens on the frame clock |

Cocos Creator and Laya are **not** in that suite: they ship their own platform glue and have not been verified here, so nothing in this README claims them. Egret runs on macOS and on an iPhone 12 (Performance+); its engine files are not on npm, so the suite pins them by commit and sha256 (`engines/vendor/egret.pin`).

## Install

The adapter is plain ESM source — no build step required.

```js
// game entry, BEFORE the engine boots
import "@minigame-labs/migo-web-adapter";
// or, with a require/AMD loader:
require("./src/index.js");
```

The adapter detects re-entry via `globalThis.__migoWebAdapterInjected` and is safe to import twice.

### Zero-touch testing via runtime boot prelude

If you have a third-party browser-style game that does **not** import this
adapter and you don't want to (or can't) modify its source, the migo runtime
can inject the adapter as a *boot prelude script*. Build the IIFE bundle
once and feed it to the runtime via `InitOptions::with_prelude_script`.

Build the bundle:

```sh
npm run build
# → dist/migo-web-adapter.bundle.js
```

Wire it into the runtime (Rust side, e.g. desktop launcher or Android JNI
bootstrap):

```rust
let bundle = std::fs::read_to_string("path/to/migo-web-adapter.bundle.js")?;
let init = InitOptions::new()
    .with_prelude_script("<migo-web-adapter>", bundle)
    // ... other options
    ;
// then EvaluateModule the game's entry as usual
```

On Android, configure it via `RuntimeConfig.Builder`:

```java
String bundle = readAssetAsString(context, "migo-web-adapter.bundle.js");
RuntimeConfig config = new RuntimeConfig.Builder(context)
        .addPreludeScript("<migo-web-adapter>", bundle)
        .build();
```

Drop `migo-web-adapter.bundle.js` into your app's `assets/` folder so the
host app can read it once at launch and pass the source to the builder.

The prelude runs in the global scope before every `EvaluateModule`, so the
game sees `window.innerWidth`, `document.createElement`, `Image`,
`XMLHttpRequest`, etc. already wired up. Multiple `with_prelude_script`
calls accumulate and execute in declaration order; the same
`__migoWebAdapterInjected` sentinel makes the bundle safe to combine with a
game that *also* imports the ESM entry.

## What gets exposed on `globalThis`

| Category | Names |
|---|---|
| BOM scalars | `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`, `screenWidth`, `screenHeight`, `devicePixelRatio` |
| BOM objects | `screen`, `navigator`, `location`, `document`, `localStorage` |
| Window self-references | `window`, `self`, `parent`, `top`; the global object is a `Window` (`window instanceof Window`, an interface whose constructor throws), with `focus()` / `blur()` that do nothing: the game's window is the focused one |
| Constructors / classes | `Image`, `Audio`, `XMLHttpRequest`, `WebSocket`, `FileReader`, `HTMLElement`, `Element`, `Node`, `Document`, `HTMLDocument` (the document is an `HTMLDocument`; `hidden` and `visibilityState` are getters of `Document.prototype`, as Ebitengine reads them), `EventTarget`, `Event`, `TouchEvent`, `MouseEvent`, `WheelEvent`, `KeyboardEvent`, `CompositionEvent`, `DeviceMotionEvent`, `GamepadEvent`, `HTMLImageElement`, `HTMLCanvasElement`, `HTMLAudioElement`, `HTMLMediaElement`, `HTMLVideoElement` |
| On-screen canvas | `globalThis.canvas` (also `document.getElementById("GameCanvas")`) |
| Audio element | `new Audio(src)` with `canPlayType` answering for what the runtime decodes (PCM WAV, MP3, Ogg Vorbis: `"probably"` / `"maybe"` / `""`), and a `play()` that returns a promise |
| Video element | `document.createElement('video')` is an `HTMLVideoElement` with nothing to play it: `canPlayType` answers `""` for every type, a source fails with `MEDIA_ERR_SRC_NOT_SUPPORTED` (an `error` event after the assignment), and `play()` rejects with `NotSupportedError` -- what a browser says about a format it lacks |
| Worker | `new Worker(url)` for a script this adapter can read -- a `blob:` URL of inline source (PixiJS v8, three.js's and Babylon's decoders build theirs this way), a `data:` URL, or a script in the package -- run on the game's thread in a scope of its own (`self`, `postMessage`, `onmessage`, `addEventListener`, `importScripts`, `close`); messages arrive in a later task, errors reach the worker's `error` event, `terminate()` stops delivery. Not in parallel, and a message is the object sent rather than a clone. Module workers and network scripts are an `error` event |
| Document origin | The game's page sits at the virtual origin `https://game` (`location.origin`; `location.href` and `document.URL` = `https://game/game.js`, absolute as a browser's; `document.baseURI` = `https://game/`), whose root is the package root: a URL on it is a package path for `fetch`, `XMLHttpRequest`, `Image`, `Audio`, `<script>` and `Worker`, never a request to a host called `game` |
| Web fonts | `new FontFace(family, source, descriptors)` -- `source` a CSS `src` list (`url(...) format(...)`, tried in order; `local(...)` skipped) or the font's bytes -- with `load()`, `loaded`, `status`; `document.fonts` (`FontFaceSet`: `add`, `delete`, `has`, `clear`, iteration, `load(font)`, `check(font)`, `ready`, `status`, the `loading` / `loadingdone` / `loadingerror` events). A face registers its font with `migo.loadFont` under its family when it loads (TTF, OTF, WOFF, WOFF2): a package URL by its path, a network, `data:` or `blob:` URL or bytes through a temporary file. A loaded face renders whether or not it is in `document.fonts`, and deleting it does not unregister it |
| Streams | `ReadableStream` (a default reader, an underlying source's start / pull / cancel, `tee`, async iteration) and `Response.body` / `Request.body` as one: a body read as it arrives and a body made of a stream (Godot's web loader, three.js's FileLoader); cloning a streamed body tees it. `ProgressEvent`. `isSecureContext` is true (the page's origin is `https://game`), `crossOriginIsolated` false |
| Audio worklet | `AudioContext.audioWorklet.addModule(url)` (a package path, `blob:` or `data:` URL) with `registerProcessor`, `AudioWorkletProcessor` and the scope's `sampleRate` / `currentFrame` / `currentTime`; `new AudioWorkletNode(context, name, options)` with its `port` (messages delivered on a microtask) and `parameters` (k-rate). Processors run on the game's thread over the runtime's `ScriptProcessorNode`, 128-frame quanta cut from its blocks: one input and one output at most. Godot 4's web export loads its audio this way |
| Random values | `crypto.getRandomValues(integerTypedArray)` (at most 65536 bytes; `TypeMismatchError` / `QuotaExceededError` as the Web Crypto API says) and `crypto.randomUUID()`, synchronous, from a ChaCha20 generator (RFC 8439, fast key erasure) keyed by 32 bytes of the platform's random source. That source answers through a callback: the key is asked for when the adapter loads and is there before the game's next task, and a call in the same task as the adapter's load throws `InvalidStateError` rather than return weaker bytes. Emscripten's `/dev/urandom` and `getentropy` (Godot's mbedTLS) read it. No `crypto.subtle` |
| Loading | `XMLHttpRequest` (async) and `fetch` / `Headers` / `Request` / `Response` over three kinds of URL: the network (`migo.request`), `data:` and `blob:` URLs, and **the game package** -- a relative path (`assets/a.json`, `./a.png?v=3`) or an origin-relative one (`/assets/a.json`) is a file in the package, a missing one is a completed request with status 404. `Blob` / `File`, `URL.createObjectURL` (an `Image` can load one), `createImageBitmap(blob)`, `FileReader`, `TextEncoder` / `TextDecoder` (UTF-8, UTF-16LE, windows-1252, GBK), `AbortController` / `AbortSignal`; `EventTarget` takes `once`, `signal` and `handleEvent` objects. A `fetch` response has no `body` stream, which is how streaming readers detect that they must read the whole body |
| DOM pointer | `PointerEvent` (`pointerId`, `pointerType`, `isPrimary`, `pressure`, `width/height`, ...); `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture` |
| DOM touch | `Touch` (`identifier`, `target`, `clientX/Y`, `pageX/Y`, `screenX/Y`, `radiusX/Y`, `rotationAngle`, `force`); `TouchEvent.touches` / `targetTouches` / `changedTouches` are lists with `item(i)` |
| XML | `DOMParser` and `XMLSerializer`, for XML (`text/xml`, `application/xml`, `application/xhtml+xml`, `image/svg+xml`): a document, elements with attributes and namespaces, text, CDATA, comments and processing instructions; a document that is not well-formed answers a `<parsererror>` root, as browsers do. `text/html` is refused (`NotSupportedError`). Egret builds a parser while it loads and reads every XML asset with it; Cocos and Laya read `.fnt`, `.tmx` and `.plist` with the same pair |
| Scripts | `<script src>` for a script in the package runs as HTML runs a script element: one that cannot be read fires `error` and runs nothing; one that throws has its exception reported and still fires `load`; a handler or listener that throws is reported. A listener's exception, anywhere in the adapter, is reported through the runtime's `reportError` -- the game's `onError` hears it, as a page's `window.onerror` would -- and the listeners after it still run |
| IndexedDB | `indexedDB` (`open` with versions, `upgradeneeded` and `blocked`, `deleteDatabase`, `databases`, `cmp`) and `IDBDatabase`, `IDBTransaction`, `IDBObjectStore`, `IDBIndex` (unique, multiEntry), `IDBCursor` / `IDBCursorWithValue` (every direction, `continue`, `continuePrimaryKey`, `advance`, `update`, `delete`), `IDBKeyRange`, `IDBRequest`, `IDBVersionChangeEvent`: values kept as their structured serialisation (a read is a new copy), keys ordered as the specification orders them, key generators, errors that abort the transaction and undo it unless cancelled. Transactions run one at a time per database, in order; each is active in the task that made it and in its requests' events. A database is kept in the game's user data (`<USER_DATA_PATH>/.indexeddb/`), written after each transaction that changed it commits, renamed over the old file. A Unity build mounts its persistent data path on it (emscripten's IDBFS) and aborts without one |
| Resize observer | `ResizeObserver` (`observe` with a `box`, `unobserve`, `disconnect`), `ResizeObserverEntry` (`contentRect`, `contentBoxSize`, `borderBoxSize`, `devicePixelContentBoxSize`): delivered after a frame's animation callbacks and before it is painted, from each element's layout box (a canvas's CSS box -- `style.width` / `height`, else its own size -- any other element's `getBoundingClientRect()`); an element is reported when it is observed with a size and each time the size changes; a window resize asks for a check. Kaplay and Excalibur size their view from one |
| Intersection observer | `IntersectionObserver` (`root`, `rootMargin` in px or %, `threshold`; `observe`, `unobserve`, `disconnect`, `takeRecords`) and `IntersectionObserverEntry`: computed in the frame's rendering step after the resize observations, from each element's layout box against the viewport; an element out of the document or not displayed is not intersecting; the first step after `observe()` reports it, and records are delivered in a task. winit (Bevy's window layer) watches its canvas with one |
| Images as elements | `new Image()` is an element with attributes (`setAttribute` / `getAttribute` / `removeAttribute` / `hasAttribute` / `getAttributeNames`; `src`, `id`, `class`, `crossorigin` and `data-*` reflected) and an `HTMLImageElement` to `instanceof`. Excalibur keeps an image's filtering and wrapping as attributes |
| Screen orientation | `screen.orientation` is a `ScreenOrientation`: an `EventTarget` whose `type` follows the window and whose `angle` is from the device's natural orientation (portrait on a phone or tablet, landscape on a desktop), a `change` event when the window turns, `lock()` a `NotSupportedError` (the platform locks orientation, not a page) and `unlock()` nothing |
| HTML fragments | `element.insertAdjacentHTML(position, markup)` (and a canvas's), `insertAdjacentElement`, `insertAdjacentText`, at `beforebegin` / `afterbegin` / `beforeend` / `afterend`: the markup a page's scripts write at run time -- elements with attributes, text, character references, comments, void and raw-text elements -- made into this adapter's elements; a `<script>` inserted as markup never runs, as in a browser. Not the HTML Standard's tree construction (no error recovery or implied end tags). Defold's loader puts its progress bar after the canvas this way |
| Media queries | `window.matchMedia(query)` and `MediaQueryList` (`matches`, `media`, `change` through `onchange`, `addEventListener` and the legacy `addListener`): Media Queries Level 4's lists, `not` / `only`, media types, `and` / `or`, the `min-` / `max-` and range forms, answered against this window -- `width` / `height` in CSS pixels, `resolution` (`devicePixelRatio`), `orientation`, hover and pointer from `navigator.maxTouchPoints`, light colours, no reduced-motion preference. A query that does not parse or names an unknown feature matches nothing (`not all`). Defold's loader watches the pixel ratio with one |
| Inline style | `element.style` (and a canvas's, and `document.style`) is a `CSSStyleDeclaration`: properties by name as before (`style.width = "100%"`), plus `setProperty(name, value, priority)` with CSS names and custom properties (`--width`), `getPropertyValue`, `removeProperty`, `getPropertyPriority`, `cssText` (read and replace), `length`, `item`, iteration. `setAttribute("style", ...)` replaces the inline style. No cascade: `getComputedStyle` reports the inline style over the one layout |
| Standard globals Migo's V8 lacks | `atob`, `btoa` (HTML Standard base64, `InvalidCharacterError` on bad input), `DOMException` (name, message, legacy `code`). Published only when the host has none of its own |

## Mapping to `migo.*`

| Browser API | migo runtime call |
|---|---|
| `window.innerWidth` / `screen.width` / `devicePixelRatio` | `migo.getWindowInfo()` (one-shot snapshot at adapter load; assignment persists, host resize does NOT overwrite — see "BOM semantics" below) |
| `navigator.userAgent` / `navigator.platform` | derived from `migo.getSystemInfoSync()` |
| `document.createElement('canvas')` / `new Canvas()` | `migo.createCanvas()` |
| `document.createElement('img')` / `new Image()` | `migo.createImage()` |
| `new Audio(src)` | `migo.createInnerAudioContext()` |
| `localStorage.{getItem, setItem, removeItem, clear}` | `migo.{get, set, remove, clear}StorageSync` |
| `new XMLHttpRequest()` | `migo.request()` |
| `new WebSocket(url)` | `migo.connectSocket()` |
| `new FontFace(...).load()` / `document.fonts.load(font)` | `migo.loadFont()` |
| `audioWorklet` / `AudioWorkletNode` | `AudioContext.createScriptProcessor()` |
| `crypto.getRandomValues` / `crypto.randomUUID` | keyed once from `migo.getUserCryptoManager().getRandomValues()` |
| `addEventListener('touchstart' …)` on `window`, `document`, `canvas` | `migo.onTouchStart` / `onTouchMove` / `onTouchEnd` / `onTouchCancel` |
| `addEventListener('mousedown' / 'mousemove' / 'mouseup' / 'click')` on `window`, `document`, `canvas` | `migo.onMouseDown` / `onMouseMove` / `onMouseUp`, synthesized as W3C touch-compatibility mouse events (suppressed when the paired touch called `preventDefault()`) |
| `addEventListener('wheel')` on `window`, `document`, `canvas` | `migo.onWheel` |
| `addEventListener('keydown' / 'keyup')` on `window`, `document` | `migo.onKeyDown` / `migo.onKeyUp` |
| `addEventListener('compositionstart' / 'compositionupdate' / 'compositionend')` on `window`, `document` | `migo.onCompositionStart` / `onCompositionUpdate` / `onCompositionEnd` (IME) |
| `document.hidden` / `addEventListener('visibilitychange')` | `migo.onShow` / `migo.onHide` |
| `navigator.getGamepads()` | `migo.getGamepads()` — forwarded directly, so the returned pads keep their identity between frames |
| `addEventListener('gamepadconnected' / 'gamepaddisconnected')` on `window` | `migo.onGamepadConnected` / `migo.onGamepadDisconnected` |

## Which canvas is shown

Migo presents exactly one canvas: `globalThis.canvas` (also `document.getElementById("GameCanvas")`), the first canvas the runtime creates. Anything drawn on another canvas is an offscreen buffer nobody sees, which is what a browser tutorial's `document.body.appendChild(canvas)` does not tell the engine.

- **Code that runs once the document is ready** (DOMContentLoaded or later: Phaser boots there, and so does anything in a `load` handler): the first canvas the engine creates with `document.createElement('canvas')`, while the onscreen one is still unclaimed (no context, and not sized by the page: one the page set a `width` or `height` on it has handed to its engine) and the page has no canvas of its own in its document yet, *is* the onscreen canvas. A default Phaser game just works. A page that already shows a canvas has its display canvas, and a canvas it makes later is a probe or a buffer: Defold's loader checks for WebGL with one once its assets have arrived, and handed the screen it would have held its context and kept the page's canvas off it.
- **Code that runs while the script loads** (top level): canvases made then are treated as feature probes and are offscreen. A canvas made then and **put in the document** is shown all the same: at the end of every animation frame in which the document holds canvases and the screen is not one of them, the screen shows them, in document order, each drawn into its CSS box (`style.width` / `height` in px, %, vw or vh, else its own size; `left` / `top` and margins; `opacity`; `display: none` and `visibility: hidden` hide it). That is PixiJS v8's shape -- `await app.init()` makes and initialises the renderer's canvas before DOMContentLoaded, then `document.body.appendChild(app.canvas)` -- and an unmodified PixiJS v8 game shows this way. The runtime copies a WebGL canvas for this on the GPU, so it costs a blit and a draw per frame; a game that runs its frames from a timer rather than `requestAnimationFrame` is not composited. To skip the copy, pass the canvas Migo shows, which is one line per engine and is what the [conformance `engines/` suite](https://github.com/minigame-labs/migo-conformance/tree/master/engines) runs:

```js
const canvas = globalThis.canvas;                                  // the one that is presented
new Phaser.Game({ type: Phaser.WEBGL, canvas, width: canvas.width, height: canvas.height, scene });
new PIXI.Application({ view: canvas, width: canvas.width, height: canvas.height });
new THREE.WebGLRenderer({ canvas });
new BABYLON.Engine(canvas, true);
new pc.Application(canvas, { graphicsDeviceOptions: { deviceTypes: ['webgl2'] } });
```

Egret makes its own canvas, and probes for WebGL on one of its own first, which the adapter would back with the presented surface before the engine's real one is made. Its own extension point for a platform that already has a screen is `egret.sys.mainCanvas`; claim the context first, with what Egret asks for (a stencil, for masks):

```js
canvas.getContext('webgl', { antialias: false, stencil: true });
egret.sys.mainCanvas = () => canvas;
egret.runEgret({ renderMode: 'webgl' });       // from DOMContentLoaded, as an index.html does
```

Touches reach the canvas, `document` and `window` as DOM `TouchEvent`s whose `Touch` objects have a `target` (the canvas), `screenX/Y` and the contact ellipse; Phaser's scene-level `input.on('pointerdown')` depends on that `target`.

**Pointer Events.** `PointerEvent` exists, and every touch and mouse event is preceded by its pointer event, in the order the specification gives (`pointerover`, `pointerenter`, `pointerdown`, then `touchstart`/`mousedown`; `pointermove`; `pointerup`, `pointerout`, `pointerleave`; `pointercancel`). A touch is `pointerType: "touch"` with id = the host's identifier + 2 and the first contact down is primary; a mouse is pointer 1. Cancelling a `pointerdown` stops that contact's compatibility mouse events (not the `click`), as in a browser. `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture` work on every element (capture ends with the contact). Babylon.js and three.js's OrbitControls listen to pointer events and nothing else; Pixi switches to them when `PointerEvent` exists. The canvas also gets the element members a browser canvas always has (`focus`, `blur`, `tagName`, `ownerDocument`, `isConnected`, ...), because Babylon's pointer-down handler ends with `canvas.focus()`; what Migo cannot do (`requestPointerLock`, `requestFullscreen`) stays absent so feature detection is honest.

## BOM semantics

`window.innerWidth`, `innerHeight`, `screen`, `devicePixelRatio` etc. are **one-shot snapshots** of the host window metrics at adapter load time, exposed as plain writable data properties on `globalThis`. This matches the canonical mini-game adapter, and differs from a real browser:

- ✅ `window.innerWidth = X` works and persists.
- ✅ The values are correct for whatever screen the game launched on.
- ❌ The adapter does **not** subscribe to host resize events — if the window resizes (orientation change, foldable expand, IME open), `window.innerWidth` does **not** auto-update.

Games that need live metrics should call `migo.getWindowInfo()` directly (e.g. on a resize listener of their own, or every frame). The adapter intentionally stays out of the way so engine-internal layout caches don't race with adapter writes.

## What this adapter is NOT

- **A full DOM**. We provide a base `Node`/`Element`/`HTMLElement` tree deep enough for what engines and their pages do with one -- `appendChild`, `parentNode` / `parentElement`, `setAttribute`, the lookups by tag, class, id and selector, HTML fragments through `insertAdjacentHTML` -- with no layout engine behind it and no parser for a whole HTML document.
- **A full browser networking stack**. `XMLHttpRequest` and `WebSocket` cover the common engine code paths but skip CORS, cookies, response streaming, `Blob`, and `FormData`.
- **A full WebAudio**. `new Audio(src)` is bridged to `migo.createInnerAudioContext`. The `AudioContext` graph (oscillators, filters, etc.) is provided by the migo runtime directly under `globalThis.AudioContext`, not by this adapter.
- **A real `FileReader`**. We support `readAsText`/`readAsArrayBuffer`/`readAsDataURL` against simple inputs (`string`, `ArrayBuffer`). No `Blob` streaming.

If you need any of the above, extend the adapter — the source is small, ESM, and dependency-free.

## Layout

```
src/
  index.js          entry — wires everything onto globalThis
  bom.js            innerWidth / innerHeight / screen / devicePixelRatio
  gamepad.js        W3C Gamepad API over the migo gamepad transport
  navigator.js      navigator stub
  location.js       the page's location (absolute, on the game's origin)
  document.js       document object (createElement, getElementById, …)
  element.js        Node / Element / HTMLElement and tag-specific subclasses
  report.js         HTML's report-the-exception, through the runtime's reportError
  screen-orientation.js  screen.orientation
  idb/              IndexedDB: keys.js (keys, key paths, ranges), clone.js (structured serialisation), api.js
  event-target.js   EventTarget base class
  events.js         Event / TouchEvent / MouseEvent / WheelEvent / KeyboardEvent / CompositionEvent / DeviceMotionEvent
  image.js          Image() constructor → migo.createImage
  canvas.js         Canvas() constructor → migo.createCanvas
  audio.js          Audio() constructor → migo.createInnerAudioContext
  local-storage.js  localStorage on top of migo.*StorageSync
  xhr.js            XMLHttpRequest on top of migo.request
  websocket.js      WebSocket on top of migo.connectSocket
  file-reader.js    FileReader simple impl
  intl.js           minimal Intl polyfill (published only when globalThis.Intl is absent)
  dom-parser.js     DOMParser / XMLSerializer for XML (a well-formedness-checking parser; a parsererror document on failure)
scripts/
  build-bundle.mjs  esbuild → dist/migo-web-adapter.bundle.js (IIFE; for prelude injection)
tests/
  adapter.test.mjs             Node simulation against a fake migo runtime
  gamepad.test.mjs             W3C Gamepad API against the REAL runtime transport (read from the engine source at test time)
  bundle.test.mjs              IIFE bundle smoke-tested in a vm.Context
  pointer-compat.test.mjs      touch + W3C compatibility-mouse event forwarding
  keyboard-events.test.mjs     physical keyboard -> DOM keydown/keyup forwarding
  composition-events.test.mjs  IME composition -> DOM compositionstart/update/end forwarding
  visibility-events.test.mjs   app lifecycle -> DOM Page Visibility (document.hidden, visibilitychange)
  document-interface.test.mjs  Document / HTMLDocument: the document's interfaces, the visibility getters on Document.prototype
  dom-parser.test.mjs          XML trees, entities, namespaces, parsererror documents, serialization (cross-checked against jsdom)
```

## Running tests

```sh
node tests/adapter.test.mjs
node tests/gamepad.test.mjs
node tests/bundle.test.mjs
node tests/pointer-compat.test.mjs
node tests/keyboard-events.test.mjs
node tests/composition-events.test.mjs
node tests/visibility-events.test.mjs
# or, all seven at once — `npm test` also rebuilds dist/migo-web-adapter.bundle.js
# first via the `pretest` script
npm test
```

`adapter.test.mjs` stubs `globalThis.migo` with a fake runtime, imports the
adapter, and asserts BOM/DOM/event/network behavior end-to-end; the other ESM
tests each drive one behavior area (gamepad, pointer/mouse compatibility,
keyboard, IME composition, page visibility) the same way. `bundle.test.mjs`
re-runs a focused subset against `dist/migo-web-adapter.bundle.js` inside a
`vm.Context` to confirm the IIFE injects the same surface.

## License

MIT
