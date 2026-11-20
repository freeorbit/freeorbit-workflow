// `wf board setup | plan | sync`: the project's stories, and the work items of
// any listed plan doc (work.mjs), shown on a monday.com board, one way (docs/design/board-sync.md). The repo is the source of truth:
//
//   setup [--create]  the board's columns, status labels, and grouped table views against the config
//   plan              each item sync would create, change, comment on, or retire
//   sync              the same, written: only what differs, never a delete
//   feedback [--json] the client's comments with no bot reply yet (feedback.mjs)
//   feedback --brief  the same, written to .cache/board/feedback.json for the
//                     blind feedback reader; prints only what is not their words
//   drafts <file>     the reader's drafts, checked against their shapes
//   reply <id> <Q-ID ...|--noted|--answered <Q-ID>> [-- <id> ...]   the bot's replies, in voice.mjs's words
//
// A story's item is found by its Story ID column, and a work item's by its
// Work ID column, so neither sync reaches the other's items. Its name is `<ID> · <title>`, its
// group `<Area> · <## heading>`, and its Story column the "As a…" sentence.
// The acceptance lines go in a pinned comment by the token's own user, whose
// text holds the "Acceptance criteria" heading; sync edits it when it differs.
// A story marked Removed, or an item whose Story ID no story file defines,
// moves to the retired group. The PR column links the pull request of the
// story's lane finished last, read from git history (prs.mjs). The Owner
// column is the team's on a story, assigned by hand: setup makes it, and sync
// never touches it there. On a work item it is sync's while
// board.workItems.people names anyone. Sync checks everything first and writes nothing while a problem
// stands. A sync that monday cuts short partway is finished by the next one:
// each change is found again by its Story ID, comment marker, or picture name.

import { escapeHtml } from "../html.mjs";
import { runGit } from "./prs.mjs";
import { createGroup, createItem, createUpdate, editUpdate, mondayClient, pinUpdate, readBoard, readSubitems, retryNotFound, whoAmI, uploadFile, clearFiles } from "./monday.mjs";
import { askedQuestion, deliveredChunks, deliveredMarker, deliveredNote, isBot, isPhaseLead, isPinned, isQuiet, questionNote, quieted } from "./voice.mjs";
import { briefSummary, checkDrafts, draftLines, feedback, feedbackBrief, feedbackLines, hasBotReply, replyBatch, replyGroups, UNTRUSTED } from "./feedback.mjs";
import { FEEDBACK_FILE } from "../../plugins/core/hooks/guard.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileNames, wantedFrames, wantedScreenshots } from "./frames.mjs";
import { replyTo } from "./monday.mjs";
import { questionRows } from "../logs/questions.mjs";
import { boardProblems, ownerSynced, workItemsOn } from "./settings.mjs";
import { phaseOf } from "../ids.mjs";
import { tokenFrom } from "./envfile.mjs";
import { PICTURE_SETS, UNSYNCED, SYNCED, WORK_COLUMNS, setupBoard, setupProblems } from "./setup.mjs";
import { applyWork, planWork, wantedWork, workLines } from "./work.mjs";
import { columnText, difference, pinnedChange, resendDropped, writeChange } from "./items.mjs";

export { difference };
import { clientQuestions, wanted } from "./wanted.mjs";

/** monday's long-text column keeps 2,000 characters and cuts the rest with no error (the 2026-11-10 trial). */
export const LONG_TEXT_LIMIT = 2000;


/** A column value as monday's column_values JSON wants it. */
function written(key, value) {
  if (key === "status") return { label: value };
  if (key === "story") return { text: value };
  return value;
}

/** The pinned acceptance comment on a story's item: the newest of the bot's top-level comments with its heading line, in the old shape or the new. */
const pinnedOf = (item, meId) => item.updates.find((update) => isPinned(update, meId) && !isPhaseLead(update));

