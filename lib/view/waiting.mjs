// Whether an agent is waiting on an ask page right now, and telling the
// person so. `wf ask wait` marks the page while it runs, so the inbox and the
// page can tell a page an agent is blocked on from one merely unanswered. It
// also shows a desktop notification when it starts, and one reminder later,
// through the shared server, so a page's own notice of the same ask is the
// same notification and is shown once.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const markPath = (view, id) => join(view, "ask", id, "waiting.json");

/** Whether a process is running, by its id. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return error.code === "EPERM";
  }
}

/** Mark the page as waited on by this process, from `since` (an ISO time). */
export function markWaiting(view, id, { pid = process.pid, since = new Date().toISOString() } = {}) {
  writeFileSync(markPath(view, id), `${JSON.stringify({ pid, since })}\n`);
}

/** Take the mark away, when it is this process's. */
export function clearWaiting(view, id, pid = process.pid) {
  const file = markPath(view, id);
  try {
    if (JSON.parse(readFileSync(file, "utf8")).pid === pid) rmSync(file, { force: true });
  } catch {
    /* no mark, or a broken one: nothing to take away */
  }
}

/** When an agent started waiting on the page, or null when none is: a mark whose process ended counts as none. */
export function waitingSince(view, id, isAlive = alive) {
  const file = markPath(view, id);
  if (!existsSync(file)) return null;
  try {
    const { pid, since } = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(pid) && isAlive(pid) && typeof since === "string" ? since : null;
  } catch {
    return null;
  }
}

/**
 * Which notice is due after `elapsed` ms of waiting: "first" at the start,
 * "remind" once after `remind` minutes (0 for never), else null. `sent` is
 * the set of notices already shown.
 */
export function noticeDue(elapsed, sent, remind) {
  if (!sent.has("first")) return "first";
  if (remind > 0 && !sent.has("remind") && elapsed >= remind * 60_000) return "remind";
  return null;
}

/** A notice's title and body. The first is word for word the page's own, so the server shows the two as one. */
export function noticeText(kind, { project, title, minutes = 0 }) {
  const head = `${project}: ${title}`;
  return kind === "remind" ? { title: head, body: `An agent has waited ${minutes} ${minutes === 1 ? "minute" : "minutes"} on this ask.` } : { title: head, body: "An agent is waiting on this ask." };
}

/** The token a page of the server signed with `token` sends: the same rule as the server's. */
export const pageToken = (token, key, id) => createHmac("sha256", token).update(`${key}/${id}`).digest("hex").slice(0, 48);

/**
 * Show a notice through the server at `port`, signed as the page; when the
 * server cannot, with `local`, this machine's notifier, or nothing. Resolves
 * true when one was shown.
 */
export async function tellWaiting({ key, id, text, port, token, post = fetch, local = null }) {
  if (token) {
    try {
      const res = await post(`http://127.0.0.1:${port}/__hub/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-WF-Token": pageToken(token, key, id) },
        body: JSON.stringify({ key, id, ...text }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return (await res.json()).ok === true;
      // 501: the server's machine, this one, has no notifier either.
      if (res.status === 501) return false;
    } catch {
      /* the server is away: try this machine's notifier */
    }
  }
  return local ? local(text.title, text.body) === true : false;
}
