// Open questions on a team server: a question left for later, for a role,
// is published as a page of its own for that role, so it is answered while
// its asker's branch is still open, not after it merges.
//
//   wf ask record <id>       (with teamServer) publishes each new open question, as page oq-<q-id>
//   wf question inbox        the asks on the team server waiting on you, open questions first
//   wf question pull         answers to this branch's published questions, noted under each in the log
//   wf question publish <Q-ID>   send an open question to the server again, as when record could not
//
// The pages published are kept in .cache/view/team-questions.json, so pull
// asks only for them, and brings each answer in once.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildPage } from "../ask/page.mjs";
import { LIMITS } from "../ask/advice.mjs";
import { loadConfig, projectRoot } from "../config/config.mjs";
import { localToday } from "../docs/check.mjs";
import { writeWhole } from "../files.mjs";
import { noteAnswer, questionRows } from "../logs/questions.mjs";
import { kindsFor } from "../view/kinds.mjs";
import { VIEW_DIR } from "../view/view.mjs";
import { call, pageState, publishPage, teamFor } from "./client.mjs";

const keptFile = (view) => join(view, "team-questions.json");
const readKept = (view) => {
  try {
    return existsSync(keptFile(view)) ? JSON.parse(readFileSync(keptFile(view), "utf8")) : {};
  } catch {
    return {};
  }
};
const clip = (text, most) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > most ? `${s.slice(0, most - 1)}…` : s;
};
/** The page id of an open question: oq-q-031 for Q-031. */
export const questionPage = (qid) => `oq-${qid.toLowerCase()}`;

/**
 * Publish an open question to the team server as a page for its role: the
 * question, with the options it was asked with and the asker's note, and a
 * box for the answer. Gives the page's address.
 */
export async function publishQuestion({ root, view, config, kinds, team }, { qid, role, question, note, from }) {
  const options = (question.options ?? []).map((o) => (o.why ? `${o.label} (${o.why})` : o.label)).join("; ");
  const detail = clip([options ? `Asked with: ${options}.` : "", note ? `Note: ${note}` : "", from ? `From ${from}.` : ""].filter(Boolean).join(" "), LIMITS.detail);
  const raw = {
    id: questionPage(qid),
    title: clip(`${qid}: ${question.text}`, 100),
    intro: `An open question left for later, for the ${role}. Answer it here; it reaches whoever asked, before their work merges.`,
    for: [role],
    questions: [{ id: "answer", text: clip(question.text, LIMITS.text), type: "text", role, ...(detail ? { detail } : {}) }],
  };
  const { spec } = buildPage(root, view, raw, kinds, {}, { ctx: { config } });
  const address = await publishPage(team, view, spec, { kinds, config, name: config.project?.name || team.project });
  const kept = readKept(view);
  kept[qid] = { page: spec.id, role, at: new Date().toISOString(), pulled: null };
  writeWhole(keptFile(view), `${JSON.stringify(kept, null, 2)}\n`);
  return address;
}

/** `wf question inbox | pull`, on the project's team server; resolves to the exit code. */
export async function runTeamQuestion([sub, ...args], log = console.log) {
  const root = projectRoot();
  const config = loadConfig(root);
  const team = teamFor(config);
  if (!team) {
    log("This project names no team server; set teamServer.url in .workflow/config.json.");
    return 2;
  }
  const view = join(root, VIEW_DIR);
  if (sub === "inbox") {
    const items = ((await call(team, "/__hub/inbox")).items ?? []).filter((i) => i.forYou && i.state !== "answered" && i.state !== "status" && i.key === team.project);
    if (!items.length) log("Nothing on the team server waits on you.");
    // Open questions first, then the other asks for you.
    for (const i of [...items.filter((x) => x.id.startsWith("oq-")), ...items.filter((x) => !x.id.startsWith("oq-"))]) log(`${i.title}  ${team.server}${i.href}`);
    return 0;
  }
  if (sub === "pull") {
    const kept = readKept(view);
    const open = new Set(questionRows(existsSync(join(root, config.logs.openQuestions)) ? readFileSync(join(root, config.logs.openQuestions), "utf8") : "").map((r) => r.id));
    let brought = 0;
    for (const [qid, entry] of Object.entries(kept)) {
      if (entry.pulled || !open.has(qid)) continue;
      const s = await pageState(team, entry.page);
      if (s.state !== "answered" && s.state !== "partial") continue;
      const value = s.answers?.answers?.answer ?? {};
      const said = value.text || value.note || (value.decide === "agent" ? "left it to the agent" : value.decide === "later" ? "left it for later again" : "");
      if (!said) continue;
      const by = s.answers?.by?.answer ?? "someone";
      noteAnswer(root, config, qid, `Answer (${by}, on the team server, ${localToday()}): ${said}`);
      entry.pulled = new Date().toISOString();
      // Kept at once, so a later question's failure never brings this answer in twice.
      writeWhole(keptFile(view), `${JSON.stringify(kept, null, 2)}\n`);
      brought++;
      log(`${qid}: ${by} answered: “${clip(said, 300)}”. Make it a decision, then npx wf question resolve ${qid} "<D-ID>".`);
    }
    writeWhole(keptFile(view), `${JSON.stringify(kept, null, 2)}\n`);
    if (!brought) log("No new answers to this branch's open questions on the team server.");
    return 0;
  }
  if (sub === "publish" && /^Q-\d+$/.test(String(args[0] ?? ""))) {
    const qid = args[0];
    const text = existsSync(join(root, config.logs.openQuestions)) ? readFileSync(join(root, config.logs.openQuestions), "utf8") : "";
    const row = questionRows(text).find((r) => r.id === qid);
    if (!row) throw new Error(`${qid} is not in ${config.logs.openQuestions}`);
    const address = await publishQuestion({ root, view, config, kinds: kindsFor(config), team }, { qid, role: row.needs, question: { text: row.question, options: [] }, note: "", from: row.from });
    log(`${qid}: on the team server for ${row.needs}, at ${address}`);
    return 0;
  }
  log("Usage: wf question inbox | pull | publish <Q-ID>   (with a team server)");
  return 2;
}
