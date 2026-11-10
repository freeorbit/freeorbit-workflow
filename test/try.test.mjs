import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { appSettings } from "../lib/app/driver.mjs";
import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { againCommand, parseArgs, runTry, tryHome } from "../lib/try/index.mjs";
import { browserArgs, openApp, openSteps, stopGroups } from "../lib/try/open.mjs";
import { filterGroups, flatten, groupBy, view } from "../lib/try/picker.mjs";

const SCENARIOS = [
  { id: "app-empty", set: "app", setName: "The app, no plugin", group: "Start", about: "a new install" },
  { id: "mail-picked", set: "mail", setName: "Mail", group: "Prepare", about: "an archive picked" },
  { id: "mail-imap", set: "mail", setName: "Mail", group: "Prepare", about: "signed in over IMAP", note: "mail server" },
  { id: "mail-lost", set: "mail", setName: "Mail", about: "no screen reaches it" },
];

test("groups keep the order each first appears, with ungrouped items last", () => {
  const groups = groupBy([{ id: "a" }, { id: "b", group: "Two" }, { id: "c", group: "One" }, { id: "d", group: "Two" }], "group");
  assert.deepEqual(groups.map((group) => [group.name, group.items.map((item) => item.id)]), [["Two", ["b", "d"]], ["One", ["c"]], ["Other", ["a"]]]);
});

test("the filter keeps items holding every word, and drops empty groups", () => {
  const groups = groupBy(SCENARIOS, "group");
  const text = (item) => `${item.id} ${item.about}`;
  assert.deepEqual(flatten(filterGroups(groups, "IMAP signed", text)).map((item) => item.id), ["mail-imap"]);
  assert.deepEqual(filterGroups(groups, "nothing like it", text), []);
  assert.equal(flatten(filterGroups(groups, "", text)).length, 4);
});

test("the view marks the cursor and keeps it in a short window", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `s-${i}` }));
  const lines = view({ title: "Which?", groups: [{ name: "All", items }], query: "s", cursor: 30, height: 12, line: (item) => item.id });
  assert.equal(lines.length, 12);
  assert.ok(lines.some((line) => line.includes("> s-30")));
  assert.ok(!lines.some((line) => line.endsWith(" s-0")));
  assert.ok(view({ title: "Which?", groups: [], query: "zz", cursor: 0, height: 12, line: String }).some((line) => line.includes("Nothing matches")));
});

test("flags become answers, a value-less flag a yes, and the kit's own flags are not answers", () => {
  const opts = parseArgs(["mail-picked", "--archive", "small", "--read", "--keep", "--dry-run"]);
  assert.equal(opts.name, "mail-picked");
  assert.deepEqual(opts.answers, { archive: "small", read: true });
  assert.ok(opts.keep && opts.dryRun && !opts.files);
  assert.throws(() => parseArgs(["a", "b"]), /one scenario at a time/);
  assert.equal(againCommand("mail-picked", { archive: "my file.zip", read: true, skipped: null, no: false }), "npx wf try mail-picked --archive 'my file.zip' --read --no-skipped --no-no");
  assert.deepEqual(parseArgs(["mail-picked", "--archive", "small", "--no-read"]).answers, { archive: "small", read: false });
  assert.deepEqual(parseArgs(againCommand("x", { archive: null, read: false }).split(" ").slice(3)).answers, { archive: false, read: false });
});

test("a scenario's folder is under app.try.home, and an unsafe name is refused", () => {
  const config = merge(DEFAULTS, { app: { name: "demo", try: { home: "/tmp/wf-try-test" } } });
  assert.equal(tryHome(config, "mail-picked", "/p"), "/tmp/wf-try-test/mail-picked");
  assert.match(tryHome(merge(DEFAULTS, { app: { name: "demo" } }), "x", "/p"), /\.cache\/demo-try\/x$/);
  assert.equal(tryHome(merge(DEFAULTS, { app: { name: "demo", try: { home: ".cache/try" } } }), "x", "/p"), "/p/.cache/try/x");
  assert.match(tryHome(merge(DEFAULTS, { app: { name: "demo", try: { home: "~/t" } } }), "x", "/p"), /^\/.+\/t\/x$/);
  for (const home of ["~", "/", ".", "~/"]) assert.throws(() => tryHome(merge(DEFAULTS, { app: { name: "demo", try: { home } } }), "x", "/p"), /folder of its own/, home);
  for (const bad of ["../up", "a/b", "", "-rf"]) assert.throws(() => tryHome(config, bad, "/p"), /scenario name/);
});

