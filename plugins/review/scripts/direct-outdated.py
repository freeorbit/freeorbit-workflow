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
for name in sorted(direct):
    found = subprocess.run(["cargo", "search", name, "--limit", "1"], capture_output=True, text=True).stdout
    match = re.match(rf'^{re.escape(name)} = "([^"]+)"', found)
    latest = match.group(1) if match else "?"
    if latest not in direct[name]:
        behind.append(f"{name}\tlocked {','.join(sorted(direct[name]))}\tlatest {latest}")

with open(f"{scan}/direct-outdated.txt", "w") as out:
    out.write("# Direct deps behind the newest crates.io version (cargo metadata + cargo search)\n")
    out.write("\n".join(behind) + "\n")
print(f"{len(direct)} direct deps, {len(behind)} behind")
