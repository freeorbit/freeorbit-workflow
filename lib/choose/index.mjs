// `wf choose <point>`: a launch page's spec for one of the kit's choice
// points, written from the project's state, for `wf ask page -`. Each point
// is a module that reads the state and gives the facts, the runs, and the
// options; the launch template draws them, and its answer is the command.
//
//   npx wf choose review | npx wf ask page -
//   npx wf choose screens | npx wf ask page -
//   npx wf choose chunk | release | e2e | npx wf ask page -

import { chunkSpec } from "./chunk.mjs";
import { e2eSpec } from "./e2e.mjs";
import { releaseSpec } from "./release.mjs";
import { reviewSpec } from "./review.mjs";
import { screensSpec } from "./screens.mjs";

/** Each choice point: what it chooses, and its spec from the project. */
export const POINTS = {
  review: { use: "The code review: light, deep, full, or defer, with the performance and verify passes.", spec: reviewSpec },
  screens: { use: "The chunk-end screen review: light, deep, or defer, with where the apps show, the areas, and the pictures.", spec: screensSpec },
  chunk: { use: "Chunk start: the chunk to start or carry on, from the build order, or a quick fix.", spec: chunkSpec },
  release: { use: "A release: the version, from the tags, and how this kind goes out.", spec: releaseSpec },
  e2e: { use: "An end-to-end test: the area to walk, with its journeys counted.", spec: e2eSpec },
};

/** Print a point's spec as JSON, or list the points; returns the exit code: 3 when there is only one way, said on stderr, so a pipe into wf ask page stops. */
export async function choose(root, config, [point], log = console.log, warn = console.error) {
  if (!POINTS[point]) {
    log("Usage: wf choose <point> | wf ask page -");
    for (const [name, each] of Object.entries(POINTS)) log(`  ${name.padEnd(8)} ${each.use}`);
    return point ? 2 : 0;
  }
  const spec = await POINTS[point].spec(root, config);
  // One way is no choice: say it, and give its command, so nothing asks for nothing.
  if (spec.runs.length < 2) {
    const [only] = spec.runs;
    (warn ?? log)(only ? `Nothing to choose: ${only.label}. Run ${only.command}` : "Nothing to choose.");
    return 3;
  }
  log(JSON.stringify(spec, null, 2));
  return 0;
}
