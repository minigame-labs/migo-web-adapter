// `fetch`, with `Headers`, `Request` and `Response`, over resource.js: the network, data: URLs and the game package.
//
// A Response's body is held as bytes (an ArrayBuffer), so `arrayBuffer()`, `text()`, `json()` and `blob()` are what
// they are in a browser. `body` is a ReadableStream (streams.js) of those bytes, made when it is first asked for, and a
// body can also be a ReadableStream of the page's own -- the pair a loader that shows progress uses: read
// `response.body`, hand on `new Response(new ReadableStream(...))` (Godot's web loader, three.js's FileLoader). A body
// read through its stream is used, as in a browser; cloning a streamed body tees its stream. HTTP error statuses resolve
// -- `ok` is false and `status` says which -- and only a request that could not be made at all rejects, with the
// TypeError a browser gives.

import { Blob } from "./blob.js";
import { TextDecoder } from "./text-codec.js";
import DOMException from "./dom-exception.js";
import { loadResource, statusText } from "./resource.js";
import { ReadableStream, readAllBytes, streamOfBytes } from "./streams.js";

const exception = (message, name) => new (globalThis.DOMException || DOMException)(message, name);

const lowerName = (name) => {
  const text = String(name);
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(text)) throw new TypeError(`Failed to execute 'Headers': Invalid name '${text}'`);
  return text.toLowerCase();
};

