// Writing a file so no reader sees half of it: the ask pages' answers and
// records, the ask-pages server's registry, and the screen review's record
// share this.

import { renameSync, writeFileSync } from "node:fs";

/** Write a file whole or not at all, readable by this user alone. */
export function writeWhole(file, text, mode = 0o600) {
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, text, { mode });
  renameSync(part, file);
}
