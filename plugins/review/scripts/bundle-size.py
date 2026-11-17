#!/usr/bin/env python3
"""Measure what a web build ships, and what changed since the last measure.

    python3 -I bundle-size.py <output folder> <build folder> [last measure]

Writes <output folder>/bundle-size.txt: the totals by kind, raw and gzipped,
the largest files, and, when a last measure is there, what grew, what is new,
and what went. Then it writes this measure over the last one, by default
.cache/perf/bundle-last.json, which outlives the review's emptied folder. Run
it after the project's build, such as `pnpm build > /dev/null && python3 -I
"$KIT/plugins/review/scripts/bundle-size.py" $SCAN dist`. Sizes are measured
facts, not findings: the reviewer judges them against the hot-paths doc's
budgets and PERF-DEP.

A file name with a content hash, such as index-3f9a2c1b.js or font-CVf-LbaS.woff2, is counted under
its name with the hash taken out, so a rebuild is not read as a new file.
"""

import gzip
import json
import re
import sys
from pathlib import Path

KINDS = {".js": "js", ".mjs": "js", ".css": "css", ".wasm": "wasm", ".html": "html"}
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"}
FONTS = {".woff", ".woff2", ".ttf", ".otf"}
LARGEST = 10
GREW = 0.10
# A content hash just before the extension: Vite's eight base64url characters, with a digit or a capital, or a hex one.
HASH = re.compile(r"[-.](?:(?=[A-Za-z0-9_-]{0,7}[0-9A-Z])[A-Za-z0-9_-]{8}|[0-9a-f]{8,32})(?=\.[a-z0-9]+$)")


def kind(path):
    """What a shipped file is, by its extension."""
    ext = path.suffix.lower()
    if ext in KINDS:
        return KINDS[ext]
    if ext in IMAGES:
        return "image"
    if ext in FONTS:
        return "font"
    return "map" if ext == ".map" else "other"


def measure(build):
    """Each shipped file's {name, kind, raw, gzip}, its name without a content hash. Source maps are left out."""
    files = {}
    for path in sorted(p for p in build.rglob("*") if p.is_file()):
        if kind(path) == "map":
            continue
        data = path.read_bytes()
        rel = path.relative_to(build).as_posix()
        name = HASH.sub("", rel)
        entry = files.setdefault(name, {"kind": kind(path), "raw": 0, "gzip": 0})
        entry["raw"] += len(data)
        entry["gzip"] += len(gzip.compress(data, compresslevel=9, mtime=0))
    return files


def kb(size):
    """A size in KB, one decimal place."""
    return f"{size / 1024:.1f} KB"


def report(files, last):
    """The lines of bundle-size.txt."""
    out = ["What the build ships: measured facts, not findings. Judge them against the hot-paths doc's budgets.", ""]
    totals = {}
    for entry in files.values():
        total = totals.setdefault(entry["kind"], [0, 0])
        total[0] += entry["raw"]
        total[1] += entry["gzip"]
    out.append("## Totals by kind, raw and gzipped")
    for name, (raw, zipped) in sorted(totals.items(), key=lambda item: -item[1][1]):
        out.append(f"{name}: {kb(raw)}, {kb(zipped)} gzipped")
    out.append(f"all: {kb(sum(t[0] for t in totals.values()))}, {kb(sum(t[1] for t in totals.values()))} gzipped")
    out += ["", f"## The {LARGEST} largest, gzipped"]
    for name, entry in sorted(files.items(), key=lambda item: -item[1]["gzip"])[:LARGEST]:
        out.append(f"{name}: {kb(entry['gzip'])} gzipped, {kb(entry['raw'])} raw")
    if last is None:
        out += ["", "## Since the last measure", "No last measure; the next run compares with this one."]
        return out
    was = sum(entry["gzip"] for entry in last.values())
    now = sum(entry["gzip"] for entry in files.values())
    change = (now - was) / was if was else 0
    out += ["", "## Since the last measure", f"all, gzipped: {kb(was)} to {kb(now)}, {change:+.1%}"]
    for name, entry in sorted(files.items()):
        before = last.get(name)
        if before is None:
            out.append(f"new: {name}, {kb(entry['gzip'])} gzipped")
        elif before["gzip"] and (entry["gzip"] - before["gzip"]) / before["gzip"] > GREW:
            out.append(f"grew: {name}, {kb(before['gzip'])} to {kb(entry['gzip'])} gzipped")
    out += [f"gone: {name}" for name in sorted(set(last) - set(files))]
    return out


def main():
    folder, build = Path(sys.argv[1]), Path(sys.argv[2])
    keep = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(".cache/perf/bundle-last.json")
    if not build.is_dir():
        sys.exit(f"{build} is not a folder; build the project first, then name the folder the build writes")
    files = measure(build)
    last = json.loads(keep.read_text()) if keep.exists() else None
    (folder / "bundle-size.txt").write_text("\n".join(report(files, last)) + "\n", encoding="utf-8")
    keep.parent.mkdir(parents=True, exist_ok=True)
    keep.write_text(json.dumps(files, indent=1, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
