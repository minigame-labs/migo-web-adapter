// Lookups in the adapter's element tree: by tag, class, id and selector.

import assert from "node:assert/strict";

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};
await import("../src/index.js");
const { document } = globalThis;

const main = document.createElement("main");
document.body.appendChild(main);
assert.equal(document.getElementsByTagName("main")[0], main, "p5.js appends a <main> and asks for it back by tag name");
assert.equal(document.getElementsByTagName("MAIN").length, 1, "tag names are case-insensitive");
assert.equal(document.getElementsByTagName("*").length >= 3, true);
assert.equal(document.getElementsByTagName("nothing").length, 0);

const wrap = document.createElement("div");
wrap.id = "wrap";
wrap.className = "box big";
main.appendChild(wrap);
const a = document.createElement("span"); a.className = "item first"; a.setAttribute("data-kind", "text"); wrap.appendChild(a);
const b = document.createElement("span"); b.className = "item"; b.setAttribute("title", "hello world"); wrap.appendChild(b);
const nested = document.createElement("div"); nested.className = "item deep"; a.appendChild(nested);

assert.equal(document.getElementById("wrap"), wrap);
assert.equal(document.getElementById("missing"), null);
assert.deepEqual([...document.getElementsByClassName("item")], [a, nested, b], "document order");
assert.deepEqual([...document.getElementsByClassName("item deep")], [nested], "all the classes named");
assert.equal(document.querySelector("#wrap"), wrap);
assert.equal(document.querySelector("div.box.big > span.first"), a, "child combinator");
assert.equal(document.querySelector("main span.first div"), nested, "descendant combinators");
assert.equal(document.querySelector("#wrap > div.deep"), null, "a child is not a grandchild");
assert.deepEqual([...document.querySelectorAll("span, div.deep")], [a, nested, b], "a comma list in document order");
assert.equal(document.querySelector("[data-kind]"), a);
assert.equal(document.querySelector('[data-kind="text"]'), a);
assert.equal(document.querySelector("[title^='hello']"), b);
assert.equal(document.querySelector("[title$=world]"), b);
assert.equal(document.querySelector("[title*='lo wo']"), b);
assert.equal(document.querySelector("[title~=world]"), b);
assert.equal(document.querySelector("[title=nope]"), null);
assert.equal(document.querySelector("span[title]"), b);
assert.equal(wrap.querySelector(".deep"), nested, "an element's own subtree");
assert.equal(a.querySelector(".first"), null, "an element does not match itself");
assert.equal(wrap.getElementsByTagName("span").length, 2);
assert.equal(nested.matches("div.item"), true);
assert.equal(nested.closest(".box"), wrap);
assert.equal(nested.closest("#nothing"), null);

// the canvas, by id: Babylon and Phaser look it up
assert.equal(document.getElementById("GameCanvas"), globalThis.canvas);

// attributes
assert.equal(a.getAttribute("data-kind"), "text");
assert.equal(a.dataset.kind, "text");
assert.equal(a.getAttribute("class"), "item first");
assert.equal(a.hasAttribute("title"), false);
a.setAttribute("style", "background-color: red; width:5px");
assert.equal(a.style.backgroundColor, "red");
assert.equal(a.style.width, "5px");
a.setAttribute("width", 300);
assert.equal(a.width, "300", "an attribute that is a plain identifier is also the property");
assert.equal(a.getAttribute("width"), "300");
a.removeAttribute("width");
assert.equal(a.getAttribute("width"), null);
assert.deepEqual(b.getAttributeNames(), ["title"]);

// what is not supported says so
for (const bad of ["a:hover", "li:first-child", "a + b", "a ~ b"]) {
  assert.throws(() => document.querySelector(bad), (e) => e.name === "SyntaxError" && /not a selector this adapter supports/.test(e.message), bad);
}
assert.throws(() => document.querySelector(""), (e) => e.name === "SyntaxError");
assert.throws(() => document.querySelector("a >"), (e) => e.name === "SyntaxError");

// removing an element removes it from lookups
main.removeChild(wrap);
assert.equal(document.getElementById("wrap"), null);
console.log("query tests: all passed");
