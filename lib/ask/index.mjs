// `wf ask` and `wf view`: ask a person on a page beside the chat, and serve it.
//
//   wf ask templates                   the templates, what each is for
//   wf ask example <template>          an example spec to start from
//   wf ask page <spec.json | ->        build the page; prints its address
//   wf ask wait <id> [--timeout <s>]   block until the page's answers are sent; prints them
//   wf ask answers <id> [--json]       the answers saved so far
//   wf ask record <id>                 "later" answers to the open questions, recorded choices to the decisions log
//   wf ask export <id> [--out <dir>]   the page as one HTML file, with the answers as JSON and Markdown
//   wf ask import <answers.json>       answers sent back from an exported page, or pasted from the chat
//   wf ask live <id> [--state s] [--step "…"] [--progress 3/8] [--log "…"] [--blocks <file | ->] [--clear]
//                                      update a live page while a step runs; it redraws in place
//   wf ask reply <id> <question> <text>   the agent's reply under a question; the page waits for a send again
//   wf ask history [<id>] [--json]     every ask with answers kept, or one page's rounds as Markdown
//   wf view serve [--port <n>]         make sure the shared question-pictures server runs, and stay with it
//   wf view stop                       stop the shared server
//   wf view notify                     send one desktop notification, and say what to check if none shows
//   wf view setup                      write or update the server in .claude/launch.json

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { loadConfig, projectRoot } from "../config/config.mjs";
import { localToday } from "../docs/check.mjs";
import { KIT_ROOT } from "../setup/ai.mjs";
import { desktopCommand, desktopHelp, desktopNotifier } from "../view/desktop.mjs";
import { kindsFor } from "../view/kinds.mjs";
import { VIEW_DIR, VIEW_PORT, viewAddress, viewEntry, withViewServer } from "../view/view.mjs";
import { answersMarkdown, askState, checkAnswers, recordAnswers } from "./answers.mjs";
import { addReply, everyAsk, historyMarkdown, keepRound, readLive, readReplies, rounds, updateLive, writeLive } from "./live.mjs";
import { buildPage, exportHtml, readAnswers } from "./page.mjs";
import { answersPath, askDir, readSpec, serve, writeWhole } from "../view/serve.mjs";
import { asker, ensureHub, hubUp, projects, register, startHub, stateDir } from "../view/hub.mjs";
import { claudePalettes, claudeTheme } from "./claudetheme.mjs";
import { sourcesFor } from "./sources.mjs";
import { checkTemplate, TEMPLATES } from "./spec.mjs";

export const EXAMPLES = join(KIT_ROOT, "plugins", "core", "skills", "ask-page", "examples");
export const PROJECT_TEMPLATES = ".workflow/ask-templates";
export const PROJECT_PARTS = ".workflow/ask-parts";

/** The project's parts, by name: each a block list kept as data, or `{ blocks }`. Problems name a file that is not right. */
export function projectParts(root) {
  const dir = join(root, PROJECT_PARTS);
  const parts = {};
  const problems = [];
  if (!existsSync(dir)) return { parts, problems };
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const name = file.replace(/\.json$/, "");
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const blocks = Array.isArray(raw) ? raw : raw?.blocks;
      if (!Array.isArray(blocks)) problems.push(`${PROJECT_PARTS}/${file}: a part is a list of blocks, or { "blocks": [...] }`);
      else parts[name] = blocks;
    } catch (err) {
      problems.push(`${PROJECT_PARTS}/${file}: not JSON (${err.message})`);
    }
  }
  return { parts, problems };
}

