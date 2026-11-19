// A <video> this adapter cannot play says so the way a browser says it about a format it lacks, and an element leaves
// its parent through remove(). PixiJS v8 asks a <video> what it can play while its asset system starts, and removes the
// elements it made with remove(): without them a game never left its loading screen.
import assert from "node:assert/strict";
import { HTMLMediaElement, HTMLVideoElement } from "../src/element.js";
import HTMLElement from "../src/element.js";

const video = new HTMLVideoElement();
assert.ok(video instanceof HTMLMediaElement, "a video is a media element");
assert.equal(video.tagName, "VIDEO");
for (const type of ["video/mp4", 'video/mp4; codecs="avc1.42E01E"', "video/webm", "video/ogg", "", "audio/mpeg"]) {
  assert.equal(video.canPlayType(type), "", `nothing plays here: ${JSON.stringify(type)}`);
}
assert.equal(video.readyState, 0, "HAVE_NOTHING");
assert.equal(video.networkState, 0, "NETWORK_EMPTY before a source");
assert.equal(video.paused, true);

// A source fails after the assignment returns, with MEDIA_ERR_SRC_NOT_SUPPORTED, through the handler and the listener.
let handled = 0;
let heard = null;
video.onerror = () => { handled += 1; };
video.addEventListener("error", (event) => { heard = event; });
video.src = "clip.mp4";
assert.equal(video.src, "clip.mp4");
assert.equal(handled, 0, "not synchronously");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(handled, 1);
assert.ok(heard && heard.type === "error" && heard.target === video);
assert.equal(video.error.code, HTMLMediaElement.MEDIA_ERR_SRC_NOT_SUPPORTED);
assert.equal(video.networkState, 3, "NETWORK_NO_SOURCE once refused");

// play() rejects rather than pretending to start.
await assert.rejects(video.play(), (error) => error.name === "NotSupportedError");

// setAttribute("src", ...) is the same assignment.
const other = new HTMLVideoElement();
let refused = false;
other.onerror = () => { refused = true; };
other.setAttribute("src", "x.webm");
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(refused, true);

// remove(): out of the parent; a second call, or one on a detached element, does nothing.
const parent = new HTMLElement("div");
const child = new HTMLElement("span");
parent.appendChild(child);
child.remove();
assert.equal(parent.children.length, 0);
assert.equal(child.parentNode, null);
child.remove();
new HTMLElement("p").remove();

console.log("media element: PASS");
