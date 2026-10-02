// DOMParser and XMLSerializer, for XML.
//
// Egret builds a DOMParser while its web platform loads and parses every bitmap font and XML asset with it; Cocos's SAXParser and
// Laya's XML utilities use the same pair for .fnt, .tmx and .plist files. The runtime has no DOM, so a parser has to come with the
// adapter. It is the XML half of the interface: `text/xml`, `application/xml`, `application/xhtml+xml` and `image/svg+xml` are parsed
// as XML; `text/html` throws NotSupportedError rather than answering a tree that is not an HTML document.
//
// What it builds is the DOM a script reads an XML file with: a document with `documentElement` and `childNodes`; elements with
// `nodeName`, `localName`, `namespaceURI`, `attributes` (array-like, `name` / `value`), `getAttribute`, `childNodes`, the sibling and
// parent links, `textContent`, `getElementsByTagName`; text, CDATA, comment and processing-instruction nodes. Not built: the
// DOCTYPE node (read and dropped), entity declarations (an entity other than the five and the numeric ones is a parse error), and
// anything that mutates the tree. A document that is not well-formed answers, as Chrome and Firefox do, a document whose root is a
// <parsererror> element carrying the message, not an exception: callers test for it by tag name.

const ELEMENT = 1, ATTRIBUTE = 2, TEXT = 3, CDATA = 4, PROCESSING_INSTRUCTION = 7, COMMENT = 8, DOCUMENT = 9;
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const PARSER_ERROR_NAMESPACE = "http://www.mozilla.org/newlayout/xml/parsererror.xml";

class XMLNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.parentNode = null;
    this.ownerDocument = null;
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get previousSibling() { return this._sibling(-1); }
  get nextSibling() { return this._sibling(1); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === ELEMENT ? this.parentNode : null; }
  get nodeValue() { return null; }
  get textContent() {
    let out = "";
    for (const child of this.childNodes) {
      if (child.nodeType === TEXT || child.nodeType === CDATA) out += child.data;
      else if (child.nodeType === ELEMENT) out += child.textContent;
    }
    return out;
  }
  hasChildNodes() { return this.childNodes.length > 0; }
  _sibling(step) {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + step] || null;
  }
  _append(child) {
    child.parentNode = this;
    this.childNodes.push(child);
  }
}

class XMLCharacterData extends XMLNode {
  constructor(nodeType, nodeName, data) {
    super(nodeType, nodeName);
    this.data = data;
  }
  get nodeValue() { return this.data; }
  get textContent() { return this.data; }
  get length() { return this.data.length; }
}

class XMLText extends XMLCharacterData {
  constructor(data) { super(TEXT, "#text", data); }
  get wholeText() { return this.data; }
}
class XMLCDATASection extends XMLCharacterData {
  constructor(data) { super(CDATA, "#cdata-section", data); }
}
class XMLComment extends XMLCharacterData {
  constructor(data) { super(COMMENT, "#comment", data); }
}
class XMLProcessingInstruction extends XMLCharacterData {
  constructor(target, data) { super(PROCESSING_INSTRUCTION, target, data); this.target = target; }
}

class XMLAttr {
  constructor(name, value, namespaceURI, ownerElement) {
    this.nodeType = ATTRIBUTE;
    this.name = name;
    this.nodeName = name;
    this.localName = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    this.prefix = name.includes(":") ? name.slice(0, name.indexOf(":")) : null;
    this.namespaceURI = namespaceURI;
    this.value = value;
    this.nodeValue = value;
    this.textContent = value;
    this.ownerElement = ownerElement;
    this.specified = true;
  }
}

class XMLElement extends XMLNode {
  constructor(name, namespaceURI) {
    super(ELEMENT, name);
    this.tagName = name;
    this.localName = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    this.prefix = name.includes(":") ? name.slice(0, name.indexOf(":")) : null;
    this.namespaceURI = namespaceURI;
    this.attributes = [];
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === ELEMENT); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  getAttribute(name) {
    const attr = this.getAttributeNode(name);
    return attr ? attr.value : null;
  }
  getAttributeNode(name) { return this.attributes.find((a) => a.name === name) || null; }
  hasAttribute(name) { return this.getAttributeNode(name) !== null; }
  hasAttributes() { return this.attributes.length > 0; }
  getAttributeNS(namespaceURI, localName) {
    const attr = this.attributes.find((a) => a.localName === localName && (a.namespaceURI || null) === (namespaceURI || null));
    return attr ? attr.value : null;
  }
  getElementsByTagName(name) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT) continue;
        if (name === "*" || child.nodeName === name) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

class XMLDocument extends XMLNode {
  constructor() {
    super(DOCUMENT, "#document");
    this.ownerDocument = null;
    this.xmlStandalone = false;
    this.xmlVersion = "1.0";
    this.inputEncoding = "UTF-8";
    this.contentType = "application/xml";
  }
  get documentElement() { return this.childNodes.find((n) => n.nodeType === ELEMENT) || null; }
  getElementsByTagName(name) {
    const root = this.documentElement;
    if (!root) return [];
    return (name === "*" || root.nodeName === name ? [root] : []).concat(root.getElementsByTagName(name));
  }
  getElementById(id) {
    const find = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT) continue;
        if (child.getAttribute("id") === id) return child;
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(this);
  }
}

