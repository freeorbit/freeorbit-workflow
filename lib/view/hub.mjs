// One question-pictures server for the whole machine, so several sessions,
// projects, and worktrees can ask at once. Each project keeps its own pages
// and answers under its own .cache/view; the server finds them through a
// registry in the user's state folder, and serves each at /<key>/, where the
// key names the project's folder. `wf ask page` and `wf view serve` start the
// server when none answers, detached, so it outlives the session that
// started it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { KIT_ROOT } from "../setup/ai.mjs";
import { VIEW_DIR, VIEW_PORT, projectKey } from "./view.mjs";
import { HUB_NAME, writeWhole } from "./serve.mjs";

/** Where the registry and the server's log live: $WF_STATE_DIR, else $XDG_STATE_HOME/freeorbit-workflow, else ~/.local/state/freeorbit-workflow. */
export function stateDir(env = process.env) {
  if (env.WF_STATE_DIR) return env.WF_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "freeorbit-workflow");
}
const registryFile = (env) => join(stateDir(env), "view-projects.json");

/** The registered projects, by key, keeping only roots that are still a project. */
export function projects(env = process.env) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(registryFile(env), "utf8"));
  } catch {
    return {};
  }
  const out = {};
  for (const [key, entry] of Object.entries(raw ?? {})) {
    const root = entry?.root;
    if (typeof root !== "string" || !existsSync(join(root, ".workflow", "config.json"))) continue;
    if (projectKey(root) !== key) continue;
    out[key] = { key, root, view: join(root, VIEW_DIR), name: String(entry.name ?? basename(root)) };
  }
  return out;
}

/** Add a project to the registry; returns its key. */
export function register(root, env = process.env) {
  const real = realpathSync(root);
  const key = projectKey(real);
  const now = projects(env);
  if (now[key]?.root === real) return key;
  mkdirSync(stateDir(env), { recursive: true, mode: 0o700 });
  const raw = Object.fromEntries(Object.values(now).map((each) => [each.key, { root: each.root, name: each.name }]));
  raw[key] = { root: real, name: basename(real) };
  writeWhole(registryFile(env), `${JSON.stringify(raw, null, 2)}\n`);
  return key;
}

const git = (root, args) => {
  const out = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "";
};

/** Who asks: the repository, the branch, the worktree when it is one, and the agent session when the tool names it. */
export function asker(root, env = process.env) {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const own = git(root, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const repo = common ? basename(dirname(common)) : basename(root);
  return {
    project: repo,
    branch: git(root, ["symbolic-ref", "--short", "-q", "HEAD"]) || git(root, ["rev-parse", "--short", "HEAD"]),
    worktree: common && own && resolve(common) !== resolve(own) ? basename(root) : "",
    session: env.CLAUDE_CODE_HOST_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || env.WF_ASK_SESSION || "",
  };
}

/** Whether our server answers on the port: resolves with its /__hub record, or null. */
export async function hubUp(port = VIEW_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__hub`, { signal: AbortSignal.timeout(800) });
    const body = await res.json();
    return body?.hub === HUB_NAME ? body : null;
  } catch {
    return null;
  }
}

/**
 * Start the server, detached, unless ours already answers on the port.
 * Resolves with its /__hub record. Throws when something else holds the port.
 */
export async function ensureHub({ port = VIEW_PORT, env = process.env } = {}) {
  const up = await hubUp(port);
  if (up) return up;
  mkdirSync(stateDir(env), { recursive: true, mode: 0o700 });
  const logFd = openSync(join(stateDir(env), "view-server.log"), "a", 0o600);
  const child = spawn(process.execPath, [join(KIT_ROOT, "bin", "wf.mjs"), "view", "serve", "--hub", "--port", String(port)], { detached: true, stdio: ["ignore", logFd, logFd], env, cwd: stateDir(env) });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((done) => setTimeout(done, 100));
    const now = await hubUp(port);
    if (now) return now;
  }
  throw new Error(`the question-pictures server did not start on port ${port}; is another program using it? See ${join(stateDir(env), "view-server.log")}`);
}

/**
 * What every command that shows a page does: register the project, then make
 * sure the shared server runs. WF_ASK_NO_SERVER=1, for tests and CI, starts
 * none, unless `force`, which `wf view serve` uses since starting it is its job.
 */
export async function startHub(root, { register: add = true, port = VIEW_PORT, force = false, env = process.env } = {}) {
  if (add) register(root, env);
  if (!force && env.WF_ASK_NO_SERVER === "1") return null;
  return ensureHub({ port, env });
}
