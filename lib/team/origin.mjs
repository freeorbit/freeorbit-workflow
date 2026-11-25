// Where an ask came from, as the kit knows it: the branch's pull request and
// its state, read from gh, for the team server's page and inbox. The server
// itself loads nothing from the web, so the kit says the state when it
// publishes a page, when it waits on one, and when it lists its asks. gh runs
// beside the kit's other work, never blocking it, and gives up after 4 s.

import { execFile } from "node:child_process";

export const PR_STATES = ["open", "draft", "merged", "closed"];

/** gh in the project, resolving to { status, stdout }; a failure, or 4 s, is status 1. */
const gh = (root) => (args) => new Promise((done) => execFile("gh", args, { cwd: root, encoding: "utf8", timeout: 4000 }, (err, stdout) => done({ status: err ? 1 : 0, stdout: stdout ?? "" })));

const stateOf = ({ state, isDraft }) => {
  const s = isDraft && state === "OPEN" ? "draft" : String(state).toLowerCase();
  return PR_STATES.includes(s) ? s : null;
};

/** A branch's pull request as { pr, prState }, or null when it has none or gh cannot say. */
export async function prFor(root, branch, run = gh(root)) {
  if (!branch) return null;
  const out = await run(["pr", "view", branch, "--json", "number,state,isDraft"]);
  if (!out || out.status !== 0) return null;
  try {
    const got = JSON.parse(out.stdout);
    const prState = stateOf(got);
    return Number.isInteger(got.number) && prState ? { pr: String(got.number), prState } : null;
  } catch {
    return null;
  }
}

/** Each branch's latest pull request, as Map of branch to { pr, prState }, from one gh call; empty when gh cannot say. */
export async function prsByBranch(root, run = gh(root)) {
  const out = await run(["pr", "list", "--state", "all", "--limit", "200", "--json", "headRefName,number,state,isDraft,isCrossRepository"]);
  const map = new Map();
  if (!out || out.status !== 0) return map;
  try {
    // gh lists the newest first; a branch's newest pull request is the one that counts.
    for (const got of JSON.parse(out.stdout)) {
      const prState = stateOf(got);
      // A fork's pull request of the same branch name is not this branch's.
      if (!got.isCrossRepository && typeof got.headRefName === "string" && Number.isInteger(got.number) && prState && !map.has(got.headRefName)) map.set(got.headRefName, { pr: String(got.number), prState });
    }
  } catch {
    // Nothing gh said is kept.
  }
  return map;
}

/** Whether `origin` is a pull request's number and one of its states, as the kit sends them. */
export const originProblem = (origin) => (origin && typeof origin === "object" && /^\d{1,7}$/.test(String(origin.pr)) && PR_STATES.includes(origin.prState) ? "" : "a pull request is its number and one of open, draft, merged, closed");
