// `wf init <answers.json>`: set up a new project from the answers the
// workflow-init skill collects. It writes the config, the logs, each area's
// first docs, the docs index, the package scripts, and the Claude Code
// settings, then syncs the kit's docs, the agent settings, the hooks, and the
// GitHub files. A file that already exists is never overwritten; init says so
// and leaves it for the person to merge.
//
// The answers:
//
//   { "project": "Atlas NX", "team": "team",
//     "people": [{ "name": "Ana", "handle": "ana-gh", "email": "ana@example.com", "roles": ["owner"] }],
//     "scopes": ["app", "review", "workflow"],
//     "areas": [{ "id": "app", "prefix": "APP", "docs": "docs/app" }],
//     "plugins": ["core", "review", "testdata", "design"],
//     "kit": { "tag": "v0.21.0" },
//     "config": { "design": { "source": "png" }, "ai": { "tools": ["claude"] } } }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { merge, unknownKeys } from "./config.mjs";
import { decisionFiles, emptyFile } from "./decisions.mjs";
import { DEFAULTS } from "./defaults.mjs";
import { roleProblems } from "./roles.mjs";

export const KIT_REPO = "freeorbit/freeorbit-workflow";
export const PLUGINS = ["core", "review", "testdata", "design", "e2e", "release", "stack-tauri-rust", "stack-web"];

const rel = (from, to) => path.posix.relative(path.posix.dirname(from), to);
const lines = (...parts) => `${parts.flat().join("\n")}\n`;
export const AI_TOOLS = ["claude", "opencode"];

/** True for a relative path that stays inside the project: no absolute path and no "..". */
export function inside(file) {
  return typeof file === "string" && file.length > 0 && !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..");
}

/** The problems with a set of answers, before anything is written. */
export function answerProblems(answers) {
  const problems = [];
  for (const key of ["project", "people", "areas", "plugins"]) if (!answers[key]?.length) problems.push(`answers: ${key} is missing`);
  if (!answers.kit?.tag) problems.push("answers: kit.tag is missing, such as v0.21.0");
  for (const name of answers.plugins ?? []) if (!PLUGINS.includes(name)) problems.push(`answers: no kit plugin ${name}; one of ${PLUGINS.join(", ")}`);
  if (answers.plugins && !answers.plugins.includes("core")) problems.push("answers: plugins must include core");
  for (const area of answers.areas ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(area.id ?? "")) problems.push(`answers: area id ${JSON.stringify(area.id)} is not lowercase words joined by hyphens`);
    if (!/^[A-Z]{2,5}$/.test(area.prefix ?? "")) problems.push(`answers: area ${area.id} needs a story prefix of 2 to 5 capitals`);
    if (!area.docs?.startsWith("docs/") || !inside(area.docs)) problems.push(`answers: area ${area.id} needs a docs folder under docs/`);
  }
  const config = configFrom(answers);
  problems.push(...unknownKeys(config).map((key) => `answers: config has ${key}, which the kit does not know`));
  for (const tool of config.ai?.tools ?? []) if (!AI_TOOLS.includes(tool)) problems.push(`answers: ai.tools has ${tool}; one of ${AI_TOOLS.join(", ")}`);
  if (config.ai?.tools && !config.ai.tools.length) problems.push("answers: ai.tools is empty; name claude, opencode, or both");
  const full = merge(DEFAULTS, config);
  for (const file of [...starterFiles(full, answers.plugins ?? [], "today").keys()]) if (!inside(file)) problems.push(`answers: ${file} is not a path inside the project`);
  if (!problems.length) problems.push(...roleProblems(merge(DEFAULTS, config)));
  return problems;
}

/** The project's .workflow/config.json from the answers. */
export function configFrom(answers) {
  const areas = answers.areas ?? [];
  const scopes = [...new Set([...(answers.scopes ?? []), ...areas.map((area) => area.id), "workflow"])];
  const base = {
    project: answers.project,
    team: answers.team ?? (answers.people?.length > 1 ? "team" : "solo"),
    people: answers.people,
    scopes,
    areas,
    review: { threatModel: `${areas[0]?.docs ?? "docs"}/threat-model.md` },
    stories: { files: areas.map((area) => `${area.docs}/user-stories.md`) },
    tracks: { check: "npx wf check", fullCheck: "npx wf check --all" },
    // The docs check is the one step every project has from the start; Step 3 adds the stack's.
    check: { steps: [{ name: "docs", command: "npx wf doc:check" }] },
  };
  const reviewers = (answers.people ?? []).filter((person) => (person.roles ?? []).includes("reviewer"));
  if (base.team === "team" && reviewers.length === 1) base.github = { adminBypass: true };
  return merge(base, answers.config ?? {});
}

