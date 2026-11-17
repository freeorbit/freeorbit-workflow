#!/usr/bin/env python3
"""Edit the review ledger, so a finding's rows stay in step and in the right group.

    ledger.py add <findings.json>     add new findings, each given its next ID
    ledger.py set <ID> [--status S] [--severity S] [--where W]
                       [--note TEXT] [--decision TEXT]
    ledger.py state --last TEXT [--deep TEXT] [--light "| range | date | mode |"]
    ledger.py defer --at SHORT_HEAD   count one more deferral, at that commit
    ledger.py summary                 count each group
    ledger.py check                   list rows and details that disagree

Run from the repo root. A status decides the group, and a finding moves with
it. A closed finding's row lives in the closed file, and its details in the
closed folder, one file per week it closed (2026-W46.md), or per month with
`--period month` (2026-11.md), so the ledger holds only what is left to do and
no file grows for good. `--ledger`, `--closed`, and `--details` name other
places, as the config does. `add` takes a list of objects with prefix,
title, severity, confidence, rule, where, evidence, why, and suggestion, and
optionally note. The date is the --date option, or today.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field as fields
from datetime import date
from pathlib import Path

LEDGER = "docs/log/review/findings.md"
CLOSED = "docs/log/review/closed.md"
DETAILS = "docs/log/review/closed"
OPEN = {"proposed", "accepted", "deferred"}
FIXED = {"fixed"}
CLOSED_STATES = {"verified", "rejected", "accepted-risk", "accepted-cost", "superseded"}
HEAD = "| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n"
ROWS = ["Status", "Severity", "Confidence", "Rule", "Note", "Found", "Closed", "Evidence", "Why it matters", "Suggestion", "Decision"]


DAY = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
PERIOD_FILE = re.compile(r"^\d{4}-(?:W\d{2}|\d{2})$")


def period_of(text, period):
    """The week (2026-W46) or month (2026-11) of the first date in a text, or None."""
    day = DAY.search(text or "")
    if not day:
        return None
    if period == "month":
        return f"{day.group(1)}-{day.group(2)}"
    year, week, _ = date(*map(int, day.groups())).isocalendar()
    return f"{year}-W{week:02d}"


def period_kind(name):
    """Whether a details file is a week's or a month's, by its name."""
    return "week" if "-W" in name else "month"


@dataclass
class Closed:
    """The closed findings: the summary file's text, and each details file's text by its period."""

    summary: str
    files: dict = fields(default_factory=dict)
    folder: str = "closed"  # the details folder, relative to the summary file
    back: str = "../closed.md"  # the summary file, relative to the details folder
    period: str = "week"  # how a newly closed finding is filed

    def link(self, name, finding):
        """A summary row's link to a finding's details."""
        return f"{self.folder}/{name}.md#{finding.lower()}"

    def find(self, finding):
        """The details file holding a finding, and where in it, or None."""
        for name, text in self.files.items():
            at = block_at(text, finding)
            if at:
                return name, at
        return None


def details_file(name, summary_link):
    """A new details file's head, with an empty Details group."""
    return (
        f"# Closed review findings, {name}\n\n"
        f"The details of the findings that closed in {name}, newest first. Their rows are in [the closed summary]({summary_link}). "
        "Nothing reads this file in full: look a finding up by its ID.\n\n## Details\n\nNone.\n"
    )


def group_of(status):
    """The group a status belongs to."""
    if status in OPEN:
        return "Open"
    if status in FIXED:
        return "Fixed, waiting for review"
    if status in CLOSED_STATES:
        return "Closed"
    sys.exit(f"No status {status!r}.")


def cell(text):
    """Text as one table cell."""
    return text.replace("\n", " ").replace("|", "\\|")


def block_at(text, finding):
    """Where a finding's detail section starts and ends, or None."""
    start = re.search(rf"^### {finding}\n", text, re.M)
    if not start:
        return None
    end = re.compile(r"^#{2,3} ", re.M).search(text, start.end())
    return start.start(), end.start() if end else len(text)


def drop_field(block, name):
    """Take a detail row out, if it is there."""
    return re.sub(rf"^\| {name} \| .* \|\n", "", block, count=1, flags=re.M)


def field(block, name):
    """One row of a detail table."""
    match = re.search(rf"^\| {name} \| (.*) \|$", block, re.M)
    return match.group(1) if match else None


