// `wf signoffs`: the questions this branch still waits on, so no merge is
// proposed past one (W-12). In the open questions log, each row under a
// chunk's heading waits on the role in its Needs cell until it is resolved and
// moved out; a row under "Not tied to a chunk yet" blocks no chunk, so no
// merge. In the pull request's body, a question is a line
// `- [ ] needs <role>: <question>`, ticked `- [x]` once it is answered. In a
// solo project the driver holds every role, so nothing is ever waiting.

import { blockingRows } from "./questions.mjs";

const NEEDS = /^\s*[-*]\s+\[( |x|X)\]\s+needs\s+([a-z][a-z-]*(?::[a-z-]+)?)\s*:\s*(.+)$/;

/** The open `needs` lines and chunk question rows in a text, each with its role and question. */
export function openNeeds(text, source) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.match(NEEDS))
    .filter((match) => match && match[1] === " ")
    .map((match) => ({ role: match[2], question: match[3].trim(), source }));
  const rows = blockingRows(text).map((row) => ({ role: row.role, question: `${row.id} ${row.question} (${row.heading})`, source }));
  return [...lines, ...rows];
}

/** The lines to print and the exit code, for the texts that may hold needs. */
export function signoffs(config, texts) {
  if (config.team === "solo") return { lines: ["Solo: the one person holds every role, so nothing waits on a sign-off."], code: 0 };
  const open = texts.flatMap(([source, text]) => openNeeds(text, source));
  if (open.length === 0) return { lines: ["No open sign-offs."], code: 0 };
  const lines = open.map((need) => {
    const who = (config.people ?? []).filter((person) => (person.roles ?? []).some((role) => role === need.role || need.role.startsWith(`${role}:`) || role.startsWith(`${need.role}:`))).map((person) => person.name);
    return `${need.source}: needs ${need.role} (${who.join(", ") || "nobody holds it"}): ${need.question}`;
  });
  return { lines: [...lines, `${open.length} open: no merge until each is answered, and resolved or ticked.`], code: 1 };
}