/** The bot's own top-level comments on an item, the pinned one aside: what it has announced and asked. */
const saidOn = (item, meId) => (item?.updates ?? []).filter((update) => isBot(update, meId) && !isPinned(update, meId));

/** Each live story's item: created when missing, its fields and group updated, and its pinned acceptance comment added, edited, or pinned. */
function planItems(config, live, byId, meId, changes) {
  const col = config.board.columns;
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
        diffs.push([config.board.titles[key], text(key), story.values[key]]);
        values[col[key]] = written(key, story.values[key]);
      }
    }
    if (story.pr && text("pr") !== `${story.pr.text} - ${story.pr.url}`) {
      diffs.push(["PR", text("pr").split(" - ")[0], story.pr.text]);
      values[col.pr] = story.pr;
    }
    if (item.group?.title !== story.group) diffs.push(["Group", item.group?.title ?? "", story.group]);
    if (diffs.length) changes.push({ kind: "update", id: story.id, itemId: item.id, name: item.name !== story.name ? story.name : null, values, group: item.group?.title !== story.group ? story.group : null, diffs });
    const comment = pinnedChange(item, pinnedOf(item, meId), story.comment, { kind: "comment", id: story.id, what: "acceptance" });
    if (comment) changes.push(comment);
  }
}

/** Each story's frames and built screens: the names on the board, in order, against the wanted ones; any difference, and the set goes again. */
function planPictures(config, live, byId, sets, changes, notes) {
  const col = config.board.columns;
  for (const [set, wantedSet] of [["frames", sets.frames], ["screenshots", sets.screenshots]]) {
    if (!config.board.show[set] || !wantedSet) continue;
    notes.push(...wantedSet.notes);
    for (const story of live) {
      const item = byId.get(story.id);
      const current = fileNames(item?.column_values.find((value) => value.id === col[set])?.value);
      const uploads = wantedSet.byStory.get(story.id) ?? [];
      if (current.join("\n") !== uploads.map((each) => each.upload).join("\n")) changes.push({ kind: set, id: story.id, itemId: item?.id ?? null, clear: current.length > 0, uploads });
    }
  }
}

/** The delivery notes each story's done chunks have not announced yet, and old plain notes restyled in place. */
function planNotes(live, byId, meId, changes) {
  for (const story of live) {
    const item = byId.get(story.id);
    const announced = new Set(saidOn(item, meId).flatMap((update) => deliveredChunks(update.text_body)));
    // A note posted plain, before v0.36.1, is edited into the quiet layout in place, its words kept; never posted again.
    for (const update of saidOn(item, meId).filter((each) => deliveredChunks(each.text_body).length && each.body && !isQuiet(each.body)))
      changes.push({ kind: "restyle", id: story.id, itemId: item.id, updateId: update.id, chunks: deliveredChunks(update.text_body), body: update.body });
    const fresh = (story.delivery ?? []).filter((entry) => !announced.has(entry.chunk));
    const lines = [...new Set(fresh.flatMap((entry) => entry.lines))];
    // A chunk with no For the client sentence, such as one done before v0.36.0, announces nothing.
    if (lines.length) changes.push({ kind: "note", id: story.id, itemId: item?.id ?? null, chunks: fresh.filter((entry) => entry.lines.length).map((entry) => entry.chunk), lines });
  }
}

/** Each open client question, asked once on each live story it names. */
function planQuestions(questions, liveIds, byId, meId, changes, notes) {
  for (const question of questions) {
    if (!question.stories.length) {
      notes.push(`${question.id} asks the client but names no story, so it is not posted`);
      continue;
    }
    for (const storyId of question.stories) {
      if (!liveIds.has(storyId)) {
        notes.push(`${question.id} names ${storyId}, which no live story is, so it is not posted there`);
        continue;
      }
      const item = byId.get(storyId);
      if (!saidOn(item, meId).some((update) => askedQuestion(update.text_body) === question.id)) changes.push({ kind: "ask", id: storyId, itemId: item?.id ?? null, qid: question.id, question: question.question });
    }
  }
}

