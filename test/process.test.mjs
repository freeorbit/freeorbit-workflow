import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ownFolder } from "../lib/process.mjs";
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
