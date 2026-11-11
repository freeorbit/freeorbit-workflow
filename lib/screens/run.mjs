// `wf screens`: the one screen check. A run is light, deep, or deferred, and
// takes the pictures ticked for it:
//
//   --wide    Default: the app's own window, beside its frame
//   --narrow  screens.narrow, the whole page, scrolled and joined
//   --stress  also each ticked viewport in the stress look, screens.stress
//
// Each ticked viewport is shot as a new install shows it, and in the stress
// look too when it is ticked. A screen is listed to read when one of its
// pictures or its frame changed since the last accept, or it is new. The
// frames in scope are rendered from their HTML first, so a pair never shows a
// stale frame. The app is driven through `wf app`.
//
//   wf screens --light [pictures]   the light list (default: --wide)
//   wf screens --deep [pictures]    the light and deep lists (default: --wide --narrow --stress)
//   wf screens --defer              count a deferred chunk end; nothing is shot
//   wf screens <screen> ...         these screens (default: wide default, narrow stress)
//   wf screens --chunk CH-30 | --all  the chunk's screens, or every screen
//   wf screens scope [--names light|deep]   both lists, from the project's screens.scope module
//   wf screens --sheets             the listed pictures, six to a sheet
//   wf screens --brief              the listed screens as briefs for the screen-reader agent
//   wf screens --accept             the run's pictures become the accepted ones, and
//                                   each Default is copied to design.built for the board's
//                                   Built screens; a light or deep run also moves the state
//   wf screens --check              the list covers every frame and scenario, and each
//                                   unreached frame names an open chunk (no app)
//   wf screens --gate CH-35         chunk end: the chunk's frames are reached or wait on a later chunk
//
//   --force    run --light or --deep before the code review has run or been
//              deferred at this commit; a chunk end waits for it otherwise
//   --jobs N   shoot on N apps at once, each on its own virtual display
//              (screens.display), off the user's screen. The default is one a
//              core, up to screens.jobsMax. --jobs 1 shoots on the user's screen.
//
// A web app's browser is headless or headed by screens.headless: review for
// --light and --deep, build for named screens, a chunk, or all.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { KIT_ROOT } from "../ai.mjs";
import { designPaths, findFrame } from "../design/frames.mjs";
import { renderArgs } from "../design/index.mjs";
import { captionLines } from "../design/storyboard.mjs";
import { keepBuilt, keepsBuilt } from "./built.mjs";
import { allScreens, chunkStories, coverage, gateProblems, parseReach, reachCounts, reachLine } from "./list.mjs";
import { afterDefer, afterRun, headCommit, readState, statePath, writeState } from "./state.mjs";

// The kit's own command line, run by its path so no shell or npx sits between.
const WF = join(KIT_ROOT, "bin", "wf.mjs");
const ON_A_SHEET = 6;
/** Screens one screen-reader agent reads, so each agent's context stays small. */
export const IN_A_BRIEF = 8;
/** One app start and its steps, at about three seconds. */
export const SECONDS_A_SHOT = 3;

/**
 * One run's context: the project, its config, where the run keeps its
 * pictures, and the app instance and browser mode it shoots with. Passed to
 * each step, so a second run in one process never sees the last one's.
 */
export function runContext(root, config) {
  const out = join(root, ".cache/screens");
  const latest = join(out, "latest");
  return {
    root,
    config,
    out,
    latest,
    accepted: join(out, "accepted.json"),
    run: join(latest, "run.json"),
    toRead: join(out, "to-read.json"),
    state: statePath(root),
    instance: 0,
    // Whether this run's web browsers run headless, from screens.headless; set by run(), and by a worker from its job.
    headless: null,
  };
}
const screensHere = (ctx) => allScreens(ctx.root, ctx.config);

const SIZES = ["wide", "narrow"];

/**
 * The pictures a run takes, such as "wide-default": each ticked viewport as a
 * new install shows it, and in the stress look too when --stress is ticked.
 * With no viewport ticked, a light run takes wide, a deep run both with the
 * stress look, and a named run wide and the stress look narrow.
 */