// A project with every hook, recording what the kit asked of it.
function project({ interactive = false, picks = [], answers = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wf-try-"));
  const home = mkdtempSync(join(tmpdir(), "wf-try-home-"));
  const config = merge(DEFAULTS, { app: { kind: "tauri", name: "demo", binary: "target/debug/demo", bundleId: "org.example.demo", try: { home, command: ["demo-dev"] } } });
  const seen = { prepared: [], stopped: [], opened: [], asked: [], log: [] };
  const hooks = {
    scenarios: async () => SCENARIOS,
    asks: async (scenario, given) => {
      if (scenario.set !== "mail" || scenario.note) return null;
      if (!("archive" in given)) return { flag: "archive", question: "Load a test archive?", choices: [{ id: "small" }, { id: "broken" }], skip: "keep the scenario's own" };
      if (given.archive && !("read" in given)) return { flag: "read", question: "Read it now?", yesNo: true, default: given.archive !== "broken" };
      return null;
    },
    plan: async (scenario, given) => [`build ${scenario.id}${given.archive ? ` with ${given.archive}` : ""}`],
    files: async () => "small: the small archive\n",
    prepare: async (ctx) => {
      seen.prepared.push(ctx);
      writeFileSync(join(ctx.dataHome, "built"), ctx.scenario.id);
      return { env: { DEMO_TODAY: "2026-11-10" }, state: { server: "up" }, message: "Type this in the app." };
    },
    stop: async (ctx) => seen.stopped.push(ctx.state),
  };
  const io = {
    hooks,
    interactive,
    platform: "linux",
    pick: async ({ groups }) => {
      const want = picks.shift();
      return flatten(groups).find((item) => item.id === want) ?? null;
    },
    ask: async (ask) => {
      seen.asked.push(ask.flag);
      return answers.shift();
    },
    open: async (s, cfg, folder, ready) => {
      seen.opened.push({ folder, env: ready.env });
      return 0;
    },
    log: (line) => seen.log.push(line),
  };
  return { root, home, config, io, seen, hooks };
}

test("outside a terminal, wf try lists each set's scenarios in their groups, and opens nothing", async () => {
  const p = project();
  assert.equal(await runTry(p.root, p.config, [], p.io), 0);
  const out = p.seen.log.join("\n");
  assert.match(out, /Mail \(wf try mail\)/);
  assert.match(out, /mail-imap\s+\[mail server\] signed in over IMAP/);
  assert.ok(out.indexOf("Prepare") < out.indexOf("Other"));
  assert.equal(p.seen.prepared.length, 0);
  const one = project();
  await runTry(one.root, one.config, ["mail"], one.io);
  assert.ok(!one.seen.log.join("\n").includes("app-empty"));
});

test("a picked scenario asks the project's questions in turn, builds a fresh folder, opens, then stops", async () => {
  const p = project({ interactive: true, picks: ["mail", "mail-picked"], answers: ["small", true] });
  assert.equal(await runTry(p.root, p.config, [], p.io), 0);
  assert.deepEqual(p.seen.asked, ["archive", "read"]);
  const ctx = p.seen.prepared[0];
  assert.deepEqual(ctx.args, ["--fresh", "--scenario", "mail-picked"]);
  assert.deepEqual(ctx.answers, { archive: "small", read: true });
  assert.equal(ctx.purpose, "try");
  assert.equal(ctx.dataHome, join(p.home, "mail-picked"));
  assert.deepEqual(p.seen.opened, [{ folder: join(p.home, "mail-picked"), env: { DEMO_TODAY: "2026-11-10" } }]);
  assert.deepEqual(p.seen.stopped, [{ server: "up" }]);
  const out = p.seen.log.join("\n");
  assert.match(out, /npx wf try mail-picked --archive small --read/);
  assert.match(out, /build mail-picked with small/);
  assert.match(out, /XDG_DATA_HOME=.*mail-picked demo-dev/);
  assert.match(out, /Type this in the app\./);
});

test("flags answer the questions with no asking, --keep reuses the folder, and --dry-run opens nothing", async () => {
  const p = project({ interactive: true });
  await runTry(p.root, p.config, ["mail-picked", "--archive", "broken", "--read"], p.io);
  assert.deepEqual(p.seen.asked, []);
  await runTry(p.root, p.config, ["mail-picked", "--keep"], p.io);
  assert.deepEqual(p.seen.prepared[1].args, []);
  assert.equal(p.seen.prepared[1].fresh, false);
  assert.ok(existsSync(join(p.home, "mail-picked", "built")));
  const dry = project({ interactive: true, answers: [null] });
  assert.equal(await runTry(dry.root, dry.config, ["mail-picked", "--dry-run"], dry.io), 0);
  assert.deepEqual(dry.seen.prepared, []);
  assert.deepEqual(dry.seen.opened, []);
  assert.match(dry.seen.log.join("\n"), /Would open mail-picked/);
});

test("outside a terminal the questions take their defaults; --files prints the project's list", async () => {
  const p = project();
  await runTry(p.root, p.config, ["mail-picked"], p.io);
  assert.deepEqual(p.seen.prepared[0].answers, { archive: null });
  await runTry(p.root, p.config, ["--files"], p.io);
  assert.match(p.seen.log.at(-1), /small: the small archive/);
});

test("an unknown name, or hooks without scenarios, fail with what to do", async () => {
  const p = project();
  assert.equal(await runTry(p.root, p.config, ["nope"], p.io), 1);
  assert.match(p.seen.log.at(-1), /no scenario or set called nope/);
  const bare = project();
  bare.io.hooks = {};
  assert.equal(await runTry(bare.root, bare.config, [], bare.io), 1);
  assert.match(bare.seen.log.at(-1), /needs scenarios\(ctx\) and prepare\(ctx\)/);
});

const webSettings = (url, servers = [], root = "/p") => appSettings(root, merge(DEFAULTS, { design: { browser: "chromium" }, app: { kind: "web", name: "site", web: { url, servers } } }), {});

test("a web app opens in a visible browser on a profile of its own, at the window size", () => {
  const s = webSettings("http://127.0.0.1:5173/");
  const args = browserArgs(s, "chromium", "/tmp/x");
  assert.equal(args[0], "chromium");
  assert.ok(args.includes("--user-data-dir=/tmp/x/browser"));
  assert.ok(!args.includes("--headless"));
  assert.ok(!args.includes("--no-sandbox"));
  assert.equal(args.at(-1), "http://127.0.0.1:5173/");
  assert.match(openSteps(s, "/tmp/x").at(-1), /--user-data-dir=\/tmp\/x\/browser/);
});

// A launched program that exits when told, or on its own.
function fakeLaunch(calls, exitAfter = 10) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = undefined;
    child.exitCode = null;
    child.kill = () => child.emit("exit", 0);
    calls.push({ cmd, args, opts });
    setTimeout(() => {
      child.exitCode = 0;
      child.emit("exit", 0);
    }, exitAfter);
    return child;
  };
}