/** The project's own templates, by name, and the problems with any that are not right. */
export function projectTemplates(root) {
  const dir = join(root, PROJECT_TEMPLATES);
  const out = {};
  const problems = [];
  if (!existsSync(dir)) return { templates: out, problems };
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      problems.push(`${PROJECT_TEMPLATES}/${file}: not JSON (${err.message})`);
      continue;
    }
    const { template, problems: found } = checkTemplate(raw, `${PROJECT_TEMPLATES}/${file}`);
    if (found) problems.push(...found);
    else if (out[template.name]) problems.push(`${PROJECT_TEMPLATES}/${file}: ${template.name} is named twice`);
    else out[template.name] = template;
  }
  return { templates: out, problems };
}
const USAGE = `Usage: wf ask templates | example <template> | page <spec.json | -> | wait <id> [--timeout <s>]
       wf ask answers <id> [--json] | record <id> | export <id> [--out <dir>] | import <answers.json>
       wf ask live <id> [--state running|waiting|done|failed] [--step <text>] [--progress <n>/<of>] [--log <line>] [--blocks <file | ->] [--clear]
       wf ask reply <id> <question> <text> | history [<id>] [--json]
       wf view serve [--port <n>] | stop | setup | notify`;
const PKG = JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8"));
const noServer = () => process.env.WF_ASK_NO_SERVER === "1";

const flag = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function context() {
  const root = projectRoot();
  const config = loadConfig(root);
  return { root, config, view: join(root, VIEW_DIR), kinds: kindsFor(config), custom: projectTemplates(root) };
}

function specOrFail(view, id) {
  const spec = readSpec(view, id);
  if (!spec) throw new Error(`no ask page ${id}; build it with npx wf ask page <spec.json>`);
  return spec;
}

/** Pull the answers JSON out of what the page's Copy answers gives, or a plain file. */
export function answersFromText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : text);
}

/** `wf ask templates`: the kit's templates and the project's own. */
function listTemplates(args, log) {
  for (const [name, t] of Object.entries(TEMPLATES)) log(`${name.padEnd(13)} ${t.use} (${t.items}, ${t.layout})`);
  log(`Start from an example: npx wf ask example <template>. They are in ${relative(process.cwd(), EXAMPLES) || EXAMPLES}.`);
  let custom = { templates: {}, problems: [] };
  try {
    custom = projectTemplates(projectRoot());
  } catch {
    // Outside a project there are only the kit's.
  }
  const own = Object.values(custom.templates);
  if (own.length) log(`\nThis project's, in ${PROJECT_TEMPLATES}:`);
  for (const t of own) log(`${t.name.padEnd(13)} ${t.use} (${t.items}, ${t.layout})`);
  for (const problem of custom.problems) log(problem);
  return custom.problems.length ? 1 : 0;
}

function example([name], log) {
  if (!TEMPLATES[name]) {
    log(name ? `No template ${name}; npx wf ask templates lists them.` : USAGE);
    return 2;
  }
  log(readFileSync(join(EXAMPLES, `${name}.json`), "utf8").trimEnd());
  return 0;
}

/** `wf ask page`: build it, start the shared server, and say where it is. */
async function page(c, args, log) {
  const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
  if (c.custom.problems.length && !TEMPLATES[raw?.template ?? "decision"]) throw new Error(`the project's templates are not right:\n- ${c.custom.problems.join("\n- ")}`);
  const who = asker(c.root);
  // Another session's page that is not yet answered is never replaced without --replace.
  const before = readSpec(c.view, raw?.id);
  if (before && !args.includes("--replace") && before.asker?.session && who.session && before.asker.session !== who.session && askState(c.view, before.id, before).state !== "answered") {
    throw new Error(`another session (${before.asker.session}) is still waiting on the ask page ${before.id}; give this one another id, or pass --replace`);
  }
  const key = register(c.root);
  const parts = projectParts(c.root);
  for (const problem of parts.problems) log(problem);
  // What the spec checks read: the config (for ask.off), the project's parts, and the named sources.
  const ctx = { config: c.config, parts: parts.parts, source: sourcesFor(c.root, c.config) };
  const { page: file, spec, kept, advice } = buildPage(c.root, c.view, raw, c.kinds, c.custom.templates, { asker: who, key, ctx });
  log(`${relative(c.root, file)}: ${spec.questions.length} questions (${spec.template})${kept ? ", with the answers sent before" : ""}`);
  // Advice on grouping and pictures: the page is built; change the spec and build it again if it helps.
  for (const line of advice) log(`${line}.`);
  await startHub(c.root, { register: false });
  log(`Open: ${viewAddress(c.root, file)}`);
  log(`Every ask, from every session: http://127.0.0.1:${VIEW_PORT}/`);
  log(`Next: open the address in the browser pane, then run npx wf ask wait ${spec.id} in the background.`);
  return 0;
}

