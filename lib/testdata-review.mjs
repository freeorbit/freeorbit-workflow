// `wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]`: an
// ask page's spec, built from the area's rules, so the owner reviews only
// what is theirs and the team the rest.
//
//   the owner's page   product rules and safety rules, with the area's
//                      glossary; and every rule with no Type, which stays the
//                      owner's until it has one
//   the team's page    craft rules, a category at a time
//
// With `team: "solo"` one person holds both, so there is one page: the
// owner's tables, then the craft rules as a single row to accept together.
// Checks are not reviewed here: a story's acceptance lines are its checks,
// and they are reviewed as the story is.
//
// Each row is recommended Fine, so Take all recommendations accepts a table
// in one go, and only a row the person doubts needs a mark. The page's spec is
// printed as JSON, for `npx wf ask page -`.

import { storiesIn } from "./docs/shape.mjs";
import { areaSpec, bare, forOwner, specIds, tableRows } from "./testdata.mjs";

const label = (row) => row.type || "untyped";
const cell = (text) => String(text ?? "").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();

/**
 * The review page's spec for one area: the owner's, or with `team` the
 * team's. `stories` limits it to the rules naming one of them, such as a
 * chunk's; `chunk` names the page after it. `moves` is the table `wf
 * testdata tag` wrote of the rows its tags took off the owner's side: the
 * owner's page shows it once.
 */
export function reviewSpec({ config, tracked, files }, areaId, { stories = null, team = false, chunk = "", moves = "" } = {}) {
  const { area, paths } = areaSpec(config, tracked, areaId);
  const solo = config.team === "solo" && !team;
  const scope = stories ? new Set(stories) : null;
  const inScope = (row) => !scope || storiesIn(row.stories).some((s) => scope.has(s));
  const rows = specIds(paths, files).filter((row) => row.kind === "rule" && !/^new$/i.test(row.accepted ?? "") && inScope(row));
  const mine = rows.filter((row) => forOwner(row) === !team);
  const others = rows.filter((row) => forOwner(row) === team);
  const tables = [];
  const table = (id, title, columns, list, cells) => {
    if (list.length) tables.push({ id, title, columns, rows: list.map((row) => ({ id: row.id, cells: cells(row), recommended: "ok" })) });
  };
  if (!team) {
    table("product", "How the app behaves: product rules", ["Rule", "Type"], mine.filter((row) => row.type !== "safety"), (row) => [cell(row.text), label(row)]);
    // The safety rules are one list, accepted together with Take all recommendations.
    table("safety", "Promises about privacy and safety: one list", ["Rule"], mine.filter((row) => row.type === "safety"), (row) => [cell(row.text)]);
    // The tags' judgments that took a row from the owner, shown once.
    const reach = new Set(others.map((row) => row.id));
    const moved = tableRows(moves, ["ID", "Was", "Tag"]).map(({ cells }) => ({ id: bare(cells.ID), was: cells.Was, tag: bare(cells.Tag), plain: cells.Plain ?? "" })).filter((m) => reach.has(m.id));
    if (moved.length) tables.push({ id: "moved", title: "Moved to the team by the tags: confirm each, or mark it Wrong to keep it yours", columns: ["Check or rule", "Reworded as", "Tag"], rows: moved.map((m) => ({ id: m.id, cells: [cell(m.was), cell(m.plain), m.tag], recommended: "ok" })) });
    // Solo: the craft rules are the same person's, so they are one row, not a second page.
    if (solo && others.length) {
      const by = new Map();
      for (const row of others) by.set(row.category, (by.get(row.category) ?? 0) + 1);
      tables.push({ id: "craft", title: "How the test data is built: accepted together", columns: ["Craft rules"], rows: [{ id: "craft", cells: [`${others.length} craft ${others.length === 1 ? "rule" : "rules"}: ${[...by].map(([category, n]) => `${category} ${n}`).join(", ")}. npx wf testdata review ${area.id}${chunk ? ` --chunk ${chunk}` : ""} --team lists each.`], recommended: "ok" }] });
    }
  } else {
    // Craft rules a category at a time, as the team accepts them.
    for (const category of [...new Set(mine.map((row) => row.category))]) table(`craft-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, `Craft, ${category}: how the test data is built`, ["Rule"], mine.filter((row) => row.category === category), (row) => [cell(row.text)]);
  }
  const summary = team
    ? `These ${mine.length} craft rules are the team's: how the test data and its stand-ins are built. Each is recommended Fine: take all recommendations, then mark only a rule you doubt.`
    : `These ${mine.length} rules are yours: how the app behaves, and its promises about privacy and safety. Each is recommended Fine: take all recommendations, then mark a rule that is wrong or missing something. ${solo ? (others.length ? `The ${others.length} craft rules are one row at the end.` : "") : `The team handles ${others.length} craft rules: npx wf testdata review ${area.id}${chunk ? ` --chunk ${chunk}` : ""} --team.`} What a story promises is its acceptance lines, reviewed with the story.`;
  const blocks = [{ type: "text", text: summary.replace(/\s+/g, " ").trim() }];
  // The area's words, in plain terms, for an owner new to the domain.
  const glossary = paths.filter((p) => p.endsWith("/glossary.md")).flatMap((p) => tableRows(files(p), ["Term", "Plain meaning"]).map(({ cells }) => [cell(cells.Term), cell(cells["Plain meaning"])]));
  if (glossary.length && !team) blocks.push({ type: "table", title: "Words used here", columns: ["Term", "Plain meaning"], rows: glossary });
  blocks.push({ type: "questions" });
  const id = `${area.id}-${team ? "team" : "owner"}-review${chunk ? `-${chunk}` : ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64);
  return {
    id,
    title: `${area.id[0].toUpperCase()}${area.id.slice(1)} test data: ${team ? "the team's rules" : "yours to review"}${chunk ? `, ${chunk}` : ""}`,
    template: "testdata",
    intro: team ? "Rules the team checks: how the test data is built." : "The test data's rules that are yours to decide, in plain words.",
    blocks,
    tables,
  };
}
