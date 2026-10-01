// Where an XMLHttpRequest or a fetch gets its bytes. A browser page has one origin; a Migo game has three kinds of URL:
//
//   http(s)://, //host/...   the network: `migo.request`
//   data:...                 the bytes are in the URL (RFC 2397)
//   blob:...                 the bytes of a Blob this page made an object URL for (blob-url.js)
//   anything else            the game package: a relative path (`assets/a.png`, `./a.json?v=3`), an origin-relative one
//                            (`/assets/a.png` -- the origin's root is the package root), or one of the runtime's own roots
//                            (`/user/...`, `/cache/...`, `/code/...`, `/tmp/...`), read with the file system manager
//
// The browser's contract for a missing file is HTTP: the request completes and the status is 404, so a loader's own
// `status` check sees it. `migo.request` failing on a relative path ("request:fail") is what every asset loader --
// Phaser's, Howler's, PlayCanvas's, Babylon's -- ran into, and none of them could load a file from the game they shipped in.

import { atob } from "./base64.js";
import { resolveBlobURL } from "./blob-url.js";

const MIME = {
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
  ktx: "image/ktx", ktx2: "image/ktx2", dds: "image/vnd-ms.dds", basis: "application/octet-stream",
  json: "application/json", js: "text/javascript", mjs: "text/javascript", txt: "text/plain", xml: "application/xml",
  html: "text/html", htm: "text/html", css: "text/css", csv: "text/csv", glsl: "text/plain", vert: "text/plain", frag: "text/plain",
  glb: "model/gltf-binary", gltf: "model/gltf+json", obj: "text/plain", fbx: "application/octet-stream", bin: "application/octet-stream",
  wasm: "application/wasm", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  mp4: "video/mp4", webm: "video/webm", atlas: "text/plain", fnt: "text/plain", tmx: "application/xml", tsx: "application/xml",
};

const STATUS_TEXT = {
  200: "OK", 201: "Created", 204: "No Content", 206: "Partial Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 408: "Request Timeout",
  409: "Conflict", 410: "Gone", 413: "Payload Too Large", 429: "Too Many Requests",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};
export const statusText = (status) => STATUS_TEXT[status] || "";

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

/// The kind of URL: "data", "blob" (an object URL), "http", "file" (a package path) or "unsupported" (ws:, ...).
export function kindOf(url) {
  if (url.startsWith("//")) return "http";
  const match = SCHEME.exec(url);
  if (!match) return "file";
  const scheme = match[1].toLowerCase();
  if (scheme === "data") return "data";
  if (scheme === "blob") return "blob";
  if (scheme === "http" || scheme === "https") return "http";
  if (scheme === "file") return "file";
  return "unsupported";
}

