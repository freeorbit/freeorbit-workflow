// `wf release <step> ...`: the project's release commands, named in
// `release.commands` in its config, run with the rest of the arguments after
// them. The kit knows no build system; it gives each project the same names
// for the same steps, so the release skill can name one command for each.
// `next` is only tag arithmetic, so the kit has its own for a project with none.

import { spawnSync } from "node:child_process";

import { projectCommand, sh } from "./process.mjs";

/** The steps the release skill runs, each with what it does. */
export const STEPS = {
  next: "the versions that may come next, from the tags",
  check: "the release checks for a version: OK, WARN, or FAIL for each fact",
  set: "write a version into every place a build reads one",
  verify: "fail when a copy of the version, or the tag being built, disagrees",
};

/** The shell command for one release step, or null when the project has none. */
export const releaseCommand = (config, name, args) => projectCommand(config.release.commands, name, args);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A tag as { base: [major, minor, patch], rc } (rc null for a stable one), or null when it is not a release tag. */
export function parseTag(tag, { tagPrefix, preRelease }) {
  const match = new RegExp(`^${escape(tagPrefix)}(\\d+)\\.(\\d+)\\.(\\d+)(?:${escape(preRelease)}(\\d+))?$`).exec(tag);
  if (!match) return null;
  return { base: match.slice(1, 4).map(Number), rc: match[4] === undefined ? null : Number(match[4]) };
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const text = (base) => base.join(".");

/**
 * The versions that may follow the tags, as in releasing.md: the next
 * pre-release and the stable version of each open line (one with a
 * pre-release newer than the last stable version, and no stable version of
 * its own), then a new patch, minor, and major line from the newest tag.
 * Each is { kind, version, why }.
 */
export function nextVersions(tags, release) {
  const { preRelease } = release;
  const parsed = tags.map((tag) => parseTag(tag, release)).filter(Boolean);
  const stable = parsed.filter((t) => t.rc === null).map((t) => t.base);
  const lastStable = stable.sort(compare).at(-1) ?? [0, 0, 0];
  const lines = new Map();
  for (const { base, rc } of parsed) {
    if (rc === null || compare(base, lastStable) <= 0 || stable.some((s) => compare(s, base) === 0)) continue;
    lines.set(text(base), { base, rc: Math.max(rc, lines.get(text(base))?.rc ?? 0) });
  }
  const open = [...lines.values()].sort((a, b) => compare(b.base, a.base));
  const out = [];
  for (const { base, rc } of open) {
    const tag = `${release.tagPrefix}${text(base)}${preRelease}${rc}`;
    out.push({ kind: "pre-release", version: `${text(base)}${preRelease}${rc + 1}`, why: `the next of the open line, after ${tag}` });
    out.push({ kind: "stable", version: text(base), why: `promotes the open line, ${tag}` });
  }
  const newest = [lastStable, ...open.map((line) => line.base)].sort(compare).at(-1);
  const [major, minor, patch] = newest;
  const from = parsed.length ? `after ${text(newest)}` : "with no release tag yet";
  out.push({ kind: "patch", version: `${major}.${minor}.${patch + 1}${preRelease}1`, why: `a new patch line, ${from}` });
  out.push({ kind: "minor", version: `${major}.${minor + 1}.0${preRelease}1`, why: `a new minor line, ${from}` });
  out.push({ kind: "major", version: `${major + 1}.0.0${preRelease}1`, why: `a new major line, ${from}` });
  return out;
}

/** The kit's own `next`: the project's release tags read from git, one line per version that may follow. */
function defaultNext(root, config) {
  const res = sh("git", ["tag", "--list", `${config.release.tagPrefix}*`], { cwd: root });
  if (!res.ok) {
    console.error(`git tag failed: ${res.out.trim()}`);
    return 1;
  }
  const rows = nextVersions(res.out.split("\n").map((t) => t.trim()).filter(Boolean), config.release);
  const width = Math.max(...rows.map((r) => r.version.length));
  if (!rows.some((r) => r.kind === "stable")) console.log("No open pre-release line, so a stable version needs a pre-release first.");
  for (const row of rows) console.log(`${row.kind.padEnd(11)} ${row.version.padEnd(width)}  ${row.why}`);
  return 0;
}

/** Run a step; returns the exit code. */
export function runRelease(root, config, name, args) {
  const command = releaseCommand(config, name, args);
  if (!command && name === "next") return defaultNext(root, config);
  if (!command) {
    console.error(`release.commands has no ${name}; add it to .workflow/config.json (${STEPS[name] ?? "a step of the project's own"})`);
    return 2;
  }
  return spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" }).status ?? 1;
}
