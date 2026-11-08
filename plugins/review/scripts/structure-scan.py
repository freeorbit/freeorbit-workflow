#!/usr/bin/env python3
"""Measure what a structure review should not spend a model on.

    python3 -I structure-scan.py <output folder> [file with paths to keep]

Writes <output folder>/structure.txt. Each line is a fact for the reviewer to
judge, not a finding. With a list, only those paths are reported.
"""

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

FILE_NEAR = 400
FILE_OVER = 600
TEST_FILE_OVER = 1000
FUNCTION_LOOK = 60
FUNCTION_OVER = 100
FOLDER_OVER = 10
RECENT_COMMITS = 40
MOST_CHANGED = 15
GETTER = 3

CODE = (".rs", ".ts", ".tsx")
GENERATED = "bindings.ts"
NO_NAMES = {"utils", "helpers", "misc", "common", "constants", "enums", "interfaces"}
RUST_FN = re.compile(r"^(\s*)(pub(?:\([a-z]+\))? )?(?:async )?fn (\w+)")
TS_FN = re.compile(r"^(\s*)(export )?(?:default )?(?:async )?function (\w+)")
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(")


def tracked():
    """Every tracked path, with generated files and fixtures left out."""
    out = subprocess.check_output(["git", "ls-files"], text=True)
    return [
        path
        for path in out.splitlines()
        if not path.startswith(("docs/", "tools/testdata/fixtures/"))
        and not path.endswith(GENERATED)
    ]


def is_test_file(path):
    """True for a whole file of tests."""
    return (
        "/tests/" in path
        or "/plugin_tests/" in path
        or path.endswith((".test.ts", ".test.tsx"))
    )


def before_tests(text):
    """A Rust file's lines above its test module."""
    return re.split(r"#\[cfg\((?:all\()?test", text)[0].split("\n")


def functions(lines, pattern):
    """Each top-level or method function: line, name, length, whether it is
    public, and whether a comment sits above it."""
    found = []
    for at, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        indent = match.group(1)
        for end in range(at + 1, len(lines)):
            if lines[end].startswith(indent + "}") or lines[end].startswith(indent + ")"):
                if "{" in lines[end] and lines[end].rstrip().endswith("{"):
                    continue
                above = at - 1
                while above >= 0 and lines[above].strip().startswith("#["):
                    above -= 1
                said = above >= 0 and lines[above].strip().startswith(("///", "//", "*/", "/**"))
                found.append((at + 1, match.group(3), end - at, match.group(2) is not None, said))
                break
    return found


def scan_code(path, report):
    """File size, function size, missing comments, and unwinding in one file."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    rust = path.endswith(".rs")
    lines = before_tests(text) if rust else text.split("\n")
    count = len(lines)
    limit = TEST_FILE_OVER if is_test_file(path) else FILE_OVER
    if count > limit:
        report["size"].append(f"{path}: {count} lines, over {limit}")
    elif count > FILE_NEAR and not is_test_file(path):
        report["size"].append(f"{path}: {count} lines, near")
    if is_test_file(path):
        return
    for line, name, length, public, said in functions(lines, RUST_FN if rust else TS_FN):
        if length > FUNCTION_OVER:
            report["functions"].append(f"{path}:{line} {name}: {length} lines, over {FUNCTION_OVER}")
        elif length > FUNCTION_LOOK:
            report["functions"].append(f"{path}:{line} {name}: {length} lines")
        if public and not said and length > GETTER:
            report["comments"].append(f"{path}:{line} {name}")
    for at, line in enumerate(lines, 1):
        if rust and "Result<" in line and re.search(r"Result<[^;{]*, String>", line):
            report["errors"].append(f"{path}:{at} returns a bare String error")
        if rust and re.search(r"\.unwrap\(\)|\bpanic!\(|\.expect\(", line):
            report["unwinds"].append(f"{path}:{at} {line.strip()[:70]}")
        if not rust and "style={{" in line:
            report["ui"].append(f"{path}:{at} inline style")


def scan_css(path, report):
    """Colors written by hand, outside the token file."""
    if path.endswith("tokens.css"):
        return
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    for at, line in enumerate(text.split("\n"), 1):
        if COLOR.search(line):
            report["ui"].append(f"{path}:{at} hard-coded color: {line.strip()[:50]}")


def scan_folders(paths, report):
    """Folders past the line, counting a component and its styles as one."""
    folders = {}
    for path in paths:
        if path.endswith(CODE):
            folder, _, name = path.rpartition("/")
            folders.setdefault(folder, set()).add(name.split(".")[0])
    for folder, names in sorted(folders.items()):
        if len(names) > FOLDER_OVER:
            report["folders"].append(f"{folder}: {len(names)} code files")


def scan_names(paths, report):
    """File names the rubric does not allow."""
    for path in paths:
        if Path(path).stem.lower() in NO_NAMES and path.endswith(CODE):
            report["names"].append(path)


def most_changed(paths, report):
    """Code files that changed most lately, where a review pays off most."""
    out = subprocess.check_output(
        ["git", "log", f"-{RECENT_COMMITS}", "--name-only", "--format="], text=True
    )
    counts = Counter(line for line in out.splitlines() if line in set(paths))
    for path, times in counts.most_common(MOST_CHANGED):
        report["changed"].append(f"{path}: {times} of the last {RECENT_COMMITS} commits")


def main():
    folder = Path(sys.argv[1])
    paths = tracked()
    if len(sys.argv) > 2:
        keep = set(Path(sys.argv[2]).read_text().split())
        paths = [path for path in paths if path in keep]
    code = [path for path in paths if path.endswith(CODE) and Path(path).exists()]
    keys = ["size", "functions", "comments", "errors", "unwinds", "ui", "folders", "names", "changed"]
    report = {key: [] for key in keys}
    for path in code:
        scan_code(path, report)
    for path in paths:
        if path.endswith(".css") and Path(path).exists():
            scan_css(path, report)
    scan_folders(code, report)
    scan_names(code, report)
    most_changed(code, report)
    titles = {
        "size": "File size (CS-SIZE, Rust counted above its tests)",
        "functions": "Long functions (CS-FUNC)",
        "comments": "Public functions with no comment above (CS-CMT)",
        "errors": "Bare String errors (CS-ERR)",
        "unwinds": "unwrap, expect, and panic outside tests (CS-ERR)",
        "ui": "Inline styles and hard-coded colors (CS-UI)",
        "folders": "Folders past the line (CS-FOLDER)",
        "names": "File names not allowed (CS-NAME, CS-TYPES)",
        "changed": "Most changed lately, read these first",
    }
    with open(folder / "structure.txt", "w", encoding="utf-8") as out:
        for key in keys:
            out.write(f"## {titles[key]}: {len(report[key])}\n")
            for line in report[key]:
                out.write(f"{line}\n")
            out.write("\n")


if __name__ == "__main__":
    main()
