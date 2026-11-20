// Work items on the board: the work of an area that is not a story, from its
// plan doc (docs/design/board-sync.md#work-items). A phase is an item; on a
// multi-level board its steps are its subitems, and on a flat one they sit
// beside it in a group of the phase's own.
//
// A work item is found by its Work ID column, never the Story ID one, so the
// story sync never reaches it, and this never touches an item with a Story
// ID. Only a Work ID of a listed area's shape counts, so text a guest types
// into the column moves nothing. A phase's lead goes in its pinned comment,
// which sync writes. Nothing is deleted: a phase or step no longer in its
// plan moves to the retired group.

import { escapeHtml } from "../html.mjs";
import { phaseStatus, readPlanDocs } from "../docs/plan.mjs";
import { workIdSource, escapeRe } from "../ids.mjs";
import { createItem, createSubitem, createUpdate, pinUpdate, retryNotFound } from "./monday.mjs";
import { columnText, difference, pinnedChange, resendDropped, writeChange } from "./items.mjs";
import { isPhaseLead, isPinned, MARK, PHASE_HEADING, phaseNote } from "./voice.mjs";
import { ownerSynced } from "./settings.mjs";
import { WORK_COLUMNS } from "./setup.mjs";
import { areaName } from "./wanted.mjs";

/** The columns a phase's item holds; a step's hold every work column. */
const PHASE_KEYS = ["workId", "workStatus"];
const STEP_KEYS = WORK_COLUMNS;

/** A phase's pinned comment: the bot's line to readers in a quote block, the heading, and the lead. */
export const leadHtml = (lead, botName = "Orbit") => `<blockquote><p>${MARK} ${escapeHtml(phaseNote(botName))}</p></blockquote><p><strong>${PHASE_HEADING}</strong></p><p>${escapeHtml(lead)}</p>`;

/** A work column's value as monday's column_values JSON wants it; an empty Owner is null, which clears it. */
function workValue(key, value) {
  if (key === "workStatus") return { label: value };
  if (key === "owner") return value ? { personsAndTeams: [{ id: Number(value), kind: "person" }] } : null;
  return value;
}

/** The monday user ids in a People column's value. */
const peopleIn = (value) => {
  try {
    return (JSON.parse(value || "{}").personsAndTeams ?? []).filter((each) => each.kind === "person").map((each) => String(each.id));
  } catch {
    return [];
  }
};

/**
 * What the board should hold for each listed plan: { phases, problems, notes }.
 * Each phase is { id, name, group, values, comment, steps }, and each step
 * { id, name, group, values, owner }. `owner` is the waited-on person's monday
 * id, "" for none, or undefined while Owner is not sync's.
 */
export function wantedWork(context, { multiLevel }) {
  const { config } = context;
  const work = config.board.workItems;
  const labels = config.board.workStatuses;
  const people = new Map(Object.entries(work.people ?? {}).map(([name, id]) => [name.toLowerCase(), String(id)]));
  const owned = ownerSynced(config);
  const phases = [];
  const notes = [];
  const { plans, problems } = readPlanDocs(context);
  for (const { areaId, read } of plans) {
    const group = work.group.replaceAll("{area}", areaName(areaId));
    for (const phase of read.phases) {
      const phaseGroup = multiLevel ? group : `${group} · ${phase.title}`;
      const steps = phase.steps.map((step) => {
        const owner = !owned ? undefined : step.waitsOn ? (people.get(step.waitsOn.toLowerCase()) ?? "") : "";
        if (owned && step.waitsOn && !owner) notes.push(`${step.id} waits on ${step.waitsOn}, whom board.workItems.people does not name, so Owner stays empty`);
        return { id: step.id, name: step.name, group: phaseGroup, values: { workId: step.id, workStatus: labels[step.key] ?? "", workWho: step.who, workNote: step.note, unblocks: step.unblocks.join(", ") }, owner };
      });
      const status = phaseStatus(phase.steps.map((step) => step.key));
      phases.push({ id: phase.id, name: phase.title, group: phaseGroup, values: { workId: phase.id, workStatus: labels[status] }, comment: leadHtml(phase.lead, config.board.bot.name), steps });
    }
  }
  return { phases, problems, notes };
}

