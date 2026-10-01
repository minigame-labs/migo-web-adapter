// Image() — engines use `new Image(); img.src = '...';  img.onload = ...`. migo.createImage() already returns a host
// Image with a `src` setter and onload/onerror, so a constructor hands that back, with one addition: a `blob:` URL
// (made by URL.createObjectURL) is turned into the bytes the runtime's loader takes -- a data: URL -- when it is set, while
// `src` still reads back as the blob URL so the code that revokes it (Phaser does, after `load`) finds it.

import { resolveBlobURL, blobToDataURL } from "./blob-url.js";

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
      } else {
        shown = null;
        descriptor.set.call(this, value);
      }
    },
  });
  return image;
}

export default function Image(width, height) {
  if (typeof migo.createImage !== "function") {
    throw new Error("[migo-web-adapter] migo.createImage is not available");
  }
  return interceptBlobSources(migo.createImage(width, height));
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
