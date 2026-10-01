// Object URLs: createObjectURL / revokeObjectURL, and who can read the URL: XHR, fetch and Image.

import assert from "node:assert/strict";

const imageSets = [];
class FakeImage {
  constructor() { this._src = ""; }
  get src() { return this._src; }
  set src(v) { this._src = v; imageSets.push(v); }
}
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => new FakeImage(),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};

await import("../src/index.js");
const { createObjectURL, revokeObjectURL, installObjectURLs } = await import("../src/blob-url.js");
const { Blob } = await import("../src/blob.js");
const { fetch } = await import("../src/fetch.js");
const Image = (await import("../src/image.js")).default;
const { wrapCreateImageBitmap } = await import("../src/image.js");

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

await test("createObjectURL names a blob; revoke forgets it", async () => {
  const blob = new Blob(["hello"], { type: "text/plain" });
  const url = createObjectURL(blob);
  assert.match(url, /^blob:/);
  assert.notEqual(createObjectURL(blob), url, "every call makes a new URL");
  assert.equal(await (await fetch(url)).text(), "hello");
  assert.equal((await fetch(url)).headers.get("content-type"), "text/plain");
  revokeObjectURL(url);
  await assert.rejects(fetch(url), TypeError, "a revoked URL cannot be fetched");
  assert.throws(() => createObjectURL({}), TypeError);
});

await test("XHR reads an object URL", async () => {
  const url = createObjectURL(new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }));
  const body = await new Promise((resolve, reject) => {
    const x = new globalThis.XMLHttpRequest();
    x.open("GET", url);
    x.responseType = "arraybuffer";
    x.onload = () => resolve(x.response);
    x.onerror = reject;
    x.send();
  });
  assert.deepEqual([...new Uint8Array(body)], [1, 2, 3]);
});

await test("Image: a blob URL becomes a data: URL for the runtime, and src reads back as the blob URL", () => {
  imageSets.length = 0;
  const url = createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  const image = new Image();
  image.src = url;
  assert.equal(image.src, url, "src reads back as the blob URL: Phaser revokes by it after load");
  assert.equal(imageSets.at(-1), "data:image/png;base64,iVBORw==");
  image.src = "assets/a.png";
  assert.equal(image.src, "assets/a.png");
  assert.equal(imageSets.at(-1), "assets/a.png", "other sources pass through untouched");
  revokeObjectURL(url);
  image.src = url;
  assert.equal(imageSets.at(-1), url, "a revoked URL is passed on as it is: the runtime cannot open it and reports an error");
});

await test("createImageBitmap takes a Blob", async () => {
  const calls = [];
  const original = async (source, ...args) => { calls.push({ source, args }); return { bitmap: true }; };
  const wrapped = wrapCreateImageBitmap(original);
  // An Image that finishes loading as soon as it has a source.
  class LoadingImage {
    get src() { return this._s; }
    set src(v) { this._s = v; queueMicrotask(() => this.onload && this.onload()); }
  }
  const realCreate = globalThis.migo.createImage;
  globalThis.migo.createImage = () => new LoadingImage();
  const result = await wrapped(new Blob([new Uint8Array([1])], { type: "image/png" }), { resizeWidth: 4 });
  globalThis.migo.createImage = realCreate;
  assert.deepEqual(result, { bitmap: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].source.src.startsWith("data:image/png;base64,"));
  assert.deepEqual(calls[0].args, [{ resizeWidth: 4 }]);
  const passthrough = await wrapped({ width: 1 });
  assert.deepEqual(passthrough, { bitmap: true });
  assert.deepEqual(calls[1].source, { width: 1 }, "a non-Blob goes to the runtime's own function untouched");
});

await test("installObjectURLs leaves a working implementation alone and replaces one that throws", () => {
  class Throws { static createObjectURL() { throw new Error("createObjectURL is not supported in this environment"); } }
  installObjectURLs(Throws);
  assert.match(Throws.createObjectURL(new Blob([])), /^blob:/);
  const own = () => "blob:own";
  class Works { static createObjectURL() { return own(); } }
  installObjectURLs(Works);
  assert.equal(Works.createObjectURL(new Blob([])), "blob:own");
  class Absent {}
  installObjectURLs(Absent);
  assert.equal(typeof Absent.revokeObjectURL, "function");
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("blob-url tests: all passed");
