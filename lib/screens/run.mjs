// `wf screens`: the one screen check. A run is light, deep, or deferred, and
// takes the pictures ticked for it:
//
//   --wide    Default: the app's own window, beside its frame
//   --narrow  screens.narrow, the whole page, scrolled and joined; only when it is set
//   --stress  also each ticked viewport in the stress look, screens.stress; only when it is set
//
// Each ticked viewport is shot as a new install shows it, and in the stress
// look too when it is ticked. A screen is listed to read when one of its
// pictures or its frame changed since the last accept, or it is new. The
// frames in scope are rendered from their HTML first, so a pair never shows a
// stale frame. The app is driven through `wf app`.
//
//   wf screens --light [pictures]   the light list (default: --wide)
//   wf screens --deep [pictures]    the light and deep lists (default: --wide)
//   wf screens --defer              count a deferred chunk end; nothing is shot
//   wf screens <screen> ...         these screens (default: --wide)
//   wf screens --chunk CH-30 | --all  the chunk's screens, or every screen
//   --area uplink[,app]             only these areas' screens, with any of the above, or alone
//                                   for all of them; a light or deep run so narrowed does not
//                                   move the state, since the other areas were not looked at
//   wf screens scope [--names light|deep|open] [--area a]   both lists, from the project's screens.scope
//                                   module, or the screens a partial accept left open
//   wf screens --sheets             the listed pictures, six to a sheet
//   wf screens --brief              the listed screens as briefs for the screen-reader agent
//   wf screens --accept             the run's pictures become the accepted ones, and
//                                   each Default is copied to design.built for the board's
//                                   Built screens; a light or deep run also moves the state
//   wf screens --accept <screen> ...           only these of the run's screens
//   wf screens --accept --except <screen> ...  all of the run's screens but these; either
//                                   takes @<file>, one name a line. The changed screens left
//                                   out stay listed to read, and after a light or deep run
//                                   they are kept in the state as open, on the deep list
//   wf screens --check              the list covers every frame and scenario, and each
//                                   unreached frame names an open chunk (no app)
//   wf screens --gate CH-35         chunk end: the chunk's frames are reached or wait on a later chunk
//
//   --force    run --light or --deep before the code review has run or been
//              deferred at this commit; a chunk end waits for it otherwise
//   --show W   where this run's apps show: screen (one, on the person's
//              screen), virtual (each on its own KWin virtual display), or
//              headless (a web app's browser, no window); else screens.runs
//              review for --light and --deep, build for any other run
//   --jobs N   this many apps at once, with virtual or headless; else that
//              kind of run's jobs, held to the number of cores
//
// Every default is Default, as a new install shows it; --narrow and --stress
// are for when they are asked for.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { designPaths, findFrame } from "../design/frames.mjs";
import { renderArgs } from "../design/index.mjs";
import { readBuildOrder } from "../docs/shape.mjs";
import { captionLines } from "../design/storyboard.mjs";
import { keepBuilt, keepsBuilt } from "./built.mjs";
import { allScreens, chunkStories, coverage, gateProblems, parseReach, reachCounts, reachLine } from "./list.mjs";
import { app, jobsFor, kwinFound, picturePaths, runKind, shootAll, shotsFor, shotsProblem, showFor, worker } from "./shoot.mjs";
import { afterDefer, afterRun, headCommit, openAfter, readState, recordDir, withRecordLock, writeRecord, writeState } from "./state.mjs";

const ON_A_SHEET = 6;
/** Pictures one screen-reader agent reads, so each agent's context stays small. */
export const PICTURES_IN_A_BRIEF = 24;
/** One app start and its steps, at about three seconds. */
export const SECONDS_A_SHOT = 3;

/**
 * One run's context: the project, its config, where the run keeps its
 * pictures, and the app instance and browser mode it shoots with. Passed to
 * each step, so a second run in one process never sees the last one's.
 */
export function runContext(root, config) {
  const out = join(root, ".cache/screens");
  const record = recordDir(root);
  const latest = join(out, "latest");
  return {
    root,
    config,
    out,
    latest,
    // The record is shared by every worktree; the run's pictures and lists are this checkout's own.
    record,
    accepted: join(record, "accepted.json"),
    run: join(latest, "run.json"),
    toRead: join(out, "to-read.json"),
    state: join(record, "state.json"),
    instance: 0,
    // Whether this run's web browsers run headless, from where it shows; set by run(), and by a worker from its job.
    headless: null,
    // Where this run's apps show: screen, virtual, or headless; set by run().
    show: null,
  };
}
const screensHere = (ctx) => allScreens(ctx.root, ctx.config);

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

