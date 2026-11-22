// The app's locks under holders that are real processes: working past the
// stale age with the main thread blocked, killed, suspended, or gone.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { acquireLock, starter } from "../lib/app/start.mjs";

// Short ages, the same order as the real ones: a beat well inside the stale age.
const TIMES = { staleMs: 700, beatMs: 100 };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const place = () => join(mkdtempSync(join(tmpdir(), "wf-holder-")), "data.lock");

/** A process that takes the lock, says so, runs `work`, and says when it ends that. */
async function holder(lock, work, before = "") {
  const start = new URL("../lib/app/start.mjs", import.meta.url).href;
  const code = `
    import { spawnSync } from "node:child_process";
    import { acquireLock } from ${JSON.stringify(start)};
    ${before}
    const release = await acquireLock(process.argv[1], ${JSON.stringify(TIMES)});
    process.stdout.write("held\\n");
    ${work}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, lock], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (data) => (out += data));
  const exited = new Promise((ok) => child.on("exit", ok));
  while (!out.includes("held")) {
    assert.equal(child.exitCode, null, "the holder ended before it held");
    await sleep(10);
  }
  return { child, exited, said: () => out };
}

const BLOCKS = {
  "in spawnSync, as a hook's build is": 'spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 2500)"]);',
  "in a busy loop": "for (const end = Date.now() + 2500; Date.now() < end;);",
};
for (const [how, block] of Object.entries(BLOCKS)) {
  test(`a live holder blocked ${how} past the stale age keeps its lock`, { timeout: 20_000 }, async () => {
    const lock = place();
    const { exited, said } = await holder(lock, `${block} process.stdout.write("done\\n"); release();`);
    const release = await acquireLock(lock, { ...TIMES, waitMs: 10_000 });
    const overlapped = !said().includes("done") && (await sleep(150), !said().includes("done"));
    release();
    await exited;
    assert.ok(!overlapped, "taken over while it worked");
  });
}

test("an older kit, which judges by the folder's age alone, sees a blocked holder's lock as new", { timeout: 20_000 }, async () => {
  const lock = place();
  const { exited } = await holder(lock, "for (const end = Date.now() + 1800; Date.now() < end;); release();");
  await sleep(1300);
  const age = Date.now() - statSync(lock).mtimeMs;
  await exited;
  assert.ok(age < TIMES.staleMs, `the folder was ${Math.round(age)} ms old`);
});

test("a killed holder's lock is still taken over once stale", { timeout: 20_000 }, async () => {
  const lock = place();
  const { child, exited } = await holder(lock, "setInterval(() => {}, 1000);");
  await sleep(300);
  child.kill("SIGKILL");
  await exited;
  const started = Date.now();
  (await acquireLock(lock, { ...TIMES, waitMs: 8000 }))();
  const took = Date.now() - started;
  assert.ok(took > 300 && took < 3000, `took ${took} ms`);
});

test("a holder suspended past the stale age, as by a computer's sleep, has its lock when it wakes", { timeout: 20_000 }, async () => {
  const lock = place();
  const { child, exited } = await holder(lock, "await new Promise((ok) => setTimeout(ok, 3000)); release();");
  try {
    child.kill("SIGSTOP");
    await sleep(1100);
    let got = false;
    const next = acquireLock(lock, { ...TIMES, waitMs: 10_000 }).then((release) => ((got = true), release));
    await sleep(50);
    child.kill("SIGCONT");
    await sleep(700);
    const taken = got;
    await exited;
    (await next)();
    assert.ok(!taken, "taken over as it woke");
  } finally {
    child.kill("SIGCONT");
  }
});

test("a dead holder whose pid another process has now is taken over after a few beats", { timeout: 20_000 }, async () => {
  const lock = place();
  mkdirSync(lock);
  const token = join(lock, "held-0123456789abcdef");
  writeFileSync(token, String(process.pid));
  const old = new Date(Date.now() - 60_000);
  utimesSync(token, old, old);
  const started = Date.now();
  (await acquireLock(lock, { ...TIMES, waitMs: 5000 }))();
  assert.ok(Date.now() - started < 2000);
});

test("a holder that ends without letting go ends at once, and its lock goes stale", { timeout: 20_000 }, async () => {
  const lock = place();
  const { exited } = await holder(lock, "");
  assert.equal(await Promise.race([exited, sleep(3000).then(() => "still running")]), 0);
  (await acquireLock(lock, { ...TIMES, waitMs: 5000 }))();
});

test("a release stops the beat, and leaves the next holder's lock to its own", { timeout: 20_000 }, async () => {
  const lock = place();
  (await acquireLock(lock, TIMES))();
  await sleep(250);
  assert.ok(!existsSync(lock));
  mkdirSync(lock);
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  await sleep(250);
  assert.ok(Date.now() - statSync(lock).mtimeMs > 50_000, "a released holder touches nothing");
});

test("lockSeenData waits past two minutes for a holder still working, whatever the clock says", { timeout: 20_000 }, async (t) => {
  const { lockSeenData } = starter({ s: { seenData: join(mkdtempSync(join(tmpdir(), "wf-seen-")), "base", "data") } });
  const first = await lockSeenData();
  let got = false;
  const next = lockSeenData().then(
    (release) => ((got = true), release),
    (error) => ((got = error.message), () => {}),
  );
  await sleep(150);
  const now = Date.now;
  t.mock.method(Date, "now", () => now() + 31 * 60_000);
  await sleep(350);
  const early = got;
  t.mock.restoreAll();
  first();
  (await next)();
  assert.equal(early, false, "still waiting, though the clock moved on 31 minutes");
});

test("a wait says so once it is a while", { timeout: 20_000 }, async (t) => {
  const lock = place();
  const first = await acquireLock(lock);
  const said = t.mock.method(console, "error", () => {});
  await assert.rejects(acquireLock(lock, { waitMs: 400, sayMs: 100 }), /held by another start/);
  first();
  assert.equal(said.mock.callCount(), 1);
  assert.match(String(said.mock.calls[0].arguments[0]), /Waiting for .*data\.lock/);
});

test("a hook's NODE_OPTIONS does not stop the beat", { timeout: 20_000 }, async () => {
  const lock = place();
  const { exited } = await holder(lock, "for (const end = Date.now() + 1800; Date.now() < end;); release();", 'process.env.NODE_OPTIONS = "--input-type=module -r ./none.cjs";');
  await sleep(1300);
  const age = Date.now() - statSync(lock).mtimeMs;
  await exited;
  assert.ok(age < TIMES.staleMs, `the folder was ${Math.round(age)} ms old`);
});

test("a beat that cannot start gives no lock, and says why", { timeout: 20_000 }, async () => {
  const lock = place();
  const start = new URL("../lib/app/start.mjs", import.meta.url).href;
  const code = `import { mkdtempSync, rmdirSync } from "node:fs";
    const gone = mkdtempSync(process.argv[2]);
    const { acquireLock } = await import(${JSON.stringify(start)});
    process.chdir(gone);
    rmdirSync(gone);
    await acquireLock(process.argv[1]);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, lock, `${lock}-cwd-`], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (data) => (err += data));
  assert.notEqual(await new Promise((ok) => child.on("close", ok)), 0);
  assert.match(err, /cannot be kept fresh/);
  assert.ok(!existsSync(lock), "let go");
});

