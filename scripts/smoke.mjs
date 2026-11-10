#!/usr/bin/env node
// A new project's first hour on this computer, end to end, with the kit from
// this checkout: init, the docs check and the doctor, the branch hooks, the
// tracks, a question sheet, and the web driver against a small page. CI runs
// it on Linux and macOS, so a green run means a team member's machine works.
//
//   node scripts/smoke.mjs             every step, each reported; fails if any breaks
//   WF_SMOKE_RUNNER=process node scripts/smoke.mjs   the web driver without systemd, as on macOS
//
// It uses only synthetic names and example.com addresses, in a throwaway folder.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WF = join(KIT, "bin", "wf.mjs");
const root = mkdtempSync(join(tmpdir(), "wf smoke "));
let failed = 0;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Smoke", GIT_AUTHOR_EMAIL: "smoke@example.com", GIT_COMMITTER_NAME: "Smoke", GIT_COMMITTER_EMAIL: "smoke@example.com" }, ...opts });
}
const wf = (...args) => run(process.execPath, [WF, ...args]);

async function step(name, fn) {
  try {
    const note = await fn();
    console.log(`ok   ${name}${note ? `: ${note}` : ""}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
const expect = (result, what) => {
  if (result.status !== 0) throw new Error(`${what} exited ${result.status}\n${(result.stdout ?? "") + (result.stderr ?? "")}`.trim());
  return result;
};
const has = (name) => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0;

await step("git and the project folder", () => {
  expect(run("git", ["init", "-q", "-b", "main"]), "git init");
  // The hooks run the kit from the project's own install, as a package manager would link it.
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  symlinkSync(WF, join(root, "node_modules", ".bin", "wf"));
  return root;
});

await step("wf init", () => {
  writeFileSync(
    join(root, "answers.json"),
    JSON.stringify({
      project: "Smoke",
      team: "team",
      people: [
        { name: "Ana Owner", handle: "ana-owner", email: "ana@example.com", roles: ["owner", "designer", "developer", "reviewer"] },
        { name: "Fen Front", handle: "fen-front", email: "fen@example.com", roles: ["developer:frontend"] },
      ],
      areas: [{ id: "app", prefix: "APP", docs: "docs/app" }],
      plugins: ["core", "review", "design", "stack-web"],
      kit: { tag: "v0.0.0" },
      config: { design: { source: "png" }, ai: { tools: ["claude"] } },
    }),
  );
  expect(wf("init", "answers.json"), "wf init");
});

await step("wf doc:check", () => expect(wf("doc:check"), "doc:check").stdout.trim().split("\n").at(-1));

await step("wf doctor runs", () => {
  const out = wf("doctor").stdout;
  // The kit is not installed from a tag here, and there is no GitHub remote; the rest must pass.
  const unexpected = out.split("\n").filter((line) => line.startsWith("FAIL") && !/installed kit|GitHub|required tools/.test(line));
  if (unexpected.length) throw new Error(unexpected.join("; "));
  return `${out.split("\n").filter((line) => line.startsWith("OK")).length} OK`;
});

await step("the hooks refuse a commit on main and let one through on a branch", () => {
  run("git", ["add", "-A"]);
  const onMain = run("git", ["commit", "-qm", "start"]);
  if (onMain.status === 0) throw new Error("a commit on main went through");
  if (!/Branch rules/.test(onMain.stderr)) throw new Error(`the refusal did not come from the hooks: ${onMain.stderr}`);
  expect(run("git", ["switch", "-q", "-c", "workflow/smoke"]), "git switch");
  expect(run("git", ["commit", "-qm", "workflow: set up"]), "commit on a branch");
});

await step("wf ready and wf done for the quick track", () => {
  expect(wf("ready", "quick"), "wf ready quick");
  const done = wf("done", "quick");
  // No base branch exists to compare with in a fresh clone, so the paths check may fail; nothing else may.
  const bad = done.stdout.split("\n").filter((line) => line.startsWith("FAIL") && !/merge base/.test(line));
  if (bad.length) throw new Error(bad.join("; "));
});

await step("wf tools", () => wf("tools").stdout.trim().split("\n").at(-1));

await step("a question sheet", () => {
  if (!has("magick")) return "skipped: no ImageMagick";
  expect(run("magick", ["-size", "640x400", "xc:#e8eef3", "in.png"]), "magick");
  writeFileSync(join(root, "spec.json"), JSON.stringify({ out: ".cache/view/smoke/sheet.png", pictures: [{ label: "A", name: "a picture", image: "in.png", boxes: [{ n: 1, kind: "look", rect: [20, 20, 200, 80] }] }] }));
  const out = expect(wf("design", "annotate", "spec.json"), "annotate").stdout;
  if (!/127\.0\.0\.1:8765\/smoke\/sheet\.html/.test(out)) throw new Error(`no sheet address in: ${out}`);
});

await step("the web driver against a small page", async () => {
  const site = join(root, "site");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Sign in</h1><button onclick="this.textContent=\'Signed in\'">Sign in now</button></body></html>');
  const config = JSON.parse(readFileSync(join(root, ".workflow/config.json"), "utf8"));
  config.app = { kind: "web", name: "wfsmoke", runner: process.env.WF_SMOKE_RUNNER || "auto", web: { url: "http://127.0.0.1:8799/", servers: [{ name: "site", cwd: "site", command: ["python3", "-m", "http.server", "8799", "--bind", "127.0.0.1"], url: "http://127.0.0.1:8799/" }] } };
  writeFileSync(join(root, ".workflow/config.json"), `${JSON.stringify(config, null, 2)}\n`);
  try {
    expect(wf("app", "start", "--fresh"), "wf app start");
    const steps = expect(wf("app", "run", 'click "Sign in now"', 'expect "Signed in"', `shot ${join(root, "shot.png")}`, "size mobile", "eval innerWidth"), "wf app run").stdout;
    if (!/innerWidth: 390/.test(steps)) throw new Error(`the mobile size did not hold:\n${steps}`);
    return wf("app", "status").stdout.split("\n").find((line) => line.includes("memory"));
  } finally {
    wf("app", "stop");
  }
});

if (!failed) rmSync(root, { recursive: true, force: true });
console.log(failed ? `${failed} steps failed; the project is in ${root}` : "The smoke run passed.");
process.exit(failed ? 1 : 0);
