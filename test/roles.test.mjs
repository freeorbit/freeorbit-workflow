import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { BLOCK_END, BLOCK_START, holders, roleProblems, rolesBlock, withBlock } from "../lib/roles.mjs";

const solo = merge(DEFAULTS, { people: [{ name: "Ana", handle: "ana", email: "ana@example.test" }] });
const team = merge(DEFAULTS, {
  team: "team",
  people: [
    { name: "Ana", roles: ["owner", "reviewer"] },
    { name: "Bo", roles: ["developer:frontend", "designer"] },
    { name: "Cy", roles: ["developer:backend"] },
  ],
});

test("solo gives the one person every role", () => {
  assert.deepEqual(holders(solo, "designer").map((p) => p.name), ["Ana"]);
  assert.deepEqual(roleProblems(solo), []);
  assert.match(rolesBlock(solo), /Solo: Ana holds every role \(owner, designer, developer, reviewer\).*`ana <ana@example.test>`/);
});

test("a specialty holds its role, and plain developer covers every specialty", () => {
  assert.deepEqual(holders(team, "developer").map((p) => p.name), ["Bo", "Cy"]);
  assert.deepEqual(holders(team, "developer:backend").map((p) => p.name), ["Cy"]);
  assert.deepEqual(roleProblems(team), []);
});

test("an unknown role, a decision to an unknown role, and an unheld role are problems", () => {
  const broken = merge(team, { people: [{ name: "Ana", roles: ["boss"] }], decisions: { scope: "chief" } });
  assert.deepEqual(roleProblems(broken), [
    "people: Ana holds boss, which is not one of owner, designer, developer, reviewer",
    "decisions: scope goes to chief, which is not one of owner, designer, developer, reviewer",
    "roles: nobody holds owner",
    "roles: nobody holds designer",
    "roles: nobody holds developer",
    "roles: nobody holds reviewer",
  ]);
});

test("a team block lists who holds each role and who answers each decision", () => {
  const block = rolesBlock(team);
  assert.ok(block.startsWith(BLOCK_START) && block.endsWith(BLOCK_END));
  assert.match(block, /\| developer \| Bo and Cy \|/);
  assert.match(block, /\| library \| developer and owner \|/);
});

test("the block replaces only what sits between its markers", () => {
  const text = `# Rules\n\n${BLOCK_START}\nold\n${BLOCK_END}\n\nMore.\n`;
  assert.equal(withBlock(text, `${BLOCK_START}\nnew\n${BLOCK_END}`), `# Rules\n\n${BLOCK_START}\nnew\n${BLOCK_END}\n\nMore.\n`);
  assert.equal(withBlock("# No markers\n", "x"), null);
});
