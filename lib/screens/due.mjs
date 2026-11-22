// Which screens are due and why: from what changed since each picture's
// mark, or because no accept took the screen, whatever changed. The screen
// review's run, scope, accept, and choice page all ask here.

import { parseReach } from "./list.mjs";
import { markOf } from "./state.mjs";

/** Why a screen left open before marks is due. */
export const PENDING_WHY = "left out of an accept";
/** Why a screen no accept ever took is due. */
export const NEVER_WHY = "never accepted";
/** Why a screen with a lost mark is due. */
export const LOST_WHY = "its accepted mark was lost";
const REASONS = new Set([PENDING_WHY, NEVER_WHY, LOST_WHY]);

/** Whether a reason is a changed file, not one of the kit's own. */
export const isChange = (why) => !REASONS.has(why);

/**
 * The screens due until an accept takes them, whatever changed, each with
 * why, for a run of `shots`.
 *
 * Lost: one of those pictures has a lost mark, or an accepted picture has no
 * mark to count from. Never accepted: there is no mark, or with Default
 * asked for, no Default mark, or no accepted Default of a screen with a
 * Reach, whatever its marks say, since an accept before v1.14.0 marked
 * screens it never took. A screen nothing reaches has no picture to accept,
 * so a mark is enough for it.
 */
export function untilAccepted(screens, state, accepted, shots) {
  const due = new Map();
  const wide = shots.includes("wide-default");
  for (const { name, reach } of screens) {
    const marks = (Object.hasOwn(state.marks, name) && state.marks[name]) || {};
    const kept = (Object.hasOwn(accepted, name) && accepted[name]) || {};
    const marked = Object.values(marks).some(Boolean);
    const anyTaken = Object.entries(kept).some(([key, hash]) => key !== "frame" && typeof hash === "string");
    const wideTaken = typeof kept["wide-default"] === "string";
    if (shots.some((shot) => marks[shot] === null) || (!marked && anyTaken) || (wide && !marks["wide-default"] && wideTaken)) due.set(name, LOST_WHY);
    else if (!marked || (wide && !marks["wide-default"]) || (!(wide ? wideTaken : anyTaken) && parseReach(reach))) due.set(name, NEVER_WHY);
  }
  return due;
}

/** How many pictures other than Default lost their marks, among the screens named: due when a run takes them. */
export function lostExtras(names, state) {
  let lost = 0;
  for (const name of names) for (const [shot, mark] of Object.entries(state.marks[name] ?? {})) if (mark === null && shot !== "wide-default") lost += 1;
  return lost;
}

/**
 * What a light run leaves on the deep list, as counts: `shared`, reached by a
 * change through shared code, and `waiting`, due only until an accept takes
 * them. A screen left out of an accept is neither, unless never accepted too.
 */
export function leftByLight(light, deep) {
  let shared = 0;
  let waiting = 0;
  for (const [name, why] of deep) {
    if (light.has(name)) continue;
    if (why.some(isChange)) {
      if (!why.includes(PENDING_WHY)) shared += 1;
    } else if (why.includes(NEVER_WHY) || why.includes(LOST_WHY)) waiting += 1;
  }
  return { shared, waiting };
}

/**
 * The light and deep lists from each picture's own mark. The project's module
 * is asked once for each commit the marks name, as if the whole app were
 * marked there, and a screen is listed when a picture this run takes is
 * marked at that commit and the module lists the screen. The deep list holds
 * every screen due, those `unaccepted` (untilAccepted) among them; the
 * light list, those a change in one place reaches. Each screen keeps the
 * changed files that put it there, or why it waits for an accept.
 */
export async function dueLists(names, state, shots, listsAt, base = "origin/main", unaccepted = new Map()) {
  const byMark = new Map();
  for (const name of names) {
    for (const shot of shots) {
      const at = markOf(state, name, shot, base);
      if (!byMark.has(at)) byMark.set(at, new Set());
      byMark.get(at).add(name);
    }
  }
  const light = new Map();
  const deep = new Map();
  const add = (list, name, why) => list.set(name, [...new Set([...(list.get(name) ?? []), ...why])]);
  for (const [at, marked] of byMark) {
    const found = await listsAt(at);
    for (const [name, why] of found.light) if (marked.has(name)) add(light, name, why);
    for (const [name, why] of found.deep) if (marked.has(name)) add(deep, name, why);
  }
  for (const [name, why] of light) add(deep, name, why);
  for (const name of names) if (unaccepted.has(name)) add(deep, name, [unaccepted.get(name)]);
  // A screen left open before marks is due until an accept takes it, on the deep list only.
  for (const name of state.pending ?? []) {
    if (!names.includes(name)) continue;
    add(deep, name, [...(light.get(name) ?? []), PENDING_WHY]);
    light.delete(name);
  }
  return { light, deep, marks: [...byMark.keys()].filter((at) => at !== base).length };
}