class XMLParseError extends Error {}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[-A-Za-z0-9_:.·À-￿]/;
const NAMED_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text, fail) {
  if (!text.includes("&")) return text;
  // One pass over the raw text: an '&' that does not begin a reference is an error, and what a reference decodes to is never
  // looked at again (`&amp;lt;` is the text "&lt;").
  return text.replace(/&(?:(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z_][-A-Za-z0-9_.]*);)?/g, (whole, body) => {
    if (body === undefined) {
      fail("a bare '&' (write it as &amp;)");
      return whole;
    }
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code < 0xe000)) fail(`the character reference ${whole} is not a character`);
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED_ENTITIES)) fail(`the entity ${whole} is not defined`);
    return NAMED_ENTITIES[body];
  });
}

// Parse `source` into an XMLDocument, or throw XMLParseError saying where it stopped.
function parseXML(source) {
  const doc = new XMLDocument();
  let at = 0;
  const line = () => 1 + (source.slice(0, at).match(/\n/g) || []).length;
  const fail = (message) => { throw new XMLParseError(`${message} (line ${line()})`); };
  const startsWith = (s) => source.startsWith(s, at);
  const skipSpace = () => { while (at < source.length && /[ \t\r\n]/.test(source[at])) at += 1; };
  const readName = () => {
    if (!NAME_START.test(source[at] || "")) fail("a name was expected");
    const from = at;
    at += 1;
    while (at < source.length && NAME_CHAR.test(source[at])) at += 1;
    return source.slice(from, at);
  };
  const until = (terminator, what) => {
    const end = source.indexOf(terminator, at);
    if (end === -1) fail(`${what} is not closed`);
    const text = source.slice(at, end);
    at = end + terminator.length;
    return text;
  };

  if (source.charCodeAt(0) === 0xfeff) at = 1;
  const stack = [];                       // open elements
  const scopes = [{ xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE }];
  let current = doc;
  let sawRoot = false;
  let rootClosed = false;

  if (startsWith("<?xml") && /[ \t\r\n?]/.test(source[at + 5] || "")) {
    const declaration = until("?>", "the XML declaration");
    const standalone = /standalone\s*=\s*["']yes["']/.exec(declaration);
    doc.xmlStandalone = !!standalone;
    const version = /version\s*=\s*["']([^"']*)["']/.exec(declaration);
    if (version) doc.xmlVersion = version[1];
  }

  while (at < source.length) {
    if (source[at] !== "<") {
      const end = source.indexOf("<", at);
      const raw = source.slice(at, end === -1 ? source.length : end);
      at = end === -1 ? source.length : end;
      if (!current || current === doc) {
        if (raw.trim() !== "") fail("text is not allowed outside the root element");
        continue;
      }
      if (raw.includes("]]>")) fail("']]>' is not allowed in text");
      current._append(Object.assign(new XMLText(decode(raw, fail)), { ownerDocument: doc }));
      continue;
    }
    if (startsWith("<!--")) {
      at += 4;
      const text = until("-->", "a comment");
      current._append(Object.assign(new XMLComment(text), { ownerDocument: doc }));
    } else if (startsWith("<![CDATA[")) {
      if (current === doc) fail("CDATA is not allowed outside the root element");
      at += 9;
      const text = until("]]>", "a CDATA section");
      current._append(Object.assign(new XMLCDATASection(text), { ownerDocument: doc }));
    } else if (startsWith("<?")) {
      at += 2;
      const target = readName();
      if (target.toLowerCase() === "xml") fail("the XML declaration must be first");
      const data = until("?>", "a processing instruction").replace(/^[ \t\r\n]+/, "");
      current._append(Object.assign(new XMLProcessingInstruction(target, data), { ownerDocument: doc }));
    } else if (startsWith("<!DOCTYPE")) {
      // Read to the matching '>' (an internal subset has [ ... ] of its own) and drop it.
      let depth = 0;
      while (at < source.length) {
        const c = source[at++];
        if (c === "[") depth += 1;
        else if (c === "]") depth -= 1;
        else if (c === ">" && depth <= 0) break;
      }
    } else if (startsWith("</")) {
      at += 2;
      const name = readName();
      skipSpace();
      if (source[at] !== ">") fail("an end tag was not closed");
      at += 1;
      const open = stack.pop();
      if (!open || open.nodeName !== name) fail(`the end tag </${name}> does not match ${open ? `<${open.nodeName}>` : "any open element"}`);
      scopes.pop();
      current = stack[stack.length - 1] || doc;
      if (!stack.length) rootClosed = true;
    } else {
      at += 1;
      const name = readName();
      if (rootClosed) fail("only one root element is allowed");
      const attributes = [];
      for (;;) {
        const before = at;
        skipSpace();
        if (source[at] === ">" || (source[at] === "/" && source[at + 1] === ">")) break;
        if (at === before) fail("a space was expected between attributes");
        const attrName = readName();
        skipSpace();
        if (source[at] !== "=") fail(`the attribute ${attrName} has no value`);
        at += 1;
        skipSpace();
        const quote = source[at];
        if (quote !== '"' && quote !== "'") fail(`the value of ${attrName} is not quoted`);
        at += 1;
        const end = source.indexOf(quote, at);
        if (end === -1) fail(`the value of ${attrName} is not closed`);
        const rawValue = source.slice(at, end);
        if (rawValue.includes("<")) fail(`the value of ${attrName} contains '<'`);
        at = end + 1;
        if (attributes.some((a) => a.name === attrName)) fail(`the attribute ${attrName} is repeated`);
        // Whitespace in a value is normalised to a space, as the specification has it, before entities are decoded.
        attributes.push({ name: attrName, value: decode(rawValue.replace(/[\t\r\n]/g, " "), fail) });
      }
      const scope = Object.create(scopes[scopes.length - 1]);
      for (const a of attributes) {
        if (a.name === "xmlns") scope[""] = a.value || null;
        else if (a.name.startsWith("xmlns:")) scope[a.name.slice(6)] = a.value;
      }
      const prefix = name.includes(":") ? name.slice(0, name.indexOf(":")) : "";
      const namespaceURI = prefix in scope ? scope[prefix] : (prefix ? fail(`the prefix ${prefix} is not declared`) : null);
      const element = new XMLElement(name, namespaceURI === undefined ? null : namespaceURI);
      element.ownerDocument = doc;
      for (const a of attributes) {
        const apfx = a.name.includes(":") ? a.name.slice(0, a.name.indexOf(":")) : "";
        const ans = a.name === "xmlns" || apfx === "xmlns" ? XMLNS_NAMESPACE : (apfx ? scope[apfx] : null);
        if (apfx && apfx !== "xmlns" && !(apfx in scope)) fail(`the prefix ${apfx} is not declared`);
        element.attributes.push(new XMLAttr(a.name, a.value, ans || null, element));
      }
      current._append(element);
      sawRoot = true;
      if (source[at] === "/") {
        at += 2;
        if (current === doc || !stack.length) rootClosed = true;
      } else {
        at += 1;
        stack.push(element);
        scopes.push(scope);
        current = element;
      }
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].nodeName}> is not closed`);
  if (!sawRoot) fail("the document has no root element");
  return doc;
}

function parserErrorDocument(message) {
  const doc = new XMLDocument();
  const root = new XMLElement("parsererror", PARSER_ERROR_NAMESPACE);
  root.ownerDocument = doc;
  const text = Object.assign(new XMLText(message), { ownerDocument: doc });
  root._append(text);
  doc._append(root);
  return doc;
}

const XML_TYPES = new Set(["text/xml", "application/xml", "application/xhtml+xml", "image/svg+xml"]);

export class DOMParser {
  parseFromString(string, type) {
    const mime = String(type).toLowerCase();
    if (!XML_TYPES.has(mime)) {
      if (mime === "text/html") {
        throw new (globalThis.DOMException || Error)("DOMParser.parseFromString: 'text/html' is not supported; this adapter parses XML", "NotSupportedError");
      }
      throw new TypeError(`DOMParser.parseFromString: '${type}' is not a valid MIME type for parsing`);
    }
    let doc;
    try {
      doc = parseXML(String(string));
    } catch (error) {
      if (!(error instanceof XMLParseError)) throw error;
      doc = parserErrorDocument(error.message);
    }
    doc.contentType = mime;
    return doc;
  }
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (s) => escapeText(s).replace(/"/g, "&quot;");

function serialize(node) {
  switch (node.nodeType) {
    case DOCUMENT: return node.childNodes.map(serialize).join("");
    case ELEMENT: {
      const attributes = node.attributes.map((a) => ` ${a.name}="${escapeAttribute(a.value)}"`).join("");
      if (!node.childNodes.length) return `<${node.nodeName}${attributes}/>`;
      return `<${node.nodeName}${attributes}>${node.childNodes.map(serialize).join("")}</${node.nodeName}>`;
    }
    case TEXT: return escapeText(node.data);
    case CDATA: return `<![CDATA[${node.data}]]>`;
    case COMMENT: return `<!--${node.data}-->`;
    case PROCESSING_INSTRUCTION: return `<?${node.target}${node.data ? " " + node.data : ""}?>`;
    default: throw new TypeError("XMLSerializer.serializeToString: the argument is not a node this adapter built");
  }
}

export class XMLSerializer {
  serializeToString(node) {
    if (!node || typeof node.nodeType !== "number") throw new TypeError("XMLSerializer.serializeToString: parameter 1 is not of type 'Node'");
    return serialize(node);
  }
}