/** `wf ask import`: answers from an exported page, or pasted from the chat. */
function importAnswers(c, [file], log) {
  const raw = answersFromText(readFileSync(file, "utf8"));
  const spec = specOrFail(c.view, raw?.id);
  const { answers, problems } = checkAnswers(spec, raw, c.kinds);
  if (problems) {
    for (const problem of problems) log(problem);
    return 1;
  }
  mkdirSync(join(c.view, "answers"), { recursive: true, mode: 0o700 });
  writeWhole(answersPath(c.view, spec.id), `${JSON.stringify(answers, null, 2)}\n`);
  keepRound(c.view, spec, answers);
  log(answersMarkdown(spec, answers, readReplies(c.view, spec.id)).trimEnd());
  return 0;
}

/** `wf ask live`: lay an update over a live page's status; the open page redraws it. */
function live(c, args, log) {
  const id = args[0];
  const spec = specOrFail(c.view, id);
  if (!spec.live) throw new Error(`the page ${id} is not live; give its spec "live": true, or use the status template, and build it again`);
  const all = (name) => args.flatMap((a, i) => (a === name && args[i + 1] != null ? [args[i + 1]] : []));
  const blocksArg = flag(args, "--blocks");
  const change = {
    state: flag(args, "--state"),
    step: flag(args, "--step"),
    progress: flag(args, "--progress")?.split("/"),
    log: all("--log"),
    clear: args.includes("--clear"),
    blocks: blocksArg == null ? undefined : JSON.parse(blocksArg === "-" ? readFileSync(0, "utf8") : readFileSync(blocksArg, "utf8")),
  };
  if (change.blocks && !Array.isArray(change.blocks)) change.blocks = change.blocks.blocks;
  const parts = projectParts(c.root);
  const { live: next, problems } = updateLive(readLive(c.view, id), change, { off: new Set(spec.off ?? []), parts: parts.parts, source: sourcesFor(c.root, c.config) });
  if (problems.length) {
    for (const problem of problems) log(problem);
    return 1;
  }
  writeLive(c.view, id, next);
  log(`${id}: ${next.state}${next.step ? `, ${next.step}` : ""}${next.progress ? ` (${next.progress[0]} of ${next.progress[1]})` : ""}`);
  return 0;
}

/** `wf ask reply`: the agent's reply under one question. */
function reply(c, [id, question, ...words], log) {
  const spec = specOrFail(c.view, id);
  if (spec.off?.includes("replies")) throw new Error(`replies are turned off on the page ${id}`);
  const n = addReply(c.view, spec, question, words.join(" "));
  log(`${id}: replied under ${question} (${n} ${n === 1 ? "reply" : "replies"}). The page waits for a send again; run npx wf ask wait ${id}.`);
  return 0;
}

/** `wf ask history`: every ask with answers kept, or one page's rounds. */
function history(c, args, log) {
  const id = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (!id) {
    const all = everyAsk(c.view);
    if (args.includes("--json")) log(JSON.stringify(all, null, 2));
    else if (!all.length) log("No answers kept yet. Each send to an ask page keeps a round here.");
    else for (const a of all) log(`${a.id.padEnd(28)} ${String(a.rounds).padStart(3)} ${a.rounds === 1 ? "round " : "rounds"}  last ${a.last.replace("T", " ").slice(0, 16)}  ${a.title}`);
    return 0;
  }
  log(args.includes("--json") ? JSON.stringify(rounds(c.view, id), null, 2) : historyMarkdown(c.view, id).trimEnd());
  return 0;
}

