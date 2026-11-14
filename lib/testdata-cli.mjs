// The kit's own `wf testdata` steps that read and write an area's spec as a
// whole: `tag` and `review`. bin/wf.mjs only dispatches to them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chunkStories } from "./docs/shape.mjs";
import { areaSpec } from "./testdata.mjs";
import { reviewSpec } from "./testdata-review.mjs";
import { applyTags, movesTable } from "./testdata-tag.mjs";

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