test("a Tauri app runs the dev command with the folder as its data home and the scenario's settings", async () => {
  const s = appSettings("/p", merge(DEFAULTS, { app: { name: "demo", binary: "b", bundleId: "org.example.demo", try: { command: ["pnpm", "dev"] } } }), {});
  const calls = [];
  assert.equal(await openApp(s, {}, "/tmp/home", { env: { DEMO_TODAY: "2026-11-10" } }, () => {}, { launch: fakeLaunch(calls) }), 0);
  assert.equal(calls[0].cmd, "pnpm");
  assert.deepEqual(calls[0].args, ["dev"]);
  assert.equal(calls[0].opts.env.XDG_DATA_HOME, "/tmp/home");
  assert.equal(calls[0].opts.env.DEMO_TODAY, "2026-11-10");
});

test("a web app's server already answering is left alone, and the browser opens on the app's address", async () => {
  const server = createServer((req, res) => res.end("ok")).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const s = webSettings(url, [{ name: "site", command: ["serve"], url }]);
    const calls = [];
    const log = [];
    const home = mkdtempSync(join(tmpdir(), "wf-try-web-"));
    assert.equal(await openApp(s, merge(DEFAULTS, { design: { browser: "chromium" } }), home, {}, (line) => log.push(line), { launch: fakeLaunch(calls) }), 0);
    assert.equal(calls.length, 1, "only the browser was launched");
    assert.equal(calls[0].cmd, "chromium");
    assert.equal(calls[0].args.at(-1), url);
    assert.match(log.join("\n"), /already answers/);
  } finally {
    server.close();
  }
});