def set_field(block, name, value):
    """Set a detail row, adding it in its place when it is missing."""
    if field(block, name) is not None:
        return re.sub(rf"^\| {name} \| .* \|$", lambda _: f"| {name} | {cell(value)} |", block, flags=re.M)
    later = ROWS[ROWS.index(name) + 1 :]
    for other in later:
        found = re.search(rf"^\| {other} \|", block, re.M)
        if found:
            return f"{block[: found.start()]}| {name} | {cell(value)} |\n{block[found.start() :]}"
    return block.rstrip("\n") + f"\n| {name} | {cell(value)} |\n\n"


def section(text, level, name):
    """Where a heading's body starts and ends."""
    head = re.search(rf"^{level} {re.escape(name)}\n", text, re.M)
    if not head:
        sys.exit(f"No heading {level} {name}.")
    end = re.compile(rf"^#{{1,{len(level)}}} ", re.M).search(text, head.end())
    return head.end(), end.start() if end else len(text)


def row_of(text, finding):
    """A finding's summary row."""
    match = re.search(rf"^\| \[{finding}\]\(.*\n", text, re.M)
    return match.group(0) if match else None


def add_row(text, group, row, level="###"):
    """Put a summary row at the top of its group."""
    start, end = section(text, level, group)
    body = text[start:end]
    if HEAD in body:
        return text[:start] + body.replace(HEAD, HEAD + row, 1) + text[end:]
    return f"{text[:start]}\n{HEAD}{row}\n{text[end:]}"


def drop_row(text, group, row, level="###"):
    """Take a summary row out, and say "None." if its table is left empty."""
    text = text.replace(row, "", 1)
    start, end = section(text, level, group)
    if HEAD in text[start:end] and "| [" not in text[start:end]:
        text = f"{text[:start]}\nNone.\n\n{text[end:]}"
    return text


def add_detail(text, group, block):
    """Put a detail section at the top of its group in the ledger."""
    start, end = section(text, "##", group)
    body = text[start:end].lstrip("\n")
    if body.startswith("None."):
        body = body[len("None.") :].lstrip("\n")
    return f"{text[:start]}\n{block}{body}{text[end:]}"


def fill_group(text, group):
    """Say "None." under a ledger group left with no details."""
    start, end = section(text, "##", group)
    if not text[start:end].strip():
        return f"{text[:start]}\nNone.\n\n{text[end:]}"
    return text


def next_number(prefix, *texts):
    """The next free number for a prefix."""
    used = [int(n) for text in texts for n in re.findall(rf"\b{prefix}-(\d{{3}})\b", text)]
    return max(used, default=0) + 1


def add(args, ledger, closed):
    """Add new findings under Open."""
    today = args.date or date.today().isoformat()
    for item in json.loads(Path(args.file).read_text()):
        finding = f"{item['prefix']}-{next_number(item['prefix'], ledger, closed.summary, *closed.files.values()):03d}"
        rows = {
            "Status": "proposed",
            "Severity": item["severity"],
            "Confidence": item["confidence"],
            "Rule": item["rule"],
            "Note": item.get("note"),
            "Found": item.get("found", today),
            "Evidence": item["evidence"],
            "Why it matters": item["why"],
            "Suggestion": item["suggestion"],
            "Decision": "",
        }
        table = "".join(f"| {name} | {cell(rows[name])} |\n" for name in ROWS if rows.get(name) is not None)
        block = f"### {finding}\n\n**{item['title']}**\n\n| Field | Value |\n| --- | --- |\n{table}\n"
        row = f"| [{finding}](#{finding.lower()}) | {item['severity']} | proposed | {cell(item['title'])} | {item['where']} |\n"
        ledger = add_detail(add_row(ledger, "Open", row), "Open", block)
        print(finding)
    return ledger, closed


