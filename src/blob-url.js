// `URL.createObjectURL(blob)`: a URL for bytes the page holds. The runtime's `URL` has the static methods but they throw
// ("createObjectURL is not supported in this environment"), and Phaser 3 loads every image through them by default (XHR
// to a Blob, an object URL, `img.src = url`), so none of its images loaded.
//
// The URL is `blob:migo/<n>` and names a Blob in a registry here. Who can use it: XMLHttpRequest and fetch (resource.js
// reads the Blob's bytes directly) and Image (image.js hands the runtime the bytes as a data: URL, which its image
// loader accepts, at the moment of the load -- nothing is kept in base64 between loads). `revokeObjectURL` drops the entry.

import { Blob } from "./blob.js";
import { btoa } from "./base64.js";

const registry = new Map();
let next = 1;

export function createObjectURL(object) {
  if (!(object instanceof Blob)) {
    throw new TypeError("Failed to execute 'createObjectURL' on 'URL': Overload resolution failed.");
  }
  const url = `blob:migo/${next++}`;
  registry.set(url, object);
  return url;
}

export function revokeObjectURL(url) {
  registry.delete(String(url));
}

/// The Blob a `blob:` URL names, or null (revoked, or never made here).
export function resolveBlobURL(url) {
  return registry.get(String(url)) || null;
}

/// The bytes of `blob` as a `data:` URL.
export function blobToDataURL(blob) {
  const bytes = blob._bytes;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

/// Installs the two static methods on `URL` when the runtime's own are absent or refuse to work.
export function installObjectURLs(URLClass) {
  if (typeof URLClass !== "function") return;
  let works = false;
  try { works = typeof URLClass.createObjectURL === "function" && typeof URLClass.createObjectURL(new Blob([])) === "string"; } catch (_) { works = false; }
  if (works) return;
  Object.defineProperty(URLClass, "createObjectURL", { value: createObjectURL, writable: true, configurable: true });
  Object.defineProperty(URLClass, "revokeObjectURL", { value: revokeObjectURL, writable: true, configurable: true });
}
