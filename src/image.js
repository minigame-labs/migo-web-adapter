// Image() — engines use `new Image(); img.src = '...';  img.onload = ...`. migo.createImage() already returns a host
// Image with a `src` setter and onload/onerror, so a constructor hands that back, with one addition: a `blob:` URL
// (made by URL.createObjectURL) is turned into the bytes the runtime's loader takes -- a data: URL -- when it is set, while
// `src` still reads back as the blob URL so the code that revokes it (Phaser does, after `load`) finds it.

import { resolveBlobURL, blobToDataURL } from "./blob-url.js";
import { withinPackage } from "./origin.js";
import { hostImages } from "./image-registry.js";

function interceptBlobSources(image) {
  const proto = Object.getPrototypeOf(image);
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "src");
  if (!descriptor || typeof descriptor.set !== "function") return image;
  let shown = null;
  Object.defineProperty(image, "src", {
    configurable: true,
    enumerable: true,
    get() { return shown !== null ? shown : descriptor.get.call(this); },
    set(value) {
      const url = String(value === undefined || value === null ? "" : value);
      if (url.startsWith("blob:")) {
        shown = url;
        const blob = resolveBlobURL(url);
        // A revoked or foreign blob URL loads nothing: the runtime is given a source it cannot open, and says so as an error.
        descriptor.set.call(this, blob ? blobToDataURL(blob) : url);
      } else if (withinPackage(url) !== url) {
        // The game's own origin (origin.js): the runtime is given the package path, and `src` reads back as set.
        shown = url;
        descriptor.set.call(this, withinPackage(url));
      } else {
        shown = null;
        descriptor.set.call(this, value);
      }
    },
  });
  return image;
}

// What a browser's <img> has and the runtime's host image does not, defined only where missing: it is an element, with
// attributes. Excalibur's ImageSource keeps an image's filtering and wrapping as attributes on it (`setAttribute`, read
// back with `getAttribute` when it makes the texture), and every image it loaded failed with "image.setAttribute is not
// a function". The attributes a browser reflects -- src, id, class, crossorigin, data-* -- are kept in step with their
// properties; no other attribute is written to the host image, whose width and height are its own.
function installElementMembers(image) {
  const define = (name, descriptor) => {
    if (!(name in image)) Object.defineProperty(image, name, { configurable: true, ...descriptor });
  };
  const attributes = new Map();
  const dataKey = (key) => key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  define("nodeType", { value: 1, writable: true });
  define("tagName", { value: "IMG", writable: true });
  define("nodeName", { value: "IMG", writable: true });
  define("ownerDocument", { get() { return globalThis.document; } });
  define("parentElement", { get() { return this.parentNode || null; } });
  define("dataset", { get() { return this._dataset || (this._dataset = {}); } });
  define("className", { value: "", writable: true });
  define("setAttribute", {
    value(name, value) {
      const key = String(name).toLowerCase();
      const text = String(value);
      attributes.set(key, text);
      if (key === "src") this.src = text;
      else if (key === "id") this.id = text;
      else if (key === "class") this.className = text;
      else if (key === "crossorigin") this.crossOrigin = text;
      else if (key.startsWith("data-")) this.dataset[dataKey(key)] = text;
    },
    writable: true,
  });
  define("getAttribute", {
    value(name) {
      const key = String(name).toLowerCase();
      if (attributes.has(key)) return attributes.get(key);
      if (key === "src" && this.src) return String(this.src);
      if (key === "id" && this.id) return String(this.id);
      if (key === "class" && this.className) return String(this.className);
      return null;
    },
    writable: true,
  });
  define("removeAttribute", {
    value(name) {
      const key = String(name).toLowerCase();
      attributes.delete(key);
      if (key === "id") this.id = "";
      else if (key === "class") this.className = "";
      else if (key.startsWith("data-")) delete this.dataset[dataKey(key)];
    },
    writable: true,
  });
  define("hasAttribute", { value(name) { return this.getAttribute(name) !== null; }, writable: true });
  define("getAttributeNames", { value() { return [...attributes.keys()]; }, writable: true });
  return image;
}

export default function Image(width, height) {
  if (typeof migo.createImage !== "function") {
    throw new Error("[migo-web-adapter] migo.createImage is not available");
  }
  const image = installElementMembers(interceptBlobSources(migo.createImage(width, height)));
  hostImages.add(image);
  return image;
}

/// `createImageBitmap` that also takes a Blob (Pixi loads textures as `fetch -> blob -> createImageBitmap`): the Blob
/// becomes an Image the runtime's own `createImageBitmap` takes.
export function wrapCreateImageBitmap(original) {
  return function createImageBitmap(source, ...args) {
    if (!(source && source._bytes instanceof Uint8Array && typeof source.slice === "function" && typeof source.type === "string")) {
      return original.call(this, source, ...args);
    }
    return new Promise((resolve, reject) => {
      const image = Image();
      image.onload = () => original.call(globalThis, image, ...args).then(resolve, reject);
      image.onerror = (event) => reject(new (globalThis.DOMException || Error)("The source image could not be decoded.", "InvalidStateError"));
      image.src = blobToDataURL(source);
    });
  };
}
