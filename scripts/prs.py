"""Builds site/prs.json: open AnyPS5 pull requests and the system functions each one implements.

A function counts as implemented by a PR when the PR adds a definition `APS5_VABI <name>(` outside a stub
(a stub calls NotImplemented), or removes the stub of that function from an Export.cpp file.
"""
import json
import os
import re
import sys
import time
import urllib.request

UPSTREAM = os.environ.get("ANYPS5_REPO", "boykopovar/AnyPS5")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
OUT = sys.argv[1] if len(sys.argv) > 1 else "site/prs.json"
LIMIT = int(os.environ.get("PRS_LIMIT", "300"))
DEF = re.compile(r"APS5_VABI\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
LIB = re.compile(r"core/libs/prx/([^/]+)/")
SUFFIX = "_nid_postfix"


def clean(name):
    return name[:-len(SUFFIX)] if name.endswith(SUFFIX) else name


def get(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "anyps5-compat"}
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        link = r.headers.get("Link", "")
        data = json.load(r)
    nxt = re.search(r'<([^>]+)>;\s*rel="next"', link)
    return data, (nxt.group(1) if nxt else None)


def paged(url):
    while url:
        data, url = get(url)
        yield from data


def functions_of(files):
    added, stubbed_added, removed_stubs, libs = set(), set(), set(), set()
    for f in files:
        name = f.get("filename", "")
        if "/tests/" in name or "/test/" in name or not name.endswith((".cpp", ".cc", ".c", ".hpp", ".h")):
            continue
        m = LIB.search(name)
        patch = f.get("patch") or ""
        if not patch:
            continue
        lines = patch.splitlines()
        for i, line in enumerate(lines):
            d = DEF.search(line)
            if not d or line.startswith("@@") or line.rstrip().endswith(";"):
                continue  # not a definition (hunk header or declaration)
            body = "\n".join(lines[i + 1:i + 4])
            stub = "NotImplemented" in body
            if line.startswith("+"):
                (stubbed_added if stub else added).add(clean(d.group(1)))
                if m and not stub:
                    libs.add(m.group(1))
            elif line.startswith("-") and stub and name.endswith("Export.cpp"):
                removed_stubs.add(clean(d.group(1)))
                if m:
                    libs.add(m.group(1))
    return sorted((added | removed_stubs) - stubbed_added), sorted(libs)


def main():
    prs = []
    base = f"https://api.github.com/repos/{UPSTREAM}"
    for n, pr in enumerate(paged(f"{base}/pulls?state=open&per_page=100")):
        if n >= LIMIT:
            break
        try:
            files = list(paged(f"{base}/pulls/{pr['number']}/files?per_page=100"))
        except Exception as e:  # noqa: BLE001
            print(f"#{pr['number']}: {e}")
            continue
        funcs, libs = functions_of(files)
        if not funcs:
            continue
        prs.append({"number": pr["number"], "title": pr["title"], "url": pr["html_url"], "user": pr["user"]["login"],
                    "draft": pr.get("draft", False), "updated": pr["updated_at"], "head": pr["head"]["sha"][:9],
                    "libraries": libs, "functions": funcs})
    data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "repo": UPSTREAM, "prs": prs}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{len(prs)} pull requests with functions written to {OUT}")


if __name__ == "__main__":
    main()
