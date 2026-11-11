// Who decides what. Rules and skills name a role; the config's `people` say who
// holds it, and `decisions` says which role answers each kind of choice. The
// "Who decides" block in AGENTS.md is written from these, so an agent knows
// whom to ask without running anything.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BLOCK_START = "<!-- wf:roles -->";
export const BLOCK_END = "<!-- /wf:roles -->";

/** The role part of `developer:frontend`. */
const base = (role) => role.split(":")[0];

/** Each problem with the people, roles, and decisions in a config. */
export function roleProblems(config) {
  const known = new Set(config.roles);
  const problems = [];
  for (const person of config.people) {
    if (!person.name) problems.push("people: a person has no name");
    for (const role of person.roles ?? []) {
      if (!known.has(base(role))) problems.push(`people: ${person.name} holds ${role}, which is not one of ${config.roles.join(", ")}`);
    }
  }
  for (const [kind, value] of Object.entries(config.decisions)) {
    for (const role of [value].flat()) {
      if (!known.has(base(role))) problems.push(`decisions: ${kind} goes to ${role}, which is not one of ${config.roles.join(", ")}`);
    }
  }
  if (config.team === "solo" && config.people.length > 1) problems.push('team: "solo" names more than one person');
  if (config.team !== "solo") {
    for (const role of config.roles) {
      if (!holders(config, role).length) problems.push(`roles: nobody holds ${role}`);
    }
  }
  return problems;
}

/** The people who hold a role. Solo gives the one person every role; plain `developer` covers every specialty. */
export function holders(config, role) {
  if (config.team === "solo") return config.people.slice(0, 1);
  return config.people.filter((person) =>
    (person.roles ?? []).some((held) => held === role || held === base(role) || (!role.includes(":") && base(held) === role)),
  );
}

/** Names joined for a sentence: "Ana", "Ana and Bo", "Ana, Bo, and Cy". */
const join = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`);

/** The "Who decides" block for AGENTS.md, between its markers. */
export function rolesBlock(config) {
  const lines = [BLOCK_START, "## Who decides", ""];
  const identity = (person) => {
    if (person.handle) return ` Their git identity is \`${person.handle}${person.email ? ` <${person.email}>` : ""}\`.`;
    // Someone who never commits, such as a designer in a design tool, has an email but no handle.
    return person.email ? ` They work outside the repo; their email is \`${person.email}\`.` : "";
  };
  if (config.team === "solo") {
    const person = config.people[0];
    lines.push(
      `Solo: ${person?.name ?? "the one person"} holds every role (${config.roles.join(", ")}), so every question, verdict, and yes goes to ${person?.name ?? "them"}.${person ? identity(person) : ""} Rules name the role, and this block says who holds it.`,
    );
  } else {
    lines.push("Rules name a role. Ask the person who holds it; when they are not in the session, ask the driver and record `needs <role>`.", "");
    lines.push("| Role | People |", "| --- | --- |");
    for (const role of config.roles) lines.push(`| ${role} | ${join(holders(config, role).map((p) => p.name)) || "nobody"} |`);
    lines.push("", "| Decision | Role |", "| --- | --- |");
    for (const [kind, value] of Object.entries(config.decisions)) lines.push(`| ${kind} | ${[value].flat().join(" and ")} |`);
    const ids = config.people.filter((p) => p.handle || p.email);
    if (ids.length) lines.push("", ...ids.map((p) => `- **${p.name}.**${identity(p)}`));
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

/** `text` with its block replaced by `block`; null when the text has no block markers. */
export function withBlock(text, block) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start < 0 || end < start) return null;
  return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
}

/** `wf roles --write`: write the Who decides block into each always-read file that has its markers. One line a file. */
export function writeRoles(root, config) {
  const block = rolesBlock(config);
  const lines = [];
  for (const place of config.growth.always) {
    const file = path.join(root, place);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const fresh = withBlock(text, block);
    if (fresh === null) lines.push({ error: true, text: `${place}: no ${BLOCK_START} and ${BLOCK_END} markers, so nothing was written` });
    else if (fresh !== text) {
      writeFileSync(file, fresh);
      lines.push({ text: `${place}: Who decides updated` });
    } else lines.push({ text: `${place}: Who decides already up to date` });
  }
  return lines;
}
