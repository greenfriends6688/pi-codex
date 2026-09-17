#!/usr/bin/env python3
"""把 GitHub Release 列表重新编号（含历史版本），并可发布新一版源码包。

需要 token（只此一次）：https://github.com/settings/tokens → 勾 `repo`
    export GITHUB_TOKEN=ghp_xxx

用法：
    scripts/renumber-github-releases.py plan
    scripts/renumber-github-releases.py apply            # 需二次确认
    scripts/renumber-github-releases.py publish <zip> <notes.md> <version>
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request

REPO = os.environ.get("REPO", "greenfriends6688/pi-codex")

# 旧 tag → 新 tag（时间从早到晚）
MAP = [
    ("v0.9.1.1-rc.1", "v0.0.1-rc.1"),
    ("v0.9.1.1", "v0.0.1"),
    ("v0.9.1.2", "v0.0.2"),
    ("v0.9.1.3", "v0.0.3"),
    ("v0.9.1.4", "v0.0.4"),
    ("v0.9.1.5", "v0.0.5"),
]


def api(method: str, path: str, payload: dict | None = None, absolute: str | None = None):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        sys.exit("缺少 GITHUB_TOKEN（见文件头说明）")
    url = absolute or f"https://api.github.com/repos/{REPO}{path}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request) as response:
        body = response.read()
        return json.loads(body) if body else {}


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def releases_by_tag() -> dict[str, dict]:
    return {r["tag_name"]: r for r in api("GET", "/releases?per_page=100")}


def tag_commit(tag: str) -> str:
    obj = api("GET", f"/git/ref/tags/{tag}")["object"]
    # annotated tags point at a tag object, which points at the commit
    return api("GET", f"/git/tags/{obj['sha']}")["object"]["sha"] if obj["type"] == "tag" else obj["sha"]


def renumber(rewrite_version_strings: bool) -> None:
    releases = releases_by_tag()
    # longest first, so v0.9.1.1-rc.1 is rewritten before v0.9.1.1
    longest_first = sorted([old for old, _ in MAP], key=len, reverse=True)
    new_tag = dict(MAP)

    def rewrite(text: str | None) -> str | None:
        if not text or not rewrite_version_strings:
            return text
        for old in longest_first:
            text = text.replace(old, new_tag[old])
        return text

    for old, new in MAP:
        release = releases.get(old)
        if not release:
            print(f"跳过 {old}：远端没有这个 release")
            continue
        sha = tag_commit(old)
        # 新 tag 必须先存在：否则 PATCH release 时 GitHub 会把新 tag 建到默认分支头上
        git("tag", "-f", "-a", new, sha, "-m", f"Pi Codex {new}")
        push = git("push", "-q", "origin", f"refs/tags/{new}")
        api("PATCH", f"/releases/{release['id']}", {
            "tag_name": new,
            "name": rewrite(release["name"]),
            "body": rewrite(release["body"]),
        })
        for asset in release["assets"]:
            if old in asset["name"]:
                api("PATCH", f"/releases/assets/{asset['id']}", {"name": asset["name"].replace(old, new)})
        git("push", "-q", "origin", f":refs/tags/{old}")
        git("tag", "-d", old)
        print(f"{old} → {new}  (tag {sha[:8]}, push={'ok' if push.returncode == 0 else push.stderr.strip()[:60]})")


def publish(zip_path: str, notes_path: str, version: str) -> None:
    tag = version if version.startswith("v") else f"v{version}"
    head = git("rev-parse", "HEAD").stdout.strip()
    git("tag", "-f", "-a", tag, head, "-m", f"Pi Codex {tag}")
    git("push", "-q", "origin", f"refs/tags/{tag}")
    body = open(notes_path, encoding="utf-8").read()
    release = api("POST", "/releases", {"tag_name": tag, "name": f"Pi Codex {tag}", "body": body})
    print("release:", release["html_url"])
    blob = open(zip_path, "rb").read()
    name = os.path.basename(zip_path)
    request = urllib.request.Request(
        f"https://uploads.github.com/repos/{REPO}/releases/{release['id']}/assets?name={name}",
        data=blob,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Content-Type": "application/zip",
            "Content-Length": str(len(blob)),
        },
    )
    with urllib.request.urlopen(request) as response:
        uploaded = json.loads(response.read())
    print(f"asset: {uploaded['name']} {round(uploaded['size'] / 1048576, 1)}MB state={uploaded['state']}")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if command == "plan":
        for tag, release in releases_by_tag().items():
            print(f"  {tag:16} id={release['id']}  assets={len(release['assets'])}")
        print("\n计划映射：")
        for old, new in MAP:
            print(f"  {old:16} → {new}")
    elif command == "apply":
        answer = input("确认改号并同步远端 tag？(yes/no) ")
        if answer.strip() != "yes":
            sys.exit("取消")
        renumber(True)
    elif command == "publish":
        publish(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(f"未知命令：{command}")


if __name__ == "__main__":
    main()
