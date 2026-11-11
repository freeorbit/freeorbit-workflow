"""List direct deps of workspace crates that are behind the newest crates.io version.

Used instead of `cargo outdated`, which reports nothing for this workspace's
inherited (`dep.workspace = true`) dependencies. Run with `python3 -I`, passing
the scan folder and `cargo metadata --format-version 1 --locked` JSON on stdin.
"""

import json
import re
import subprocess
import sys

scan = sys.argv[1]
meta = json.load(sys.stdin)
members = set(meta["workspace_members"])
packages = {p["id"]: p for p in meta["packages"]}

# The versions each workspace crate actually resolves to, so a second copy
# pulled in by another crate does not hide an old direct one.
direct = {}
for node in meta["resolve"]["nodes"]:
    if node["id"] not in members:
        continue
    for dep in node["deps"]:
        pkg = packages[dep["pkg"]]
        if (pkg["source"] or "").startswith("registry"):
            direct.setdefault(pkg["name"], set()).add(pkg["version"])

behind = []
# A search that fails, such as with no network, says nothing about the
# version, so it is reported on its own rather than as behind.
failed = []
for name in sorted(direct):
    search = subprocess.run(["cargo", "search", name, "--limit", "1"], capture_output=True, text=True)
    if search.returncode != 0:
        why = (search.stderr.strip().splitlines() or [f"exit {search.returncode}"])[-1]
        failed.append(f"{name}\t{why}")
        continue
    match = re.match(rf'^{re.escape(name)} = "([^"]+)"', search.stdout)
    latest = match.group(1) if match else "?"
    if latest not in direct[name]:
        behind.append(f"{name}\tlocked {','.join(sorted(direct[name]))}\tlatest {latest}")

with open(f"{scan}/direct-outdated.txt", "w") as out:
    out.write("# Direct deps behind the newest crates.io version (cargo metadata + cargo search)\n")
    out.write("\n".join(behind) + "\n")
    if failed:
        out.write("\n# Searches that failed, so these deps were not checked\n")
        out.write("\n".join(failed) + "\n")
print(f"{len(direct)} direct deps, {len(behind)} behind" + (f", {len(failed)} not checked: cargo search failed" if failed else ""))
