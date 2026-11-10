// `wf board setup | plan | sync`: the project's stories shown on a monday.com
// board, one way (docs/design/board-sync.md). The repo is the source of truth:
//
//   setup [--create]  the board's columns, status labels, and Kanban view against the config
//   plan              each item sync would create, change, comment on, or retire
//   sync              the same, written: only what differs, never a delete
//   feedback [--json] the client's comments with no bot reply yet (feedback.mjs)
//   reply <id> <Q-ID ...|--noted> [-- <id> ...]   the bot's replies, in voice.mjs's words
//
// An item is found by its Story ID column. Its name is `<ID> · <title>`, its
// group `<Area> · <## heading>`, and its Story column the "As a…" sentence.
// The acceptance lines go in a pinned comment by the token's own user, whose
// text holds the "Acceptance criteria" heading; sync edits it when it differs.
// A story marked Removed, or an item whose Story ID no story file defines,
// moves to the retired group. The PR column links the pull request of the
// story's lane finished last, read from git history (prs.mjs). The Owner
// column is the team's, assigned by hand: setup makes it, and sync never
// touches it. Sync checks everything first and writes nothing while a problem
// stands, so the board is never half updated.

import { matcher } from "../config.mjs";
import { areaOf, readStories } from "../docs/stories.mjs";
import { statusOf, storiesDone, storyRows } from "./status.mjs";
import { chunkPrs, repoUrl, runGit, storyPr } from "./prs.mjs";
import { changeValues, createColumn, createGroup, createItem, createUpdate, editUpdate, mondayClient, moveToGroup, pinUpdate, readBoard, retryNotFound, updateStatusColumn, whoAmI, withLabels, createGroupedView, changeColumnTitle, unnamedColors } from "./monday.mjs";

import { HEADING, isPinned, MARK, pinnedNote } from "./voice.mjs";
import { feedback, feedbackLines, replyBatch, replyGroups } from "./feedback.mjs";
import { replyTo } from "./monday.mjs";
import { questionRows } from "../questions.mjs";
import { boardProblems } from "./settings.mjs";

export { HEADING };
export { boardProblems };

/** monday's long-text column keeps 2,000 characters and cuts the rest with no error (the 2026-11-10 trial). */
export const LONG_TEXT_LIMIT = 2000;

/** Each column the board needs: its config key, title, and monday type. */
export const COLUMNS = [
  { key: "storyId", title: "Story ID", type: "text" },
  { key: "area", title: "Area", type: "text" },
  { key: "status", title: "Status", type: "status" },
  { key: "chunk", title: "Chunk", type: "text" },
  { key: "story", title: "Story", type: "long_text" },
  { key: "pr", title: "PR", type: "link" },
  // Assigned by hand on the board: setup makes it, and sync never reads or writes it.
  { key: "owner", title: "Owner", type: "people" },
  // The client's and the team's say on a story: setup makes it once with starter labels, and sync never reads or writes it.
  { key: "clientReview", title: "Client review", type: "status" },
];
/** Columns setup makes but sync leaves alone, so one missing never stops a sync, and their values are never read. */
export const UNSYNCED = ["owner", "clientReview"];
/** The views setup makes, each a table grouped by a status column and named by its title. */
const VIEWS = ["status", "clientReview"];
const SYNCED = ["storyId", "area", "status", "chunk", "story"];
const LABELS = { storyId: "Story ID", area: "Area", status: "Status", chunk: "Chunk", story: "Story" };

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Inline Markdown a story uses, as HTML: code and bold. */
const inline = (text) =>
  escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
