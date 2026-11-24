// The team server's own records: who may sign in, the invite links not yet
// used, and a log of who did what. Kept in `<data>/team/`, beside the
// projects' folders, as files written whole, so a restart loses nothing
// (docs/design/team-server.md).
//
//   team/members.json   { members: [{ name, role, client, admin, projects, secret (the kit token's hash), password (scrypt), created, expires, revoked }] }
//   team/sessions.json  { sessions: [{ secret (its hash), name, created, expires }] }, one per browser signed in
//   team/invites.json   { invites: [{ code (its hash), name, role, client, admin, projects, days, expires, used }] }
//   team/log-<yyyy-mm>.jsonl   one line per sign-in, invite, publish, answer, and revoke, a file a month
//
// A secret or a code is never kept, only its SHA-256, and a password only as
// scrypt with a salt of its own: a copy of the folder signs no one in.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeWhole } from "../files.mjs";

/** A person's name on the server: letters, digits, dots, dashes, and underscores. */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** A role, as the project's roles name one, such as designer or owner. */
export const ROLE = /^[a-z][a-z-]{0,29}$/;
/** A project's key on the server, as the local hub's. */
export const PROJECT = /^[a-z0-9][a-z0-9-]{0,48}$/;
/** Names no invite gives: the admin token's own, so the log and the answers tell it from a member. */
const RESERVED = ["admin-token", "admin"];
export const TEAM_LIMITS = { inviteDays: 7, clientDays: 30, members: 200, projects: 50, sessionDays: 30, sessions: 10, password: [12, 200] };
// scrypt's cost, at OWASP's guidance (N=2^14, r=8, p=5, as strong as N=2^17, p=1) with 16 MiB a try, so a small
// container holds several at once. Kept with each hash, so it can be raised later.
const SCRYPT = { N: 16384, r: 8, p: 5 };
const scrypted = (password, salt, cost = SCRYPT) => new Promise((done, fail) => scrypt(String(password), Buffer.from(salt, "hex"), 64, { ...cost, maxmem: 128 * cost.N * cost.r * 2 }, (err, key) => (err ? fail(err) : done(key.toString("hex")))));
/** A password's stored cost: its own, or the first version's. */
const costOf = (stored) => ({ N: stored?.N ?? 16384, r: stored?.r ?? 8, p: stored?.p ?? 1 });
// What a failed sign-in says, the same whichever was wrong, so it tells no one which names exist.
const NOT_RIGHT = "the name or password is not right";

const hash = (secret) => createHash("sha256").update(String(secret)).digest("hex");
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fresh = () => randomBytes(32).toString("base64url");
const days = (n, from = Date.now()) => new Date(from + n * 86_400_000).toISOString();

/**
 * The team's records in `dir` (the server's data folder): read and written
 * whole on each change, as only the server writes them. `adminToken`, from
 * the host's secret, signs in the first admin before any invite is used.
 */