/** The areas --area names, or null without it. Throws on an area the config does not have. */
export function areasOf(args, config) {
  const at = args.indexOf("--area");
  if (at < 0) return null;
  const ids = (args[at + 1] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const have = config.areas.filter((area) => area.docs).map((area) => area.id);
  const unknown = ids.filter((id) => !have.includes(id));
  if (ids.length === 0 || unknown.length) throw new Error(`usage: --area ${have.join("|")}, or several joined by commas${unknown.length ? `; no area ${unknown.join(", ")}` : ""}`);
  return ids;
}

/** Only the screens whose list is in one of these areas. */
export function inAreas(screens, ids, root, config) {
  if (!ids) return screens;
  const files = config.areas.filter((area) => ids.includes(area.id) && area.docs).map((area) => join(root, area.docs, config.design.screens));
  return screens.filter((screen) => files.includes(screen.file));
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
  const names = args.filter((arg, at) => !arg.startsWith("--") && !["--jobs", "--area", "--show"].includes(args[at - 1]));
  if (names.length > 0) {
    const unknown = names.filter((name) => !screens.some((screen) => screen.name === name));
    if (unknown.length) throw new Error(`no screen called ${unknown.join(", ")} in any screens.md`);
    return screens.filter((screen) => names.includes(screen.name));
  }
  return null;
}

/**
 * Whether the code review ledger has reviewed or deferred at this commit, so a
 * chunk-end screen review shoots the code the review left. Both are short
 * hashes, of any length. A named commit also covers HEAD when `ledgerOnlyAfter`
 * says every commit after it changes only the ledger, since the ledger edit is
 * committed after the commit it names.
 */
export function reviewCovers(ledger, head, ledgerOnlyAfter = () => false) {
  const at = (pattern) => ledger.match(pattern)?.[1] ?? "";
  const covers = (commit) => commit.length >= 7 && (head.startsWith(commit) || commit.startsWith(head) || ledgerOnlyAfter(commit));
  return covers(at(/^Last reviewed: ([0-9a-f]+)/m)) || covers(at(/^Deferred: .*last at ([0-9a-f]+)/m));
}

/**
 * Whether a commit is on HEAD's history and each commit after it changes only
 * the ledger files, in the git repository at `root`.
 */
export function ledgerOnlyAfter(root, ledgerFiles) {
  return (commit) => {
    const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (git("merge-base", "--is-ancestor", commit, "HEAD").status !== 0) return false;
    // -m lists a merge's files too, and --no-renames both names of a move.
    const log = git("log", "-m", "--no-renames", "--format=", "--name-only", `${commit}..HEAD`);
    if (log.status !== 0) return false;
    return log.stdout.split("\n").filter(Boolean).every((file) => ledgerFiles.includes(file));
  };
}

/** The ledger and its closed file, which a review or deferral writes. */
export const ledgerFiles = (config) => [config.logs.ledger, config.logs.ledgerClosed].filter(Boolean);

/**
 * Where a run's apps show and how many at once, and the line that says so.
 * A run set to virtual displays where they cannot start shows on the
 * person's screen, one at a time, and says why; the config is not changed.
 */
export function whereRuns(config, mode, args = [], found = kwinFound, cores = availableParallelism()) {
  let show = showFor(config, mode, args);
  let note = "";
  if (show === "virtual" && !found()) {
    show = "screen";
    note = ": virtual displays need kwin_wayland on Linux, which is not here";
  }
  const jobs = jobsFor(config, mode, show, args, cores);
  const place = { screen: "on your screen", virtual: "on virtual displays, off your screen", headless: "headless, with no window" }[show];
  return { show, jobs, line: `A ${runKind(mode)} run: ${jobs === 1 ? "one app" : `${jobs} apps at once`}, ${place}${note}.` };
}

/** The screens.* keys before v0.87.0, which screens.runs replaced; a project still setting one is told what to write. */
export function retiredRuns(config) {
  const old = config.screens ?? {};
  if (old.headless === undefined && old.jobsMax === undefined && old.display === undefined) return null;
  const web = config.app?.kind === "web";
  const runs = {};
  for (const kind of ["review", "build"]) {
    const headless = old.headless?.[kind] ?? (web ? config.app.web.headless : null);
    // false always meant "on the person's screen"; true is headless for a browser, a virtual display for a window.
    let show = old.headless?.[kind] === false ? "screen" : web && headless ? "headless" : "virtual";
    if (show === "virtual" && old.display === "none") show = "screen";
    runs[kind] = show === "screen" ? { show } : { show, jobs: old.jobsMax ?? 8 };
  }
  return runs;
}

async function run(ctx, args) {
  const screens = screensHere(ctx);
  const mode = args.includes("--deep") ? "deep" : args.includes("--light") ? "light" : null;
  if (mode && !args.includes("--force")) {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ctx.root, encoding: "utf8" }).trim();
    const ledger = readFileSync(join(ctx.root, ctx.config.logs.ledger), "utf8");
    if (!reviewCovers(ledger, head, ledgerOnlyAfter(ctx.root, ledgerFiles(ctx.config)))) {
      throw new Error(`a chunk-end screen review waits for the code review: the ledger has not reviewed or deferred at ${head}. Run or defer it first, or pass --force.`);
    }
  }
  const areas = areasOf(args, ctx.config);
  const chosen = await pick(ctx, args, screens);
  if (!chosen && !areas) throw new Error("say --light, --deep, --defer, --chunk N, --all, --area A, or screen names; wf screens scope shows both lists");
  const picked = inAreas(chosen ?? screens, areas, ctx.root, ctx.config);
  const shots = shotsFor(args, mode);
  const unset = shotsProblem(shots, ctx.config);
  if (unset) throw new Error(unset);
  const where = whereRuns(ctx.config, mode, args);
  ctx.show = where.show;
  ctx.headless = ctx.config.app.kind === "web" ? where.show === "headless" : null;
  console.log(where.line);

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
  const problems = await shootAll(ctx, reached, shots, cache, where.jobs);
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
  writeFileSync(ctx.run, JSON.stringify({ mode, shots, failed: failed.length, ...(areas ? { areas } : {}) }, null, 1));

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
 * The names an accept was given, with each @<file> read as one name a line.
 * `--except` and the flags are not names.
 */
