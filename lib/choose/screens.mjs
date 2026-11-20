// The chunk-end screen review's choice page: light, deep, or defer, from
// the project's screens.scope lists and the record's state, with where the
// apps show, the areas, and the pictures a project sets as options. The
// answer is the `wf screens` command the screen-review skill runs.


import { kwinFound } from "../screens/shoot.mjs";
import { reviewCoversHead } from "../review.mjs";
import { scopeFacts } from "../screens/run.mjs";
import { plural } from "./words.mjs";

/**
 * The run to recommend and why, by the skill's rule: light; deep when the
 * light list is empty and the deep one is not, or when shared code alone
 * reaches as many screens as the light list; defer when both are empty. Each
 * screen has its own mark, so a light run also takes its screens off the
 * deep list, and nothing piles up behind it.
 */
export function screensAdvice({ light, deep, deepOnly = deep - light }) {
  if (!light && !deep) return { run: "defer", why: "Neither list has a screen, so there is nothing to shoot; deferring records that." };
  if (!light) return { run: "deep", why: "The light list is empty, but shared code reached screens on the deep list." };
  if (deepOnly >= light) return { run: "deep", why: `Shared code alone reaches ${plural(deepOnly, "screen")}, as many as the light list; a deep run takes both.` };
  return { run: "light", why: "A light run reads the screens a change reaches in one place, and takes them off the deep list too." };
}

/** The screen review's launch spec, from the project at `root`. */
export async function screensSpec(root, config) {
  const { state, light, deep, deepOnly, minutes } = await scopeFacts(root, config);
  const reviewed = reviewCoversHead(root, config).covers;
  const advice = screensAdvice({ light: light.size, deep: deep.size, deepOnly });
  const runs = [
    { id: "light", label: "Light", why: `${plural(light.size, "screen")} a change reaches in one place only`, time: light.size ? `about ${minutes.light} min` : "nothing to shoot", command: "npx wf screens --light" },
    { id: "deep", label: "Deep", why: `${plural(deep.size, "screen")}, ${deepOnly} of them only through shared code`, time: `about ${minutes.deep} min`, command: "npx wf screens --deep" },
    { id: "defer", label: "Defer", why: `Shoots nothing; both lists keep growing${state.deferred.count ? `, deferred ${plural(state.deferred.count, "time")} already` : ""}`, command: "npx wf screens --defer" },
  ];
  const shooting = ["light", "deep"];
  const set = config.screens.runs.review;
  const web = config.app?.kind === "web";
  const where = [
    { id: "set", label: `As set (${set.show}, ${set.jobs} at once)`, why: "screens.runs.review" },
    { id: "screen", label: "On my screen", why: "One app at a time, to watch", flag: "--show screen" },
    ...(!web && kwinFound() ? [{ id: "virtual", label: "On virtual displays", why: "Off your screen, several at once", flag: "--show virtual" }] : []),
    ...(web ? [{ id: "headless", label: "Headless", why: "No window, several at once", flag: "--show headless" }] : []),
  ];
  const areas = config.areas ?? [];
  const modifiers = [
    { id: "show", text: "Where should the apps show?", kind: "choice", runs: shooting, options: where, recommended: "set", why: "A review run is read from its pictures, so it need not be watched." },
    areas.length > 1 && areas.length <= 8
      ? { id: "area", text: "Which areas?", kind: "choice", runs: shooting, detail: "An area run marks that area's screens.", options: [{ id: "all", label: "Every area", why: "Every due screen" }, ...areas.map((a) => ({ id: a.id, label: a.id, why: "Its screens only", flag: `--area ${a.id}` }))], recommended: "all", why: "Each screen has its own mark, so one area is fine, but every area leaves nothing due." }
      : areas.length > 8
        ? { id: "area", text: "Only these areas (ids, commas between; empty for all)", kind: "text", runs: shooting, flag: "--area {value}", detail: "An area run marks that area's screens." }
        : null,
    // Before the code review covers HEAD, light and deep refuse; --force is for a run asked for outside chunk end.
    reviewed ? null : { id: "force", text: "Run before the code review covers HEAD?", kind: "toggle", runs: shooting, flag: "--force", why: "At chunk end the screens are shot after the code review's fixes, so a fix cannot change them after." },
    config.screens.narrow ? { id: "narrow", text: `Take the narrow picture too (${config.screens.narrow})?`, kind: "toggle", runs: shooting, flag: "--wide --narrow", why: "Only when the designer asks for it." } : null,
    Object.keys(config.screens.stress ?? {}).length ? { id: "stress", text: "Take the stress look too?", kind: "toggle", runs: shooting, flag: "--wide --stress", why: "Only when the designer asks for it; it doubles the pictures." } : null,
  ].filter(Boolean);
  return {
    id: "screens-run",
    title: "Screen review: which run?",
    template: "launch",
    intro: `Pick a run for the screen review.${reviewed ? "" : " The code review has not covered HEAD yet, so a light or deep run refuses unless you say to run it before."} The command above Send is what runs.`,
    from: "developer",
    blocks: [
      { type: "questions" },
      {
        type: "stats",
        title: "Due now",
        items: [
          { label: "Light", value: plural(light.size, "screen"), tone: "info", note: light.size ? `about ${minutes.light} min` : "" },
          { label: "Deep", value: plural(deep.size, "screen"), tone: deep.size > light.size ? "warn" : "info", note: `about ${minutes.deep} min` },
          { label: "Only through shared code", value: String(deepOnly), tone: deepOnly && deepOnly >= light.size ? "warn" : "info", note: "a light run leaves these" },
          { label: "Code review", value: reviewed ? "covers HEAD" : "not at HEAD", tone: reviewed ? "ok" : "warn" },
        ],
      },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
    modifiers,
  };
}
