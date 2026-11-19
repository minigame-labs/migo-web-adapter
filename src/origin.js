// The game's own origin. A browser page sits at a URL; a Migo game sits in a package. This adapter gives the page a
// virtual origin, https://game, whose root is the package root -- the model resource.js already reads `/assets/a.png`
// by -- so an engine that resolves a relative path against the document gets a URL the adapter can still load:
// `https://game/assets/a.png` is the package's `assets/a.png`, never a request to a host called "game".
//
// document.baseURI is that origin's root. PixiJS v8 joins every asset path onto document.baseURI, and given the old
// location.href ("game.js") as its base it asked for `game.js/assets/preload/...`: a game's whole first bundle failed
// to load and it never left its loading screen.

export const ORIGIN = "https://game";
export const BASE_URI = ORIGIN + "/";

/// A URL on the game's origin as the origin-relative package path it names (`https://game/assets/a.png` ->
/// `/assets/a.png`, scheme and host matched case-insensitively); any other value unchanged.
export function withinPackage(url) {
  if (typeof url !== "string") return url;
  const head = url.slice(0, BASE_URI.length).toLowerCase();
  if (head === BASE_URI) return url.slice(ORIGIN.length);
  if (url.toLowerCase() === ORIGIN) return "/";
  return url;
}
