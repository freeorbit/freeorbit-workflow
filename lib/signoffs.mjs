// `wf signoffs`: the questions this branch still waits on, so no merge is
// proposed past one (W-12). A question waiting on someone who holds a role is
// a line `- [ ] needs <role>: <question>`, in the open questions log or the
// pull request's body, ticked `- [x]` once it is answered. In a solo project
// the driver holds every role, so nothing is ever waiting.

const NEEDS = /^\s*[-*]\s+\[( |x|X)\]\s+needs\s+([a-z][a-z-]*(?::[a-z-]+)?)\s*:\s*(.+)$/;

/** The open `needs` lines in a text, each with its role and question. */
export function openNeeds(text, source) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.match(NEEDS))
    .filter((match) => match && match[1] === " ")
    .map((match) => ({ role: match[2], question: match[3].trim(), source }));
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
  return { lines: [...lines, `${open.length} open: no merge until each is answered and ticked.`], code: 1 };
}