/** The files a new project starts with, by path, from its full config. */
export function starterFiles(config, plugins, today) {
  const files = new Map();
  const { buildOrder, logs, docs, areas } = config;
  const order = buildOrder.file;
  const areaFile = (area) => `${path.posix.dirname(order)}/build-order/${area.id}.md`;
  const workflow = (from, doc, anchor = "") => `${rel(from, `${docs.workflow}/${doc}.md`)}${anchor}`;

  files.set(
    order,
    lines(
      "# Build order",
      "",
      `The order every area's stories are built in, chunk by chunk. How it is made, and what each status means, are in [build-order.md](${workflow(order, "build-order")}). Finished chunks are in [the done list](${rel(order, buildOrder.done)}).`,
      "",
      "## Areas",
      "",
      "| Area | Stories | Frames | Architecture | Build |",
      "| --- | --- | --- | --- | --- |",
      areas.map((area) => `| [${area.id}](${rel(order, areaFile(area))}) | Not started | Not started | Not started | Not started |`),
      "",
      "## Chunks",
      "",
      buildOrder.groups.flatMap((group) => [`### ${group}`, "", "None.", ""]),
    ),
  );
  for (const area of areas) {
    files.set(areaFile(area), lines(`# ${area.id} build order`, "", "## Why this order", "", "Written at the end of the area's Step 3.", "", "## Map", "", "Written with the order.", "", "## History", "", `- ${today}: the area was set up.`));
  }
  files.set(buildOrder.done, lines("# Finished chunks", "", "Every finished chunk, with what it delivered, newest last. Numbers name a chunk and are not always the build sequence.", "", "| Chunk | Stories | Area | What it builds | Likely new libraries | Status | Detail |", "| --- | --- | --- | --- | --- | --- | --- |"));
  files.set(
    logs.openQuestions,
    lines(
      "# Open questions",
      "",
      `Every question not settled yet. Do not treat one as a decision. When the role that owns it answers, the answer goes in [decisions](${rel(logs.openQuestions, logs.decisions)}/), and the item moves to [the resolved questions](${rel(logs.openQuestions, logs.questionsResolved)}) with the date. A question that blocks a chunk sits under that chunk's heading.`,
      "",
      "## Not tied to a chunk yet",
      "",
      "None.",
    ),
  );
  files.set(logs.questionsResolved, lines("# Resolved questions", "", `Questions from [open-questions.md](${rel(logs.questionsResolved, logs.openQuestions)}) that are settled, oldest first, with the date. The decision itself is in [decisions](${rel(logs.questionsResolved, logs.decisions)}/).`));
  files.set(
    logs.ledger,
    lines(
      "# Review findings",
      "",
      "Last reviewed: none.",
      "Deep reviewed: none.",
      "Deferred: none.",
      "",
      "## Light runs",
      "",
      "Runs where the blind passes ran on the lighter model and a different one verified. The next deep run covers them and clears this table.",
      "",
      "| Range | Date | Mode |",
      "| --- | --- | --- |",
      "",
      `Rubric: [code-standards.md](${workflow(logs.ledger, "code-standards")}). Process: the \`code-review-ledger\` skill. Only the skill writes this file, and a finding keeps its ID for good.`,
      "",
      "## Summary",
      "",
      "### Open",
      "",
      "| ID | Severity | Status | Title | Where |",
      "| --- | --- | --- | --- | --- |",
      "",
      "### Fixed, waiting for review",
      "",
      "| ID | Severity | Status | Title | Where |",
      "| --- | --- | --- | --- | --- |",
      "",
      "## Open",
      "",
      "## Fixed, waiting for review",
    ),
  );
  files.set(logs.ledgerClosed, lines("# Closed review findings", "", "The full record of each closed finding, newest first. Statuses verified, rejected, accepted-risk, superseded. Nothing reads this file in full: look a finding up by its ID.", "", "## Summary", "", "| ID | Severity | Status | Title | Where |", "| --- | --- | --- | --- | --- |", "", "## Details"));
  files.set(logs.troubleshooting, lines("# Troubleshooting", "", "Issues we ran into, newest group first, so the next person or agent does not debug them again. Add an entry in the same change that fixes an issue that took real debugging, including one fixed by a workaround or left open.", "", "Each entry has a short title, the date, and a status (Fixed, Workaround, Open, Harmless, or Avoid), then the symptom with the exact error text, the cause, and the fix."));
  files.set(
    logs.efficiencyLog,
    lines(
      "# Efficiency log",
      "",
      `Real wasted effort and the change it led to, oldest row first. The hypothesis and its test are in [efficiency.md](${workflow(logs.efficiencyLog, "efficiency")}). No waste, no row.`,
      "",
      "Held? is `Not yet tested`, `Yes`, `No`, or `Dropped`.",
      "",
      "| Date | Area | What happened | Who corrected | Change | Held? |",
      "| --- | --- | --- | --- | --- | --- |",
    ),
  );
  if (plugins.includes("e2e")) {
    files.set(logs.e2eRuns, lines("# E2E runs", "", "One row per run of the `e2e-test` skill, oldest first, to judge whether it earns its cost.", "", "| Date | Area and journeys | Drafts | Kept after replay | Accepted | Also caught elsewhere | Tokens |", "| --- | --- | --- | --- | --- | --- | --- |"));
  }
  for (const file of decisionFiles(config)) files.set(file.path, `${emptyFile(file)}`);

  for (const area of areas) {
    const stories = `${area.docs}/user-stories.md`;
    files.set(stories, lines(`# ${area.id} user stories`, "", `The ${area.id} area's stories, \`${area.prefix}-\`, in the shape [writing-docs.md](${workflow(stories, "writing-docs", "#story-shape")}) gives. Step 1 writes them; each one's acceptance lines are its test.`));
    const flows = `${area.docs}/user-flows.md`;
    files.set(flows, lines(`# ${area.id} user flows`, "", `How a person moves through the ${area.id} area's stories, in the shape [writing-docs.md](${workflow(flows, "writing-docs", "#flows")}) gives. Written in Step 1, beside the stories.`));
    if (plugins.includes("design")) {
      const screens = `${area.docs}/${config.design.screens}`;
      const pictures = `${config.design.review}/${area.id}`;
      const how = config.design.source === "png" ? "exported from the design tool as PNG" : "drawn as HTML and rendered";
      files.set(screens, lines(`# ${area.id} screens`, "", `The ${area.id} area's frames, ${how}, under \`${pictures}/<section>/\`. One section per screen-list heading, and one row per frame. Step 2 writes them.`));
    }
  }
  const threat = config.review.threatModel;
  if (threat) files.set(threat, null);

  files.set(docs.index, indexFile(config, plugins));
  return files;
}

