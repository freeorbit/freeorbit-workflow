// Where the work stands, and how the docs are growing, as facts for a person or
// a model to judge. Status comes from the logs' shape, so no one reads a log to
// find it. Growth names what costs tokens: what every session loads, large
// docs, repeated headings, a prompt that tells an agent to read a large doc,
// and docs still waiting to be tightened.

import { matcher } from "../config.mjs";
import { loadExtensions } from "../extensions.mjs";
import {
  areaRows,
  chunkRows,
  efficiencyDue,
  findingRows,
  frontmatter,
  longBlocks,
  openQuestions,
  repeatedHeadings,
  section,
  tokens,
  wholeReads,
} from "./shape.mjs";

/** The status lines. */
export async function status(context) {
  const { config, tracked, files } = context;
  const present = new Set(tracked);
  const read = (path) => (present.has(path) ? files(path) : "");
  const { file, done: donePath } = config.buildOrder;
  const out = ["Status"];
  for (const row of areaRows(read(file))) {
    out.push(`  ${row.area}: ${Object.entries(row.steps).map(([step, cell]) => `${step} ${cell}`).join("; ")}`);
  }
  const rows = chunkRows(read(file));
  for (const group of ["In progress", "Waiting"]) {
    const names = rows.filter((row) => row.group === group).map((row) => row.chunk);
    out.push(`  ${group}: ${names.join("; ") || "none"}`);
  }
  const next = rows.find((row) => row.group === "Not started");
  out.push(`  Next not started: ${next?.chunk ?? "none"}`);
  const done = chunkRows(read(donePath));
  out.push(`  Last done: ${done.at(-1)?.chunk ?? "none"} (${done.length} done)`);
  for (const extension of await loadExtensions(context)) out.push(...(extension.status?.(context) ?? []));
  const builtRows = read(donePath).split("\n").filter((line) => line.startsWith("| "));
  const check = efficiencyDue(read(config.logs.efficiency), builtRows, config.efficiency.checkEvery);
  out.push(`  Efficiency check: last ${check.last}, ${check.since} chunks built since${check.due ? ", due" : ""}`);
  const ledger = read(config.logs.ledger);
  for (const name of ["Last reviewed", "Deep reviewed", "Deferred"]) {
    out.push(`  ${ledger.match(new RegExp(`^${name}: .*$`, "m"))?.[0] ?? `${name}: missing`}`);
  }
  const groups = ["### Open", "### Fixed, waiting for review"].map((h) => findingRows(section(ledger, h)).length);
  const closed = findingRows(section(read(config.logs.ledgerClosed), "## Summary")).length;
  out.push(`  Findings: ${groups[0]} open, ${groups[1]} fixed waiting for review, ${closed} closed`);
  const proposed = findingRows(section(ledger, "### Open")).filter((row) => row.includes("| proposed |")).length;
  const owner = config.people[0]?.name;
  if (proposed) out.push(`  Findings waiting for ${owner ? `${owner}'s` : "a"} verdict: ${proposed}`);
  out.push("  Open questions:");
  for (const group of openQuestions(read(config.logs.openQuestions))) out.push(`    ${group.count}  ${group.heading}`);
  return out;
}

/** The growth lines. */
export function growth({ config, tracked, files }) {
  const { always, largeDoc, largePrompt } = config.growth;
  const out = ["Growth"];
  const size = (path) => Buffer.byteLength(files(path));
  const isPrompt = matcher(config.growth.prompts);
  const prompts = tracked.filter(isPrompt);
  const alwaysBytes = always.filter((path) => tracked.includes(path)).reduce((sum, path) => sum + size(path), 0);
  const described = prompts.reduce((sum, path) => sum + Buffer.byteLength(frontmatter(files(path))), 0);
  out.push(`  Always loaded: ~${tokens(alwaysBytes + described)} tokens (${always.join(", ")} ${alwaysBytes} B, skill and agent frontmatter ${described} B)`);
  for (const path of prompts.filter((p) => size(p) > largePrompt)) out.push(`  Large prompt: ${path} ${size(path)} B, ~${tokens(size(path))} tokens`);
  const isDoc = matcher(config.growth.docs);
  const notDoc = matcher(config.growth.notDocs);
  const docs = tracked.filter((path) => path.endsWith(".md") && isDoc(path) && !notDoc(path));
  const large = docs.filter((path) => size(path) > largeDoc).sort((a, b) => size(b) - size(a));
  for (const path of large) out.push(`  Large doc: ${path} ${size(path)} B, ~${tokens(size(path))} tokens to read whole`);
  for (const path of docs) for (const heading of repeatedHeadings(files(path))) out.push(`  Repeated heading: ${path} "${heading}"`);
  for (const path of tracked.filter((p) => always.includes(p) || isPrompt(p))) {
    for (const hit of wholeReads(files(path), large)) out.push(`  Read with no search: ${path} names ${hit.path}: "${hit.line.trim().slice(0, 120)}"`);
  }
  for (const path of config.docs.loose) {
    if (!tracked.includes(path)) {
      out.push(`  Loose doc: ${path} is gone, take it off loose`);
      continue;
    }
    const count = longBlocks(files(path), config.docs.blockWords).length;
    out.push(`  Loose doc: ${path} ${count ? `has ${count} long blocks` : "has none, take it off loose"}`);
  }
  return out;
}
