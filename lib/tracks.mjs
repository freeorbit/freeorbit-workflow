// `wf ready <track> [chunk]` and `wf done <track> [chunk]`: the facts a track
// needs before work starts and before its pull request, each OK, FAIL, or
// SKIP, then the judgement items for the agent to answer itself. Three
// tracks fit the ceremony to the change:
//
//   quick  a docs or tool fix: no chunk start or end, no review
//   chunk  a few whole stories: chunk start, build, chunk end
//   area   a new area: the four steps, then its chunks
//
// It runs the project's own commands, from `tracks` and the rest of the
// config, and knows no feature.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { matcher } from "./config/config.mjs";
import { ledgerFiles, ledgerOnlyAfter, reviewCovers } from "./screens/run.mjs";
import { chunkRows, findChunk } from "./docs/shape.mjs";
import { chunkId, laneOf, waitsOn } from "./lanes.mjs";

export const TRACKS = ["quick", "chunk", "area"];

const git = (root, ...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const lines = (out) => out.split("\n").filter(Boolean);

/**
 * A chunk is named by its id, such as CH-01 or CH-01b, or a lane of one, such as
 * CH-01-fe, so it is safe in a command. An older id with no prefix, such as 35i, still reads.
 */
export const CHUNK = /^(?:[A-Z]+-)?[0-9]+[a-z]*(-[a-z]+)?$/;

/**
 * Files this branch changes from its base, committed or not, or null when the
 * base cannot be found. The remote's base wins, since a local one is often behind.
 */
export function changedFiles(root, base) {
  const remote = git(root, "rev-parse", "--verify", "--quiet", `origin/${base}`).status === 0;
  const mergeBase = git(root, "merge-base", "HEAD", remote ? `origin/${base}` : base).stdout.trim();
  if (!mergeBase) return null;
  const committed = lines(git(root, "diff", "--name-only", mergeBase).stdout);
  const untracked = lines(git(root, "ls-files", "--others", "--exclude-standard").stdout);
  return [...new Set([...committed, ...untracked])];
}

/** Files outside the quick track's paths: a change to them is a chunk. */
export function outsideQuick(files, config) {
  const quick = matcher(config.tracks.quickPaths);
  // Stories and test-data specs are docs that drive tests, so a change to them is a chunk.
  const heavy = matcher([...config.tracks.notQuick, ...config.stories.files]);
  return files.filter((file) => !quick(file) || heavy(file));
}

/** A chunk's row as { chunk, status, waitsOn, ... }, in the build order or the done list, by its id such as "CH-01". */
export function chunkRow(texts, chunk) {
  return findChunk(texts, chunk);
}

/** A chunk's row from the build order, or null. */
function rowOf(ctx) {
  return findChunk([ctx.read(ctx.config.buildOrder.file)], ctx.chunk);
}

const ok = (note = "") => ({ status: "OK", note });
const fail = (note) => ({ status: "FAIL", note });
const skip = (note) => ({ status: "SKIP", note });
const passes = (result) => result.status === 0;

/** The outside calls a check makes; a test passes stand-ins in `io`. */
function context(root, config, track, phase, chunk, io, flags = []) {
  return {
    config,
    track,
    phase,
    chunk,
    flags,
    sh: io.sh ?? ((command) => spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8" })),
    // The kit's own steps run with no shell, so an argument is never parsed as a command.
    wf: io.wf ?? ((args) => spawnSync("npx", ["wf", ...args], { cwd: root, encoding: "utf8" })),
    read: io.read ?? ((path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "")),
    branch: io.branch ?? (() => git(root, "branch", "--show-current").stdout.trim()),
    head: io.head ?? (() => git(root, "rev-parse", "--short", "HEAD").stdout.trim()),
    files: io.files ?? (() => changedFiles(root, config.design.base)),
    ledgerOnlyAfter: io.ledgerOnlyAfter ?? ledgerOnlyAfter(root, ledgerFiles(config)),
  };
}

function command(ctx, label, cmd) {
  if (!cmd) return skip(`no command set for ${label}`);
  return passes(ctx.sh(cmd)) ? ok() : fail(`\`${cmd}\` failed`);
}

/** Each scripted check, by name: its label and how it runs. */
const CHECKS = {
  onBranch: ["on a work branch, not the base", (ctx) => {
    const { base } = ctx.config.design;
    const branch = ctx.branch();
    if (!branch) return fail("not on a branch (a detached HEAD); start a <scope>/<slug> branch");
    return branch === base ? fail(`on ${base}; start a <scope>/<slug> branch`) : ok(branch);
  }],
  quickPaths: ["the change stays within the quick track's paths", (ctx) => {
    const changed = ctx.files();
    if (!changed) return fail(`cannot find the merge base with ${ctx.config.design.base}; fetch it first`);
    const outside = outsideQuick(changed, ctx.config);
    if (!outside.length) return ok();
    const more = outside.length > 5 ? ", and more" : "";
    return fail(`it changes ${outside.slice(0, 5).join(", ")}${more}: use the chunk track`);
  }],
  quickCheck: ["the project's quick check passes", (ctx) => command(ctx, "the quick check", ctx.config.tracks.check)],
  fullCheck: ["the project's full check passes", (ctx) => command(ctx, "the full check", ctx.config.tracks.fullCheck)],
  docCheck: ["docs are in step", (ctx) => (passes(ctx.wf(["doc:check"])) ? ok() : fail("`wf doc:check` failed"))],
  signoffs: ["no open sign-offs", (ctx) => (passes(ctx.wf(["signoffs"])) ? ok() : fail("`wf signoffs` lists open needs lines"))],
  chunkNamed: ["the chunk is named", (ctx) => (ctx.chunk ? ok(ctx.chunk) : fail(`say the chunk: wf ${ctx.phase} ${ctx.track} <chunk>`))],
  rowFound: ["its row is in the build order", (ctx) => {
    const { file, done } = ctx.config.buildOrder;
    if (!ctx.chunk) return skip("no chunk named");
    if (chunkRow([ctx.read(file)], ctx.chunk)) return ok();
    if (chunkRow([ctx.read(done)], ctx.chunk)) return fail(`${ctx.chunk} is already done`);
    return fail(`no row for ${ctx.chunk} in ${file}`);
  }],
  waitsDone: ["every row it waits on is done", (ctx) => {
    const row = ctx.chunk ? rowOf(ctx) : null;
    const waits = waitsOn(row?.waitsOn);
    if (!waits.length) return skip("it waits on nothing");
    const doneIds = chunkRows(ctx.read(ctx.config.buildOrder.done)).map((done) => chunkId(done.chunk));
    const unmet = waits.filter((wait) => !doneIds.includes(wait));
    return unmet.length ? fail(`${unmet.join(" and ")} must be merged first`) : ok(waits.join(", "));
  }],
  contractCheck: ["the contract passes its check", (ctx) => {
    if (!laneOf(ctx.chunk ?? "")) return skip("not a lane");
    return command(ctx, "lanes.contract.check", ctx.config.lanes.contract.check);
  }],
  contractBreaking: ["the contract has no breaking change from the base", (ctx) => {
    if (!laneOf(ctx.chunk ?? "")) return skip("not a lane");
    const cmd = ctx.config.lanes.contract.breaking;
    if (!cmd) return skip("no command set for lanes.contract.breaking");
    if (passes(ctx.sh(cmd))) return ok();
    // A breaking change is the front end's and the back end's to agree, recorded before the pull request.
    if (ctx.flags.includes("--agreed")) return ok("breaking, agreed by both lanes");
    return fail("a breaking change: ask developer:frontend and developer:backend, record it with wf decision add, then run wf done with --agreed");
  }],
  reviewed: ["the code review covers HEAD", (ctx) => (reviewCovers(ctx.read(ctx.config.logs.ledger), ctx.head(), ctx.ledgerOnlyAfter) ? ok() : fail("run or defer the code review at HEAD, or at a commit followed only by ledger edits"))],
  screenGate: ["every frame of the chunk is reached or waits on a later one", (ctx) => {
    if (!ctx.config.screens.scope) return skip("no screen list in this project");
    if (!ctx.chunk) return skip("no chunk named");
    return passes(ctx.wf(["screens", "--gate", ctx.chunk])) ? ok() : fail(`\`wf screens --gate ${ctx.chunk}\` lists frames`);
  }],
};

/** Each track's lists: a check's name, or a question for the agent to answer. */
const LISTS = {
  quick: {
    ready: ["onBranch", "Is this a fix to docs, tools, or the workflow, with no story, screen, or app code? If not, use the chunk track."],
    done: ["onBranch", "quickPaths", "quickCheck", "docCheck", "signoffs"],
  },
  chunk: {
    ready: [
      "onBranch",
      "chunkNamed",
      "rowFound",
      "waitsDone",
      "screenGate",
      "Has `wf testdata stale <area> --chunks <this>,<next>` run, and each story it lists been refreshed?",
      "Have the stories been checked against the frames, both ways, and each drift raised?",
      "Is each question this chunk raises asked, once, of the role that owns it?",
      "Does an outside service the chunk uses have a real call made and a stand-in built?",
    ],
    done: [
      "onBranch",
      "chunkNamed",
      "fullCheck",
      "contractCheck",
      "contractBreaking",
      "docCheck",
      "reviewed",
      "screenGate",
      "signoffs",
      "If UI files or frames changed, has the screen review run after the code review's fixes?",
      "Is the chunk's row moved to Waiting or to the done list, and any wasted effort logged?",
    ],
  },
  area: {
    ready: ["onBranch", "Is the area in the config's areas, with its story prefix and docs folder?", "Step 1: are its stories and flows written, before any screen or stack?"],
    done: ["docCheck", "Are Steps 1 to 3 done in the build order's Areas table, with the area's chunks added?", "Each chunk then runs the chunk track."],
  },
};

/** The questions a lane adds to the chunk track's lists. */
export const LANE_ASKS = {
  ready: {
    contract: ["Are both specialties, developer:frontend and developer:backend, here to agree the contract?"],
    fe: ["Is this lane in a worktree of its own, on a branch no other lane uses?", "Does the front end run against the contract's mock, not the real service?"],
    be: ["Is this lane in a worktree of its own, on a branch no other lane uses?"],
    integration: ["Are the fe and be lanes both merged, so this branch starts from main with both?"],
  },
  done: {
    contract: ["Does the mock answer every call the chunk's stories need, from the synthetic test data?"],
    fe: ["Do the screens match their frames against the mock, after the screen review?"],
    be: ["Do the service's contract tests pass against the synthetic data?"],
    integration: ["Is the mock gone from the app's wiring, and do the end-to-end journeys and the stories' acceptance pass?"],
  },
};

/**
 * The steps for a track and phase: [label, run] pairs, where run returns
 * { status: "OK" | "FAIL" | "SKIP", note }, and plain strings, the questions
 * for the agent to answer.
 */
export function steps(root, config, track, phase, chunk, io = {}, flags = []) {
  const lane = track === "chunk" && laneOf(chunk ?? "");
  const base = LISTS[track]?.[phase];
  if (!base) throw new Error(`no ${phase} list for track ${track}; one of ${TRACKS.join(", ")}`);
  const asks = lane && Object.hasOwn(LANE_ASKS[phase], lane.lane) ? LANE_ASKS[phase][lane.lane] : [];
  const list = [...base, ...asks];
  const ctx = context(root, config, track, phase, chunk, io, flags);
  return list.map((item) => {
    if (!CHECKS[item]) return item;
    const [label, check] = CHECKS[item];
    return [label, () => check(ctx)];
  });
}

/** Run a track's list and print it; resolves to 1 when any step failed. */
export function runTrack(root, config, phase, [track, chunk, ...flags], io = {}, log = console.log) {
  const lane = chunk && laneOf(chunk);
  const known = !lane || config.lanes.names.includes(lane.lane);
  // --agreed accepts a breaking contract change, so it belongs only to a lane's wf done.
  const flagsFit = flags.every((flag) => flag === "--agreed") && (!flags.length || (phase === "done" && track === "chunk" && lane));
  if (!TRACKS.includes(track) || (chunk !== undefined && !CHUNK.test(chunk)) || !known || !flagsFit) {
    log(`Usage: wf ${phase} <${TRACKS.join(" | ")}> [chunk] [--agreed], a chunk such as CH-01 or a lane such as CH-01-fe (${config.lanes.names.join(", ")}); --agreed only with wf done chunk <lane>`);
    return 2;
  }
  let failed = 0;
  const judgement = [];
  for (const step of steps(root, config, track, phase, chunk, io, flags)) {
    if (typeof step === "string") {
      judgement.push(step);
      continue;
    }
    const [label, check] = step;
    const { status, note } = check();
    if (status === "FAIL") failed += 1;
    log(`${status.padEnd(4)} ${label}${note ? `: ${note}` : ""}`);
  }
  for (const question of judgement) log(`ASK  ${question}`);
  log(failed ? `${failed} to fix before ${phase === "ready" ? "starting" : "the pull request"}.` : `Ready for ${phase === "ready" ? "work" : "the pull request"}; answer each ASK yourself.`);
  return failed ? 1 : 0;
}
