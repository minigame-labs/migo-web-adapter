// `window.getComputedStyle`, for the one layout this adapter has: every element fills the viewport at the origin,
// with no padding, border or margin (see HTMLElement's client/offset metrics and getBoundingClientRect).
//
// Engines read it to turn a touch's page coordinates into canvas coordinates. EaselJS subtracts the canvas's
// padding and border from its bounding rectangle on every pointer event (`Stage._getElementRect`), so without
// this its handler threw on every tap and no display object ever heard a click. The values are the used ones a
// browser would report for that layout: lengths in px, the inline style a game set where it set one.
const DEFAULTS = {
  display: "block", position: "static", visibility: "visible", opacity: "1", transform: "none", boxSizing: "content-box",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
  marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
};

const camel = (name) => String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (name) => String(name).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export function getComputedStyle(element) {
  const inline = (element && element.style) || {};
  const values = { ...DEFAULTS };
  for (const key of Object.keys(inline)) {
    const value = inline[key];
    if (typeof value === "string" && value !== "") values[key] = value;
  }
  // Width and height are the layout's, not the declaration's: `100%` or `100vw` computes to the px it fills.
  values.width = `${(element && element.clientWidth) || 0}px`;
  values.height = `${(element && element.clientHeight) || 0}px`;
  const declaration = {
    ...values,
    get length() { return Object.keys(values).length; },
    item(index) { const key = Object.keys(values)[index]; return key === undefined ? "" : kebab(key); },
    getPropertyValue(name) { const value = values[camel(name)]; return value === undefined ? "" : value; },
    getPropertyPriority() { return ""; },
  };
  return declaration;
}