test("a web app's servers start with the scenario's settings, are waited for, and stop with the browser", async () => {
  const port = 8790 + Math.floor(Math.random() * 100);
  const url = `http://127.0.0.1:${port}/`;
  const command = [process.execPath, "-e", `require("http").createServer((q, r) => r.end(process.env.DEMO_SEEN ?? "none")).listen(${port}, "127.0.0.1")`];
  const s = webSettings(url, [{ name: "api", command, url }], tmpdir());
  const calls = [];
  const fake = fakeLaunch(calls, 300);
  let seen = null;
  const launch = (cmd, args, opts) => {
    if (cmd !== "chromium") return spawn(cmd, args, opts);
    // The browser opens once the server answers; read what the server was given.
    fetch(url).then((r) => r.text()).then((text) => (seen = text));
    return fake(cmd, args, opts);
  };
  const home = mkdtempSync(join(tmpdir(), "wf-try-web-"));
  const missing = webSettings(url, [{ name: "api", command: ["/no/such/server"], url }], tmpdir());
  await assert.rejects(openApp(missing, {}, home, {}, () => {}, { launch: spawn }), /api could not start/);
  assert.equal(await openApp(s, merge(DEFAULTS, { design: { browser: "chromium" } }), home, { env: { DEMO_SEEN: "scenario" } }, () => {}, { launch }), 0);
  assert.equal(seen, "scenario");
  assert.ok(existsSync(join(home, "logs", "api.log")));
  await new Promise((r) => setTimeout(r, 200));
  await assert.rejects(fetch(url), "the server stopped with the browser");
});

test("a failed build still stops what prepare started, and --keep then builds afresh", async () => {
  const p = project();
  const prepare = p.hooks.prepare;
  p.io.hooks = {
    ...p.hooks,
    prepare: async (ctx) => {
      ctx.state.mail = true;
      throw new Error("the build broke");
    },
  };
  assert.equal(await runTry(p.root, p.config, ["mail-imap"], p.io), 1);
  assert.deepEqual(p.seen.stopped, [{ mail: true }]);
  assert.deepEqual(p.seen.opened, []);
  p.io.hooks = { ...p.hooks, prepare };
  await runTry(p.root, p.config, ["mail-imap", "--keep"], p.io);
  assert.deepEqual(p.seen.prepared.at(-1).args, ["--fresh", "--scenario", "mail-imap"], "a half-built folder is not kept");
});

test("a Tauri app is tried on Linux only, where its data follows XDG_DATA_HOME", async () => {
  const p = project();
  p.io.platform = "darwin";
  assert.equal(await runTry(p.root, p.config, ["mail-imap"], p.io), 1);
  assert.match(p.seen.log.at(-1), /Linux only/);
  assert.deepEqual(p.seen.prepared, []);
});

test("a group that ignores SIGTERM is killed after the grace period", async () => {
  const child = spawn("sh", ["-c", "trap '' TERM; sleep 30"], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  const started = Date.now();
  await stopGroups([child], 500);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(child.signalCode === "SIGKILL" || child.exitCode !== null, "the group is gone");
  assert.ok(Date.now() - started < 2000);
});

test("a server with no url that cannot start is reported", async () => {
  const s = webSettings("http://127.0.0.1:1/", [{ name: "worker", command: ["/no/such/worker"] }], tmpdir());
  const home = mkdtempSync(join(tmpdir(), "wf-try-web-"));
  await assert.rejects(openApp(s, {}, home, {}, () => {}, { launch: spawn }), /worker could not start/);
});
