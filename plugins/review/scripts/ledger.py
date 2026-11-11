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
it. A closed finding's row and details live in the closed file, so the ledger
holds only what is left to do. `--ledger` and `--closed`
name other files, for the tests. `add` takes a list of objects with prefix,
title, severity, confidence, rule, where, evidence, why, and suggestion, and
optionally note. The date is the --date option, or today.
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

LEDGER = "docs/log/review-findings.md"
CLOSED = "docs/log/review-findings-closed.md"
OPEN = {"proposed", "accepted", "deferred"}
FIXED = {"fixed"}
CLOSED_STATES = {"verified", "rejected", "accepted-risk", "superseded"}
HEAD = "| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n"
ROWS = ["Status", "Severity", "Confidence", "Rule", "Note", "Found", "Evidence", "Why it matters", "Suggestion", "Decision"]


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
        finding = f"{item['prefix']}-{next_number(item['prefix'], ledger, closed):03d}"
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
        table = "".join(f"| {name} | {cell(rows[name])} |\n" for name in ROWS if rows[name] is not None)
        block = f"### {finding}\n\n**{item['title']}**\n\n| Field | Value |\n| --- | --- |\n{table}\n"
        row = f"| [{finding}](#{finding.lower()}) | {item['severity']} | proposed | {cell(item['title'])} | {item['where']} |\n"
        ledger = add_detail(add_row(ledger, "Open", row), "Open", block)
        print(finding)
    return ledger, closed


def set_finding(args, ledger, closed):
    """Change a finding's fields, and move it when its group changes."""
    finding = args.id
    in_ledger = block_at(ledger, finding)
    place = in_ledger or block_at(closed, finding)
    if not place:
        sys.exit(f"No finding {finding}.")
    source = ledger if in_ledger else closed
    block = source[place[0] : place[1]]
    row = row_of(ledger if in_ledger else closed, finding)
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
        closed = fill_group(closed[: place[0]] + closed[place[1] :], "Details")
        closed = drop_row(closed, "Summary", row, "##")
    target = group_of(status)
    if target == "Closed":
        return ledger, add_row(add_detail(closed, "Details", block), "Summary", new_row, "##")
    ledger = add_detail(ledger, target, block)
    return add_row(ledger, target, new_row), closed


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
    details = section(closed, "##", "Details")[0]
    groups = {}
    for name in ["Open", "Fixed, waiting for review"]:
        start, end = section(ledger[:head] + "\n## End\n", "###", name)
        groups[name] = (ledger[start:end], ledger[head:])
    start, end = section(closed, "##", "Summary")
    groups["Closed"] = (closed[start:end], closed[details:])
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
            elif field(home[at[0] : at[1]], "Status") != status:
                found.append(f"{finding}: row says {status}, details say {field(home[at[0] : at[1]], 'Status')}")
            if link != f"#{finding.lower()}":
                found.append(f"{finding}: link points at the wrong place")
    summaries = ledger[: re.search(r"^## Open$", ledger, re.M).start()] + closed[: section(closed, "##", "Details")[0]]
    found += [f"{finding}: details in the summary" for finding in re.findall(r"^### ([A-Z]+-\d+)$", summaries, re.M)]
    ids = re.findall(r"^\| \[([A-Z]+-\d+)\]", "".join(rows for rows, _ in groups.values()), re.M)
    found += [f"{finding}: two rows" for finding in sorted({i for i in ids if ids.count(i) > 1})]
    details = re.findall(r"^### ([A-Z]+-\d+)$", groups["Open"][1] + groups["Closed"][1], re.M)
    found += [f"{finding}: details with no row" for finding in sorted(set(details) - set(ids))]
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ledger", default=LEDGER)
    parser.add_argument("--closed", default=CLOSED)
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
    ledger_path, closed_path = Path(args.ledger), Path(args.closed)
    ledger, closed = ledger_path.read_text(), closed_path.read_text()
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
    had = set(problems(ledger_path.read_text(), closed_path.read_text()))
    found = problems(ledger, closed)
    new = [problem for problem in found if problem not in had]
    if new:
        sys.exit("Nothing written; the change would leave:\n" + "\n".join(new))
    ledger_path.write_text(ledger)
    closed_path.write_text(closed)
    if found:
        sys.exit("\n".join(found))


if __name__ == "__main__":
    main()
