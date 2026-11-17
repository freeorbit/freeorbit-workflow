// The end-to-end test's choice page: which area to walk, with each area's
// journeys counted from its test-data spec. The answer is the `wf testdata
// journeys` listing the e2e-test skill starts from.

import { project } from "../config/config.mjs";
import { plural } from "./words.mjs";

// A journey's heading, as the test-data checks read it: ### DS-<prefix>-<n> or, in a spec not yet renamed, ### D<n>.
const JOURNEY = /^###\s+(?:DS-[A-Z]+-\d+|D\d+)\b/gm;

/** An area's journeys, counted in its test-data folder's Markdown files, through the project's reader, so no link out of it is read. */
export function journeyCount(ctx, area) {
  if (!area.docs) return 0;
  const dir = `${area.docs}/test-data/`;
  return ctx.tracked
    .filter((path) => path.startsWith(dir) && path.endsWith(".md") && !ctx.links.has(path))
    .reduce((n, path) => n + (ctx.files(path).match(JOURNEY)?.length ?? 0), 0);
}

/** The end-to-end test's launch spec, from the project at `root`. */
export function e2eSpec(root, config) {
  const ctx = project(root);
  const areas = (config.areas ?? []).map((area) => ({ area, journeys: journeyCount(ctx, area) }));
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
    prompt: "Which area?",
    intro: "Pick the area the tester walks. Its journeys run through the app on their scenarios, and journeys that need a real outside service wait for your yes. The command above Send lists what the run starts from.",
    from: "developer",
    blocks: [
      { type: "questions" },
      {
        type: "stats",
        title: "Journeys",
        items: areas.map(({ area, journeys }) => ({ label: area.id, value: String(journeys), tone: journeys ? "info" : "warn" })).concat([{ label: "In all", value: String(total), tone: "info" }]).slice(0, 8),
      },
    ],
    runs,
    noPick: "The area is the person's to name; each walk costs about as much as its journeys.",
  };
}
