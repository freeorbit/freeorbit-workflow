// The release's choice page: which version, from the tags, as `wf release
// next` lists them, with how this kind goes out. The answer is the `wf
// release check` the release skill runs next.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "../process.mjs";
import { nextVersions } from "../release.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The changelog's Unreleased section: whether it holds notes. */
export function unreleasedNotes(text) {
  const body = String(text ?? "").split(/^## +Unreleased.*$/m)[1]?.split(/^## /m)[0] ?? "";
  return body.split("\n").some((line) => /^\s*[-*] \S/.test(line));
}

/** The run to recommend and why: the open line's next pre-release, else a new patch line. */
export function releaseAdvice(rows) {
  const next = rows.find((row) => row.kind === "pre-release");
  if (next) return { run: "pre-release-1", why: `It carries on the open line, ${next.why.replace(/^the next of the open line, /, "")}; promote it to stable once it has been tried.` };
  return { run: "patch", why: "No line is open. A patch line is for fixes; pick minor for new features, or anything that breaks below 1.0." };
}

/** The release's launch spec, from the project at `root`. */
export function releaseSpec(root, config) {
  const release = config.release;
  const tags = git(root, ["tag", "--list", `${release.tagPrefix}*`], { quiet: true }).split("\n").map((t) => t.trim()).filter(Boolean);
  const rows = nextVersions(tags, release);
  const counts = {};
  const runs = rows.map((row) => {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const id = row.kind === "pre-release" || row.kind === "stable" ? `${row.kind}-${counts[row.kind]}` : row.kind;
    return { id, label: `${row.kind[0].toUpperCase()}${row.kind.slice(1)}: ${row.version}`, why: row.why, command: `npx wf release check ${row.version}` };
  });
  const newest = git(root, ["describe", "--tags", "--abbrev=0", "--match", `${release.tagPrefix}*`], { quiet: true }).trim();
  const since = newest ? Number(git(root, ["rev-list", "--count", `${newest}..HEAD`], { quiet: true }).trim() || 0) : 0;
  const changelog = join(root, release.changelog);
  const notes = existsSync(changelog) && unreleasedNotes(readFileSync(changelog, "utf8"));
  const advice = releaseAdvice(rows);
  const prepared = (kind) => (release.prepare[kind] ? "a prepare pull request" : "tagged from main");
  return {
    id: "release-version",
    title: "Which release?",
    template: "launch",
    intro: `Pick the version. A pre-release goes out as ${prepared("preRelease")}, a stable one as ${prepared("stable")}, and the notes go ${release.notes === "github" ? "on the tag's GitHub Release" : "in the changelog"}. The command above Send is the release's first check.`,
    from: "developer",
    blocks: [
      {
        type: "stats",
        title: "Since the last release",
        items: [
          { label: "Newest tag", value: newest || "none", tone: "info" },
          { label: "Commits since", value: plural(since, "commit"), tone: since ? "info" : "warn" },
          { label: "Open lines", value: String(rows.filter((row) => row.kind === "stable").length), tone: "info" },
          { label: "Unreleased notes", value: notes ? "written" : "none yet", tone: notes ? "ok" : "warn", note: release.notes === "github" ? "they go on the GitHub Release" : release.changelog },
        ],
      },
      { type: "questions" },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
  };
}
