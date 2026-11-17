// The end-to-end test's choice page: which area to walk, with each area's
// journeys counted from its test-data spec. The answer is the `wf testdata
// journeys` listing the e2e-test skill starts from.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// A journey's heading: ### DS-<prefix>-<n>. or, in a spec not yet renamed, ### D<n>.
const JOURNEY = /^### (?:DS-[A-Z]+-\d+|D\d+)\./gm;

/** An area's journeys, counted in its test-data folder's Markdown files. */
export function journeyCount(root, area) {
  const dir = join(root, area.docs ?? "", "test-data");
  if (!area.docs || !existsSync(dir)) return 0;
  const files = readdirSync(dir, { recursive: true }).filter((file) => String(file).endsWith(".md"));
  return files.reduce((n, file) => n + (readFileSync(join(dir, String(file)), "utf8").match(JOURNEY)?.length ?? 0), 0);
}

/** The end-to-end test's launch spec, from the project at `root`. */
export function e2eSpec(root, config) {
  const areas = (config.areas ?? []).map((area) => ({ area, journeys: journeyCount(root, area) }));
  const runs = areas.map(({ area, journeys }) => ({
    id: `a-${area.id}`,
    label: area.id,
    why: journeys ? plural(journeys, "journey") : "no journeys in its test-data spec yet",
    command: `npx wf testdata journeys ${area.id}`,
  }));
  const total = areas.reduce((n, each) => n + each.journeys, 0);
  return {
    id: "e2e-area",
    title: "Which area end to end?",
    template: "launch",
    intro: "Pick the area the tester walks. Its journeys run through the app on their scenarios, and journeys that need a real outside service wait for your yes. The command above Send lists what the run starts from.",
    from: "developer",
    blocks: [
      {
        type: "stats",
        title: "Journeys",
        items: areas.map(({ area, journeys }) => ({ label: area.id, value: String(journeys), tone: journeys ? "info" : "warn" })).concat([{ label: "In all", value: String(total), tone: "info" }]).slice(0, 8),
      },
      { type: "questions" },
    ],
    runs,
    noPick: "The area is the person's to name; each walk costs about as much as its journeys.",
  };
}