export function openTeam(dir, { adminToken = "", now = () => Date.now() } = {}) {
  const team = join(dir, "team");
  mkdirSync(team, { recursive: true, mode: 0o700 });
  const file = (name) => join(team, name);
  // Read once, and kept: only this server writes them, so every request reads memory, not the share.
  const kept = new Map();
  const read = (name, key) => {
    if (!kept.has(name)) {
      let list = [];
      try {
        const value = JSON.parse(readFileSync(file(name), "utf8"));
        if (Array.isArray(value?.[key])) list = value[key];
      } catch {
        // None yet.
      }
      kept.set(name, list);
    }
    return structuredClone(kept.get(name));
  };
  const write = (name, key, list) => {
    writeWhole(file(name), `${JSON.stringify({ [key]: list }, null, 2)}\n`);
    kept.set(name, structuredClone(list));
  };
  const admin = adminToken.length >= 32 ? hash(adminToken) : null;

  /** Keep a line in the log: what happened, who did it, and its details. */
  function log(what, who, details = {}) {
    const at = new Date(now()).toISOString();
    appendFileSync(file(`log-${at.slice(0, 7)}.jsonl`), `${JSON.stringify({ at, what, who: who ?? null, ...details })}\n`, { mode: 0o600 });
  }

  /** Check what an invite asks for: `{ name, role, client, admin, projects, days }`, or throw why not. */
  function checked({ name, role = "member", client = false, admin: isAdmin = false, projects = [], days: valid } = {}) {
    if (!NAME.test(String(name ?? ""))) throw new Error("a name is letters, digits, dots, dashes, or underscores, at most 40");
    if (RESERVED.includes(String(name).toLowerCase())) throw new Error(`${name} is the admin token's own name; pick another`);
    if (!ROLE.test(String(role))) throw new Error("a role is lowercase letters and dashes, such as designer");
    if (client && isAdmin) throw new Error("a client is never an admin");
    const keys = (Array.isArray(projects) ? projects : [projects]).map(String);
    if (!keys.length) throw new Error("an invite names the projects it opens, or * for every one");
    if (keys.some((k) => k !== "*" && !PROJECT.test(k)) || keys.length > TEAM_LIMITS.projects) throw new Error("projects are project keys, or *");
    if (client && keys.includes("*")) throw new Error("a client's link names its projects; * is for the team");
    const limit = client ? TEAM_LIMITS.clientDays : 3650;
    const n = valid == null ? (client ? TEAM_LIMITS.clientDays : 0) : Number(valid);
    if (!Number.isInteger(n) || n < 0 || n > limit || (client && n < 1)) throw new Error(client ? `a client's link lasts 1 to ${limit} days` : "days is a whole number, 0 for no end");
    return { name, role: client ? "client" : role, client: Boolean(client), admin: Boolean(isAdmin), projects: [...new Set(keys)], days: n };
  }

  /** A member who may sign in now: there, not revoked, not out of date. */
  const current = (m) => m && !m.revoked && !(m.expires && Date.parse(m.expires) <= now());
  const shown = ({ secret, password, ...m }) => m;
  /** A new session for a member: a browser's cookie, for TEAM_LIMITS.sessionDays, or until the member's end. */
  function newSession(m) {
    const secret = fresh();
    const end = Math.min(now() + TEAM_LIMITS.sessionDays * 86_400_000, m.expires ? Date.parse(m.expires) : Infinity);
    const mine = read("sessions.json", "sessions").filter((x) => Date.parse(x.expires) > now());
    // A person's oldest sessions go past the limit, so a lost browser does not stay signed in for ever.
    const theirs = mine.filter((x) => x.name === m.name);
    const drop = new Set(theirs.slice(0, Math.max(0, theirs.length - TEAM_LIMITS.sessions + 1)));
    write("sessions.json", "sessions", [...mine.filter((x) => !drop.has(x)), { secret: hash(secret), name: m.name, created: new Date(now()).toISOString(), expires: new Date(end).toISOString() }]);
    return secret;
  }
  const passwordProblem = (password) => {
    const [least, most] = TEAM_LIMITS.password;
    return typeof password !== "string" || password.length < least || password.length > most ? `a password is at least ${least} characters, and at most ${most}` : "";
  };

  return {
    log,
    /** Every member, without their secrets' or passwords' hashes. */
    members: () => read("members.json", "members").map(shown),

    /**
     * An invite link's code for a person: it works once, within
     * TEAM_LIMITS.inviteDays, and signs them in as what it names.
     */
    invite(what, by) {
      const want = checked(what);
      const invites = read("invites.json", "invites").filter((i) => !i.used && Date.parse(i.expires) > now() && i.name !== want.name);
      const code = fresh();
      invites.push({ ...want, code: hash(code), expires: days(TEAM_LIMITS.inviteDays, now()), used: null });
      write("invites.json", "invites", invites);
      log("invite", by, { name: want.name, role: want.role, client: want.client, projects: want.projects });
      return code;
    },

    /**
     * Use an invite's code, with the password the person chooses: they are a
     * member from now, and sign in from any browser with their name and it.
     * Gives the member, a session for this browser, and, for a member of the
     * team, a token for their kit, shown once. A second use, or a late one,
     * is refused; a new invite for the same name sets a new password.
     */
    async redeem(code, password) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      const invites = read("invites.json", "invites");
      const at = invites.findIndex((i) => same(i.code, hash(String(code))) && !i.used && Date.parse(i.expires) > now());
      if (at < 0) throw new Error("this link was used, or is out of date; ask for a new one");
      const salt = randomBytes(16).toString("hex");
      const key = await scrypted(password, salt);
      // Read again after the wait, so a use of the same code meanwhile is seen.
      const again = read("invites.json", "invites");
      const now2 = again.findIndex((i) => same(i.code, hash(String(code))) && !i.used && Date.parse(i.expires) > now());
      if (now2 < 0) throw new Error("this link was used, or is out of date; ask for a new one");
      const { code: _, used, expires, days: valid, ...who } = again[now2];
      again[now2].used = new Date(now()).toISOString();
      write("invites.json", "invites", again);
      const token = fresh();
      const members = read("members.json", "members").filter((m) => m.name !== who.name);
      if (members.length >= TEAM_LIMITS.members) throw new Error(`the team holds at most ${TEAM_LIMITS.members} people`);
      const member = { ...who, secret: hash(token), password: { salt, key, ...SCRYPT }, created: new Date(now()).toISOString(), expires: valid ? days(valid, now()) : null, revoked: null };
      members.push(member);
      write("members.json", "members", members);
      // A new password signs every browser of theirs out.
      write("sessions.json", "sessions", read("sessions.json", "sessions").filter((x) => x.name !== who.name));
      log("join", who.name, { role: who.role, client: who.client });
      return { member: shown(member), session: newSession(member), ...(member.client ? {} : { token }) };
    },

    /** Sign in from a browser with a name and a password: a new session for it, or throw the same words for any wrong one. */
    async login(name, password, caller = "") {
      const m = await this.check(name, password);
      if (!m) {
        // A failed try is logged, with where it came from, never the password.
        log("sign-in refused", null, { name: String(name).slice(0, 40), caller });
        throw new Error(NOT_RIGHT);
      }
      log("sign-in", m.name);
      return newSession(m);
    },

    /**
     * The member a name and password are, or null. Read again after scrypt's
     * wait, so a password set meanwhile, by a new invite link, or a revoke,
     * is the one that counts.
     */
    async check(name, password) {
      const before = read("members.json", "members").find((x) => x.name === String(name));
      // A name with no password, or none at all, still takes scrypt's time, so the answer's speed tells nothing.
      const key = await scrypted(password, before?.password?.salt ?? "00", costOf(before?.password));
      const m = read("members.json", "members").find((x) => x.name === String(name));
      const ok = current(m) && m.password && before?.password && m.password.salt === before.password.salt && same(key, m.password.key);
      return ok ? shown(m) : null;
    },

    /** Sign every browser of a person's out. */
    logoutAll(name) {
      write("sessions.json", "sessions", read("sessions.json", "sessions").filter((x) => x.name !== name && Date.parse(x.expires) > now()));
      log("sign-out everywhere", name);
    },

    /** Who a browser's session signs in, or null. */
    session(secret) {
      if (typeof secret !== "string" || secret.length < 32 || secret.length > 200) return null;
      const s = read("sessions.json", "sessions").find((x) => same(x.secret, hash(secret)));
      if (!s || Date.parse(s.expires) <= now()) return null;
      const m = read("members.json", "members").find((x) => x.name === s.name);
      return current(m) ? shown(m) : null;
    },

    /** Sign a browser out: its session ends, the others stay. */
    logout(secret) {
      const h = hash(String(secret));
      const all = read("sessions.json", "sessions");
      const s = all.find((x) => same(x.secret, h));
      write("sessions.json", "sessions", all.filter((x) => x !== s && Date.parse(x.expires) > now()));
      if (s) log("sign-out", s.name);
    },

    /** A new token for a member's kit, shown once; the one before stops. */
    newToken(name) {
      const members = read("members.json", "members");
      const m = members.find((x) => x.name === name);
      if (!current(m) || m.client) throw new Error("only a member of the team has a kit token");
      const token = fresh();
      m.secret = hash(token);
      write("members.json", "members", members);
      log("token", name);
      return token;
    },

    /** Who the kit's token signs in, or null: a member not revoked and not out of date, or the admin token's owner. */
    who(secret) {
      if (typeof secret !== "string" || secret.length < 32 || secret.length > 200) return null;
      const h = hash(secret);
      if (admin && same(h, admin)) return { name: RESERVED[0], role: "owner", client: false, admin: true, projects: ["*"] };
      const m = read("members.json", "members").find((x) => x.secret && same(x.secret, h));
      return current(m) && !m.client ? shown(m) : null;
    },

    /** Take a member's access away, and any invite of theirs not used yet. */
    revoke(name, by) {
      const members = read("members.json", "members");
      const m = members.find((x) => x.name === name && !x.revoked);
      const invites = read("invites.json", "invites");
      const open = invites.filter((i) => i.name === name && !i.used);
      if (!m && !open.length) throw new Error(`${name} is not a member, and has no invite waiting`);
      if (m) m.revoked = new Date(now()).toISOString();
      write("members.json", "members", members);
      write("sessions.json", "sessions", read("sessions.json", "sessions").filter((x) => x.name !== name));
      write("invites.json", "invites", invites.filter((i) => !(i.name === name && !i.used)));
      log("revoke", by, { name });
    },
  };
}

/** Whether a person may see a project's pages: one of theirs, or every one with *. */
export const inProject = (who, key) => Boolean(who) && (who.projects.includes("*") || who.projects.includes(key));

/**
 * Whether a person may see one page: a member sees every page of their
 * projects; a client only the ones the page is for (its `for` names
 * "client" or them), so a page about the team stays the team's.
 */
export function maySee(who, key, spec) {
  if (!inProject(who, key)) return false;
  if (!who.client) return true;
  const audience = Array.isArray(spec?.for) ? spec.for : [];
  return audience.includes("client") || audience.includes(who.name);
}

/** Whether a page waits on a person: the page or one of its questions names their role or them. */
export function waitsOn(who, spec) {
  const names = [who.role, who.name];
  return (spec.for ?? []).some((f) => names.includes(f)) || spec.questions.some((q) => names.includes(q.role));
}
