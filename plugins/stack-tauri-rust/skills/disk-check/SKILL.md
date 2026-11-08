---
name: disk-check
description: >-
  Checks free disk space in a second, and when it is below the minimum, cleans
  only this project's leftovers: test output, then incremental build data, then
  week-old build files. Nothing needs downloading again. Use before a Rust build
  in a new worktree, before downloading a model or other large file, at chunk
  start, when a build fails with "No space left on device", or when the user
  mentions disk space or cleaning up.
---

# Disk check

Run it. It prints the free space and stops there when there is enough.

```bash
npx wf disk              # clean if under disk.minimumGb (default 10)
npx wf disk 25           # another minimum, in GB
npx wf disk --dry-run 25 # say what it would do
```

Each step runs only if the disk is still short. The paths are `disk` in `.workflow/config.json`; `npx wf config` prints them.

| Step | Removes | Cost |
| --- | --- | --- |
| 1 | `disk.leftovers`, and `/tmp/<app.name>-agent` when the test app is stopped | None |
| 2 | `disk.incremental` | The next build is slower |
| 3 | Files in `disk.stale.dirs` untouched for `disk.stale.days` | Cargo rebuilds what it still needs |

Steps 2 and 3 wait while a process in `disk.busy` runs. An exit code of 1 means the disk is still short, or a build was running.

It never removes a path git tracks or does not ignore, so `node_modules`, `~/.cargo`, the package store, and the user's data stay, and no step needs a download.

If it ends still short, tell the owner what is largest and ask. Do not run `cargo clean` or delete anything else to get past it.
