// BOM window-metrics globals: innerWidth/innerHeight/outerWidth/outerHeight,
// screenWidth/screenHeight, devicePixelRatio, and a screen object.
//
// Semantics match the canonical mini-game adapter (verified against the
// reference adapter source): one-shot snapshot at adapter load, exposed as
// writable data properties on globalThis. Assignment by game code persists
// (we do NOT subscribe to host resize events and overwrite). Games that need
// live window metrics call migo.getWindowInfo() / migo.getSystemInfoSync()
// directly -- the same expectation the canonical adapter sets.

const _info = (() => {
  // Prefer getWindowInfo (newer, returns windowWidth/Height); fall back to
  // getSystemInfoSync for older runtimes.
  try {
    if (typeof migo.getWindowInfo === "function") return migo.getWindowInfo();
  } catch {}
  try {
    if (typeof migo.getSystemInfoSync === "function") return migo.getSystemInfoSync();
  } catch {}
  return { windowWidth: 0, windowHeight: 0, screenWidth: 0, screenHeight: 0, pixelRatio: 1 };
})();

// Browser-faithful window metrics: LOGICAL/CSS innerWidth/Height plus the REAL
// devicePixelRatio -- exactly what a real browser (the WebView baseline) reports
// and what the canonical WeChat adapter exposes. A DPR-naive engine (Pixi/Phaser
// created with resolution = 1) then renders into a logical-sized backing store,
// identical to the WebView baseline: migo gives the presented canvas that logical
// size until the content sizes it, and upscales it to the physical surface at swap
// time (the way a browser CSS-scales a logical canvas to fill the display), so both
// the on-screen result and the rendering workload match WebView.
//
// Whole CSS pixels. CSSOM View makes the viewport and the screen `long`s, and a
// display whose density is not a whole number (2.625, 2.75, 3.5 -- common on
// Android) has a fractional CSS width, which a browser rounds. The host's window
// info keeps the fraction (the mini-game API reports it), so it is rounded here,
// the same way migo rounds the presented canvas's default size (physical / ratio).
// The two then agree: a game that sizes its canvas, or its stage, to innerWidth
// gets the canvas it already has. Passed through, 1080 px at 2.625 made innerWidth
// 411.43 against a 411-wide canvas; p5 then sized its pixel array off the fraction
// and Egret laid its stage out a pixel past the canvas.
const cssPixels = (value) => Math.round(value);
export const innerWidth = cssPixels(_info.windowWidth || _info.screenWidth || 0);
export const innerHeight = cssPixels(_info.windowHeight || _info.screenHeight || 0);
export const outerWidth = innerWidth;
export const outerHeight = innerHeight;
export const screenWidth = cssPixels(_info.screenWidth || innerWidth);
export const screenHeight = cssPixels(_info.screenHeight || innerHeight);
export const devicePixelRatio = _info.pixelRatio || 1;

export const screen = {
  width: screenWidth,
  height: screenHeight,
  availWidth: innerWidth,
  availHeight: innerHeight,
  availLeft: 0,
  availTop: 0,
  orientation: { angle: 0, type: innerWidth > innerHeight ? "landscape-primary" : "portrait-primary" },
};