/** Text with markup, bullets, and spacing gone, so two renderings of one comment compare equal. */
export const flat = (text) =>
  String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[`*•\s ]/g, "")
    .replace(/[’‘]/g, "'");

/** An HTML text's tags in order, without attributes, so a change of layout with the same words still shows. */
export const tags = (html) => [...String(html ?? "").matchAll(/<\/?([a-z0-9]+)/gi)].map((match) => match[0].toLowerCase()).join("");

/** The pinned comment's HTML for a story. */
export function commentHtml(story, botName = "Orbit") {
  const items = story.acceptance.map((line) => `<li>${inline(line.text)}${line.sub.length ? `<ul>${line.sub.map((sub) => `<li>${inline(sub)}</li>`).join("")}</ul>` : ""}</li>`).join("");
  return `<blockquote><p>${MARK} ${escape(pinnedNote(botName))}</p></blockquote><p><strong>${HEADING}</strong></p><p>${inline(story.as)}</p>${items ? `<ul>${items}</ul>` : ""}`;
}

/** Every story in the project's story files, with its area. */
export function projectStories({ config, tracked, files }) {
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFile = matcher(config.stories.files);
  return tracked
    .filter(storyFile)
    .sort()
    .flatMap((path) => readStories(files(path), prefixes, path))
    .map((story) => ({ ...story, area: areaOf(config, story.id) }));
}

/** What the board should hold for each live story: { id, name, group, values, comment, story }. */
export function wanted(context, { git = () => "", env = {} } = {}) {
  const { config, tracked, files } = context;
  const present = new Set(tracked);
  const read = (path) => (present.has(path) ? files(path) : "");
  const order = read(config.buildOrder.file);
  const rows = storyRows(config, order, read(config.buildOrder.done));
  const doneChunks = [...new Set([...rows.values()].flat().filter((lane) => lane.state === "done").map((lane) => lane.chunk))];
  const prs = chunkPrs(git, config.buildOrder.done, doneChunks);
  const repo = prs.size ? repoUrl(git, env) : null;
  return projectStories(context).map((story) => {
    const areaName = capital(story.area?.id ?? story.id.split("-")[0].toLowerCase());
    const lanes = rows.get(story.id) ?? [];
    const status = statusOf(storiesDone(order, story.area?.id), lanes);
    const pr = repo ? storyPr(lanes, prs) : null;
    return {
      id: story.id,
      removed: story.removed,
      name: `${story.id} · ${story.title}`,
      group: story.group ? `${areaName} · ${story.group}` : areaName,
      values: { storyId: story.id, area: story.area?.id ?? "", status: config.board.statuses[status], chunk: lanes.map((lane) => lane.chunk).join(", "), story: story.as },
      comment: commentHtml(story, config.board.bot.name),
      // The pull request of the lane finished last, or null; sync never clears a link it cannot work out.
      pr: pr ? { url: `${repo}/pull/${pr.number}`, text: `#${pr.number}` } : null,
      story,
    };
  });
}

/** A column value as monday's column_values JSON wants it. */
function written(key, value) {
  if (key === "status") return { label: value };
  if (key === "story") return { text: value };
  return value;
}

/** The board's problems with its columns and labels, and the Kanban view, as lines; `missing` lists the columns to create. */
/**
 * A new status column's labels, as create_column's defaults. monday marks label
 * 1 done in a new column (done_colors [1], the 2026-11-10 trial), so the done
 * label takes id 1 and the rest the ids around it.
 */
function startingLabels(config, key) {
  const names = key === "clientReview" ? config.board.reviewLabels : Object.values(config.board.statuses);
  const done = key === "clientReview" ? config.board.reviewDone : config.board.statuses.done;
  const rest = names.filter((name) => name !== done);
  const ids = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return { labels: Object.fromEntries([["1", done], ...rest.map((name, i) => [String(ids[i]), name])]) };
}

/** The kit's status labels a status column has not got. */
function absentLabels(config, column) {
  let labels = [];
  try {
    labels = Object.values(JSON.parse(column.settings_str || "{}").labels ?? {});
  } catch {
    // An unreadable settings string has no labels.
  }
  return Object.values(config.board.statuses).filter((label) => !labels.includes(label));
}

