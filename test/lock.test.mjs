import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { existsSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { tryLock } from "../lib/lock.mjs";

const old = new Date(Date.now() - 300_000);
const stale = (age) => age > 60_000;
const place = () => join(mkdtempSync(join(tmpdir(), "wf-lock-")), "x.lock");

/** A lock left five minutes ago: an older kit's, empty, or with `token`. */
function left(lock, token = false) {
  mkdirSync(lock);
  if (token) {
    writeFileSync(join(lock, "held-0123456789abcdef"), "");
    utimesSync(join(lock, "held-0123456789abcdef"), old, old);
  }
  utimesSync(lock, old, old);
}

/** Run `body` with one fs call replaced, as another process would race it or the system refuse it. */
function patched(name, replace, body) {
  const real = fs[name];
  fs[name] = replace(real);
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    fs[name] = real;
    syncBuiltinESMExports();
  }
}

test("waiters in other processes that find one stale lock hold it one at a time", { timeout: 60_000 }, async () => {
  const lib = new URL("../lib/lock.mjs", import.meta.url).href;
  const code = `
    import { appendFileSync } from "node:fs";
    import { tryLock } from ${JSON.stringify(lib)};
    const [dir, go] = process.argv.slice(1);
    const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    while (Date.now() < Number(go));
    let lock;
    while (!(lock = tryLock(dir + "/x.lock", (age) => age > 60000))) pause(15);
    appendFileSync(dir + "/order", "in\\n");
    pause(25);
    appendFileSync(dir + "/order", "out\\n");
    lock.release();`;
  for (let round = 0; round < 6; round++) {
    const dir = mkdtempSync(join(tmpdir(), "wf-lock-"));
    left(join(dir, "x.lock"), Boolean(round % 2));
    const go = String(Date.now() + 350);
    await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, dir, go])));
    assert.equal(readFileSync(join(dir, "order"), "utf8"), "in\nout\n".repeat(8), `two held it at once, round ${round}`);
  }
});

test("a release called twice frees only its own lock", () => {
  const lock = place();
  const first = tryLock(lock, stale);
  first.release();
  const second = tryLock(lock, stale);
  first.release();
  assert.ok(second.held(), "the second holder still has it");
  second.release();
  assert.ok(!existsSync(lock));
});

test("what changes inside a lock does not make an old one new", () => {
  const lock = place();
  left(lock, true);
  utimesSync(lock, new Date(), new Date());
  const got = tryLock(lock, stale);
  assert.ok(got);
  got.release();
});

test("an older kit's lock made while this one is being taken is not replaced", () => {
  const lock = place();
  let olderHolds = false;
  // An older kit takes the lock by mkdir alone, here just before this one writes its token.
  const got = patched(
    "writeFileSync",
    (real) => (...args) => {
      try {
        mkdirSync(lock);
        olderHolds = true;
      } catch {}
      return real(...args);
    },
    () => tryLock(lock, stale),
  );
  assert.ok(!(got && olderHolds), "two holders, with nothing stale");
});

test("an empty lock made while a stale one was being read is left", () => {
  const lock = place();
  left(lock);
  const got = patched(
    "readdirSync",
    (real) => (path, ...args) => {
      if (path === lock) {
        fs.rmdirSync(lock);
        mkdirSync(lock);
      }
      return real(path, ...args);
    },
    () => tryLock(lock, stale),
  );
  assert.equal(got, null, "an older kit's live lock");
  assert.ok(existsSync(lock));
});

test("a stale file that may not be removed fails at once, not as held", () => {
  const lock = place();
  writeFileSync(lock, "");
  utimesSync(lock, old, old);
  const refused = () => () => {
    throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  };
  assert.throws(() => patched("unlinkSync", refused, () => tryLock(lock, stale)), { code: "EPERM" });
});

test("a folder named like a token, and a lock that cannot be read, are held, not a raw error", () => {
  const lock = place();
  mkdirSync(join(lock, "held-0123456789abcdef"), { recursive: true });
  utimesSync(join(lock, "held-0123456789abcdef"), old, old);
  assert.equal(tryLock(lock, stale), null);
  const shut = place();
  left(shut);
  const denied = () => () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  };
  assert.equal(patched("readdirSync", denied, () => tryLock(shut, stale)), null);
});

test("a stale file in the lock's place is replaced, and a stale link is removed, never followed", () => {
  const file = place();
  writeFileSync(file, "");
  utimesSync(file, old, old);
  tryLock(file, stale).release();
  assert.ok(!existsSync(file), "taken over, then let go");

  const link = place();
  const target = `${link}-target`;
  left(target, true);
  symlinkSync(target, link);
  lutimesSync(link, old, old);
  tryLock(link, stale).release();
  assert.deepEqual(readdirSync(target), ["held-0123456789abcdef"], "nothing in the linked folder is touched");
});
