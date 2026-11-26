#!/usr/bin/env python3
"""Move a project's review ledger into the review folder, once.

    ledger_migrate.py --from-ledger OLD --from-closed OLD
                      --ledger NEW --closed NEW --details FOLDER [--period month]

Run from the repo root. The old closed file held a Summary and every closed
finding's Details. The ledger moves as it is; the closed summary keeps only
its rows, and each finding's details go to FOLDER/<YYYY-Www>.md (or
<YYYY-MM>.md by month), by when it closed or, with no close date, when it was
found. Relative links in
the moved files are rewritten for where they now are, and so are links to the
old files from the project's other Markdown files. Files that name an old path
in any other way are listed, to change by hand.
"""

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ledger import Closed, add_detail, block_at, details_file, field, period_of, problems, relative  # noqa: E402

LINK = re.compile(r"\]\(([^)\s]+)\)")
ANCHOR = re.compile(r"\]\(#([a-z]+-\d+)\)")


def split_closed(text):
    """The old closed file's summary part, and its details blocks by ID, in order."""
    head = re.search(r"^## Details\n", text, re.M)
    if not head:
        sys.exit("The closed file holds no Details section; it may already be migrated.")
    details = text[head.end() :]
    blocks = []
    for finding in re.findall(r"^### ([A-Z][A-Z0-9]*-\d+)$", details, re.M):
        start, end = block_at(details, finding)
        blocks.append((finding, details[start:end].rstrip("\n") + "\n\n"))
    return text[: head.start()].rstrip("\n") + "\n", blocks


def filed_under(block, period):
    """The period a finding closed in, else the one it was found in, else None."""
    for name in ["Closed", "Found"]:
        stamp = period_of(field(block, name), period)
        if stamp:
            return stamp
    return None


def rebase(text, old_dir, new_dir, moved):
    """Rewrite a file's relative links. `moved` maps an old path, or path#anchor, to its new one.

    With old_dir == new_dir only links to a moved file change; otherwise every
    relative link is re-pointed from the file's new folder.
    """

    def swap(match):
        target = match.group(1)
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith(("#", "/")):
            return match.group(0)
        path, _, anchor = target.partition("#")
        resolved = os.path.normpath(os.path.join(old_dir, path)).replace(os.sep, "/")
        hashed = f"{resolved}#{anchor}" if anchor else resolved
        if hashed in moved:
            new = moved[hashed]
            new_path, _, new_anchor = new.partition("#")
            return f"]({relative(new_path, new_dir)}{'#' + new_anchor if new_anchor else ''})"
        if resolved in moved:
            return f"]({relative(moved[resolved], new_dir)}{'#' + anchor if anchor else ''})"
        if old_dir == new_dir:
            return match.group(0)
        return f"]({relative(resolved, new_dir)}{'#' + anchor if anchor else ''})"

    return LINK.sub(swap, text)


def tracked(pattern):
    """The tracked files that match a git pathspec."""
    result = subprocess.run(["git", "ls-files", "-z", "--", pattern], capture_output=True, text=True, check=False)
    return [path for path in result.stdout.split("\0") if path]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ["--from-ledger", "--from-closed", "--ledger", "--closed", "--details"]:
        parser.add_argument(name, required=True)
    parser.add_argument("--period", choices=["week", "month"], default="week")
    parser.add_argument("--date")
    args = parser.parse_args()
    norm = lambda path: os.path.normpath(path).replace(os.sep, "/")
    old_ledger, old_closed, new_ledger, new_closed, details = map(norm, [args.from_ledger, args.from_closed, args.ledger, args.closed, args.details])
    for path in [old_ledger, old_closed]:
        if not Path(path).is_file():
            sys.exit(f"No {path} to move.")
    for old, new in [(old_ledger, new_ledger), (old_closed, new_closed)]:
        if old != new and Path(new).exists():
            sys.exit(f"{new} is there already; nothing moved.")
    if Path(details).exists() and any(Path(details).iterdir()):
        sys.exit(f"{details} is not empty; nothing moved.")

    summary, blocks = split_closed(Path(old_closed).read_text())
    fallback = period_of(args.date or date.today().isoformat(), args.period)
    undated = [finding for finding, block in blocks if not filed_under(block, args.period)]
    home = {finding: filed_under(block, args.period) or fallback for finding, block in blocks}
    moved = {old_ledger: new_ledger, old_closed: new_closed}
    moved.update({f"{old_closed}#{finding.lower()}": f"{details}/{home[finding]}.md#{finding.lower()}" for finding, _ in blocks})

    closed = Closed("", {}, relative(details, os.path.dirname(new_closed) or "."), relative(new_closed, details), args.period)

    def to_finding(link_to, here=None):
        """A `#id` link to a closed finding, pointed at its details file."""

        def swap(match):
            finding = match.group(1).upper()
            if finding not in home:
                return match.group(0)
            if home[finding] == here:
                return match.group(0)
            return f"]({link_to(home[finding], finding)})"

        return swap

    in_folder = lambda name, finding: f"{name}.md#{finding.lower()}"
    # The blocks are newest first, and each goes on top of its file, so they are added oldest first.
    for finding, block in reversed(blocks):
        name = home[finding]
        block = re.sub(ANCHOR, to_finding(in_folder, name), rebase(block, os.path.dirname(old_closed), details, moved))
        closed.files[name] = add_detail(closed.files.get(name) or details_file(name, closed.back), "Details", block)
    summary = rebase(summary, os.path.dirname(old_closed), os.path.dirname(new_closed), moved)
    closed.summary = re.sub(ANCHOR, to_finding(closed.link), summary)
    ledger = rebase(Path(old_ledger).read_text(), os.path.dirname(old_ledger), os.path.dirname(new_ledger), moved)

    found = problems(ledger, closed)
    if found:
        sys.exit("Nothing moved; the new files would leave:\n" + "\n".join(found))

    others = []
    for path in tracked("*.md"):
        # A link may lead out of the project, so it is never read or written through.
        if path in (old_ledger, old_closed) or Path(path).is_symlink():
            continue
        text = Path(path).read_text()
        new = rebase(text, os.path.dirname(path), os.path.dirname(path), moved)
        if new != text:
            Path(path).write_text(new)
            others.append(path)

    for old in {old_ledger, old_closed} - {new_ledger, new_closed}:
        os.remove(old)
    for path, text in [(new_ledger, ledger), (new_closed, closed.summary)]:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(text)
    Path(details).mkdir(parents=True, exist_ok=True)
    for name, text in closed.files.items():
        Path(details, f"{name}.md").write_text(text)

    print(f"Moved the ledger to {new_ledger}, the closed summary to {new_closed}, and {len(blocks)} findings' details into {len(closed.files)} files in {details}, by {args.period}.")
    if undated:
        print(f"{len(undated)} findings had no date and went under {fallback}: {', '.join(undated)}")
    if others:
        print("Links rewritten in: " + ", ".join(others))
    named = subprocess.run(["git", "grep", "-l", "-F", "-e", old_ledger, "-e", old_closed, "--", ":!*.md"], capture_output=True, text=True, check=False).stdout.split()
    if named:
        print("These still name an old path; change them by hand: " + ", ".join(named))


if __name__ == "__main__":
    main()
