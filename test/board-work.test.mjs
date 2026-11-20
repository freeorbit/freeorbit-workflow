import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { runBoard } from "../lib/board/index.mjs";
import { feedback } from "../lib/board/feedback.mjs";
import { workItemProblems } from "../lib/board/settings.mjs";
import { problems as docProblems } from "../lib/docs/check.mjs";
import { leakOf, phaseStatus, readPlan, readPlanDocs, readStatus } from "../lib/docs/plan.mjs";
import { questionProblems } from "../lib/logs/questions.mjs";
import { findId } from "../lib/idfind.mjs";
import { kindOf } from "../lib/ids.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const TOKEN = "tok-secret-123";
const PLAN_PATH = "docs/app/plan.md";
const PLAN = `# App: plan

## Where we are

The team's own notes, never read.

## Phase 1. Understand the work

Learn what the sign-in rules need before building them.

| ID | Step | Who | Status | Leaves behind | Unblocks |
| --- | --- | --- | --- | --- | --- |
| W-APP-01 | 1.1 Read the old sign-in rules | Developer | Done | \`notes/rules.md\` | |
| W-APP-02 | 1.2 Get the lockout policy from the client | Client, developer | Waiting on Glen: asked 2026-11-20 | A decision | APP-01 |

## Phase 2. Try the hard part

A short trial of the slowest sign-in path.

| ID | Step | Who | Status |
| --- | --- | --- | --- |
| W-APP-03 | 2.1 Time the sign-in on a slow line | Developer | Later: after 1.2 |
`;

const BASE = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md") };

/** A project over the board fixtures, with the plan listed unless `work` is false. */
function context(texts = {}, { work = true, board = {} } = {}) {
  const files = { ...BASE, [PLAN_PATH]: PLAN, ...texts };
  const more = work ? { workItems: { plans: { app: PLAN_PATH } } } : {};
  return {
    root: "/project",
    config: merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: merge({ boardId: "42", ...more }, board) }),
    tracked: Object.keys(files).filter((path) => files[path] !== null),
    files: (path) => files[path],
  };
}

