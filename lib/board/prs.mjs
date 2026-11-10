// Each finished chunk's pull request, from git history: the squash commit
// that added the chunk's row to the done list ends its subject with "(#N)",
// as GitHub writes it, and a merge commit says "Merge pull request #N". So
// `wf board plan` shows the same links locally as sync does in CI, every past
// chunk has one, and CI needs no GitHub permission beyond reading the code.
// A chunk merged by rebase has no number, so it has no link.

import { execFileSync } from "node:child_process";

/** git in the project, resolving to its output, or "" when git fails. */
export const runGit = (root) => (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

/** The pull request number in a commit subject, or null. */
export function prNumber(subject) {
  const match = String(subject).match(/\(#(\d+)\)\s*$/) ?? String(subject).match(/^Merge pull request #(\d+)\b/);
  return match ? Number(match[1]) : null;
}

/** Each chunk's pull request, as Map of chunk id to { number, at }: the first commit that added its done row. */
export function chunkPrs(git, doneFile, chunks) {
  const out = new Map();
  for (const chunk of chunks) {
    const line = git(["log", "--reverse", "--format=%ct %s", "-S", `| ${chunk} |`, "--", doneFile]).split("\n").find(Boolean);
    if (!line) continue;
    const [at, ...subject] = line.split(" ");
    const number = prNumber(subject.join(" "));
    if (number) out.set(chunk, { number, at: Number(at) });
  }
  return out;
}

/** A story's pull request: that of its lane finished last, once any lane is done, or null. */
export function storyPr(lanes, prs) {
  const done = lanes.filter((lane) => lane.state === "done" && prs.has(lane.chunk)).map((lane) => prs.get(lane.chunk));
  return done.sort((a, b) => b.at - a.at || b.number - a.number)[0] ?? null;
}

/** The repository's web address: GitHub Actions' own variables in CI, else the origin remote. */
export function repoUrl(git, env = process.env) {
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY) return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  const remote = git(["remote", "get-url", "origin"]).trim();
  const ssh = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
  return https ? `https://${https[1]}/${https[2]}` : null;
}