export function shotsFor(args, mode) {
  const sizes = SIZES.filter((size) => args.includes(`--${size}`));
  const stress = args.includes("--stress");
  if (sizes.length === 0) {
    if (stress) throw new Error("--stress needs a viewport: --wide, --narrow, or both");
    if (mode === "light") return ["wide-default"];
    if (mode === "deep") return ["wide-default", "wide-stress", "narrow-default", "narrow-stress"];
    return ["wide-default", "narrow-stress"];
  }
  return sizes.flatMap((size) => (stress ? [`${size}-default`, `${size}-stress`] : [`${size}-default`]));
}

/**
 * Why a screen must be read again, from its hashes now and when accepted:
 * "new", "app changed", "frame changed", "both", or null when nothing did.
 * Only the pictures taken now count; one never taken before makes it new.
 */
export function why(now, kept) {
  if (!kept) return "new";
  const shots = Object.keys(now).filter((key) => key !== "frame");
  if (shots.some((key) => !(key in kept))) return "new";
  const app = shots.some((key) => now[key] !== kept[key]);
  const frame = (now.frame ?? null) !== (kept.frame ?? null);
  if (app && frame) return "both";
  if (app) return "app changed";
  if (frame) return "frame changed";
  return null;
}

/** The accepted hashes. Older ones named the two pictures wide and narrow. */
export function migrate(kept) {
  return Object.fromEntries(
    Object.entries(kept).map(([name, hashes]) => {
      const { wide, narrow, ...rest } = hashes;
      return [name, { ...(wide ? { "wide-default": wide } : {}), ...(narrow ? { "narrow-stress": narrow } : {}), ...rest }];
    }),
  );
}

function readAccepted(ctx) {
  return existsSync(ctx.accepted) ? migrate(JSON.parse(readFileSync(ctx.accepted, "utf8"))) : {};
}

/**
 * Whether a screen run's web browser runs headless: screens.headless.review
 * for a chunk-end --light or --deep run, screens.headless.build for named
 * screens, a chunk, or all; null in either follows app.web.headless.
 */
export function screensHeadless(config, mode) {
  const set = mode ? config.screens.headless.review : config.screens.headless.build;
  return set ?? config.app.web.headless;
}

