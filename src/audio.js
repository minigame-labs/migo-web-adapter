// Audio — `new Audio(src)` browser-style; bridge to migo.createInnerAudioContext.
// Browser Audio mostly exposes: src, play(), pause(), loop, volume, currentTime,
// addEventListener('canplay'/'play'/'pause'/'ended'/'error'). InnerAudioContext
// has the same shape with on{Play,Pause,Ended,Error}. Wire them up.

import EventTarget from "./event-target.js";

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

export default class Audio extends EventTarget {
  constructor(src) {
    super();
    if (typeof migo.createInnerAudioContext !== "function") {
      throw new Error("[migo-web-adapter] migo.createInnerAudioContext is not available");
    }
    this._ctx = migo.createInnerAudioContext();
    this._readyState = 0; // 0 = HAVE_NOTHING

    // The event closures below are stored on _ctx, and _ctx is strongly held by
    // the global InnerAudioContext registry until destroy(). If those closures
    // captured `this` strongly, the chain registry -> _ctx -> closure -> wrapper
    // would keep this wrapper reachable forever, and the FinalizationRegistry
    // would never fire. Hold the wrapper via WeakRef so the cycle is broken.
    if (typeof WeakRef === "function") {
      const selfRef = new WeakRef(this);
      const dispatchSelf = (type) => () => {
        const self = selfRef.deref();
        if (!self) return;
        if (type === "canplay") self._readyState = 4;
        self.dispatchEvent({ type });
      };
      this._ctx.onCanplay && this._ctx.onCanplay(dispatchSelf("canplay"));
      this._ctx.onPlay && this._ctx.onPlay(dispatchSelf("play"));
      this._ctx.onPause && this._ctx.onPause(dispatchSelf("pause"));
      this._ctx.onEnded && this._ctx.onEnded(dispatchSelf("ended"));
      this._ctx.onError && this._ctx.onError((err) => {
        const self = selfRef.deref();
        if (self) self.dispatchEvent({ type: "error", error: err });
      });
    } else {
      // No WeakRef (very old runtime): strong capture — GC-driven cleanup isn't
      // available here anyway, so callers must destroy() explicitly.
      const dispatchSelf = (type) => () => {
        if (type === "canplay") this._readyState = 4;
        this.dispatchEvent({ type });
      };
      this._ctx.onCanplay && this._ctx.onCanplay(dispatchSelf("canplay"));
      this._ctx.onPlay && this._ctx.onPlay(dispatchSelf("play"));
      this._ctx.onPause && this._ctx.onPause(dispatchSelf("pause"));
      this._ctx.onEnded && this._ctx.onEnded(dispatchSelf("ended"));
      this._ctx.onError && this._ctx.onError((err) => this.dispatchEvent({ type: "error", error: err }));
    }

    // Release the native context when this wrapper is garbage-collected.
    if (_audioFinalizer) _audioFinalizer.register(this, this._ctx, this);

    if (src) this.src = src;
  }

  set src(v) { this._ctx.src = v; }
  get src() { return this._ctx.src; }

  set loop(v) { this._ctx.loop = v; }
  get loop() { return this._ctx.loop; }

  set volume(v) { this._ctx.volume = v; }
  get volume() { return this._ctx.volume; }

  set autoplay(v) { this._ctx.autoplay = v; }
  get autoplay() { return this._ctx.autoplay; }

  get currentTime() { return this._ctx.currentTime || 0; }
  set currentTime(v) { if (typeof this._ctx.seek === "function") this._ctx.seek(v); }
  get duration() { return this._ctx.duration || 0; }
  get paused() { return !!this._ctx.paused; }
  get readyState() { return this._readyState; }

  canPlayType(type) { return canPlayType(type); }

  // HTMLMediaElement.play() returns a promise that settles when playback has started. InnerAudioContext reports the start
  // as an event, and a rejected play() (autoplay policy, bad source) as an error event.
  play() {
    this._ctx.play();
    return Promise.resolve();
  }
  pause() { this._ctx.pause(); }

  load() {} // no-op — InnerAudioContext loads on src set / play
  cloneNode() { return new Audio(this.src); }

  // Not a standard HTMLMediaElement method, but exposed so callers can release
  // the native context deterministically instead of waiting for GC.
  destroy() {
    if (_audioFinalizer) _audioFinalizer.unregister(this);
    if (this._ctx && typeof this._ctx.destroy === "function") this._ctx.destroy();
  }
}
