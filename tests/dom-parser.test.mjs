// DOMParser / XMLSerializer: the XML the engines read (bitmap fonts, tile maps, plists, SVG) comes back as the tree a script
// reads it with, and XML that is not well-formed comes back the way a browser answers it -- a document whose root is a
// <parsererror> -- and not as an exception or a half-built tree.
import assert from "node:assert/strict";
import { DOMParser, XMLSerializer } from "../src/dom-parser.js";

const parser = new DOMParser();
const parse = (text, type = "text/xml") => parser.parseFromString(text, type);
const failed = (doc) => doc.getElementsByTagName("parsererror").length > 0;

// A BMFont .fnt in XML, the way Egret and Laya read it: attributes as strings, children in order, text nodes between them.
{
  const doc = parse(`<?xml version="1.0"?>
<font>
  <info face="Arial" size="32" bold="0"/>
  <common lineHeight="36" base="29" scaleW="256" scaleH="256" pages="1"/>
  <chars count="2">
    <char id="65" x="0" y="0" width="20" height="30"/>
    <char id="66" x="21" y="0" width="19" height="30"/>
  </chars>
</font>`);
  assert.equal(failed(doc), false);
  assert.equal(doc.nodeType, 9);
  assert.equal(doc.nodeName, "#document");
  const root = doc.documentElement;
  assert.equal(root.nodeName, "font");
  assert.equal(root.nodeType, 1);
  assert.equal(doc.childNodes.length, 1, "the XML declaration is not a node");
  assert.deepEqual(root.children.map((c) => c.nodeName), ["info", "common", "chars"]);
  assert.equal(root.getElementsByTagName("char").length, 2);
  const info = root.getElementsByTagName("info")[0];
  assert.equal(info.getAttribute("face"), "Arial");
  assert.equal(info.getAttribute("size"), "32", "attributes are strings");
  assert.equal(info.getAttribute("nope"), null);
  assert.equal(info.attributes.length, 3);
  assert.deepEqual([...info.attributes].map((a) => [a.name, a.value]), [["face", "Arial"], ["size", "32"], ["bold", "0"]]);
  assert.equal(info.attributes[0].nodeName, "face");
  assert.equal(info.attributes[0].nodeValue, "Arial");
  // whitespace between elements is text, as in a browser
  assert.deepEqual(root.childNodes.map((n) => n.nodeType), [3, 1, 3, 1, 3, 1, 3]);
  assert.equal(root.firstChild.nodeType, 3);
  assert.equal(info.parentNode, root);
  assert.equal(info.nextSibling.nodeType, 3);
  assert.equal(info.previousSibling.nodeType, 3);
  assert.equal(root.getElementsByTagName("char")[1].getAttribute("id"), "66");
  assert.equal(doc.getElementsByTagName("*").length, 6);
}

// Entities, character references, CDATA, comments, processing instructions.
{
  const doc = parse(`<r a="1 &lt; 2 &amp; &quot;3&quot;">x &amp; y &#65;&#x42; <![CDATA[<raw> & stuff]]><!-- note --><?app go?></r>`);
  assert.equal(failed(doc), false);
  const r = doc.documentElement;
  assert.equal(r.getAttribute("a"), '1 < 2 & "3"');
  assert.equal(r.textContent, "x & y AB <raw> & stuff");
  assert.deepEqual(r.childNodes.map((n) => n.nodeType), [3, 4, 8, 7]);
  assert.equal(r.childNodes[1].nodeName, "#cdata-section");
  assert.equal(r.childNodes[2].data, " note ");
  assert.equal(r.childNodes[3].target, "app");
  assert.equal(r.childNodes[3].data, "go");
  assert.equal(parse("<r>&amp;lt;</r>").documentElement.textContent, "&lt;", "a decoded reference is not decoded again")
  // attribute whitespace is normalised to spaces, as the specification has it
  assert.equal(parse("<r a=\"x\ty\nz\"/>").documentElement.getAttribute("a"), "x y z");
}

