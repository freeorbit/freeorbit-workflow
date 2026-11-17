#!/usr/bin/env python3
"""List the places a performance review should look first.

    python3 -I perf-scan.py <output folder> [file with paths to keep]

Writes <output folder>/perf-scan.txt. Each line is a place for the reviewer to
judge against the PERF- rules and the hot-paths doc, not a finding: a loop over
three items may wait in each turn, and a sync command may read one small file.
With a list, only those paths are reported.

It reads .rs, .ts, .tsx, .js, and .mjs files, by their text, with no compiler:
a loop or an async body is found by its braces, after strings and comments are
taken out. Tests and folders that do not ship, such as tools/, are left
out, since their cost is not the user's.
"""

import re
import subprocess
import sys
from pathlib import Path

CODE = (".rs", ".ts", ".tsx", ".js", ".mjs")

# A loop's first line, and what in its body waits or crosses a boundary.
RUST_LOOP = re.compile(r"^\s*(?:'\w+:\s*)?(?:for\b.*\bin\b|while\b|loop\b)[^;]*\{\s*$")
TS_LOOP = re.compile(r"^\s*(?:for\s*\((?!.*\bawait\b)|while\s*\()[^;]*\{\s*$|\.(?:forEach|map)\(\s*async\b")
RUST_WAITS = re.compile(r"\.await\b|\bstd::fs::|\bfs::\w+\(|\bFile::(?:open|create)\(|\bCommand::new\(")
TS_WAITS = re.compile(r"\bawait\b|\binvoke\(|\bfetch\(|\breadFileSync\(|\bexecSync\(|\bspawnSync\(")

# Work that blocks the thread it runs on.
RUST_BLOCKING = re.compile(
    r"\bstd::fs::|(?<![\w:])fs::(?:read|write|copy|remove|create_dir|read_dir|metadata|rename)\w*\(|\bFile::(?:open|create)\("
    r"|\bstd::thread::sleep\(|\bthread::sleep\(|\breqwest::blocking\b|\bstd::process::Command\b|\.read_to_(?:string|end)\("
)
RUST_ASYNC_FN = re.compile(r"^\s*(?:pub(?:\([a-z]+\))? )?async fn \w+")
RUST_FN = re.compile(r"^\s*(?:pub(?:\([a-z]+\))? )?(?:async )?fn \w+")
TAURI_COMMAND = re.compile(r"^\s*#\[tauri::command(?:\((?P<args>[^)]*)\))?\]")

# A whole file read into memory.
RUST_WHOLE = re.compile(r"\bfs::read(?:_to_string)?\(|\.read_to_(?:string|end)\(")
TS_WHOLE = re.compile(r"\breadFileSync\(|\breadFile\(|\.arrayBuffer\(\)|\.text\(\)")

# A timer that asks again and again.
TS_POLL = re.compile(r"\bsetInterval\(")
RUST_SLEEP = re.compile(r"\bsleep\(")


# The scans run with python3 -I, which leaves the script's own folder off the
# path; the shared helpers sit beside it, in the kit, so that folder is added.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scanlib import before_tests, is_test_file, tracked as tracked_paths  # noqa: E402
tracked = tracked_paths

# Folders whose code runs for the developer, not the person using the product.
NOT_SHIPPED = {"tools", "testdata", "fixtures", "benches", "examples", "scripts"}


def is_test(path):
    """True for a file of tests, or one in a folder that does not ship, such as tools/."""
    return is_test_file(path) or bool(NOT_SHIPPED & set(path.split("/")[:-1]))


