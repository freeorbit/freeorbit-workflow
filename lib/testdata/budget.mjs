// `wf testdata budget <area> [story ids] [--check]` and `wf testdata delta
// <area> <file>`: the budgets a refresh is held to, counted by the tool and
// never left to the designer's judgement.
//
//   budget   each story's edge-case fixtures against its cap, with the lines
//            to paste into the designer's prompt; --check fails when a story,
//            its flow area, or a rule its fixtures cite is over. `wf testdata
//            refresh-close` runs it, so a refresh over budget cannot close.
//   delta    what the designer returned, before any of it is applied: at most
//            `limits.questions` questions, at most `limits.propose` proposed
//            acceptance lines a story, and no check rows at all.
//
// A story's cap follows its risk: `limits.fixtures.story` when its own Risk
// line says high, `limits.fixtures.line` for each acceptance line tagged high
// (up to the story's cap), and none for a low-risk story. `limits.allow`
// names a story, a rule, or a flow area the owner agreed may hold more.

import { matcher } from "../config/config.mjs";
import { storiesIn } from "../docs/shape.mjs";
import { readStories, riskLines } from "../docs/stories.mjs";
import { RULE_IN_TEXT } from "../ids.mjs";
import { areaSpec, bare, flowAreas, specIds, tableRows } from "./index.mjs";

const rulesIn = (cell) => [...new Set(String(cell ?? "").match(RULE_IN_TEXT) ?? [])];

/**
 * The fixture budget of one area: `{ stories: [{ id, by, high, fixtures, cap
 * }], flows: [{ name, fixtures, cap }], rules: [{ id, fixtures, cap }], over:
 * [{ kind, key, fixtures, text }] }`. With `only`, just those stories, and
 * the flow areas and rules their fixtures touch. A Stories cell is read as
 * the build order reads one, so `GM-01 to GM-05` names five stories.
 */
export function budget({ config, tracked, files }, areaId, only = null) {
  const { area, dir, paths } = areaSpec(config, tracked, areaId);
  const limits = config.testdata.limits;
  const caps = limits.fixtures ?? {};
  const allow = limits.allow ?? {};
  const byStory = new Map();
  const byRule = new Map();
  const byFlow = new Map();
  const flowOf = new Map(flowAreas(dir, tracked).flatMap((flow) => flow.paths.map((path) => [path, flow.name])));
  const scope = only?.length ? new Set(only) : null;
  const touched = { rules: new Set(), flows: new Set() };
  for (const path of paths) for (const { cells } of tableRows(files(path), ["Fixture", "Varies"])) {
    const stories = storiesIn(cells.Stories);
    const rules = rulesIn(cells.Rules);
    const flow = flowOf.get(path);
    for (const id of stories) byStory.set(id, (byStory.get(id) ?? 0) + 1);
    for (const id of rules) byRule.set(id, (byRule.get(id) ?? 0) + 1);
    if (flow) byFlow.set(flow, (byFlow.get(flow) ?? 0) + 1);
    if (!scope || stories.some((id) => scope.has(id))) {
      for (const id of rules) touched.rules.add(id);
      if (flow) touched.flows.add(flow);
    }
  }
  const stories = [];
  for (const path of tracked.filter(matcher(config.stories.files))) for (const story of readStories(files(path), area.prefix ? [area.prefix] : [], path)) {
    if (story.removed || (scope && !scope.has(story.id))) continue;
    const risk = riskLines(story);
    const base = risk.by === "story" ? caps.story ?? 0 : risk.by === "line" ? Math.min(caps.story ?? Infinity, (caps.line ?? 0) * risk.high.length) : 0;
    stories.push({ id: story.id, by: risk.by, high: risk.high.length, fixtures: byStory.get(story.id) ?? 0, cap: allow[story.id] ?? base });
  }
  const flows = [...touched.flows].sort().map((name) => ({ name, fixtures: byFlow.get(name) ?? 0, cap: allow[name] ?? caps.area ?? 0 }));
  const rules = [...touched.rules].sort().map((id) => ({ id, fixtures: byRule.get(id) ?? 0, cap: allow[id] ?? caps.rule ?? 0 }));
  const over = [];
  for (const s of stories) if (s.fixtures > s.cap) over.push({ kind: "story", key: s.id, fixtures: s.fixtures, text: `${s.id}: ${s.fixtures} edge-case fixtures, over its ${s.cap}${s.by === "low" ? " (a low-risk story gets none: its cases are classes of an input)" : s.by === "line" ? ` (${s.high} high-risk ${s.high === 1 ? "line" : "lines"})` : ""}` });
  for (const f of flows) if (f.cap && f.fixtures > f.cap) over.push({ kind: "flow", key: f.name, fixtures: f.fixtures, text: `${f.name}: ${f.fixtures} edge-case fixtures, over the flow area's ${f.cap}` });
  for (const r of rules) if (r.cap && r.fixtures > r.cap) over.push({ kind: "rule", key: r.id, fixtures: r.fixtures, text: `${r.id}: ${r.fixtures} edge-case fixtures cite it, over a rule's ${r.cap}` });
  // The next free number of each kind, a dropped row's number counted: the designer cannot read every file to find it.
  const next = {};
  if (area.prefix) {
    const last = { R: 0, G: 0, DS: 0 };
    for (const { id } of specIds(paths, files)) {
      const m = new RegExp(`^(R|G|DS)-${area.prefix}-(\\d+)$`).exec(id);
      if (m) last[m[1]] = Math.max(last[m[1]], Number(m[2]));
    }
    for (const letter of Object.keys(last)) next[letter] = `${letter}-${area.prefix}-${String(last[letter] + 1).padStart(2, "0")}`;
  }
  return { area: area.id, stories, flows, rules, over, next };
}

