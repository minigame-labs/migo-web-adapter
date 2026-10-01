// The DOM's `Touch`, for the points the host reports.
//
// The host's touch objects follow the mini-game platform contract: `identifier`, `clientX`, `clientY`, `pageX`, `pageY`
// and `force`. A browser's `Touch` also has the element the touch began on (`target`) and the screen coordinates and
// contact ellipse. Engines read `target`: Phaser 3 takes its pointer's `downElement` from it, and a scene's
// `input.on('pointerdown', ...)` is emitted only when `downElement` is the game's canvas -- without a target that
// listener never fired, on any tap, while a game object's own `pointerdown` did.

export class Touch {
  constructor(target, source) {
    this.identifier = source.identifier;
    this.target = target;
    this.clientX = source.clientX;
    this.clientY = source.clientY;
    this.pageX = source.pageX === undefined ? source.clientX : source.pageX;
    this.pageY = source.pageY === undefined ? source.clientY : source.pageY;
    // The app owns the whole screen, so a screen coordinate is the client one.
    this.screenX = source.screenX === undefined ? source.clientX : source.screenX;
    this.screenY = source.screenY === undefined ? source.clientY : source.screenY;
    this.radiusX = source.radiusX || 0;
    this.radiusY = source.radiusY || 0;
    this.rotationAngle = source.rotationAngle || 0;
    this.force = source.force || 0;
  }
}

/// A `TouchList` for `sources` (array-like, may be absent): an array with the DOM's `item(i)`.
export function touchList(target, sources) {
  const list = [];
  if (sources) {
    for (let i = 0; i < sources.length; i++) list.push(new Touch(target, sources[i]));
  }
  Object.defineProperty(list, "item", { value: (i) => list[i] || null });
  return list;
}
