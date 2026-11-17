// The code review's choice page: light, deep, full, or defer, from the
// ledger's state and the changes since, with the performance and verify
// passes as options. The answer is the `wf scan` command the
// code-review-ledger skill starts from, or the deferral.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "../process.mjs";
import { changedFiles, hotPaths, inScope, performancePass } from "../review.mjs";
import { plural } from "./words.mjs";

const gitText = (root, args) => git(root, args, { quiet: true }).trim();

/** The ledger's state lines: the commit each names, or null for none; the deferrals; and the light runs waiting. */
export function ledgerState(text) {
  const commit = (name) => text.match(new RegExp(`^${name}: ([0-9a-f]{7,40})\\b`, "m"))?.[1] ?? null;
  const deferred = Number(text.match(/^Deferred: (\d+) times?/m)?.[1] ?? 0);
  const table = text.split(/^#+ Light runs[ \t]*$/m)[1]?.split(/^#/m)[0] ?? "";
  const lightRuns = table.split("\n").filter((line) => /^\|\s*`/.test(line)).length;
  return { last: commit("Last reviewed"), deep: commit("Deep reviewed"), deferred, lightRuns };
}

/**
 * The run to recommend and why, by the skill's rule: full with no review yet,
 * deep when two or more light runs wait or the deep backlog has changes the
 * light one does not, else light.
 */
export function reviewAdvice({ last, lightRuns }) {
  if (!last) return { run: "full", why: "Nothing has been reviewed yet, so the first review reads every file." };
  if (lightRuns >= 2) return { run: "deep", why: `${lightRuns} light runs are waiting; a deep run reads whole files since the last deep run and clears them.` };
  return { run: "light", why: "A light run reads the diff since the last review, which is enough for one chunk's changes." };
}


/** The review's launch spec, from the project at `root`. */
export function reviewSpec(root, config) {
  const ledgerFile = join(root, config.logs.ledger);
  const state = ledgerState(existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "");
  const head = gitText(root, ["rev-parse", "--short", "HEAD"]);
  const count = (since) => (since ? Number(gitText(root, ["rev-list", "--count", `${since}..HEAD`]) || 0) : Number(gitText(root, ["rev-list", "--count", "HEAD"]) || 0));
  const files = (since) => (since ? inScope(changedFiles(root, since), config.review.diffExclude, (p) => existsSync(join(root, p))) : []);
  const lightFiles = files(state.last);
  const deepFrom = state.deep ?? state.last;
  const deepFiles = files(deepFrom);
  const hot = config.review.hotPaths && existsSync(join(root, config.review.hotPaths)) ? hotPaths(readFileSync(join(root, config.review.hotPaths), "utf8")) : [];
  const touched = performancePass("always", { mode: "diff", light: true, scope: lightFiles, paths: hot }).touched;
  const lightPerf = performancePass(config.review.performance, { mode: "diff", light: true, scope: lightFiles, paths: hot }).runs;
  const advice = reviewAdvice(state);
  const runs = [];
  if (state.last) {
    runs.push({ id: "light", label: "Light", why: `The diff since ${state.last}: ${plural(count(state.last), "commit")}, ${plural(lightFiles.length, "file")}`, cost: lightPerf ? "security, structure, and performance passes" : "security and structure passes", command: `npx wf scan diff ${state.last} --light` });
    runs.push({ id: "deep", label: "Deep", why: `Whole files changed since ${deepFrom}: ${plural(count(deepFrom), "commit")}, ${plural(deepFiles.length, "file")}${state.lightRuns ? `; clears ${plural(state.lightRuns, "light run")}` : ""}`, cost: "every pass, on whole files", command: `npx wf scan diff ${deepFrom}` });
  }
  runs.push({ id: "full", label: "Full", why: "Every file in the project, with the full scans such as fuzzing", cost: "the longest", command: "npx wf scan full" });
  if (state.last) runs.push({ id: "defer", label: "Defer", why: `Reviews nothing now; the backlog keeps growing${state.deferred ? `, deferred ${plural(state.deferred, "time")} already` : ""}`, command: `npx wf ledger defer --at ${head}` });
  const reviewing = runs.filter((run) => run.id !== "defer").map((run) => run.id);
  return {
    id: "review-run",
    title: "Code review: which run?",
    template: "launch",
    intro: "Pick a run for the code review. The command above Send is what the review starts from.",
    from: "developer",
    blocks: [
      { type: "questions" },
      {
        type: "stats",
        title: "Since the last review",
        items: [
          { label: "Last reviewed", value: state.last ?? "none", tone: state.last ? "info" : "warn" },
          { label: "Backlog", value: plural(count(state.last), "commit"), tone: "info", note: plural(lightFiles.length, "file") },
          { label: "Light runs waiting", value: String(state.lightRuns), tone: state.lightRuns >= 2 ? "warn" : "info" },
          { label: "Deferred", value: String(state.deferred), tone: state.deferred ? "warn" : "ok" },
          { label: "Hot paths touched", value: String(touched.length), tone: touched.length ? "warn" : "ok", note: touched.slice(0, 3).join(", ") || (hot.length ? "none" : "no hot-paths doc") },
        ],
      },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
    modifiers: [
      {
        id: "performance",
        text: "The performance pass?",
        kind: "choice",
        runs: reviewing,
        options: [
          { id: "set", label: `As set (${config.review.performance})`, why: config.review.performance === "deep" ? "Deep and full runs, and a light run that touches a hot path" : config.review.performance === "always" ? "Every run" : "Never" },
          { id: "on", label: "Run it", why: "One more reviewer pass on the hot paths", flag: "--performance on" },
          { id: "off", label: "Skip it", why: "Security and structure only", flag: "--performance off" },
        ],
        recommended: "set",
        why: "The setting already runs it where a change can slow a hot path.",
      },
      {
        id: "verify",
        text: "A verify pass that tries to disprove each finding?",
        kind: "choice",
        runs: reviewing,
        options: [
          { id: "set", label: `As set (${config.review.verify ? "on" : "off"})`, why: "review.verify" },
          { id: "on", label: "On", why: "Another model reads every draft finding first", flag: "--verify" },
          { id: "off", label: "Off", why: "The drafts go to you as written", flag: "--no-verify" },
        ],
        recommended: "set",
        why: "Each finding already cites its evidence, and you decide each one.",
      },
    ],
  };
}