/// The path a package file is read by: no query, no fragment, percent-decoding applied, and an origin-relative path
/// (`/a/b`) taken as package-relative unless it begins with one of the runtime's own roots.
export function packagePath(url) {
  let path = url.replace(/^file:\/\//i, "").split("#")[0].split("?")[0];
  try { path = decodeURIComponent(path); } catch (_) { /* leave it as written */ }
  if (path.startsWith("/") && !/^\/(user|cache|code|tmp)(\/|$)/.test(path)) path = path.replace(/^\/+/, "");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

function extensionType(path) {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (dot <= slash) return "application/octet-stream";
  return MIME[path.slice(dot + 1).toLowerCase()] || "application/octet-stream";
}

function result(url, status, headers, body) {
  return { url, status, statusText: statusText(status), headers, body };
}

/// RFC 2397: `data:[<mediatype>][;base64],<data>`. The bytes of a non-base64 payload are percent-decoded; the media type
/// defaults to `text/plain;charset=US-ASCII`.
export function decodeDataUrl(url) {
  const comma = url.indexOf(",");
  if (comma === -1) return null;
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  const parts = meta.split(";");
  const base64 = parts.length > 1 && parts[parts.length - 1].trim().toLowerCase() === "base64";
  if (base64) parts.pop();
  const type = parts.join(";").trim() || "text/plain;charset=US-ASCII";
  let bytes;
  if (base64) {
    let binary;
    try { binary = atob(decodeURIComponent(payload)); } catch (_) { return null; }
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    const out = [];
    for (let i = 0; i < payload.length; i++) {
      const c = payload.charCodeAt(i);
      if (c === 0x25 && /^[0-9a-fA-F]{2}$/.test(payload.slice(i + 1, i + 3))) { out.push(parseInt(payload.slice(i + 1, i + 3), 16)); i += 2; }
      else if (c < 0x80) out.push(c);
      else {
        // a non-ASCII character written as is: its UTF-8 bytes
        const cp = payload.codePointAt(i);
        if (cp > 0xffff) i++;
        const text = String.fromCodePoint(cp);
        if (typeof migo !== "undefined" && typeof migo.encode === "function") {
          for (const b of new Uint8Array(migo.encode({ data: text, format: "utf8" }))) out.push(b);
        } else {
          for (const b of unescape(encodeURIComponent(text))) out.push(b.charCodeAt(0));
        }
      }
    }
    bytes = Uint8Array.from(out);
  }
  return { type, bytes };
}

function toArrayBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  if (body._bytes instanceof Uint8Array) return body._bytes.slice().buffer;      // a Blob
  return String(body);
}

const lowerKeys = (headers) => {
  const out = {};
  if (headers) for (const key of Object.keys(headers)) out[key.toLowerCase()] = String(headers[key]);
  return out;
};

/// Starts a request. `request` is `{ url, method, headers, body, timeout }`; the promise resolves to
/// `{ url, status, statusText, headers, body }` (`body` an ArrayBuffer; `headers` lower-cased) -- a 404 is a resolution,
/// not a rejection -- and rejects with `{ kind: "network" | "timeout" | "abort", error }`. `abort()` cancels.
export function loadResource(request) {
  const url = String(request.url);
  const method = String(request.method || "GET").toUpperCase();
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const kind = kindOf(url);
    let finished = false;
    const done = (fn, value) => { if (!finished) { finished = true; clearTimeout(timer); fn(value); } };
    let timer = 0;
    cancel = () => done(reject, { kind: "abort", error: new Error("aborted") });
    if (request.timeout > 0) timer = setTimeout(() => done(reject, { kind: "timeout", error: new Error("timeout") }), request.timeout);

    if (kind === "data") {
      const parsed = decodeDataUrl(url);
      if (!parsed) return done(reject, { kind: "network", error: new Error("invalid data URL") });
      return queueMicrotask(() => done(resolve, result(url, 200, { "content-type": parsed.type, "content-length": String(parsed.bytes.length) }, parsed.bytes.buffer)));
    }

    if (kind === "blob") {
      const blob = resolveBlobURL(url);
      if (!blob) return done(reject, { kind: "network", error: new Error("blob URL was revoked or is not known") });
      const body = blob._bytes.slice().buffer;
      return queueMicrotask(() => done(resolve, result(url, 200, { "content-type": blob.type || "application/octet-stream", "content-length": String(body.byteLength) }, body)));
    }

    if (kind === "file") {
      if (method !== "GET" && method !== "HEAD") return queueMicrotask(() => done(resolve, result(url, 405, {}, new ArrayBuffer(0))));
      const fs = typeof migo !== "undefined" && typeof migo.getFileSystemManager === "function" ? migo.getFileSystemManager() : null;
      if (!fs || typeof fs.readFile !== "function") return done(reject, { kind: "network", error: new Error("no file system manager") });
      const path = packagePath(url);
      return fs.readFile({
        filePath: path,
        success: (res) => {
          const data = res.data instanceof ArrayBuffer ? res.data : ArrayBuffer.isView(res.data) ? toArrayBuffer(res.data) : new ArrayBuffer(0);
          const headers = { "content-type": extensionType(path), "content-length": String(data.byteLength) };
          done(resolve, result(url, 200, headers, method === "HEAD" ? new ArrayBuffer(0) : data));
        },
        fail: (error) => {
          const message = String((error && (error.errMsg || error.message)) || "");
          if (/not allowed|permission|denied/i.test(message)) done(resolve, result(url, 403, {}, new ArrayBuffer(0)));
          else done(resolve, result(url, 404, {}, new ArrayBuffer(0)));
        },
      });
    }

    if (kind === "unsupported" || typeof migo === "undefined" || typeof migo.request !== "function") {
      return done(reject, { kind: "network", error: new Error(`cannot load ${url}`) });
    }
    const absolute = url.startsWith("//") ? "https:" + url : url;
    const task = migo.request({
      url: absolute,
      method,
      header: request.headers || {},
      data: toArrayBuffer(request.body),
      responseType: "arraybuffer",
      success: (res) => {
        const body = res.data instanceof ArrayBuffer ? res.data : typeof res.data === "string" ? stringBytes(res.data) : new ArrayBuffer(0);
        done(resolve, result(url, res.statusCode || 200, lowerKeys(res.header), body));
      },
      fail: (error) => done(reject, { kind: /timeout/i.test(String(error && error.errMsg)) ? "timeout" : "network", error }),
    });
    cancel = () => { try { if (task && typeof task.abort === "function") task.abort(); } catch (_) { /* gone already */ } done(reject, { kind: "abort", error: new Error("aborted") }); };
  });
  return { promise, abort: () => cancel() };
}

function stringBytes(text) {
  if (typeof migo !== "undefined" && typeof migo.encode === "function") return migo.encode({ data: text, format: "utf8" });
  return Uint8Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0)).buffer;
}
