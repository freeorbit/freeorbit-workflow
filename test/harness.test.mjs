import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { harness, markUnread, openPage, openWay } from "../lib/view/harness.mjs";

test("the harness is Orca by its variables, Claude's desktop app by its entry point, else a terminal", () => {
  const rows = [
    [{ ORCA_WORKTREE_PATH: "/w" }, { name: "orca", cli: "orca" }],
    [{ ORCA_CLI_COMMAND: "orca-wsl" }, { name: "orca", cli: "orca-wsl" }],
    [{ CLAUDE_CODE_ENTRYPOINT: "claude-desktop" }, { name: "desktop" }],
    [{ CLAUDE_CODE_ENTRYPOINT: "cli" }, { name: "terminal" }],
    [{}, { name: "terminal" }],
  ];
  for (const [env, want] of rows) assert.deepEqual(harness(env), want);
});

test("a page opens by ask.open: auto picks by the harness, and a way with no opener prints the address", () => {
  const bin = mkdtempSync(join(tmpdir(), "wf-bin-"));
  writeFileSync(join(bin, "xdg-open"), "");
  const env = { PATH: bin };
  const rows = [
    ["auto", { name: "orca", cli: "orca" }, "orca"],
    ["auto", { name: "desktop" }, "pane"],
    ["auto", { name: "terminal" }, "system"],
    ["print", { name: "orca", cli: "orca" }, "print"],
  ];
  for (const [choice, h, want] of rows) assert.equal(openWay(choice, h, { platform: "linux", env }).way, want, `${choice} in ${h.name}`);
  assert.equal(openWay("system", { name: "terminal" }, { platform: "linux", env: { PATH: "" } }).way, "print", "no xdg-open");
  assert.equal(openWay("orca", { name: "terminal" }, { platform: "linux", env }).way, "print", "orca asked for outside Orca, with no ORCA_CLI_COMMAND");
  assert.equal(openWay("orca", { name: "terminal" }, { platform: "linux", env: { ...env, ORCA_CLI_COMMAND: "orca-cli" } }).way, "orca", "an Orca command named outright");
  assert.deepEqual(openWay("orca", { name: "orca", cli: "orca" }).run("http://x/"), ["orca", ["tab", "create", "--url", "http://x/", "--worktree", "active", "--json"]]);
});

test("opening says where it opened, or prints the address when the command fails; a bare orca never runs outside Orca", async () => {
  const calls = [];
  const ok = (file, args) => (calls.push([file, ...args]), { status: 0 });
  const fails = () => ({ status: 1, stderr: "runtime_unavailable" });
  assert.match(openPage("http://x/", "auto", { h: { name: "orca", cli: "orca" }, run: ok }).lines[0], /Opened http:\/\/x\/ in a tab of Orca's browser/);
  assert.match(openPage("http://x/", "auto", { h: { name: "orca", cli: "orca" }, run: fails }).lines[0], /Could not open it with orca \(runtime_unavailable\)\. Open http:\/\/x\//);
  assert.match(openPage("http://x/", "auto", { h: { name: "desktop" }, run: ok }).lines[0], /in the browser pane/);
  const later = (file, args, opts, done) => { calls.push([file, ...args]); setImmediate(() => done(null)); };
  assert.equal(await markUnread({ name: "terminal" }, later), false);
  assert.equal(await markUnread({ name: "orca", cli: "orca" }, later), true);
  assert.deepEqual(calls.at(-1), ["orca", "worktree", "set", "--worktree", "active", "--unread", "--json"]);
  assert.equal(calls.filter(([file]) => file === "orca").length, 2, "only in Orca");
});
