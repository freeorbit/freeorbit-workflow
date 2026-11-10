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
  return problems;
}
