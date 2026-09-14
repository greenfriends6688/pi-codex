#!/usr/bin/env node
/**
 * dev / 生产 模式切换器
 *
 * 为什么需要它：`next dev`（Turbopack）和 `next build`（webpack）**共用同一个
 * `.next` 目录**，但两者的产物互不兼容。混用会表现为
 * "Failed to compile" 或浏览器里 "Module ... factory is not available" 的假故障。
 * 本脚本在切换模式前把不匹配的缓存挪走（挪到系统临时目录，不留在项目里）。
 *
 * 用法：
 *   node scripts/next-mode.mjs dev     # 清掉生产缓存 → next dev（改代码用）
 *   node scripts/next-mode.mjs prod    # 清掉 dev 缓存 → next build → next start（日常使用）
 *   node scripts/next-mode.mjs status  # 只看当前 .next 是什么模式
 */

import { existsSync, renameSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, ".next");
const HOST = "127.0.0.1";
const PORT = "30141";

/** 生产构建会写 BUILD_ID；dev（Turbopack）会写 dev/ 子目录。 */
function currentMode() {
  if (!existsSync(NEXT_DIR)) return "empty";
  const isProd = existsSync(join(NEXT_DIR, "BUILD_ID"));
  const isDev = existsSync(join(NEXT_DIR, "dev"));
  if (isProd && !isDev) return "prod";
  if (isDev && !isProd) return "dev";
  if (isProd && isDev) return "mixed";
  return "unknown";
}

function stash(label) {
  if (!existsSync(NEXT_DIR)) return;
  const dest = join(tmpdir(), `.next-${label}-${Date.now()}`);
  renameSync(NEXT_DIR, dest);
  const mb = Math.round(statSync(dest).size / 1048576);
  console.log(`  已把旧的 .next 挪到 ${dest}`);
  console.log(`  （可随时删除；里面是 ${mb}MB 可重建的编译缓存）`);
}

const mode = process.argv[2];

if (mode === "status") {
  console.log(`.next 当前模式: ${currentMode()}`);
  process.exit(0);
}

if (mode === "dev") {
  const cur = currentMode();
  console.log(`[dev] 当前 .next: ${cur}`);
  if (cur === "prod" || cur === "mixed") stash("prod-cache");
  console.log("[dev] 启动 next dev ...");
  const r = spawnSync("next", ["dev", "-H", HOST, "-p", PORT], { stdio: "inherit", shell: false });
  process.exit(r.status ?? 1);
}

if (mode === "prod") {
  const cur = currentMode();
  console.log(`[prod] 当前 .next: ${cur}`);
  if (cur === "dev" || cur === "mixed") stash("dev-cache");

  console.log("[prod] 构建中 ...");
  const b = spawnSync("next", ["build", "--webpack"], { stdio: "inherit", shell: false });
  if (b.status !== 0) {
    console.error("[prod] 构建失败，未启动服务");
    process.exit(b.status ?? 1);
  }

  console.log(`[prod] 启动 next start（http://${HOST}:${PORT}）...`);
  const s = spawnSync("next", ["start", "-H", HOST, "-p", PORT], { stdio: "inherit", shell: false });
  process.exit(s.status ?? 1);
}

console.error("用法: node scripts/next-mode.mjs <dev|prod|status>");
process.exit(2);
