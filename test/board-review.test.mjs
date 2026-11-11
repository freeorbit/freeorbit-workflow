import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { runBoard, wanted } from "../lib/board/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const files = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md") };
// As Atlas NX: the template's own status column is the kit's build status.
const context = () => ({
  root: "/project",
  config: merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", columns: { status: "project_status" } } }),
  tracked: Object.keys(files),
  files: (path) => files[path],
});

/**
 * A board whose status values are stored as label ids, as monday's are, so a
 * renamed label renames every item set to it. `multiLevel` makes each new
 * status column roll up child items, hiding it from items and dropping writes.
 */
function board({ multiLevel = false, review = true, views = ["Build", "Client review"] } = {}) {
  const status = (id, title, labels) => ({ id, title, type: "status", revision: `${id}-r1`, labels, capabilities: { calculated: null } });
  const state = {
    columns: [
      ...[["story_id", "text"], ["area", "text"], ["chunk", "text"], ["story", "long_text"], ["pr", "link"], ["owner", "people"], ["frames", "file"], ["built_screens", "file"]].map(([id, type]) => ({ id, title: id, type, capabilities: { calculated: null } })),
      // Atlas NX's project_status before v0.35.0: titled Status, Done marked done.
      status("project_status", "Status", [
        { id: 0, label: "In progress", color: 0, index: 0 },
        { id: 1, label: "Done", color: 1, index: 1, is_done: true },
        { id: 3, label: "Backlog", color: 3, index: 3 },
        { id: 4, label: "Checking", color: 4, index: 4 },
        { id: 7, label: "Planned", color: 7, index: 7 },
        { id: 17, label: "Drafting", color: 17, index: 17 },
      ]),
    ],
    views: views.map((name) => ({ name })),
    items: [],
    groups: [{ id: "topics", title: "Group Title" }],
    reads: [],
    sent: [],
    next: 1,
  };
  if (review) state.columns.push(status("client_review", "Client review", [{ id: 0, label: "Not ready", color: 0, index: 0 }, { id: 1, label: "Approved", color: 1, index: 1, is_done: true }, { id: 9, label: "Ask Dana", color: 9, index: 2 }]));
  const settingsOf = (column) => ({ settings_str: JSON.stringify({ labels: Object.fromEntries(column.labels.map((label) => [label.id, label.label])) }), settings: { labels: column.labels } });
  const view = (column) => ({ ...column, ...(column.type === "status" ? settingsOf(column) : { settings_str: "{}" }) });
  const textOf = (column, value) => (column.type === "status" ? (column.labels.find((label) => label.id === value)?.label ?? "") : (value ?? ""));
  const shown = (item, ids) => ({
    id: item.id,
    name: item.name,
    group: state.groups.find((group) => group.id === item.group),
    column_values: state.columns.filter((column) => ids.includes(column.id) && !(column.type === "status" && column.capabilities.calculated)).map((column) => ({ id: column.id, text: textOf(column, item.values[column.id]) })),
    updates: item.updates,
  });
  const write = (item, values) => {
    for (const [key, value] of Object.entries(values)) {
      state.sent.push(key);
      const column = state.columns.find((each) => each.id === key);
      if (column?.type === "status") {
        if (!column.capabilities.calculated) item.values[key] = column.labels.find((label) => label.label === value.label).id;
      } else item.values[key] = typeof value === "object" ? (value.text ?? value.url ?? "") : value;
    }
  };
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|change_multiple_column_values|create_update|pin_to_top|update_status_column|create_column|create_view_table|change_column_title)\b/)[1];
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === "me") return ok({ me: { id: "7" } });
    if (op === "boards") {
      const ids = JSON.parse(query.match(/column_values\(ids: (\[[^\]]*\])/)[1]);
      state.reads.push(ids);
      return ok({ boards: [{ id: "42", name: "Client board", board_kind: "share", hierarchy_type: multiLevel ? "multi_level" : "classic", columns: state.columns.map(view), groups: state.groups, views: state.views, items_page: { cursor: null, items: state.items.map((item) => shown(item, ids)) } }] });
    }
    if (op === "create_group") {
      state.groups.push({ id: `g${state.next}`, title: v.n });
      return ok({ create_group: { id: `g${state.next++}` } });
    }
    if (op === "create_item") {
      const item = { id: `i${state.next++}`, name: v.n, group: v.g, values: {}, updates: [] };
      write(item, JSON.parse(v.v));
      state.items.push(item);
      return ok({ create_item: { id: item.id, column_values: shown(item, v.c).column_values } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "change_multiple_column_values") {
      write(item, JSON.parse(v.v));
      return ok({ change_multiple_column_values: { id: v.i } });
    }
    if (op === "create_update") {
      const update = { id: `u${state.next++}`, body: v.b, text_body: v.b.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, ""), creator_id: "7", pinned_to_top: [] };
      item.updates.unshift(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      state.items.flatMap((each) => each.updates).find((update) => update.id === v.u).pinned_to_top = [{ item_id: v.i }];
      return ok({ pin_to_top: { id: v.u } });
    }
    if (op === "update_status_column") {
      const column = state.columns.find((each) => each.id === v.id);
      if (v.t) column.title = v.t;
      if (v.s) column.labels = v.s.labels.map((label, i) => ({ id: label.id ?? 100 + i, label: label.label, color: i, index: label.index, is_done: label.is_done }));
      if (query.includes("calculated: null")) column.capabilities.calculated = null;
      return ok({ update_status_column: { id: v.id } });
    }
    if (op === "create_column") {
      // As monday does with a column's own labels: none marked done.
      const labels = Object.entries(JSON.parse(v.d).labels).map(([id, label]) => ({ id: Number(id), label, color: Number(id), index: Number(id), is_done: false }));
      state.columns.push({ id: v.id, title: v.t, type: v.ty, revision: "new", labels, capabilities: { calculated: multiLevel ? { function: "COUNT_KEYS" } : null } });
      return ok({ create_column: { id: v.id } });
    }
    if (op === "change_column_title") {
      state.columns.find((column) => column.id === v.c).title = v.t;
      return ok({ change_column_title: { id: v.c } });
    }
    if (op === "create_view_table") {
      state.views.push({ name: v.n, groupBy: v.s.group_by.conditions[0].columnId });
      return ok({ create_view_table: { id: `v${state.views.length}` } });
    }
    throw new Error(`review monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, monday) {
  const out = [];
  const code = await runBoard(context(), args, { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {} });
  return { code, out };
}

/** Items made before v0.35.0, their status set to label 1, Done. */
function synced(monday) {
  const done = monday.state.columns.find((column) => column.id === "project_status");
  for (const [i, story] of wanted(context()).filter((each) => !each.removed).entries()) {
    const status = done.labels.find((label) => label.label === (story.values.status === "Built" ? "Done" : story.values.status)).id;
    monday.state.items.push({ id: `old${i}`, name: story.name, group: "topics", values: { story_id: story.id, area: "app", project_status: status, chunk: story.values.chunk, story: story.values.story, pr: "" }, updates: [{ id: `p${i}`, body: story.comment, text_body: story.comment.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, ""), creator_id: "7", pinned_to_top: [{ item_id: `old${i}` }] }] });
  }
  monday.state.groups.push({ id: "g0", title: "App · Sign in" }, { id: "g1", title: "App · Jobs" });
  for (const item of monday.state.items) item.group = item.name.includes("jobs") ? "g1" : "g0";
}

test("an upgraded board's Status becomes Build, and its Done label Built in place, so items set to it stay set", async () => {
  const monday = board();
  synced(monday);
  const before = await run(["setup"], monday);
  assert.deepEqual(before.out, [
    'column project_status is titled "Status"; wf board setup --create renames it "Build"',
    'column project_status (Build) has label "Done" marked done; wf board setup --create renames it "Built"',
    "2 to fix; wf board setup --create makes the missing columns.",
  ]);
  const stopped = await run(["plan"], monday);
  assert.equal(stopped.code, 1, "plan stops until it is renamed, so sync never sends a Built the board lacks");
  const fixed = await run(["setup", "--create"], monday);
  assert.equal(fixed.code, 0, fixed.out.join("\n"));
  assert.ok(fixed.out.includes('renamed column project_status "Status" to "Build"'));
  assert.ok(fixed.out.includes('renamed label 1 of column project_status "Done" to "Built", keeping its id'));
  const column = monday.state.columns.find((each) => each.id === "project_status");
  assert.equal(column.title, "Build");
  assert.deepEqual(column.labels.find((label) => label.id === 1), { id: 1, label: "Built", color: 1, index: 1, is_done: true });
  assert.deepEqual((await run(["plan"], monday)).out, ["0 to create, 0 to update, 0 comments, 0 to retire, 3 unchanged."], "an item that was Done reads Built, with no change");
});

test("Client review is the client's: sync never reads or writes it, and setup never checks its labels", async () => {
  const monday = board();
  await run(["setup", "--create"], monday);
  assert.equal((await run(["sync"], monday)).code, 0);
  assert.ok(monday.state.reads.every((ids) => !ids.includes("client_review") && !ids.includes("owner")), "never even read");
  assert.ok(!monday.state.sent.includes("client_review"), "never written, not even a starting value");
  assert.deepEqual((await run(["setup"], monday)).out, ["The board is set up."], "its own label, Ask Dana, and its missing ones are left alone");
  const without = board({ review: false });
  synced(without);
  await run(["setup", "--create"], without);
  without.state.columns = without.state.columns.filter((column) => column.id !== "client_review");
  const planned = await run(["plan"], without);
  assert.equal(planned.code, 0, "a missing Client review never stops a sync");
  assert.ok((await run(["setup"], without)).out.includes("column client_review (Client review, status) is missing"));
});

test("setup --create makes Client review once with its starter labels and the two views; on a multi-level board with the rollup off", async () => {
  const monday = board({ multiLevel: true, review: false, views: [] });
  const made = await run(["setup", "--create"], monday);
  assert.equal(made.code, 0, made.out.join("\n"));
  const review = monday.state.columns.find((column) => column.id === "client_review");
  assert.equal(review.title, "Client review");
  assert.deepEqual(review.labels.map((label) => `${label.label}${label.is_done ? " (done)" : ""}`), ["Not ready", "Approved (done)", "Ready for review", "Changes requested"]);
  assert.equal(review.capabilities.calculated, null, "the done label and the rollup in one change");
  assert.ok(made.out.includes("turned off column client_review's rollup of child items"));
  assert.deepEqual(monday.state.views.map((view) => `${view.name} by ${view.groupBy}`), ["Build by project_status", "Client review by client_review"]);
  assert.ok(made.out.includes("  for cards, add a Kanban view grouped by Client review on the board by hand; monday's API cannot make one"));
});

test("a status column with colours the API cannot name keeps its labels as they are, and asks for the rename by hand", async () => {
  // As Atlas NX's project_status on 2026-11-11: Planned and Drafting in monday's newer colours, 108 and 105.
  const monday = board();
  synced(monday);
  const column = monday.state.columns.find((each) => each.id === "project_status");
  column.labels.find((label) => label.label === "Planned").color = 108;
  column.labels.find((label) => label.label === "Drafting").color = 105;
  const byHand = 'column project_status (Build) has label "Done" marked done; rename it "Built" on the board by hand; monday\'s API cannot name the colours of "Planned", "Drafting", so setup does not resend this column\'s labels';
  assert.ok((await run(["setup"], monday)).out.includes(byHand));
  const before = structuredClone(column.labels);
  const made = await run(["setup", "--create"], monday);
  assert.equal(made.code, 1, "the rename is left to a person");
  assert.ok(made.out.includes('renamed column project_status "Status" to "Build"'), "the title has its own call, so it is still renamed");
  assert.deepEqual(column.labels, before, "no label resent, so none recoloured");
  assert.ok(made.out.includes(byHand));
  assert.equal((await run(["plan"], monday)).code, 1);
  // A person renames Done to Built on the board.
  column.labels.find((label) => label.id === 1).label = "Built";
  assert.deepEqual((await run(["plan"], monday)).out, ["0 to create, 0 to update, 0 comments, 0 to retire, 3 unchanged."]);
});