export function setupProblems(config, board) {
  const lines = [];
  const missing = [];
  const statusFixes = [];
  const views = [];
  // One synced item shows which columns monday keeps on items; a portfolio's own columns, such as a project template's status, it does not.
  const sample = (board.items ?? []).find((item) => item.column_values.some((value) => value.id === config.board.columns.storyId && value.text));
  for (const column of COLUMNS) {
    const id = config.board.columns[column.key];
    const title = config.board.titles[column.key] ?? column.title;
    const found = board.columns.find((each) => each.id === id);
    if (!found) {
      lines.push(`column ${id} (${title}, ${column.type}) is missing`);
      missing.push({ ...column, id, title });
      continue;
    }
    if (found.type !== column.type) {
      lines.push(`column ${id} (${title}) is ${found.type}, not ${column.type}`);
      continue;
    }
    const fix = { column: found, labels: [], renames: {}, noRollup: false, title: null };
    // A multi-level board, from monday's project template, makes a new status column roll up child items:
    // monday then leaves it out of every item, and accepts a write to it and drops it.
    const rollup = column.type === "status" && board.multiLevel && Boolean(found.capabilities?.calculated?.function);
    if (rollup) {
      lines.push(`column ${id} (${title}) rolls up child items, so monday ignores writes; wf board setup --create turns the rollup off`);
      fix.noRollup = true;
    } else if (sample && !UNSYNCED.includes(column.key) && !sample.column_values.some((value) => value.id === id))
      lines.push(
        board.multiLevel
          ? `column ${id} (${title}) can't be set on items; on this multi-level board a rollup of child items is the likely cause, else a portfolio's column, so use a column of your own`
          : `column ${id} (${title}) can't be set on items (portfolio-managed?); use a column of your own, such as wf board setup --create makes with board.titles.${column.key}`,
      );
    if (column.key === "status") {
      if (found.title !== title) {
        lines.push(`column ${id} is titled "${found.title}"; wf board setup --create renames it "${title}"`);
        fix.title = title;
      }
      const absent = absentLabels(config, found);
      // A board set up before v0.35.0 marks "Done" as its done label; renamed in place, it keeps its id, so every item set to it stays set.
      const done = config.board.statuses.done;
      const old = (found.settings?.labels ?? []).find((label) => label.is_done && label.label !== done);
      const adding = absent.filter((label) => !(label === done && old));
      // Labels are resent whole, so a colour the API cannot name would change; those labels are then left to a person.
      const unnamed = unnamedColors(found.settings);
      const byHand = unnamed.length
        ? ` on the board by hand; monday's API cannot name the colours of ${unnamed.map((label) => `"${label.label}"`).join(", ")}, so setup does not resend this column's labels`
        : "";
      if (absent.includes(done) && old) {
        lines.push(`column ${id} (${title}) has label "${old.label}" marked done; ${byHand ? `rename it "${done}"${byHand}` : `wf board setup --create renames it "${done}"`}`);
        if (!byHand) fix.renames[old.id] = done;
      }
      for (const label of adding) lines.push(`column ${id} (${title}) has no label "${label}"; ${byHand ? `add it${byHand}` : "wf board setup --create adds it"}`);
      if (!unnamed.length) fix.labels = adding;
    }
    if (fix.noRollup || fix.title || fix.labels.length || Object.keys(fix.renames).length) statusFixes.push(fix);
  }
  // The views are found by name, since monday's API reads no view's kind or grouping.
  for (const key of VIEWS) {
    const name = config.board.titles[key];
    if (!board.views.some((view) => view.name === name)) {
      lines.push(`view "${name}" is missing; wf board setup --create makes it, a table grouped by ${name}`);
      views.push({ name, columnId: config.board.columns[key] });
    }
  }
  return { lines, missing, statusFixes, views };
}

/** The pinned comment on an item: the newest of the bot's top-level comments with the heading line, in the old shape or the new. */
const pinnedOf = (item, meId) => item.updates.find((update) => isPinned(update, meId));

/**
 * What sync would do, without doing it: { changes, problems }. A change is
 * { kind: create | update | comment | retire, id, ... }, and a problem stops
 * sync from writing anything.
 */
