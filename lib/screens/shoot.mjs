// How `wf screens` takes its pictures: one session per size on `wf app`, and
// with several jobs, worker processes at once, each on its own app instance
// and, when the run shows on virtual displays, its own display. run.mjs decides what
// to shoot and reads the results; this module only shoots.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import { KIT_ROOT } from "../setup/ai.mjs";
import { allScreens, parseReach } from "./list.mjs";

// The kit's own command line, run by its path so no shell or npx sits between.
const WF = join(KIT_ROOT, "bin", "wf.mjs");

const SIZES = ["wide", "narrow"];

/**
 * The pictures a run takes, such as "wide-default": each ticked viewport as a
 * new install shows it, and in the stress look too when --stress is ticked.
 * With no viewport ticked, every run takes Default only: wide, as a new install
 * shows it. Narrow and the stress look are taken only when asked for.
 */
export function shotsFor(args, mode) {
  const sizes = SIZES.filter((size) => args.includes(`--${size}`));
  const stress = args.includes("--stress");
  if (sizes.length === 0) {
    if (stress) throw new Error("--stress needs a viewport: --wide, --narrow, or both");
    return ["wide-default"];
  }
  return sizes.flatMap((size) => (stress ? [`${size}-default`, `${size}-stress`] : [`${size}-default`]));
}

/** What stops these pictures: a narrow or stress picture the project has not set up. Null when none. */
export function shotsProblem(shots, config) {
  if (shots.some((shot) => shot.startsWith("narrow-")) && !config.screens.narrow) return "set screens.narrow, such as \"800x560\", to take narrow pictures";
  if (shots.some((shot) => shot.endsWith("-stress")) && Object.keys(config.screens.stress ?? {}).length === 0) return "set screens.stress, the data attributes of the stress look, to take stress pictures";
  return null;
}

/** Which of screens.runs a run is: review for a chunk-end --light or --deep run, build for any other. */
export const runKind = (mode) => (mode ? "review" : "build");

/**
 * Where a run's apps show: --show for one run, else screens.runs.<kind>.show,
 * where "auto" is headless for a web app and virtual for any other. "screen"
 * is one app on the person's screen, "virtual" each app on its own KWin
 * virtual display, and "headless" a web app's browser with no window.
 */
export function showFor(config, mode, args = []) {
  const at = args.indexOf("--show");
  const from = at >= 0 ? "--show" : `screens.runs.${runKind(mode)}.show`;
  const given = at >= 0 ? args[at + 1] : config.screens.runs[runKind(mode)].show;
  const web = config.app.kind === "web";
  const show = given === "auto" ? (web ? "headless" : "virtual") : given;
  if (!["screen", "virtual", "headless"].includes(show)) throw new Error(`${from} is screen, virtual, headless, or auto, not ${JSON.stringify(given ?? "")}`);
  if (show === "headless" && !web) throw new Error(`${from} is headless, which is for a web app's browser; an app's window is screen or virtual`);
  return show;
}

/**
 * How many apps shoot at once: one on the person's screen, else --jobs, or
 * the run kind's jobs held to the number of cores. Throws on --jobs above one
 * with "screen", since covered windows are not painted.
 */
export function jobsFor(config, mode, show, args = [], cores = availableParallelism()) {
  const at = args.indexOf("--jobs");
  const asked = at >= 0 ? Number(args[at + 1]) : null;
  if (asked !== null && (!Number.isInteger(asked) || asked < 1 || asked > 16)) throw new Error("usage: --jobs N, from 1 to 16");
  if (show === "screen") {
    if (asked > 1) throw new Error(`--jobs ${asked} needs the apps off the person's screen: add --show virtual${config.app.kind === "web" ? " or --show headless" : ""}`);
    return 1;
  }
  return asked ?? Math.max(1, Math.min(config.screens.runs[runKind(mode)].jobs, cores));
}

export function app(ctx, ...args) {
  const env = { ...process.env, [ctx.config.app.instanceEnv]: String(ctx.instance) };
  const res = spawnSync("node", [WF, "app", ...args], { cwd: ctx.root, encoding: "utf8", env });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
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

/** Where a screen's pictures go in this run. */
export function picturePaths(ctx, name, shots) {
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

/** Whether virtual displays can start here: kwin_wayland is on the PATH, on Linux. */
export function kwinFound() {
  return process.platform === "linux" && spawnSync("sh", ["-c", "command -v kwin_wayland"]).status === 0;
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
 * What keeps a virtual KWin apart from the person's own desktop: an empty
 * config folder, so it runs none of their KWin scripts, such as a tiling
 * script that would also tile the app's window, and its own D-Bus session,
 * so nothing it registers, such as a script's global shortcuts, reaches
 * theirs. A virtual KWin on the person's bus took over Krohnkite's
 * shortcuts, and they stopped working when it stopped (2026-11-16).
 */
export function displayApart(runtime, unit, has = (name) => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0) {
  const config = join(runtime, `${unit}-config`);
  rmSync(config, { recursive: true, force: true });
  mkdirSync(config, { recursive: true });
  return [`--setenv=XDG_CONFIG_HOME=${config}`, ...(has("dbus-run-session") ? ["dbus-run-session", "--"] : [])];
}

/**
 * A virtual KWin display for one parallel app, off the user's screen, as a
 * user unit with a memory cap. Its socket, its unit, or the problem.
 */
function virtualDisplay(ctx, id) {
  const unit = `${ctx.config.app.name}-agent-display-${id}`;
  const socket = `${ctx.config.app.name}-shot-${id}`;
  spawnSync("systemctl", ["--user", "stop", unit]);
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
  const started = spawnSync("systemd-run", [
    "--user", `--unit=${unit}`, "--collect", "--quiet", "-p", "MemoryMax=1G",
    ...displayApart(runtime, unit),
    "kwin_wayland", "--virtual", "--socket", socket, "--width", "1300", "--height", "820", "--no-lockscreen", "--no-global-shortcuts",
  ], { encoding: "utf8" });
  if (started.status !== 0) return { problem: `no virtual display: ${started.stderr.trim()} (needs kwin_wayland)` };
  const path = join(runtime, socket);
  for (let i = 0; i < 50 && !existsSync(path); i++) spawnSync("sleep", ["0.1"]);
  if (!existsSync(path)) return { problem: `the virtual display ${socket} did not start` };
  return { socket, unit };
}

/** Shoot every screen, on N apps at once, each its own worker process. Each screen's problem, or null. */
export async function shootAll(ctx, screens, shots, cache, jobs) {
  // One app on the person's screen, or one headless browser, shoots here; a virtual display needs a worker of its own, even for one.
  if (jobs === 1 && ctx.show !== "virtual") return Object.fromEntries(screens.map((screen) => [screen.name, shootScreen(ctx, screen, shots, cache)]));
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
      const display = ctx.show === "virtual" ? virtualDisplay(ctx, at + 1) : {};
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
export function worker(ctx, file) {
  ctx.instance = Number(process.env[ctx.config.app.instanceEnv] ?? 0);
  const { names, shots, cache, headless: jobHeadless } = JSON.parse(readFileSync(file, "utf8"));
  ctx.headless = jobHeadless ?? null;
  const screens = allScreens(ctx.root, ctx.config).filter((screen) => names.includes(screen.name));
  const problems = Object.fromEntries(screens.map((screen) => [screen.name, shootScreen(ctx, screen, shots, cache)]));
  app(ctx, "stop");
  process.stdout.write(JSON.stringify(problems));
}
