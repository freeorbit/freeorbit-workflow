// A story's status for the board, from the build order (docs/design/board-sync.md#status):
//
//   Drafting     the area's Stories step is not Done
//   Backlog      no chunk row, open or done, lists the story
//   Planned      every row that lists it is Not started
//   In progress  a row has started or finished, and another is In progress or Not started
//   Checking     every row is Waiting or done, and one is Waiting
//   Done         every row that lists it is in the done list
//
// Each lane is its own row, so a story in four lanes has four rows. Pure: the
// caller passes the texts.

import { areaRows, chunkRows, storyIds } from "../docs/shape.mjs";

export const STATUSES = ["drafting", "backlog", "planned", "inProgress", "checking", "done"];

/** The rows that list each story: Map of story ID to [{ chunk, state }], state one of done, In progress, Waiting, Not started. */
export function storyRows(config, orderText, doneText) {
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const out = new Map();
  const add = (row, state) => {
    for (const id of storyIds(row.stories, prefixes)) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ chunk: row.chunk.trim(), state });
    }
  };
  for (const row of chunkRows(orderText ?? "")) add(row, row.group);
  for (const row of chunkRows(doneText ?? "")) add(row, "done");
  return out;
}

/** Whether an area's Stories step is Done, from the Areas table. */
export function storiesDone(orderText, areaId) {
  const row = areaRows(orderText ?? "").find((each) => each.area === areaId);
  return Boolean(row && /^Done\b/.test(row.steps.Stories ?? ""));
}

/** The status key, one of STATUSES, for a story in an area, given the rows that list it. */
export function statusOf(storiesStepDone, rows = []) {
  if (!storiesStepDone) return "drafting";
  if (!rows.length) return "backlog";
  const states = rows.map((row) => row.state);
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "Not started")) return "planned";
  if (states.every((state) => state === "done" || state === "Waiting")) return "checking";
  return "inProgress";
}
