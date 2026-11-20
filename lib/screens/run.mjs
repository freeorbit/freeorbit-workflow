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
//                                   for all of them
//   wf screens scope [--names light|deep] [--area a]   both lists, from each picture's own mark
//                                   and the project's screens.scope module
//   wf screens --sheets             the listed pictures, six to a sheet
//   wf screens --brief              the listed screens as briefs for the screen-reader agent
//   wf screens --accept             the run's pictures become the accepted ones, each is
//                                   marked at the commit the run was shot at, and each
//                                   Default is copied to design.built for the board's Built
//                                   screens; any run marks what it took, what it could not
//                                   reach, and screens nothing has reached since their marks
//   wf screens --accept <screen> ...           only these of the run's screens
//   wf screens --accept --except <screen> ...  all of the run's screens but these; either
//                                   takes @<file>, one name a line. The changed screens left
//                                   out stay listed to read, and keep their marks, so they
//                                   stay due
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

import { designPaths, frameFiles } from "../design/frames.mjs";
import { renderArgs } from "../design/index.mjs";
import { readBuildOrder } from "../docs/shape.mjs";
import { captionLines } from "../design/storyboard.mjs";
import { keepBuilt, keepsBuilt } from "./built.mjs";
import { allScreens, chunkStories, coverage, gateProblems, parseReach, reachCounts, reachLine } from "./list.mjs";
import { app, jobsFor, kwinFound, picturePaths, runKind, shootAll, shotsFor, shotsProblem, showFor, worker } from "./shoot.mjs";
import { afterAccept, afterDefer, ancestorsOf, fromV1, headCommit, markOf, readState, recordDir, withRecordLock, writeRecord, writeState } from "./state.mjs";
import { flagValue } from "../process.mjs";
import { retiredRuns } from "../config/config.mjs";
import { reviewCoversHead } from "../review.mjs";

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

