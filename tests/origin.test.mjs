// The game sits at a virtual origin whose root is the package root (src/origin.js): a relative path resolved against
// document.baseURI comes back as a URL every loader here reads from the package. PixiJS v8 joins asset paths onto
// document.baseURI; with "game.js" as the base it asked for `game.js/assets/...` and loaded nothing.
import assert from "node:assert/strict";
import { ORIGIN, BASE_URI, withinPackage } from "../src/origin.js";
import { kindOf, packagePath } from "../src/resource.js";

assert.equal(ORIGIN, "https://game");
assert.equal(BASE_URI, "https://game/");
assert.equal(withinPackage("https://game/assets/a.png"), "/assets/a.png");
assert.equal(withinPackage("HTTPS://GAME/assets/a.png"), "/assets/a.png", "scheme and host are case-insensitive");
assert.equal(withinPackage("https://game"), "/");
assert.equal(withinPackage("https://game/"), "/");
for (const other of ["https://gamex/a.png", "https://example.com/game/a.png", "assets/a.png", "/assets/a.png", "data:,x", "blob:abc"]) {
  assert.equal(withinPackage(other), other, `not the game's origin: ${other}`);
}
assert.equal(withinPackage(undefined), undefined);

// What a URL on the origin turns into is a package path the resource layer reads, not a request to the network.
const mapped = withinPackage("https://game/assets/preload/a.json?v=2#x");
assert.equal(kindOf(mapped), "file");
assert.equal(packagePath(mapped), "assets/preload/a.json");
assert.equal(kindOf("https://game.example/a.json"), "http", "a real host stays the network");

// document.baseURI is the origin root, and PixiJS's own join produces a URL on it for a relative asset path.
const { default: document } = await import("../src/document.js");
assert.equal(document.baseURI, BASE_URI);
const joined = new URL("assets/preload/a.json", document.baseURI).href;
assert.equal(withinPackage(joined), "/assets/preload/a.json");

console.log("origin: PASS");
