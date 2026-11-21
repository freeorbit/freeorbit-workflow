// `wf testdata`: the one place its steps are chosen (runTestdataCommand), and
// the kit's own steps: `review`, `drop`, `budget`, `delta`, and `prune` on an
// area's spec as a whole, `merge` and `fold`, `rename-ids`, `trace`, and the
// budget gate before `refresh-close`. Any other step is the project's own
// command (index.mjs). bin/wf.mjs only calls runTestdataCommand.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadConfig, project } from "../config/config.mjs";
import { foldFile, mergeFolder, mergeLines } from "./merge.mjs";
import { renameIds, renameLines } from "./rename.mjs";
import { chunkLines, chunkTrace, trace, traceLines } from "./trace.mjs";

import { chunkStories } from "../docs/shape.mjs";
import { areaSpec, runTestdata } from "./index.mjs";
import { reviewSpec } from "./review.mjs";
import { dropRows, dropsFromAnswers } from "./drop.mjs";
import { citingFiles } from "./trace.mjs";
import { budget, budgetLines, checkDelta, grown } from "./budget.mjs";
import { builtStories, pruneChecks, pruneLines } from "./prune.mjs";
import { flagValue, git, readJsonFile } from "../process.mjs";
import { localToday } from "../docs/check.mjs";

// The ask page's cap; past it, a review goes a few stories at a time.
const PAGE_ROWS = 300;

const flag = flagValue;

/** `wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]`. */
export function runReview(root, ctx, args, log = console.log) {
  // The values of --chunk and --stories, so neither is read as the area.
  const values = new Set(["--chunk", "--stories"].filter((name) => args.includes(name)).map((name) => args[args.indexOf(name) + 1]).filter(Boolean));
  const areaId = args.find((a) => !a.startsWith("--") && !values.has(a));
  if (!areaId) {
    log("Usage: wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]   prints an ask page's spec; pipe it to npx wf ask page -");
    return 2;
  }
  const chunk = flag(args, "--chunk");
  let stories = flag(args, "--stories")?.split(/[\s,]+/).filter(Boolean) ?? null;
  const read = (path) => (path && existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "");
  if (chunk) {
    stories = chunkStories(chunk, [read(ctx.config.buildOrder.file), read(ctx.config.buildOrder.done)]);
    if (!stories) {
      log(`No row for ${chunk} in the build order or the done list.`);
      return 2;
    }
  }
  const team = args.includes("--team");
  const spec = reviewSpec(ctx, areaId, { stories, team, chunk: chunk ?? "" });
  const rows = spec.tables.reduce((n, t) => n + t.rows.length, 0);
  if (rows > PAGE_ROWS) {
    log(`${rows} rows is past one page's ${PAGE_ROWS}; review a few stories at a time with --stories, or a chunk with --chunk.`);
    return 2;
  }
  log(JSON.stringify(spec, null, 2));
  return 0;
}

/** `wf testdata drop <area> <ID>... --why "<text>" [--write]`, or `--from <ask id>` for a review page's Drops. */
export function runDrop(root, ctx, args, log = console.log, today = localToday()) {
  const valued = new Set(["--why", "--from"].filter((name) => args.includes(name)).map((name) => args[args.indexOf(name) + 1]));
  const [areaId, ...ids] = args.filter((a) => !a.startsWith("--") && !valued.has(a));
  const from = flag(args, "--from");
  const why = flag(args, "--why");
  if (!areaId || (!ids.length && !from) || (ids.length && !why)) {
    log('Usage: wf testdata drop <area> <ID>... --why "<why>" [--write]   or   wf testdata drop <area> --from <ask id> [--write]');
    return 2;
  }
  let drops = new Map(ids.map((id) => [id, why]));
  if (from) {
    const file = join(root, ".cache/view/answers", `${from}.json`);
    if (!existsSync(file)) {
      log(`No answers for ${from}; send the review page first.`);
      return 2;
    }
    drops = new Map([...drops, ...dropsFromAnswers(readJsonFile(file))]);
  }
  // The solo page's one craft row stands for many rules, so a Drop on it names none.
  if (drops.delete("craft")) log(`The craft row stands for every craft rule: mark the ones to drop on npx wf testdata review ${areaId} --team.`);
  if (!drops.size) {
    log("Nothing marked Drop.");
    return 0;
  }
  const area = areaSpec(ctx.config, ctx.tracked, areaId);
  const found = dropRows(area, drops, ctx.files, today);
  const write = args.includes("--write");
  if (write) for (const [path, text] of found.texts) writeFileSync(join(root, path), text);
  log(`${found.dropped.length} ${found.dropped.length === 1 ? "row" : "rows"} ${write ? "dropped" : "to drop"}: ${found.dropped.map((d) => d.id).join(", ")}${write ? ", listed under Dropped in the area's README" : " (a dry run; --write applies it)"}.`);
  if (found.missing.length) log(`No spec row has ${found.missing.join(", ")}.`);
  const cited = [...citingFiles(ctx, found.dropped.map((d) => d.id))].filter(([, paths]) => paths.length);
  if (cited.length) {
    log("Code that cites them: take the citation out, or the test when proving that row was all it did.");
    for (const [id, paths] of cited) log(`  ${id}: ${paths.join(", ")}`);
  }
  return 0;
}