/** The docs index: the kit's tables between markers, and a table of each area's own docs. */
export function indexFile(config, plugins) {
  const index = config.docs.index;
  const link = (file) => `[${file.replace(/^docs\//, "")}](${rel(index, file)})`;
  const rows = config.areas.flatMap((area) => [
    `| ${link(`${area.docs}/user-stories.md`)} | The ${area.id} area's stories. |`,
    `| ${link(`${area.docs}/user-flows.md`)} | The ${area.id} area's flows. |`,
    ...(plugins.includes("design") ? [`| ${link(`${area.docs}/${config.design.screens}`)} | The ${area.id} area's screen list: each frame, its stories, and how the app reaches it. |`] : []),
  ]);
  if (config.review.threatModel) rows.push(`| ${link(config.review.threatModel)} | What is protected, who could attack it, and where trust changes. Drafted at the first area's Step 3. |`);
  return lines(
    `# ${config.project} docs`,
    "",
    "What the product is, in a paragraph, goes here.",
    "",
    "## Status",
    "",
    `Where each area stands is in ${link(config.buildOrder.file)}. \`npx wf doc:facts\` prints it.`,
    "",
    "## Words we use",
    "",
    "<!-- wf:index words -->",
    "<!-- /wf:index words -->",
    "",
    "## Workflow",
    "",
    "The workflow kit's docs, synced by `npx wf docs sync`:",
    "",
    "<!-- wf:index workflow -->",
    "<!-- /wf:index workflow -->",
    "",
    "## Logs",
    "",
    "Append-only records that grow every chunk. Never read one whole: `npx wf doc:find <ID, date, or heading>` prints just that entry.",
    "",
    "<!-- wf:index logs -->",
    "<!-- /wf:index logs -->",
    "",
    "## Areas",
    "",
    "| Doc | What it holds |",
    "| --- | --- |",
    rows,
    "",
    "## Adding something",
    "",
    "A new doc gets a row here. A new area gets an entry in `areas` in `.workflow/config.json`, its folder, a row in the build order's Areas table, and its own file beside the build order.",
  );
}

