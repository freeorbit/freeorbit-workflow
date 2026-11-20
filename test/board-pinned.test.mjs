import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { runBoard } from "../lib/board/index.mjs";
import { commentDiff, pinnedChange } from "../lib/board/items.mjs";
import { leadHtml } from "../lib/board/work.mjs";
import { asMondayKeeps, updatesFor } from "./fixtures/board/monday-keeps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const TOKEN = "tok-secret-123";
const BASE = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md") };
const ANGLED = BASE["docs/app/user-stories.md"].replace(
  "- The email is matched without regard to letter case or surrounding spaces.",
  "- Each resource is named `<type>-app[-<part>]-dev`, such as `rg-app-dev`, and **never** by hand.",
);

const COLUMNS = ["story_id", "area", "wf_status", "chunk", "story", "pr", "owner", "client_review", "frames", "built_screens"].map((id) => ({
  id,
  title: { wf_status: "Build", client_review: "Client review" }[id] ?? id,
  type: { wf_status: "status", client_review: "status", story: "long_text", pr: "link", owner: "people", frames: "file", built_screens: "file" }[id] ?? "text",
  settings_str: id === "wf_status" ? JSON.stringify({ labels: { 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Built" } }) : "{}",
}));

/** A board that keeps comments as monday does, and ignores an edit that leaves the kept body as it is, as monday did. */
function mondayLike({ drop = ["code"], lag = 0, unread = false } = {}) {
  // `lag` reads of an edited comment give what it held before, as monday's lagging reads do; `unread` gives none at all.
  const state = { groups: [{ id: "topics", title: "Group Title" }], items: [], next: 100, ops: [], edits: 0, lag };
  const id = () => String((state.next += 1));
  const updates = () => state.items.flatMap((item) => item.updates);
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|change_multiple_column_values|move_item_to_group|create_update|edit_update|pin_to_top|updates)\b/)[1];
    state.ops.push(op);
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === "updates") {
      if (unread) return ok({ updates: [] });
      const lagging = state.lag-- > 0;
      return ok({ updates: updatesFor(state.items, v.i).map((update) => (lagging && update.before ? { ...update, ...update.before } : update)) });
    }
    if (op === "me") return ok({ me: { id: "7", name: "Owner" } });
    if (op === "boards")
      return ok({
        boards: [{ id: "42", name: "Test board", board_kind: "share", columns: COLUMNS, groups: state.groups, views: [{ name: "Build" }, { name: "Client review" }], items_page: { cursor: null, items: state.items.map((item) => ({ ...item, group: state.groups.find((group) => group.id === item.group), column_values: COLUMNS.map((column) => ({ id: column.id, text: item.values[column.id] ?? "" })), updates: [...item.updates].reverse() })) } }],
      });
    if (op === "create_group") {
      state.groups.push({ id: `g${id()}`, title: v.n });
      return ok({ create_group: { id: state.groups.at(-1).id } });
    }
    if (op === "create_item") {
      const values = Object.fromEntries(Object.entries(JSON.parse(v.v)).map(([key, value]) => [key, value && typeof value === "object" ? (value.label ?? value.text ?? value.url ?? "") : String(value ?? "")]));
      const item = { id: id(), name: v.n, group: v.g, values, updates: [] };
      state.items.push(item);
      return ok({ create_item: { id: item.id, column_values: [] } });
    }
    if (op === "create_update") {
      const update = { id: `u${id()}`, ...asMondayKeeps(v.b, drop), creator_id: "7", pinned_to_top: [] };
      state.items.find((each) => each.id === v.i).updates.push(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "edit_update") {
      const update = updates().find((each) => each.id === v.u);
      const kept = asMondayKeeps(v.b, drop);
      if (kept.body !== update.body) {
        Object.assign(update, kept, { before: { body: update.body, text_body: update.text_body } });
        state.edits += 1;
      }
      return ok({ edit_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      updates().find((each) => each.id === v.u).pinned_to_top.push({ item_id: v.i });
      return ok({ pin_to_top: { id: v.u } });
    }
    return ok({ [op]: { id: v.i } });
  };
  return { state, fetch };
}

async function run(args, monday, stories = BASE["docs/app/user-stories.md"]) {
  const files = { ...BASE, "docs/app/user-stories.md": stories };
  const context = { root: "/project", config: merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", show: { frames: false, screenshots: false } } }), tracked: Object.keys(files), files: (path) => files[path] };
  const out = [];
  const code = await runBoard(context, args, { env: { MONDAY_API_TOKEN: TOKEN }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {} });
  return { code, out };
}
const comments = (out) => out.filter((line) => line.startsWith("comment "));

test("a story line with a backtick: after a sync, a plan finds no comment to edit", async () => {
  const monday = mondayLike();
  assert.equal((await run(["sync"], monday)).code, 0);
  assert.match(monday.state.items[0].updates[0].body, /kept in plain text/, "the fixture's APP-01 holds `plain text`");
  assert.deepEqual(comments((await run(["plan"], monday)).out), []);
});

test("angle brackets inside backticks: monday's literal text compares equal to the escaped text sent", async () => {
  const monday = mondayLike();
  assert.equal((await run(["sync"], monday, ANGLED)).code, 0);
  assert.match(monday.state.items[0].updates[0].text_body, /named <type>-app\[-<part>\]-dev/);
  assert.deepEqual(comments((await run(["plan"], monday, ANGLED)).out), []);
});

test("a real change of words, or of layout, is still planned as an edit, and lands", async () => {
  const monday = mondayLike();
  await run(["sync"], monday, ANGLED);
  const worded = ANGLED.replace("`rg-app-dev`", "`rg-app-test`");
  assert.deepEqual(comments((await run(["plan"], monday, worded)).out), ["comment APP-01  edit acceptance"]);
  assert.equal((await run(["sync"], monday, worded)).code, 0);
  assert.equal(monday.state.edits, 1);
  assert.deepEqual(comments((await run(["plan"], monday, worded)).out), []);
  const laid = worded.replace("**never**", "never");
  assert.deepEqual(comments((await run(["plan"], monday, laid)).out), ["comment APP-01  edit acceptance"], "bold taken off is a change of layout");
});

test("an edit monday does not keep as sent makes sync fail with a problem, not report success", async () => {
  const monday = mondayLike();
  await run(["sync"], monday);
  // A board that also drops <strong>: the stored layout can never match what is sent.
  const stripping = mondayLike({ drop: ["code", "strong"] });
  stripping.state.items = monday.state.items;
  stripping.state.groups = monday.state.groups;
  // A real change, so an edit is sent, and kept without its bold.
  const { code, out } = await run(["sync"], stripping, BASE["docs/app/user-stories.md"].replace("surrounding spaces", "spaces around it"));
  assert.equal(code, 1, out.join("\n"));
  assert.ok(out.some((line) => /^board {3}APP-01: monday kept its acceptance comment \S+ other than sent \(layout .*\), so every sync would edit it again\. If the words match, monday drops markup the kit sends/.test(line)), out.join("\n"));
  assert.ok(!out.some((line) => /is in step|^Synced/.test(line)), out.join("\n"));
});

test("a phase lead with angle brackets, as monday keeps it, needs no edit", () => {
  const comment = leadHtml("Compare a < b and <type> names first.", "Orbit");
  const pinned = { id: "u1", ...asMondayKeeps(comment), pinned_to_top: [{ item_id: "9" }] };
  assert.equal(pinnedChange({ id: "9" }, pinned, comment, { kind: "work-comment", id: "W-APP-P1", what: "phase lead" }), null);
});

test("what monday keeps is compared by its words from text_body and its layout from its body", () => {
  const sent = "<p><strong>Acceptance criteria</strong></p><ul><li>Named &lt;type&gt; &amp; kept.</li></ul>";
  const kept = asMondayKeeps(sent);
  assert.equal(commentDiff(kept, sent), null, "the entities sent compare with monday's literal text");
  assert.match(commentDiff(kept, sent.replace("kept", "gone")), /^words .*kept\. → .*gone\.$/);
  assert.match(commentDiff(kept, sent.replace("<strong>", "<em>").replace("</strong>", "</em>")), /^layout .*<strong.* → .*<em/);
  assert.equal(commentDiff({ text_body: kept.text_body }, sent.replace("<strong>", "<em>").replace("</strong>", "</em>")), null, "with no body, only the words count");
});

test("a read that lags behind the edit is read again, and the sync passes", async () => {
  const monday = mondayLike();
  await run(["sync"], monday);
  monday.state.lag = 2;
  const { code, out } = await run(["sync"], monday, BASE["docs/app/user-stories.md"].replace("surrounding spaces", "spaces around it"));
  assert.equal(code, 0, out.join("\n"));
  assert.equal(monday.state.ops.filter((op) => op === "updates").length, 1 + 3, "one read for the three new comments together, then three for the edit: two stale, one kept");
});

test("a comment that cannot be read back is a problem, and one also unpinned is still pinned", async () => {
  const monday = mondayLike();
  await run(["sync"], monday);
  const unread = mondayLike({ unread: true });
  Object.assign(unread.state, { items: monday.state.items, groups: monday.state.groups });
  unread.state.items[0].updates[0].pinned_to_top = [];
  const { code, out } = await run(["sync"], unread, BASE["docs/app/user-stories.md"].replace("surrounding spaces", "spaces around it"));
  assert.equal(code, 1);
  assert.ok(out.some((line) => /^board {3}APP-01: monday kept its acceptance comment \S+ other than sent \(it could not be read back\)/.test(line)), out.join("\n"));
  assert.ok(unread.state.ops.includes("pin_to_top"), "the pin in the same change is still sent");
});
