// `new Image()` is an element with attributes (src/image.js): Excalibur's ImageSource sets an image's filtering and wrapping
// as attributes and reads them back, and every image it loaded failed with "image.setAttribute is not a function". It is
// also an HTMLImageElement to `instanceof`.
import assert from "node:assert/strict";

class HostImage {
  constructor() { this._src = ""; this._w = 0; }
  get src() { return this._src; }
  set src(v) { this._src = String(v); }
  get width() { return this._w; }   // the host's own: no setter
}
globalThis.migo = { createImage: () => new HostImage() };
const { default: Image } = await import("../src/image.js");
const { HTMLImageElement, HTMLCanvasElement } = await import("../src/element.js");

const image = new Image();
assert.equal(image.tagName, "IMG");
assert.equal(image.nodeType, 1);
assert.ok(image instanceof HTMLImageElement, "a host image is an HTMLImageElement");
assert.ok(!(image instanceof HTMLCanvasElement));
assert.ok(!({} instanceof HTMLImageElement));

image.setAttribute("data-original-src", "assets/a.png");
image.setAttribute("filtering", "Pixel");
assert.equal(image.getAttribute("filtering"), "Pixel", "an attribute reads back as it was set");
assert.equal(image.getAttribute("FILTERING"), "Pixel", "names are case-insensitive");
assert.equal(image.dataset.originalSrc, "assets/a.png", "data-* attributes are the dataset");
assert.equal(image.getAttribute("wrapping"), null);
assert.equal(image.hasAttribute("filtering"), true);
assert.deepEqual(image.getAttributeNames(), ["data-original-src", "filtering"]);

image.setAttribute("src", "assets/b.png");
assert.equal(image.src, "assets/b.png", "src is reflected");
image.src = "assets/c.png";
assert.equal(image.getAttribute("src"), "assets/b.png", "the attribute keeps what setAttribute wrote");
const other = new Image();
other.src = "assets/d.png";
assert.equal(other.getAttribute("src"), "assets/d.png", "a src set as a property reads as the attribute");
image.setAttribute("width", "64");
assert.equal(image.width, 0, "width is the host's own and not written");
assert.equal(image.getAttribute("width"), "64");

image.removeAttribute("filtering");
image.removeAttribute("data-original-src");
assert.equal(image.getAttribute("filtering"), null);
assert.equal(image.dataset.originalSrc, undefined);
image.setAttribute("id", "logo");
assert.equal(image.id, "logo");
image.removeAttribute("id");
assert.equal(image.id, "");
console.log("image-element: ok");