/** `wf testdata budget <area> [story ids] [--check]`: each story's fixtures against its cap; with --check, 1 when one is over. */
export function runBudget(root, ctx, args, log = console.log) {
  const [areaId, ...ids] = args.filter((a) => !a.startsWith("--"));
  if (!areaId) {
    log("Usage: wf testdata budget <area> [story ids] [--check]   the lines for the designer's prompt; --check fails when a story is over");
    return 2;
  }
  const found = budget(ctx, areaId, ids.flatMap((each) => each.split(",")).filter(Boolean));
  for (const line of budgetLines(found, ctx.config.testdata.limits)) log(line);
  return args.includes("--check") && found.over.length ? 1 : 0;
}

/**
 * The gate `wf testdata refresh-close <area> <ids>` runs first: 1 when those
 * stories, their flow areas, or the rules their fixtures cite are over budget
 * and hold more fixtures than at the last commit, which `before(path)` reads.
 * An area the kit cannot read is the project's own step to report: 0.
 */
export function runCloseGate(ctx, before, args, log = console.log) {
  const [areaId, ...ids] = args.filter((a) => !a.startsWith("--"));
  let over;
  try {
    const only = ids.flatMap((each) => each.split(",")).filter(Boolean);
    over = grown(budget(ctx, areaId, only), budget({ ...ctx, files: before }, areaId, only));
  } catch {
    return 0;
  }
  if (!over.length) return 0;
  log("Over budget, and more than at the last commit:");
  for (const each of over) log(`  ${each.text}`);
  log("Merge rows into one with axes, move a case that varies one input into its input classes, or drop the row. An exception is the owner's: testdata.limits.allow.");
  log("refresh-close refused: nothing recorded as covered.");
  return 1;
}

/** `wf testdata delta <area> <file>`: what the designer returned, held to its caps before any of it is applied. */
export function runDelta(root, ctx, args, log = console.log) {
  const [areaId, file] = args.filter((a) => !a.startsWith("--"));
  if (!areaId || !file || !existsSync(join(root, file))) {
    log("Usage: wf testdata delta <area> <file>   the designer's return, saved to a file: 1 when it is over a cap or holds check rows");
    return 2;
  }
  const { area } = areaSpec(ctx.config, ctx.tracked, areaId);
  const found = checkDelta(readFileSync(join(root, file), "utf8"), ctx.config, area.prefix ?? "");
  if (!found.problems.length) {
    log("Within its caps: apply it.");
    return 0;
  }
  for (const problem of found.problems) log(problem);
  // A return that was not checked has nothing within the caps to apply: save it again, or run the designer again if it is lost.
  if (found.unchecked) {
    log("Nothing was applied. Save the designer's whole return to the file and run this again; if the return is lost, run the designer again.");
    return 1;
  }
  log("Apply what is within the caps and leave the rest out; name what was held back in one line to the owner. Do not run the designer again for it.");
  return 1;
}

/** `wf testdata prune <area> [--all] [--write]`: the check rows nothing cites, out of the spec. */
export function runPrune(root, ctx, args, log = console.log) {
  const areaId = args.find((a) => !a.startsWith("--"));
  if (!areaId) {
    log("Usage: wf testdata prune <area> [--all] [--write]   check rows no code cites, for built stories; a dry run without --write");
    return 2;
  }
  const done = ctx.config.buildOrder.done;
  const built = builtStories(done && existsSync(join(root, done)) ? readFileSync(join(root, done), "utf8") : "");
  const write = args.includes("--write");
  const found = pruneChecks(ctx, areaId, { built, all: args.includes("--all") });
  if (write) for (const [path, text] of found.texts) writeFileSync(join(root, path), text);
  for (const line of pruneLines(found, { write })) log(line);
  return 0;
}

