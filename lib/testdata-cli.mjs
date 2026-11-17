// The kit's own `wf testdata` steps that read and write an area's spec as a
// whole: `review`, `drop`, `budget`, `delta`, and `prune`. bin/wf.mjs
// only dispatches to them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chunkStories } from "./docs/shape.mjs";
import { areaSpec } from "./testdata.mjs";
import { reviewSpec } from "./testdata-review.mjs";
import { dropRows, dropsFromAnswers } from "./testdata-drop.mjs";
import { citingFiles } from "./testdata-trace.mjs";
import { budget, budgetLines, checkDelta, grown } from "./testdata-budget.mjs";
import { builtStories, pruneChecks, pruneLines } from "./testdata-prune.mjs";
import { flagValue, readJsonFile } from "./process.mjs";
import { localToday } from "./docs/check.mjs";

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