def bare(line):
    """A line with its strings and its trailing comment taken out, so braces count."""
    line = re.sub(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`[^`]*`', '""', line)
    return line.split("//")[0]


def region(lines, start):
    """The lines from `start` to the brace that closes the first one opened on or after it."""
    depth = 0
    opened = False
    for at in range(start, len(lines)):
        text = bare(lines[at])
        depth += text.count("{") - text.count("}")
        opened = opened or "{" in text
        if opened and depth <= 0:
            return start, at
    return start, len(lines) - 1


def inside_blocking(lines, start, end):
    """The line numbers within a spawn_blocking or block_in_place call, which may block."""
    allowed = set()
    for at in range(start, end + 1):
        if re.search(r"\b(?:spawn_blocking|block_in_place)\(", lines[at]):
            first, last = region(lines, at)
            allowed.update(range(first, last + 1))
    return allowed


def scan_rust(path, lines, report):
    """Loops that wait, blocking work in async code and sync commands, whole-file reads, and sleep loops."""
    for at, line in enumerate(lines):
        if RUST_LOOP.match(bare(line)):
            first, last = region(lines, at)
            waits = [n for n in range(first + 1, last + 1) if RUST_WAITS.search(bare(lines[n]))]
            if waits:
                report["loops"].append(f"{path}:{at + 1} a loop that waits or does I/O in its body, at line {', '.join(str(n + 1) for n in waits[:5])}")
            if line.strip().startswith(("loop", "while")) and any(RUST_SLEEP.search(lines[n]) for n in range(first + 1, last + 1)):
                report["polls"].append(f"{path}:{at + 1} a loop that sleeps and checks again")
        if RUST_ASYNC_FN.match(line):
            first, last = region(lines, at)
            allowed = inside_blocking(lines, first, last)
            for n in range(first + 1, last + 1):
                if n not in allowed and RUST_BLOCKING.search(bare(lines[n])):
                    report["blocking"].append(f"{path}:{n + 1} blocking work in async fn: {lines[n].strip()[:70]}")
        command = TAURI_COMMAND.match(line)
        if command and "async" not in (command.group("args") or ""):
            fn = next((n for n in range(at + 1, min(at + 4, len(lines))) if RUST_FN.match(lines[n])), None)
            if fn is not None and not RUST_ASYNC_FN.match(lines[fn]):
                first, last = region(lines, fn)
                io = [n for n in range(first + 1, last + 1) if RUST_BLOCKING.search(bare(lines[n])) or RUST_WAITS.search(bare(lines[n]))]
                if io:
                    report["blocking"].append(f"{path}:{fn + 1} a sync Tauri command, which runs on the main thread, does I/O at line {', '.join(str(n + 1) for n in io[:5])}")
        # A read held to a size by .take() is bounded already.
        if RUST_WHOLE.search(bare(line)) and ".take(" not in line and ".take(" not in (lines[at - 1] if at else ""):
            report["whole"].append(f"{path}:{at + 1} {line.strip()[:70]}")


def scan_ts(path, lines, report):
    """Loops that wait or cross to the backend, polling timers, and whole-file reads."""
    for at, line in enumerate(lines):
        text = bare(line)
        if TS_LOOP.search(text):
            first, last = region(lines, at)
            waits = [n for n in range(first + 1, last + 1) if TS_WAITS.search(bare(lines[n]))]
            if ".forEach(" in text or ".map(" in text:
                report["loops"].append(f"{path}:{at + 1} an async callback per item")
            elif waits:
                report["loops"].append(f"{path}:{at + 1} a loop that waits or calls out in its body, at line {', '.join(str(n + 1) for n in waits[:5])}")
        if TS_POLL.search(text):
            report["polls"].append(f"{path}:{at + 1} {line.strip()[:70]}")
        if TS_WHOLE.search(text):
            report["whole"].append(f"{path}:{at + 1} {line.strip()[:70]}")


def main():
    folder = Path(sys.argv[1])
    paths = tracked()
    if len(sys.argv) > 2 and sys.argv[2]:
        keep = set(Path(sys.argv[2]).read_text().split())
        paths = [path for path in paths if path in keep]
    keys = ["loops", "blocking", "whole", "polls"]
    report = {key: [] for key in keys}
    for path in paths:
        if not path.endswith(CODE) or is_test(path) or not Path(path).exists():
            continue
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        if path.endswith(".rs"):
            scan_rust(path, before_tests(text), report)
        else:
            scan_ts(path, text.split("\n"), report)
    titles = {
        "loops": "Loops that wait, call out, or do I/O each turn (PERF-LOOP, PERF-IPC)",
        "blocking": "Blocking work on an async runtime or the main thread (PERF-BLOCK)",
        "whole": "Whole files read into memory (PERF-BOUND)",
        "polls": "Timers and loops that check again and again (PERF-IPC)",
    }
    with open(folder / "perf-scan.txt", "w", encoding="utf-8") as out:
        out.write("Places to look, not findings: judge each against the hot-paths doc's data sizes.\n\n")
        for key in keys:
            out.write(f"## {titles[key]}: {len(report[key])}\n")
            for line in report[key]:
                out.write(f"{line}\n")
            out.write("\n")


if __name__ == "__main__":
    main()
