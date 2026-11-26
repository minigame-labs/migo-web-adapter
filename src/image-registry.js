// The host images `new Image()` has handed out (image.js), so `instanceof HTMLImageElement` (element.js) can know them:
// a host image is not in the adapter's class hierarchy. Its own module, so the two need not import each other.
export const hostImages = new WeakSet();
