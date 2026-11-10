// `wf signoffs`: the questions this branch still waits on, so no merge is
// proposed past one (W-12). In the open questions log, each row under a
// chunk's heading waits on the role in its Needs cell until it is resolved and
// moved out; a row under "Not tied to a chunk yet" blocks no chunk, so no
// merge. In the pull request's body, a question is a line
// `- [ ] needs <role>: <question>`, ticked `- [x]` once it is answered. In a
// solo project the driver holds every role, so nothing is ever waiting.
//
// A repository admin may merge past open questions with
// `wf signoffs --bypass "<reason>"`, which writes a line into the pull
// request's body:
//
//   - [x] bypassed by @handle on 2026-11-10: <reason> (Q-012, Q-013)
//
// Anyone can edit a body, so a line counts only while its handle is one of
// `people` and gh says that person is an admin of the repository now. With no
// gh, or no sign-in, no line counts. A line covers only the Q-IDs it names, so
// a question raised after it blocks again.

import { spawnSync } from "node:child_process";

import { blockingRows } from "./questions.mjs";

export const PR_BODY = "the pull request";

const NEEDS = /^\s*[-*]\s+\[( |x|X)\]\s+needs\s+([a-z][a-z-]*(?::[a-z-]+)?)\s*:\s*(.+)$/;
const BYPASS = /^\s*[-*]\s+\[[xX]\]\s+bypassed by @([A-Za-z0-9-]+) on (\d{4}-\d{2}-\d{2}): (.+) \((Q-\d{3}(?:, Q-\d{3})*)\)\s*$/;

/** gh run in the project, as { status, stdout, error }. */
export const runGh = (root) => (args) => spawnSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The open `needs` lines and chunk question rows in a text, each with its role, question, and Q-ID when it is a row. */
export function openNeeds(text, source) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.match(NEEDS))
    .filter((match) => match && match[1] === " ")
    .map((match) => ({ id: null, role: match[2], question: match[3].trim(), source }));
  const rows = blockingRows(text).map((row) => ({ id: row.id, role: row.role, question: `${row.id} ${row.question} (${row.heading})`, source }));
  return [...lines, ...rows];
}

/** The bypass lines in a pull request's body, each { handle, date, reason, ids }. */
export function bypassLines(body) {
  return String(body ?? "")
    .split("\n")
    .map((line) => line.match(BYPASS))
    .filter(Boolean)
    .map((match) => ({ handle: match[1], date: match[2], reason: match[3].trim(), ids: match[4].split(", ") }));
}

/** Whether gh says `handle` is an admin of this repository now; false with no gh, no sign-in, or no answer. */
export function isAdmin(gh, handle) {
  const out = gh(["api", `repos/{owner}/{repo}/collaborators/${handle}/permission`, "-q", ".permission"]);
  return !out.error && out.status === 0 && out.stdout.trim() === "admin";
}

/** Whether `handle` is one of the project's people, ignoring case as GitHub does. */
const knownHandle = (config, handle) => (config.people ?? []).some((person) => person.handle && person.handle.toLowerCase() === handle.toLowerCase());

/** Why a bypass line does not count, or null when it does. */
export function bypassProblem(config, gh, line) {
  if (!knownHandle(config, line.handle)) return `@${line.handle} is not one of the project's people`;
  if (!isAdmin(gh, line.handle)) return `gh does not confirm @${line.handle} is a repository admin now (no gh, no sign-in, or not an admin)`;
  return null;
}

const holderNames = (config, role) =>
  (config.people ?? []).filter((person) => (person.roles ?? []).some((held) => held === role || role.startsWith(`${held}:`) || held.startsWith(`${role}:`))).map((person) => person.name);

/**
 * The lines to print and the exit code, for the texts that may hold needs.
 * Bypass lines are read only from the pull request's body, and each is
 * checked with gh when there is an open question it could cover.
 */
export function signoffs(config, texts, io = {}) {
  if (config.team === "solo") return { lines: ["Solo: the one person holds every role, so nothing waits on a sign-off."], code: 0 };
  const open = texts.flatMap(([source, text]) => openNeeds(text, source));
  if (open.length === 0) return { lines: ["No open sign-offs."], code: 0 };
  const body = texts.find(([source]) => source === PR_BODY)?.[1] ?? "";
  const bypasses = bypassLines(body);
  const out = [];
  const covered = new Map();
  const openIds = new Set(open.map((need) => need.id).filter(Boolean));
  if (bypasses.length) {
    const gh = io.gh ?? runGh(io.root ?? process.cwd());
    for (const line of bypasses) {
      const problem = bypassProblem(config, gh, line);
      if (problem) {
        out.push(`${PR_BODY}: a bypass for ${line.ids.join(", ")} does not count: ${problem}`);
        continue;
      }
      for (const id of line.ids) if (openIds.has(id)) covered.set(id, line);
      const stale = line.ids.filter((id) => !openIds.has(id));
      if (stale.length) out.push(`${PR_BODY}: the bypass by @${line.handle} names ${stale.join(", ")}, which no chunk waits on`);
    }
  }
  const blocking = [];
  for (const need of open) {
    const by = need.id && covered.get(need.id);
    const line = `${need.source}: needs ${need.role} (${holderNames(config, need.role).join(", ") || "nobody holds it"}): ${need.question}`;
    if (by) out.push(`BYPASSED by @${by.handle} on ${by.date} (${by.reason}): ${line.replace(/^[^:]+: /, "")}`);
    else blocking.push(line);
  }
  if (!blocking.length) return { lines: [...out, `No open sign-offs; ${covered.size} bypassed.`], code: 0 };
  return { lines: [...blocking, ...out, `${blocking.length} open: no merge until each is answered, and resolved or ticked.`], code: 1 };
}

/**
 * `wf signoffs --bypass "<reason>"`: the line to add to the pull request's
 * body for every open chunk question, after checking the signed-in gh user is
 * one of the people and a repository admin. Throws with the reason when not.
 */
export function bypassLine(config, texts, reason, date, gh) {
  const words = String(reason ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) throw new Error("a bypass needs a reason");
  if (words > config.docs.cellWords) throw new Error(`the reason has ${words} words; keep it to ${config.docs.cellWords}`);
  if (/[()\n]/.test(reason)) throw new Error("the reason has no brackets or line breaks");
  const ids = [...new Set(texts.flatMap(([source, text]) => openNeeds(text, source)).map((need) => need.id).filter(Boolean))];
  if (!ids.length) throw new Error("no open chunk question to bypass; a `- [ ] needs` line in the body is ticked, not bypassed");
  const who = gh(["api", "user", "-q", ".login"]);
  if (who.error || who.status !== 0 || !who.stdout.trim()) throw new Error("gh is not installed or not signed in, so no admin can be confirmed");
  const handle = who.stdout.trim();
  const problem = bypassProblem(config, gh, { handle });
  if (problem) throw new Error(problem);
  return `- [x] bypassed by @${handle} on ${date}: ${reason.trim()} (${ids.join(", ")})`;
}
