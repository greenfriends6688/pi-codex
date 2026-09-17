#!/usr/bin/env bash
# 把 GitHub Release 列表从 0.0.1 重新编号（含历史版本），并可上传新一版源码包。
#
# 需要 token（只此一次）：https://github.com/settings/tokens → 勾 `repo`
#   export GITHUB_TOKEN=ghp_xxx
#
# 用法：
#   scripts/renumber-github-releases.sh plan      # 只打印映射，不改任何东西
#   scripts/renumber-github-releases.sh apply     # 应用（需二次确认）
#   scripts/renumber-github-releases.sh publish <zip路径> <notes文件>  # 新建一版并上传
set -euo pipefail

REPO="${REPO:-greenfriends6688/pi-codex}"
API="https://api.github.com/repos/$REPO"

# 旧 tag → 新 tag（时间从早到晚）
MAP=(
  "v0.9.1.1-rc.1:v0.0.1-rc.1"
  "v0.9.1.1:v0.0.1"
  "v0.9.1.2:v0.0.2"
  "v0.9.1.3:v0.0.3"
  "v0.9.1.4:v0.0.4"
  "v0.9.1.5:v0.0.5"
)

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "缺少 GITHUB_TOKEN（见脚本头部说明）" >&2
    exit 1
  fi
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" "$API$path" -d "$body"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" "$API$path"
  fi
}

list_ids() {
  curl -sS "$API/releases?per_page=100" |
    python3 -c 'import json,sys; [print(r["tag_name"], r["id"]) for r in json.load(sys.stdin)]'
}

case "${1:-plan}" in
  plan)
    echo "当前远端 release："; list_ids
    echo; echo "计划映射："
    for pair in "${MAP[@]}"; do printf '  %-16s → %s\n' "${pair%%:*}" "${pair##*:}"; done
    echo "  新一版（本次改动）         → v0.0.6"
    ;;
  apply)
    read -r -p "确认把上面的映射写入 GitHub Release？(yes/no) " ok
    [ "$ok" = "yes" ] || { echo 取消; exit 0; }
    for pair in "${MAP[@]}"; do
      old="${pair%%:*}"; new="${pair##*:}"
      id="$(list_ids | awk -v t="$old" '$1==t{print $2}')"
      [ -n "$id" ] || { echo "跳过（远端没有 $old）"; continue; }
      # 1) 改 release 的 tag（同时改显示名里的版本号）
      body="$(api GET "/releases/$id")"
      name="$(printf '%s' "$body" | python3 -c 'import json,sys; n=json.load(sys.stdin)["name"]; print(n.replace(sys.argv[1], sys.argv[2]))' "$old" "$new")"
      api PATCH "/releases/$id" "$(python3 -c 'import json,sys; print(json.dumps({"tag_name":sys.argv[1],"name":sys.argv[2]}))' "$new" "$name")" >/dev/null
      echo "release 改名：$old → $new（id $id）"
      # 2) 改本地/远端的 tag 指针（release 的 tag 名变了，旧 tag 需要重建）
      git tag "$new" "$old" 2>/dev/null || true
      git push origin "refs/tags/$new" 2>/dev/null || true
      git push origin ":refs/tags/$old" 2>/dev/null || true
    done
    echo "完成。检查：https://github.com/$REPO/releases"
    ;;
  publish)
    zip_path="${2:?用法: publish <zip路径> <notes文件>}"
    notes_file="${3:?用法: publish <zip路径> <notes文件>}"
    echo "先在本地打 tag v0.0.6 并推送：git tag v0.0.6 && git push origin v0.0.6"
    api POST /releases "$(python3 -c 'import json,sys; print(json.dumps({"tag_name":"v0.0.6","name":"Pi Codex v0.0.6","body":open(sys.argv[1]).read()}))' "$notes_file")" >/dev/null
    id="$(list_ids | awk '$1=="v0.0.6"{print $2}')"
    curl -sS -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Content-Type: application/zip" \
      "https://uploads.github.com/repos/$REPO/releases/$id/assets?name=$(basename "$zip_path")" \
      --data-binary @"$zip_path" >/dev/null
    echo "已发布 v0.0.6 + $(basename "$zip_path")"
    ;;
  *) echo "未知命令：$1"; exit 1 ;;
esac
