// Document and HTMLDocument (src/document.js): the interfaces of `document`. Ebitengine binds the `hidden` getter of
// Document.prototype to the document while its package initialises -- `Object.getOwnPropertyDescriptor(
// Document.prototype, "hidden").get.call(document)` through syscall/js -- and its Go panicked where there was no Document.
// Run with `node tests/document-interface.test.mjs`.
import assert from "node:assert/strict";

let onShow, onHide;
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "x", language: "zh-CN", version: "1", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}), createCanvas: () => ({ getContext: () => ({}) }),
  createInnerAudioContext: () => ({ onCanplay() {}, onPlay() {}, onPause() {}, onEnded() {}, onError() {}, play() {}, pause() {}, seek() {} }),
  getStorageInfoSync: () => ({ keys: [] }), getStorageSync: () => "", setStorageSync: () => {}, removeStorageSync: () => {}, clearStorageSync: () => {},
  request: () => ({ abort() {} }), connectSocket: () => ({ onOpen() {}, onMessage() {}, onClose() {}, onError() {}, send() {}, close() {} }),
  onShow: (cb) => { onShow = cb; }, onHide: (cb) => { onHide = cb; },
};

await import("../src/index.js");

// The interfaces, published, and the document an HTMLDocument, a Document, a Node and an EventTarget.
assert.equal(typeof Document, "function", "Document is published");
assert.equal(typeof HTMLDocument, "function", "HTMLDocument is published");
assert.equal(Object.getPrototypeOf(document), HTMLDocument.prototype, "the document is an HTMLDocument");
assert.ok(document instanceof HTMLDocument && document instanceof Document);
assert.ok(document instanceof Node && document instanceof EventTarget);
assert.ok(HTMLDocument.prototype instanceof Document && Document.prototype instanceof Node);
assert.ok(!(document.body instanceof Document), "an element is no document");
assert.equal(document.nodeType, 9, "DOCUMENT_NODE");
assert.equal(document.nodeName, "#document");
assert.throws(() => new HTMLDocument(), TypeError, "HTMLDocument has no constructor");
assert.throws(() => new Document(), /a document other than the page's is not supported/, "and a second document is not made");

// The visibility state is the interface's: getters on Document.prototype, not the document's own data.
for (const name of ["hidden", "visibilityState"]) {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
  assert.equal(typeof descriptor.get, "function", `Document.prototype.${name} is a getter`);
  assert.equal(descriptor.set, undefined, `and read-only`);
  assert.equal(Object.getOwnPropertyDescriptor(document, name), undefined, `the document has no ${name} of its own to shadow it`);
  assert.throws(() => descriptor.get.call({}), /Illegal invocation/, `${name} read from what is not the document`);
}

// Ebitengine's pattern: the getter bound once, read for as long as the game runs.
const documentHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden").get.bind(document);
const documentHasFocus = document.hasFocus.bind(document);
assert.equal(documentHidden(), false);
assert.equal(document.visibilityState, "visible");
assert.equal(documentHasFocus(), true);
let seen = null;
document.addEventListener("visibilitychange", () => { seen = [document.hidden, documentHidden(), document.visibilityState]; });
onHide();
assert.deepEqual(seen, [true, true, "hidden"], "hidden before visibilitychange fires, through the bound getter too");
assert.equal(documentHasFocus(), false, "a hidden document has no focus");
onShow({});
assert.deepEqual(seen, [false, false, "visible"]);
assert.equal(documentHidden(), false);

// Assigning to a read-only accessor changes nothing (sloppy) or throws (strict), as in a browser.
assert.throws(() => { "use strict"; document.hidden = true; }, TypeError);
assert.equal(document.hidden, false);

console.log("document-interface: ok");
