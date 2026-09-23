#!/usr/bin/env node
/**
 * fork:zn-23 — 发 GitHub Release 并上传 source zip。
 *
 * 为什么单独一个脚本：仓库既有的 `docs/release.md` 写的是「用 gh CLI」，
 * 但本机没装 gh，而且 **`github.com` 的 HTTPS 直连超时**（`api.github.com` 通），
 * 所以 `gh release create` 那条路走不通。这个脚本只用 `api.github.com` +
 * `uploads.github.com`，两个域名实测都通。
 *
 * 用法：
 *   export GITHUB_TOKEN=ghp_xxx      # 勾 `repo` 权限，见 scripts/renumber-github-releases.py 文件头
 *   node scripts/publish-release.mjs --version=0.1.5-beta.3
 *
 * 可选：
 *   --repo=owner/name     默认 greenfriends6688/pinkslab
 *   --notes-file=path     release 正文，默认读 docs/release-notes-<version>.md
 *   --dry-run             只打包、只打印，不发请求
 *
 * 幂等：同名 release / 同名 asset 已存在时**复用/覆盖**，不报错也不重复建。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=") || "true"];
    }),
);

const version = args.version;
if (!version) {
  console.error("缺 --version=<x.y.z[-pre]>（不带前导 v）");
  process.exit(2);
}
const repo = args.repo ?? "greenfriends6688/pinkslab";
const tag = `v${version}`;
const dryRun = args["dry-run"] === "true";
const token = process.env.GITHUB_TOKEN;

const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pinkslab-release",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body };
}

/* 1. 打包：`git archive` 只收 tracked 文件，node_modules / .next / 参考项目自动排除。
      比手写 exclude 列表可靠 —— 后者漏一个就是把 66M 的「设计风格」打进发布包。 */
function buildZip() {
  const out = join(tmpdir(), `pinkslab-source-${tag}.zip`);
  execFileSync("git", ["archive", "--format=zip", "-9", "-o", out, tag], { stdio: "inherit" });
  const size = statSync(out).size;
  console.log(`  打包 ${basename(out)}  ${(size / 1024 / 1024).toFixed(1)} MB`);
  return out;
}

/* 2. 正文：默认读 docs/release-notes-<version>.md；没有就退化成一行。 */
function releaseNotes() {
  const file = args["notes-file"] ?? `docs/release-notes-${version}.md`;
  if (existsSync(file)) return readFileSync(file, "utf8");
  return `# Pinkslab ${tag}\n\n（没有 ${file}，这里是占位正文）`;
}

async function main() {
  console.log(`release ${tag} → ${repo}`);
  const zip = buildZip();
  const body = releaseNotes();

  if (dryRun) {
    console.log("--dry-run：到此为止，未发请求");
    console.log(`  正文 ${body.length} 字符`);
    return;
  }
  if (!token) {
    console.error("缺 GITHUB_TOKEN（见本文件头）");
    process.exit(2);
  }

  // 3. 建 release（已存在就复用）
  let release = (await api(`/repos/${repo}/releases/tags/${tag}`)).body;
  if (release?.id) {
    console.log(`  release 已存在（id=${release.id}），复用`);
  } else {
    const created = await api(`/repos/${repo}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: `Pinkslab ${tag}`,
        body,
        draft: false,
        prerelease: version.includes("-"),
      }),
    });
    if (!created.ok) {
      console.error(`  建 release 失败 ${created.status}:`, created.body);
      process.exit(1);
    }
    release = created.body;
    console.log(`  已建 release（id=${release.id}，prerelease=${release.prerelease}）`);
  }

  // 4. 上传 asset（同名先删再传，避免 422）
  const name = basename(zip);
  const existing = (release.assets ?? []).find((a) => a.name === name);
  if (existing) {
    await api(`/repos/${repo}/releases/assets/${existing.id}`, { method: "DELETE" });
    console.log(`  已删同名 asset（id=${existing.id}）`);
  }
  const data = readFileSync(zip);
  const upload = await fetch(
    `${UPLOADS}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/zip",
        "Content-Length": String(data.length),
        "User-Agent": "pinkslab-release",
      },
      body: data,
    },
  );
  if (!upload.ok) {
    console.error(`  上传失败 ${upload.status}:`, (await upload.text()).slice(0, 300));
    process.exit(1);
  }
  const asset = await upload.json();
  console.log(`  已上传 ${asset.name}（${(asset.size / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`  ${asset.browser_download_url}`);
}

await main();