/**
 * What sync would do, without doing it: { changes, problems, notes,
 * unchanged, work }. A change is { kind: create | update | comment | retire |
 * frames | screenshots | restyle | note | ask, id, ... }, or a work item's
 * (work.mjs), and a problem stops sync from writing anything. `work` is the
 * listed plans' wanted work items, or null while none is listed.
 */
export function plan(config, want, board, meId, { questions = [], frames = null, screenshots = null, work = null } = {}) {
  const changes = [];
  // Owner is sync's on a work item while board.workItems.people names anyone, so then it must be there.
  const unsynced = UNSYNCED.filter((key) => !(key === "owner" && work && ownerSynced(config))).map((key) => `column ${config.board.columns[key]} `);
  const problems = setupProblems(config, board).lines.filter((line) => !line.startsWith("view ") && !unsynced.some((start) => line.startsWith(start)));
  const col = config.board.columns;
  const byId = new Map();
  for (const item of board.items) {
    const id = columnText(item, col.storyId);
    if (!id) continue;
    if (byId.has(id)) problems.push(`two items hold Story ID ${id}: ${byId.get(id).id} and ${item.id}; remove one on the board`);
    else byId.set(id, item);
  }
  const live = want.filter((story) => !story.removed);
  for (const story of live) {
    if (story.values.story.length > LONG_TEXT_LIMIT) problems.push(`${story.id}: the "As a…" sentence has ${story.values.story.length} characters, over monday's ${LONG_TEXT_LIMIT}`);
    if (!story.values.story) problems.push(`${story.id}: no "As a…" sentence under its heading`);
  }
  planItems(config, live, byId, meId, changes);
  const liveIds = new Set(live.map((story) => story.id));
  for (const [id, item] of byId) {
    if (!liveIds.has(id) && item.group?.title !== config.board.retiredGroup) changes.push({ kind: "retire", id, itemId: item.id, group: config.board.retiredGroup });
  }
  const notes = [];
  planPictures(config, live, byId, { frames, screenshots }, changes, notes);
  if (config.board.show.deliveryNotes) planNotes(live, byId, meId, changes);
  if (config.board.show.clientQuestions) planQuestions(questions, liveIds, byId, meId, changes, notes);
  const unchanged = live.length - new Set(changes.filter((change) => change.kind !== "retire").map((change) => change.id)).size;
  if (!work) return { changes, problems, notes, unchanged };
  const planned = planWork(config, work, board, meId);
  problems.push(...work.problems, ...planned.problems);
  notes.push(...work.notes);
  return { changes: [...changes, ...planned.changes], problems, notes, unchanged, work: { unchanged: planned.unchanged } };
}

