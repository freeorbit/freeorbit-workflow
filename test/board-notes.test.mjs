import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { runBoard } from "../lib/board/index.mjs";
import { feedback, replyBatch, replyGroups } from "../lib/board/feedback.mjs";
import { answeredReply, deliveredNote, questionNote } from "../lib/board/voice.mjs";
import { questionProblems } from "../lib/questions.mjs";
import { signoffs } from "../lib/signoffs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
// The done list with its For the client column: CH-01's lanes say what the client can now do.
const DONE = fixture("chunks-done.md")
  .replace("| Status | Detail |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |", "| Status | Detail | For the client |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  .replace("| Done | none |\n| CH-01-be", "| Done | none | You can sign in with your work email & password. |\n| CH-01-be")
  .replace(/(\| CH-01-be .*\| Done \| none) \|/, "$1 | You can sign in with your work email & password. |")
  .replace(/(\| CH-02-contract .*\| Done \| none) \|/, "$1 | |");
const HEAD = "| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |";
const QUESTIONS = `## CH-03: Sign out\n\n${HEAD}\n| Q-012 | Should Sign out sit on every page? | client | owner | APP-02 | 2026-11-11 |\n\n## Not tied to a chunk yet\n\n${HEAD}\n| Q-013 | Which logo goes on the sign-in page? | client | designer | none | 2026-11-11 |\n`;
const PEOPLE = [{ name: "Ana", handle: "ana", roles: ["owner", "designer", "developer", "reviewer"] }, { name: "Bo", handle: "bo", roles: ["developer"] }];
const config = (board = {}) => merge(DEFAULTS, { team: "team", people: PEOPLE, areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", ...board } });
const context = (more = {}, texts = {}) => {
  const all = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": DONE, "docs/log/open-questions.md": QUESTIONS, ...texts };
  return { root: "/project", config: config(more), tracked: Object.keys(all), files: (path) => all[path] };
};
const STATUS = { 0: "Drafting", 1: "Built", 2: "Backlog", 3: "Planned", 4: "In progress", 6: "Checking" };

/** A board that keeps items, comments, and replies, enough for notes, questions, and their answers. */
function monday() {
  const state = {
    columns: [["story_id", "text"], ["area", "text"], ["chunk", "text"], ["story", "long_text"], ["pr", "link"], ["owner", "people"]]
      .map(([id, type]) => ({ id, title: id, type, settings_str: "{}" }))
      .concat([{ id: "wf_status", title: "Build", type: "status", settings_str: JSON.stringify({ labels: STATUS }) }, { id: "client_review", title: "Client review", type: "status", settings_str: "{}" }]),
    items: [],
    groups: [],
    next: 1,
    posts: [],
  };
  const shown = (item) => ({ id: item.id, name: item.name, group: state.groups.find((group) => group.id === item.group), column_values: state.columns.map((column) => ({ id: column.id, text: item.values[column.id] ?? "" })), updates: item.updates });
  const plain = (html) => html.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n+$/, "");
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|change_multiple_column_values|create_update|pin_to_top)\b/)[1];
    // Each post a minute after the last, from noon on, after the client's replies the tests add.
    const now = () => new Date(Date.UTC(2026, 10, 11, 12, state.next)).toISOString();
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === "me") return ok({ me: { id: "7" } });
    if (op === "boards") return ok({ boards: [{ id: "42", name: "Client board", board_kind: "share", columns: state.columns, groups: state.groups, views: [{ name: "Build" }, { name: "Client review" }], items_page: { cursor: null, items: state.items.map(shown) } }] });
    if (op === "create_group") {
      state.groups.push({ id: `g${state.next}`, title: v.n });
      return ok({ create_group: { id: `g${state.next++}` } });
    }
    if (op === "create_item") {
      const values = Object.fromEntries(Object.entries(JSON.parse(v.v)).map(([key, value]) => [key, typeof value === "object" ? (value.label ?? value.text ?? "") : value]));
      const item = { id: `i${state.next++}`, name: v.n, group: v.g, values, updates: [] };
      state.items.push(item);
      return ok({ create_item: { id: item.id, column_values: v.c.map((id) => ({ id, text: values[id] ?? "" })) } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "change_multiple_column_values") {
      for (const [key, value] of Object.entries(JSON.parse(v.v))) {
        if (key === "name") item.name = value;
        else item.values[key] = typeof value === "object" ? (value.label ?? value.text ?? "") : value;
      }
      return ok({ change_multiple_column_values: { id: v.i } });
    }
    if (op === "create_update") {
      const update = { id: `u${state.next++}`, body: v.b, text_body: plain(v.b), creator_id: "7", creator: { name: "Owner", kind: "member" }, created_at: now(), updated_at: now(), pinned_to_top: [], replies: [] };
      if (v.p) item.updates.find((each) => each.id === v.p).replies.push(update);
      else item.updates.unshift(update);
      state.posts.push({ item: item.values.story_id, body: v.b, reply: Boolean(v.p) });
      return ok({ create_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      item.updates.find((update) => update.id === v.u).pinned_to_top = [{ item_id: v.i }];
      return ok({ pin_to_top: { id: v.u } });
    }
    throw new Error(`notes monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, board, more, texts) {
  const out = [];
  const code = await runBoard(context(more, texts), args, { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: board.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {} });
  return { code, out };
}

test("a built story gets one delivery note, from its chunks' For the client lines, deduped, with its chunk marker", async () => {
  const board = monday();
  const planned = await run(["plan"], board);
  assert.ok(planned.out.includes("note    APP-01 delivered (CH-01)"), planned.out.join("\n"));
  assert.ok(!planned.out.some((line) => line.startsWith("note    APP-04")), "APP-04 is not built yet");
  const synced = await run(["sync"], board);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  const notes = board.state.posts.filter((post) => post.body.includes("this story is built") || post.body.includes("built!"));
  assert.deepEqual(notes.map((post) => post.item), ["APP-01"]);
  assert.equal(notes[0].body, deliveredNote("Orbit", ["You can sign in with your work email &amp; password."], ["CH-01"]), "the full form, the item's first word from Orbit, the line once");
  const again = await run(["plan"], board);
  assert.ok(!again.out.some((line) => line.startsWith("note ")), "posted once: the marker finds it");
});

test("a later chunk is announced on its own, short; an empty For the client cell announces nothing", async () => {
  const board = monday();
  await run(["sync"], board);
  const later = DONE.replace("| CH-02-contract |", "| CH-05 | Remember sign-in | developer | APP-01 | app | x | none | Done | none | Your sign-in is remembered for a day. |\n| CH-02-contract |");
  const planned = await run(["plan"], board, {}, { "docs/log/chunks-done.md": later });
  assert.ok(planned.out.includes("note    APP-01 delivered (CH-05)"), planned.out.join("\n"));
  await run(["sync"], board, {}, { "docs/log/chunks-done.md": later });
  assert.equal(board.state.posts.at(-1).body, deliveredNote("Orbit", ["Your sign-in is remembered for a day."], ["CH-05"], { short: true }));
  const empty = DONE.replace(/You can sign in with your work email & password\./g, "");
  const quiet = await run(["plan"], monday(), {}, { "docs/log/chunks-done.md": empty });
  assert.ok(!quiet.out.some((line) => line.startsWith("note ")), quiet.out.join("\n"));
  const off = await run(["plan"], monday(), { show: { deliveryNotes: false, clientQuestions: false } });
  assert.ok(!off.out.some((line) => /^(note|ask|skip) /.test(line)), "each kind waits on its show switch");
});

test("a question for the client is asked once on its story's item, and one with no story is noted, not posted", async () => {
  const board = monday();
  const planned = await run(["plan"], board);
  assert.ok(planned.out.includes("ask     APP-02 Q-012"), planned.out.join("\n"));
  assert.ok(planned.out.includes("skip    Q-013 asks the client but names no story, so it is not posted"));
  await run(["sync"], board);
  const asked = board.state.posts.find((post) => post.body.includes("(Q-012)"));
  assert.equal(asked.item, "APP-02");
  assert.equal(asked.body, questionNote("Orbit", "Q-012", "Should Sign out sit on every page?"));
  assert.ok(!(await run(["plan"], board)).out.some((line) => line.startsWith("ask ")), "asked once: the Q-ID finds it");
});

test("the client's reply to a question is shown as its answer, and thanked with --answered", async () => {
  const board = monday();
  await run(["sync"], board);
  const item = board.state.items.find((each) => each.values.story_id === "APP-02");
  const question = item.updates.find((update) => update.text_body.includes("(Q-012)"));
  question.replies.push({ id: "g1", text_body: "Yes, top right please.", creator_id: "50", creator: { name: "Dana Client", kind: "guest" }, created_at: "2026-11-11T11:00:00Z", updated_at: "2026-11-11T11:00:00Z" });
  const shown = await run(["feedback", "--json"], board);
  const found = JSON.parse(shown.out[0]);
  assert.deepEqual(found.pending.map((entry) => `${entry.id} ${entry.where} ${entry.answers}`), ["g1 answer to Q-012 Q-012"]);
  const read = { items: board.state.items.map((each) => ({ id: each.id, name: each.name, group: { title: "x" }, column_values: [{ id: "story_id", text: each.values.story_id }], updates: each.updates })) };
  const replies = replyBatch(config(), feedback(config(), read, "7"), replyGroups(["g1", "--answered", "Q-012"]), new Set());
  assert.equal(replies[0].body, answeredReply("Orbit", "Q-012"));
  assert.throws(() => replyBatch(config(), feedback(config(), read, "7"), replyGroups(["g1", "--answered", "Q-099"]), new Set()), /g1 answers Q-012, not Q-099/);
  assert.equal(await run(["reply", "g1", "--answered", "Q-012"], board).then((each) => each.code), 0);
  assert.equal(board.state.posts.at(-1).body, answeredReply("Orbit", "Q-012"));
  assert.deepEqual(JSON.parse((await run(["feedback", "--json"], board)).out[0]).pending, [], "thanked, so handled");
});

test("client is a Needs value: the questions check takes it, and a client row never holds a merge", () => {
  const files = { "docs/log/open-questions.md": QUESTIONS };
  assert.deepEqual(questionProblems({ config: config(), tracked: Object.keys(files), files: (path) => files[path] }), []);
  const { lines, code } = signoffs(config(), [["docs/log/open-questions.md", QUESTIONS]]);
  assert.deepEqual({ lines, code }, { lines: ["No open sign-offs."], code: 0 });
});
