#!/usr/bin/env node
/**
 * BoardUI 上游同步检查（fork:ds-boardui-sync / DS-01）
 * ---------------------------------------------------------------------------
 * 本项目把 BoardUI 的几个文件 vendored 进了仓库（MIT）。直接 `git diff` 比它们是
 * 噪音：本仓是 CRLF、上游是 LF，于是每个文件都显示“全改了”。这个脚本先去换行
 * 归一化再比，只报真正的差异。
 *
 *   node scripts/boardui-sync.mjs            # 下载上游快照并比对（人读的输出）
 *   node scripts/boardui-sync.mjs --check    # 只比对，有漂移就 exit 1（给门禁用）
 *   node scripts/boardui-sync.mjs --upstream <dir>   # 用本地克隆当上游（离线）
 *
 * 另外它还会校验 app/boardui/globals-subset.css 的“子集契约”：该文件里用到的
 * 每个关键帧/类，上游 styles/globals.css 里必须仍然存在（改名的漂移会被抓到）。
 */
import { mkdir, readFile, writeFile, stat } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fsp = { mkdir: promisify(mkdir), readFile: promisify(readFile), writeFile: promisify(writeFile), stat: promisify(stat) };

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(tmpdir(), "boardui-upstream");
const REPO_SLUG = "BoardUI/boardui";
const REF = process.env.BOARDUI_REF || "main";

/** vendored 文件映射：上游路径 → 本仓路径 */
const FILES = [
  ["styles/theme.css", "app/boardui/theme.css"],
  ["styles/typography.css", "app/boardui/typography.css"],
  ["utils/cx.ts", "utils/cx.ts"],
];

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const upstreamArg = args.includes("--upstream") ? args[args.indexOf("--upstream") + 1] : null;

/** 归一化：CRLF→LF、去掉行尾空白、去掉末尾多余空行 */
function normalize(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

async function readUpstream(rel) {
  if (upstreamArg) {
    return fsp.readFile(join(resolve(upstreamArg), rel), "utf8");
  }
  const cachePath = join(CACHE, REF, rel.replace(/\//g, "__"));
  try {
    const cached = await fsp.readFile(cachePath, "utf8");
    if (cached.length > 0) return cached;
  } catch {
    /* 未缓存，下面去下载 */
  }
  const url = `https://raw.githubusercontent.com/${REPO_SLUG}/${REF}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  await fsp.mkdir(dirname(cachePath), { recursive: true });
  await fsp.writeFile(cachePath, text, "utf8");
  return text;
}

function diffLines(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const out = [];
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i += 1) {
    const x = la[i];
    const y = lb[i];
    if (x !== y) out.push({ line: i + 1, upstream: x ?? "<<EOF>>", local: y ?? "<<EOF>>" });
  }
  return out;
}

let drifted = 0;
const report = [];

for (const [upstreamRel, localRel] of FILES) {
  const local = normalize(await fsp.readFile(join(REPO, localRel), "utf8"));
  let upstream;
  try {
    upstream = normalize(await readUpstream(upstreamRel));
  } catch (error) {
    report.push({ file: localRel, status: "无法获取上游", detail: String(error.message ?? error) });
    drifted += 1;
    continue;
  }
  const diffs = diffLines(upstream, local);
  if (diffs.length === 0) {
    report.push({ file: localRel, status: "一致", detail: `${local.split("\n").length} 行` });
  } else {
    drifted += 1;
    report.push({ file: localRel, status: `有差异（${diffs.length} 行）`, detail: diffs.slice(0, 6) });
  }
}

// 子集契约：globals-subset.css 里用到的 @keyframes / 类名，上游 globals.css 必须仍有
let subset = { file: "app/boardui/globals-subset.css", status: "未检查", detail: "" };
try {
  const localSubset = await fsp.readFile(join(REPO, "app/boardui/globals-subset.css"), "utf8");
  const upstreamGlobals = await readUpstream("styles/globals.css");
  const keys = new Set();
  for (const m of localSubset.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)) keys.add(m[1]);
  for (const m of localSubset.matchAll(/animation-name:\s*([a-zA-Z0-9_-]+)/g)) keys.add(m[1]);
  for (const m of localSubset.matchAll(/animation:\s*([a-zA-Z0-9_-]+)/g)) keys.add(m[1]);
  for (const m of localSubset.matchAll(/^\s*\.((?:bui|agent|t-|animate|lg-|landing)[a-zA-Z0-9_-]*)/gm)) keys.add(m[1]);
  const missing = [...keys].filter((key) => !upstreamGlobals.includes(key) && !localSubset.includes(`.${key}`) === false);
  const reallyMissing = missing.filter((key) => !upstreamGlobals.includes(key));
  if (reallyMissing.length > 0) {
    drifted += 1;
    subset = {
      file: subset.file,
      status: `子集契约破裂（${reallyMissing.length} 项上游已找不到）`,
      detail: reallyMissing.join(", "),
    };
  } else {
    subset = { file: subset.file, status: "子集契约成立", detail: `${keys.size} 个符号在上游仍存在` };
  }
} catch (error) {
  subset = { file: subset.file, status: "无法校验子集", detail: String(error.message ?? error) };
}

if (checkOnly) {
  if (drifted === 0) {
    console.log(`[boardui-sync] OK —— ${FILES.length} 个 vendored 文件与上游 ${REPO_SLUG}@${REF} 一致；${subset.status}`);
    process.exit(0);
  }
  console.error(`[boardui-sync] FAIL —— ${drifted} 处漂移：`);
  for (const entry of [...report, subset]) {
    console.error(`  - ${entry.file}: ${entry.status}`);
    if (Array.isArray(entry.detail)) {
      for (const d of entry.detail) console.error(`      L${d.line}\n        up: ${d.upstream}\n        my: ${d.local}`);
    } else if (entry.detail) {
      console.error(`      ${entry.detail}`);
    }
  }
  process.exit(1);
}

console.log(`[boardui-sync] 上游 ${REPO_SLUG}@${REF}${upstreamArg ? `（本地 ${upstreamArg}）` : "（raw.githubusercontent，带缓存）"}`);
for (const entry of [...report, subset]) {
  console.log(`\n${entry.file}: ${entry.status}`);
  if (Array.isArray(entry.detail)) {
    for (const d of entry.detail) {
      console.log(`  L${d.line}\n    up: ${d.upstream}\n    my: ${d.local}`);
    }
    console.log("  （只列前 6 行）");
  } else if (entry.detail) {
    console.log(`  ${entry.detail}`);
  }
}
console.log(`\n结论：${drifted === 0 ? "无漂移" : `${drifted} 处漂移 —— 先确认是有意改动，再决定是否回写上游版本`}`);
process.exit(drifted === 0 ? 0 : checkOnly ? 1 : 0);