test("the wait is for each holder, so a queue that moves is waited out", { timeout: 20_000 }, async () => {
  const lock = place();
  mkdirSync(lock);
  let n = 0;
  const next = () => {
    const was = join(lock, `held-${String(n).padStart(16, "0")}`);
    n += 1;
    writeFileSync(join(lock, `held-${String(n).padStart(16, "0")}`), String(process.pid));
    rmSync(was, { force: true });
  };
  next();
  const waiting = acquireLock(lock, { waitMs: 700 });
  const failed = waiting.then(() => null, (error) => error.message);
  for (let i = 0; i < 4; i++) {
    await sleep(350);
    next();
  }
  rmSync(lock, { recursive: true });
  assert.equal(await failed, null);
  (await waiting)();
});

test("a token that cannot be read is not called dead", { timeout: 20_000 }, async () => {
  const lock = place();
  mkdirSync(lock);
  const token = join(lock, "held-0123456789abcdef");
  writeFileSync(token, String(process.pid));
  const old = new Date(Date.now() - 300_000);
  utimesSync(token, old, old);
  const { deadHolder } = await import("../lib/app/holder.mjs");
  const real = fs.openSync;
  fs.openSync = () => {
    throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
  };
  syncBuiltinESMExports();
  try {
    assert.equal(deadHolder(700, 100)(300_000, { path: token, mtimeMs: old.getTime() }), false);
  } finally {
    fs.openSync = real;
    syncBuiltinESMExports();
  }
});

test("a release says so when its lock was removed while it worked", { timeout: 20_000 }, async (t) => {
  const lock = place();
  const release = await acquireLock(lock, TIMES);
  rmSync(lock, { recursive: true });
  const said = t.mock.method(console, "error", () => {});
  release();
  release();
  assert.equal(said.mock.callCount(), 1);
});