/** `wf ask wait`: until the page is answered, in part or whole, after it was built. */
async function wait(c, args, log) {
  const id = args[0];
  const spec = specOrFail(c.view, id);
  const timeout = Number(flag(args, "--timeout") ?? 0) * 1000;
  const start = Date.now();
  let checked = 0;
  for (;;) {
    // The page can send only while the server runs; start it again if it stopped.
    if (Date.now() - checked > 10000) {
      checked = Date.now();
      if (!noServer() && !(await hubUp())) await startHub(c.root, { register: false }).catch((err) => log(err.message));
    }
    const now = askState(c.view, id, spec);
    if (now.state === "status") {
      log(`${id} is a status page; it has no questions to wait for.`);
      return 0;
    }
    if (now.state !== "waiting") {
      log(answersMarkdown(spec, now.answers, readReplies(c.view, id)).trimEnd());
      return 0;
    }
    if (timeout && Date.now() - start > timeout) {
      log(`No answers to ${id} after ${timeout / 1000} s.`);
      return 3;
    }
    await sleep(500);
  }
}

/** The answers to the page as it is now, or null. */
function current(c, id) {
  const spec = specOrFail(c.view, id);
  const answers = readAnswers(c.view, id);
  return { spec, answers: answers?.hash === spec.hash ? answers : null, raw: answers };
}

function showAnswers(c, args, log) {
  const { spec, answers, raw } = current(c, args[0]);
  log(args.includes("--json") ? JSON.stringify(raw ?? null, null, 2) : answersMarkdown(spec, answers, readReplies(c.view, spec.id)).trimEnd());
  return 0;
}

function record(c, [id], log) {
  const { spec, answers } = current(c, id);
  if (!answers) {
    log(`No answers to the page ${id} as it is now.`);
    return 1;
  }
  const lines = recordAnswers(c.root, c.config, spec, answers, localToday());
  for (const line of lines) log(line);
  if (!lines.length) log("Nothing to record: no question was left for later, and none names a decisions file in record.");
  return lines.some((line) => line.includes("not recorded")) ? 1 : 0;
}