def set_finding(args, ledger, closed):
    """Change a finding's fields, and move it when its group changes."""
    finding = args.id
    today = args.date or date.today().isoformat()
    in_ledger = block_at(ledger, finding)
    found = None if in_ledger else closed.find(finding)
    if not in_ledger and not found:
        sys.exit(f"No finding {finding}.")
    name, place = (None, in_ledger) if in_ledger else found
    block = (ledger if in_ledger else closed.files[name])[place[0] : place[1]]
    row = row_of(ledger if in_ledger else closed.summary, finding)
    if row is None:
        where = "the ledger's summary" if in_ledger else "the closed file's summary"
        sys.exit(f"{finding} has details but no row in {where}; add its row, then run this again.")
    was = field(block, "Status")
    status = args.status or was
    if args.severity:
        block = set_field(block, "Severity", args.severity)
    if args.status:
        block = set_field(block, "Status", status)
    if args.decision is not None:
        block = set_field(block, "Decision", args.decision)
    if args.note:
        note = field(block, "Note")
        block = set_field(block, "Note", f"{note} {args.note}" if note else args.note)
    new_row = re.sub(rf"\| {re.escape(was)} \|", f"| {status} |", row, count=1)
    if args.severity:
        new_row = re.sub(r"^(\| \[.*?\]\(.*?\) \| )\w+", rf"\g<1>{args.severity}", new_row, count=1)
    if args.where:
        new_row = re.sub(r"\| [^|]* \|\n$", lambda _: f"| {args.where} |\n", new_row)
    if in_ledger:
        ledger = ledger[: place[0]] + ledger[place[1] :]
        ledger = drop_row(fill_group(ledger, group_of(was)), group_of(was), row)
    else:
        text = closed.files[name]
        closed.files[name] = fill_group(text[: place[0]] + text[place[1] :], "Details")
        closed.summary = drop_row(closed.summary, "Summary", row, "##")
    target = group_of(status)

    def relink(link):
        """The row with its link pointed at where the details now are."""
        return re.sub(r"^(\| \[[A-Z]+-\d+\]\()[^)]*\)", lambda m: f"{m.group(1)}{link})", new_row, count=1)

    if target == "Closed":
        # A finding is filed under the period it closed in, and stays in its file while it stays closed.
        if not field(block, "Closed"):
            block = set_field(block, "Closed", today)
        if name is None:
            name = period_of(field(block, "Closed"), closed.period)
        text = closed.files.get(name) or details_file(name, closed.back)
        closed.files[name] = add_detail(text, "Details", block)
        closed.summary = add_row(closed.summary, "Summary", relink(closed.link(name, finding)), "##")
        return ledger, closed
    block = drop_field(block, "Closed")
    ledger = add_detail(ledger, target, block)
    return add_row(ledger, target, relink(f"#{finding.lower()}")), closed


def defer(args, ledger):
    """Count one more deferral on the Deferred line. Last reviewed stays, so the backlog keeps growing."""
    today = args.date or date.today().isoformat()
    match = re.search(r"^Deferred: (?:none\.|(\d+) times?, last at .*)$", ledger, flags=re.M)
    if not match:
        raise SystemExit("The ledger has no Deferred line.")
    count = int(match.group(1) or 0) + 1
    return ledger.replace(match.group(0), f"Deferred: {count} times, last at {args.at} on {today}.", 1)


def state(args, ledger):
    """Set the state lines, and clear or add to the light runs."""
    ledger = re.sub(r"^Last reviewed: .*$", lambda _: f"Last reviewed: {args.last}", ledger, count=1, flags=re.M)
    ledger = re.sub(r"^Deferred: .*$", "Deferred: none.", ledger, count=1, flags=re.M)
    start, end = section(ledger, "##", "Light runs")
    body = ledger[start:end]
    table = "| Range | Date | Mode |\n| --- | --- | --- |\n"
    tail = re.compile(r"(?:^\|.*\n)+|^None\.\n", re.M)
    if args.deep:
        ledger = re.sub(r"^Deep reviewed: .*$", lambda _: f"Deep reviewed: {args.deep}", ledger, count=1, flags=re.M)
        start, end = section(ledger, "##", "Light runs")
        return ledger[:start] + tail.sub("None.\n", ledger[start:end], count=1) + ledger[end:]
    if args.light:
        rows = args.light + "\n"
        new = body.replace(table, table + rows, 1) if table in body else tail.sub(table + rows, body, count=1)
        return ledger[:start] + new + ledger[end:]
    return ledger


def summary_of(ledger, closed):
    """Each group's summary rows, and where its details live."""
    head = re.search(r"^## Open$", ledger, re.M).start()
    groups = {}
    for name in ["Open", "Fixed, waiting for review"]:
        start, end = section(ledger[:head] + "\n## End\n", "###", name)
        groups[name] = (ledger[start:end], ledger[head:])
    start, end = section(closed.summary, "##", "Summary")
    groups["Closed"] = (closed.summary[start:end], "".join(closed.files.values()))
    return groups


