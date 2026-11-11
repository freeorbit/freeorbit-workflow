// How `wf screens` takes its pictures: one session per size on `wf app`, and
// with --jobs N, N worker processes at once, each on its own app instance
// and, when the app needs one, its own virtual display. run.mjs decides what
// to shoot and reads the results; this module only shoots.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * Whether a screen run's web browser runs headless: screens.headless.review
 * for a chunk-end --light or --deep run, screens.headless.build for named
 * screens, a chunk, or all; null in either follows app.web.headless.
 */
export function screensHeadless(config, mode) {
  const set = mode ? config.screens.headless.review : config.screens.headless.build;
  return set ?? config.app.web.headless;
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

/** Whether the virtual displays can start: screens.display is kwin and kwin_wayland is on the PATH. */
export function kwinFound(ctx) {
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
  const path = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`, socket);
  for (let i = 0; i < 50 && !existsSync(path); i++) spawnSync("sleep", ["0.1"]);
  if (!existsSync(path)) return { problem: `the virtual display ${socket} did not start` };
  return { socket, unit };
}

/** Whether a parallel app needs a display of its own: a Tauri window, or a web app's browser when this run is not headless. */
export function needsDisplay(app, runHeadless = app.web.headless) {
  return app.kind !== "web" || !runHeadless;
}

/** Shoot every screen, on N apps at once, each its own worker process. Each screen's problem, or null. */
export async function shootAll(ctx, screens, shots, cache, jobs) {
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
export function worker(ctx, file) {
  ctx.instance = Number(process.env[ctx.config.app.instanceEnv] ?? 0);
  const { names, shots, cache, headless: jobHeadless } = JSON.parse(readFileSync(file, "utf8"));
  ctx.headless = jobHeadless ?? null;
  const screens = allScreens(ctx.root, ctx.config).filter((screen) => names.includes(screen.name));
  const problems = Object.fromEntries(screens.map((screen) => [screen.name, shootScreen(ctx, screen, shots, cache)]));
  app(ctx, "stop");
  process.stdout.write(JSON.stringify(problems));
}
