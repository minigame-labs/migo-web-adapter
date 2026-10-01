// FileReader — reads a Blob, an ArrayBuffer or a view. readAsText, readAsArrayBuffer and readAsDataURL (base64) are
// supported; streaming and readAsBinaryString are not in scope.

import EventTarget from "./event-target.js";
import { TextEncoder, TextDecoder } from "./text-codec.js";
import { btoa } from "./base64.js";

const EMPTY = 0, LOADING = 1, DONE = 2;

export default class FileReader extends EventTarget {
  constructor() {
    super();
    this.readyState = EMPTY;
    this.result = null;
    this.error = null;
    this.onloadstart = null;
    this.onprogress = null;
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
    this.onabort = null;
  }

  abort() {
    this.readyState = DONE;
    if (this.onabort) try { this.onabort({ type: "abort" }); } catch {}
  }

  readAsText(blob, _encoding) {
    this._read(blob, "text");
  }
  readAsArrayBuffer(blob) {
    this._read(blob, "arraybuffer");
  }
  readAsDataURL(blob) {
    this._read(blob, "dataurl");
  }

  _read(blob, mode) {
    this.readyState = LOADING;
    Promise.resolve().then(() => {
      try {
        const bytes = bytesOf(blob);
        if (mode === "text") {
          this.result = new TextDecoder().decode(bytes);
        } else if (mode === "arraybuffer") {
          this.result = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } else {
          const type = blob && typeof blob.type === "string" && blob.type ? blob.type : "application/octet-stream";
          this.result = `data:${type};base64,${base64(bytes)}`;
        }
        this.readyState = DONE;
        const size = bytes.length;
        this._fire("load", size);
        this._fire("loadend", size);
      } catch (e) {
        this.readyState = DONE;
        this.error = e;
        this._fire("error", 0);
        this._fire("loadend", 0);
      }
    });
  }

  _fire(type, loaded) {
    const event = { type, target: this, currentTarget: this, lengthComputable: true, loaded, total: loaded, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
    const handler = this["on" + type];
    if (typeof handler === "function") try { handler.call(this, event); } catch (e) { console.error(e); }
    this.dispatchEvent(event);
  }
}

// What a FileReader reads: a Blob (its bytes), an ArrayBuffer or a view, or a string.
function bytesOf(source) {
  if (source && source._bytes instanceof Uint8Array) return source._bytes;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new TextEncoder().encode(String(source));
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(binary);
}

FileReader.EMPTY = EMPTY;
FileReader.LOADING = LOADING;
FileReader.DONE = DONE;
