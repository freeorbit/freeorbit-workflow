import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ANSWERED_DAYS, inbox, inboxFor } from "../lib/view/serve.mjs";
import { clearWaiting, markWaiting, noticeDue, noticeText, pageToken, tellWaiting, waitingSince } from "../lib/view/waiting.mjs";

/** A view folder with one ask page. */
function view() {
  const dir = mkdtempSync(join(tmpdir(), "wf-waiting-"));
  mkdirSync(join(dir, "ask", "pick"), { recursive: true });
  writeFileSync(join(dir, "ask", "pick", "spec.json"), JSON.stringify({ id: "pick", title: "Pick one", template: "decision", questions: [{ id: "q" }] }));
  return dir;
}

test("a page is waited on while its process runs, and only that process takes the mark away", () => {
  const dir = view();
  markWaiting(dir, "pick", { pid: process.pid, since: "2026-11-17T10:00:00.000Z" });
  assert.equal(waitingSince(dir, "pick"), "2026-11-17T10:00:00.000Z");
  assert.equal(waitingSince(dir, "pick", () => false), null, "a mark whose process ended counts as none");
  clearWaiting(dir, "pick", process.pid + 1);
  assert.equal(waitingSince(dir, "pick"), "2026-11-17T10:00:00.000Z");
  clearWaiting(dir, "pick");
  assert.equal(waitingSince(dir, "pick"), null);
});

test("the inbox says since when an agent waits on an unanswered page", () => {
  const dir = view();
  const list = [{ key: "p-1", name: "p", view: dir }];
  const state = (s) => () => ({ state: s, open: 1, answers: null });
  assert.equal(inbox(list, state("waiting"))[0].waitingSince, null);
  markWaiting(dir, "pick", { since: "2026-11-17T10:00:00.000Z" });
  assert.equal(inbox(list, state("waiting"))[0].waitingSince, "2026-11-17T10:00:00.000Z");
  assert.equal(inbox(list, state("answered"))[0].waitingSince, null, "an answered page is waited on by no one");
});

test("the first notice comes at once and the reminder once, after its minutes", () => {
  const rows = [
    [0, [], 10, "first", "nothing sent yet"],
    [5 * 60_000, ["first"], 10, null, "before the reminder"],
    [10 * 60_000, ["first"], 10, "remind", "at the reminder"],
    [30 * 60_000, ["first", "remind"], 10, null, "the reminder is once"],
    [30 * 60_000, ["first"], 0, null, "remind 0 is never"],
  ];
  for (const [elapsed, sent, remind, want, why] of rows) assert.equal(noticeDue(elapsed, new Set(sent), remind), want, why);
  assert.deepEqual(noticeText("first", { project: "atlas", title: "Pick one" }), { title: "atlas: Pick one", body: "An agent is waiting on this ask." });
  assert.equal(noticeText("remind", { project: "atlas", title: "Pick one", minutes: 10 }).body, "An agent has waited 10 minutes on this ask.");
});

test("a notice goes through the server signed as the page, and to this machine's notifier only when the server is away", async () => {
  const text = { title: "t", body: "b" };
  const calls = [];
  const local = (...args) => calls.push(args) > 0;
  const server = (status, ok) => async (url, init) => {
    calls.push([url, init.headers["X-WF-Token"]]);
    return { ok: status === 200, status, json: async () => ({ ok }) };
  };
  assert.equal(await tellWaiting({ key: "k", id: "pick", text, port: 1, token: "a".repeat(48), post: server(200, true), local }), true);
  assert.deepEqual(calls, [["http://127.0.0.1:1/__hub/notify", pageToken("a".repeat(48), "k", "pick")]]);
  calls.length = 0;
  assert.equal(await tellWaiting({ key: "k", id: "pick", text, port: 1, token: "t", post: server(501), local }), false, "the server's machine has no notifier");
  assert.equal(calls.length, 1);
  calls.length = 0;
  const away = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal(await tellWaiting({ key: "k", id: "pick", text, port: 1, token: "t", post: away, local }), true);
  assert.deepEqual(calls, [["t", "b"]]);
});

test("the inbox leaves out a page answered long ago, and a page's own list keeps every waiting ask", () => {
  const dir = view();
  const list = [{ key: "p-1", name: "p", view: dir }];
  const answered = () => ({ state: "answered", open: 0, answers: null });
  assert.equal(inbox(list, answered).length, 1, "answered today, it is listed");
  assert.equal(inbox(list, answered, () => null, Date.now() + (ANSWERED_DAYS + 1) * 86_400_000).length, 0, "answered over the days ago, it is not");
  const items = [{ state: "answered" }, { state: "waiting" }, { state: "answered" }, { state: "partial" }, { state: "answered" }];
  assert.deepEqual(inboxFor(items, 3).map((i) => i.state), ["waiting", "partial", "answered"]);
  assert.equal(inboxFor(items, 0).length, 5, "no limit is the whole list");
});

test("an inbox line is read again only when its page's files change", () => {
  const dir = view();
  const list = [{ key: "p-1", name: "p", view: dir }];
  let reads = 0;
  const state = () => {
    reads += 1;
    return { state: "waiting", open: 1, answers: null };
  };
  inbox(list, state);
  inbox(list, state);
  assert.equal(reads, 1, "the second poll reads nothing");
  writeFileSync(join(dir, "ask", "pick", "spec.json"), JSON.stringify({ id: "pick", title: "Pick two", template: "decision", questions: [{ id: "q" }] }));
  assert.equal(inbox(list, state)[0].title, "Pick two");
  assert.equal(reads, 2);
});

test("a team server's mark holds while the agent's poll renews it, and goes stale without", async () => {
  const { SEEN_MS } = await import("../lib/view/waiting.mjs");
  const dir = view();
  const now = Date.parse("2026-11-23T10:00:00Z");
  writeFileSync(join(dir, "ask", "pick", "waiting.json"), JSON.stringify({ since: "2026-11-23T09:00:00Z", seen: new Date(now).toISOString() }));
  assert.equal(waitingSince(dir, "pick", () => false, now + SEEN_MS - 1), "2026-11-23T09:00:00Z", "no process to ask: the renewal says");
  assert.equal(waitingSince(dir, "pick", () => false, now + SEEN_MS + 1), null);
});
