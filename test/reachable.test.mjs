import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttp } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { START_WAIT_MS, starter } from "../lib/app/start.mjs";
import { STALE_MS } from "../lib/app/holder.mjs";
import { ANSWER_MS, reachable, SILENT_MS, waitUntilReachable } from "../lib/process.mjs";
import { openApp } from "../lib/try/open.mjs";

/** A server that accepts and, with no `answerAfter`, never answers; `busyMs` is a first compile it answers after. */
async function server(t, answerAfter = null, busyMs = 0) {
  const open = new Set();
  const up = Date.now() + busyMs;
  const made = answerAfter === null ? createServer(() => {}) : createHttp((req, res) => setTimeout(() => res.end("ok"), Math.max(answerAfter, up - Date.now())));
  made.on("connection", (socket) => {
    open.add(socket);
    socket.on("error", () => {});
  });
  await new Promise((ok) => made.listen(0, "127.0.0.1", ok));
  t.after(() => {
    for (const socket of open) socket.destroy();
    made.close();
  });
  return { port: made.address().port, url: `http://127.0.0.1:${made.address().port}/` };
}

/** A web start's wiring, with nothing run: what it would have started or stopped is noted. */
function webStart(debugPort, servers) {
  const dir = mkdtempSync(join(tmpdir(), "wf-web-"));
  const ran = [];
  const s = { root: dir, instance: 1, debugPort, state: join(dir, "state"), profile: join(dir, "state", "chromium"), locks: join(dir, "locks"), units: { app: "wf-test-app", "server:web": "wf-test-web" }, app: { web: { servers } }, size: [100, 100] };
  const runUnit = (unit) => {
    ran.push(unit);
    throw new Error(`ran ${unit}`);
  };
  const wiring = { s, hooks: {}, runner: { active: () => false }, stopUnit: () => {}, runUnit, journal: () => "", answerMs: 300, caps: [] };
  return { ran, start: () => starter(wiring).startWeb([]) };
}

test("a server that accepts and never answers is not reachable once the time is up", { timeout: 8000 }, async (t) => {
  const { url } = await server(t);
  const started = Date.now();
  assert.equal(await reachable(url, 300), false);
  assert.ok(Date.now() - started < 1500);
});

test("the whole wait for a server that never answers keeps to its time", { timeout: 8000 }, async (t) => {
  const { url } = await server(t);
  const started = Date.now();
  assert.equal(await waitUntilReachable(url, { silentMs: 900, every: 100 }), false);
  assert.ok(Date.now() - started < 1800);
});

test("a server that listens through a compile longer than the wait for one to appear is reached", { timeout: 8000 }, async (t) => {
  const { url } = await server(t, 50, 1500);
  assert.equal(await waitUntilReachable(url, { tries: 5, every: 100, silentMs: 5000 }), true);
});

test("a wait that is stopped ends within about a second", { timeout: 8000 }, async (t) => {
  const { url } = await server(t);
  const started = Date.now();
  assert.equal(await waitUntilReachable(url, { stop: () => Date.now() - started > 200 }), false);
  assert.ok(Date.now() - started < 2200);
});

test("a debug port that takes the connection and does not answer is refused, not driven", { timeout: 8000 }, async (t) => {
  const { port } = await server(t);
  const { ran, start } = webStart(port, []);
  await assert.rejects(start(), /something already listens on port/);
  assert.deepEqual(ran, []);
});

test("a slow server that is there is waited for, not started beside", { timeout: 10_000 }, async (t) => {
  const { url } = await server(t, 900);
  const { ran, start } = webStart(9, [{ name: "web", url, command: ["never"] }]);
  await start().catch(() => {});
  assert.ok(!ran.includes("wf-test-web"), "a second server was started");
});

test("wf try stops at once when cancelled while a silent server is asked, and starts none beside it", { timeout: 8000 }, async (t) => {
  const { url } = await server(t);
  const home = mkdtempSync(join(tmpdir(), "wf-try-silent-"));
  const s = { web: true, root: home, app: { web: { url, servers: [{ name: "web", url, command: ["never"] }] } } };
  const began = Date.now();
  const open = openApp(s, {}, home, {}, () => {}, { launch: () => assert.fail("started a second server"), cancelled: () => Date.now() - began > 300 });
  await assert.rejects(open, /stopped before the app opened/);
});

test("the longest start in a server's lock ends before the lock is stale, and a waiter outlasts a stale holder", () => {
  assert.ok(ANSWER_MS + SILENT_MS + 250 < STALE_MS);
  assert.ok(START_WAIT_MS > STALE_MS + 15_000);
});