export function plan(config, want, board, meId) {
  const changes = [];
  const unsynced = UNSYNCED.map((key) => `column ${config.board.columns[key]} `);
  const problems = setupProblems(config, board).lines.filter((line) => !line.startsWith("view ") && !unsynced.some((start) => line.startsWith(start)));
  const col = config.board.columns;
  const byId = new Map();
  for (const item of board.items) {
    const id = item.column_values.find((value) => value.id === col.storyId)?.text?.trim();
    if (!id) continue;
    if (byId.has(id)) problems.push(`two items hold Story ID ${id}: ${byId.get(id).id} and ${item.id}; remove one on the board`);
    else byId.set(id, item);
  }
  const live = want.filter((story) => !story.removed);
  for (const story of live) {
    if (story.values.story.length > LONG_TEXT_LIMIT) problems.push(`${story.id}: the "As a…" sentence has ${story.values.story.length} characters, over monday's ${LONG_TEXT_LIMIT}`);
    if (!story.values.story) problems.push(`${story.id}: no "As a…" sentence under its heading`);
  }
  for (const story of live) {
    const item = byId.get(story.id);
    if (!item) {
      changes.push({ kind: "create", id: story.id, name: story.name, group: story.group, values: story.values, pr: story.pr, comment: story.comment });
      continue;
    }
    const text = (key) => item.column_values.find((value) => value.id === col[key])?.text ?? "";
    const diffs = [];
    const values = {};
    if (item.name !== story.name) diffs.push(["Name", item.name, story.name]);
    for (const key of SYNCED) {
      // A column monday does not return on items, such as a portfolio's own status, is a setup problem that stops sync; it is never compared.
      if (!item.column_values.some((value) => value.id === col[key])) continue;
      if (text(key) !== story.values[key]) {
        diffs.push([config.board.titles[key] ?? LABELS[key], text(key), story.values[key]]);
        values[col[key]] = written(key, story.values[key]);
      }
    }
    if (story.pr && text("pr") !== `${story.pr.text} - ${story.pr.url}`) {
      diffs.push(["PR", text("pr").split(" - ")[0], story.pr.text]);
      values[col.pr] = story.pr;
    }
    if (item.group?.title !== story.group) diffs.push(["Group", item.group?.title ?? "", story.group]);
    if (diffs.length) changes.push({ kind: "update", id: story.id, itemId: item.id, name: item.name !== story.name ? story.name : null, values, group: item.group?.title !== story.group ? story.group : null, diffs });
    const pinned = pinnedOf(item, meId);
    if (!pinned) changes.push({ kind: "comment", id: story.id, itemId: item.id, updateId: null, comment: story.comment, what: "add acceptance" });
    else {
      const stale = flat(pinned.text_body) !== flat(story.comment) || (pinned.body && tags(pinned.body) !== tags(story.comment));
      // A run cut short can leave the comment posted but not pinned; monday lists where it is pinned, and an empty list is none.
      const unpinned = Array.isArray(pinned.pinned_to_top) && !pinned.pinned_to_top.some((pin) => String(pin.item_id) === String(item.id));
      if (stale || unpinned)
        changes.push({ kind: "comment", id: story.id, itemId: item.id, updateId: pinned.id, comment: story.comment, edit: Boolean(stale), pin: unpinned, what: [stale && "edit", unpinned && "pin"].filter(Boolean).join(" and ") + " acceptance" });
    }
  }
  const liveIds = new Set(live.map((story) => story.id));
  for (const [id, item] of byId) {
    if (!liveIds.has(id) && item.group?.title !== config.board.retiredGroup) changes.push({ kind: "retire", id, itemId: item.id, group: config.board.retiredGroup });
  }
  return { changes, problems, unchanged: live.length - new Set(changes.filter((change) => change.kind !== "retire").map((change) => change.id)).size };
}

/** The plan as lines, then a one-line count. */
export function planLines({ changes, problems, unchanged }) {
  const out = [];
  for (const change of changes) {
    if (change.kind === "create") out.push(`create  ${change.name}  [${change.group}]`);
    if (change.kind === "update") out.push(`update  ${change.id}  ${change.diffs.map(([field, from, to]) => `${field}: ${difference(from, to)}`).join("; ")}`);
    if (change.kind === "comment") out.push(`comment ${change.id}  ${change.what}`);
    if (change.kind === "retire") out.push(`retire  ${change.id}  → ${change.group}`);
  }
  for (const problem of problems) out.push(`board   ${problem}`);
  const count = (kind) => changes.filter((change) => change.kind === kind).length;
  out.push(`${count("create")} to create, ${count("update")} to update, ${count("comment")} comment${count("comment") === 1 ? "" : "s"}, ${count("retire")} to retire, ${unchanged} unchanged.${problems.length ? ` ${problems.length} problem${problems.length === 1 ? "" : "s"}: sync writes nothing until each is fixed.` : ""}`);
  return out;
}

/** "from → to", each cut to the part around where they first differ, so two long texts that share a start still show their change. */
export function difference(from, to, width = 60) {
  const [a, b] = [from, to].map((text) => String(text ?? "").replace(/\s+/g, " "));
  if (!a || !b || (a.length <= width && b.length <= width)) return `${a || "(empty)"} → ${b || "(empty)"}`;
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same += 1;
  const start = Math.max(0, same - 20);
  const cut = (text) => `${start ? "…" : ""}${text.slice(start, start + width)}${text.length > start + width ? "…" : ""}`;
  return `${cut(a)} → ${cut(b)}`;
}

