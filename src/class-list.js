// `element.classList` (a DOMTokenList): add / remove / toggle / contains / replace over the element's `className`. p5.js adds
// "p5Canvas" to its canvas the moment it makes it, and an array here (which has no `add`) stopped its `createCanvas`.

export class ClassList {
  constructor(owner) {
    this._owner = owner;
  }

  _tokens() {
    return String(this._owner.className || "").split(/\s+/).filter(Boolean);
  }

  _write(tokens) {
    this._owner.className = tokens.join(" ");
  }

  get length() { return this._tokens().length; }
  get value() { return this._owner.className || ""; }
  item(index) { const tokens = this._tokens(); return index >= 0 && index < tokens.length ? tokens[index] : null; }
  contains(token) { return this._tokens().includes(String(token)); }

  add(...tokens) {
    const current = this._tokens();
    for (const raw of tokens) {
      const token = String(raw);
      if (token === "" || /\s/.test(token)) throw new (globalThis.DOMException || Error)("The token provided ('" + token + "') is invalid.", token === "" ? "SyntaxError" : "InvalidCharacterError");
      if (!current.includes(token)) current.push(token);
    }
    this._write(current);
  }

  remove(...tokens) {
    const drop = new Set(tokens.map(String));
    this._write(this._tokens().filter((token) => !drop.has(token)));
  }

  toggle(token, force) {
    const name = String(token);
    const present = this.contains(name);
    const want = force === undefined ? !present : !!force;
    if (want && !present) this.add(name);
    else if (!want && present) this.remove(name);
    return want;
  }

  replace(oldToken, newToken) {
    const tokens = this._tokens();
    const at = tokens.indexOf(String(oldToken));
    if (at === -1) return false;
    tokens[at] = String(newToken);
    this._write([...new Set(tokens)]);
    return true;
  }

  forEach(callback, thisArg) { this._tokens().forEach((token, index) => callback.call(thisArg, token, index, this)); }
  toString() { return this.value; }
  [Symbol.iterator]() { return this._tokens()[Symbol.iterator](); }
}
