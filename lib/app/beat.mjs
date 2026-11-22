// The thread that beats for a lock's holder (holder.mjs), in a file of its
// own so it needs neither the process's environment nor its flags. It
// touches the token and then the lock's folder, whose age is all an older
// kit reads, and never makes or follows either. The first touch says it
// runs; it ends when the token is gone.

import { lutimesSync } from "node:fs";
import { workerData } from "node:worker_threads";

const { token, folder, every, ready } = workerData;

/** Touch both; false once the token is gone. */
function touch() {
  const now = new Date();
  try {
    lutimesSync(token, now, now);
  } catch (error) {
    return error.code !== "ENOENT" && error.code !== "ENOTDIR";
  }
  try {
    lutimesSync(folder, now, now);
  } catch {}
  return true;
}

touch();
Atomics.store(new Int32Array(ready), 0, 1);
Atomics.notify(new Int32Array(ready), 0);
const timer = setInterval(() => {
  if (!touch()) clearInterval(timer);
}, every);
