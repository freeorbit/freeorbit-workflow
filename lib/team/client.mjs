// The kit's side of a team server: what `wf ask` sends to it and reads from
// it when the project's config names one (`teamServer`). The server is
// lib/team/server.mjs; the design is docs/design/team-server.md.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { askDir } from "../ask/store.mjs";
import { tokenFrom } from "../board/envfile.mjs";
import { laterRoles } from "../roles.mjs";

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

/**
 * The project's team server, or null when it works alone: `{ server,
 * project, token }`. The address is https:, or plain http on this machine
 * for a try. The token comes from the environment variable it names, else
 * from `root`'s .env, read as the board's token is: only when git ignores
 * it and does not track it (lib/board/envfile.mjs).
 */
export function teamFor(config, env = process.env, root = null) {
  const t = config?.teamServer ?? {};
  if (!t.url) return null;
  const server = String(t.url).replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(server) && !LOCAL.test(server)) throw new Error(`teamServer.url is the server's https: address, such as https://asks.example.com, not ${t.url}`);
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(String(t.project ?? ""))) throw new Error("teamServer.project is this project's key on the server: lowercase letters, digits, and dashes");
  const name = t.tokenEnv || "WF_TEAM_TOKEN";
  const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
  const { token, problem } = root ? tokenFrom(root, name, { env, git }) : { token: env[name] };
  if (problem) throw new Error(problem);
  if (!token) throw new Error(`${name} is not set: put the token your invite link gave you in it, or in a gitignored .env at the project's root`);
  return { server, project: t.project, token };
}

/** A team server that did not answer: worth trying again, unlike one that said no. */
export class Unreachable extends Error {}

/**
 * One call to the team server as the kit: JSON both ways, its error as the
 * thrown message. A redirect is refused, so a page or a token never goes to
 * another host.
 */
export async function call(team, path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${team.server}${path}`, { method, redirect: "error", headers: { Authorization: `Bearer ${team.token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Unreachable(`the team server at ${team.server} did not answer (${err.cause?.message ?? err.message}); check teamServer.url and your connection, then run the command again`);
  }
  const got = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("the team server did not take your token; put the one your invite link gave you in your token's variable, or ask an admin for a new link");
  if (!res.ok) throw new Error(`the team server said: ${got.error ?? `HTTP ${res.status}`}`);
  return got;
}

const page = (team, id, what = "") => `/__team/api/${team.project}/${id}${what ? `/${what}` : ""}`;

/**
 * Publish a page built here: its spec, and its pictures as copied beside
 * it. The server draws the page itself, so no one sends another person
 * script. Gives the page's address there.
 */
export async function publishPage(team, view, spec, { kinds, config, name }) {
  const dir = askDir(view, spec.id);
  const pictures = {};
  let files = [];
  try {
    files = readdirSync(join(dir, "p"));
  } catch {
    // A page with no pictures.
  }
  for (const file of files) pictures[`p/${file}`] = readFileSync(join(dir, "p", file)).toString("base64");
  await call(team, `/__team/api/${team.project}`, { method: "PUT", body: { name, kinds } });
  const { address } = await call(team, page(team, spec.id), { method: "PUT", body: { spec, pictures, team: config ? laterRoles(config) : [] } });
  return address;
}

/**
 * The page's state there: `{ version, hash, state, open, answers, untold,
 * more, replies }`, or `{ unchanged, version }` when it is still the
 * version `since`. `waiting` renews the mark that says the agent waits.
 */
export const pageState = (team, id, { since = null, waiting = false } = {}) => call(team, `${page(team, id)}${since != null || waiting ? `?${new URLSearchParams({ ...(since != null ? { since: String(since) } : {}), ...(waiting ? { waiting: "1" } : {}) })}` : ""}`);
/** Say the agent waits on the page, renewed by each call, or that it stopped. */
export const markWaiting = (team, id, on, since) => call(team, page(team, id, "waiting"), { method: "POST", body: { on, since } });
/** The asks the agent was told of, so they wake it once. */
export const tellTold = (team, id, asks) => call(team, page(team, id, "told"), { method: "POST", body: { asks: asks.map((a) => ({ question: a.question, n: a.n })) } });
/** The agent's more under a question, or the page: checked blocks, and added options. */
export const sendMore = (team, id, question, blocks, options) => call(team, page(team, id, "more"), { method: "POST", body: { question, blocks, options } });
/** The agent's reply under a question. */
export const sendReply = (team, id, question, text) => call(team, page(team, id, "reply"), { method: "POST", body: { question, text } });
/** A live page's status, as it stands now. */
export const sendLive = (team, id, live) => call(team, page(team, id, "live"), { method: "POST", body: { live } });
/** The page's address there. */
export const pageAddress = (team, id) => `${team.server}/${team.project}/ask/${id}/`;
