// Audio — `new Audio(src)` browser-style; bridge to migo.createInnerAudioContext.
// Browser Audio mostly exposes: src, play(), pause(), loop, volume, currentTime,
// addEventListener('canplay'/'play'/'pause'/'ended'/'error'). InnerAudioContext
// has the same shape with on{Play,Pause,Ended,Error}. Wire them up.

import EventTarget from "./event-target.js";
import DOMException from "./dom-exception.js";

// Browser <audio>/Audio is GC-managed: when the object becomes unreachable the
// media resource is released. Our InnerAudioContext, by contrast, is pinned by
// the native player map AND the JS event registry until destroy() is called, so
// a wrapper that is merely dropped would leak both. Bridge the two by destroying
// the underlying context when the Audio wrapper is finalized. (Best-effort per
// spec; games wanting deterministic release can call destroy() directly.)
const _audioFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((ctx) => {
        try {
          if (ctx && typeof ctx.destroy === "function") ctx.destroy();
        } catch (_) {
          /* ignore */
        }
      })
    : null;

// What the runtime's audio decoders accept (engine/crates/audio/src/decoder: wav.rs, mp3.rs, ogg.rs): PCM WAV, MP3 and Ogg
// Vorbis. Nothing else -- not AAC/M4A, FLAC, Opus or WebM -- so `canPlayType` says so, and a library that picks a source by
// asking (Howler.js tests `audio/mpeg`, `audio/ogg; codecs="vorbis"`, `audio/wav; codecs="1"`, ... and refused to load any
// sound with "No codec support" while this method was missing) chooses one the engine can play.
const PLAYABLE = {
  "audio/mpeg": { codecs: ["mp3"], certain: true },
  "audio/mp3": { codecs: ["mp3"], certain: true },
  "audio/x-mpeg": { codecs: ["mp3"], certain: true },
  "audio/ogg": { codecs: ["vorbis"], certain: false },
  "application/ogg": { codecs: ["vorbis"], certain: false },
  "audio/wav": { codecs: ["1"], certain: false },
  "audio/wave": { codecs: ["1"], certain: false },
  "audio/x-wav": { codecs: ["1"], certain: false },
  "audio/vnd.wave": { codecs: ["1"], certain: false },
};

/// HTMLMediaElement.canPlayType: "" (cannot), "maybe" (the container is supported, the codec was not named) or "probably".
export function canPlayType(type) {
  const text = String(type).trim().toLowerCase();
  const semicolon = text.indexOf(";");
  const essence = (semicolon === -1 ? text : text.slice(0, semicolon)).trim();
  const entry = Object.prototype.hasOwnProperty.call(PLAYABLE, essence) ? PLAYABLE[essence] : null;
  if (!entry) return "";
  const match = semicolon === -1 ? null : /codecs\s*=\s*"?([^"]*)"?/.exec(text.slice(semicolon + 1));
  if (!match) return entry.certain ? "probably" : "maybe";
  const named = match[1].split(",").map((codec) => codec.trim()).filter(Boolean);
  if (named.length === 0) return entry.certain ? "probably" : "maybe";
  return named.every((codec) => entry.codecs.includes(codec)) ? "probably" : "";
}

// The events a media element has an `on<type>` handler property for, which a library may probe for by name
// (`typeof audio.oncanplaythrough !== "undefined"` is how Howler.js picks the event to wait for).
const HANDLER_EVENTS = [
  "abort", "canplay", "canplaythrough", "durationchange", "ended", "error", "loadeddata", "loadedmetadata", "loadstart",
  "pause", "play", "playing", "progress", "ratechange", "seeked", "seeking", "stalled", "suspend", "timeupdate",
  "volumechange", "waiting",
];