/** The changes to one item's columns, name, and group, as { values, diffs }; a null `group` is not compared. */
function differences(config, item, want, keys, group) {
  const col = config.board.columns;
  const diffs = [];
  const values = {};
  if (item.name !== want.name) diffs.push(["Name", item.name, want.name]);
  for (const key of keys) {
    const now = columnText(item, col[key]);
    if (now === want.values[key]) continue;
    diffs.push([config.board.titles[key], now, want.values[key]]);
    values[col[key]] = workValue(key, want.values[key]);
  }
  if (want.owner !== undefined && peopleIn(item.column_values.find((value) => value.id === col.owner)?.value).join(",") !== want.owner) {
    diffs.push([config.board.titles.owner, columnText(item, col.owner), want.owner ? `user ${want.owner}` : ""]);
    values[col.owner] = workValue("owner", want.owner);
  }
  if (group !== null && item.group?.title !== group) diffs.push(["Group", item.group?.title ?? "", group]);
  return { values, diffs };
}

/** A new item's column values. */
const valuesOf = (config, want, keys) => {
  const values = Object.fromEntries(keys.map((key) => [config.board.columns[key], workValue(key, want.values[key])]));
  if (want.owner) values[config.board.columns.owner] = workValue("owner", want.owner);
  return values;
};

/**
 * The board's work items by Work ID: every item and subitem whose Work ID has
 * a listed area's shape, with no Story ID. Any other text in the column is
 * not a work item's, so it is never moved or written.
 */
function itemsByWorkId(config, board, problems) {
  const col = config.board.columns;
  const prefixes = Object.keys(config.board.workItems.plans).map((areaId) => config.areas.find((area) => area.id === areaId)?.prefix).filter(Boolean);
  const shape = new RegExp(`^${workIdSource(prefixes.map(escapeRe).join("|") || "(?!)")}$`);
  const byId = new Map();
  for (const item of [...board.items.map((each) => ({ ...each, parentId: null })), ...(board.subitems ?? [])]) {
    const id = columnText(item, col.workId);
    if (!shape.test(id)) continue;
    if (columnText(item, col.storyId)) problems.push(`item ${item.id} holds Story ID ${columnText(item, col.storyId)} and Work ID ${id}; clear one on the board`);
    else if (byId.has(id)) problems.push(`two items hold Work ID ${id}: ${byId.get(id).id} and ${item.id}; remove one on the board`);
    else byId.set(id, item);
  }
  return byId;
}

/** A phase item whose Work ID was cleared, by hand or a run cut short, found again as its steps' parent on a multi-level board; or undefined. */
function phaseByItsSteps(config, board, phase, byId) {
  const col = config.board.columns;
  const step = phase.steps.map((each) => byId.get(each.id)).find((item) => item?.parentId);
  const parent = step && board.items.find((item) => item.id === step.parentId && !columnText(item, col.workId) && !columnText(item, col.storyId));
  return parent ? { ...parent, parentId: null } : undefined;
}

/**
 * What the work sync would do: { changes, problems, unchanged }. A change is
 * { kind: work-create | work-update | work-comment | work-retire, id, ... }.
 * `board.subitems` holds a multi-level board's subitems, each with parentId.
 */
