import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { channel, evaluate, openSocket } from "../lib/browser/cdp.mjs";

test("a call gets its own reply, and events go to the listeners", async () => {
  const sent = [];
  const page = channel((msg) => sent.push(msg));
  const events = [];
  page.on((msg) => events.push(msg.method));
  const first = page.call("A.one", { x: 1 });
  const second = page.call("A.two", {}, { sessionId: "s1" });
  assert.deepEqual(sent.map((msg) => [msg.id, msg.method, msg.sessionId]), [[1, "A.one", undefined], [2, "A.two", "s1"]]);
  page.receive({ method: "Page.loadEventFired" });
  page.receive({ id: 2, result: { two: true } });
  page.receive({ id: 1, result: { one: true } });
  assert.deepEqual(await first, { one: true });
  assert.deepEqual(await second, { two: true });
  assert.deepEqual(events, ["Page.loadEventFired"]);
});

test("an error reply fails the call with the method's name", async () => {
  const page = channel(() => {});
  const call = page.call("Page.navigate");
  page.receive({ id: 1, error: { message: "no such page" } });
  await assert.rejects(call, /^Error: Page.navigate: no such page$/);
});

test("a call the page never answers times out instead of hanging", async () => {
  const page = channel(() => {}, { timeoutMs: 20 });
  await assert.rejects(page.call("Runtime.evaluate"), /Runtime.evaluate timed out; the page may be hung/);
  await assert.rejects(page.call("Runtime.evaluate", {}, { timeout: 5 }), /timed out/);
});

test("a send that fails fails the call at once", async () => {
  const page = channel(() => {
    throw new Error("socket closed");
  });
  await assert.rejects(page.call("A.b"), /A.b: socket closed/);
});

test("evaluate returns the value, and throws what the page threw", async () => {
  const replies = [
    { result: { type: "number", value: 2 } },
    { result: {}, exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x is not a function" } } },
    { result: {}, exceptionDetails: { text: "Uncaught SyntaxError" } },
  ];
  const asked = [];
  const call = async (method, params, opts) => {
    asked.push([method, params.awaitPromise, opts.sessionId]);
    return replies.shift();
  };
  assert.equal(await evaluate(call, "1 + 1", { sessionId: "s" }), 2);
  await assert.rejects(evaluate(call, "x()"), /^Error: page threw: TypeError: x is not a function$/);
  await assert.rejects(evaluate(call, "(", { awaitPromise: true }), /page threw: Uncaught SyntaxError/);
  assert.deepEqual(asked, [["Runtime.evaluate", false, "s"], ["Runtime.evaluate", false, undefined], ["Runtime.evaluate", true, undefined]]);
});

test("a socket that cannot open fails, and one that never answers times out", async () => {
  // A port nothing listens on refuses at once.
  const closed = createServer();
  await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const free = closed.address().port;
  await new Promise((r) => closed.close(r));
  await assert.rejects(openSocket(`ws://127.0.0.1:${free}/`, { failed: "refused" }), /^Error: refused$/);
  // A server that takes the connection and says nothing never opens the socket.
  const sockets = [];
  const silent = createServer((socket) => sockets.push(socket));
  await new Promise((r) => silent.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(openSocket(`ws://127.0.0.1:${silent.address().port}/`, { openMs: 100, silent: "no answer" }), /^Error: no answer$/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((r) => silent.close(r));
  }
});