/** The plan as lines, then a one-line count. */
export function planLines({ changes, problems, notes = [], unchanged, work = null }) {
  const out = [];
  for (const change of changes) {
    if (change.kind === "create") out.push(`create  ${change.name}  [${change.group}]`);
    if (change.kind === "update") out.push(`update  ${change.id}  ${change.diffs.map(([field, from, to]) => `${field}: ${difference(from, to)}`).join("; ")}`);
    if (change.kind === "comment") out.push(`comment ${change.id}  ${change.what}`);
    if (change.kind === "retire") out.push(`retire  ${change.id}  → ${change.group}`);
    if (change.kind === "note") out.push(`note    ${change.id} delivered ${deliveredMarker(change.chunks)}`);
    if (PICTURE_SETS.includes(change.kind)) out.push(`${change.kind.padEnd(7)} ${change.id} ${change.uploads.length ? `${change.uploads.length} to upload (${change.uploads.map((each) => each.frame).join(", ")})` : "clear"}`);
    if (change.kind === "restyle") out.push(`note    ${change.id} restyle delivered ${deliveredMarker(change.chunks)}`);
    if (change.kind === "ask") out.push(`ask     ${change.id} ${change.qid}`);
  }
  const workPlan = work ? workLines(changes.filter((change) => change.kind.startsWith("work-")), work.unchanged) : null;
  out.push(...(workPlan?.lines ?? []));
  for (const note of notes) out.push(`skip    ${note}`);
  for (const problem of problems) out.push(`board   ${problem}`);
  const count = (kind) => changes.filter((change) => change.kind === kind).length;
  const said = [count("note") && `${count("note")} delivery note${count("note") === 1 ? "" : "s"}`, count("ask") && `${count("ask")} question${count("ask") === 1 ? "" : "s"}`, count("restyle") && `${count("restyle")} to restyle`, count("frames") && `${count("frames")} frame set${count("frames") === 1 ? "" : "s"}`, count("screenshots") && `${count("screenshots")} screenshot set${count("screenshots") === 1 ? "" : "s"}`].filter(Boolean);
  out.push(`${count("create")} to create, ${count("update")} to update, ${count("comment")} comment${count("comment") === 1 ? "" : "s"}, ${count("retire")} to retire, ${said.length ? `${said.join(", ")}, ` : ""}${unchanged} unchanged.${problems.length ? ` ${problems.length} problem${problems.length === 1 ? "" : "s"}: sync writes nothing until each is fixed.` : ""}`);
  if (workPlan) out.push(workPlan.count);
  return out;
}

/** Write a plan to the board: groups first, then each change in order. */
export async function apply(client, config, board, { changes }, log, meId) {
  const groups = new Map(board.groups.map((group) => [group.title, group.id]));
  const groupId = async (title) => {
    if (!groups.has(title)) {
      groups.set(title, await createGroup(client, config.board.boardId, title));
      log(`group   ${title} created`);
    }
    return groups.get(title);
  };
  const madeIds = new Map();
  for (const change of changes) {
    if (change.kind === "create") {
      const values = Object.fromEntries(SYNCED.map((key) => [config.board.columns[key], written(key, change.values[key])]));
      if (change.pr) values[config.board.columns.pr] = change.pr;
      const group = await groupId(change.group);
      // Each call on a group, item, or comment made a moment ago retries while monday's reads catch up.
      const item = await retryNotFound(client, () => createItem(client, config.board.boardId, group, change.name, values));
      await resendDropped(client, config, item, values, change.id, log);
      const updateId = await retryNotFound(client, () => createUpdate(client, item.id, change.comment));
      await retryNotFound(client, () => pinUpdate(client, updateId, item.id));
      madeIds.set(change.id, item.id);
      log(`created ${change.name}`);
    } else if (["update", "comment", "retire"].includes(change.kind)) await writeChange(client, config, change, groupId, log);
  }
  await applyWork(client, config, changes.filter((change) => change.kind.startsWith("work-")), log, groupId);
  // The bot's notes and questions, top-level comments, each full on its first word on an item and short after.
  const spoke = new Set();
  const name = config.board.bot.name;
  // Frames and built screens, after each item's own changes: the column cleared, then the wanted set uploaded in order.
  for (const change of changes.filter((each) => PICTURE_SETS.includes(each.kind))) {
    const itemId = change.itemId ?? madeIds.get(change.id);
    const columnId = config.board.columns[change.kind];
    if (change.clear) await retryNotFound(client, () => clearFiles(client, config.board.boardId, itemId, columnId));
    for (const each of change.uploads) await retryNotFound(client, () => uploadFile(client, itemId, columnId, { name: each.upload, bytes: each.bytes }));
    log(`${change.kind.padEnd(7)} ${change.id} ${change.uploads.length ? `${change.uploads.length} uploaded` : "cleared"}`);
  }
  for (const change of changes.filter((each) => each.kind === "restyle")) {
    await editUpdate(client, change.updateId, quieted(change.body));
    log(`restyled ${change.id} delivered ${deliveredMarker(change.chunks)}`);
  }
  for (const change of changes.filter((each) => each.kind === "note" || each.kind === "ask")) {
    const itemId = change.itemId ?? madeIds.get(change.id);
    const short = spoke.has(itemId) || hasBotReply(board.items.find((item) => item.id === itemId) ?? { updates: [] }, meId);
    const body = change.kind === "note" ? deliveredNote(name, change.lines.map(escapeHtml), change.chunks, { short }) : questionNote(name, change.qid, escapeHtml(change.question), { short });
    await retryNotFound(client, () => createUpdate(client, itemId, body));
    spoke.add(itemId);
    log(change.kind === "note" ? `noted   ${change.id} delivered ${deliveredMarker(change.chunks)}` : `asked   ${change.id} ${change.qid}`);
  }
}

