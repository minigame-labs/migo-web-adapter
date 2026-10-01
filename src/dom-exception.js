// `DOMException`, for the adapter's own errors and for content that checks `instanceof DOMException` or reads
// `.name` / `.code`. A browser always has one; Migo's V8 does not, and the engine installs nothing on the global
// object, so without this `new DOMException(...)` in an engine is a ReferenceError and `atob("!")` has no
// specification-named error to throw.
//
// Only the members the specification's table of names gives legacy codes to are modelled; an unknown name is
// still accepted (code 0), as in a browser.

const LEGACY_CODES = {
  IndexSizeError: 1, HierarchyRequestError: 3, WrongDocumentError: 4, InvalidCharacterError: 5,
  NoModificationAllowedError: 7, NotFoundError: 8, NotSupportedError: 9, InUseAttributeError: 10,
  InvalidStateError: 11, SyntaxError: 12, InvalidModificationError: 13, NamespaceError: 14,
  InvalidAccessError: 15, TypeMismatchError: 17, SecurityError: 18, NetworkError: 19, AbortError: 20,
  URLMismatchError: 21, QuotaExceededError: 22, TimeoutError: 23, InvalidNodeTypeError: 24, DataCloneError: 25,
};

const CONSTANTS = {
  INDEX_SIZE_ERR: 1, DOMSTRING_SIZE_ERR: 2, HIERARCHY_REQUEST_ERR: 3, WRONG_DOCUMENT_ERR: 4,
  INVALID_CHARACTER_ERR: 5, NO_DATA_ALLOWED_ERR: 6, NO_MODIFICATION_ALLOWED_ERR: 7, NOT_FOUND_ERR: 8,
  NOT_SUPPORTED_ERR: 9, INUSE_ATTRIBUTE_ERR: 10, INVALID_STATE_ERR: 11, SYNTAX_ERR: 12,
  INVALID_MODIFICATION_ERR: 13, NAMESPACE_ERR: 14, INVALID_ACCESS_ERR: 15, VALIDATION_ERR: 16,
  TYPE_MISMATCH_ERR: 17, SECURITY_ERR: 18, NETWORK_ERR: 19, ABORT_ERR: 20, URL_MISMATCH_ERR: 21,
  QUOTA_EXCEEDED_ERR: 22, TIMEOUT_ERR: 23, INVALID_NODE_TYPE_ERR: 24, DATA_CLONE_ERR: 25,
};

class DOMException extends Error {
  constructor(message = "", name = "Error") {
    super(String(message));
    // Own, non-enumerable, like the accessors a browser has on the prototype: `JSON.stringify(e)` is `{}`.
    Object.defineProperty(this, "name", { value: String(name), writable: true, configurable: true });
    Object.defineProperty(this, "code", {
      value: Object.prototype.hasOwnProperty.call(LEGACY_CODES, name) ? LEGACY_CODES[name] : 0,
      writable: true,
      configurable: true,
    });
  }
}

for (const key of Object.keys(CONSTANTS)) {
  Object.defineProperty(DOMException, key, { value: CONSTANTS[key], enumerable: true });
  Object.defineProperty(DOMException.prototype, key, { value: CONSTANTS[key], enumerable: true });
}

export default DOMException;
