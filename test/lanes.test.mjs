import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { chunkRows } from "../lib/docs/shape.mjs";
import { chunkId, expectedWaits, laneOf, laneProblems, waitsOn } from "../lib/lanes.mjs";
import { CHUNK, runTrack } from "../lib/tracks.mjs";

const config = merge(DEFAULTS, {});
const HEAD = "| Chunk | Stories | Area | What it builds | Likely new libraries | Status | Waits on | Detail |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
const order = (rows) => `# Build order\n\n### In progress\n\n${HEAD}\n${rows.inProgress ?? ""}\n\n### Waiting\n\nNone.\n\n### Not started\n\n${HEAD}\n${rows.notStarted ?? ""}\n`;
const done = (rows) => `# Done\n\n${HEAD}\n${rows}\n`;
const row = (id, status, waits) => `| ${id}. Sign-in | APP-01 | app | x | None | ${status} | ${waits} | x |`;

test("a lane id names its chunk and lane, and a Waits on cell lists ids", () => {
  assert.deepEqual(laneOf("1-fe"), { base: "1", lane: "fe" });
  assert.deepEqual(laneOf("35i-integration"), { base: "35i", lane: "integration" });
  assert.equal(laneOf("35i"), null);
  assert.equal(chunkId("1-fe. Sign-in screen"), "1-fe");
  assert.deepEqual(waitsOn("1-fe, 1-be"), ["1-fe", "1-be"]);
  assert.deepEqual(waitsOn("1-fe and 1-be"), ["1-fe", "1-be"]);
  assert.deepEqual(waitsOn("None"), []);
  assert.ok(CHUNK.test("1-fe") && CHUNK.test("35i") && !CHUNK.test("1-fe; id"));
  const ids = ["1-contract", "1-fe", "1-be", "1-integration"];
  assert.deepEqual(expectedWaits("1-fe", ids), ["1-contract"]);
  assert.deepEqual(expectedWaits("1-integration", ids), ["1-fe", "1-be"]);
  assert.deepEqual(expectedWaits("1-contract", ids), []);
});

test("doc:check holds the lanes: known lanes, the waits each must name, and no start before its waits are done", () => {
  const open = chunkRows(order({
    inProgress: row("1-fe", "In progress", "1-contract"),
    notStarted: [row("1-contract", "Not started", "None"), row("1-be", "Not started", ""), row("1-integration", "Not started", "1-fe"), row("2-ux", "Not started", "9-x")].join("\n"),
  }));
  const problems = laneProblems(config, open, [], "docs/log/build-order.md");
  assert.deepEqual(problems, [
    "docs/log/build-order.md: 1-fe is In progress, but 1-contract is not done",
    "docs/log/build-order.md: 1-be must wait on 1-contract",
    "docs/log/build-order.md: 1-integration must wait on 1-be",
    "docs/log/build-order.md: 2-ux is lane ux, not one of contract, fe, be, integration",
    "docs/log/build-order.md: 2-ux waits on 9-x, which no row has",
  ]);
  const fine = chunkRows(order({ inProgress: [row("1-fe", "In progress", "1-contract"), row("1-be", "In progress", "1-contract")].join("\n"), notStarted: row("1-integration", "Not started", "1-fe, 1-be") }));
  assert.deepEqual(laneProblems(config, fine, chunkRows(done(row("1-contract", "Done", "None"))), "f"), []);
});

function io(texts, failing = []) {
  const ran = [];
  const result = (cmd) => {
    ran.push(cmd);
    return { status: failing.some((part) => cmd.includes(part)) ? 1 : 0 };
  };
  return { ran, sh: result, wf: (args) => result(`npx wf ${args.join(" ")}`), read: (path) => texts[path] ?? "", branch: () => "app/1-fe", head: () => "abc1234", files: () => [] };
}

test("wf ready for a lane fails until what it waits on is merged, and adds the lane's questions", () => {
  const texts = { [config.buildOrder.file]: order({ notStarted: row("1-fe", "Not started", "1-contract") }), [config.buildOrder.done]: done("") };
  const out = [];
  assert.equal(runTrack("/p", config, "ready", ["chunk", "1-fe"], io(texts), (line) => out.push(line)), 1);
  assert.ok(out.includes("FAIL every row it waits on is done: 1-contract must be merged first"));
  assert.ok(out.some((line) => line.startsWith("ASK  Does the front end run against the contract's mock")));
  texts[config.buildOrder.done] = done(row("1-contract", "Done", "None"));
  const again = [];
  assert.equal(runTrack("/p", config, "ready", ["chunk", "1-fe"], io(texts), (line) => again.push(line)), 0);
  assert.ok(again.includes("OK   every row it waits on is done: 1-contract"));
});

