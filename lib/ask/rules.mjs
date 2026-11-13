// The page's own rules, loaded from the file the page runs
// (lib/ask/browser/state.js): what an answer is, when a follow-up shows,
// whether a number is on a scale, and what is wrong with a form field. The
// kit's checks use these, so the page and the record read one rule.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const sandbox = { window: {} };
runInNewContext(readFileSync(new URL("./browser/state.js", import.meta.url), "utf8"), sandbox);

export const RULES = sandbox.window.wfAskState;