/** Write a plan to the board: groups first, then each change in order. */
export async function apply(client, config, board, { changes }, log) {
  const groups = new Map(board.groups.map((group) => [group.title, group.id]));
  const groupId = async (title) => {
    if (!groups.has(title)) {
      groups.set(title, await createGroup(client, config.board.boardId, title));
      log(`group   ${title} created`);
    }
    return groups.get(title);
  };
  for (const change of changes) {
    if (change.kind === "create") {
      const values = Object.fromEntries(SYNCED.map((key) => [config.board.columns[key], written(key, change.values[key])]));
      if (change.pr) values[config.board.columns.pr] = change.pr;
      const group = await groupId(change.group);
      // Each call on a group, item, or comment made a moment ago retries while monday's reads catch up.
      const made = await retryNotFound(client, () => createItem(client, config.board.boardId, group, change.name, values));
      // A value monday dropped on create, such as Atlas NX's status on 2026-11-11, is sent again at once.
      const sent = (value) => (value && typeof value === "object" ? Boolean(value.label || value.text || value.url) : Boolean(value));
      const dropped = Object.fromEntries(Object.entries(values).filter(([id, value]) => sent(value) && id in made.texts && !made.texts[id]));
      if (Object.keys(dropped).length) {
        await retryNotFound(client, () => changeValues(client, config.board.boardId, made.id, dropped));
        log(`set ${Object.keys(dropped).join(", ")} on ${change.id} again, which create left empty`);
      }
      const updateId = await retryNotFound(client, () => createUpdate(client, made.id, change.comment));
      await retryNotFound(client, () => pinUpdate(client, updateId, made.id));
      log(`created ${change.name}`);
    } else if (change.kind === "update") {
      const values = { ...change.values, ...(change.name ? { name: change.name } : {}) };
      if (Object.keys(values).length) await changeValues(client, config.board.boardId, change.itemId, values);
      if (change.group) await moveToGroup(client, change.itemId, await groupId(change.group));
      log(`updated ${change.id}`);
    } else if (change.kind === "comment") {
      if (!change.updateId) {
        const updateId = await createUpdate(client, change.itemId, change.comment);
        await retryNotFound(client, () => pinUpdate(client, updateId, change.itemId));
      } else {
        if (change.edit !== false) await editUpdate(client, change.updateId, change.comment);
        if (change.pin) await retryNotFound(client, () => pinUpdate(client, change.updateId, change.itemId));
      }
      log(`comment ${change.id} ${!change.updateId ? "added and pinned" : [change.edit !== false && "edited", change.pin && "pinned"].filter(Boolean).join(" and ")}`);
    } else if (change.kind === "retire") {
      await moveToGroup(client, change.itemId, await groupId(change.group));
      log(`retired ${change.id}`);
    }
  }
}

