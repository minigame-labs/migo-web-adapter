// The media element the adapter gives engines, over a fake InnerAudioContext: the event sequence of a load, the on<type>
// handler properties, mute, volume, ended, error.

import assert from "node:assert/strict";

const contexts = [];
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
  createInnerAudioContext: () => {
    const ctx = {
      src: "", loop: false, volume: 1, autoplay: false, currentTime: 0, duration: 0.25, paused: true, playbackRate: 1, handlers: {},
      onCanplay(cb) { this.handlers.canplay = cb; }, onPlay(cb) { this.handlers.play = cb; }, onPause(cb) { this.handlers.pause = cb; },
      onEnded(cb) { this.handlers.ended = cb; }, onError(cb) { this.handlers.error = cb; }, onTimeUpdate(cb) { this.handlers.timeupdate = cb; },
      onSeeked(cb) { this.handlers.seeked = cb; }, onWaiting(cb) { this.handlers.waiting = cb; },
      play() { this.paused = false; queueMicrotask(() => this.handlers.play()); }, pause() { this.paused = true; queueMicrotask(() => this.handlers.pause()); }, seek() {}, destroy() {},
    };
    contexts.push(ctx);
    return ctx;
  },
};
await import("../src/index.js");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const audio = new globalThis.Audio();
const ctx = contexts.at(-1);
const seen = [];
for (const type of ["loadstart", "durationchange", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "play", "playing", "pause", "ended", "error", "volumechange"]) {
  audio.addEventListener(type, () => seen.push(type));
}

assert.equal(typeof audio.oncanplaythrough, "object", "on<type> handler properties exist (null): Howler probes oncanplaythrough by name");
assert.ok(Number.isNaN(audio.duration), "no duration before metadata");
assert.equal(audio.readyState, 0);

audio.src = "assets/tone.wav";
await flush();
assert.deepEqual(seen, ["loadstart"]);
ctx.handlers.canplay();
assert.deepEqual(seen, ["loadstart", "durationchange", "loadedmetadata", "loadeddata", "canplay", "canplaythrough"], "a load reports the sequence a browser does");
assert.equal(audio.readyState, 4);
assert.equal(audio.duration, 0.25);
assert.equal(audio.canPlayType("audio/wav; codecs=1"), "probably");

seen.length = 0;
let viaProperty = 0;
audio.onplay = () => viaProperty++;
assert.equal(audio.paused, true, "a new element is paused");
const playing = audio.play();
assert.equal(audio.paused, false, "paused is false as soon as play() returns, before the runtime reports the start: Howler checks it there");
await playing;
assert.deepEqual(seen, ["play", "playing"]);
assert.equal(viaProperty, 1, "the on<type> property is called too");
audio.pause();
assert.equal(audio.paused, true);

seen.length = 0;
audio.play();
seen.length = 0;
ctx.handlers.ended();
assert.equal(audio.ended, true);
assert.equal(audio.paused, true, "running to the end pauses the element");
assert.deepEqual(seen, ["pause", "ended"], "pause, then ended");
audio.play();
assert.equal(audio.ended, false, "playing again clears ended");

audio.volume = 0.5;
audio.muted = true;
assert.equal(ctx.volume, 0, "muted plays at volume 0");
assert.equal(audio.volume, 0.5, "and remembers its volume");
assert.equal(audio.muted, true);
audio.muted = false;
assert.equal(ctx.volume, 0.5);
assert.throws(() => { audio.volume = 2; }, (e) => e.name === "IndexSizeError");

seen.length = 0;
ctx.handlers.error({ errMsg: "decode fail" });
assert.deepEqual(seen, ["error"]);
assert.equal(audio.error.code, 4);
assert.match(audio.error.message, /decode fail/);
audio.src = "other.wav";
assert.equal(audio.error, null, "a new source clears the error");
assert.equal(audio.readyState, 0);

console.log("audio-element tests: all passed");
