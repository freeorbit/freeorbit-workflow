// The docs index's kit tables, written by `wf docs sync` between
// `<!-- wf:index name -->` and `<!-- /wf:index name -->` lines in docs.index:
//
//   words     the words the workflow uses, then the project's own from docs.words
//   workflow  one row per kit doc the project syncs
//   logs      one row per log that exists: the build order and each area's file,
//             the questions, the chunks done, the review ledger, the decisions, ...
//
// The project keeps its own rows in tables of its own. doc:check fails a table
// that is out of date.

import path from "node:path";

import { cell } from "./table.mjs";

const BLOCK = /^<!-- wf:index ([a-z]+) -->\n[\s\S]*?^<!-- \/wf:index \1 -->$/gm;

/** What each kit doc holds, for its row. A kit doc without one fails the kit's tests. */
export const SUMMARIES = {
  "ai-tools": "Shared Claude Code and OpenCode instructions, skills, generated agents, command adapters, and local handoffs.",
  asking: "When an agent asks the role that owns a choice before making it, when it does not, and how it asks.",
  branches: "Branch names, pull requests, squash merges, and the hooks that keep work off the base branch.",
  "build-order": "How an area's build order is made and kept: chunks, the rules for their order, and each status word.",
  "code-standards": "The rules code is written and reviewed against, and the severity scale. It grows only by findings the reviewer accepts.",
  config: "Every setting in .workflow/config.json: what it does, its default, and why. Generated from the kit.",
  efficiency: "The efficiency hypothesis and how it is tested.",
  ids: "Every ID the workflow makes, its pattern, and where it is defined; npx wf id finds one.",
  "four-steps": "The four steps for each area, the tracks, chunk start and end, and the check of stories against frames.",
  overview: "How the plugins, the wf command, the docs, GitHub, the app, and the client board fit together, with diagrams. Start here.",
  releasing: "Release lines, versions, release notes, and tags, from a bump to a published release.",
  "project-kinds": "The project kinds (app, domain product, data pipeline, integration, catalog), Step 0 source analysis, outside registers, and packs.",
  "test-data-formats": "The shapes of an area's test-data folder: page-sized files, the rules table and its categories, risk tiers, edge cases, states, and gaps.",
  "test-data-process": "Building and testing with synthetic data: a blind designer writes the spec, one generator makes it, and a test fails when they drift.",
  tools: "Every outside program the workflow and the project need, why, what breaks without it, and what an agent does when one is missing.",
  "writing-docs": "Story and flow formats, IDs, table cells, and the files a new area gets.",
  "root/AGENTS": null,
  "root/CLAUDE": null,
};

/** The words every project using the kit shares. */
export const WORDS = [
  ["Area", "One part of the product with its own stories, such as the app or a plugin. Each area goes through the four steps on its own."],
  ["Step", "One of the four steps: stories and flows, frames, architecture, implementation."],
  ["Story", "One thing a user wants, with an ID of its area's prefix and a number, and acceptance lines that are the test."],
  ["Chunk", "One small piece of the build in Step 4: a few whole stories, built, tested, reviewed, and committed together, with an id such as CH-01, a title, and a role."],
  ["Track", "How much ceremony a change gets: quick, chunk, or area, from `wf ready` and `wf done`."],
];

const link = (index, file) => `[${file.replace(/^docs\//, "")}](${path.posix.relative(path.posix.dirname(index), file) || file})`;