def problems(ledger, closed):
    """Rows and details that disagree."""
    found = []
    groups = summary_of(ledger, closed)
    for name, (rows, home) in groups.items():
        for finding, link, status in re.findall(r"^\| \[([A-Z]+-\d+)\]\(([^)]*)\) \| \w+ \| ([\w-]+) \|", rows, re.M):
            if group_of(status) != name:
                found.append(f"{finding}: status {status} under {name}")
            at = block_at(home, finding)
            if not at:
                found.append(f"{finding}: no details")
                continue
            if field(home[at[0] : at[1]], "Status") != status:
                found.append(f"{finding}: row says {status}, details say {field(home[at[0] : at[1]], 'Status')}")
            if name == "Closed":
                want = closed.link(closed.find(finding)[0], finding)
            else:
                want = f"#{finding.lower()}"
            if link != want:
                found.append(f"{finding}: link points at the wrong place")
    summaries = ledger[: re.search(r"^## Open$", ledger, re.M).start()] + closed.summary
    found += [f"{finding}: details in the summary" for finding in re.findall(r"^### ([A-Z]+-\d+)$", summaries, re.M)]
    ids = re.findall(r"^\| \[([A-Z]+-\d+)\]", "".join(rows for rows, _ in groups.values()), re.M)
    found += [f"{finding}: two rows" for finding in sorted({i for i in ids if ids.count(i) > 1})]
    details = re.findall(r"^### ([A-Z]+-\d+)$", groups["Open"][1] + groups["Closed"][1], re.M)
    found += [f"{finding}: details twice" for finding in sorted({i for i in details if details.count(i) > 1})]
    found += [f"{finding}: details with no row" for finding in sorted(set(details) - set(ids))]
    for name, text in closed.files.items():
        for finding in re.findall(r"^### ([A-Z]+-\d+)$", text, re.M):
            at = block_at(text, finding)
            stamp = period_of(field(text[at[0] : at[1]], "Closed"), period_kind(name))
            if stamp and stamp != name:
                found.append(f"{finding}: closed in {stamp}, filed under {name}")
    return found


def read_closed(summary_path, details_path, period="week"):
    """The closed summary and its details files."""
    summary = summary_path.read_text()
    if re.search(r"^## Details$", summary, re.M):
        sys.exit(f"{summary_path} still holds the closed findings' details; run npx wf ledger migrate to move them into {details_path}.")
    files = {path.stem: path.read_text() for path in sorted(details_path.glob("*.md")) if PERIOD_FILE.match(path.stem)} if details_path.is_dir() else {}
    return Closed(summary, files, relative(details_path, summary_path.parent), relative(summary_path, details_path), period)


def relative(path, start):
    """A path as a Markdown link from a folder reads it, with forward slashes."""
    return os.path.relpath(path, start).replace(os.sep, "/")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ledger", default=LEDGER)
    parser.add_argument("--closed", default=CLOSED)
    parser.add_argument("--details", default=DETAILS)
    parser.add_argument("--period", choices=["week", "month"], default="week")
    parser.add_argument("--date")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("add").add_argument("file")
    change = commands.add_parser("set")
    change.add_argument("id")
    for option in ["--status", "--severity", "--where", "--note", "--decision"]:
        change.add_argument(option)
    lines = commands.add_parser("state")
    lines.add_argument("--last", required=True)
    lines.add_argument("--deep")
    lines.add_argument("--light")
    commands.add_parser("defer").add_argument("--at", required=True)
    commands.add_parser("summary")
    commands.add_parser("check")
    args = parser.parse_args()
    ledger_path, closed_path, details_path = Path(args.ledger), Path(args.closed), Path(args.details)
    ledger, closed = ledger_path.read_text(), read_closed(closed_path, details_path, args.period)
    if args.command == "check":
        found = problems(ledger, closed)
        print("\n".join(found) or "The ledger is in step.")
        sys.exit(1 if found else 0)
    if args.command == "summary":
        for name, (rows, _) in summary_of(ledger, closed).items():
            print(f"{name}: {rows.count('| [')}")
        return
    if args.command == "add":
        ledger, closed = add(args, ledger, closed)
    elif args.command == "set":
        ledger, closed = set_finding(args, ledger, closed)
    elif args.command == "defer":
        ledger = defer(args, ledger)
    else:
        ledger = state(args, ledger)
    # A change that would put the files out of step is not written; problems
    # they already had are reported, and do not block a change.
    had = set(problems(ledger_path.read_text(), read_closed(closed_path, details_path, args.period)))
    found = problems(ledger, closed)
    new = [problem for problem in found if problem not in had]
    if new:
        sys.exit("Nothing written; the change would leave:\n" + "\n".join(new))
    ledger_path.write_text(ledger)
    closed_path.write_text(closed.summary)
    for name, text in closed.files.items():
        path = details_path / f"{name}.md"
        if not path.exists() or path.read_text() != text:
            details_path.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    if found:
        sys.exit("\n".join(found))


if __name__ == "__main__":
    main()
