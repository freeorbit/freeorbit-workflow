// Working together on a team server's ask page: one shared answer per
// question, saved as it is made and pushed to every open page; who is on the
// page, where, and typing; threads under a question; who a question is
// assigned to; who has marked their part done; who sent it; and what
// happened. The design is docs/design/team-server.md, "Working together".
//
//   ask/<id>/working.json   { answers, by, at }   the shared answers before Send, by question
//   ask/<id>/collab.json    { threads, assign, done, sent, activity }
//
// Only the team server writes them, so a page's state is read once and kept
// in memory while it is used; a page no one has open goes from memory once
// more than COLLAB_LIMITS.pages are. Its files are written a second after a
// change, all of a second's changes at once. Each open page holds one event
// stream (Server-Sent Events); a save names the connection it came from,
// which is not told it back. The server runs as one process, so the streams
// are kept here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkAnswers } from "../ask/answers.mjs";
import { answersPath, askDir } from "../ask/store.mjs";
import { writeWhole } from "../files.mjs";

export const COLLAB_LIMITS = {
  thread: 2000, // characters in a line
  threads: 200, // lines under a question
  talk: 400_000, // characters in all of a page's lines
  activity: 200,
  conns: 50, // open streams on a page
  connsPerson: 5, // a person's open streams on a page
  connsPersonAll: 20, // a person's open streams in all
  pages: 100, // pages kept in memory with no stream open
  recheckMs: 10_000, // how often an open stream's session and page are checked again
  backlog: 1_000_000, // bytes a stream that does not read may hold before it is closed
};
const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CONN = /^[A-Za-z0-9_-]{1,40}$/;
const FLUSH_MS = 1000;