export class Headers {
  constructor(init) {
    this._map = new Map();
    if (init instanceof Headers) {
      for (const [name, value] of init) this.append(name, value);
    } else if (Array.isArray(init)) {
      for (const pair of init) {
        if (!pair || pair.length !== 2) throw new TypeError("Failed to construct 'Headers': Invalid value");
        this.append(pair[0], pair[1]);
      }
    } else if (init && typeof init === "object") {
      for (const name of Object.keys(init)) this.append(name, init[name]);
    }
  }
  append(name, value) {
    const key = lowerName(name);
    const text = String(value).trim();
    this._map.set(key, this._map.has(key) ? this._map.get(key) + ", " + text : text);
  }
  set(name, value) { this._map.set(lowerName(name), String(value).trim()); }
  get(name) { const key = lowerName(name); return this._map.has(key) ? this._map.get(key) : null; }
  has(name) { return this._map.has(lowerName(name)); }
  delete(name) { this._map.delete(lowerName(name)); }
  forEach(callback, thisArg) { for (const [name, value] of this) callback.call(thisArg, value, name, this); }
  *entries() { for (const key of [...this._map.keys()].sort()) yield [key, this._map.get(key)]; }
  *keys() { for (const [key] of this.entries()) yield key; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}

function bodyBytes(body) {
  if (body === undefined || body === null) return null;
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  if (body instanceof Blob) return body._bytes.slice();
  return null;
}

const isStream = (body) => body instanceof ReadableStream || (body !== null && typeof body === "object" && typeof body.getReader === "function");

// The mixin: body / bodyUsed / arrayBuffer / text / json / blob over `this._bytes` -- or, once the body is a stream (one
// the page gave, or `body` asked for), over `this._stream`.
class Body {
  _initBody(body, contentType) {
    this._used = false;
    this._stream = null;
    this._nullBody = body === undefined || body === null;
    if (this._nullBody) {
      this._bytes = new Uint8Array(0);
      return contentType;
    }
    if (isStream(body)) {
      this._bytes = null;
      this._stream = body;
      return contentType;
    }
    const bytes = bodyBytes(body);
    if (bytes) {
      this._bytes = bytes;
      return contentType || (body instanceof Blob && body.type ? body.type : null);
    }
    const text = String(body);
    const encoded = new Blob([text])._bytes;
    this._bytes = encoded;
    return contentType || "text/plain;charset=UTF-8";
  }
  get body() {
    if (this._nullBody) return null;
    if (this._stream === null) {
      // From here on the bytes are the stream's: read through it, or through arrayBuffer() and the rest, once.
      this._stream = streamOfBytes(this._used ? new Uint8Array(0) : this._bytes);
      this._bytes = null;
    }
    return this._stream;
  }
  get bodyUsed() { return this._used || (this._stream !== null && this._stream._disturbed === true); }
  _consume() {
    if (this.bodyUsed) return Promise.reject(new TypeError("Body has already been consumed."));
    this._used = true;
    if (this._stream === null) return Promise.resolve(this._bytes);
    if (this._stream.locked) return Promise.reject(new TypeError("Body's stream is locked to a reader."));
    return readAllBytes(this._stream);
  }
  // `_bytes` is always this body's own copy and a body is read once, so a body that fills its buffer hands the buffer
  // itself over: a downloaded asset is not copied a second time on its way to the caller.
  arrayBuffer() {
    return this._consume().then((bytes) =>
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  bytes() { return this._consume().then((bytes) => bytes.slice()); }
  text() { return this._consume().then((bytes) => new TextDecoder().decode(bytes)); }
  json() { return this.text().then((text) => JSON.parse(text)); }
  blob() {
    const type = this.headers.get("content-type") || "";
    return this._consume().then((bytes) => new Blob([bytes], { type: type.split(";")[0].trim() }));
  }
}

export class Request extends Body {
  constructor(input, init = {}) {
    super();
    const base = input instanceof Request ? input : null;
    this.url = base ? base.url : String(input);
    this.method = String((init.method !== undefined ? init.method : base ? base.method : "GET")).toUpperCase();
    this.headers = new Headers(init.headers !== undefined ? init.headers : base ? base.headers : undefined);
    this.signal = init.signal !== undefined ? init.signal : base ? base.signal : null;
    this.mode = init.mode || (base && base.mode) || "cors";
    this.credentials = init.credentials || (base && base.credentials) || "same-origin";
    this.cache = init.cache || (base && base.cache) || "default";
    this.redirect = init.redirect || (base && base.redirect) || "follow";
    this.referrer = "about:client";
    const body = init.body !== undefined ? init.body : base && !base.bodyUsed ? (base._stream || base._bytes) : null;
    if ((this.method === "GET" || this.method === "HEAD") && body !== null && body !== undefined && init.body !== undefined) {
      throw new TypeError("Failed to construct 'Request': Request with GET/HEAD method cannot have body.");
    }
    const type = this._initBody(body, null);
    if (type && !this.headers.has("content-type")) this.headers.set("content-type", type);
  }
  clone() {
    if (this.bodyUsed) throw new TypeError("Failed to execute 'clone' on 'Request': Request body is already used");
    if (this._stream === null) return new Request(this);
    const [mine, theirs] = this._stream.tee();
    this._stream = mine;
    return new Request(this, { body: theirs });
  }
}

export class Response extends Body {
  constructor(body = null, init = {}) {
    super();
    const status = init.status === undefined ? 200 : Number(init.status);
    if (!(status >= 200 && status <= 599)) throw new RangeError("Failed to construct 'Response': The status provided (" + status + ") is outside the range [200, 599].");
    this.status = status;
    this.statusText = init.statusText === undefined ? "" : String(init.statusText);
    this.headers = new Headers(init.headers);
    this.url = "";
    this.type = "default";
    this.redirected = false;
    const type = this._initBody(body, null);
    if (type && !this.headers.has("content-type")) this.headers.set("content-type", type);
  }
  get ok() { return this.status >= 200 && this.status <= 299; }
  clone() {
    if (this.bodyUsed) throw new TypeError("Failed to execute 'clone' on 'Response': Response body is already used");
    let copyBody = this._nullBody ? null : this._bytes;
    if (this._stream !== null) {
      const [mine, theirs] = this._stream.tee();
      this._stream = mine;
      copyBody = theirs;
    } else if (copyBody !== null) {
      copyBody = copyBody.slice();
    }
    const copy = new Response(copyBody, { status: this.status, statusText: this.statusText, headers: this.headers });
    copy.url = this.url;
    copy.type = this.type;
    return copy;
  }
  static error() { const r = new Response(null, { status: 200 }); r.status = 0; r.type = "error"; return r; }
  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(JSON.stringify(data), { ...init, headers });
  }
}

export function fetch(input, init) {
  return new Promise((resolve, reject) => {
    let request;
    try { request = new Request(input, init); } catch (e) { return reject(e); }
    const signal = request.signal;
    if (signal && signal.aborted) return reject(signal.reason !== undefined ? signal.reason : exception("The user aborted a request.", "AbortError"));
    const headers = {};
    for (const [name, value] of request.headers) headers[name] = value;
    const send = (bytes) => {
      const load = loadResource({ url: request.url, method: request.method, headers, body: bytes.length ? bytes : undefined });
      let onAbort = null;
      if (signal && typeof signal.addEventListener === "function") {
        onAbort = () => { load.abort(); reject(signal.reason !== undefined ? signal.reason : exception("The user aborted a request.", "AbortError")); };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      load.promise.then(
        (res) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          if (signal && signal.aborted) return;
          const response = new Response(null, { status: res.status === 0 ? 200 : res.status, statusText: res.statusText || statusText(res.status), headers: res.headers });
          // The loader's buffer is ours alone: the body takes it as it is.
          if (request.method !== "HEAD") { response._bytes = new Uint8Array(res.body); response._nullBody = false; }
          response.url = res.url;
          response.type = "basic";
          resolve(response);
        },
        (failure) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          if (failure && failure.kind === "abort") return;
          reject(new TypeError("Failed to fetch"));
        },
      );
    };
    // A body that is a stream is sent once it has all arrived: the request underneath takes bytes.
    if (request._stream !== null) readAllBytes(request._stream).then(send, reject);
    else send(request._bytes);
  });
}
