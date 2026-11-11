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

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { designPaths, findFrame } from "../design/frames.mjs";
import { renderArgs } from "../design/index.mjs";
import { readBuildOrder } from "../docs/shape.mjs";
import { captionLines } from "../design/storyboard.mjs";
import { keepBuilt, keepsBuilt } from "./built.mjs";
import { allScreens, chunkStories, coverage, gateProblems, parseReach, reachCounts, reachLine } from "./list.mjs";
import { app, jobsOf, kwinFound, needsDisplay, picturePaths, screensHeadless, shootAll, shotsFor, worker } from "./shoot.mjs";
import { afterDefer, afterRun, headCommit, readState, statePath, writeState } from "./state.mjs";

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