export function acceptNames(args, root) {
  return args
    .filter((arg) => !arg.startsWith("--"))
    .flatMap((arg) => (arg.startsWith("@") ? readFileSync(join(root, arg.slice(1)), "utf8").split("\n") : [arg]))
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Which of a run's screens an accept takes: all of them, only the named
 * ones, or with `except` all but the named ones. Throws on a name the run
 * did not shoot, so a mistyped name accepts nothing.
 */
export function takenBy(latest, names, except) {
  const all = Object.keys(latest);
  const unknown = names.filter((name) => !(name in latest));
  if (unknown.length) throw new Error(`not in the last run: ${unknown.join(", ")}. Nothing was accepted.`);
  if (except && !names.length) throw new Error("usage: wf screens --accept --except <screen> ..., or @<file> with one name a line");
  if (!names.length) return all;
  return except ? all.filter((name) => !names.includes(name)) : all.filter((name) => names.includes(name));
}

/**
 * The latest hashes become the accepted ones: the whole run's, or only the
 * screens named, or with --except all but those. Only screens shot in this
 * run move, and only their pictures taken this run. While the board shows
 * built screens, each one's Default picture is copied to design.built. A
 * light or deep run also moves the state, unless a screen failed to shoot.
 *
 * A changed screen left out stays in the run's list to read, so it can be
 * accepted later, and after a light or deep run it is kept in the state as
 * open: the marks move, and it stays on the deep list until an accept takes it.
 */
function accept(ctx, args = []) {
  const hashes = join(ctx.latest, "hashes.json");
  const latest = existsSync(hashes) ? JSON.parse(readFileSync(hashes, "utf8")) : {};
  const taken = takenBy(latest, acceptNames(args, ctx.root), args.includes("--except"));
  const took = Object.fromEntries(taken.map((name) => [name, latest[name]]));
  const rest = Object.fromEntries(Object.entries(latest).filter(([name]) => !taken.includes(name)));
  // A screen left out that did not change is as accepted as it was; only the changed ones stay open.
  let leftOut = [];
  withRecordLock(ctx.record, () => {
    const accepted = readAccepted(ctx);
    leftOut = Object.keys(rest).filter((name) => why(rest[name], accepted[name]));
    for (const [name, now] of Object.entries(took)) accepted[name] = { ...accepted[name], ...now };
    writeRecord(ctx.accepted, JSON.stringify(accepted, null, 1));
  });
  const toRead = existsSync(ctx.toRead) ? JSON.parse(readFileSync(ctx.toRead, "utf8")).filter((item) => leftOut.includes(item.name)) : [];
  if (toRead.length) writeFileSync(ctx.toRead, JSON.stringify(toRead, null, 1));
  else rmSync(ctx.toRead, { force: true });
  if (existsSync(hashes)) writeFileSync(hashes, JSON.stringify(rest, null, 1));
  const shared = ctx.record !== join(realpathSync(ctx.root), ".cache/screens");
  console.log(`Accepted ${taken.length} screens${leftOut.length ? `, left ${leftOut.length} to read` : ""}${shared ? `, in ${ctx.record}, which every worktree shares` : ""}.`);
  if (keepsBuilt(ctx.config)) {
    const { copied, removed } = keepBuilt(ctx.root, ctx.config, took, ctx.latest);
    if (copied.length || removed.length) console.log(`Built screens for the board: ${copied.length} copied, ${removed.length} removed, in ${ctx.config.design.built}; commit them so the board shows them.`);
  }
  const run = existsSync(ctx.run) ? JSON.parse(readFileSync(ctx.run, "utf8")) : {};
  const listed = screensHere(ctx).map((screen) => screen.name);
  // An accept that does not move the marks still closes the open screens it took.
  const close = () =>
    withRecordLock(ctx.record, () => {
      const state = readState(ctx.state, undefined, ctx.root);
      if (taken.some((name) => name in state.open)) writeState({ ...state, open: openAfter(state.open, taken, [], "", listed) }, ctx.state);
    });
  if (!run.mode) return close();
  if (run.areas) {
    console.log(`The ${run.mode} run covered only ${run.areas.join(", ")}, so the state does not move: the other areas were not looked at.`);
    if (!leftOut.length) rmSync(ctx.run, { force: true });
    return close();
  }
  if (run.failed) {
    console.log(`The ${run.mode} run had ${run.failed} screens that did not shoot, so the state does not move. Fix them and run again.`);
    return close();
  }
  const state = withRecordLock(ctx.record, () => {
    const before = readState(ctx.state, undefined, ctx.root);
    const at = headCommit(ctx.root);
    const next = afterRun(before, run.mode, at, openAfter(before.open, taken, leftOut, at, listed));
    writeState(next, ctx.state);
    return next;
  });
  // The run is recorded once; a later accept of the screens left out only closes them.
  if (leftOut.length) writeFileSync(ctx.run, JSON.stringify({ ...run, mode: null }, null, 1));
  else rmSync(ctx.run, { force: true });
  console.log(`The ${run.mode} run is recorded at ${state.last.slice(0, 7)}.`);
  const open = Object.keys(state.open);
  if (open.length) console.log(`Left open: ${open.length} screens, on the deep list until accepted. wf screens scope --names open lists them.`);
}

/** A chunk end deferred the review: count it, and shoot nothing. */
function defer(ctx) {
  const state = withRecordLock(ctx.record, () => {
    const next = afterDefer(readState(ctx.state, undefined, ctx.root), headCommit(ctx.root));
    writeState(next, ctx.state);
    return next;
  });
  console.log(`Deferred ${state.deferred.count} times, last at ${state.deferred.at}. The lists keep growing until a run.`);
}

/** The build order and the done list, for a chunk's stories and status. */
function chunkTexts(ctx) {
  return readBuildOrder(ctx.root, ctx.config);
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
  const state = readState(ctx.state, undefined, ctx.root);
  const screens = screensHere(ctx);
  const lists = await scope.lists({ root: ctx.root, config: ctx.config, state, screens });
  return { state, ...withOpen(lists, state.open, screens.map((screen) => screen.name)) };
}

/** Why an open screen is on the deep list. */
const OPEN_WHY = "left open at ";

/**
 * The lists with the screens a partial accept left open: each still on the
 * screen list joins the deep list, and leaves the light one, since a screen
 * on both is on the deep list only. `open` is those screens, name to commit.
 */
export function withOpen({ light, deep }, held, names) {
  const open = new Map(Object.entries(held ?? {}).filter(([name]) => names.includes(name)));
  const [lightNow, deepNow] = [new Map(light), new Map(deep)];
  for (const [name, at] of open) {
    deepNow.set(name, [...(deepNow.get(name) ?? lightNow.get(name) ?? []), `${OPEN_WHY}${at}`]);
    lightNow.delete(name);
  }
  return { light: lightNow, deep: deepNow, open };
}

/** Both lists and about how long each takes, or one list's names. */
async function scope(ctx, args) {
  const { state, light: allLight, deep: allDeep, open: allOpen } = await currentLists(ctx);
  const areas = areasOf(args, ctx.config);
  const mine = new Set(inAreas(screensHere(ctx), areas, ctx.root, ctx.config).map((screen) => screen.name));
  const only = (list) => (areas ? new Map([...list].filter(([name]) => mine.has(name))) : list);
  const [light, deep, open] = [only(allLight), only(allDeep), only(allOpen)];
  if (areas) console.log(`Only ${areas.join(", ")}.`);
  const at = args.indexOf("--names");
  if (at >= 0) {
    const list = { deep, open }[args[at + 1]] ?? light;
    for (const name of [...list.keys()].sort()) console.log(name);
    return;
  }
  const minutes = (list, shots) => (list.size ? Math.max(1, Math.round((list.size * shots * SECONDS_A_SHOT) / 60)) : 0);
  console.log(`Light, since ${state.last.slice(0, 7)}: ${light.size} screens, about ${minutes(light, 1)} min for Default.`);
  for (const [name, why] of [...light].sort()) console.log(`  ${name}  (${why.join(", ")})`);
  console.log(`Deep, since ${state.deep.slice(0, 7)}: ${deep.size} screens, about ${minutes(deep, 1)} min for Default.`);
  const shared = [...new Set([...deep.values()].flat())].filter((path) => !path.startsWith(OPEN_WHY) && ![...light.values()].flat().includes(path));
  if (shared.length) console.log(`  reached through: ${shared.join(", ")}`);
  if (state.lightRuns.length) console.log(`Light runs waiting: ${state.lightRuns.join("; ")}`);
  if (state.deferred.count) console.log(`Deferred: ${state.deferred.count} times, last at ${state.deferred.at}`);
  if (open.size) console.log(`Left open: ${open.size} of the deep list's screens, from a partial accept. wf screens scope --names open lists them.`);
}

/**
 * The listed screens as briefs for the screen-reader agent: each screen's
 * name, why it is listed, its stories, what its row says it shows, and its
 * pictures. A brief holds whole screens, up to `size` pictures, so a run of
 * one picture a screen needs fewer readers than one with narrow and stress
 * pictures. A screen with more pictures than that has a brief of its own.
 */
export function briefs(items, screens, size = PICTURES_IN_A_BRIEF) {
  const rows = new Map(screens.map((screen) => [screen.name, screen]));
  const groups = [];
  let held = 0;
  for (const item of items) {
    const count = Math.max(1, item.pictures.length);
    if (!groups.length || held + count > size) {
      groups.push([]);
      held = 0;
    }
    groups.at(-1).push(item);
    held += count;
  }
  const out = [];
  for (const group of groups) {
    const lines = [];
    for (const item of group) {
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
  const moved = retiredRuns(config);
  if (moved) console.log(`screens.headless, screens.jobsMax, and screens.display do nothing since v0.87.0; write this in .workflow/config.json in their place: "screens": { "runs": ${JSON.stringify(moved)} }`);
  if (args[0] === "scope") await scope(ctx, args.slice(1));
  else if (args.includes("--check")) check(ctx);
  else if (args.includes("--gate")) gate(ctx, args[args.indexOf("--gate") + 1]);
  else if (args.includes("--accept")) accept(ctx, args);
  else if (args.includes("--defer")) defer(ctx);
  else if (args.includes("--sheets")) sheets(ctx);
  else if (args.includes("--brief")) writeBriefs(ctx);
  else if (args.includes("--worker")) worker(ctx, args[args.indexOf("--worker") + 1]);
  else await run(ctx, args);
  return process.exitCode ?? 0;
}