const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export default class Audio extends EventTarget {
  constructor(src) {
    super();
    if (typeof migo.createInnerAudioContext !== "function") {
      throw new Error("[migo-web-adapter] migo.createInnerAudioContext is not available");
    }
    this._ctx = migo.createInnerAudioContext();
    this._readyState = 0; // 0 = HAVE_NOTHING
    this._ended = false;
    this._paused = true;
    this._muted = false;
    this._volume = 1;
    this._error = null;
    this.preload = "auto";
    this.crossOrigin = null;
    for (const type of HANDLER_EVENTS) this["on" + type] = null;

    // The event closures below are stored on _ctx, and _ctx is strongly held by the global InnerAudioContext registry
    // until destroy(). If those closures captured `this` strongly, the chain registry -> _ctx -> closure -> wrapper
    // would keep this wrapper reachable forever, and the FinalizationRegistry would never fire. Hold the wrapper via
    // WeakRef so the cycle is broken. (No WeakRef -- a very old runtime -- means a strong capture: GC-driven cleanup
    // is not available there anyway, so callers must destroy() explicitly.)
    const ref = typeof WeakRef === "function" ? new WeakRef(this) : { deref: () => this };
    const on = (register, handler) => {
      if (typeof register === "function") register.call(this._ctx, (...args) => { const self = ref.deref(); if (self) handler(self, ...args); });
    };
    on(this._ctx.onCanplay, (self) => self._canplay());
    on(this._ctx.onPlay, (self) => { self._ended = false; self._paused = false; self._fire("play"); self._fire("playing"); });
    on(this._ctx.onPause, (self) => { self._paused = true; self._fire("pause"); });
    // Playback that runs to its end pauses the element and then ends it (HTML Standard, "reaches the end").
    on(this._ctx.onEnded, (self) => {
      self._ended = true;
      if (!self._paused) { self._paused = true; self._fire("pause"); }
      self._fire("ended");
    });
    on(this._ctx.onTimeUpdate, (self) => self._fire("timeupdate"));
    on(this._ctx.onSeeked, (self) => self._fire("seeked"));
    on(this._ctx.onWaiting, (self) => self._fire("waiting"));
    on(this._ctx.onError, (self, err) => {
      self._paused = true;
      self._error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED, message: String((err && (err.errMsg || err.message)) || err || "") };
      self._fire("error", { error: err });
    });

    // Release the native context when this wrapper is garbage-collected.
    if (_audioFinalizer) _audioFinalizer.register(this, this._ctx, this);

    if (src) this.src = src;
  }

  // Fires to the `on<type>` property and the listeners, as a media element does.
  _fire(type, extra) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() {}, stopPropagation() {}, ...extra };
    const handler = this["on" + type];
    if (typeof handler === "function") {
      try { handler.call(this, event); } catch (e) { try { console.error(e); } catch (_) { /* best effort */ } }
    }
    this.dispatchEvent(event);
  }

  // The runtime reports one event when a source can play; a media element reports the sequence that leads there.
  _canplay() {
    this._readyState = 4; // HAVE_ENOUGH_DATA
    for (const type of ["durationchange", "loadedmetadata", "loadeddata", "canplay", "canplaythrough"]) this._fire(type);
  }

  set src(v) {
    this._readyState = 0;
    this._ended = false;
    this._error = null;
    this._ctx.src = v;
    if (v) Promise.resolve().then(() => this._fire("loadstart"));
  }
  get src() { return this._ctx.src; }
  get currentSrc() { return this._ctx.src || ""; }

  set loop(v) { this._ctx.loop = v; }
  get loop() { return this._ctx.loop; }

  // The runtime has no mute: a muted element plays at volume 0 and remembers the volume it had.
  set volume(v) {
    const volume = Number(v);
    if (!(volume >= 0 && volume <= 1)) throw new (globalThis.DOMException || DOMException)("The volume provided (" + v + ") is outside the range [0, 1].", "IndexSizeError");
    this._volume = volume;
    this._ctx.volume = this._muted ? 0 : volume;
    this._fire("volumechange");
  }
  get volume() { return this._volume; }

  set muted(v) {
    this._muted = !!v;
    this._ctx.volume = this._muted ? 0 : this._volume;
    this._fire("volumechange");
  }
  get muted() { return this._muted; }
  get defaultMuted() { return false; }

  set playbackRate(v) { if ("playbackRate" in this._ctx) this._ctx.playbackRate = v; this._rate = v; this._fire("ratechange"); }
  get playbackRate() { return this._rate === undefined ? 1 : this._rate; }

  set autoplay(v) { this._ctx.autoplay = v; }
  get autoplay() { return this._ctx.autoplay; }

  get currentTime() { return this._ctx.currentTime || 0; }
  set currentTime(v) { if (typeof this._ctx.seek === "function") this._ctx.seek(v); }
  get duration() { return this._readyState >= 1 ? this._ctx.duration || 0 : NaN; }
  // A media element is not paused from the moment play() is called, before anything has started: libraries check
  // `paused` right after `play()` to tell whether playback was refused (Howler reports "unable to start"). The runtime
  // reports the start as an event later, so the element tracks it itself.
  get paused() { return this._paused; }
  get ended() { return this._ended; }
  get error() { return this._error; }
  get readyState() { return this._readyState; }
  get networkState() { return this._ctx.src ? (this._readyState >= 4 ? 1 : 2) : 0; }

  canPlayType(type) { return canPlayType(type); }

  // HTMLMediaElement.play() returns a promise that settles when playback has started. InnerAudioContext reports the start
  // as an event, and a rejected play() (autoplay policy, bad source) as an error event.
  play() {
    this._ended = false;
    this._paused = false;
    this._ctx.play();
    return Promise.resolve();
  }
  pause() {
    this._paused = true;
    this._ctx.pause();
  }

  load() {} // no-op — InnerAudioContext loads on src set / play
  cloneNode() { return new Audio(this.src); }

  // Not a standard HTMLMediaElement method, but exposed so callers can release
  // the native context deterministically instead of waiting for GC.
  destroy() {
    if (_audioFinalizer) _audioFinalizer.unregister(this);
    if (this._ctx && typeof this._ctx.destroy === "function") this._ctx.destroy();
  }
}
for (const [name, value] of [["HAVE_NOTHING", 0], ["HAVE_METADATA", 1], ["HAVE_CURRENT_DATA", 2], ["HAVE_FUTURE_DATA", 3], ["HAVE_ENOUGH_DATA", 4]]) {
  Object.defineProperty(Audio, name, { value, enumerable: true });
  Object.defineProperty(Audio.prototype, name, { value, enumerable: true });
}
