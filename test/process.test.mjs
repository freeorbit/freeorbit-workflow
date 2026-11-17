import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { flagValue, git, ownFolder, readJsonFile } from "../lib/process.mjs";
import { desktopCommand } from "../lib/view/desktop.mjs";

test("a run folder in a shared place is made this user's alone, and a link is refused (SA-2)", () => {
  const base = mkdtempSync(join(tmpdir(), "wf-own-"));
  const fresh = ownFolder(join(base, "a"));
  assert.equal(statSync(fresh).mode & 0o777, 0o700);
  mkdirSync(join(base, "open"), { mode: 0o777 });
  chmodSync(join(base, "open"), 0o777);
  assert.equal(statSync(ownFolder(join(base, "open"))).mode & 0o777, 0o700, "one of ours left open is closed");
  symlinkSync(fresh, join(base, "link"));
  assert.throws(() => ownFolder(join(base, "link")), /is a link or a file/);
});

test("notify-send gets a body whose markup is plain text (SA-6)", () => {
  const bin = mkdtempSync(join(tmpdir(), "wf-bin-"));
  writeFileSync(join(bin, "notify-send"), "");
  const command = desktopCommand({ platform: "linux", env: { PATH: bin } });
  assert.deepEqual(command.args("t", "<b>a</b> & b").slice(-2), ["t", "&lt;b&gt;a&lt;/b&gt; &amp; b"]);
});

test("a flag's value is given, null when the flag is not, and an error that names it when its value is missing (TB-7)", () => {
  const rows = [
    [["--gate", "CH-01"], "CH-01", "a value"],
    [["--other"], null, "not given"],
  ];
  for (const [args, want, why] of rows) assert.equal(flagValue(args, "--gate"), want, why);
  for (const args of [["--gate"], ["--gate", "--light"], ["--gate", ""]]) assert.throws(() => flagValue(args, "--gate"), /--gate needs a value/);
});

test("git gives its output, throws with git's own message, and gives nothing when asked to be quiet", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-git-"));
  git(root, ["init", "-q"]);
  assert.match(git(root, ["rev-parse", "--git-dir"]), /\.git/);
  assert.throws(() => git(root, ["rev-parse", "--verify", "no-such-ref"]), /git rev-parse failed: .+/);
  assert.equal(git(root, ["rev-parse", "--verify", "no-such-ref"], { quiet: true }), "");
});

test("a file that is not JSON is named, with what to do (TB-11)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-json-"));
  writeFileSync(join(dir, "c.json"), "{ nope }");
  assert.throws(() => readJsonFile(join(dir, "c.json"), ".workflow/config.json"), /^Error: \.workflow\/config\.json is not valid JSON \(.+\); fix it, then run the command again$/);
  assert.throws(() => readJsonFile(join(dir, "missing.json")), { code: "ENOENT" });
});
