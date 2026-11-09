import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { agentName, decide, e2eCommand } from "../plugins/core/hooks/guard.mjs";

const ROOT = "/p";
const CONFIG = {
  areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }],
  e2e: { reads: ["docs/app/app-testing.md"] },
  testdata: { reads: ["docs/app/personas.md"] },
};
const call = (agent, tool, input) => decide({ agent_type: agent, tool_name: tool, tool_input: input }, ROOT, CONFIG);

test("the main session and unguarded agents pass, and a plugin prefix is dropped", () => {
  assert.equal(decide({ tool_name: "Read", tool_input: { file_path: "/p/src/a.rs" } }, ROOT, CONFIG), null);
  assert.equal(call("Explore", "Read", { file_path: "/p/src/a.rs" }), null);
  assert.equal(agentName({ agent_type: "e2e:e2e-tester" }), "e2e-tester");
  assert.equal(decide({ agent_type: "e2e-tester", tool_name: "Read", tool_input: { file_path: "/p/src/a.rs" } }, ROOT, { ...CONFIG, hooks: { blindness: false } }), null);
});

test("the e2e tester reads its area's docs, the docs the config names, and the app's files, nothing else", () => {
  for (const path of ["docs/plugins/uplink/user-stories.md", "docs/plugins/uplink/test-data/core.md", "docs/app/app-testing.md", ".cache/e2e/run/out.csv"]) {
    assert.equal(call("e2e:e2e-tester", "Read", { file_path: `/p/${path}` }), null, path);
  }
  for (const path of ["apps/desktop/src/main.tsx", "docs/plugins/uplink/architecture.md", "docs/log/review-findings.md", "/etc/passwd", ".env"]) {
    assert.match(call("e2e:e2e-tester", "Read", { file_path: path }), /blind \(W-08\)/, path);
  }
  assert.equal(call("e2e:e2e-tester", "Grep", { pattern: "### D1", path: "/p/docs/plugins/uplink/test-data" }), null);
  assert.match(call("e2e:e2e-tester", "Grep", { pattern: "invoke" }), /search only in/);
  assert.match(call("e2e:e2e-tester", "Edit", { file_path: "/p/docs/plugins/uplink/user-stories.md" }), /never edits/);
});

test("the e2e tester runs only the app driver, the config, and looks at the app's files", () => {
  for (const command of ["npx wf config", "npx wf app start --fresh --scenario gmail-fresh --size 800x560", `npx wf app run 'click "I added it"' 'expect Done'`, "ls -la .cache/e2e/run", "head .cache/e2e/run/requests.csv"]) {
    assert.equal(e2eCommand(command, ROOT), null, command);
  }
  for (const command of ["npx wf app db app", "npx wf app logs", "npx wf app start --real", "cat src/main.rs", "npx wf app text; cat src/main.rs", "ls src", "npx wf app run 'eval $(cat x)'", "npx wf app text > out.txt"]) {
    assert.notEqual(e2eCommand(command, ROOT), null, command);
  }
  assert.match(call("e2e-tester", "WebFetch", { url: "https://example.com" }), /fetches nothing/);
  assert.match(call("e2e-tester", "WebSearch", { query: "freeorbit source" }), /searches nothing/);
  assert.equal(e2eCommand("ls .cache/e2e", ROOT), null);
  assert.equal(call("e2e-tester", "Glob", { pattern: "*.csv", path: "/p/.cache/e2e/run" }), null);
  assert.equal(call("e2e-tester", "Bash", { command: `grep -n "### D15." docs/plugins/uplink/test-data` }), null);
  assert.equal(call("e2e-tester", "Bash", { command: "grep -rn invoke /p/docs/plugins/uplink/test-data/core.md" }), null);
  assert.match(call("e2e-tester", "Bash", { command: "grep -rn invoke apps" }), /grep may search only/);
  assert.match(call("e2e-tester", "Bash", { command: "grep -rn invoke" }), /needs a pattern and a path/);
  assert.match(call("e2e-tester", "Bash", { command: "grep -rn invoke docs/plugins/uplink/test-data ../../etc" }), /grep may search only/);
});

test("the designer, the screen reader, and the reviewer each keep to their own", () => {
  assert.equal(call("testdata:test-data-designer", "Read", { file_path: "/p/.workflow/config.json" }), null);
  assert.equal(call("test-data-designer", "Read", { file_path: "/p/docs/app/personas.md" }), null);
  assert.match(call("test-data-designer", "Read", { file_path: "/p/tools/testdata/src/lib.rs" }), /not among/);
  assert.equal(call("test-data-designer", "WebFetch", { url: "https://www.rfc-editor.org/rfc/rfc5322" }), null);
  assert.match(call("test-data-designer", "Bash", { command: "ls" }), /runs no commands/);
  assert.equal(call("design:screen-reader", "Read", { file_path: "/p/.cache/screens/briefs/brief-1.md" }), null);
  assert.match(call("screen-reader", "Read", { file_path: "/p/docs/design/frames/app/home/home.html" }), /not among/);
  assert.equal(call("review:code-reviewer", "Read", { file_path: "/p/crates/core/src/lib.rs" }), null);
  assert.match(call("code-reviewer", "Read", { file_path: "/p/.env.local" }), /secret/);
  assert.match(call("code-reviewer", "Read", { file_path: "/p/.env.example" }), /secret/);
  assert.match(call("code-reviewer", "Grep", { pattern: ".", path: "/p/.env" }), /secret/);
  assert.match(call("code-reviewer", "Glob", { pattern: "*", path: "/p/keys/id_ed25519" }), /secret/);
  assert.match(call("code-reviewer", "Read", { file_path: "/p/certs/server.p12" }), /secret/);
  assert.equal(call("code-reviewer", "Grep", { pattern: "unsafe", path: "/p/crates" }), null);
  assert.equal(call("code-reviewer", "WebSearch", { query: "RUSTSEC-2026-0387" }), null);
  assert.equal(call("code-reviewer", "WebFetch", { url: "https://osv.dev/vulnerability/RUSTSEC-2026-0387" }), null);
  assert.equal(call("code-reviewer", "WebFetch", { url: "https://api.github.com/advisories" }), null);
  assert.match(call("code-reviewer", "WebFetch", { url: "https://evil.example/x" }), /not an advisory/);
});

test("as a hook it denies with a reason, passes others silently, and a crash exits non-zero for onFailure", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-guard-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify(CONFIG));
  const run = (input) => spawnSync("node", ["plugins/core/hooks/guard.mjs"], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  const denied = run(JSON.stringify({ agent_type: "e2e:e2e-tester", tool_name: "Read", tool_input: { file_path: join(root, "src/a.rs") } }));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  const main = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: join(root, "src/a.rs") } }));
  assert.equal(main.status, 0);
  assert.equal(main.stdout, "");
  const crashed = run("not json");
  assert.equal(crashed.status, 2, "exit 2 blocks the call on any build");
  assert.match(crashed.stderr, /guard failed, so the call is blocked/);
});
