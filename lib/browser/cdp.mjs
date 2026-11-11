// The one DevTools protocol client wf app and wf design drive pages with. It
// keeps no browser of its own: the caller opens the socket and says how a
// message reaches the page, directly for Chromium, or wrapped in
// Target.sendMessageToTarget for WebKit's inspector.
//
//   const ws = await openSocket(url);
//   const page = channel((msg) => ws.send(JSON.stringify(msg)));
//   ws.addEventListener("message", (e) => page.receive(JSON.parse(e.data)));
//   await evaluate(page.call, "document.title");

/** The hint every timeout gives: a page that stops answering has usually run out of memory or hung. */
const HUNG = "the page may be hung (check mem)";

/**
 * Open a WebSocket to a debugging endpoint. Fails with `failed` on a socket
 * error, and with `silent` when it has not opened after openMs.
 */
export async function openSocket(url, { openMs = 5000, failed = "debugging connection failed", silent = `the debugging connection did not open; ${HUNG}` } = {}) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Closing a socket that has not opened fires its error, so the timeout is said first.
      reject(new Error(silent));
      ws.close();
    }, openMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(failed));
    }, { once: true });
  });
  return ws;
}

/**
 * Calls and events over one protocol channel. `send` writes one message; each
 * message that arrives goes to `receive`. A call fails on an error reply, and
 * after its timeout, so a hung page never hangs the caller.
 */
export function channel(send, { timeoutMs = 10_000 } = {}) {
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  function receive(msg) {
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  }
  function call(method, params = {}, { timeout = timeoutMs, sessionId } = {}) {
    const id = ++nextId;
    let timer;
    const reply = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out; ${HUNG}`));
      }, timeout);
    });
    try {
      send({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      return Promise.reject(new Error(`${method}: ${error.message}`));
    }
    return reply.finally(() => clearTimeout(timer)).then((msg) => {
      if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
      return msg.result;
    });
  }
  return { call, receive, on: (fn) => listeners.push(fn) };
}

/**
 * The value of an expression in a Chromium page, or an error naming what the
 * page threw, so a throwing script never reads as undefined.
 */
export async function evaluate(call, expression, { awaitPromise = false, sessionId } = {}) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, { sessionId });
  if (result.exceptionDetails) throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result?.value;
}

/** A promise that fails with `message` when `promise` has not settled after ms. */
export function within(promise, ms, message) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
