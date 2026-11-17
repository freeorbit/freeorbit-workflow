// `wf choose <point>`: a launch page's spec for one of the kit's choice
// points, written from the project's state, for `wf ask page -`. Each point
// is a module that reads the state and gives the facts, the runs, and the
// options; the launch template draws them, and its answer is the command.
//
//   npx wf choose review | npx wf ask page -
//   npx wf choose screens | npx wf ask page -

import { reviewSpec } from "./review.mjs";
import { screensSpec } from "./screens.mjs";

/** Each choice point: what it chooses, and its spec from the project. */
export const POINTS = {
  review: { use: "The code review: light, deep, full, or defer, with the performance and verify passes.", spec: reviewSpec },
  screens: { use: "The chunk-end screen review: light, deep, or defer, with where the apps show, the areas, and the pictures.", spec: screensSpec },
};

/** Print a point's spec as JSON, or list the points; returns the exit code. */
export async function choose(root, config, [point], log = console.log) {
  if (!POINTS[point]) {
    log("Usage: wf choose <point> | wf ask page -");
    for (const [name, each] of Object.entries(POINTS)) log(`  ${name.padEnd(8)} ${each.use}`);
    return point ? 2 : 0;
  }
  log(JSON.stringify(await POINTS[point].spec(root, config), null, 2));
  return 0;
}