test("wf done for a lane runs the contract's check and breaking check, and --agreed accepts a breaking change", () => {
  const lanes = merge(DEFAULTS, { lanes: { contract: { check: "pnpm contract:check", breaking: "pnpm contract:breaking" } } });
  const texts = { [lanes.logs.ledger]: "Last reviewed: abc1234 on 2026-11-10\n" };
  const stub = io(texts, ["contract:breaking"]);
  const out = [];
  assert.equal(runTrack("/p", lanes, "done", ["chunk", "1-be"], stub, (line) => out.push(line)), 1);
  assert.ok(stub.ran.includes("pnpm contract:check"));
  assert.ok(out.some((line) => line.startsWith("FAIL the contract has no breaking change from the base: a breaking change")));
  const agreed = [];
  assert.equal(runTrack("/p", lanes, "done", ["chunk", "1-be", "--agreed"], io(texts, ["contract:breaking"]), (line) => agreed.push(line)), 0);
  assert.ok(agreed.includes("OK   the contract has no breaking change from the base: breaking, agreed by both lanes"));
  const whole = [];
  runTrack("/p", lanes, "done", ["chunk", "35i"], io(texts), (line) => whole.push(line));
  assert.ok(whole.includes("SKIP the contract passes its check: not a lane"));
  assert.equal(runTrack("/p", lanes, "done", ["chunk", "1-be", "--force"], io(texts), () => {}), 2);
});

test("an unknown lane or a misplaced --agreed prints usage, never crashes", () => {
  for (const args of [["chunk", "1-constructor"], ["chunk", "1-toString"], ["chunk", "1-fe", "--agreed"]]) {
    assert.equal(runTrack("/p", config, "ready", args, io({}), () => {}), 2, args.join(" "));
  }
  assert.equal(runTrack("/p", config, "done", ["chunk", "35i", "--agreed"], io({}), () => {}), 2);
});

test("an empty Waits on in words or a dash, a lane waiting on itself, and Waiting counted as started", () => {
  for (const cell of ["None.", "n/a", "—", "-", ""]) assert.deepEqual(waitsOn(cell), [], cell);
  const open = chunkRows(order({ notStarted: [row("1-contract", "Not started", "1-contract"), row("1-fe", "Not started", "1-contract")].join("\n") }));
  assert.ok(laneProblems(config, open, [], "f").includes("f: 1-contract waits on itself"));
  const waiting = chunkRows(`### Waiting\n\n${HEAD}\n${row("1-be", "Waiting", "1-contract")}\n\n### Not started\n\n${HEAD}\n${row("1-contract", "Not started", "None.")}\n`);
  assert.deepEqual(laneProblems(config, waiting, [], "f"), ["f: 1-be is Waiting, but 1-contract is not done"]);
  assert.deepEqual(expectedWaits("1-fe", ["1-fe"]), []);
  const both = chunkRows(order({ inProgress: row("1-fe", "In progress", "1-contract") }));
  assert.deepEqual(laneProblems(config, both, chunkRows(done(row("1-contract", "Done", "None"))), "f"), []);
});

test("waitsDone skips a chunk that waits on nothing, and doc:check runs the lane checks", async () => {
  const texts = { [config.buildOrder.file]: order({ notStarted: row("35i", "Not started", "") }) };
  const out = [];
  runTrack("/p", config, "ready", ["chunk", "35i"], io(texts), (line) => out.push(line));
  assert.ok(out.includes("SKIP every row it waits on is done: it waits on nothing"));
  const { problems } = await import("../lib/docs/check.mjs");
  const files = { "docs/log/build-order.md": order({ inProgress: row("1-fe", "In progress", "1-contract"), notStarted: row("1-contract", "Not started", "None") }) };
  const context = { root: "/p", config: merge(DEFAULTS, { docs: { index: "none.md" } }), tracked: Object.keys(files), files: (path) => files[path] };
  assert.ok((await problems(context, "2026-11-10")).includes("docs/log/build-order.md: 1-fe is In progress, but 1-contract is not done"));
});
