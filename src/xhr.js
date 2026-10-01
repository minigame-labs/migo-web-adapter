// XMLHttpRequest, over resource.js: the network (`migo.request`), data: URLs and the game package (a relative path is a
// file in the package, the origin being the package). Asynchronous only -- there is no way to block a Migo script on I/O.
//
// Events fire the way a browser's do, to both the `on<type>` property and the listeners: readystatechange at each state,
// loadstart, progress, then load (or error / abort / timeout) and loadend. A response with a 404 status is a `load`: the
// request completed and the status says what came back, which is what loaders check.

import EventTarget from "./event-target.js";
import DOMException from "./dom-exception.js";
import { TextDecoder } from "./text-codec.js";
import { Blob } from "./blob.js";
import { loadResource, statusText } from "./resource.js";

const UNSENT = 0, OPENED = 1, HEADERS_RECEIVED = 2, LOADING = 3, DONE = 4;

const exception = (message, name) => new (globalThis.DOMException || DOMException)(message, name);

function charsetOf(contentType) {
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType || "");
  return match ? match[1] : "utf-8";
}

export default class XMLHttpRequest extends EventTarget {
  constructor() {
    super();
    this._method = "GET";
    this._url = "";
    this._requestHeaders = {};
    this._sent = false;
    this._load = null;
    this._responseHeaders = {};
    this._mimeOverride = null;

    this.readyState = UNSENT;
    this.status = 0;
    this.statusText = "";
    this.response = "";
    this.responseText = "";
    this.responseURL = "";
    this.responseType = ""; // "" | "text" | "arraybuffer" | "json" | "blob" | "document"
    this.timeout = 0;
    this.withCredentials = false;
    this.upload = new EventTarget();
    this.onreadystatechange = null;
    this.onloadstart = null;
    this.onprogress = null;
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this.onabort = null;
    this.onloadend = null;
  }

  _fire(type, extra) {
    const event = { type, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0, defaultPrevented: false, preventDefault() {}, stopPropagation() {}, ...extra };
    const handler = this["on" + type];
    if (typeof handler === "function") {
      try { handler.call(this, event); } catch (e) { try { console.error(e); } catch (_) { /* best effort */ } }
    }
    this.dispatchEvent(event);
  }

  _setReady(state) {
    this.readyState = state;
    this._fire("readystatechange");
  }

  open(method, url, async = true) {
    if (async === false) {
      throw exception("Synchronous XMLHttpRequest is not supported: a script cannot block on I/O here.", "InvalidAccessError");
    }
    if (this._load) { this._load.abort(); this._load = null; }
    this._method = String(method).toUpperCase();
    this._url = String(url);
    this._requestHeaders = {};
    this._responseHeaders = {};
    this._sent = false;
    this.status = 0;
    this.statusText = "";
    this.response = "";
    this.responseText = "";
    this.responseURL = "";
    this._setReady(OPENED);
  }

  setRequestHeader(name, value) {
    if (this.readyState !== OPENED || this._sent) throw exception("The object's state must be OPENED.", "InvalidStateError");
    const key = String(name);
    const lower = key.toLowerCase();
    for (const existing of Object.keys(this._requestHeaders)) {
      if (existing.toLowerCase() === lower) {
        this._requestHeaders[existing] += ", " + String(value);
        return;
      }
    }
    this._requestHeaders[key] = String(value);
  }

  overrideMimeType(type) { this._mimeOverride = String(type); }

  getResponseHeader(name) {
    if (this.readyState < HEADERS_RECEIVED) return null;
    const value = this._responseHeaders[String(name).toLowerCase()];
    return value === undefined ? null : value;
  }

  getAllResponseHeaders() {
    if (this.readyState < HEADERS_RECEIVED) return "";
    return Object.keys(this._responseHeaders).map((key) => `${key}: ${this._responseHeaders[key]}\r\n`).join("");
  }

  abort() {
    const pending = this._sent && this.readyState !== DONE && this._load;
    if (pending) {
      this._load.abort();
      this._load = null;
      this._sent = false;
      this.status = 0;
      this.statusText = "";
      this._setReady(DONE);
      this._fire("abort");
      this._fire("loadend");
    }
    this.readyState = UNSENT;
  }

  send(body) {
    if (this.readyState !== OPENED || this._sent) throw exception("The object's state must be OPENED.", "InvalidStateError");
    this._sent = true;
    const method = this._method;
    const sendBody = method === "GET" || method === "HEAD" ? undefined : body;
    this._fire("loadstart");
    const load = loadResource({ url: this._url, method, headers: this._requestHeaders, body: sendBody, timeout: this.timeout });
    this._load = load;
    load.promise.then(
      (res) => { if (this._load === load) this._complete(res); },
      (failure) => { if (this._load === load) this._fail(failure); },
    );
  }

  _complete(res) {
    this._load = null;
    this.status = res.status;
    this.statusText = res.statusText || statusText(res.status);
    this.responseURL = res.url;
    this._responseHeaders = res.headers;
    this._setReady(HEADERS_RECEIVED);
    this._setReady(LOADING);
    const total = res.body.byteLength;
    this._fire("progress", { lengthComputable: true, loaded: total, total });
    this._decode(res);
    this._setReady(DONE);
    this._fire("load", { lengthComputable: true, loaded: total, total });
    this._fire("loadend", { lengthComputable: true, loaded: total, total });
  }

  _decode(res) {
    const contentType = this._mimeOverride || res.headers["content-type"] || "";
    const decodeText = () => {
      let label = charsetOf(contentType);
      try { return new TextDecoder(label).decode(res.body); } catch (_) { return new TextDecoder("utf-8").decode(res.body); }
    };
    switch (this.responseType) {
      case "arraybuffer":
        this.response = res.body;
        this.responseText = "";
        break;
      case "blob":
        this.response = new Blob([res.body], { type: contentType.split(";")[0].trim() });
        this.responseText = "";
        break;
      case "json": {
        this.responseText = "";
        try { this.response = JSON.parse(decodeText()); } catch (_) { this.response = null; }
        break;
      }
      case "document":
        this.response = null;
        this.responseText = "";
        break;
      default:
        this.responseText = decodeText();
        this.response = this.responseText;
    }
  }

  _fail(failure) {
    this._load = null;
    this.status = 0;
    this.statusText = "";
    this._setReady(DONE);
    const kind = failure && failure.kind;
    if (kind === "timeout") this._fire("timeout");
    else if (kind === "abort") this._fire("abort");
    else this._fire("error", { error: failure && failure.error });
    this._fire("loadend");
  }
}
for (const [name, value] of [["UNSENT", UNSENT], ["OPENED", OPENED], ["HEADERS_RECEIVED", HEADERS_RECEIVED], ["LOADING", LOADING], ["DONE", DONE]]) {
  Object.defineProperty(XMLHttpRequest, name, { value, enumerable: true });
  Object.defineProperty(XMLHttpRequest.prototype, name, { value, enumerable: true });
}
