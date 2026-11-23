// `wf ask`: ask a person on a page beside the chat. `wf view`, which serves
// the pages, is lib/view/command.mjs.
//
//   wf ask templates                   the templates, what each is for
//   wf ask example <template>          an example spec to start from, with stand-in pictures so it builds as it is
//   wf ask fields <part>               one template's, question type's, or block's fields and limits
//   wf ask page <spec.json | -> [--check]   build the page and print its address; --check only checks the spec
//   wf ask open <id>                   open the page where the person looks: Orca's browser, Claude's pane, or the system's (ask.open)
//   wf ask wait <id> [--timeout <s>]   block until the page's answers are sent; prints them
//   wf ask answers <id> [--all | --json]  the answers saved so far; --all lists the ones as recommended too
//   wf ask record <id>                 "later" answers to the open questions, recorded choices to the decisions log
//   wf ask export <id> [--out <dir>]   the page as one HTML file, with the answers as JSON and Markdown
//   wf ask import <answers.json>       answers sent back from an exported page, or pasted from the chat
//   wf ask live <id> [--state s] [--step "…"] [--progress 3/8] [--log "…"] [--blocks <file | ->] [--clear]
//                                      update a live page while a step runs; it redraws in place
//   wf ask reply <id> <question> <text>   the agent's reply under a question; the page waits for a send again
//   wf ask more <id> <question | --page> [--md <file | ->] [--text <words>] [--blocks <file | ->] [--option <json>]
//                                      more under a question the person asked about, in place; the draft stays
//   wf ask history [<id>] [--json]     every ask with answers kept, or one page's rounds as Markdown

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { loadConfig, projectRoot } from "../config/config.mjs";
import { localToday } from "../docs/check.mjs";
import { KIT_ROOT } from "../setup/ai.mjs";
import { desktopNotifier } from "../view/desktop.mjs";
import { kindsFor } from "../view/kinds.mjs";
import { VIEW_DIR, VIEW_PORT, viewAddress } from "../view/view.mjs";
import { answersMarkdown, askState, checkAnswers, recordAnswers } from "./answers.mjs";
import { addReply, everyAsk, historyMarkdown, keepRound, readLive, readReplies, rounds, updateLive, writeLive } from "./live.mjs";
import { buildPage, checkPage, exportHtml, readAnswers } from "./page.mjs";
import { fieldParts, fieldsOf } from "./fields.mjs";
import { placeholderPng } from "./placeholder.mjs";
import { writeWhole } from "../files.mjs";
import { serve } from "../view/serve.mjs";
import { answersPath, askDir, readSpec } from "./store.mjs";
import { asker, hubUp, keptToken, register, startHub } from "../view/hub.mjs";
import { clearWaiting, markWaiting, noticeDue, noticeText, tellWaiting } from "../view/waiting.mjs";
import { codeFile, sourcesFor } from "./sources.mjs";
import { addMore, askLines, markTold, moreBlocks, PAGE, pendingAsks, untoldAsks, withMore } from "./more.mjs";
import { checkTemplate, TEMPLATES } from "./templates.mjs";
import { flagValue, sleep } from "../process.mjs";
import { markUnread, openPage } from "../view/harness.mjs";

export const EXAMPLES = join(KIT_ROOT, "plugins", "core", "skills", "ask-page", "examples");
export const PROJECT_TEMPLATES = ".workflow/ask-templates";
// Where `wf ask example` writes its stand-in pictures: under the served folder, which a project does not commit.
export const EXAMPLE_PICTURES = ".cache/view/example-pictures";
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
const USAGE = `Usage: wf ask templates | example <template> | fields <part> | page <spec.json | -> [--check] | open <id> | wait <id> [--timeout <s>]
       wf ask answers <id> [--all | --json] | record <id> | export <id> [--out <dir>] | import <answers.json>
       wf ask live <id> [--state running|waiting|done|failed] [--step <text>] [--progress <n>/<of>] [--log <line>] [--blocks <file | ->] [--clear]
       wf ask reply <id> <question> <text> | history [<id>] [--json]
       wf ask more <id> <question | --page> [--md <file | ->] [--text <words>] [--blocks <file | ->] [--option <json>]...`;
const PKG = JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8"));
const noServer = () => process.env.WF_ASK_NO_SERVER === "1";

const flag = (args, name) => flagValue(args, name) ?? undefined;

function context() {
  const root = projectRoot();
  const config = loadConfig(root);
  return { root, config, view: join(root, VIEW_DIR), kinds: kindsFor(config), custom: projectTemplates(root) };
}

