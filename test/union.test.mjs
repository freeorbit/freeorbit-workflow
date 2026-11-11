import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { unionBlock, withUnion } from "../lib/logs/union.mjs";

const config = (union) => merge(DEFAULTS, { docs: { union } });

test("the union block is added once, kept in step, and leaves the project's own lines alone", () => {
  const first = withUnion("*.png binary\n", config(["docs/log/e2e-runs.md"]));
  assert.match(first, /^\*\.png binary\n\n# wf:union[^\n]*\ndocs\/log\/e2e-runs\.md merge=union\n# \/wf:union\n$/);
  assert.equal(withUnion(first, config(["docs/log/e2e-runs.md"])), null);
  const grown = withUnion(first, config(["docs/log/e2e-runs.md", "docs/log/decisions/**"]));
  assert.match(grown, /^\*\.png binary\n/);
  assert.equal(grown.match(/# wf:union/g).length, 1);
  assert.match(grown, /docs\/log\/decisions\/\*\* merge=union/);
  assert.equal(withUnion(null, config([])), null);
  assert.equal(unionBlock(config([])).split("\n").length, 2);
});

test("with the block, a local rebase lands both branches' rows; without it, the same rebase conflicts", () => {
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const run = (union) => {
    const root = mkdtempSync(join(tmpdir(), "wf-union-"));
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
    mkdirSync(join(root, "docs/log"), { recursive: true });
    writeFileSync(join(root, "docs/log/e2e-runs.md"), "| Date | Row |\n| --- | --- |\n| 1 | base |\n");
    if (union) writeFileSync(join(root, ".gitattributes"), withUnion(null, config(["docs/log/e2e-runs.md"])));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    for (const [branch, row] of [["a", "| 2 | a |"], ["b", "| 3 | b |"]]) {
      git(root, "switch", "-q", "-c", branch, "main");
      writeFileSync(join(root, "docs/log/e2e-runs.md"), `${readFileSync(join(root, "docs/log/e2e-runs.md"), "utf8")}${row}\n`);
      git(root, "commit", "-qam", branch);
    }
    git(root, "switch", "-q", "main");
    git(root, "merge", "-q", "--squash", "a");
    git(root, "commit", "-qm", "a");
    git(root, "switch", "-q", "b");
    try {
      git(root, "rebase", "-q", "main");
      return readFileSync(join(root, "docs/log/e2e-runs.md"), "utf8");
    } catch {
      return null;
    }
  };
  assert.match(run(true), /\| 2 \| a \|\n\| 3 \| b \|/);
  assert.equal(run(false), null);
});