/**
 * What is over budget now and holds more fixtures than it did in `before`,
 * the same budget read from the last commit. A refresh is held to what it
 * added: an overage it found there is the owner's to fix, and never stops a
 * story being recorded as covered.
 */
export function grown(now, before) {
  const was = new Map([...before.stories.map((s) => [`story:${s.id}`, s.fixtures]), ...before.flows.map((f) => [`flow:${f.name}`, f.fixtures]), ...before.rules.map((r) => [`rule:${r.id}`, r.fixtures])]);
  return now.over.filter((each) => each.fixtures > (was.get(`${each.kind}:${each.key}`) ?? 0));
}

/** The budget as lines to print: the lines for the designer's prompt, then what is over. */
export function budgetLines(result, limits) {
  const room = (n, cap) => `${n} of ${cap}${n >= cap ? ", no room" : `, room for ${cap - n}`}`;
  const lines = ["Budget:"];
  for (const s of result.stories) lines.push(`- ${s.id} (${s.by === "low" ? "low risk" : s.by === "story" ? "high risk" : `${s.high} high-risk ${s.high === 1 ? "line" : "lines"}`}): fixtures ${room(s.fixtures, s.cap)}`);
  for (const f of result.flows) lines.push(`- ${f.name}: fixtures ${room(f.fixtures, f.cap)}`);
  lines.push(`- At most ${limits.propose} proposed acceptance lines a story and ${limits.questions} questions in all, the most important first; anything past that is cut.`);
  lines.push(`- A file holds about ${limits.lines} lines, and a flow area about ${limits.areaKB} KB.`);
  if (result.next?.R) lines.push(`- Next free IDs: ${result.next.R} for a rule, ${result.next.G} for a gap, ${result.next.DS} for a dataset.`);
  if (result.over.length) {
    lines.push("", "Over budget:");
    for (const each of result.over) lines.push(`  ${each.text}`);
    lines.push("  Merge rows into one with axes, move a case that varies one input into its input classes, or drop the row. An exception is the owner's: testdata.limits.allow.");
  }
  return lines;
}

/**
 * A designer's return, checked before any of it is applied: `{ problems:
 * [line], held: [id or text] }`. The designer ranks its rows, so what is
 * past a cap is cut from the end and listed as held, never asked for again.
 * Only the return's own `## Questions` count: a gaps table inside a file of a
 * first draft is part of that file.
 */
export function checkDelta(text, config, areaPrefix = "") {
  const limits = config.testdata.limits;
  const problems = [];
  const held = [];
  const checks = [...tableRows(text, ["ID", "Check"]), ...tableRows(text, ["Check", "Stories"])];
  if (checks.length) problems.push(`${new Set(checks.map((row) => row.line)).size} check rows: the designer writes no checks; what a passing run shows is an acceptance line, proposed under "## Proposed acceptance"`);
  const all = String(text ?? "").split("\n");
  const heading = (line) => all.slice(0, line).findLast((each) => /^#{1,6}\s/.test(each)) ?? "";
  const questions = tableRows(text, ["ID", "Kind", "Question"]).filter(({ line, cells }) => /^#{1,6}\s+Questions\b/i.test(heading(line)) && !/^dispute$/i.test(bare(cells.Kind)));
  if (limits.questions && questions.length > limits.questions) {
    const cut = questions.slice(limits.questions).map(({ cells }) => bare(cells.ID) || cells.Question.slice(0, 40));
    problems.push(`${questions.length} questions, over ${limits.questions}: keep the first ${limits.questions}; held back: ${cut.join(", ")}`);
    held.push(...cut);
  }
  const proposed = new Map();
  for (const { cells } of tableRows(text, ["Story", "Proposed line"])) {
    const story = bare(cells.Story);
    if (areaPrefix && !story.startsWith(`${areaPrefix}-`)) problems.push(`a proposed acceptance line names ${story || "no story"}, which is not one of this area's (${areaPrefix}-NN)`);
    proposed.set(story, [...(proposed.get(story) ?? []), cells["Proposed line"]]);
  }
  for (const [story, list] of proposed) if (limits.propose && list.length > limits.propose) {
    problems.push(`${story}: ${list.length} proposed acceptance lines, over ${limits.propose}: keep the first ${limits.propose}`);
    held.push(...list.slice(limits.propose).map((line) => `${story}: ${line.slice(0, 60)}`));
  }
  return { problems, held };
}