/** Each log the project has, as [file, what it holds]. */
export function logRows(config, has) {
  const { buildOrder, logs, areas, decisionTopics } = config;
  const areaFile = (area) => `${path.posix.dirname(buildOrder.file)}/build-order/${area.id}.md`;
  const decisionFile = (id) => `${logs.decisions}/${id}.md`;
  const closed = path.posix.relative(path.posix.dirname(config.docs.index), logs.decisionsClosed);
  const rows = [
    [buildOrder.file, "Each area's step status, and the chunks not finished yet, by where they stand."],
    ...areas.map((area) => [areaFile(area), `The ${area.id} area's build order: why its chunks come in this order, its map, and its History.`]),
    [logs.openQuestions, "Every question not settled yet, under the chunk it blocks."],
    [logs.questionsResolved, "Open questions that are settled, with the date, so the reason behind a chunk is not lost."],
    [buildOrder.done, "Every finished chunk, with what it delivered."],
    [logs.ledger, "The review's open and fixed findings, and the end-to-end tester's as `E2E-`, each with evidence, a rule, and the reviewer's verdict."],
    [logs.ledgerClosed, "The full record of each closed review finding, looked up by ID."],
    [logs.e2eRuns, "One row per end-to-end test run, with what it found after replay, to judge whether it earns its cost."],
    [logs.troubleshooting, "Every issue that took real debugging, with the symptom, cause, and fix. Search it before debugging a symptom."],
    [logs.efficiencyLog, "Real wasted effort, who corrected it, the change made, and whether it held."],
    ...areas.map((area) => [decisionFile(area.id), `Decisions for the ${area.id} area, \`D-${area.prefix}-\`, newest on top.`]),
    ...decisionTopics.map((topic) => [decisionFile(topic.id), `Decisions about ${topic.id}, \`D-${topic.prefix}-\`, newest on top. Superseded ones are in \`${closed}/\`.`]),
  ];
  return rows.filter(([file]) => file && has(file));
}

/** One kit table, by its block name; null for a name the kit does not write. */
export function table(name, config, read, places) {
  const index = config.docs.index;
  const has = (file) => read(file) !== null;
  const head = (first) => [`| ${first} | ${first === "Word" ? "Meaning" : "What it holds"} |`, "| --- | --- |"];
  if (name === "words") return [...head("Word"), ...[...WORDS, ...Object.entries(config.docs.words)].map(([word, meaning]) => `| ${cell(word)} | ${cell(meaning)} |`)];
  if (name === "workflow") {
    const synced = new Set(config.docs.synced ?? places.map((place) => place.name));
    const rows = places.filter((place) => (place.generated || synced.has(place.name)) && SUMMARIES[place.name] && has(place.file));
    return [...head("Doc"), ...rows.map((place) => `| ${link(index, place.file)} | ${cell(SUMMARIES[place.name])} |`)];
  }
  if (name === "logs") return [...head("Doc"), ...logRows(config, has).map(([file, holds]) => `| ${link(index, file)} | ${cell(holds)} |`)];
  return null;
}

function blocks(text) {
  return [...text.matchAll(BLOCK)].map((match) => ({ name: match[1], whole: match[0] }));
}

const written = (name, lines) => [`<!-- wf:index ${name} -->`, ...lines, `<!-- /wf:index ${name} -->`].join("\n");

/** The index text with each kit table rewritten; a block the kit does not know is left as it is. */
export function withIndex(text, config, read, places) {
  let out = text;
  for (const { name, whole } of blocks(text)) {
    const lines = table(name, config, read, places);
    if (lines) out = out.replace(whole, () => written(name, lines));
  }
  return out;
}

/** doc:check's problems with the index's kit tables. */
export function indexProblems(config, read, places) {
  const text = read(config.docs.index);
  if (text === null) return [];
  const problems = [];
  const opened = text.match(/^<!-- wf:index .* -->$/gm)?.length ?? 0;
  if (opened !== blocks(text).length) problems.push(`${config.docs.index}: a wf:index line has no matching end, or its name is not lowercase letters`);
  for (const { name, whole } of blocks(text)) {
    const lines = table(name, config, read, places);
    if (!lines) problems.push(`${config.docs.index}: no kit table is called ${name}; use words, workflow, or logs`);
    else if (whole !== written(name, lines)) problems.push(`${config.docs.index}: its ${name} table is out of date, run wf docs sync`);
  }
  return problems;
}