/** The page's spec, with the options the agent added since it was built. */
function specOrFail(view, id) {
  const spec = readSpec(view, id);
  if (!spec) throw new Error(`no ask page ${id}; build it with npx wf ask page <spec.json>`);
  return withMore(view, spec);
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
  let text = readFileSync(join(EXAMPLES, `${name}.json`), "utf8").trimEnd();
  // In a project, each picture the example names is a stand-in the kit writes under .cache/view, so the example builds as printed.
  let root = null;
  try {
    root = projectRoot();
  } catch {
    // Outside a project the example is printed as it is.
  }
  const images = [...new Set([...text.matchAll(/"image":\s*"([^"]+)"/g)].map((m) => m[1]))];
  if (root && images.length) {
    mkdirSync(join(root, EXAMPLE_PICTURES), { recursive: true });
    images.forEach((image, i) => {
      const file = `${EXAMPLE_PICTURES}/${image.split("/").pop()}`;
      if (!existsSync(join(root, file))) writeFileSync(join(root, file), placeholderPng(image, i));
      text = text.replaceAll(`"${image}"`, `"${file}"`);
    });
  }
  log(text);
  return 0;
}

/** `wf ask fields <part>`: one template's, question type's, or block's fields. */
function fields([part], log) {
  const lines = part ? fieldsOf(part) : null;
  if (!lines) {
    const parts = fieldParts();
    log(`Usage: wf ask fields <part>, one of\n  templates: ${parts.templates.join(", ")}\n  question types: ${parts.types.join(", ")}\n  blocks: ${parts.blocks.join(", ")}`);
    return part ? 2 : 0;
  }
  for (const line of lines) log(line);
  return 0;
}

/** `wf ask page`: build it, start the shared server, and say where it is. */
async function page(c, args, log) {
  const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
  if (c.custom.problems.length && !TEMPLATES[raw?.template ?? "decision"]) throw new Error(`the project's templates are not right:\n- ${c.custom.problems.join("\n- ")}`);
  if (args.includes("--check")) {
    const parts = projectParts(c.root);
    for (const problem of parts.problems) log(problem);
    const { spec, advice } = checkPage(c.root, raw, c.custom.templates, { config: c.config, parts: parts.parts, source: sourcesFor(c.root, c.config) });
    log(`${spec.id}: the spec is right, ${spec.questions.length} ${spec.questions.length === 1 ? "question" : "questions"} (${spec.template}). Nothing was built.`);
    for (const line of advice) log(`${line}.`);
    return 0;
  }
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
  log(`${relative(c.root, file)}: ${spec.questions.length} ${spec.questions.length === 1 ? "question" : "questions"} (${spec.template})${kept ? ", with the answers sent before" : ""}`);
  // Advice on grouping and pictures: the page is built; change the spec and build it again if it helps.
  for (const line of advice) log(`${line}.`);
  await startHub(c.root, { register: false });
  log(`Open: ${viewAddress(c.root, file)}`);
  log(`Every ask, from every session: http://127.0.0.1:${VIEW_PORT}/`);
  // A status page with no questions takes updates, never a wait.
  log(spec.questions.length ? `Next: npx wf ask open ${spec.id}, then npx wf ask wait ${spec.id} in the background.` : `Next: npx wf ask open ${spec.id}, then update it with npx wf ask live ${spec.id} --step "…" --progress 1/3.`);
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
  log(answersMarkdown(spec, answers, readReplies(c.view, spec.id), { brief: true }).trimEnd());
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
  const { live: next, problems } = updateLive(readLive(c.view, id), change, { off: new Set(spec.off ?? []), parts: parts.parts, source: sourcesFor(c.root, c.config), file: (path) => codeFile(c.root, path) });
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

/**
 * `wf ask more`: more under a question, or the page, that the person asked
 * about: Markdown (`--md`, a file or -; `--text`, words), blocks, and options
 * added to the question. The page draws it in place; the person's answers stay.
 */
function more(c, args, log) {
  const id = args[0];
  const spec = specOrFail(c.view, id);
  const page = args.includes("--page");
  const question = page ? PAGE : args[1];
  if (!question || question.startsWith("--")) {
    log(USAGE);
    return 2;
  }
  const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] != null ? [args[i + 1]] : []));
  const read = (from) => readFileSync(from === "-" ? 0 : from, "utf8");
  // --text takes every word after it, up to the next flag.
  const at = args.indexOf("--text");
  const next = args.findIndex((a, i) => i > at && a.startsWith("--"));
  const words = at < 0 ? "" : args.slice(at + 1, next < 0 ? args.length : next).join(" ");
  const md = [...values("--md").map(read), words].filter((t) => t.trim()).join("\n\n");
  const blocks = values("--blocks").flatMap((from) => {
    const raw = JSON.parse(read(from));
    return Array.isArray(raw) ? raw : raw?.blocks ?? [];
  });
  const options = values("--option").map((raw) => JSON.parse(raw));
  if (!md && !blocks.length && !options.length) {
    log("A reply shows something: --md <file | ->, --text <words>, --blocks <file | ->, or --option <json>.");
    return 2;
  }
  const parts = projectParts(c.root);
  const checked = moreBlocks({ md: md || null, blocks }, { off: new Set(spec.off ?? []), parts: parts.parts, source: sourcesFor(c.root, c.config), file: (path) => codeFile(c.root, path) });
  if (checked.problems.length) {
    for (const problem of checked.problems) log(problem);
    return 1;
  }
  const answering = pendingAsks(c.view, spec).filter((a) => a.question === question).map((a) => `“${a.text.replace(/\s+/g, " ")}”`);
  addMore(c.view, spec, question, { blocks: checked.blocks, options });
  const n = (count, one) => `${count} ${one}${count === 1 ? "" : "s"}`;
  const shows = [checked.blocks.length ? n(checked.blocks.length, "block") : "", options.length ? n(options.length, "added option") : ""].filter(Boolean).join(" and ");
  log(`${id}: more ${page ? "on the page" : `under ${question}`}${answering.length ? `, answering ${answering.join(", ")}` : ""}, with ${shows}. The page shows it now; run npx wf ask wait ${id} again.`);
  return 0;
}

