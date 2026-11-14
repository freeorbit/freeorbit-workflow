// Lanes: one chunk split so a front-end and a back-end developer build at
// once, each in a worktree of their own. A lane is its own build-order row,
// such as `CH-01-fe`, with a Waits on cell naming the rows it starts after:
//
//   CH-01-contract       the API contract and its mock, reviewed and merged first
//   CH-01-fe, CH-01-be   the screens against the mock, and the service against the contract, in parallel
//   CH-01-integration    the screens wired to the service, the mock removed
//
// A lane starts only once every row it waits on is in the done list, which a
// row reaches when its pull request is merged. The contract's format is the
// project's: `lanes.contract` names its file and the commands that check it.

/** A chunk id as a build order writes it, such as CH-12, CH-01b, 37d, or a lane of one, CH-01-fe. */
export const CHUNK_ID = /^(?:[A-Z]+-)?[0-9]+[a-z]*(?:-[a-z]+)?$/;

/** A row's chunk id: the cell itself, such as "CH-01-fe", or "1-fe" from an older "1-fe. Sign-in screen". */
export function chunkId(cell) {
  return String(cell ?? "").split(". ")[0].trim();
}

/** A lane id's chunk and lane, such as { base: "CH-01", lane: "fe" }, or null for a whole chunk. */
export function laneOf(id) {
  const match = String(id).match(/^((?:[A-Z]+-)?\d+[a-z]*)-([a-z]+)$/);
  return match ? { base: match[1], lane: match[2] } : null;
}

/** The ids in a Waits on cell, such as "CH-01-contract, CH-01-fe". */
export function waitsOn(cell) {
  return String(cell ?? "")
    .split(/[,;]|\band\b/)
    .map((part) => part.trim().replace(/[.]+$/, ""))
    // An empty cell may say so in words or a dash.
    .filter((part) => part && !/^(none|n\/a|-|—|–)$/i.test(part));
}

/** What a lane must wait on, from the other lanes of its chunk that exist. */
export function expectedWaits(id, ids) {
  const lane = laneOf(id);
  if (!lane) return [];
  const sibling = (name) => `${lane.base}-${name}`;
  if (lane.lane === "fe" || lane.lane === "be") return ids.includes(sibling("contract")) ? [sibling("contract")] : [];
  if (lane.lane === "integration") return ["fe", "be"].map(sibling).filter((other) => ids.includes(other));
  return [];
}

/** doc:check's problems with the lanes: an unknown lane, a missing or unknown wait, and a lane started too soon. */
export function laneProblems(config, open, done, file) {
  const doneIds = done.map((row) => chunkId(row.chunk));
  const ids = [...open.map((row) => chunkId(row.chunk)), ...doneIds];
  // Every group but the last, Not started, means work has begun.
  const started = new Set(config.buildOrder.groups.slice(0, -1));
  const problems = [];
  for (const row of open) {
    const id = chunkId(row.chunk);
    const lane = laneOf(id);
    const waits = waitsOn(row.waitsOn);
    if (lane && !config.lanes.names.includes(lane.lane)) problems.push(`${file}: ${id} is lane ${lane.lane}, not one of ${config.lanes.names.join(", ")}`);
    for (const wait of waits) {
      if (wait === id) problems.push(`${file}: ${id} waits on itself`);
      else if (!ids.includes(wait)) problems.push(`${file}: ${id} waits on ${wait}, which no row has`);
    }
    for (const wait of expectedWaits(id, ids)) if (!waits.includes(wait)) problems.push(`${file}: ${id} must wait on ${wait}`);
    const unmet = waits.filter((wait) => !doneIds.includes(wait));
    if (started.has(row.status) && unmet.length) problems.push(`${file}: ${id} is ${row.status}, but ${unmet.join(" and ")} is not done`);
  }
  return problems;
}