/** `wf board <setup [--create] | plan | sync>`; resolves to the exit code. */
export async function runBoard(context, [sub, ...args], { env = process.env, fetch = globalThis.fetch, log = console.log, git = runGit(context.root), sleep } = {}) {
  const { config } = context;
  const fits = {
    setup: args.every((arg) => arg === "--create"),
    plan: !args.length,
    sync: !args.length,
    feedback: args.every((arg) => arg === "--json"),
    reply: args.length >= 2,
  };
  if (!fits[sub]) {
    log('Usage: wf board <setup [--create] | plan | sync | feedback [--json] | reply <comment id> <Q-ID ...|--noted> [-- <comment id> <Q-ID ...|--noted> ...]>');
    return 2;
  }
  if (!config.board.boardId) {
    log("wf board: board.boardId is not set in .workflow/config.json; see docs/design/board-sync.md in the kit");
    return 1;
  }
  const wrong = boardProblems(config);
  if (wrong.length) {
    for (const problem of wrong) log(`wf board: .workflow/config.json: ${problem}`);
    return 1;
  }
  const token = env[config.board.tokenEnv];
  if (!token) {
    log(`wf board: set ${config.board.tokenEnv} to a monday API token; it is read only from the environment`);
    return 1;
  }
  const client = mondayClient({ token, apiVersion: config.board.apiVersion, fetch, ...(sleep ? { sleep } : {}) });
  // The Owner column is the team's, so its values are never even read.
  // The Owner and Client review columns are the team's and the client's, so their values are never even read.
  const columnIds = Object.entries(config.board.columns).filter(([key]) => !UNSYNCED.includes(key)).map(([, id]) => id);
  const board = await readBoard(client, config.board.boardId, columnIds);
  if (sub === "feedback" || sub === "reply") {
    const me = await whoAmI(client);
    const found = feedback(config, board, me.id);
    if (sub === "feedback") {
      if (args.includes("--json")) log(JSON.stringify(found, null, 2));
      else for (const line of feedbackLines(found)) log(line);
      return 0;
    }
    const present = new Set(context.tracked);
    const openIds = new Set(present.has(config.logs.openQuestions) ? questionRows(context.files(config.logs.openQuestions)).map((row) => row.id) : []);
    // Every reply is checked before the first is posted, so a bad one posts none.
    const replies = replyBatch(config, found, replyGroups(args), openIds);
    for (const reply of replies) {
      await replyTo(client, reply.itemId, reply.threadId, reply.body);
      log(`replied on ${reply.entry.story} to ${reply.entry.author || "the client"}: ${reply.body}`);
    }
    return 0;
  }
  if (sub === "setup") {
    const { lines, missing, statusFixes } = setupProblems(config, board);
    if (args.includes("--create")) {
      const reread = () => readBoard(client, config.board.boardId, columnIds);
      for (const column of missing) {
        await createColumn(client, config.board.boardId, { id: column.id, title: column.title, type: column.type, defaults: column.type === "status" ? startingLabels(config, column.key) : undefined });
        log(`created column ${column.id} (${column.title}, ${column.type})`);
      }
      // Each status column's title, labels, and rollup in one change, since each change moves its revision on.
      const fixes = missing.length ? setupProblems(config, await reread()).statusFixes : statusFixes;
      for (const { column, labels, renames, noRollup, title } of fixes) {
        const relabel = labels.length || Object.keys(renames).length;
        // A title has a call of its own, which leaves the labels as they are.
        if (title) {
          await changeColumnTitle(client, config.board.boardId, column.id, title);
          log(`renamed column ${column.id} "${column.title}" to "${title}"`);
        }
        if (relabel || noRollup) {
          const current = title ? (await reread()).columns.find((each) => each.id === column.id) : column;
          await updateStatusColumn(client, config.board.boardId, column.id, current.revision, { labels: relabel ? withLabels(current.settings, labels, renames) : undefined, noRollup });
        }
        for (const [labelId, name] of Object.entries(renames)) log(`renamed label ${labelId} of column ${column.id} "${column.settings.labels.find((label) => String(label.id) === labelId).label}" to "${name}", keeping its id`);
        if (labels.length) log(`added ${labels.map((label) => `"${label}"`).join(", ")} to column ${column.id}`);
        if (noRollup) log(`turned off column ${column.id}'s rollup of child items`);
      }
      const { views: wanting } = setupProblems(config, await reread());
      for (const view of wanting) {
        await createGroupedView(client, config.board.boardId, view.name, view.columnId);
        log(`created view "${view.name}", a table grouped by ${view.name}`);
        log(`  for cards, add a Kanban view grouped by ${view.name} on the board by hand; monday's API cannot make one`);
      }
      const after = setupProblems(config, await reread()).lines;
      for (const line of after) log(line);
      log(after.length ? `${after.length} left to do on the board by hand.` : "The board is set up.");
      return after.length ? 1 : 0;
    }
    for (const line of lines) log(line);
    log(lines.length ? `${lines.length} to fix; wf board setup --create makes the missing columns.` : "The board is set up.");
    return lines.length ? 1 : 0;
  }
  const me = await whoAmI(client);
  const result = plan(config, wanted(context, { git, env }), board, me.id);
  for (const line of planLines(result)) log(line);
  if (result.problems.length) return 1;
  if (sub === "sync") {
    await apply(client, config, board, result, log);
    log(result.changes.length ? `Synced ${result.changes.length} change${result.changes.length === 1 ? "" : "s"} to ${board.name}.` : `${board.name} is in step.`);
  }
  return 0;
}
