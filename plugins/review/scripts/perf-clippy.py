#!/usr/bin/env python3
"""Run Clippy's performance lints and list what they found, for the performance pass.

    python3 -I perf-clippy.py <output folder> [file with paths to keep] [-]

Writes <output folder>/perf-clippy.txt: each lint that fired, with its count
and each place as file:line and Clippy's message. With a list, only places in
those paths are reported. With `-`, it reads `cargo clippy
--message-format=json` output from stdin instead of running Clippy, for the
tests. A lint here is a measured fact, not a finding: the reviewer judges it
against the hot-paths doc.

The lints are Clippy's perf group, which warns by default but a project can
turn off, and the pedantic, nursery, and suspicious lints that name a cost.
"""

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

LINTS = [
    "clippy::perf",
    "clippy::await_holding_lock",
    "clippy::await_holding_refcell_ref",
    "clippy::format_collect",
    "clippy::inefficient_to_string",
    "clippy::large_futures",
    "clippy::large_stack_arrays",
    "clippy::large_types_passed_by_value",
    "clippy::naive_bytecount",
    "clippy::needless_collect",
    "clippy::needless_pass_by_value",
    "clippy::rc_buffer",
    "clippy::redundant_clone",
    "clippy::trivially_copy_pass_by_ref",
    "clippy::unnecessary_box_returns",
    "clippy::unused_async",
]
SHOWN = 30


def clippy():
    """Clippy's JSON messages for the workspace, with the lints above turned on."""
    # Every other lint off first, so only these report; a later flag wins over an earlier one.
    flags = ["-A", "clippy::all", *[arg for lint in LINTS for arg in ("-W", lint)]]
    run = subprocess.run(["cargo", "clippy", "--workspace", "--message-format=json", "--", *flags], capture_output=True, text=True)
    if run.returncode != 0 and not run.stdout:
        sys.exit(run.stderr.strip().splitlines()[-1] if run.stderr.strip() else f"cargo clippy failed with exit {run.returncode}")
    return run.stdout


def places(output, keep):
    """Each lint that fired: {lint: [(file, line, message)]}, in the kept paths, each place once."""
    found = defaultdict(list)
    seen = set()
    for line in output.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = record.get("message") or {}
        code = (message.get("code") or {}).get("code") or ""
        if record.get("reason") != "compiler-message" or not code.startswith("clippy::"):
            continue
        span = next((s for s in message.get("spans", []) if s.get("is_primary")), None)
        if not span or (keep is not None and span["file_name"] not in keep):
            continue
        key = (code, span["file_name"], span["line_start"])
        if key in seen:
            continue
        seen.add(key)
        found[code].append((span["file_name"], span["line_start"], message.get("message", "")))
    return found


def main():
    folder = Path(sys.argv[1])
    args = sys.argv[2:]
    from_stdin = "-" in args
    lists = [arg for arg in args if arg != "-" and arg]
    keep = set(Path(lists[0]).read_text().split()) if lists else None
    found = places(sys.stdin.read() if from_stdin else clippy(), keep)
    with open(folder / "perf-clippy.txt", "w", encoding="utf-8") as out:
        out.write("Clippy's performance lints: measured facts, not findings. Judge each against the hot-paths doc.\n\n")
        if not found:
            out.write("None fired.\n")
        for code in sorted(found, key=lambda c: (-len(found[c]), c)):
            rows = sorted(found[code])
            out.write(f"## {code}: {len(rows)}\n")
            for file, line, text in rows[:SHOWN]:
                out.write(f"{file}:{line} {text}\n")
            if len(rows) > SHOWN:
                out.write(f"and {len(rows) - SHOWN} more\n")
            out.write("\n")


if __name__ == "__main__":
    main()
