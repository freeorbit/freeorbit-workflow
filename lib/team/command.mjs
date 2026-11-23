// `wf team`: the team server, and an admin's commands on it.
//
//   wf team serve                      the server itself, from the host's settings (below)
//   wf team invite <name> --role <r>   a one-time link for a teammate on this project
//   wf team invite <name> --client [--days <n>]   a client's link, which ends (30 days by default)
//     [--project <key>]... [--admin] [--days <n>]
//   wf team revoke <name>              take a person's access away
//   wf team members                    who has joined
//
// The host gives `wf team serve` its settings as environment variables:
// WF_TEAM_ORIGIN, its public address; WF_TEAM_ADMIN_TOKEN, the first admin's
// secret, at least 32 characters, kept in the host's secret store; WF_TEAM_DATA,
// its data folder on a volume that outlasts a restart (/data); and PORT (8080).
// The design is docs/design/team-server.md.

import { loadConfig, projectRoot } from "../config/config.mjs";
import { flagValue } from "../process.mjs";
import { call, teamFor } from "./client.mjs";
import { teamServe } from "./server.mjs";

const USAGE = `Usage: wf team serve | invite <name> (--role <role> | --client) [--project <key>]... [--days <n>] [--admin] | revoke <name> | members`;

/** The server's settings from the host's environment, or throw what is missing. */
export function serveSettings(env) {
  const origin = String(env.WF_TEAM_ORIGIN ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new Error("WF_TEAM_ORIGIN is the server's public address, such as https://asks.example.com");
  const adminToken = String(env.WF_TEAM_ADMIN_TOKEN ?? "");
  if (adminToken.length < 32) throw new Error("WF_TEAM_ADMIN_TOKEN is the first admin's secret, at least 32 characters, from the host's secret store");
  return { origin, dir: env.WF_TEAM_DATA || "/data", port: Number(env.PORT || 8080), adminToken };
}

/** One admin call to the server, with the project's team server and the admin's token. */
async function admin(path, body) {
  const team = teamFor(loadConfig(projectRoot()));
  if (!team) throw new Error("this project names no team server; set teamServer.url in .workflow/config.json");
  return { team, got: await call(team, path, { method: body ? "POST" : "GET", body }) };
}

/** `wf team ...`; resolves to the exit code. */
export async function runTeam([sub, ...args], log = console.log) {
  if (sub === "serve") {
    const settings = serveSettings(process.env);
    await teamServe({ ...settings, log });
    return new Promise(() => {});
  }
  if (sub === "invite") {
    const name = args[0];
    const role = flagValue(args, "--role");
    const client = args.includes("--client");
    if (!name || name.startsWith("--") || (!role && !client) || (role && client)) {
      log(USAGE);
      return 2;
    }
    const projects = args.flatMap((a, i) => (a === "--project" && args[i + 1] ? [args[i + 1]] : []));
    const days = flagValue(args, "--days");
    const config = loadConfig(projectRoot());
    const keys = projects.length ? projects : [config.teamServer?.project];
    const { got } = await admin("/__team/invite", { name, role: role ?? undefined, client, admin: args.includes("--admin"), projects: keys, ...(days != null ? { days: Number(days) } : {}) });
    const lasts = client ? ` for ${days ?? 30} days` : "";
    log(`${name}, ${client ? "the client," : role} on ${keys.join(", ")}${lasts}: ${got.link}`);
    log("The link works once, for a week. Send it to them alone; it signs in whoever opens it first.");
    return 0;
  }
  if (sub === "revoke" && args[0]) {
    await admin("/__team/revoke", { name: args[0] });
    log(`${args[0]} can no longer sign in, and any link of theirs not used yet is gone.`);
    return 0;
  }
  if (sub === "members") {
    const { got } = await admin("/__team/members");
    if (!got.members.length) log("No one has joined yet. npx wf team invite <name> --role <role> makes a link.");
    for (const m of got.members) log(`${m.name.padEnd(16)} ${(m.client ? "client" : m.role).padEnd(12)} ${m.projects.join(",").padEnd(16)} ${m.revoked ? `revoked ${m.revoked.slice(0, 10)}` : m.expires ? `until ${m.expires.slice(0, 10)}` : ""}${m.admin ? " admin" : ""}`);
    return 0;
  }
  log(USAGE);
  return 2;
}