/** The asks for more as lines for the agent, with what to run. */
function asksSaid(spec, asks, heading) {
  return [heading, ...askLines(spec, asks), `Answer each with npx wf ask more ${spec.id} <question | --page> --md <file | -> (Markdown, code in fences), --blocks <file | -> (a diff, a table, a code block of a file's lines), or --option '{"id","label","why"}' to add the option they proposed; then npx wf ask wait ${spec.id} again. The page keeps their answers.`].join("\n");
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

/**
 * `wf ask wait`: until the page is answered, in part or whole, after it was
 * built. While it runs, the page is marked as waited on, so the inbox and the
 * page say an agent is blocked on it, and the person is told on the desktop:
 * at the start, and once more after ask.remind minutes (ask.notify).
 */
async function wait(c, args, log) {
  const id = args[0];
  const spec = specOrFail(c.view, id);
  const timeout = Number(flag(args, "--timeout") ?? 0) * 1000;
  const start = Date.now();
  let checked = 0;
  const notify = c.config.ask.notify && !noServer();
  const sent = new Set();
  let local;
  const tell = async (kind) => {
    sent.add(kind);
    local ??= desktopNotifier({ log });
    const text = noticeText(kind, { project: spec.asker?.project || asker(c.root).project, title: spec.title, minutes: Math.round((Date.now() - start) / 60_000) });
    await tellWaiting({ key: register(c.root), id, text, port: VIEW_PORT, token: keptToken(VIEW_PORT), local });
    // In Orca, the workspace's unread dot too, where the person watches each agent.
    if (kind === "first") markUnread();
  };
  const stop = () => {
    clearWaiting(c.view, id);
    process.exit(130);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
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
      // An ask for more wakes the agent once, while the person goes on answering.
      const asks = untoldAsks(c.view, spec);
      if (now.state !== "waiting") {
        log(answersMarkdown(spec, now.answers, readReplies(c.view, id), { brief: true }).trimEnd());
        if (asks.length) {
          markTold(c.view, spec, asks);
          log(`\n${asksSaid(spec, asks, "More asked too, while the person answered:")}`);
        }
        return 0;
      }
      if (asks.length) {
        markTold(c.view, spec, asks);
        log(asksSaid(spec, asks, `More asked on the page ${id}, while the person answers:`));
        return 0;
      }
      if (!sent.size) markWaiting(c.view, id);
      const due = noticeDue(Date.now() - start, sent, c.config.ask.remind);
      if (due) {
        if (notify) await tell(due);
        else sent.add(due);
      }
      if (timeout && Date.now() - start > timeout) {
        log(`No answers to ${id} after ${timeout / 1000} s.`);
        return 3;
      }
      await sleep(500);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    clearWaiting(c.view, id);
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
  if (args.includes("--json")) {
    log(JSON.stringify(raw ?? null, null, 2));
    return 0;
  }
  const waiting = pendingAsks(c.view, spec);
  log(`${answersMarkdown(spec, answers, readReplies(c.view, spec.id), { brief: !args.includes("--all") }).trimEnd()}${waiting.length ? `\n\nAsked for more, not answered yet:\n${askLines(spec, waiting).join("\n")}` : ""}`);
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

/** `wf ask open <id>`: open the page where the person looks, by ask.open and the harness. */
function open(c, [id], log) {
  specOrFail(c.view, id);
  const url = viewAddress(c.root, join(askDir(c.view, id), "index.html"));
  const { lines } = openPage(url, c.config.ask.open);
  for (const line of lines) log(line);
  return 0;
}

const IN_PROJECT = { page, open, wait, answers: showAnswers, record, export: exportPage, import: importAnswers, live, reply, more, history };

/** `wf ask ...`; resolves to the exit code. */
export async function runAsk([sub, ...args], log = console.log) {
  if (sub === "templates") return listTemplates(args, log);
  if (sub === "example") return example(args, log);
  if (sub === "fields") return fields(args, log);
  const run = Object.hasOwn(IN_PROJECT, sub) ? IN_PROJECT[sub] : null;
  if (!run || (!args[0] && sub !== "history")) {
    log(USAGE);
    return 2;
  }
  return run(context(), args, log);
}

/** `wf view ...`; serve resolves only when the server stops. */
