// The page's location. A Migo game has no URL of its own; it sits at the game's origin (origin.js), and its page is the
// package's game.js there. Like a browser's, href is absolute: content resolves URLs against it (a Unity build's loader
// joins its StreamingAssets path onto document.URL), and "game.js" as a base is no URL at all -- `new URL(x, "game.js")`
// throws.

import { ORIGIN } from "./origin.js";

const location = {
  href: ORIGIN + "/game.js",
  protocol: "https:",
  host: "game",
  hostname: "game",
  port: "",
  pathname: "/game.js",
  search: "",
  hash: "",
  origin: ORIGIN,
  reload() {},
  replace() {},
  assign() {},
  toString() { return this.href; },
};

export default location;