const writeText = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/**
 * `wf board drafts <file>`: the feedback reader's drafts, checked against the
 * brief `feedback --brief` wrote (SB-3). Prints each checked draft as a line
 * for the person, or every problem; resolves to the exit code.
 */
export function checkDraftFile(context, file, { log = console.log, readText = (path) => readFileSync(path, "utf8") } = {}) {
  const read = (path, what) => {
    try {
      return JSON.parse(readText(resolve(context.root, path)));
    } catch (error) {
      log(`wf board drafts: cannot read ${what} ${path}: ${error.message}`);
      return undefined;
    }
  };
  const brief = read(FEEDBACK_FILE, "the brief");
  if (brief === undefined) return 1;
  const drafts = read(file, "the drafts");
  if (drafts === undefined) return 1;
  const checked = checkDrafts(brief, drafts);
  if (checked.problems.length) {
    for (const problem of checked.problems) log(`problem: ${problem}`);
    log(`${checked.problems.length} problem${checked.problems.length === 1 ? "" : "s"}; nothing is logged or posted. Ask the reader again, or draft those comments by hand from the board.`);
    return 1;
  }
  for (const line of draftLines(checked.drafts)) log(line);
  return 0;
}

/** `wf board feedback [--json | --brief]` lists the client's new comments; `wf board reply ...` posts the bot's replies, all checked before the first. */
async function answerFeedback(client, context, board, sub, args, log, writeFile) {
  const { config } = context;
  const me = await whoAmI(client);
  const found = feedback(config, board, me.id);
  if (sub === "feedback") {
    if (args.includes("--brief")) {
      // The comments go to the blind reader's one file, and only what is not their words is printed (SB-3).
      const brief = feedbackBrief(config, board, found);
      writeFile(join(context.root, FEEDBACK_FILE), `${JSON.stringify(brief, null, 2)}\n`);
      log(JSON.stringify(briefSummary(brief, FEEDBACK_FILE), null, 2));
    } else if (args.includes("--json")) log(JSON.stringify({ note: UNTRUSTED, ...found }, null, 2));
    else for (const line of feedbackLines(found)) log(line);
    return 0;
  }
  const present = new Set(context.tracked);
  const openIds = new Set(present.has(config.logs.openQuestions) ? questionRows(context.files(config.logs.openQuestions)).map((row) => row.id) : []);
  // Every reply is checked before the first is posted, so a bad one posts none.
  const replies = replyBatch(config, found, replyGroups(args), openIds);
  for (const reply of replies) {
    await replyTo(client, reply.itemId, reply.threadId, reply.body);
    log(`replied on ${reply.entry.story} to ${reply.entry.author || "the client"}: ${reply.body.replace(/<[^>]+>/g, "")}`);
  }
  return 0;
}

