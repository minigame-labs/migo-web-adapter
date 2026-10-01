// canPlayType answers for what the runtime's decoders accept (PCM WAV, MP3, Ogg Vorbis) and nothing else.

import assert from "node:assert/strict";
import { canPlayType } from "../src/audio.js";

const probably = ["audio/mpeg", "audio/mp3", 'audio/mpeg; codecs="mp3"', 'audio/ogg; codecs="vorbis"', 'audio/wav; codecs="1"', 'audio/wav; codecs=1', 'AUDIO/WAV; CODECS="1"', 'audio/ogg; codecs="vorbis, vorbis"'];
const maybe = ["audio/ogg", "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave", "application/ogg"];
const no = ['audio/ogg; codecs="opus"', "audio/opus", "audio/aac", "audio/mp4", 'audio/mp4; codecs="mp4a.40.2"', "audio/x-m4a", "audio/flac", "audio/webm", 'audio/webm; codecs="opus"', "audio/3gpp", "video/mp4", "", "nonsense", 'audio/wav; codecs="1, 85"', 'audio/mpeg; codecs="mp4a.40.2"'];

for (const t of probably) assert.equal(canPlayType(t), "probably", t);
for (const t of maybe) assert.equal(canPlayType(t), "maybe", t);
for (const t of no) assert.equal(canPlayType(t), "", JSON.stringify(t));
assert.equal(canPlayType(undefined), "", "undefined is the string 'undefined': not a type");

console.log("audio-can-play-type tests: all passed");
