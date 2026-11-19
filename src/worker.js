// Worker — a Web Worker made from a script this adapter can read: a `blob:` URL (URL.createObjectURL of the script's
// source, as PixiJS v8, three.js's DRACO and KTX2 decoders and Babylon.js build theirs), a `data:` URL, or a script in
// the game package. The runtime starts a worker only from a file in the game's declared workers directory
// (`migo.createWorker`), and a worker built from source has no such file, so this one runs its script on the game's
// thread, in a scope of its own: `self`, `postMessage`, `onmessage`, `addEventListener`, `importScripts` and `close`
// are the worker's, everything else is the game's globals -- which is what a worker's code reads (fetch,
// createImageBitmap, setTimeout).
//
// What a script sees is a dedicated worker's contract, with one difference that it cannot observe: it does not run in
// parallel. Messages in either direction arrive in a later task, never during the call that sent them; an exception in
// the script reaches the worker's `error` event, not the caller; `terminate()` stops delivery both ways. A message is
// handed over as the object sent rather than as a structured clone -- one thread, so a transferred ImageBitmap stays
// usable, which a clone of one here would not.
//
// PixiJS v8 loads every texture through a worker by default: with no Worker it threw a ReferenceError inside its
// loader and a game's first asset bundle never loaded.

import { resolveBlobURL } from "./blob-url.js";
import { decodeDataUrl, packagePath } from "./resource.js";
import { withinPackage } from "./origin.js";
import EventTarget from "./event-target.js";

function decodeUtf8(bytes) {
  if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes);
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(text));
}

/// The source of the script `url` names, or a thrown Error saying why there is none.
function readScript(url) {
  const text = withinPackage(String(url));
  if (/^blob:/i.test(text)) {
    const blob = resolveBlobURL(text);
    if (!blob) throw new Error(`the blob URL ${text} was revoked or is not known`);
    return decodeUtf8(blob._bytes);
  }
  if (/^data:/i.test(text)) {
    const parsed = decodeDataUrl(text);
    if (!parsed) throw new Error("the data URL is malformed");
    return decodeUtf8(parsed.bytes);
  }
  if (/^([a-z][a-z0-9+.\-]*:)?\/\//i.test(text)) throw new Error(`a worker script from the network (${text}) is not loaded`);
  const fs = typeof migo !== "undefined" && typeof migo.getFileSystemManager === "function" ? migo.getFileSystemManager() : null;
  if (!fs || typeof fs.readFileSync !== "function") throw new Error("no file system manager to read the worker script");
  return fs.readFileSync(packagePath(text), "utf8");
}

const later = (fn) => setTimeout(fn, 0);

function fire(target, event) {
  const handler = target["on" + event.type];
  if (typeof handler === "function") {
    try { handler.call(target, event); } catch (error) { console.error("[migo-web-adapter] worker handler threw:", error); }
  }
  target.dispatchEvent(event);
}

export default class Worker extends EventTarget {
  constructor(url, options = {}) {
    super();
    this.onmessage = null;
    this.onmessageerror = null;
    this.onerror = null;
    this._closed = false;
    if (options && options.type === "module") {
      // A module worker's `import` statements need a module loader this scope does not have.
      this._fail(new Error("a module worker (type: 'module') is not supported"));
      return;
    }
    let source;
    try {
      source = readScript(url);
    } catch (error) {
      this._fail(error);
      return;
    }
    this._scope = this._makeScope(String(url));
    // Run the script after the constructor returns, as a browser starts a worker: the caller sets onmessage and posts
    // its first message first.
    later(() => this._run(source));
  }

  postMessage(data, _transfer) {
    if (this._closed || !this._scope) return;
    const scope = this._scope;
    later(() => { if (!this._closed) fire(scope, { type: "message", data, target: scope, currentTarget: scope }); });
  }

  terminate() {
    this._closed = true;
  }

  _fail(error) {
    this._closed = true;
    later(() => fire(this, { type: "error", message: String(error && error.message ? error.message : error), error, target: this, currentTarget: this }));
  }

  _makeScope(href) {
    const worker = this;
    const scope = new EventTarget();
    scope.onmessage = null;
    scope.onmessageerror = null;
    scope.onerror = null;
    scope.self = scope;
    scope.location = { href, toString() { return href; } };
    scope.navigator = globalThis.navigator;
    scope.postMessage = (data, _transfer) => {
      if (worker._closed) return;
      later(() => { if (!worker._closed) fire(worker, { type: "message", data, target: worker, currentTarget: worker }); });
    };
    scope.close = () => { worker._closed = true; };
    scope.importScripts = (...urls) => {
      for (const url of urls) worker._evaluate(readScript(url));
    };
    return scope;
  }

  // The script with the scope's names in front of the game's: `onmessage = ...` and `postMessage(...)` written bare
  // reach the worker's, `fetch(...)` the game's. A `with` block is what gives a script that lookup order; it is why the
  // function is sloppy-mode, and a "use strict" at the top of the script is then a string, as it would be in a block.
  _evaluate(source) {
    const run = new Function("__migoWorkerScope", "with (__migoWorkerScope) {\n" + source + "\n}");
    run.call(this._scope, this._scope);
  }

  _run(source) {
    if (this._closed) return;
    try {
      this._evaluate(source);
    } catch (error) {
      console.error("[migo-web-adapter] worker script threw:", error);
      fire(this, { type: "error", message: String(error && error.message ? error.message : error), error, target: this, currentTarget: this });
    }
  }
}