const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The working and collab state of each page, its open streams, and who is where. `viewOf(key)` is a project's folder. */
export function openCollab(viewOf) {
  const pages = new Map(); // key/id → { working, collab, fresh }, oldest used first
  const streams = new Map(); // key/id → Map(conn → { res, who, question, typing, seen, still, checked })
  const brief = new Map(); // key/id → { assigned: [names], sentBy }, for the inbox, without the page in memory
  const dirty = new Map(); // key/id → Set of file names to write
  let flushTimer = null;
  const k = (key, id) => `${key}/${id}`;
  const dir = (key, id) => askDir(viewOf(key), id);

  function load(key, id, spec = null) {
    const at = k(key, id);
    let page = pages.get(at);
    if (page) {
      pages.delete(at);
      pages.set(at, page);
    } else {
      const kept = readJson(join(dir(key, id), "working.json"), null);
      const collab = { threads: {}, assign: {}, done: {}, sent: null, activity: [], ...readJson(join(dir(key, id), "collab.json"), {}) };
      page = { working: kept ?? { answers: {}, by: {}, at: {} }, collab, fresh: !kept };
      pages.set(at, page);
      evict();
    }
    // A page answered before the shared answers (v1.22 and before) starts from its last sent answers, for the same questions.
    if (page.fresh && spec) {
      page.fresh = false;
      const sent = readJson(answersPath(viewOf(key), id), null);
      if (sent?.hash === spec.hash && sent.answers && typeof sent.answers === "object") page.working = { answers: sent.answers, by: sent.by && typeof sent.by === "object" ? sent.by : {}, at: {} };
    }
    return page;
  }
  /** Keep at most COLLAB_LIMITS.pages pages that no one has open; their changes are written first. */
  function evict() {
    const idle = [...pages.keys()].filter((at) => !streams.has(at));
    while (idle.length > COLLAB_LIMITS.pages) {
      const at = idle.shift();
      write(at);
      pages.delete(at);
    }
  }

  /** Write a page's changed files. */
  function write(at) {
    const names = dirty.get(at);
    const page = pages.get(at);
    dirty.delete(at);
    if (!names || !page) return;
    const [key, id] = at.split("/");
    for (const name of names) writeWhole(join(dir(key, id), `${name}.json`), `${JSON.stringify(page[name])}\n`);
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    for (const at of [...dirty.keys()]) write(at);
  }
  /** Mark a page's file to be written, with the second's other changes. */
  function save(key, id, name) {
    const at = k(key, id);
    dirty.set(at, (dirty.get(at) ?? new Set()).add(name));
    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_MS);
      flushTimer.unref?.();
    }
  }
  /** Note what happened. */
  function happened(key, id, who, what, more = {}) {
    const { collab } = load(key, id);
    const at = new Date().toISOString();
    const last = collab.activity.at(-1);
    // One person's changes to one question within a minute, such as a note saved as it is typed, are one line.
    if (last && last.who === who && last.what === what && last.question === more.question && Date.parse(at) - Date.parse(last.at) < 60_000) { last.at = at; return; }
    collab.activity.push({ at, who, what, ...more });
    if (collab.activity.length > COLLAB_LIMITS.activity) collab.activity.splice(0, collab.activity.length - COLLAB_LIMITS.activity);
  }
  const summarize = (key, id, collab) => brief.set(k(key, id), { assigned: Object.values(collab.assign).map((a) => a.name), sentBy: collab.sent?.by ?? null, sentAt: collab.sent?.at ?? null });

  /** Close one stream. */
  function drop(key, id, conn) {
    const page = streams.get(k(key, id));
    const s = page?.get(conn);
    if (!s) return;
    page.delete(conn);
    if (!page.size) streams.delete(k(key, id));
    try {
      s.res.end();
    } catch {
      // Closed already.
    }
  }
  /**
   * Send an event to a page's open streams, but the connection it came from.
   * A stream whose session has ended, or whose person may no longer see the
   * page, is closed instead, as is one that has stopped reading.
   */
  function tell(key, id, type, data, except = "") {
    const page = streams.get(k(key, id));
    if (!page) return;
    const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    const now = Date.now();
    let gone = false;
    for (const [conn, s] of [...page]) {
      if (conn === except) continue;
      if (now - s.checked > COLLAB_LIMITS.recheckMs) {
        s.checked = now;
        if (!s.still()) { drop(key, id, conn); gone = true; continue; }
      }
      if (s.res.writableLength > COLLAB_LIMITS.backlog) { drop(key, id, conn); gone = true; continue; }
      try {
        s.res.write(line);
      } catch {
        // A stream that cannot take it is closed by its own close event.
      }
    }
    if (gone) tellPeople(key, id);
  }
  /** Who is on a page: each person once, where they last were, and whether they type. */
  function people(key, id) {
    const seen = new Map();
    for (const s of (streams.get(k(key, id)) ?? new Map()).values()) {
      const was = seen.get(s.who.name);
      if (!was || s.seen > was.seen) seen.set(s.who.name, { name: s.who.name, role: s.who.client ? "client" : s.who.role, question: s.question, typing: s.typing, seen: s.seen });
    }
    return [...seen.values()].map(({ seen: _, ...p }) => p).sort((a, b) => a.name.localeCompare(b.name));
  }
  const tellPeople = (key, id) => tell(key, id, "presence", { people: people(key, id) });

  /**
   * Save answers to some questions, each a value or null to clear it: checked
   * with the rest, as a whole page's answers are, so a follow-up an answer no
   * longer asks goes. The last save wins. Tells the other open pages what
   * changed, and the person who assigned a question when someone else answers it.
   */
  function change(key, id, spec, kinds, who, updates, conn = "") {
    for (const question of Object.keys(updates)) if (!spec.questions.some((q) => q.id === question)) throw new Error(`${question} is not a question on this page`);
    const page = load(key, id, spec);
    const { working, collab } = page;
    const next = { ...working.answers };
    for (const [question, value] of Object.entries(updates)) {
      if (value == null) delete next[question];
      else next[question] = value;
    }
    const { answers, problems } = checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: next }, kinds);
    if (problems) throw new Error(problems.join("; "));
    const at = new Date().toISOString();
    const now = answers.answers;
    const changes = {};
    for (const q of new Set([...Object.keys(working.answers), ...Object.keys(now)])) if (!same(working.answers[q], now[q])) changes[q] = now[q] ?? null;
    const by = {};
    const when = {};
    for (const q of Object.keys(now)) {
      const giver = q in updates ? who.name : working.by[q];
      const time = q in updates ? at : working.at[q];
      if (giver) by[q] = giver;
      if (time) when[q] = time;
    }
    page.working = { answers: now, by, at: when };
    save(key, id, "working");
    for (const question of Object.keys(updates)) happened(key, id, who.name, "answer", { question });
    save(key, id, "collab");
    const pick = (map) => Object.fromEntries(Object.keys(changes).filter((q) => map[q]).map((q) => [q, map[q]]));
    if (Object.keys(changes).length) tell(key, id, "working", { changes, by: pick(by), at: pick(when), changed: Object.keys(updates)[0], who: who.name }, conn);
    // Whoever assigned a question is told once when someone else answers it, not at each change after.
    for (const [question, value] of Object.entries(updates)) {
      const assigned = collab.assign[question];
      const first = working.answers[question] == null || working.by[question] !== who.name;
      if (assigned && value != null && assigned.by !== who.name && first) tell(key, id, "answered", { question, by: who.name, to: assigned.by });
    }
    return { at, changes, by: pick(by), when: pick(when) };
  }

  return {
    /** The page's shared answers and its collab state, for drawing it. */
    state(key, id, spec = null) {
      const { working, collab } = load(key, id, spec);
      return { working, collab };
    },

    /** Whom a page's questions are assigned to, and who sent it, for the inbox: from memory, or its file once. */
    brief(key, id) {
      if (!brief.has(k(key, id))) {
        const page = pages.get(k(key, id));
        summarize(key, id, page?.collab ?? { assign: {}, sent: null, ...readJson(join(dir(key, id), "collab.json"), {}) });
      }
      return brief.get(k(key, id));
    },

    /** Forget a page's state, when it is published again with other questions, and close its streams: each open page reloads. */
    forget(key, id) {
      tell(key, id, "replaced", {});
      for (const conn of [...(streams.get(k(key, id))?.keys() ?? [])]) drop(key, id, conn);
      dirty.delete(k(key, id));
      pages.delete(k(key, id));
      brief.delete(k(key, id));
    },

    /** Save one question's answer, or clear it with null. */
    answer: (key, id, spec, kinds, who, question, value, conn = "") => change(key, id, spec, kinds, who, { [question]: value }, conn),

    /**
     * Take a whole page's answers as one person's, as a Send carries them:
     * each that differs from the shared one is saved as theirs, all at once,
     * and a question they left empty keeps the shared answer. Gives the answers now.
     */
    adopt(key, id, spec, kinds, who, sent) {
      const { working } = load(key, id, spec);
      const updates = Object.fromEntries(Object.entries(sent ?? {}).filter(([q, v]) => !same(working.answers[q], v)));
      if (Object.keys(updates).length) change(key, id, spec, kinds, who, updates);
      return load(key, id).working;
    },

    /** A line under a question, from anyone who sees the page. */
    thread(key, id, spec, who, question, text) {
      if (!spec.questions.some((q) => q.id === question)) throw new Error(`${question} is not a question on this page`);
      const said = String(text ?? "").trim();
      if (!said || said.length > COLLAB_LIMITS.thread) throw new Error(`a line is 1 to ${COLLAB_LIMITS.thread} characters`);
      const { collab } = load(key, id, spec);
      const all = Object.values(collab.threads).flat().reduce((n, t) => n + t.text.length, 0);
      if (all + said.length > COLLAB_LIMITS.talk) throw new Error("this page's discussion is full; take it elsewhere");
      const entry = { by: who.name, text: said, at: new Date().toISOString() };
      collab.threads[question] = [...(collab.threads[question] ?? []), entry].slice(-COLLAB_LIMITS.threads);
      happened(key, id, who.name, "thread", { question });
      save(key, id, "collab");
      tell(key, id, "thread", { question, entry });
      return entry;
    },

    /** Assign a question to a person who sees the page, or no one with null; a team member's act. */
    assign(key, id, spec, who, question, name, people) {
      if (who.client) throw new Error("the team assigns questions");
      if (!QID.test(String(question)) || !spec.questions.some((q) => q.id === question)) throw new Error(`${question} is not a question on this page`);
      if (name != null && !people.some((p) => p.name === name)) throw new Error(`${name} cannot see this page`);
      const { collab } = load(key, id, spec);
      if (name == null) delete collab.assign[question];
      else collab.assign[question] = { name, by: who.name, at: new Date().toISOString() };
      happened(key, id, who.name, "assign", { question, ...(name ? { to: name } : {}) });
      save(key, id, "collab");
      summarize(key, id, collab);
      tell(key, id, "assign", { assign: collab.assign });
    },

    /** Mark a person's part done, or not. */
    done(key, id, who, done) {
      const { collab } = load(key, id);
      if (done) collab.done[who.name] = new Date().toISOString();
      else delete collab.done[who.name];
      happened(key, id, who.name, done ? "done" : "not done");
      save(key, id, "collab");
      tell(key, id, "done", { done: collab.done });
    },

    /** The page was sent to the agent: who sent it, and when. */
    sent(key, id, who) {
      const { collab } = load(key, id);
      collab.sent = { by: who.name, at: new Date().toISOString() };
      happened(key, id, who.name, "sent");
      save(key, id, "collab");
      summarize(key, id, collab);
      tell(key, id, "sent", { sent: collab.sent });
      return collab.sent;
    },

    /**
     * Open a page's event stream for a person: tells them the page's state
     * at once, then each change; a comment every 20 s keeps proxies from
     * closing it. `still()` says whether their session and their right to the
     * page hold yet, checked again as events go. `extra` goes with the first
     * event. Closing it takes the person off the page.
     */
    open(req, res, key, id, who, conn, still = () => true, extra = {}) {
      if (!CONN.test(String(conn))) conn = Math.random().toString(36).slice(2, 12);
      const page = streams.get(k(key, id)) ?? new Map();
      const mine = (p) => [...p.values()].filter((s) => s.who.name === who.name).length;
      const theirsAll = [...streams.values()].reduce((n, p) => n + mine(p), 0);
      if (!page.has(conn) && (page.size >= COLLAB_LIMITS.conns || mine(page) >= COLLAB_LIMITS.connsPerson || theirsAll >= COLLAB_LIMITS.connsPersonAll)) {
        return res.writeHead(503, { "Content-Type": "text/plain" }).end("too many open pages; close one\n");
      }
      if (page.has(conn)) drop(key, id, conn);
      if (!streams.has(k(key, id))) streams.set(k(key, id), page);
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
      const entry = { res, who, question: null, typing: false, seen: Date.now(), still, checked: Date.now() };
      streams.get(k(key, id)).set(conn, entry);
      const { working, collab } = load(key, id);
      res.write(`event: hello\ndata: ${JSON.stringify({ working, collab, people: people(key, id), conn, ...extra })}\n\n`);
      tellPeople(key, id);
      const beat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 20_000);
      beat.unref?.();
      req.on("close", () => {
        clearInterval(beat);
        const now = streams.get(k(key, id));
        // A stream opened again with the same connection is not this one.
        if (now?.get(conn) !== entry) return;
        now.delete(conn);
        if (!now.size) streams.delete(k(key, id));
        tellPeople(key, id);
      });
    },

    /** Where a person is on the page, and whether they type, from their open stream's connection. Told only when it changes. */
    presence(key, id, who, conn, question, typing) {
      const s = streams.get(k(key, id))?.get(conn);
      if (!s || s.who.name !== who.name) throw new Error("open the page first");
      const where = question == null ? null : String(question).slice(0, 64);
      const changed = s.question !== where || s.typing !== Boolean(typing);
      s.question = where;
      s.typing = Boolean(typing);
      s.seen = Date.now();
      if (changed) tellPeople(key, id);
    },

    people,
    flush,
  };
}
