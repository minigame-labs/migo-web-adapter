// `Blob` and `File`: immutable bytes with a MIME type. Loaders produce them from a response (`response.blob()`,
// `xhr.responseType = "blob"`) and read them back (`blob.arrayBuffer()`, FileReader); there is no streaming and no object
// URL registry here, only the bytes.

import { TextEncoder, TextDecoder } from "./text-codec.js";

const encoder = new TextEncoder();

function partBytes(part) {
  if (part instanceof Blob) return part._bytes;
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  return encoder.encode(String(part));
}

export class Blob {
  constructor(parts = [], options = {}) {
    if (parts === null || typeof parts !== "object" || typeof parts[Symbol.iterator] !== "function") {
      throw new TypeError("Failed to construct 'Blob': The provided value cannot be converted to a sequence.");
    }
    const pieces = [];
    let size = 0;
    for (const part of parts) {
      const bytes = partBytes(part);
      pieces.push(bytes);
      size += bytes.length;
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const piece of pieces) { bytes.set(piece, at); at += piece.length; }
    this._bytes = bytes;
    const type = options && options.type !== undefined ? String(options.type) : "";
    // The type is lower-cased, and ignored entirely if it holds a character outside printable ASCII.
    this._type = /^[\x20-\x7e]*$/.test(type) ? type.toLowerCase() : "";
  }

  get size() { return this._bytes.length; }
  get type() { return this._type; }

  slice(start = 0, end = this.size, contentType = "") {
    const clamp = (n, size) => (n < 0 ? Math.max(size + n, 0) : Math.min(n, size));
    const from = clamp(Math.trunc(Number(start)) || 0, this.size);
    const to = clamp(end === undefined ? this.size : Math.trunc(Number(end)) || 0, this.size);
    const out = new Blob([], { type: contentType });
    out._bytes = this._bytes.slice(from, Math.max(from, to));
    return out;
  }

  arrayBuffer() { return Promise.resolve(this._bytes.slice().buffer); }
  bytes() { return Promise.resolve(this._bytes.slice()); }
  text() { return Promise.resolve(new TextDecoder().decode(this._bytes)); }
}
Object.defineProperty(Blob.prototype, Symbol.toStringTag, { value: "Blob", configurable: true });

export class File extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this._name = String(name);
    this._lastModified = options.lastModified === undefined ? Date.now() : Number(options.lastModified);
  }
  get name() { return this._name; }
  get lastModified() { return this._lastModified; }
}
Object.defineProperty(File.prototype, Symbol.toStringTag, { value: "File", configurable: true });
