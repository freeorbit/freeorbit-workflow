// The kit's own `wf testdata` steps that read and write an area's spec as a
// whole: `tag` and `review`. bin/wf.mjs only dispatches to them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chunkStories } from "./docs/shape.mjs";
import { areaSpec } from "./testdata.mjs";
import { reviewSpec } from "./testdata-review.mjs";
import { applyTags, movesTable } from "./testdata-tag.mjs";
import { dropRows, dropsFromAnswers } from "./testdata-drop.mjs";
import { citingFiles } from "./testdata-trace.mjs";

// The ask page's cap; past it, a review goes a few stories at a time.
const PAGE_ROWS = 300;
// Where `tag` keeps the rows it moved off the owner's side, for the owner's next review page.
const movesPath = (areaId) => `.cache/testdata/moved-${areaId}.md`;

/** A flag's value, or null when it is not given; an empty value is an error. */
function flag(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

/** `wf testdata tag <area> <tags.md> [--write]`. */
export function runTag(root, ctx, args, log = console.log) {
  const [areaId, file] = args.filter((a) => !a.startsWith("--"));
  if (!areaId || !file) {
    log("Usage: wf testdata tag <area> <tags.md> [--write]   the designer's tag-mode table, applied");
    return 2;
  }
  if (!existsSync(join(root, file))) {
    log(`No tags file at ${file}; save the designer's tag-mode table there first.`);
    return 2;
  }
  const area = areaSpec(ctx.config, ctx.tracked, areaId);
  const found = applyTags(area, readFileSync(join(root, file), "utf8"), ctx.files);
  for (const problem of found.problems) log(problem);
  const write = args.includes("--write") && !found.problems.length;
  if (write) {
    for (const [path, text] of found.texts) writeFileSync(join(root, path), text);
    mkdirSync(dirname(join(root, movesPath(areaId))), { recursive: true });
    writeFileSync(join(root, movesPath(areaId)), `${movesTable(found.moves)}\n`);
  }
  log(`${found.tagged} rows tagged in ${found.texts.size} ${found.texts.size === 1 ? "file" : "files"}.`);
  if (found.moves.length) log(`${found.moves.length} of them move off the owner's side (likely, rare, or polish checks, craft rules). The owner's next review page lists them to confirm.`);
  if (found.untouched.length) log(`${found.untouched.length} rows still have no Level or Type: ${found.untouched.slice(0, 10).join(", ")}${found.untouched.length > 10 ? ", …" : ""}`);
  if (found.unknown.length) log(`No row has ${found.unknown.length} of the tags' IDs: ${found.unknown.slice(0, 10).join(", ")}`);
  if (args.includes("--write") && found.problems.length) log("Nothing written: fix the tags or rows above, then run it again.");
  else if (!write) log("A dry run; --write applies it.");
  return found.problems.length ? 1 : 0;
}

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
  const spec = reviewSpec(ctx, areaId, { stories, team, chunk: chunk ?? "", moves: team ? "" : read(movesPath(areaId)) });
  const rows = spec.tables.reduce((n, t) => n + t.rows.length, 0);
  if (rows > PAGE_ROWS) {
    log(`${rows} rows is past one page's ${PAGE_ROWS}; review a few stories at a time with --stories, or a chunk with --chunk.`);
    return 2;
  }
  log(JSON.stringify(spec, null, 2));
  return 0;
}

/** `wf testdata drop <area> <ID>... --why "<text>" [--write]`, or `--from <ask id>` for a review page's Drops. */
export function runDrop(root, ctx, args, log = console.log, today = new Date().toISOString().slice(0, 10)) {
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
    drops = new Map([...drops, ...dropsFromAnswers(JSON.parse(readFileSync(file, "utf8")))]);
  }
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
