// The team server's own records: who may sign in, the invite links not yet
// used, and a log of who did what. Kept in `<data>/team/`, beside the
// projects' folders, as files written whole, so a restart loses nothing
// (docs/design/team-server.md).
//
//   team/members.json   { members: [{ name, role, client, admin, projects, secret (its hash), created, expires, revoked }] }
//   team/invites.json   { invites: [{ code (its hash), name, role, client, admin, projects, days, expires, used }] }
//   team/log-<yyyy-mm>.jsonl   one line per sign-in, invite, publish, answer, and revoke, a file a month
//
// A secret or a code is never kept, only its SHA-256: a copy of the folder
// signs no one in.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
export const TEAM_LIMITS = { inviteDays: 7, clientDays: 30, members: 200, projects: 50 };

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

  return {
    log,
    /** Every member, without their secrets' hashes. */
    members: () => read("members.json", "members").map(({ secret, ...m }) => m),

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
     * Use an invite's code: the person it names is a member from now, with a
     * new secret, which the server sets as their browser's cookie and shows
     * once for their kit. A second use, or a late one, is refused.
     */
    redeem(code) {
      const invites = read("invites.json", "invites");
      const at = invites.findIndex((i) => same(i.code, hash(code)) && !i.used && Date.parse(i.expires) > now());
      if (at < 0) throw new Error("this link was used, or is out of date; ask for a new one");
      const { code: _, used, expires, days: valid, ...who } = invites[at];
      invites[at].used = new Date(now()).toISOString();
      write("invites.json", "invites", invites);
      const secret = fresh();
      const members = read("members.json", "members").filter((m) => m.name !== who.name);
      if (members.length >= TEAM_LIMITS.members) throw new Error(`the team holds at most ${TEAM_LIMITS.members} people`);
      const member = { ...who, secret: hash(secret), created: new Date(now()).toISOString(), expires: valid ? days(valid, now()) : null, revoked: null };
      members.push(member);
      write("members.json", "members", members);
      log("join", who.name, { role: who.role, client: who.client });
      const { secret: __, ...shown } = member;
      return { member: shown, secret };
    },

    /** Who a secret signs in, or null: a member not revoked and not out of date, or the admin token's owner. */
    who(secret) {
      if (typeof secret !== "string" || secret.length < 32 || secret.length > 200) return null;
      const h = hash(secret);
      if (admin && same(h, admin)) return { name: RESERVED[0], role: "owner", client: false, admin: true, projects: ["*"] };
      const m = read("members.json", "members").find((x) => same(x.secret, h));
      if (!m || m.revoked || (m.expires && Date.parse(m.expires) <= now())) return null;
      const { secret: _, ...member } = m;
      return member;
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