// Namespaces and prefixes.
{
  const doc = parse(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>`, "image/svg+xml");
  const svg = doc.documentElement;
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  const use = svg.firstChild;
  assert.equal(use.namespaceURI, "http://www.w3.org/2000/svg", "the default namespace applies to children");
  assert.equal(use.getAttribute("xlink:href"), "#a");
  assert.equal(use.getAttributeNS("http://www.w3.org/1999/xlink", "href"), "#a");
  const prefixed = parse(`<a:r xmlns:a="urn:x"><a:c/></a:r>`).documentElement;
  assert.equal(prefixed.nodeName, "a:r");
  assert.equal(prefixed.localName, "r");
  assert.equal(prefixed.prefix, "a");
  assert.equal(prefixed.namespaceURI, "urn:x");
  assert.equal(parse(`<r/>`).documentElement.namespaceURI, null);
}

// A plist: a DOCTYPE with a public id, and a document that is all elements.
{
  const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>frame</key><string>{{0,0},{20,30}}</string></dict></plist>`);
  assert.equal(failed(doc), false);
  assert.equal(doc.documentElement.nodeName, "plist");
  assert.equal(doc.getElementsByTagName("key")[0].textContent, "frame");
  assert.equal(doc.getElementsByTagName("string")[0].textContent, "{{0,0},{20,30}}");
}

// Not well-formed: a parsererror document, with a message that says where, never an exception.
for (const [name, text] of [
  ["an unclosed element", "<a><b></a>"],
  ["a mismatched end tag", "<a></b>"],
  ["two roots", "<a/><b/>"],
  ["text outside the root", "hello <a/>"],
  ["an unquoted attribute", "<a x=1/>"],
  ["a repeated attribute", '<a x="1" x="2"/>'],
  ["an undefined entity", "<a>&nbsp;</a>"],
  ["a bare ampersand", "<a>fish & chips</a>"],
  ["an undeclared prefix", "<a:b/>"],
  ["no root", "   "],
  ["an unterminated comment", "<a><!-- x </a>"],
  ["< in an attribute value", '<a x="<"/>'],
  ["]]> in text", "<a>]]></a>"],
]) {
  const doc = parse(text);
  assert.equal(failed(doc), true, `${name}: a parsererror`);
  assert.equal(doc.documentElement.nodeName, "parsererror", `${name}: it is the root`);
  assert.match(doc.documentElement.textContent, /line \d+/, `${name}: the message says where`);
}

// Types.
assert.throws(() => parse("<a/>", "text/html"), (e) => e.name === "NotSupportedError", "HTML is refused, not answered with an XML tree");
assert.throws(() => parse("<a/>", "text/plain"), TypeError);
for (const type of ["text/xml", "application/xml", "application/xhtml+xml", "image/svg+xml", "TEXT/XML"]) {
  assert.equal(parse("<a/>", type).documentElement.nodeName, "a", type);
}
assert.equal(parse("<a/>", "application/xml").contentType, "application/xml");

// Serialization round-trips what it parsed.
{
  const serializer = new XMLSerializer();
  const source = `<r a="1 &amp; 2"><c>t &lt; u</c><e/><![CDATA[x]]><!--n--></r>`;
  assert.equal(serializer.serializeToString(parse(source)), source);
  assert.equal(serializer.serializeToString(parse(source).documentElement.firstChild), `<c>t &lt; u</c>`);
  assert.throws(() => serializer.serializeToString({}), TypeError);
}

// getElementById and a very deep tree (no recursion limit on what a real asset nests).
{
  assert.equal(parse(`<r><c id="x"/></r>`).getElementById("x").nodeName, "c");
  const depth = 2000;
  const doc = parse("<a>".repeat(depth) + "</a>".repeat(depth));
  assert.equal(failed(doc), false);
  assert.equal(doc.getElementsByTagName("a").length, depth);
}

console.log("dom-parser tests: all passed");
