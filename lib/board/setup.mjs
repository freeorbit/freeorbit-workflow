// `wf board setup [--create]`: the board's columns, status labels, done
// labels, rollups, and grouped views against the config, and with --create,
// what is missing made and what differs fixed.

import { createColumn, readBoard, updateStatusColumn, withLabels, createGroupedView, changeColumnTitle, unnamedColors } from "./monday.mjs";

/**
 * Each column the board needs: its config key, its monday type, and whether
 * sync writes it. Its title is board.titles' alone (TB-5).
 */
export const COLUMNS = [
  { key: "storyId", type: "text", synced: true },
  { key: "area", type: "text", synced: true },
  { key: "status", type: "status", synced: true },
  { key: "chunk", type: "text", synced: true },
  { key: "story", type: "long_text", synced: true },
  { key: "pr", type: "link" },
  // Assigned by hand on the board: setup makes it, and sync never reads or writes it.
  { key: "owner", type: "people" },
  // The client's and the team's say on a story: setup makes it once with starter labels, and sync never reads or writes it.
  { key: "clientReview", type: "status" },
  // The story's frame pictures, while board.show.frames is on; sync owns it.
  { key: "frames", type: "file", shown: (config) => config.board.show.frames },
  // A Built story's built screens, while board.show.screenshots is on; sync owns it.
  { key: "screenshots", type: "file", shown: (config) => config.board.show.screenshots },
];
/** The file columns sync fills with pictures, each on its own board.show switch. */
export const PICTURE_SETS = ["frames", "screenshots"];
/** Columns setup makes but sync leaves alone, so one missing never stops a sync, and their values are never read. */
export const UNSYNCED = ["owner", "clientReview"];
/** The views setup makes, each a table grouped by a status column and named by its title. */
export const VIEWS = ["status", "clientReview"];
/** The columns sync compares and writes as text. */
export const SYNCED = COLUMNS.filter((column) => column.synced).map((column) => column.key);

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

/** The board's problems with its columns, labels, and grouped views, as lines; `missing` lists the columns to create. */
export function setupProblems(config, board) {
  const lines = [];
  const missing = [];
  const statusFixes = [];
  const views = [];
  // One synced item shows which columns monday keeps on items; a portfolio's own columns, such as a project template's status, it does not.
  const sample = (board.items ?? []).find((item) => item.column_values.some((value) => value.id === config.board.columns.storyId && value.text));
  for (const column of COLUMNS.filter((each) => !each.shown || each.shown(config))) {
    const id = config.board.columns[column.key];
    const title = config.board.titles[column.key];
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

/**
 * `wf board setup [--create]`: the board's problems against the config, and
 * with --create, the missing columns, the status columns' titles, labels,
 * done labels, and rollups fixed, and the grouped views made. Resolves to the
 * exit code.
 */
export async function setupBoard(client, config, board, columnIds, create, log) {
  const { lines, missing, statusFixes } = setupProblems(config, board);
  if (create) {
    const reread = () => readBoard(client, config.board.boardId, columnIds);
    // A status column made with its own labels starts with none marked done, so its done label is marked in the fixes below.
    const marking = new Map();
    for (const column of missing) {
      await createColumn(client, config.board.boardId, { id: column.id, title: column.title, type: column.type, defaults: column.type === "status" ? startingLabels(config, column.key) : undefined });
      log(`created column ${column.id} (${column.title}, ${column.type})`);
      if (column.type === "status") marking.set(column.id, column.key === "clientReview" ? config.board.reviewDone : config.board.statuses.done);
    }
    // Each status column's title, labels, done label, and rollup in one change, since each change moves its revision on.
    const read = missing.length ? await reread() : board;
    const fixes = missing.length ? setupProblems(config, read).statusFixes : statusFixes;
    for (const [id] of marking) if (!fixes.some((fix) => fix.column.id === id)) fixes.push({ column: read.columns.find((each) => each.id === id), labels: [], renames: {}, noRollup: false, title: null });
    for (const { column, labels, renames, noRollup, title } of fixes) {
      const done = marking.get(column.id);
      const relabel = labels.length || Object.keys(renames).length || done;
      // A title has a call of its own, which leaves the labels as they are.
      if (title) {
        await changeColumnTitle(client, config.board.boardId, column.id, title);
        log(`renamed column ${column.id} "${column.title}" to "${title}"`);
      }
      if (relabel || noRollup) {
        const current = title ? (await reread()).columns.find((each) => each.id === column.id) : column;
        await updateStatusColumn(client, config.board.boardId, column.id, current.revision, { labels: relabel ? withLabels(current.settings, labels, renames, { done }) : undefined, noRollup });
        if (done) log(`marked "${done}" done on column ${column.id}`);
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
