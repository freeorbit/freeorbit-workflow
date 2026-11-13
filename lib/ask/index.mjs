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
//   wf view serve [--port <n>]         make sure the shared question-pictures server runs, and stay with it
//   wf view stop                       stop the shared server
//   wf view setup                      write or update the server in .claude/launch.json

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { loadConfig, projectRoot } from "../config/config.mjs";
import { localToday } from "../docs/check.mjs";
import { KIT_ROOT } from "../setup/ai.mjs";
import { kindsFor } from "../design/annotate.mjs";
import { VIEW_DIR, VIEW_PORT, viewAddress, withViewServer } from "../design/view.mjs";
import { answersMarkdown, checkAnswers, recordAnswers } from "./answers.mjs";
import { buildPage, exportHtml, readAnswers } from "./page.mjs";
import { answersPath, askDir, readSpec, serve, writeWhole } from "./serve.mjs";
import { asker, ensureHub, hubUp, projects, register, stateDir } from "./hub.mjs";
import { claudeTheme } from "./claudetheme.mjs";
import { checkTemplate, TEMPLATES } from "./spec.mjs";

export const EXAMPLES = join(KIT_ROOT, "plugins", "core", "skills", "ask-page", "examples");
export const PROJECT_TEMPLATES = ".workflow/ask-templates";

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
       wf view serve [--port <n>] | stop | setup`;
const PKG = JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8"));
// Tests and CI build pages with no server to start.
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

/** `wf ask ...`; resolves to the exit code. */
export async function runAsk([sub, ...args], log = console.log) {
  if (sub === "templates") {
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
  if (sub === "example" && args[0]) {
    if (!TEMPLATES[args[0]]) {
      log(`No template ${args[0]}; npx wf ask templates lists them.`);
      return 2;
    }
    log(readFileSync(join(EXAMPLES, `${args[0]}.json`), "utf8").trimEnd());
    return 0;
  }
  if (!["page", "wait", "answers", "record", "export", "import"].includes(sub) || !args[0]) {
    log(USAGE);
    return 2;
  }
  const { root, config, view, kinds, custom } = context();
  if (sub === "page") {
    const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
    if (custom.problems.length && !TEMPLATES[raw?.template ?? "decision"]) throw new Error(`the project's templates are not right:\n- ${custom.problems.join("\n- ")}`);
    const who = asker(root);
    // Another session's page that is still waiting is never replaced without --replace.
    const before = readSpec(view, raw?.id);
    if (before && !args.includes("--replace") && before.asker?.session && who.session && before.asker.session !== who.session) {
      const answered = existsSync(answersPath(view, before.id)) && statSync(answersPath(view, before.id)).mtimeMs > statSync(join(askDir(view, before.id), "spec.json")).mtimeMs;
      if (!answered) throw new Error(`another session (${before.asker.session}) is still waiting on the ask page ${before.id}; give this one another id, or pass --replace`);
    }
    const key = register(root);
    const { page, spec, kept } = buildPage(root, view, raw, kinds, custom.templates, { asker: who, key });
    log(`${relative(root, page)}: ${spec.questions.length} questions (${spec.template})${kept ? ", with the answers sent before" : ""}`);
    if (!noServer()) await ensureHub();
    log(`Open: ${viewAddress(root, page)}`);
    log(`Every ask, from every session: http://127.0.0.1:${VIEW_PORT}/`);
    log(`Next: open the address in the browser pane, then run npx wf ask wait ${spec.id} in the background.`);
    return 0;
  }
  const id = args[0];
  if (sub === "import") {
    const raw = answersFromText(readFileSync(args[0], "utf8"));
    const spec = specOrFail(view, raw?.id);
    const { answers, problems } = checkAnswers(spec, raw, kinds);
    if (problems) {
      for (const problem of problems) log(problem);
      return 1;
    }
    mkdirSync(join(view, "answers"), { recursive: true });
    writeWhole(answersPath(view, spec.id), `${JSON.stringify(answers, null, 2)}\n`);
    log(answersMarkdown(spec, answers).trimEnd());
    return 0;
  }
  const spec = specOrFail(view, id);
  if (sub === "wait") {
    const timeout = Number(flag(args, "--timeout") ?? 0) * 1000;
    const asked = statSync(join(askDir(view, id), "spec.json")).mtimeMs;
    const file = answersPath(view, id);
    const start = Date.now();
    let checked = 0;
    for (;;) {
      // The page can send only while the server runs; start it again if it stopped.
      if (!noServer() && Date.now() - checked > 10000) {
        checked = Date.now();
        if (!(await hubUp())) await ensureHub().catch((err) => log(err.message));
      }
      // Answers count once sent after the page was built: building it is asking again.
      if (existsSync(file) && statSync(file).mtimeMs > asked) {
        const answers = readAnswers(view, id);
        if (answers?.hash === spec.hash) {
          log(answersMarkdown(spec, answers).trimEnd());
          return 0;
        }
      }
      if (timeout && Date.now() - start > timeout) {
        log(`No answers to ${id} after ${timeout / 1000} s.`);
        return 3;
      }
      await sleep(500);
    }
  }
  const answers = readAnswers(view, id);
  if (sub === "answers") {
    if (args.includes("--json")) log(JSON.stringify(answers ?? null, null, 2));
    else log(answersMarkdown(spec, answers?.hash === spec.hash ? answers : null).trimEnd());
    return 0;
  }
  if (sub === "record") {
    if (!answers || answers.hash !== spec.hash) {
      log(`No answers to the page ${id} as it is now.`);
      return 1;
    }
    const lines = recordAnswers(root, config, spec, answers, localToday());
    for (const line of lines) log(line);
    if (!lines.length) log("Nothing to record: no question was left for later, and none names a decisions file in record.");
    return lines.some((line) => line.includes("not recorded")) ? 1 : 0;
  }
  if (sub === "export") {
    const out = flag(args, "--out") ?? join(askDir(view, id), "export");
    mkdirSync(out, { recursive: true });
    const now = answers?.hash === spec.hash ? answers : null;
    writeFileSync(join(out, `${id}.html`), exportHtml(view, spec, kinds, now));
    writeFileSync(join(out, `${id}.md`), answersMarkdown(spec, now));
    writeFileSync(join(out, `${id}.answers.json`), `${JSON.stringify(now, null, 2)}\n`);
    log(`${relative(root, out) || out}: ${id}.html (one file, pictures inside; answered offline, it saves an answers file for npx wf ask import), ${id}.md, ${id}.answers.json`);
    return 0;
  }
  return 2;
}