/** `wf testdata merge|fold`: a dry run unless --write, and never a write that loses a row. */
export function runMergeFold(root, ctx, name, args, log = console.log) {
  const [first, second] = args.filter((a) => !a.startsWith("--"));
  if (!first || (name === "fold" && !second)) {
    log(name === "merge" ? "Usage: wf testdata merge <flow area folder> [--write]" : "Usage: wf testdata fold <small file> <sibling> [--write]");
    return 2;
  }
  // An ignored file is not listed, so a merge asks the disk whether its file is there.
  const withDisk = { ...ctx, exists: (path) => existsSync(join(root, path)) };
  const found = name === "merge" ? mergeFolder(withDisk, first) : foldFile(withDisk, first, second);
  const asked = args.includes("--write");
  const write = asked && found.before === found.after;
  let kept = [];
  if (write) {
    for (const [path, text] of found.writes) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    for (const path of found.removes) unlinkSync(join(root, path));
    if (name === "merge") {
      const folder = join(root, first.replace(/\/+$/, ""));
      kept = readdirSync(folder);
      if (!kept.length) rmdirSync(folder);
    }
  }
  for (const line of mergeLines(found, { from: first, asked, write, limit: ctx.config.testdata.limits.lines, kept })) log(line);
  return found.before === found.after ? 0 : 1;
}

/** `wf testdata rename-ids`: a dry run unless --write. A link can point outside the project, so it is never read or written. */
export function runRenameIds(root, ctx, args, log = console.log) {
  const { config, tracked, files, links } = ctx;
  const write = args.includes("--write");
  const found = renameIds({ config, tracked: tracked.filter((path) => !links.has(path)), files }, args.find((a) => !a.startsWith("--")) ?? null);
  found.links = [...links];
  if (write) for (const [path, text] of found.texts) writeFileSync(join(root, path), text);
  for (const line of renameLines(found, { write, all: args.includes("--all") })) log(line);
  return 0;
}

/** `wf testdata trace`: it reads the spec and the code, and runs no project command. A chunk's trace gives 1 while any check is proven by nothing, 2 when the chunk has no row. */
export function runTrace(root, ctx, args, log = console.log) {
  const chunk = flagValue(args, "--chunk");
  if (chunk !== null) {
    const read = (path) => (path && existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "");
    const { found, noRow } = chunkTrace(ctx, chunk, read);
    if (noRow) {
      log(`No row for ${chunk} in the build order or the done list; name it as the row does, such as CH-12 or 37d.`);
      return 2;
    }
    for (const line of chunkLines(found, { all: args.includes("--all") })) log(line);
    return found.unproven.length ? 1 : 0;
  }
  const area = args.find((a) => !a.startsWith("--")) ?? null;
  for (const line of traceLines(trace(ctx, area), { all: args.includes("--all") })) log(line);
  return 0;
}

/** The kit's own steps, each `(root, ctx, args, log)`; any other step runs the project's own command. */
const STEPS = {
  review: runReview,
  drop: runDrop,
  budget: runBudget,
  delta: runDelta,
  prune: runPrune,
  merge: (root, ctx, args, log) => runMergeFold(root, ctx, "merge", args, log),
  fold: (root, ctx, args, log) => runMergeFold(root, ctx, "fold", args, log),
  "rename-ids": runRenameIds,
  trace: runTrace,
};

const USAGE = [
  "Usage: wf testdata <route|stale|covered|index|journeys|e2e-files|refresh-close> <area> [arguments]",
  "       wf testdata trace [area] [--all]",
  "       wf testdata trace --chunk <id> [--all]",
  "       wf testdata rename-ids [area] [--write] [--all]",
  "       wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]",
  '       wf testdata drop <area> <ID>... --why "<why>" | --from <ask id> [--write]',
  "       wf testdata budget <area> [story ids] [--check]",
  "       wf testdata delta <area> <file>",
  "       wf testdata prune <area> [--all] [--write]",
  "       wf testdata merge <folder> [--write]",
  "       wf testdata fold <file> <sibling> [--write]",
];

/**
 * `wf testdata <step> ...`, the one place its steps are chosen: the kit's own,
 * from STEPS, or the project's command for the step. refresh-close first holds
 * a refresh to the budget, then runs the project's command.
 */
export function runTestdataCommand(root, [name, ...args], log = console.log) {
  if (!name) {
    log(USAGE.join("\n"));
    return 2;
  }
  if (STEPS[name]) return STEPS[name](root, project(root), args, log);
  if (name === "refresh-close") {
    // A refresh that took a story over its budget does not close: the stories stay stale until the spec is back within it.
    const atHead = (path) => git(root, ["show", `HEAD:${path}`], { quiet: true });
    if (runCloseGate(project(root), atHead, args, log) === 1) return 1;
  }
  return runTestdata(root, loadConfig(root), name, args);
}
