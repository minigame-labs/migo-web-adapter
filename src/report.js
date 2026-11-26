// HTML's "report the exception": what a listener, an event handler or a script threw, and nothing caught, goes where an
// exception nothing caught goes -- the runtime's reportError (the game's onError listeners and the log; the game runs
// on). The runtime's own function, taken when the adapter loads, before content could replace the global. A runtime
// without one gets the exception thrown from a task of its own, which its uncaught-exception path reports.
const hostReportError = typeof globalThis.reportError === "function" ? globalThis.reportError : null;

export function reportException(error) {
  if (hostReportError) {
    hostReportError.call(globalThis, error);
    return;
  }
  setTimeout(() => { throw error; }, 0);
}