function exportPage(c, args, log) {
  const id = args[0];
  const { spec, answers } = current(c, id);
  const out = flag(args, "--out") ?? join(askDir(c.view, id), "export");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.html`), exportHtml(c.view, spec, c.kinds, answers));
  writeFileSync(join(out, `${id}.md`), answersMarkdown(spec, answers));
  writeFileSync(join(out, `${id}.answers.json`), `${JSON.stringify(answers, null, 2)}\n`);
  const kept = rounds(c.view, id).length;
  if (kept) writeFileSync(join(out, `${id}.history.md`), historyMarkdown(c.view, id));
  const live = spec.live ? readLive(c.view, id) : null;
  if (live) writeFileSync(join(out, `${id}.status.json`), `${JSON.stringify(live, null, 2)}\n`);
  log(`${relative(c.root, out) || out}: ${id}.html (one file, pictures inside; answered offline, it saves an answers file for npx wf ask import), ${id}.md, ${id}.answers.json${kept ? `, ${id}.history.md (${kept} ${kept === 1 ? "round" : "rounds"})` : ""}${live ? `, ${id}.status.json` : ""}`);
  return 0;
}

const IN_PROJECT = { page, wait, answers: showAnswers, record, export: exportPage, import: importAnswers, live, reply, history };

/** `wf ask ...`; resolves to the exit code. */
export async function runAsk([sub, ...args], log = console.log) {
  if (sub === "templates") return listTemplates(args, log);
  if (sub === "example") return example(args, log);
  const run = Object.hasOwn(IN_PROJECT, sub) ? IN_PROJECT[sub] : null;
  if (!run || (!args[0] && sub !== "history")) {
    log(USAGE);
    return 2;
  }
  return run(context(), args, log);
}

/** `wf view ...`; serve resolves only when the server stops. */
export async function runView([sub, ...args], log = console.log) {
  if (sub === "setup") {
    const root = projectRoot();
    const file = join(root, ".claude", "launch.json");
    const before = existsSync(file) ? readFileSync(file, "utf8") : null;
    const after = withViewServer(before);
    if (after === before) {
      const { kind } = viewEntry(before ? JSON.parse(before) : null);
      log(kind === "own" ? ".claude/launch.json has a question-pictures entry of the project's own, so it is left alone; rename it, or make it run npx wf view serve." : ".claude/launch.json already has the question-pictures server.");
      return kind === "own" ? 1 : 0;
    }
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(file, after);
    log(".claude/launch.json: the question-pictures server is now npx wf view serve");
    return 0;
  }
  if (sub === "notify") {
    // One notification now, through the command the server uses, to see that it shows.
    const command = desktopCommand();
    if (command) {
      const { spawnSync } = await import("node:child_process");
      const ran = spawnSync(command.file, command.args("Workflow asks: a test", "Ask pages tell you here when an agent asks."), { encoding: "utf8", timeout: 10000 });
      log(ran.status === 0 ? `Sent a test notification with ${command.name} (${command.file}).` : `${command.name} failed: ${String(ran.stderr || ran.error?.message || `exit ${ran.status}`).trim()}`);
    }
    for (const line of desktopHelp(command)) log(line);
    return command ? 0 : 1;
  }
  if (sub === "stop") {
    const file = join(stateDir(), "view-hub.json");
    const hub = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const port = Number(flag(args, "--port") ?? hub?.port ?? VIEW_PORT);
    if (!(await hubUp(port))) {
      log("The question-pictures server is not running.");
      return 0;
    }
    const res = await fetch(`http://127.0.0.1:${port}/__hub/stop`, { method: "POST", headers: { "X-WF-Token": hub?.token ?? "" } }).catch(() => null);
    log(res?.ok ? "The question-pictures server stopped." : "The server did not stop: its token in the state folder is not the running one's.");
    return res?.ok ? 0 : 1;
  }
  if (sub !== "serve") {
    log(USAGE);
    return 2;
  }
  const port = Number(flag(args, "--port") ?? VIEW_PORT);
  if (args.includes("--hub")) {
    // The shared server itself: every registered project, read on each request,
    // and its comment kinds read again whenever its settings change.
    const kindsOf = new Map();
    const find = (key) => {
      const project = projects()[key];
      if (!project) return null;
      const file = join(project.root, ".workflow", "config.json");
      const stamp = existsSync(file) ? statSync(file).mtimeMs : 0;
      const known = kindsOf.get(project.root);
      if (!known || known.stamp !== stamp) {
        try {
          kindsOf.set(project.root, { stamp, kinds: kindsFor(loadConfig(project.root)), error: "" });
        } catch (err) {
          log(`${project.root}: ${err.message}`);
          kindsOf.set(project.root, { stamp, kinds: null, error: err.message });
        }
      }
      const { kinds, error } = kindsOf.get(project.root);
      return { ...project, kinds, error };
    };
    let stop = () => {};
    const running = await serve({ resolve: find, list: () => Object.values(projects()), check: checkAnswers, stateOf: askState, liveOf: readLive, repliesOf: readReplies, historyOf: (view, spec) => rounds(view, spec.id).map((r) => ({ at: r.at, hash: r.hash, same: r.hash === spec.hash, markdown: answersMarkdown(r.spec, r.answers) })), onAnswers: keepRound, port, log, version: PKG.version, idleMs: 12 * 3600 * 1000, onStop: () => stop(), theme: (id) => claudeTheme(process.env, id), themes: () => claudePalettes(), desktop: desktopNotifier({ log }) });
    const file = join(stateDir(), "view-hub.json");
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    writeWhole(file, `${JSON.stringify({ pid: process.pid, port: running.port, token: running.token, version: PKG.version })}\n`);
    return new Promise((done) => {
      stop = () => running.close().then(() => done(0));
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    });
  }
  // From .claude/launch.json: register this project, make sure the shared
  // server runs, and stay while it does, so the browser pane sees a live server.
  const hub = await startHub(projectRoot(), { port, force: true });
  log(`question-pictures: the shared server (pid ${hub.pid}) serves http://127.0.0.1:${port}/ — every ask, from every session.`);
  for (;;) {
    await sleep(5000);
    if (!(await hubUp(port))) {
      log("question-pictures: the shared server stopped; starting it again.");
      await ensureHub({ port });
    }
  }
}
