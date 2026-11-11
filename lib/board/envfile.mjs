// The monday token for `wf board`: the environment first, then a .env at the
// repo root (docs/design/board-sync.md, "Token and where sync runs"). The
// .env is read only when git ignores it and does not track it, so a token is
// never read from a file that could be committed. Nothing is written to
// process.env, and the token is never logged.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const readDefault = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);

/**
 * { token } from `env`, else from <root>/.env; { problem } when the .env holds
 * the name but git tracks it or does not ignore it. `git` runs git in root
 * and returns its output, or "" when git fails.
 */
export function tokenFrom(root, name, { env, git, readEnvFile = readDefault }) {
  if (env[name]) return { token: env[name] };
  const text = readEnvFile(join(root, ".env"));
  if (text === null) return {};
  const value = parseEnv(text)[name];
  if (!value) return {};
  if (git(["ls-files", "--", ".env"]).trim()) return { problem: `.env is tracked by git, so ${name} is not read from it; untrack it and rotate the token` };
  if (!ignored(git)) return { problem: `.env is not in .gitignore, so ${name} is not read from it; add .env to .gitignore` };
  return { token: value };
}

// check-ignore -v prints the rule that decides the path, as
// <source>:<line>:<pattern><TAB><path>, and nothing when no rule does. A
// pattern starting with ! un-ignores it.
const ignored = (git) => {
  const line = git(["check-ignore", "-v", "--", ".env"]).trim();
  const pattern = line.split("\t")[0].split(":").slice(2).join(":");
  return Boolean(line) && !pattern.startsWith("!");
};