export function planWork(config, work, board, meId) {
  const retired = config.board.retiredGroup;
  const changes = [];
  const problems = [];
  const byId = itemsByWorkId(config, board, problems);
  const wanted = new Set();
  let unchanged = 0;
  for (const phase of work.phases) {
    wanted.add(phase.id);
    const item = byId.get(phase.id) ?? (board.multiLevel ? phaseByItsSteps(config, board, phase, byId) : undefined);
    if (item) byId.set(phase.id, item);
    if (!item) changes.push({ kind: "work-create", id: phase.id, name: phase.name, group: phase.group, values: valuesOf(config, phase, PHASE_KEYS), comment: phase.comment });
    else {
      const { values, diffs } = differences(config, item, phase, PHASE_KEYS, phase.group);
      if (diffs.length) changes.push({ kind: "work-update", id: phase.id, itemId: item.id, name: item.name !== phase.name ? phase.name : null, values, group: item.group?.title !== phase.group ? phase.group : null, diffs });
      const pinned = item.updates.find((update) => isPinned(update, meId) && isPhaseLead(update));
      const comment = pinnedChange(item, pinned, phase.comment, { kind: "work-comment", id: phase.id, what: "phase lead" });
      if (comment) changes.push(comment);
      if (!diffs.length && !comment) unchanged += 1;
    }
    for (const step of phase.steps) {
      wanted.add(step.id);
      const found = byId.get(step.id);
      if (!found) {
        changes.push({ kind: "work-create", id: step.id, name: step.name, group: step.group, values: valuesOf(config, step, STEP_KEYS), ...(board.multiLevel ? { parent: phase.id, parentItemId: item?.id ?? null } : {}) });
        continue;
      }
      // monday's API at 2026-10 cannot move a subitem under another parent, so a step that moved phases needs a new ID.
      // A retired step is top-level too: moving a subitem to another group detaches it (Atlas NX's board, 2026-11-20).
      if (board.multiLevel && found.parentId !== (item?.id ?? null)) {
        problems.push(`${step.id} is under ${found.parentId ? `item ${found.parentId}` : "no phase"} on the board, not ${phase.id}; monday cannot move a subitem to another phase, so give the step a new ID and the old one retires`);
        continue;
      }
      // A subitem keeps its phase's group.
      const group = board.multiLevel ? null : step.group;
      const { values, diffs } = differences(config, found, step, STEP_KEYS, group);
      if (diffs.length) changes.push({ kind: "work-update", id: step.id, itemId: found.id, name: found.name !== step.name ? step.name : null, values, group: group !== null && found.group?.title !== group ? group : null, diffs });
      else unchanged += 1;
    }
  }
  // Retired, never deleted: a phase first, and a step under a phase that retires moves with it.
  const retiring = new Set();
  for (const [id, item] of [...byId].sort(([, a], [, b]) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)))) {
    if (wanted.has(id) || item.group?.title === retired || (item.parentId && retiring.has(item.parentId))) continue;
    retiring.add(item.id);
    changes.push({ kind: "work-retire", id, itemId: item.id, group: retired });
  }
  return { changes, problems, unchanged };
}

/** The work changes as plan lines, each board value cut and made printable, and their count: { lines, count }. */
export function workLines(changes, unchanged) {
  const lines = [];
  for (const change of changes) {
    if (change.kind === "work-create") lines.push(`create  ${change.id} ${change.name}  [${change.parent ? `under ${change.parent}` : change.group}]`);
    if (change.kind === "work-update") lines.push(`update  ${change.id}  ${change.diffs.map(([field, from, to]) => `${field}: ${difference(from, to)}`).join("; ")}`);
    if (change.kind === "work-comment") lines.push(`comment ${change.id}  ${change.what}`);
    if (change.kind === "work-retire") lines.push(`retire  ${change.id}  → ${change.group}`);
  }
  const count = (kind) => changes.filter((change) => change.kind === kind).length;
  const comments = count("work-comment");
  return { lines, count: `Work items: ${count("work-create")} to create, ${count("work-update")} to update, ${comments} lead comment${comments === 1 ? "" : "s"}, ${count("work-retire")} to retire, ${unchanged} unchanged.` };
}

/** Write the work changes, in order: each phase before its steps, its lead posted and pinned when it is made. */
export async function applyWork(client, config, changes, log, groupId) {
  const made = new Map();
  for (const change of changes) {
    if (change.kind !== "work-create") {
      await writeChange(client, config, change, groupId, log);
      continue;
    }
    const parentItemId = change.parent ? (change.parentItemId ?? made.get(change.parent)) : null;
    // Each call on a group, item, or comment made a moment ago retries while monday's reads catch up.
    const item = parentItemId
      ? await retryNotFound(client, () => createSubitem(client, parentItemId, change.name, change.values))
      : await retryNotFound(client, async () => createItem(client, config.board.boardId, await groupId(change.group), change.name, change.values));
    made.set(change.id, item.id);
    await resendDropped(client, config, item, change.values, change.id, log);
    if (change.comment) {
      const updateId = await retryNotFound(client, () => createUpdate(client, item.id, change.comment));
      await retryNotFound(client, () => pinUpdate(client, updateId, item.id));
    }
    log(`created ${change.id} ${change.name}`);
  }
}