const STATUS = (labels) => ({ type: "status", settings_str: JSON.stringify({ labels }), settings: { labels: [] }, capabilities: { calculated: null } });
const COLUMNS = [
  { id: "story_id", type: "text" },
  { id: "area", type: "text" },
  { id: "wf_status", title: "Build", ...STATUS({ 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Built" }) },
  { id: "chunk", type: "text" },
  { id: "story", type: "long_text" },
  { id: "pr", type: "link" },
  { id: "owner", type: "people" },
  { id: "client_review", title: "Client review", ...STATUS({ 0: "Not ready", 1: "Approved" }) },
  { id: "frames", type: "file" },
  { id: "built_screens", type: "file" },
];
const WORK_COLUMNS = [
  { id: "work_id", type: "text" },
  { id: "work_status", title: "Work status", ...STATUS({ 1: "Done", 0: "Now", 2: "Next", 3: "Later", 4: "Waiting" }) },
  { id: "work_who", type: "text" },
  { id: "work_note", type: "text" },
  { id: "unblocks", type: "text" },
];

/**
 * A board behind fetch. On a multi-level one, items_page lists only top-level
 * items, `items(ids:)` gives each one's subitems at every depth, and a
 * subitem sits in its parent's group. It answers only the column ids a query
 * asks for, as monday does.
 */
function fakeMonday({ multiLevel = true, workColumns = true, items = [], failOn = null } = {}) {
  const state = {
    columns: [...COLUMNS, ...(workColumns ? WORK_COLUMNS : [])].map((column) => ({ title: column.id, settings_str: "{}", capabilities: { calculated: null }, ...column })),
    groups: [{ id: "topics", title: "Group Title" }],
    items: structuredClone(items),
    next: 100,
    ops: [],
    queries: [],
    asked: [],
  };
  const newId = () => String((state.next += 1));
  const plain = (html) => html.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n+$/, "");
  const groupOf = (item) => state.groups.find((group) => group.id === item.group);
  const shown = (item, ids) => ({
    id: item.id,
    name: item.name,
    group: groupOf(item),
    parent_item: item.parent ? { id: item.parent } : null,
    column_values: ids.filter((id) => state.columns.some((column) => column.id === id)).map((id) => ({ id, text: item.values[id] ?? "", value: item.raw?.[id] ?? null })),
    updates: [...item.updates].reverse(),
  });
  const descendants = (id) => state.items.filter((item) => item.parent === id).flatMap((child) => [child, ...descendants(child.id)]);
  const write = (item, values) => {
    for (const [key, value] of Object.entries(values)) {
      if (key === "name") item.name = value;
      else if (key === "owner") {
        item.raw = { ...item.raw, owner: value ? JSON.stringify(value) : null };
        item.values.owner = value ? value.personsAndTeams.map((each) => `User ${each.id}`).join(", ") : "";
      } else item.values[key] = value && typeof value === "object" ? (value.label ?? value.text ?? value.url ?? "") : String(value ?? "");
    }
  };
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|items|create_group|create_item|create_subitem|change_multiple_column_values|move_item_to_group|create_update|edit_update|pin_to_top|create_column|update_status_column|create_view_table)\b/)[1];
    state.ops.push(op);
    state.queries.push(query);
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === failOn?.op && state.ops.filter((each) => each === op).length === failOn.at) return { status: 200, text: async () => JSON.stringify({ errors: [{ message: "monday is busy" }] }) };
    const ids = JSON.parse(query.match(/column_values\(ids: (\[[^\]]*\])\)/)?.[1] ?? "[]");
    if (op === "me") return ok({ me: { id: "7", name: "Owner" } });
    if (op === "boards")
      return ok({
        boards: [{ id: "42", name: "Client board", board_kind: "share", hierarchy_type: multiLevel ? "multi_level" : "classic", columns: state.columns, groups: state.groups, views: [{ name: "Build" }, { name: "Client review" }], items_page: { cursor: null, items: state.items.filter((item) => !item.parent).map((item) => shown(item, ids)) } }],
      });
    if (op === "items") {
      state.asked.push(v.i);
      return ok({ items: v.i.map((id) => ({ id, subitems: descendants(id).map((sub) => shown(sub, ids)) })) });
    }
    if (op === "create_group") {
      const group = { id: `g${newId()}`, title: v.n };
      state.groups.push(group);
      return ok({ create_group: { id: group.id } });
    }
    if (op === "create_item" || op === "create_subitem") {
      const parent = op === "create_subitem" ? state.items.find((each) => each.id === v.p) : null;
      const item = { id: newId(), name: v.n, group: parent ? parent.group : v.g, parent: parent?.id ?? null, values: {}, raw: {}, updates: [] };
      write(item, JSON.parse(v.v));
      state.items.push(item);
      return ok({ [op]: { id: item.id, column_values: shown(item, v.c) .column_values } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "change_multiple_column_values") {
      write(item, JSON.parse(v.v));
      return ok({ change_multiple_column_values: { id: item.id } });
    }
    if (op === "move_item_to_group") {
      for (const each of [item, ...descendants(item.id)]) each.group = v.g;
      return ok({ move_item_to_group: { id: item.id } });
    }
    if (op === "create_update") {
      const update = { id: `u${newId()}`, body: v.b, text_body: plain(v.b), creator_id: "7", pinned_to_top: [] };
      item.updates.push(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "edit_update") {
      const update = state.items.flatMap((each) => each.updates).find((each) => each.id === v.u);
      Object.assign(update, { body: v.b, text_body: plain(v.b) });
      return ok({ edit_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      state.items.flatMap((each) => each.updates).find((each) => each.id === v.u).pinned_to_top.push({ item_id: v.i });
      return ok({ pin_to_top: { id: v.u } });
    }
    if (op === "create_column") {
      state.columns.push({ id: v.id, title: v.t, type: v.ty, revision: "r1", settings_str: v.d ?? "{}", settings: { labels: [] }, capabilities: { calculated: null } });
      return ok({ create_column: { id: v.id } });
    }
    if (op === "update_status_column") return ok({ update_status_column: { id: v.id } });
    if (op === "create_view_table") return ok({ create_view_table: { id: "v1" } });
    throw new Error(`fake monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, monday, texts = {}, options = {}) {
  const out = [];
  const code = await runBoard(context(texts, options), args, { env: { MONDAY_API_TOKEN: TOKEN }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {} });
  return { code, out };
}

const workOf = (monday, id) => monday.state.items.find((item) => item.values.work_id === id);
const writes = (monday, from = 0) => monday.state.ops.slice(from).filter((op) => !["boards", "items", "me"].includes(op));

// ---- the plan doc ----

test("a plan doc's phases and steps are read with their status words, and the team's sections are not", () => {
  const { phases, problems } = readPlan(PLAN, { path: PLAN_PATH, prefix: "APP", prefixes: ["APP"], stories: new Set(["APP-01"]) });
  assert.deepEqual(problems, []);
  assert.deepEqual(phases.map((phase) => `${phase.id} ${phase.title} | ${phase.lead}`), ["W-APP-P1 Phase 1. Understand the work | Learn what the sign-in rules need before building them.", "W-APP-P2 Phase 2. Try the hard part | A short trial of the slowest sign-in path."]);
  assert.deepEqual(phases[0].steps.map((step) => `${step.id} ${step.name} | ${step.key} ${step.waitsOn} ${step.unblocks} | ${step.note}`), ["W-APP-01 1.1 Read the old sign-in rules | done null  | ", "W-APP-02 1.2 Get the lockout policy from the client | waiting Glen APP-01 | Waiting on Glen: asked 2026-11-20"]);
  assert.deepEqual(["Done", "Done, as a draft", "Now: asked", "Next", "Later: after 1.7"].map((cell) => [readStatus(cell).key, readStatus(cell).note]), [["done", ""], ["done", "Done, as a draft"], ["now", "Now: asked"], ["next", ""], ["later", "Later: after 1.7"]]);
  assert.match(readStatus("Waiting for Glen").problem, /Waiting on <name>/);
  assert.match(readStatus("Blocked").problem, /not one of Done, Now, Next, Later, Waiting/);
  assert.match(readStatus("Done as a draft").problem, /comma or colon/);
  assert.deepEqual([[], ["done"], ["done", "later"], ["done", "now", "waiting"], ["next", "later"]].map(phaseStatus), ["later", "done", "later", "waiting", "next"]);
});

test("what the client reads holds no ID, link, backtick, or path, and a story ID says where the work belongs", () => {
  assert.equal(leakOf("Round 2 with the expert, after 1.6, asked 2026-11-20"), null);
  assert.match(leakOf("Answer Q-027 and Q-028"), /holds Q-027/);
  assert.match(leakOf("Per D-ANL-001"), /holds D-ANL-001/);
  assert.match(leakOf("Read the form MIN-RAS-0057"), /holds MIN-RAS-0057/);
  assert.match(leakOf("See [the note](notes.md)"), /link/);
  assert.match(leakOf("JSON in tools/source-analysis/profiles/"), /file path/);
  assert.match(leakOf("Update profile-summary.md"), /file path/);
  assert.match(leakOf("Run `wf screens`"), /backtick/);
  assert.match(leakOf("Build APP-04 first", ["APP"]), /names story APP-04; a step that builds a story belongs to the build order/);
});

test("a plan doc out of shape fails on each line, and nothing passes as a step", () => {
  const bad = `## Phase 1. First

One. Two sentences here.

| Step | Who | Status |
| --- | --- | --- |
| 1.1 Do it | Dev | Done |

## Phase 3. Skipped a number

The lead.

| ID | Step | Who | Status | Owner |
| --- | --- | --- | --- | --- |
| W-APP-01 | 2.1 Wrong phase | | Blocked | x |
| W-APP-01 | 3.1 Answer Q-012 | Dev | Waiting for Glen | x |
| W-DOC-02 | 3.1 Same number | Dev | Done | x |

## Phase 4 no dot
`;
  const { problems } = readPlan(bad, { path: "p.md", prefix: "APP", prefixes: ["APP"] });
  for (const want of [
    /p\.md:1: the phase's lead is more than one sentence/,
    /p\.md:5: the steps table's first column is "Step", not ID/,
    /p\.md:5: the steps table has no ID column/,
    /p\.md:9: Phase 3 comes after Phase 1/,
    /column "Owner" is not one a step has/,
    /p\.md:15: W-APP-01's Step 2\.1 is not numbered under Phase 3/,
    /p\.md:15: W-APP-01 has no Who/,
    /p\.md:15: W-APP-01's Status starts "Blocked"/,
    /p\.md:16: W-APP-01 is also the ID of the step on line 15/,
    /p\.md:16: W-APP-01's Step holds Q-012/,
    /p\.md:17: "W-DOC-02" is not a step ID such as W-APP-01/,
    /"## Phase 4 no dot" is not "## Phase N\. Title"/,
  ])
    assert.ok(problems.some((problem) => want.test(problem)), `${want} in:\n${problems.join("\n")}`);
  assert.equal(problems.filter((problem) => /is not a step ID/.test(problem)).length, 1, "a table with no ID column says so once, not on each row");
});

test("doc:check's plan problems: a doc not in the repo, an Unblocks no live story is, and an ID two plans share", () => {
  assert.deepEqual(readPlanDocs(context({}, { work: false })), { plans: [], problems: [] }, "no plan listed, nothing read");
  const unblocks = PLAN.replace("| APP-01 |", "| APP-03 |");
  assert.ok(readPlanDocs(context({ [PLAN_PATH]: unblocks })).problems.some((problem) => /W-APP-02's Unblocks names APP-03, which is not a live story/.test(problem)), "APP-03 is removed");
  assert.match(readPlanDocs(context({ [PLAN_PATH]: null })).problems.join("\n"), /docs\/app\/plan\.md: board\.workItems\.plans names it as app's plan doc, and it is not in the repo/);
  const twice = context({ "docs/jobs/plan.md": "## Phase 1. Jobs\n\nThe lead.\n\n| ID | Step | Who | Status |\n| --- | --- | --- | --- |\n| W-APP-01 | 1.1 Again | Dev | Next |\n" });
  twice.config.areas.push({ id: "jobs", prefix: "APP" });
  twice.config.board.workItems.plans.jobs = "docs/jobs/plan.md";
  assert.match(readPlanDocs(twice).problems.join("\n"), /W-APP-01 is also a step in docs\/app\/plan\.md; an ID is unique across the app/);
});

test("the work items config: a listed area, a path inside the repo, a plain group, people's ids, and labels of their own", () => {
  const config = context({}, { board: { workItems: { plans: { nowhere: "../x.md" }, group: "<b>Work</b>", people: { Glen: "glen@example.com" } }, workStatuses: { now: "Done" } } }).config;
  const found = workItemProblems(config).join("\n");
  for (const want of [/names area "nowhere", which areas does not list/, /plans\.nowhere "\.\.\/x\.md" is a \.md path inside the repo/, /group "<b>Work<\/b>" is 1 to 100 characters, with no line break or angle bracket/, /people\.Glen is "glen@example\.com", not a monday user id/, /workStatuses are each a label of their own/])
    assert.match(found, want);
  assert.deepEqual(workItemProblems(context().config), []);
});

test("doc:check reports a plan doc's problem once, with or without a board", async () => {
  const bad = { [PLAN_PATH]: PLAN.replace("Developer | Done", "Developer | Finished") };
  for (const boardId of ["42", ""]) {
    const ctx = context(bad, { board: { boardId, workItems: { people: { glen: "x" } } } });
    const found = await docProblems(ctx);
    assert.equal(found.filter((problem) => /W-APP-01's Status starts "Finished"/.test(problem)).length, 1, `boardId "${boardId}"`);
    assert.equal(found.filter((problem) => /people\.glen is "x"/.test(problem)).length, 1, `boardId "${boardId}"`);
  }
});

test("an open question's Story cell takes a work item's ID, a step's or a phase's", () => {
  const log = (story) => `# Open questions\n\n## None\n\n| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |\n| Q-001 | Which date? | owner | client (monday) | ${story} | 2026-11-20 |\n`;
  const check = (story) => {
    const ctx = context({ "docs/log/open-questions.md": log(story) });
    return questionProblems(ctx).filter((problem) => /Story is/.test(problem));
  };
  assert.deepEqual(check("W-APP-02, APP-01, W-APP-P1"), []);
  assert.equal(check("W-APP-2").length, 1);
});

test("wf id knows a work item, and finds where a step and a phase are defined", () => {
  const ctx = context();
  assert.equal(kindOf("W-APP-02", ctx.config), "work");
  assert.equal(kindOf("W-APP-P1", ctx.config), "work");
  assert.deepEqual(findId(ctx, "W-APP-02").defined.map((at) => `${at.path}:${at.line}`), [`${PLAN_PATH}:14`]);
  assert.deepEqual(findId(ctx, "W-APP-P2").defined.map((at) => `${at.path}:${at.line} ${at.text}`), [`${PLAN_PATH}:16 ## Phase 2. Try the hard part`]);
});

// ---- the board ----

test("plan on a multi-level board lists each phase and its steps to create, after the stories, and writes nothing", async () => {
  const monday = fakeMonday();
  const { code, out } = await run(["plan"], monday);
  assert.equal(code, 0, out.join("\n"));
  assert.deepEqual(out.slice(3), [
    "create  W-APP-P1 Phase 1. Understand the work  [App · Behind the scenes]",
    "create  W-APP-01 1.1 Read the old sign-in rules  [under W-APP-P1]",
    "create  W-APP-02 1.2 Get the lockout policy from the client  [under W-APP-P1]",
    "create  W-APP-P2 Phase 2. Try the hard part  [App · Behind the scenes]",
    "create  W-APP-03 2.1 Time the sign-in on a slow line  [under W-APP-P2]",
    "3 to create, 0 to update, 0 comments, 0 to retire, 0 unchanged.",
    "Work items: 5 to create, 0 to update, 0 lead comments, 0 to retire, 0 unchanged.",
  ]);
  assert.deepEqual(writes(monday), [], "plan only reads");
});

test("sync makes phases with their steps as subitems and each phase's lead pinned; a second sync changes nothing", async () => {
  const monday = fakeMonday();
  const first = await run(["sync"], monday);
  assert.equal(first.code, 0, first.out.join("\n"));
  const phase = workOf(monday, "W-APP-P1");
  assert.equal(monday.state.groups.find((group) => group.id === phase.group).title, "App · Behind the scenes");
  assert.deepEqual([phase.name, phase.values.work_status], ["Phase 1. Understand the work", "Waiting"]);
  assert.equal(workOf(monday, "W-APP-P2").values.work_status, "Later");
  const step = workOf(monday, "W-APP-02");
  assert.equal(step.parent, phase.id);
  assert.deepEqual(
    { name: step.name, status: step.values.work_status, who: step.values.work_who, note: step.values.work_note, unblocks: step.values.unblocks, story: step.values.story_id ?? "" },
    { name: "1.2 Get the lockout policy from the client", status: "Waiting", who: "Client, developer", note: "Waiting on Glen: asked 2026-11-20", unblocks: "APP-01", story: "" },
  );
  assert.equal(workOf(monday, "W-APP-01").values.work_note, "", "a bare status word needs no note");
  assert.equal(phase.updates.length, 1);
  assert.match(phase.updates[0].text_body, /^🤖 I'm Orbit[\s\S]*\nAbout this phase\nLearn what the sign-in rules need before building them\.$/);
  assert.deepEqual(phase.updates[0].pinned_to_top, [{ item_id: phase.id }]);
  assert.equal(step.updates.length, 0, "a step's status sits in its columns only");
  assert.ok(!JSON.stringify(monday.state.items.filter((item) => item.values.work_id)).includes("notes/rules.md"), "Leaves behind never reaches the board");
  const before = monday.state.ops.length;
  const second = await run(["sync"], monday);
  assert.deepEqual(second.out, ["0 to create, 0 to update, 0 comments, 0 to retire, 3 unchanged.", "Work items: 0 to create, 0 to update, 0 lead comments, 0 to retire, 5 unchanged.", "Client board is in step."]);
  assert.deepEqual(writes(monday, before), []);
});

test("a step's change is written in place: renumbered keeps its item, a new status, and one taken out retires", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  const changed = PLAN.replace("| W-APP-01 | 1.1 Read the old sign-in rules | Developer | Done | `notes/rules.md` | |\n", "")
    .replace("1.2 Get the lockout policy from the client", "1.1 Get the lockout policy from the client")
    .replace("Waiting on Glen: asked 2026-11-20", "Done");
  const texts = { [PLAN_PATH]: changed };
  const planned = await run(["plan"], monday, texts);
  assert.deepEqual(planned.out.filter((line) => /W-APP/.test(line)), [
    "update  W-APP-P1  Work status: Waiting → Done",
    "update  W-APP-02  Name: 1.2 Get the lockout policy from the client → 1.1 Get the lockout policy from the client; Work status: Waiting → Done; Status note: Waiting on Glen: asked 2026-11-20 → (empty)",
    "retire  W-APP-01  → Retired",
  ]);
  const kept = workOf(monday, "W-APP-02").id;
  const before = monday.state.ops.length;
  assert.equal((await run(["sync"], monday, texts)).code, 0);
  assert.deepEqual(writes(monday, before), ["change_multiple_column_values", "change_multiple_column_values", "create_group", "move_item_to_group"]);
  assert.equal(workOf(monday, "W-APP-02").id, kept, "the renamed step is the same item, with its replies");
  assert.equal(monday.state.groups.find((group) => group.id === workOf(monday, "W-APP-01").group).title, "Retired");
  assert.equal(monday.state.items.length, 8, "nothing is deleted: three stories, two phases, three steps");
  const again = await run(["plan"], monday, texts);
  assert.match(again.out.at(-1), /^Work items: 0 to create, 0 to update, 0 lead comments, 0 to retire, 4 unchanged\.$/);
});

test("a retired phase takes its steps with it, and a changed lead is edited in place", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  const texts = { [PLAN_PATH]: PLAN.split("## Phase 2.")[0].replace("Learn what the sign-in rules need before building them.", "Learn the sign-in rules first.") };
  const planned = await run(["plan"], monday, texts);
  assert.deepEqual(planned.out.filter((line) => /W-APP/.test(line)), ["comment W-APP-P1  edit phase lead", "retire  W-APP-P2  → Retired"]);
  await run(["sync"], monday, texts);
  const retired = monday.state.groups.find((group) => group.title === "Retired").id;
  assert.deepEqual([workOf(monday, "W-APP-P2").group, workOf(monday, "W-APP-03").group], [retired, retired]);
  assert.match(workOf(monday, "W-APP-P1").updates[0].text_body, /Learn the sign-in rules first\.$/);
  assert.equal(workOf(monday, "W-APP-P1").updates.length, 1);
});

test("Owner follows Waiting on a named person, and is cleared once the step stops waiting", async () => {
  const monday = fakeMonday();
  const people = { board: { workItems: { people: { glen: 48202303 } } } };
  await run(["sync"], monday, {}, people);
  assert.deepEqual(JSON.parse(workOf(monday, "W-APP-02").raw.owner), { personsAndTeams: [{ id: 48202303, kind: "person" }] });
  assert.equal(workOf(monday, "W-APP-01").raw.owner ?? null, null);
  const texts = { [PLAN_PATH]: PLAN.replace("Waiting on Glen: asked 2026-11-20", "Now") };
  const planned = await run(["plan"], monday, texts, people);
  assert.match(planned.out.find((line) => line.startsWith("update  W-APP-02")), /Owner: User 48202303 → \(empty\)/);
  await run(["sync"], monday, texts, people);
  assert.equal(workOf(monday, "W-APP-02").raw.owner, null, "cleared with null");
  const unknown = await run(["plan"], monday, { [PLAN_PATH]: PLAN.replace("Waiting on Glen", "Waiting on Ana") }, people);
  assert.ok(unknown.out.includes("skip    W-APP-02 waits on Ana, whom board.workItems.people does not name, so Owner stays empty"));
  const noPeople = await run(["plan"], monday, texts);
  assert.ok(!noPeople.out.some((line) => /Owner/.test(line)), "with no people named, sync never writes Owner");
});

test("an item with a Work ID and no Story ID is never retired or edited by the story sync", async () => {
  const stray = { id: "900", name: "1.9 A step the doc dropped", group: "topics", parent: null, values: { work_id: "W-APP-09", work_status: "Now" }, raw: {}, updates: [] };
  for (const work of [false, true]) {
    const monday = fakeMonday({ items: [stray] });
    const { out } = await run(["sync"], monday, {}, { work });
    assert.deepEqual(out.filter((line) => /W-APP-09|900/.test(line)), work ? ["retire  W-APP-09  → Retired", "retired W-APP-09"] : [], out.join("\n"));
    const item = monday.state.items.find((each) => each.id === "900");
    assert.equal(item.name, "1.9 A step the doc dropped");
    assert.equal(item.values.work_status, "Now");
    // Only the work sync, while a plan is listed, retires it.
    assert.equal(monday.state.groups.find((group) => group.id === item.group).title, work ? "Retired" : "Group Title");
  }
});

test("with no plan listed, nothing changes: no work column is read, no subitem is asked for, and plan prints as before", async () => {
  const monday = fakeMonday({ workColumns: false });
  const { code, out } = await run(["plan"], monday, {}, { work: false });
  assert.equal(code, 0, out.join("\n"));
  assert.equal(out.at(-1), "3 to create, 0 to update, 0 comments, 0 to retire, 0 unchanged.");
  assert.ok(!monday.state.ops.includes("items"));
  assert.ok(!monday.state.queries.some((query) => /work_|unblocks|"owner"/.test(query)));
});

test("on a flat board each phase is a group, its item first, with its steps as items beside it", async () => {
  const monday = fakeMonday({ multiLevel: false });
  const planned = await run(["plan"], monday);
  assert.ok(planned.out.includes("create  W-APP-01 1.1 Read the old sign-in rules  [App · Behind the scenes · Phase 1. Understand the work]"), planned.out.join("\n"));
  await run(["sync"], monday);
  const group = (id) => monday.state.groups.find((each) => each.id === workOf(monday, id).group).title;
  assert.deepEqual(["W-APP-P1", "W-APP-02", "W-APP-P2", "W-APP-03"].map(group), ["App · Behind the scenes · Phase 1. Understand the work", "App · Behind the scenes · Phase 1. Understand the work", "App · Behind the scenes · Phase 2. Try the hard part", "App · Behind the scenes · Phase 2. Try the hard part"]);
  assert.ok(monday.state.items.every((item) => !item.parent));
  assert.ok(!monday.state.ops.includes("items") && !monday.state.ops.includes("create_subitem"));
  assert.match((await run(["plan"], monday)).out.at(-1), /^Work items: 0 to create.*5 unchanged\.$/);
});

test("a sync cut short is finished by the next, and a phase that lost its Work ID is found by its steps", async () => {
  const monday = fakeMonday({ failOn: { op: "create_subitem", at: 2 } });
  await assert.rejects(run(["sync"], monday), /monday is busy.*run npx --no wf board sync again/);
  assert.equal(monday.state.items.filter((item) => item.values.work_id).length, 2, "the first phase and its first step");
  const next = await run(["sync"], monday);
  assert.equal(next.code, 0, next.out.join("\n"));
  assert.equal(monday.state.items.filter((item) => item.values.work_id).length, 5);
  assert.equal(monday.state.items.filter((item) => item.values.work_id === "W-APP-P1").length, 1);
  // A phase whose Work ID was cleared, by hand or a run cut short, is found again by its steps.
  workOf(monday, "W-APP-P1").values = {};
  const planned = await run(["plan"], monday);
  assert.ok(planned.out.includes("update  W-APP-P1  Work ID: (empty) → W-APP-P1; Work status: (empty) → Waiting"), planned.out.join("\n"));
  assert.ok(!planned.out.some((line) => line.startsWith("create")));
});

test("a step moved under another phase on a multi-level board stops the sync with what to do", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  const moved = PLAN.replace("| W-APP-03 | 2.1 Time", "| W-APP-02 | 2.1 Time").replace(/\| W-APP-02 \| 1\.2 [^\n]*\n/, "");
  const before = monday.state.ops.length;
  const { code, out } = await run(["sync"], monday, { [PLAN_PATH]: moved });
  assert.equal(code, 1);
  assert.ok(out.some((line) => /board {3}W-APP-02 is under item \d+ on the board, not W-APP-P2; monday cannot move a subitem to another phase, so give the step a new ID/.test(line)), out.join("\n"));
  assert.deepEqual(writes(monday, before), [], "nothing written while a problem stands");
});

test("a plan doc with a problem stops the whole sync, stories too", async () => {
  const monday = fakeMonday();
  const { code, out } = await run(["sync"], monday, { [PLAN_PATH]: PLAN.replace("Developer | Done", "Developer | Finished") });
  assert.equal(code, 1);
  assert.ok(out.some((line) => line.startsWith("board   docs/app/plan.md:13: W-APP-01's Status starts \"Finished\"")), out.join("\n"));
  assert.deepEqual(writes(monday), []);
});

test("setup checks and makes the work columns, with Done marked done on Work status", async () => {
  const monday = fakeMonday({ workColumns: false });
  const checked = await run(["setup"], monday);
  assert.equal(checked.code, 1);
  for (const want of ["column work_id (Work ID, text) is missing", "column work_status (Work status, status) is missing", "column work_who (Who, text) is missing", "column work_note (Status note, text) is missing", "column unblocks (Unblocks, text) is missing"])
    assert.ok(checked.out.includes(want), checked.out.join("\n"));
  const made = await run(["setup", "--create"], monday);
  assert.ok(made.out.includes('marked "Done" done on column work_status'), made.out.join("\n"));
  const labels = JSON.parse(monday.state.columns.find((column) => column.id === "work_status").settings_str).labels;
  assert.equal(labels["1"], "Done");
  assert.deepEqual(Object.values(labels).sort(), ["Done", "Later", "Next", "Now", "Waiting"]);
  const off = await run(["setup"], fakeMonday({ workColumns: false }), {}, { work: false });
  assert.ok(!off.out.some((line) => /work_|unblocks/.test(line)), "no plan listed, no work column asked for");
});

test("feedback reads a guest's comment on a step as it reads one on a story, keyed by its Work ID", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  workOf(monday, "W-APP-02").updates.push({ id: "c1", body: "Sent them today.", text_body: "Sent them today.", creator_id: "55", creator: { name: "Glen", kind: "guest" }, created_at: "2026-11-21T01:00:00Z", replies: [] });
  const out = [];
  assert.equal(await runBoard(context(), ["feedback"], { env: { MONDAY_API_TOKEN: TOKEN }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "" }), 0);
  assert.ok(out.includes("W-APP-02  1.2 Get the lockout policy from the client"), out.join("\n"));
  assert.ok(out.includes("  > Sent them today."));
  const board = { items: [], subitems: [{ id: "5", name: "Phase", column_values: [{ id: "work_id", text: "W-APP-P1" }], updates: [{ id: "u1", text_body: "🤖 I'm Orbit\nAbout this phase\nLead.", creator_id: "7", replies: [{ id: "r1", text_body: "Why?", creator: { kind: "guest" }, created_at: "b" }] }] }] };
  assert.deepEqual(feedback(context().config, board, "7").pending.map((entry) => `${entry.story} ${entry.where}`), ["W-APP-P1 reply to the phase lead"]);
});

test("text a guest types into a Work ID or Story ID column is no key: never moved, never in feedback", async () => {
  const hand = { id: "950", name: "Team's own item", group: "topics", parent: null, values: { work_id: "W-APP-07;touch x" }, raw: {}, updates: [{ id: "c9", text_body: "Hi", creator_id: "55", creator: { name: "Guest", kind: "guest" }, created_at: "a", replies: [] }] };
  const monday = fakeMonday({ items: [hand] });
  const { out } = await run(["sync"], monday);
  assert.ok(!out.some((line) => /touch|950/.test(line)), out.join("\n"));
  assert.equal(monday.state.items.find((item) => item.id === "950").group, "topics");
  const board = { items: [{ id: "1", name: "x", column_values: [{ id: "story_id", text: "APP-01 x" }, { id: "work_id", text: "W-APP-07$(id)" }], updates: hand.updates }], subitems: [] };
  assert.deepEqual(feedback(context().config, board, "7").pending, []);
});

test("a work plan line shows board text cut and printable, so a guest's edit cannot fake a line", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  workOf(monday, "W-APP-03").values.work_who = `Developer\n0 problems. Sync is safe.\u001b[2J${"x".repeat(200)}`;
  const { out } = await run(["plan"], monday);
  const line = out.find((each) => each.startsWith("update  W-APP-03"));
  assert.ok(!/\n|\u001b/.test(line) && line.length < 200, line);
  assert.match(line, /^update {2}W-APP-03 {2}Who: Developer 0 problems\. Sync is safe\.�\[2Jx+… → Developer$/);
});

test("subitems are read 25 parents a call, and a retired step is never a parent", async () => {
  const items = Array.from({ length: 26 }, (_, i) => ({ id: `p${i}`, name: `Hand ${i}`, group: "topics", parent: null, values: {}, raw: {}, updates: [] }));
  items.push({ id: "r1", name: "1.9 Retired", group: "topics", parent: null, values: { work_id: "W-APP-09" }, raw: {}, updates: [] });
  const monday = fakeMonday({ items });
  await run(["plan"], monday);
  const reads = monday.state.queries.filter((query) => /items\(ids:/.test(query)).length;
  assert.equal(reads, 2);
  const asked = monday.state.asked.flat();
  assert.equal(asked.length, 26);
  assert.ok(!asked.includes("r1"));
});
