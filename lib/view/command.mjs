// `wf view`: the shared ask-pages server that serves every project's ask
// pages, and the commands around it.
//
//   wf view serve [--port <n>]   make sure the shared server runs, and stay with it
//   wf view serve --hub          the shared server itself, started by the others
//   wf view stop                 stop the shared server
//   wf view notify               send one desktop notification, and say what to check if none shows
//   wf view setup                write or update the server in .claude/launch.json

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answersMarkdown, askState, checkAnswers } from "../ask/answers.mjs";
import { claudePalettes, claudeTheme } from "../ask/claudetheme.mjs";
import { keepRound, readLive, readReplies, rounds } from "../ask/live.mjs";
import { addAsk, moreOf, withMore } from "../ask/more.mjs";
import { loadConfig, projectRoot } from "../config/config.mjs";
import { writeWhole } from "../files.mjs";
import { flagValue, sleep } from "../process.mjs";
import { KIT_ROOT } from "../setup/ai.mjs";
import { desktopCommand, desktopHelp, desktopNotifier, notifyNow } from "./desktop.mjs";
import { ensureHub, hubUp, keptToken, projects, startHub, stateDir } from "./hub.mjs";
import { kindsFor } from "./kinds.mjs";
import { serve } from "./serve.mjs";
import { readSettings, settingsFile, writeSettings } from "./settings.mjs";
import { VIEW_PORT, viewEntry, withViewServer } from "./view.mjs";

const VIEW_USAGE = "Usage: wf view serve [--port <n>] | stop | setup | notify";
const PKG = JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8"));

/** `wf view ...`; resolves to the exit code. */
/**
 * The ask pages' settings, read from their file once and kept in memory, since
 * this server is the only one that writes it: a page served reads no file.
 */
function keptSettings(file) {
  let kept = readSettings(file);
  return { read: () => kept, write: (changed) => (kept = writeSettings(changed, file, kept)) };
}

export async function runView([sub, ...args], log = console.log) {
  if (sub === "setup") {
    const root = projectRoot();
    const file = join(root, ".claude", "launch.json");
    const before = existsSync(file) ? readFileSync(file, "utf8") : null;
    const after = withViewServer(before);
    if (after === before) {
      const { kind } = viewEntry(before ? JSON.parse(before) : null);
      log(kind === "own" ? ".claude/launch.json has an ask-pages entry of the project's own, so it is left alone; rename it, or make it run npx wf view serve." : ".claude/launch.json already has the ask-pages server.");
      return kind === "own" ? 1 : 0;
    }
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(file, after);
    log(".claude/launch.json: the ask-pages server is now npx wf view serve");
    return 0;
  }
  if (sub === "notify") {
    // One notification now, through the commands the server uses, to see that it shows.
    const { sent, last, lines } = notifyNow(desktopCommand(), "Workflow asks: a test", "Ask pages tell you here when an agent asks.");
    for (const line of [...lines, ...desktopHelp(last)]) log(line);
    return sent ? 0 : 1;
  }
  if (sub === "stop") {
    const file = join(stateDir(), "view-hub.json");
    const hub = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const port = Number(flagValue(args, "--port") ?? hub?.port ?? VIEW_PORT);
    if (!(await hubUp(port))) {
      log("The ask-pages server is not running.");
      return 0;
    }
    const res = await fetch(`http://127.0.0.1:${port}/__hub/stop`, { method: "POST", headers: { "X-WF-Token": hub?.token ?? "" } }).catch(() => null);
    log(res?.ok ? "The ask-pages server stopped." : "The server did not stop: its token in the state folder is not the running one's.");
    return res?.ok ? 0 : 1;
  }
  if (sub !== "serve") {
    log(VIEW_USAGE);
    return 2;
  }
  const port = Number(flagValue(args, "--port") ?? VIEW_PORT);
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
    const running = await serve({ resolve: find, list: () => Object.values(projects()), check: checkAnswers, stateOf: askState, liveOf: readLive, repliesOf: readReplies, moreOf, askMore: addAsk, specOf: withMore, historyOf: (view, spec) => rounds(view, spec.id).map((r) => ({ at: r.at, hash: r.hash, same: r.hash === spec.hash, markdown: answersMarkdown(r.spec, r.answers) })), onAnswers: keepRound, port, log, token: keptToken(port), version: PKG.version, idleMs: 12 * 3600 * 1000, onStop: () => stop(), theme: (id) => claudeTheme(process.env, id), themes: () => claudePalettes(), desktop: desktopNotifier({ log }), settings: keptSettings(settingsFile(stateDir())) });
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
  log(`ask-pages: the shared server (pid ${hub.pid}) serves http://127.0.0.1:${port}/ — every ask, from every session.`);
  for (;;) {
    await sleep(5000);
    if (!(await hubUp(port))) {
      log("ask-pages: the shared server stopped; starting it again.");
      await ensureHub({ port });
    }
  }
}
