// An HTML fragment, parsed into the adapter's nodes: what `insertAdjacentHTML` is handed.
//
// Not the specification's HTML parser -- there is no tree construction's error recovery here, no foster parenting and no
// implied end tags beyond the void elements -- but the markup a page's scripts write into it at run time: elements with
// attributes (double-quoted, single-quoted, unquoted or bare; the first of a repeated name wins), text, character
// references, comments (dropped), and the raw-text elements whose content is not markup. Defold's loader inserts its
// progress bar this way, and an exception there stopped the game before its engine was fetched.
//
// As in a browser, a <script> that arrives as markup is marked already started and never runs, wherever it is inserted.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Raw text: the content up to the matching end tag is text. RCDATA (title, textarea) decodes character references in it.
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const RCDATA = new Set(["title", "textarea"]);
// The named references markup written by scripts uses; any other `&name;` is left as it is written.
const NAMED = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: '"', QUOT: '"', apos: "'", nbsp: " ", copy: "©",
  reg: "®", hellip: "…", mdash: "—", ndash: "–", times: "×",
};

export function decodeCharacterReferences(text) {
  return String(text).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!(code > 0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, ref) ? NAMED[ref] : whole;
  });
}

const tagOf = (node) => (node && typeof node.tagName === "string" ? node.tagName.toLowerCase() : "");

function setAttribute(element, name, value) {
  if (typeof element.setAttribute === "function") {
    element.setAttribute(name, value);
  } else if (name === "id") {
    element.id = value;
  } else if (name === "class") {
    element.className = value;
  } else if (name === "style" && element.style && "cssText" in element.style) {
    element.style.cssText = value;
  } else if (/^[a-z_$][a-z0-9_$]*$/.test(name)) {
    element[name] = value;
  }
}

// The nodes `html` describes, in order, each with its descendants; made with `document`'s factories and joined with
// `appendChildTo(parent, child)` (a host canvas has no appendChild of its own).
export function parseHtmlFragment(html, document, appendChildTo = (parent, child) => parent.appendChild(child)) {
  const s = String(html);
  const roots = [];
  const open = [];
  const append = (node) => {
    const parent = open[open.length - 1];
    if (parent) appendChildTo(parent, node);
    else roots.push(node);
  };
  const text = (data) => { if (data) append(document.createTextNode(data)); };
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { text(decodeCharacterReferences(s.slice(i))); break; }
    if (lt > i) { text(decodeCharacterReferences(s.slice(i, lt))); i = lt; }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    const next = s[i + 1];
    if (next === "!" || next === "?") {
      const end = s.indexOf(">", i);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (next === "/") {
      const end = /^<\/([A-Za-z][^\s/>]*)[^>]*(>|$)/.exec(s.slice(i));
      if (!end) { text("<"); i += 1; continue; }
      const name = end[1].toLowerCase();
      for (let k = open.length - 1; k >= 0; k--) {
        if (tagOf(open[k]) === name) { open.length = k; break; }
      }
      i += end[0].length;
      continue;
    }
    const start = /^<([A-Za-z][^\s/>]*)/.exec(s.slice(i));
    if (!start) { text("<"); i += 1; continue; }
    const name = start[1].toLowerCase();
    i += start[0].length;
    const attributes = [];
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === ">") { i++; break; }
      if (s[i] === "/") { i++; continue; } // `<div/>` is an open div in HTML: the solidus is ignored
      const attr = /^[^\s/>][^\s/>=]*/.exec(s.slice(i));
      if (!attr) { i++; continue; }
      const attrName = attr[0].toLowerCase();
      i += attr[0].length;
      while (i < s.length && /\s/.test(s[i])) i++;
      let value = "";
      if (s[i] === "=") {
        i++;
        while (i < s.length && /\s/.test(s[i])) i++;
        const quote = s[i];
        if (quote === '"' || quote === "'") {
          const end = s.indexOf(quote, i + 1);
          value = s.slice(i + 1, end === -1 ? s.length : end);
          i = end === -1 ? s.length : end + 1;
        } else {
          value = /^[^\s>]*/.exec(s.slice(i))[0];
          i += value.length;
        }
        value = decodeCharacterReferences(value);
      }
      if (!attributes.some(([n]) => n === attrName)) attributes.push([attrName, value]);
    }
    const element = document.createElement(name);
    if (name === "script") element._migoLoaded = true;
    for (const [n, v] of attributes) setAttribute(element, n, v);
    append(element);
    if (RAW_TEXT.has(name) || RCDATA.has(name)) {
      const rest = s.slice(i);
      const close = new RegExp(`</${name}(?=[\\s/>]|$)`, "i").exec(rest);
      const content = rest.slice(0, close ? close.index : rest.length);
      if (content) appendChildTo(element, document.createTextNode(RCDATA.has(name) ? decodeCharacterReferences(content) : content));
      if (!close) break;
      const gt = s.indexOf(">", i + close.index);
      i = gt === -1 ? s.length : gt + 1;
      continue;
    }
    if (!VOID.has(name)) open.push(element);
  }
  return roots;
}
