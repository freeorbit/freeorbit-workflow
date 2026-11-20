// Checks on the `board` config that the board commands, wf github, and doc:check share.

/**
 * The board config's problems: names that go into a workflow file and a shell
 * step must be plain, and the provider must be one the kit knows.
 */
export function boardProblems(config) {
  const board = config.board ?? {};
  const problems = [];
  if (board.provider !== "monday") problems.push(`board.provider "${board.provider}" is not one the kit knows; "monday" is`);
  if (!/^[A-Z_][A-Z0-9_]*$/.test(board.tokenEnv ?? "")) problems.push(`board.tokenEnv "${board.tokenEnv}" is not an environment variable name, such as MONDAY_API_TOKEN`);
  if (!/^[A-Za-z0-9_.-]+$/.test(board.environment ?? "")) problems.push(`board.environment "${board.environment}" is letters, digits, dots, dashes, and underscores only`);
  if (!/^[A-Za-z0-9_./-]+$/.test(board.branch ?? "") || /\.\.|^\/|\/$/.test(board.branch ?? "")) problems.push(`board.branch "${board.branch}" is not a plain branch name, such as main`);
  if (!/^[^\n<>]{1,40}$/.test(board.bot?.name ?? "")) problems.push(`board.bot.name "${board.bot?.name}" is 1 to 40 characters, with no line break or angle bracket`);
  if (!["all", "framed"].includes(board.screenshots?.rows)) problems.push(`board.screenshots.rows "${board.screenshots?.rows}" is "all" or "framed"`);
  return [...problems, ...workItemProblems(config)];
}

/** Whether any area's work items are on: a plan doc is listed for one. */
export const workItemsOn = (config) => Object.keys(config.board?.workItems?.plans ?? {}).length > 0;

/** Whether sync reads and writes Owner on work items: while they are on and board.workItems.people names anyone. Never on a story. */
export const ownerSynced = (config) => workItemsOn(config) && Object.keys(config.board?.workItems?.people ?? {}).length > 0;

/**
 * The work items config's problems: each plan is a listed area's, with a
 * prefix for its IDs, at a plain path inside the repo; the group title and the
 * people's ids are plain.
 */
export function workItemProblems(config) {
  const work = config.board?.workItems ?? {};
  const problems = [];
  for (const [areaId, path] of Object.entries(work.plans ?? {})) {
    const area = (config.areas ?? []).find((each) => each.id === areaId);
    if (!area) problems.push(`board.workItems.plans names area "${areaId}", which areas does not list`);
    else if (!area.prefix) problems.push(`board.workItems.plans names area "${areaId}", which has no prefix for its work IDs`);
    if (typeof path !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./ -]*\.md$/.test(path) || path.split("/").includes(".."))
      problems.push(`board.workItems.plans.${areaId} "${path}" is a .md path inside the repo, such as docs/areas/${areaId}/playbook.md`);
  }
  if (!/^[^\n<>]{1,100}$/.test(work.group ?? "")) problems.push(`board.workItems.group "${work.group}" is 1 to 100 characters, with no line break or angle bracket`);
  for (const [name, id] of Object.entries(work.people ?? {})) {
    if (!/^\d{1,15}$/.test(String(id))) problems.push(`board.workItems.people.${name} is "${id}", not a monday user id, such as 48202303`);
  }
  const labels = Object.values(config.board?.workStatuses ?? {});
  if (labels.some((label) => typeof label !== "string" || !label.trim()) || new Set(labels).size !== labels.length) problems.push("board.workStatuses are each a label of their own");
  return problems;
}