/** `wf view ...`; serve resolves only when the server stops. */
export async function runView([sub, ...args], log = console.log) {
  if (sub === "setup") {
    const root = projectRoot();
    const file = join(root, ".claude", "launch.json");
    const before = existsSync(file) ? readFileSync(file, "utf8") : null;
    const after = withViewServer(before);
    if (after === before) {
      log(".claude/launch.json already has the question-pictures server.");
      return 0;
    }
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(file, after);
    log(".claude/launch.json: the question-pictures server is now npx wf view serve");
    return 0;
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
    // The shared server itself: every registered project, read on each request.
    const kindsOf = new Map();
    const find = (key) => {
      const project = projects()[key];
      if (!project) return null;
      if (!kindsOf.has(project.root)) {
        try {
          kindsOf.set(project.root, kindsFor(loadConfig(project.root)));
        } catch (err) {
          log(`${project.root}: ${err.message}`);
          return null;
        }
      }
      return { ...project, kinds: kindsOf.get(project.root) };
    };
    let stop = () => {};
    const running = await serve({ resolve: find, list: () => Object.values(projects()), port, log, version: PKG.version, idleMs: 12 * 3600 * 1000, onStop: () => stop(), theme: () => claudeTheme() });
    const file = join(stateDir(), "view-hub.json");
    mkdirSync(stateDir(), { recursive: true });
    writeWhole(file, `${JSON.stringify({ pid: process.pid, port: running.port, token: running.token, version: PKG.version })}\n`);
    chmodSync(file, 0o600);
    return new Promise((done) => {
      stop = () => running.close().then(() => done(0));
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    });
  }
  // From .claude/launch.json: register this project, make sure the shared
  // server runs, and stay while it does, so the browser pane sees a live server.
  register(projectRoot());
  const hub = await ensureHub({ port });
  log(`question-pictures: the shared server (pid ${hub.pid}) serves http://127.0.0.1:${port}/ — every ask, from every session.`);
  for (;;) {
    await sleep(5000);
    if (!(await hubUp(port))) {
      log("question-pictures: the shared server stopped; starting it again.");
      await ensureHub({ port });
    }
  }
}
