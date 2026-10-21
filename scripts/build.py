"""Builds site/compat.json from the report issues and keeps a status label on each issue."""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "Techx3/AnyPS5-Compat")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
OUT = sys.argv[1] if len(sys.argv) > 1 else "site/compat.json"
TITLE = re.compile(r"^\[([A-Za-z0-9_.-]+)\]\s*(.*)$")
BLOCK = re.compile(r"<!-- anyps5-report\s*\n(.*?)\n-->", re.S)
ORDER = ["convert", "nothing", "boots", "ingame", "playable"]
LABELS = {
    "convert": ("status: does not convert", "6e7681"),
    "nothing": ("status: does not boot", "d73a4a"),
    "boots": ("status: boots", "e99695"),
    "ingame": ("status: in game", "fbca04"),
    "playable": ("status: playable", "2ea043"),
}


def api(path, method="GET", data=None):
    url = path if path.startswith("http") else f"https://api.github.com{path}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "anyps5-compat"}
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, body, headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode()
        link = r.headers.get("Link", "")
    nxt = re.search(r'<([^>]+)>;\s*rel="next"', link)
    return (json.loads(text) if text else None), (nxt.group(1) if nxt else None)


def paged(path):
    url = path
    while url:
        page, url = api(url)
        yield from page


def reports_in(text, author, url, created):
    out = []
    for m in BLOCK.finditer(text or ""):
        try:
            r = json.loads(m.group(1))
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get("status") not in ORDER:
            continue
        r["_by"] = author
        r["_url"] = url
        r["_created"] = created
        out.append(r)
    return out


def ensure_labels():
    try:
        have = {l["name"] for l in paged(f"/repos/{REPO}/labels?per_page=100")}
    except urllib.error.HTTPError:
        return False
    for name, color in LABELS.values():
        if name not in have:
            try:
                api(f"/repos/{REPO}/labels", "POST", {"name": name, "color": color})
            except urllib.error.HTTPError:
                return False
    return True


def set_label(issue, status):
    want = LABELS[status][0]
    current = [l["name"] for l in issue.get("labels", [])]
    if want in current and not any(c != want and c.startswith("status: ") for c in current):
        return
    keep = [c for c in current if not c.startswith("status: ")] + [want]
    try:
        api(f"/repos/{REPO}/issues/{issue['number']}/labels", "PUT", {"labels": keep})
    except urllib.error.HTTPError as e:
        print(f"label #{issue['number']}: {e}")


def main():
    labels_ok = ensure_labels()
    games = []
    missing_count = {}
    for issue in paged(f"/repos/{REPO}/issues?state=all&per_page=100"):
        if "pull_request" in issue:
            continue
        m = TITLE.match(issue["title"])
        if not m:
            continue
        reps = reports_in(issue.get("body"), issue["user"]["login"], issue["html_url"], issue["created_at"])
        if issue.get("comments"):
            for c in paged(f"/repos/{REPO}/issues/{issue['number']}/comments?per_page=100"):
                reps += reports_in(c.get("body"), c["user"]["login"], c["html_url"], c["created_at"])
        if not reps:
            continue
        reps.sort(key=lambda r: r.get("time") or r["_created"])
        last = reps[-1]
        best = max(reps, key=lambda r: (ORDER.index(r["status"]), r.get("time") or ""))
        for rec in last.get("missing", []):
            if rec.get("class") != "absent":
                continue
            key = (rec.get("lib", ""), rec.get("name") or rec.get("nid", ""))
            missing_count.setdefault(key, set()).add(m.group(1))
        games.append({
            "title_id": m.group(1),
            "name": last.get("name") or m.group(2),
            "issue": issue["number"],
            "url": issue["html_url"],
            "status": last["status"],
            "best": best["status"],
            "best_version": best.get("anyps5", {}).get("version", ""),
            "reports": len(reps),
            "testers": len({r["_by"] for r in reps}),
            "updated": last.get("time") or last["_created"],
            "anyps5": last.get("anyps5", {}),
            "console": last.get("console", ""),
            "game_version": last.get("game_version", ""),
            "minutes": round(last.get("seconds", 0) / 60, 1),
            "exit_code": last.get("exit_code"),
            "closed_by_user": last.get("closed_by_user", False),
            "os": last.get("os", ""),
            "gpu": last.get("gpu", ""),
            "absent": last.get("absent", 0),
            "stub": last.get("stub", 0),
            "missing_libs": last.get("missing_libs", 0),
            "missing": [x for x in last.get("missing", []) if x.get("class") == "absent"][:30],
            "stop": last.get("stop"),
            "log_tail": last.get("log_tail", [])[-15:],
            "report_url": last["_url"],
        })
        if labels_ok:
            set_label(issue, last["status"])
    games.sort(key=lambda g: g["name"].lower())
    top = sorted(({"lib": k[0], "name": k[1], "games": len(v)} for k, v in missing_count.items()),
                 key=lambda x: (-x["games"], x["lib"], x["name"]))[:40]
    data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "repo": REPO,
            "counts": {s: sum(1 for g in games if g["status"] == s) for s in ORDER},
            "games": games, "top_missing": top}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{len(games)} games written to {OUT}")


if __name__ == "__main__":
    main()
