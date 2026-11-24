// Element.insertAdjacentHTML / insertAdjacentElement / insertAdjacentText, on the adapter's elements and a host canvas.

import assert from "node:assert/strict";

const reads = [];
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, style: {}, getContext: () => ({}), toDataURL: () => "data:," }),
  getFileSystemManager: () => ({ readFileSync: (path) => { reads.push(path); return "globalThis.__ranInsertedScript = true;"; } }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};
await import("../src/index.js");
// The adapter's own: Node has a DOMException of its own, which the adapter leaves in place; the runtime has none.
const { default: DOMException } = await import("../src/dom-exception.js");
const { document } = globalThis;
const tags = (node) => node.children.map((c) => (c.nodeType === 3 ? `#${c.textContent}` : c.tagName.toLowerCase() + (c.id ? `#${c.id}` : "")));

// Defold's loader, as it writes it: the progress bar after the canvas the game draws to.
const canvas = document.createElement("canvas");
const container = document.createElement("div");
container.id = "canvas-container";
document.body.appendChild(container);
container.appendChild(canvas);
const after = document.createElement("span");
container.appendChild(after);
canvas.insertAdjacentHTML("afterend", '<div id="defold-progress" class="canvas-app-progress"><div id="defold-progress-bar" class="canvas-app-progress-bar" style="transform: scaleX(0.0);"></div></div>');
const progress = document.getElementById("defold-progress");
const bar = document.getElementById("defold-progress-bar");
assert.ok(progress && bar, "both elements the markup names are in the document");
assert.equal(container.children.indexOf(progress), container.children.indexOf(canvas) + 1, "right after the canvas, before its next sibling");
assert.equal(container.children[container.children.length - 1], after);
assert.equal(bar.parentNode, progress);
assert.equal(progress.className, "canvas-app-progress");
assert.equal(bar.style.transform, "scaleX(0.0)", "the style attribute is the element's declarations");
assert.equal(bar.getAttribute("class"), "canvas-app-progress-bar");
assert.equal(progress.nodeType, 1);

// Each position, in order, with text between elements.
const box = document.createElement("div");
const inner = document.createElement("i");
box.appendChild(inner);
document.body.appendChild(box);
box.insertAdjacentHTML("afterbegin", "<b id=one>1</b>text<u id='two'></u>");
assert.deepEqual(tags(box), ["b#one", "#text", "u#two", "i"], "afterbegin: before the first child, in document order");
box.insertAdjacentHTML("beforeEnd", "<em id=three></em>");
assert.deepEqual(tags(box), ["b#one", "#text", "u#two", "i", "em#three"], "positions are ASCII case-insensitive");
box.insertAdjacentHTML("beforebegin", "<p id=before></p>");
box.insertAdjacentHTML("afterend", "<p id=after></p>");
const at = document.body.children.indexOf(box);
assert.equal(document.body.children[at - 1].id, "before");
assert.equal(document.body.children[at + 1].id, "after");

// Character references in text and attribute values; void elements take no children; `<div/>` stays open, as in HTML.
const refs = document.createElement("div");
refs.insertAdjacentHTML("beforeend", '<span title="a &amp; b &quot;c&quot; &#65;&#x42;">&lt;x&gt; &copy; &unknown; &#0;</span><br><input value=1><s>after</s><div/>inside');
assert.equal(refs.children[0].getAttribute("title"), 'a & b "c" AB');
assert.equal(refs.children[0].children[0].textContent, "<x> © &unknown; �");
assert.deepEqual(tags(refs), ["span", "br", "input", "s", "div"], "br and input are void: the <s> is their sibling");
assert.deepEqual(tags(refs.children[4]), ["#inside"]);
refs.insertAdjacentHTML("beforeend", "<!-- a comment --><style>p > a { color: red }</style><textarea>&lt;kept&gt;</textarea>");
assert.equal(refs.children[5].children[0].textContent, "p > a { color: red }", "style content is raw text");
assert.equal(refs.children[6].children[0].textContent, "<kept>", "textarea content decodes references");

// A script that arrives as markup never runs, wherever it goes.
refs.insertAdjacentHTML("beforeend", '<script src="inserted.js"></script>');
document.body.appendChild(refs);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(reads, [], "the inserted script was never read");
assert.equal(globalThis.__ranInsertedScript, undefined);

// Refusals.
assert.throws(() => box.insertAdjacentHTML("middle", "<b></b>"), (e) => e instanceof DOMException && e.name === "SyntaxError");
const loose = document.createElement("div");
assert.throws(() => loose.insertAdjacentHTML("afterend", "<b></b>"), (e) => e instanceof DOMException && e.name === "NoModificationAllowedError");
assert.doesNotThrow(() => loose.insertAdjacentHTML("beforeend", "<b></b>"));
assert.equal(loose.children.length, 1);

// insertAdjacentElement and insertAdjacentText.
const moved = document.createElement("section");
assert.equal(box.insertAdjacentElement("afterbegin", moved), moved);
assert.equal(box.children[0], moved);
assert.equal(loose.insertAdjacentElement("beforebegin", document.createElement("p")), null, "no parent: nothing, and null");
assert.throws(() => box.insertAdjacentElement("afterbegin", "<b></b>"), TypeError);
box.insertAdjacentText("beforeend", "<not markup>");
assert.equal(box.children[box.children.length - 1].textContent, "<not markup>");

// A host canvas holds what goes inside it, as a <canvas> holds fallback content.
canvas.insertAdjacentHTML("beforeend", "<p>no canvas support</p>");
assert.equal(canvas.children.length, 1);
assert.equal(canvas.children[0].parentNode, canvas);

console.log("insert-adjacent-html: ok");
