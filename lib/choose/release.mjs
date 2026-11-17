// The release's choice page: which version, from the tags, as `wf release
// next` lists them, with how this kind goes out. The answer is the `wf
// release check` the release skill runs next.

import { git } from "../process.mjs";
import { nextVersions, releaseTags } from "../release.mjs";
import { project } from "../config/config.mjs";
import { plural } from "./words.mjs";


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
  const tags = releaseTags(root, config);
  const rows = nextVersions(tags, release);
  const counts = {};
  const runs = rows.map((row) => {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const id = row.kind === "pre-release" || row.kind === "stable" ? `${row.kind}-${counts[row.kind]}` : row.kind;
    return { id, label: `${row.kind[0].toUpperCase()}${row.kind.slice(1)}: ${row.version}`, why: row.why, command: `npx wf release check ${row.version}` };
  });
  const newest = git(root, ["describe", "--tags", "--abbrev=0", "--match", `${release.tagPrefix}*`], { quiet: true }).trim();
  const since = newest ? Number(git(root, ["rev-list", "--count", `${newest}..HEAD`], { quiet: true }).trim() || 0) : 0;
  // Read through the project's own reader, so a link that leads out of it is never read.
  const ctx = project(root);
  const notes = ctx.tracked.includes(release.changelog) && !ctx.links.has(release.changelog) && unreleasedNotes(ctx.files(release.changelog));
  const advice = releaseAdvice(rows);
  const way = (kind) => (release.prepare[kind] ? "through a prepare pull request" : "tagged straight from main");
  const how = release.prepare.preRelease === release.prepare.stable ? `Either kind goes out ${way("stable")}` : `A pre-release goes out ${way("preRelease")}, a stable one ${way("stable")}`;
  return {
    id: "release-version",
    title: "Which release?",
    template: "launch",
    prompt: "Which version?",
    intro: `Pick the version. ${how}, and the notes go ${release.notes === "github" ? "on the tag's GitHub Release" : "in the changelog"}. The command above Send is the release's first check.`,
    from: "developer",
    blocks: [
      { type: "questions" },
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
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
  };
}