function app(ctx, ...args) {
  const env = { ...process.env, [ctx.config.app.instanceEnv]: String(ctx.instance) };
  const res = spawnSync("node", [WF, "app", ...args], { cwd: ctx.root, encoding: "utf8", env });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function hashOf(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

/** Scenario names, one a line, from the project's screens.scenarios command. */
export function scenarioNames(ctx) {
  if (!ctx.config.screens.scenarios) throw new Error("screens.scenarios is not set: the shell command that prints the scenario names, one a line");
  const res = spawnSync("sh", ["-c", ctx.config.screens.scenarios], { cwd: ctx.root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** The rendered PNG for a framed screen, by its name. */
function framePicture(ctx, name) {
  const frame = findFrame(name, designPaths(ctx.root, ctx.config));
  return frame && existsSync(frame.png) ? frame.png : null;
}

/** A path as one word of a step: quoted when it holds a space or a quote, such as under "Atlas NX". */
export function stepWord(path) {
  return /[\s"']/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

/** The steps that put a look on the open page. */
export function lookStep(look) {
  return `eval Object.assign(document.documentElement.dataset,${JSON.stringify(look)}) && 1`;
}

/**
 * One session's steps: walk the Reach once, take the default picture, then put
 * the stress look on the same page and take it again. A look is drawing only,
 * so the page needs no second walk (pictures matched the old way, 2026-11-09).
 */
export function sessionSteps(reach, looks, last, outs) {
  const steps = [...reach.steps];
  looks.forEach((look, at) => {
    // The look's colors and corners ease in, so the picture waits for them to finish.
    if (look) steps.push(lookStep(look), "wait 300");
    steps.push(`${last} ${stepWord(outs[at])}`);
  });
  return steps;
}

/**
 * Start the app on the scenario at a size, walk the steps once, and save a
 * picture for each look. The app restarts on each start, but Vite stays up for
 * the run, and the scenario is built once into the run's cache.
 */
function shoot(ctx, reach, size, looks, last, outs, cache) {
  const start = ["start", "--fresh", "--scenario", reach.scenario, "--cache", cache];
  if (size) start.push("--size", size);
  if (ctx.config.app.kind === "web" && ctx.headless !== null) start.push(ctx.headless ? "--headless" : "--headed");
  const started = app(ctx, ...start);
  if (!started.ok) return `could not start: ${started.out.trim().split("\n").pop()}`;
  const ran = app(ctx, "run", ...sessionSteps(reach, looks, last, outs));
  if (!ran.ok) {
    const lines = ran.out.trim().split("\n");
    return `a step failed: ${lines.find((line) => line.startsWith("FAIL")) ?? lines.pop()}`;
  }
  return null;
}

/** The screens to check, from the arguments. */
async function pick(ctx, args, screens) {
  for (const mode of ["light", "deep"]) {
    if (!args.includes(`--${mode}`)) continue;
    const { light, deep } = await currentLists(ctx);
    const names = new Set(mode === "light" ? light.keys() : [...light.keys(), ...deep.keys()]);
    return screens.filter((screen) => names.has(screen.name));
  }
  if (args.includes("--all")) return screens;
  const at = args.indexOf("--chunk");
  if (at >= 0) {
    const { buildOrder, done } = chunkTexts(ctx);
    const stories = chunkStories(args[at + 1], [buildOrder, done]);
    if (!stories) throw new Error(`no chunk ${args[at + 1]} in the build order or the done list`);
    return screens.filter((screen) => screen.stories.some((story) => stories.includes(story)));
  }
  const names = args.filter((arg, at) => !arg.startsWith("--") && args[at - 1] !== "--jobs");
  if (names.length > 0) {
    const unknown = names.filter((name) => !screens.some((screen) => screen.name === name));
    if (unknown.length) throw new Error(`no screen called ${unknown.join(", ")} in any screens.md`);
    return screens.filter((screen) => names.includes(screen.name));
  }
  return null;
}

/** Where a screen's pictures go in this run. */
function picturePaths(ctx, name, shots) {
  return Object.fromEntries(shots.map((shot) => [shot, join(ctx.latest, `${name}-${shot}.png`)]));
}

/** Shoot one screen's pictures, one session per size. The problem, or null. */
function shootScreen(ctx, screen, shots, cache) {
  const reach = parseReach(screen.reach);
  const paths = picturePaths(ctx, screen.name, shots);
  for (const old of [...Object.values(paths), join(ctx.latest, `${screen.name}-pair.png`)]) rmSync(old, { force: true });
  for (const size of SIZES) {
    const mine = shots.filter((shot) => shot.startsWith(`${size}-`));
    if (mine.length === 0) continue;
    const looks = mine.map((shot) => (shot.endsWith("-stress") ? ctx.config.screens.stress : null));
    const problem = shoot(ctx, reach, size === "narrow" ? ctx.config.screens.narrow : null, looks, size === "narrow" ? "page" : "shot", mine.map((shot) => paths[shot]), cache);
    if (problem) return problem;
  }
  return null;
}

/** Whether the virtual displays can start: screens.display is kwin and kwin_wayland is on the PATH. */
function kwinFound(ctx) {
  return ctx.config?.screens.display === "kwin" && spawnSync("sh", ["-c", "command -v kwin_wayland"]).status === 0;
}

/**
 * --jobs N, the apps that shoot at once, each on its own virtual display.
 * Without it, one app a core up to 8, which measured fastest on 8 cores
 * (2026-11-09: 8 and 10 tied), or 1 on the user's screen when the apps need
 * displays and kwin_wayland is missing. A headless web app needs none, so it
 * runs in parallel anywhere, macOS too. --jobs 1 shoots on the user's screen, to watch.
 */
export function jobsOf(args, cores = availableParallelism(), parallel = false, most = 8) {
  const at = args.indexOf("--jobs");
  if (at < 0) return parallel ? Math.max(1, Math.min(most, cores)) : 1;
  const jobs = Number(args[at + 1]);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new Error("usage: --jobs N, from 1 to 16");
  return jobs;
}

/**
 * The screens split into N lists of about the same length, for N apps. The
 * list is cut in order of scenario, so screens on one scenario stay together
 * and each app builds a scenario at most once in its own cache.
 */
export function splitScreens(screens, jobs) {
  const sorted = [...screens].sort((a, b) => parseReach(a.reach).scenario.localeCompare(parseReach(b.reach).scenario));
  const size = Math.ceil(sorted.length / jobs);
  const lists = [];
  for (let at = 0; at < sorted.length; at += size) lists.push(sorted.slice(at, at + size));
  return lists;
}

/**
 * A virtual KWin display for one parallel app, off the user's screen, as a
 * user unit with a memory cap. Its socket, its unit, or the problem.
 */
function virtualDisplay(ctx, id) {
  const unit = `${ctx.config.app.name}-agent-display-${id}`;
  const socket = `${ctx.config.app.name}-shot-${id}`;
  spawnSync("systemctl", ["--user", "stop", unit]);
  const started = spawnSync("systemd-run", [
    "--user", `--unit=${unit}`, "--collect", "--quiet", "-p", "MemoryMax=1G",
    "kwin_wayland", "--virtual", "--socket", socket, "--width", "1300", "--height", "820", "--no-lockscreen", "--no-global-shortcuts",
  ], { encoding: "utf8" });
  if (started.status !== 0) return { problem: `no virtual display: ${started.stderr.trim()} (needs kwin_wayland)` };
  const path = join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", socket);
  for (let i = 0; i < 50 && !existsSync(path); i++) spawnSync("sleep", ["0.1"]);
  if (!existsSync(path)) return { problem: `the virtual display ${socket} did not start` };
  return { socket, unit };
}

/** Whether a parallel app needs a display of its own: a Tauri window, or a web app's browser when this run is not headless. */
export function needsDisplay(app, runHeadless = app.web.headless) {
  return app.kind !== "web" || !runHeadless;
}

/** Shoot every screen, on N apps at once, each its own worker process. Each screen's problem, or null. */
async function shootAll(ctx, screens, shots, cache, jobs) {
  if (jobs === 1) return Object.fromEntries(screens.map((screen) => [screen.name, shootScreen(ctx, screen, shots, cache)]));
  const lists = splitScreens(screens, jobs);
  const web = ctx.config.app.kind === "web";
  // A Tauri app's Vite is shared, so it is up before the apps start, or each would start its own. A web app's servers are shared by the driver.
  if (!web) {
    const vite = app(ctx, "vite");
    if (!vite.ok) return Object.fromEntries(screens.map((screen) => [screen.name, `Vite did not start: ${vite.out.trim()}`]));
  }
  const results = await Promise.all(
    lists.map((list, at) => {
      const job = join(ctx.out, `job-${at + 1}.json`);
      writeFileSync(job, JSON.stringify({ names: list.map((screen) => screen.name), shots, cache: join(cache, String(at + 1)), headless: ctx.headless }));
      // Each app window gets its own virtual display, since a window another covers is not painted. A headless browser has no window.
      const display = needsDisplay(ctx.config.app, ctx.headless ?? undefined) ? virtualDisplay(ctx, at + 1) : {};
      if (display.problem) return Object.fromEntries(list.map((screen) => [screen.name, display.problem]));
      return new Promise((done) => {
        const child = spawn("node", [WF, "screens", "--worker", job], {
          cwd: ctx.root,
          env: { ...process.env, [ctx.config.app.instanceEnv]: String(at + 1), ...(display.socket ? { WAYLAND_DISPLAY: display.socket } : {}) },
          stdio: ["ignore", "pipe", "inherit"],
        });
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.on("close", () => {
          rmSync(job, { force: true });
          if (display.unit) spawnSync("systemctl", ["--user", "stop", display.unit]);
          try {
            done(JSON.parse(out));
          } catch {
            done(Object.fromEntries(list.map((screen) => [screen.name, `worker ${at + 1} stopped: ${out.trim().split("\n").pop()}`])));
          }
        });
      });
    }),
  );
  return Object.assign({}, ...results);
}

/** A worker: shoot its list on its own app, and print each screen's problem as JSON. */
function worker(ctx, file) {
  ctx.instance = Number(process.env[ctx.config.app.instanceEnv] ?? 0);
  const { names, shots, cache, headless: jobHeadless } = JSON.parse(readFileSync(file, "utf8"));
  ctx.headless = jobHeadless ?? null;
  const screens = screensHere(ctx).filter((screen) => names.includes(screen.name));
  const problems = Object.fromEntries(screens.map((screen) => [screen.name, shootScreen(ctx, screen, shots, cache)]));
  app(ctx, "stop");
  process.stdout.write(JSON.stringify(problems));
}

/**
 * Whether the code review ledger has reviewed or deferred at this commit, so a
 * chunk-end screen review shoots the code the review left. Both are short
 * hashes, of any length.
 */
export function reviewCovers(ledger, head) {
  const at = (pattern) => ledger.match(pattern)?.[1] ?? "";
  const same = (commit) => commit.length >= 7 && (head.startsWith(commit) || commit.startsWith(head));
  return same(at(/^Last reviewed: ([0-9a-f]+)/m)) || same(at(/^Deferred: .*last at ([0-9a-f]+)/m));
}

async function run(ctx, args) {
  const screens = screensHere(ctx);
  const mode = args.includes("--deep") ? "deep" : args.includes("--light") ? "light" : null;
  if (mode && !args.includes("--force")) {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ctx.root, encoding: "utf8" }).trim();
    const ledger = readFileSync(join(ctx.root, ctx.config.logs.ledger), "utf8");
    if (!reviewCovers(ledger, head)) {
      throw new Error(`a chunk-end screen review waits for the code review: the ledger has not reviewed or deferred at ${head}. Run or defer it first, or pass --force.`);
    }
  }
  const picked = await pick(ctx, args, screens);
  if (!picked) throw new Error("say --light, --deep, --defer, --chunk N, --all, or screen names; wf screens scope shows both lists");
  const shots = shotsFor(args, mode);
  ctx.headless = screensHeadless(ctx.config, mode);

  // Render the frames in scope, so a pair never shows a stale frame.
  const framed = picked.filter((screen) => screen.framed && parseReach(screen.reach)).map((screen) => screen.name);
  if (framed.length) {
    const rendered = spawnSync("python3", ["-I", ...renderArgs(designPaths(ctx.root, ctx.config), framed)], { cwd: ctx.root, encoding: "utf8" });
    if (rendered.status !== 0) console.log(`FAILED render: ${rendered.stdout}${rendered.stderr}`.trim());
  }

  const accepted = readAccepted(ctx);
  // Only this run's screens can be accepted, so an accept covers only what was read.
  // Other screens' pictures stay, so a small rerun does not lose a big run's.
  const latest = {};
  mkdirSync(ctx.latest, { recursive: true });
  const toRead = [];
  const failed = [];
  const notReached = [];
  // The project's tools are built once, such as a test-data tool each start calls.
  if (ctx.config.screens.build) {
    const built = spawnSync("sh", ["-c", ctx.config.screens.build], { cwd: ctx.root, encoding: "utf8" });
    if (built.status !== 0) throw new Error(`screens.build failed:\n${built.stderr}`);
  }
  // Each scenario is built once for the run, and copied for each start.
  const cache = join(ctx.out, "scenarios");
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  app(ctx, "stop");
  const reached = [];
  for (const screen of picked) {
    if (parseReach(screen.reach)) reached.push(screen);
    else notReached.push(`${screen.name} (${screen.reach})`);
  }
  const parallel = kwinFound(ctx) || !needsDisplay(ctx.config.app, ctx.headless ?? undefined);
  const problems = await shootAll(ctx, reached, shots, cache, jobsOf(args, availableParallelism(), parallel, ctx.config.screens.jobsMax));
  for (const screen of reached) {
    const paths = picturePaths(ctx, screen.name, shots);
    const problem = problems[screen.name];
    if (problem) {
      failed.push(`${screen.name}: ${problem}`);
      continue;
    }
    const frame = screen.framed ? framePicture(ctx, screen.name) : null;
    const now = { ...Object.fromEntries(shots.map((shot) => [shot, hashOf(paths[shot])])), frame: hashOf(frame ?? "") };
    latest[screen.name] = now;
    const reason = why(now, accepted[screen.name]);
    if (!reason) continue;
    // The default wide picture sits beside its frame, which is drawn in the default look.
    const pictures = shots.map((shot) => {
      if (shot !== "wide-default" || !frame) return paths[shot];
      const pair = join(ctx.latest, `${screen.name}-pair.png`);
      execFileSync("magick", [frame, paths[shot], "+append", pair]);
      return pair;
    });
    toRead.push({ name: screen.name, why: reason, pictures, framed: Boolean(frame) });
  }
  app(ctx, "stop");
  rmSync(cache, { recursive: true, force: true });
  writeFileSync(join(ctx.latest, "hashes.json"), JSON.stringify(latest, null, 1));
  writeFileSync(ctx.toRead, JSON.stringify(toRead, null, 1));
  writeFileSync(ctx.run, JSON.stringify({ mode, shots, failed: failed.length }, null, 1));

  console.log(`${picked.length} screens: ${toRead.length} to read, ${picked.length - toRead.length - failed.length - notReached.length} unchanged.`);
  console.log(reachLine(reachCounts(screens)));
  for (const item of toRead) {
    console.log(`  ${item.name} (${item.why}${item.framed ? "" : ", no frame"})`);
    for (const path of item.pictures) console.log(`    ${path}`);
  }
  for (const line of notReached) console.log(`not reached: ${line}`);
  for (const line of failed) console.log(`FAILED ${line}`);
  if (failed.length) process.exitCode = 1;
}

/** The listed pictures on contact sheets, for a first look that costs less. */
function sheets(ctx) {
  const items = existsSync(ctx.toRead) ? JSON.parse(readFileSync(ctx.toRead, "utf8")) : [];
  const dir = join(ctx.out, "sheets");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const pictures = items.flatMap((item) =>
    item.pictures.map((path) => [path, `${item.name} ${path.split(`${item.name}-`).pop().replace(".png", "")}`]),
  );
  for (let at = 0; at < pictures.length; at += ON_A_SHEET) {
    const out = join(dir, `sheet-${at / ON_A_SHEET}.png`);
    const labelled = pictures.slice(at, at + ON_A_SHEET).flatMap(([path, label]) => ["-label", label, path]);
    execFileSync("magick", ["montage", "-pointsize", "18", "-background", "#333", "-fill", "white", ...labelled, "-tile", "2x3", "-geometry", "900x+4+4", out]);
    console.log(out);
  }
}

/**
 * The latest hashes become the accepted ones. Only screens shot in this run
 * move, and only their pictures taken this run. While the board shows built
 * screens, each one's Default picture is copied to design.built. A light or
 * deep run also moves the state, unless a screen failed to shoot.
 */
function accept(ctx) {
  const latest = existsSync(join(ctx.latest, "hashes.json")) ? JSON.parse(readFileSync(join(ctx.latest, "hashes.json"), "utf8")) : {};
  const accepted = readAccepted(ctx);
  for (const [name, hashes] of Object.entries(latest)) accepted[name] = { ...accepted[name], ...hashes };
  writeFileSync(ctx.accepted, JSON.stringify(accepted, null, 1));
  rmSync(ctx.toRead, { force: true });
  console.log(`Accepted ${Object.keys(latest).length} screens.`);
  if (keepsBuilt(ctx.config)) {
    const { copied, removed } = keepBuilt(ctx.root, ctx.config, latest, ctx.latest);
    if (copied.length || removed.length) console.log(`Built screens for the board: ${copied.length} copied, ${removed.length} removed, in ${ctx.config.design.built}; commit them so the board shows them.`);
  }
  const run = existsSync(ctx.run) ? JSON.parse(readFileSync(ctx.run, "utf8")) : {};
  if (!run.mode) return;
  if (run.failed) {
    console.log(`The ${run.mode} run had ${run.failed} screens that did not shoot, so the state does not move. Fix them and run again.`);
    return;
  }
  const state = afterRun(readState(ctx.state), run.mode, headCommit(ctx.root));
  writeState(state, ctx.state);
  rmSync(ctx.run, { force: true });
  console.log(`The ${run.mode} run is recorded at ${state.last.slice(0, 7)}.`);
}

/** A chunk end deferred the review: count it, and shoot nothing. */
function defer(ctx) {
  const state = afterDefer(readState(ctx.state), headCommit(ctx.root));
  writeState(state, ctx.state);
  console.log(`Deferred ${state.deferred.count} times, last at ${state.deferred.at}. The lists keep growing until a run.`);
}

/** The build order and the done list, for a chunk's stories and status. */
function chunkTexts(ctx) {
  const read = (file) => (existsSync(join(ctx.root, file)) ? readFileSync(join(ctx.root, file), "utf8") : "");
  return { buildOrder: read(ctx.config.buildOrder.file), done: read(ctx.config.buildOrder.done) };
}

/** The list covers every frame row and every scenario. No app, so it can run in a project's checks. */
function check(ctx) {
  const screens = screensHere(ctx);
  const problems = coverage(screens, scenarioNames(ctx), chunkTexts(ctx), ctx.root);
  for (const line of problems) console.log(line);
  if (problems.length) {
    console.log(`${problems.length} to fix. See the screen-review skill, "The screen list".`);
    process.exitCode = 1;
  } else console.log("Every frame and scenario is on the screen list.");
  console.log(reachLine(reachCounts(screens)));
}

/** Chunk end: every frame showing the chunk's stories is reached, or waits on a later chunk. */
function gate(ctx, chunk) {
  const texts = chunkTexts(ctx);
  const stories = chunkStories(chunk, [texts.buildOrder, texts.done]);
  if (!stories) throw new Error(`no chunk ${chunk} in the build order or the done list`);
  const problems = gateProblems(screensHere(ctx), chunk, stories);
  for (const line of problems) console.log(line);
  if (problems.length) {
    console.log(`${problems.length} of chunk ${chunk}'s frames are not reached. Reach each, or with the designer's yes name a later chunk: "none, <chunk>: <reason>".`);
    process.exitCode = 1;
  } else console.log(`Every frame showing chunk ${chunk}'s stories is reached or waits on a later chunk.`);
}

/**
 * The light and deep lists from the project's screens.scope module, whose
 * lists({ root, config, state, screens }) gives { light, deep }: maps of each
 * screen's name to the changed files that put it there.
 */
async function currentLists(ctx) {
  if (!ctx.config.screens.scope) throw new Error("screens.scope is not set: the project module whose lists() gives the light and deep lists");
  const scope = await import(pathToFileURL(join(ctx.root, ctx.config.screens.scope)).href);
  const state = readState(ctx.state);
  const { light, deep } = await scope.lists({ root: ctx.root, config: ctx.config, state, screens: screensHere(ctx) });
  return { state, light, deep };
}

/** Both lists and about how long each takes, or one list's names. */
async function scope(ctx, args) {
  const { state, light, deep } = await currentLists(ctx);
  const at = args.indexOf("--names");
  if (at >= 0) {
    const list = args[at + 1] === "deep" ? deep : light;
    for (const name of [...list.keys()].sort()) console.log(name);
    return;
  }
  const minutes = (list, shots) => (list.size ? Math.max(1, Math.round((list.size * shots * SECONDS_A_SHOT) / 60)) : 0);
  console.log(`Light, since ${state.last.slice(0, 7)}: ${light.size} screens, about ${minutes(light, 1)} min for Default.`);
  for (const [name, why] of [...light].sort()) console.log(`  ${name}  (${why.join(", ")})`);
  console.log(`Deep, since ${state.deep.slice(0, 7)}: ${deep.size} screens, about ${minutes(deep, 4)} min for Default, Narrow, and Stress.`);
  const shared = [...new Set([...deep.values()].flat())].filter((path) => ![...light.values()].flat().includes(path));
  if (shared.length) console.log(`  reached through: ${shared.join(", ")}`);
  if (state.lightRuns.length) console.log(`Light runs waiting: ${state.lightRuns.join("; ")}`);
  if (state.deferred.count) console.log(`Deferred: ${state.deferred.count} times, last at ${state.deferred.at}`);
}

/**
 * The listed screens as briefs for the screen-reader agent, `size` to a brief:
 * each screen's name, why it is listed, its stories, what its row says it
 * shows, and its pictures.
 */
export function briefs(items, screens, size = IN_A_BRIEF) {
  const rows = new Map(screens.map((screen) => [screen.name, screen]));
  const out = [];
  for (let at = 0; at < items.length; at += size) {
    const lines = [];
    for (const item of items.slice(at, at + size)) {
      const row = rows.get(item.name) ?? {};
      const [lead, ...bullets] = captionLines(row.caption);
      lines.push(
        `## ${item.name}`,
        "",
        `- Listed: ${item.why}${item.framed ? "" : ", no frame"}`,
        `- Stories: ${(row.stories ?? []).join(", ") || "none"}`,
        `- Shows: ${lead ?? "(no caption)"}`,
        ...bullets.map((bullet) => `  - ${bullet}`),
        "- Pictures:",
        ...item.pictures.map((path) => `  - ${path}${path.endsWith("-pair.png") ? " (frame left, app right)" : ""}`),
        "",
      );
    }
    out.push(lines.join("\n"));
  }
  return out;
}

/** Write the briefs to .cache/screens/briefs, and print each path and the reader's model. */
function writeBriefs(ctx) {
  const items = existsSync(ctx.toRead) ? JSON.parse(readFileSync(ctx.toRead, "utf8")) : [];
  const dir = join(ctx.out, "briefs");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  briefs(items, screensHere(ctx)).forEach((text, at) => {
    const path = join(dir, `brief-${at + 1}.md`);
    writeFileSync(path, text);
    console.log(path);
  });
  console.log(items.length ? `Run one screen-reader a brief, on ${ctx.config.screens.readerModel}.` : "Nothing listed to read.");
}

/** `wf screens ...`; resolves to the exit code. */
export async function screens(root, config, args) {
  const ctx = runContext(root, config);
  if (args[0] === "scope") await scope(ctx, args.slice(1));
  else if (args.includes("--check")) check(ctx);
  else if (args.includes("--gate")) gate(ctx, args[args.indexOf("--gate") + 1]);
  else if (args.includes("--accept")) accept(ctx);
  else if (args.includes("--defer")) defer(ctx);
  else if (args.includes("--sheets")) sheets(ctx);
  else if (args.includes("--brief")) writeBriefs(ctx);
  else if (args.includes("--worker")) worker(ctx, args[args.indexOf("--worker") + 1]);
  else await run(ctx, args);
  return process.exitCode ?? 0;
}