/** `wf board <setup [--create] | plan | sync | feedback [--json | --brief] | drafts <file> | reply ...>`; resolves to the exit code. */
export async function runBoard(context, [sub, ...args], { env = process.env, fetch = globalThis.fetch, log = console.log, git = runGit(context.root), sleep, readBytes, readEnvFile, writeFile = writeText, readText } = {}) {
  const { config } = context;
  // The drafts are checked on this machine, against the brief, with no call to monday.
  if (sub === "drafts" && args.length === 1) return checkDraftFile(context, args[0], { log, ...(readText ? { readText } : {}) });
  const fits = {
    setup: args.every((arg) => arg === "--create"),
    plan: !args.length,
    sync: !args.length,
    feedback: args.length <= 1 && args.every((arg) => arg === "--json" || arg === "--brief"),
    reply: args.length >= 2,
  };
  if (!fits[sub]) {
    log('Usage: wf board <setup [--create] | plan | sync | feedback [--json | --brief] | drafts <file> | reply <comment id> <Q-ID ...|--noted|--answered <Q-ID>> [-- <comment id> ... ...]>');
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
  const { token, problem } = tokenFrom(context.root, config.board.tokenEnv, { env, git, ...(readEnvFile ? { readEnvFile } : {}) });
  if (problem) {
    log(`wf board: ${problem}`);
    return 1;
  }
  if (!token) {
    log(`wf board: set ${config.board.tokenEnv} to a monday API token, in the environment or in the repo's gitignored .env`);
    return 1;
  }
  const client = mondayClient({ token, apiVersion: config.board.apiVersion, fetch, ...(sleep ? { sleep } : {}) });
  // The Owner and Client review columns are the team's and the client's, so their values are never even read,
  // but for Owner while it is sync's on work items. A work item's columns are read only while a plan is listed.
  const work = workItemsOn(config);
  const columnIds = Object.entries(config.board.columns)
    .filter(([key]) => (!UNSYNCED.includes(key) || (key === "owner" && ownerSynced(config))) && (!PICTURE_SETS.includes(key) || config.board.show[key]) && (!WORK_COLUMNS.includes(key) || work))
    .map(([, id]) => id);
  const board = await readBoard(client, config.board.boardId, columnIds);
  // A multi-level board's steps are subitems, which items_page leaves out. Only an item with no Story ID, and no Work ID or a phase's, can be a phase:
  // a retired step is top-level, and never read for subitems.
  if (work && board.multiLevel && sub !== "setup") {
    const col = config.board.columns;
    const parents = board.items.filter((item) => !columnText(item, col.storyId) && (!columnText(item, col.workId) || phaseOf(columnText(item, col.workId))));
    board.subitems = parents.length ? await readSubitems(client, parents.map((item) => item.id), columnIds) : [];
  }
  if (sub === "feedback" || sub === "reply") return answerFeedback(client, context, board, sub, args, log, writeFile);
  if (sub === "setup") return setupBoard(client, config, board, columnIds, args.includes("--create"), log);
  const me = await whoAmI(client);
  const want = wanted(context, { git, env });
  // A story's built screens wait for Built, so a story still being built shows none.
  const built = new Set(want.filter((story) => !story.removed && story.values.status === config.board.statuses.done).map((story) => story.id));
  const result = plan(config, want, board, me.id, {
    questions: clientQuestions(context),
    frames: config.board.show.frames ? wantedFrames(context, { readBytes }) : null,
    screenshots: config.board.show.screenshots ? wantedScreenshots(context, { built, readBytes }) : null,
    work: work ? wantedWork(context, { multiLevel: board.multiLevel }) : null,
  });
  for (const line of planLines(result)) log(line);
  if (result.problems.length) return 1;
  if (sub === "sync") {
    try {
      await apply(client, config, board, result, log, me.id);
    } catch (error) {
      throw new Error(`${error.message}. The changes before it are written; run npx --no wf board sync again to finish (TB-12)`);
    }
    log(result.changes.length ? `Synced ${result.changes.length} change${result.changes.length === 1 ? "" : "s"} to ${board.name}.` : `${board.name} is in step.`);
  }
  return 0;
}
