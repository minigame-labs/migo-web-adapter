// element.style as a CSSStyleDeclaration (src/css-style.js): the CSSOM methods lil-gui and others call, against the
// plain-property use engines already make of it, which must keep working.

import assert from "node:assert/strict";

globalThis.migo = {
  createCanvas: () => ({ width: 0, height: 0, style: { marginLeft: "4px" }, getContext: () => ({}), toDataURL: () => "data:," }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2, screenWidth: 375, screenHeight: 667, platform: "devtools", system: "test" }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2, screenWidth: 375, screenHeight: 667 }),
  onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
};
const { CSSStyleDeclaration, styleDeclaration } = await import("../src/css-style.js");

let failed = 0;
const test = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

test("setProperty takes CSS names, and the property reads back camel-cased", () => {
  const s = new CSSStyleDeclaration();
  s.setProperty("background-color", "red");
  assert.equal(s.backgroundColor, "red");
  assert.equal(s.getPropertyValue("background-color"), "red");
  assert.equal(s.getPropertyValue("BACKGROUND-COLOR"), "red", "names are not case-sensitive");
  s.marginTop = "3px";
  assert.equal(s.getPropertyValue("margin-top"), "3px", "a property set by name reads through the method");
  s.setProperty("float", "left");
  assert.equal(s.cssFloat, "left");
});

test("custom properties keep their name, as lil-gui sets --width", () => {
  const s = new CSSStyleDeclaration();
  s.setProperty("--width", "200px");
  assert.equal(s.getPropertyValue("--width"), "200px");
  assert.equal(s["--width"], "200px");
  s.setProperty("--Width", "1px");
  assert.equal(s.getPropertyValue("--width"), "200px", "custom properties are case-sensitive");
});

test("an empty or null value removes; removeProperty returns what was there", () => {
  const s = new CSSStyleDeclaration();
  s.setProperty("width", "10px");
  assert.equal(s.removeProperty("width"), "10px");
  assert.equal(s.getPropertyValue("width"), "");
  s.setProperty("height", "5px");
  s.setProperty("height", "");
  assert.equal("height" in s, false);
  s.setProperty("top", "1px");
  s.setProperty("top", null);
  assert.equal(s.getPropertyValue("top"), "");
  assert.equal(s.removeProperty("nothing"), "");
});

test("priority is kept and dropped with the value", () => {
  const s = new CSSStyleDeclaration();
  s.setProperty("color", "blue", "important");
  assert.equal(s.getPropertyPriority("color"), "important");
  assert.equal(s.cssText, "color: blue !important;");
  s.setProperty("color", "green");
  assert.equal(s.getPropertyPriority("color"), "");
});

test("cssText reads the declarations and replaces them when written", () => {
  const s = new CSSStyleDeclaration();
  s.width = "10px";
  s.setProperty("--gap", "2px");
  assert.equal(s.cssText, "width: 10px; --gap: 2px;");
  s.cssText = "position: fixed; background: url(\"a;b.png\"); content: 'x;y'; opacity: 0.5 !important";
  assert.equal(s.width, undefined, "the old declarations are gone");
  assert.equal(s.position, "fixed");
  assert.equal(s.background, "url(\"a;b.png\")", "a semicolon in a url is not a separator");
  assert.equal(s.content, "'x;y'", "nor in a string");
  assert.equal(s.opacity, "0.5");
  assert.equal(s.getPropertyPriority("opacity"), "important");
  assert.equal(s.length, 4);
  assert.deepEqual([...s], ["position", "background", "content", "opacity"]);
  assert.equal(s.item(0), "position");
  assert.equal(s.item(9), "");
});

test("only declarations are own properties: Object.keys sees what was set, never a method", () => {
  const s = new CSSStyleDeclaration();
  s.display = "none";
  s.setProperty("z-index", "3");
  assert.deepEqual(Object.keys(s), ["display", "zIndex"]);
  assert.equal(Object.prototype.toString.call(s), "[object CSSStyleDeclaration]");
});

test("styleDeclaration keeps what a plain style object held", () => {
  const s = styleDeclaration({ marginLeft: "4px", width: "100%" });
  assert.ok(s instanceof CSSStyleDeclaration);
  assert.equal(s.getPropertyValue("margin-left"), "4px");
  assert.equal(styleDeclaration(s), s);
  assert.equal(styleDeclaration(undefined).length, 0);
});

await import("../src/index.js");

test("elements, the document and canvases have one; setAttribute('style') replaces it; getComputedStyle reads it", () => {
  const div = document.createElement("div");
  assert.ok(div.style instanceof CSSStyleDeclaration);
  div.style.setProperty("--width", "200px");
  div.style.display = "none";
  div.setAttribute("style", "padding-left: 3px; width: 10px");
  assert.equal(div.style.display, undefined, "the attribute replaces the inline style, as a browser's does");
  assert.equal(div.style.paddingLeft, "3px");
  assert.equal(globalThis.getComputedStyle(div).paddingLeft, "3px");
  assert.ok(document.style instanceof CSSStyleDeclaration);
  const canvas = document.createElement("canvas");
  assert.ok(canvas.style instanceof CSSStyleDeclaration);
  assert.equal(canvas.style.marginLeft, "4px", "what the runtime's canvas style held is kept");
  canvas.style.setProperty("touch-action", "none");
  assert.equal(canvas.style.touchAction, "none");
  assert.equal(typeof globalThis.CSSStyleDeclaration, "function");
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log("CSS STYLE TEST PASSED");