/** The rendered PNG for a framed screen, by its name. The frames are walked once a run, then looked up by name (P-5). */
function framePicture(ctx, name) {
  if (!ctx.frames) {
    ctx.frames = new Map();
    for (const frame of frameFiles(designPaths(ctx.root, ctx.config))) if (!ctx.frames.has(frame.name)) ctx.frames.set(frame.name, frame);
  }
  const frame = ctx.frames.get(name);
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
    const { light, deep } = await currentLists(ctx, shotsFor(args, mode));
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

async function run(ctx, args) {
  const screens = screensHere(ctx);
  const mode = args.includes("--deep") ? "deep" : args.includes("--light") ? "light" : null;
  if (mode && !args.includes("--force")) {
    const { covers, head } = reviewCoversHead(ctx.root, ctx.config);
    if (!covers) {
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
  const failedNames = [];
  const notReached = [];
  const unreached = [];
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
    else {
      notReached.push(`${screen.name} (${screen.reach})`);
      unreached.push(screen.name);
    }
  }
  const problems = await shootAll(ctx, reached, shots, cache, where.jobs);
  for (const screen of reached) {
    const paths = picturePaths(ctx, screen.name, shots);
    const problem = problems[screen.name];
    if (problem) {
      failed.push(`${screen.name}: ${problem}`);
      failedNames.push(screen.name);
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
  // Where the run was shot, so an accept later marks the commit its pictures show, not the one it is made at;
  // whether tracked files had changes then, since those pictures show code no commit holds.
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ctx.root, encoding: "utf8" }).stdout.trim() !== "";
  writeFileSync(ctx.run, JSON.stringify({ mode, shots, at: headCommit(ctx.root), dirty, failed: failed.length, failedNames, unreached, ...(areas ? { areas } : {}) }, null, 1));

  console.log(`${picked.length} screens: ${toRead.length} to read, ${picked.length - toRead.length - failed.length - notReached.length} unchanged.`);
  console.log(reachLine(reachCounts(screens)));
  for (const item of toRead) {
    console.log(`  ${item.name} (${item.why}${item.framed ? "" : ", no frame"})`);
    for (const path of item.pictures) console.log(`    ${path}`);
  }
  for (const line of notReached) console.log(`not reached: ${line}`);
  for (const line of failed) console.log(`FAILED ${line}`);
  return failed.length ? 1 : 0;
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
 * The pictures an accept moves forward with it, as [screen, picture]: each of
 * a screen's own pictures nothing has reached since its mark, so the marks
 * stay a few commits and not one for every run. None when the run was shot
 * with uncommitted changes, or there is no screens.scope to say what is due;
 * never a screen `held`; and only a mark on the history of `at`, so a mark is
 * never moved back.
 */
async function settledPictures(ctx, state, listed, at, run, held) {
  if (run.dirty || !ctx.config.screens.scope) return [];
  const own = (name) => {
    const shots = Object.keys(state.marks[name] ?? {});
    return shots.length ? shots : ["wide-default"];
  };
  const lists = listsFrom(ctx, state);
  const pairs = [];
  for (const shot of new Set(listed.flatMap(own))) {
    const names = listed.filter((name) => own(name).includes(shot) && !held.has(name));
    const { deep } = await dueLists(names, state, [shot], lists);
    for (const name of names) if (!deep.has(name)) pairs.push([name, shot]);
  }
  const onHistory = ancestorsOf(ctx.root, pairs.map(([name, shot]) => markOf(state, name, shot)), at);
  return pairs.filter(([name, shot]) => onHistory.has(markOf(state, name, shot)));
}

/**
 * The latest hashes become the accepted ones: the whole run's, or only the
 * screens named, or with --except all but those. Only screens shot in this
 * run move, and only their pictures taken this run. While the board shows
 * built screens, each one's Default picture is copied to design.built.
 *
 * Each picture taken is marked at the commit the run was shot at, whatever
 * the run: light, deep, one area, a chunk, or some screens. A screen that
 * failed to shoot, or a changed one left out, keeps its mark and is pending,
 * due until an accept takes it; a screen the run could not reach is marked,
 * since it was looked at. Pictures nothing has reached since their marks move
 * with it (settledPictures). A chunk-end run, light or deep, is also the last
 * run, and clears a deferral, once.
 */
async function accept(ctx, args = []) {
  const hashes = join(ctx.latest, "hashes.json");
  const latest = existsSync(hashes) ? JSON.parse(readFileSync(hashes, "utf8")) : {};
  const named = takenBy(latest, acceptNames(args, ctx.root), args.includes("--except"));
  const run = existsSync(ctx.run) ? JSON.parse(readFileSync(ctx.run, "utf8")) : {};
  // Everything is worked out before the first write, so an accept that fails changes nothing.
  const at = run.at ?? headCommit(ctx.root);
  if (!/^[0-9a-f]{7,64}$/.test(at)) throw new Error(`the last run's commit, ${JSON.stringify(at)}, is not a commit id; run it again`);
  const converted = await currentState(ctx);
  const listed = screensHere(ctx).map((screen) => screen.name);
  // A screen left out that did not change was shot and matches what is accepted, so it is taken too; only the changed ones are left to read.
  const before = readAccepted(ctx);
  const leftOut = Object.keys(latest).filter((name) => !named.includes(name) && why(latest[name], before[name]));
  const taken = Object.keys(latest).filter((name) => !leftOut.includes(name));
  const took = Object.fromEntries(taken.map((name) => [name, latest[name]]));
  const marked = Object.fromEntries(Object.entries(took).map(([name, kept]) => [name, Object.keys(kept).filter((key) => key !== "frame")]));
  for (const name of run.unreached ?? []) marked[name] = run.shots ?? ["wide-default"];
  // A changed screen left out, or one that did not shoot, stays due until an accept takes it.
  const held = [...leftOut, ...(run.failedNames ?? [])].filter((name) => !(name in marked));
  const settled = await settledPictures(ctx, converted, listed, at, run, new Set([...held, ...(converted.pending ?? [])]));
  const state = withRecordLock(ctx.record, () => {
    const accepted = readAccepted(ctx);
    for (const [name, now] of Object.entries(took)) accepted[name] = { ...accepted[name], ...now };
    writeRecord(ctx.accepted, JSON.stringify(accepted, null, 1));
    const kept = readState(ctx.state, undefined, ctx.root);
    const next = afterAccept(kept.version === 2 ? kept : converted, marked, at, Boolean(run.mode), { settled, held, listed });
    writeState(next, ctx.state);
    return next;
  });
  const toRead = existsSync(ctx.toRead) ? JSON.parse(readFileSync(ctx.toRead, "utf8")).filter((item) => leftOut.includes(item.name)) : [];
  if (toRead.length) writeFileSync(ctx.toRead, JSON.stringify(toRead, null, 1));
  else rmSync(ctx.toRead, { force: true });
  // The run stays, with where it was shot, while a changed screen is left out; the screens it could not reach are marked once.
  if (leftOut.length) {
    writeFileSync(hashes, JSON.stringify(Object.fromEntries(leftOut.map((name) => [name, latest[name]])), null, 1));
    // Recorded once: a later accept of what is left counts no chunk end and marks no unreached screen again.
    writeFileSync(ctx.run, JSON.stringify({ ...run, mode: null, at, unreached: [], failedNames: [] }, null, 1));
  } else {
    rmSync(hashes, { force: true });
    rmSync(ctx.run, { force: true });
  }
  const shared = ctx.record !== join(realpathSync(ctx.root), ".cache/screens");
  console.log(`Accepted ${taken.length} screens${leftOut.length ? `, left ${leftOut.length} to read` : ""}${shared ? `, in ${ctx.record}, which every worktree shares` : ""}.`);
  if (keepsBuilt(ctx.config)) {
    const { copied, removed } = keepBuilt(ctx.root, ctx.config, took, ctx.latest);
    if (copied.length || removed.length) console.log(`Built screens for the board: ${copied.length} copied, ${removed.length} removed, in ${ctx.config.design.built}; commit them so the board shows them.`);
  }
  console.log(`Marked ${Object.keys(marked).length} screens at ${at.slice(0, 7)}${run.mode ? `, and the ${run.mode} run as the last at ${state.last.slice(0, 7)}` : ""}.`);
  if (leftOut.length) console.log(`The ${leftOut.length} changed screens left out keep their marks, so they stay due until accepted.`);
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
  } else console.log("Every frame and scenario is on the screen list.");
  console.log(reachLine(reachCounts(screens)));
  return problems.length ? 1 : 0;
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
  } else console.log(`Every frame showing chunk ${chunk}'s stories is reached or waits on a later chunk.`);
  return problems.length ? 1 : 0;
}

/**
 * The project's screens.scope module. Its lists({ root, config, state, screens })
 * gives { light, deep }, maps of each screen's name to the changed files that
 * put it there: light since state.last, deep since state.deep. The kit asks it
 * once for each commit the marks name, with last and deep both that commit;
 * a commit reaches it only as a commit id, and the module passes it to git
 * after --end-of-options.
 */
async function scopeModule(ctx) {
  if (!ctx.config.screens.scope) throw new Error("screens.scope is not set: the project module whose lists() gives the light and deep lists");
  return import(pathToFileURL(join(ctx.root, ctx.config.screens.scope)).href);
}

/**
 * The record as marks. One from before version 2 is turned into them here,
 * with the deep list it gave, and is written so on the next accept.
 */
async function currentState(ctx) {
  const state = readState(ctx.state, undefined, ctx.root);
  if (state.version === 2) return state;
  const screens = screensHere(ctx);
  // With no screens.scope nothing was ever listed, so every screen keeps the last mark.
  const old = ctx.config.screens.scope ? await (await scopeModule(ctx)).lists({ root: ctx.root, config: ctx.config, state, screens }) : { light: new Map(), deep: new Map() };
  // A module's deep list may leave out its light one; a screen on either keeps the older, deep mark.
  return fromV1(state, new Map([...old.light, ...old.deep]), screens.map((screen) => screen.name), readAccepted(ctx));
}

/** Why a screen left open before marks is due. */
const PENDING_WHY = "left out of an accept";

/**
 * The light and deep lists from each picture's own mark. The project's module
 * is asked once for each commit the marks name, as if the whole app were
 * marked there, and a screen is listed when a picture this run takes is
 * marked at that commit and the module lists the screen. The deep list holds
 * every screen due; the light list, those a change in one place reaches.
 * Each screen keeps the changed files that put it there.
 */
export async function dueLists(names, state, shots, listsAt, base = "origin/main") {
  const byMark = new Map();
  for (const name of names) {
    for (const shot of shots) {
      const at = markOf(state, name, shot, base);
      if (!byMark.has(at)) byMark.set(at, new Set());
      byMark.get(at).add(name);
    }
  }
  const light = new Map();
  const deep = new Map();
  const add = (list, name, why) => list.set(name, [...new Set([...(list.get(name) ?? []), ...why])]);
  for (const [at, marked] of byMark) {
    const found = await listsAt(at);
    for (const [name, why] of found.light) if (marked.has(name)) add(light, name, why);
    for (const [name, why] of found.deep) if (marked.has(name)) add(deep, name, why);
  }
  for (const [name, why] of light) add(deep, name, why);
  // A screen left open before marks is due until an accept takes it, on the deep list only.
  for (const name of state.pending ?? []) {
    if (!names.includes(name)) continue;
    add(deep, name, [...(light.get(name) ?? []), PENDING_WHY]);
    light.delete(name);
  }
  return { light, deep, marks: [...byMark.keys()].filter((at) => at !== base).length };
}

/** The project's lists since one commit, asked once each, for dueLists. */
function listsFrom(ctx, state) {
  const asked = new Map();
  const screens = screensHere(ctx);
  return async (at) => {
    if (!asked.has(at)) {
      const scope = await scopeModule(ctx);
      asked.set(at, scope.lists({ root: ctx.root, config: ctx.config, state: { last: at, deep: at, lightRuns: [], open: {}, deferred: state.deferred }, screens }));
    }
    return asked.get(at);
  };
}

/** Both lists for the pictures `shots` takes, and the record they come from. */
async function currentLists(ctx, shots = ["wide-default"]) {
  const state = await currentState(ctx);
  const names = screensHere(ctx).map((screen) => screen.name);
  return { state, ...(await dueLists(names, state, shots, listsFrom(ctx, state))) };
}

/** About how many minutes a list takes, at `shots` pictures a screen. */
const minutes = (list, shots) => (list.size ? Math.max(1, Math.round((list.size * shots * SECONDS_A_SHOT) / 60)) : 0);

/** Both lists, how many of the deep list only shared code reaches, the record, and about how long each run takes at one picture a screen; for wf choose. */
export async function scopeFacts(root, config) {
  const { state, light, deep } = await currentLists(runContext(root, config));
  return { state, light, deep, deepOnly: deep.size - light.size, minutes: { light: minutes(light, 1), deep: minutes(deep, 1) } };
}

/** Both lists and about how long each takes, or one list's names. */
async function scope(ctx, args) {
  const { state, light: allLight, deep: allDeep, marks } = await currentLists(ctx);
  const areas = areasOf(args, ctx.config);
  const mine = new Set(inAreas(screensHere(ctx), areas, ctx.root, ctx.config).map((screen) => screen.name));
  const only = (list) => (areas ? new Map([...list].filter(([name]) => mine.has(name))) : list);
  const [light, deep] = [only(allLight), only(allDeep)];
  const at = args.indexOf("--names");
  // A list of names is one a line and nothing else, so it can be given back to --accept as @<file>.
  if (areas && at < 0) console.log(`Only ${areas.join(", ")}.`);
  if (at >= 0) {
    const which = args[at + 1]?.startsWith("--") ? "light" : (args[at + 1] ?? "light");
    if (!["light", "deep"].includes(which)) throw new Error("usage: wf screens scope --names light|deep");
    for (const name of [...(which === "deep" ? deep : light).keys()].sort()) console.log(name);
    return;
  }
  console.log(`Light: ${light.size} screens, about ${minutes(light, 1)} min for Default.`);
  for (const [name, why] of [...light].sort()) console.log(`  ${name}  (${why.join(", ")})`);
  console.log(`Deep: ${deep.size} screens, ${deep.size - light.size} of them only through shared code, about ${minutes(deep, 1)} min for Default.`);
  const shared = [...new Set([...deep.values()].flat())].filter((path) => path !== PENDING_WHY && ![...light.values()].flat().includes(path));
  if (shared.length) console.log(`  reached through: ${shared.join(", ")}`);
  console.log(`Each screen is due from its own mark: ${marks} ${marks === 1 ? "commit" : "different commits"} now${state.last ? `; the last chunk-end run was at ${state.last.slice(0, 7)}` : ""}.`);
  if (state.pruned) console.log(`${state.pruned} marks named commits this repository no longer has, such as a deleted worktree's; those pictures count from origin/main.`);
  const pending = (state.pending ?? []).filter((name) => deep.has(name));
  if (pending.length) console.log(`Left out of an accept, or did not shoot, so due until accepted: ${pending.length} screens.`);
  if (state.deferred.count) console.log(`Deferred: ${state.deferred.count} times, last at ${state.deferred.at}`);
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
  else if (args.includes("--check")) return check(ctx);
  else if (args.includes("--gate")) return gate(ctx, flagValue(args, "--gate"));
  else if (args.includes("--accept")) await accept(ctx, args);
  else if (args.includes("--defer")) defer(ctx);
  else if (args.includes("--sheets")) sheets(ctx);
  else if (args.includes("--brief")) writeBriefs(ctx);
  else if (args.includes("--worker")) worker(ctx, flagValue(args, "--worker"));
  else return (await run(ctx, args)) ?? 0;
  return 0;
}