/** package.json with the kit as a dev dependency and its scripts, keeping the project's own. */
export function withPackage(text, config, tag) {
  const pkg = text ? JSON.parse(text) : { name: config.project.toLowerCase().replace(/[^a-z0-9]+/g, "-"), private: true };
  pkg.scripts = {
    prepare: "wf hooks install",
    check: "wf check",
    "check:tools": "wf tools",
    "doc:check": "wf doc:check",
    "doc:facts": "wf doc:facts",
    "doc:find": "wf doc:find",
    ...pkg.scripts,
  };
  pkg.devDependencies = { ...pkg.devDependencies, "freeorbit-workflow": `git+https://github.com/${KIT_REPO}.git#${tag}` };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** .claude/settings.json with the kit's marketplace at the tag and its plugins on, keeping the project's own. */
export function withSettings(text, plugins, tag) {
  const settings = text ? JSON.parse(text) : {};
  settings.enabledPlugins = { ...settings.enabledPlugins, ...Object.fromEntries(plugins.map((name) => [`${name}@freeorbit-workflow`, true])) };
  settings.extraKnownMarketplaces = { ...settings.extraKnownMarketplaces, "freeorbit-workflow": { source: { source: "github", repo: KIT_REPO, ref: tag } } };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** .gitignore with the kit's working folders, keeping the project's own lines. */
export function withIgnore(text) {
  // "/node_modules", "node_modules", and "node_modules/" all ignore the folder.
  const plain = (line) => line.trim().replace(/^\//, "").replace(/\/$/, "");
  const have = new Set((text ?? "").split("\n").map(plain));
  const add = ["node_modules/", ".cache/"].filter((line) => !have.has(plain(line)));
  if (!add.length) return text;
  return `${text ? `${text.replace(/\n*$/, "")}\n\n` : ""}# The workflow kit's working folders.\n${add.join("\n")}\n`;
}

/** Write what init writes; returns [path, what happened] for each file. */
export function writeStarter(root, answers, { today, template }) {
  const read = (file) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), "utf8") : null);
  // Everything is read and checked before the first write, so a bad file stops init with nothing changed.
  const parsed = (file) => {
    const text = read(file);
    try {
      return text === null ? null : (JSON.parse(text), text);
    } catch (error) {
      throw new Error(`${file} is not valid JSON (${error.message}); fix it, then run init again`);
    }
  };
  const kept = parsed(".workflow/config.json");
  // A config the project already has wins, so the starter files agree with it.
  const config = merge(DEFAULTS, kept ? JSON.parse(kept) : configFrom(answers));
  const plan = [[".workflow/config.json", `${JSON.stringify(configFrom(answers), null, 2)}\n`, false]];
  for (const [file, text] of starterFiles(config, answers.plugins, today)) plan.push([file, text ?? template, false]);
  plan.push(["package.json", withPackage(parsed("package.json"), config, answers.kit.tag), true]);
  plan.push([".claude/settings.json", withSettings(parsed(".claude/settings.json"), answers.plugins, answers.kit.tag), true]);
  const ignore = withIgnore(read(".gitignore"));
  if (ignore !== read(".gitignore")) plan.push([".gitignore", ignore, true]);
  const outside = plan.map(([file]) => file).filter((file) => !inside(file));
  if (outside.length) throw new Error(`refusing to write outside the project: ${outside.join(", ")}`);

  const report = [];
  for (const [file, text, merges] of plan) {
    const full = path.join(root, file);
    const there = existsSync(full);
    if (there && !merges) {
      report.push([file, "kept, already there"]);
      continue;
    }
    if (there && readFileSync(full, "utf8") === text) continue;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
    report.push([file, there ? "merged" : "written"]);
  }
  return report;
}
