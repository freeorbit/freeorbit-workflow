// `wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]`: an
// ask page's spec, built from the area's test-data spec, so the owner reviews
// only what is theirs and the team the rest.
//
//   the owner's page   core checks, any +harm row, product rules, and safety
//                      rules, with the area's glossary; and every row not yet
//                      tagged, which stays the owner's until it is
//   the team's page    likely, rare, and polish checks, and craft rules
//
// Each row is recommended Fine, so Take all recommendations accepts a table
// in one go, and only a row the person doubts needs a mark. The page's spec is
// printed as JSON, for `npx wf ask page -`.

import { readStories } from "./docs/stories.mjs";
import { storiesIn } from "./docs/shape.mjs";
import { matcher } from "./config/config.mjs";
import { prefixesOf } from "./ids.mjs";
import { forOwner, specIds, tableRows } from "./testdata.mjs";

const label = (row) => (row.kind === "check" ? `${row.level || "untagged"}${row.harm ? "+harm" : ""}` : row.type || "untagged");
const cell = (text) => String(text ?? "").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();

/**
 * The review page's spec for one area: the owner's, or with `team` the
 * team's. `stories` limits it to the rows naming one of them, such as a
 * chunk's; `chunk` names the page after it.
 */
export function reviewSpec({ config, tracked, files }, areaId, { stories = null, team = false, chunk = "" } = {}) {
  const area = config.areas.find((each) => each.id === areaId && each.docs);
  if (!area) throw new Error(`no area ${areaId} with a docs folder in .workflow/config.json`);
  const dir = `${area.docs}/test-data/`;
  const paths = tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md"));
  const scope = stories ? new Set(stories) : null;
  const inScope = (row) => !scope || storiesIn(row.stories).some((s) => scope.has(s));
  const rows = specIds(paths, files).filter((row) => (row.kind === "check" || (row.kind === "rule" && !/^new$/i.test(row.accepted ?? ""))) && inScope(row));
  const mine = rows.filter((row) => forOwner(row) === !team);
  const others = rows.filter((row) => forOwner(row) === team);
  // Story titles, so a table says what the user wants, not an ID.
  const titles = new Map();
  for (const path of tracked.filter(matcher(config.stories.files))) for (const story of readStories(files(path), prefixesOf(config), path)) titles.set(story.id, story.title);
  const tables = [];
  const table = (id, title, columns, list, cells) => {
    if (list.length) tables.push({ id, title, columns, rows: list.map((row) => ({ id: row.id, cells: cells(row), recommended: "ok" })) });
  };
  const checks = mine.filter((row) => row.kind === "check");
  const rules = mine.filter((row) => row.kind === "rule");
  if (!team) {
    // The owner's checks by story: each table one thing a user wants.
    const byStory = new Map();
    for (const row of checks) {
      const story = storiesIn(row.stories).find((s) => !scope || scope.has(s)) ?? "Other";
      byStory.set(story, [...(byStory.get(story) ?? []), row]);
    }
    for (const [story, list] of byStory) table(story, titles.has(story) ? `${story}: ${titles.get(story)}` : story, ["What a passing run shows", "Level"], list, (row) => [cell(row.text), label(row)]);
    table("product", "How the app behaves: product rules", ["Rule", "Type"], rules.filter((row) => row.type !== "safety"), (row) => [cell(row.text), label(row)]);
    table("safety", "Promises about privacy and safety", ["Rule"], rules.filter((row) => row.type === "safety"), (row) => [cell(row.text)]);
  } else {
    for (const level of ["likely", "rare", "polish"]) table(level, { likely: "Likely: what users often hit", rare: "Rare: unusual inputs and timing", polish: "Polish: help text and labels" }[level], ["Check", "Setup", "Stories"], checks.filter((row) => row.level === level), (row) => [cell(row.text), cell(row.setup), cell(row.stories)]);
    table("craft", "Craft: how the test data is built", ["Rule", "Category"], rules, (row) => [cell(row.text), row.category]);
  }
  const count = (list, pick) => list.filter(pick).length;
  const summary = team
    ? `These ${mine.length} rows are the team's: ${count(checks, (r) => r.level === "likely")} likely, ${count(checks, (r) => r.level === "rare")} rare, and ${count(checks, (r) => r.level === "polish")} polish checks, and ${rules.length} craft rules. Each is recommended Fine: take all recommendations, then mark only a row you doubt.`
    : `These ${mine.length} rows are yours: what each story promises, anything that could leak or lose data or give wrong advice, and the rules about how the app behaves. Each is recommended Fine: take all recommendations, then mark a row that is wrong or missing something. The team handles ${others.length} more (${count(others, (r) => r.level === "likely")} likely, ${count(others, (r) => r.level === "rare")} rare, ${count(others, (r) => r.level === "polish")} polish, ${count(others, (r) => r.kind === "rule")} craft rules): npx wf testdata review ${area.id}${chunk ? ` --chunk ${chunk}` : ""} --team.`;
  const blocks = [{ type: "text", text: summary }];
  // The area's words, in plain terms, for an owner new to the domain.
  const glossary = paths.filter((p) => p.endsWith("/glossary.md")).flatMap((p) => tableRows(files(p), ["Term", "Plain meaning"]).map(({ cells }) => [cell(cells.Term), cell(cells["Plain meaning"])]));
  if (glossary.length && !team) blocks.push({ type: "table", title: "Words used here", columns: ["Term", "Plain meaning"], rows: glossary });
  blocks.push({ type: "questions" });
  const id = `${area.id}-${team ? "team" : "owner"}-review${chunk ? `-${chunk}` : ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64);
  return {
    id,
    title: `${area.id[0].toUpperCase()}${area.id.slice(1)} test data: ${team ? "the team's rows" : "yours to review"}${chunk ? `, ${chunk}` : ""}`,
    template: "testdata",
    intro: team ? "Rows the team checks: the common variations, the rare cases, the help text, and how the test data is built." : "What the test data checks that is yours to decide, in plain words.",
    blocks,
    tables,
  };
}
