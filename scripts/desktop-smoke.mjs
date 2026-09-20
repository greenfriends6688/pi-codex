#!/usr/bin/env node
// FIX-06 — 桌面包冒烟检查（HTTP 侧）+ 需要人眼确认的清单。
//
// 背景：打包后的症状是「界面在、按钮点不动」。可自动化的部分都在 HTTP 层：
// 服务在不在、关键接口是不是 200、文件接口有没有因为 allow-list 变 403
// （包内 homedir/userData 与调试时不同时最容易出现），以及 SSE 能不能建立。
// Electron 窗口里的点击只能人工确认，所以脚本末尾打印一份清单。
//
// 用法：
//   node scripts/desktop-smoke.mjs                      # 默认 127.0.0.1:30141
//   node scripts/desktop-smoke.mjs --base http://127.0.0.1:51234 --cwd /path/to/project
//   node scripts/desktop-smoke.mjs --spawn              # 自己起 prod 服务再测（不建议在 CI 外使用）
// 退出码：0 = 全部通过；1 = 有接口不可用（会打印排查方向）。

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const base = readArg("--base", process.env.SMOKE_BASE_URL || "http://127.0.0.1:30141");
const cwd = readArg("--cwd", projectDir);
const shouldSpawn = process.argv.includes("--spawn");

const results = [];

async function check(label, path, init) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, { ...init, redirect: "manual" });
    const ok = response.status >= 200 && response.status < 400;
    results.push({ label, path, status: response.status, ok });
    return { ok, response };
  } catch (error) {
    results.push({ label, path, status: "ERR", ok: false, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, response: null };
  }
}

let server = null;
if (shouldSpawn) {
  server = spawn(process.execPath, [resolve(projectDir, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "30141"], {
    cwd: projectDir,
    stdio: "inherit",
  });
  // 等它起来；最多 60s。
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(base, { redirect: "manual" });
      if (response.status > 0) break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

console.log(`冒烟目标：${base}\n`);

await check("应用首页", "/");
await check("会话列表", "/api/sessions");
await check("运行中会话快照", "/api/agent/running");
await check("模型列表", "/api/models");
await check("定时任务列表", "/api/cron");
await check("文件索引（模糊搜索）", `/api/file-index?cwd=${encodeURIComponent(cwd)}&q=package`);
// 这一条是最关键的：包内 allow-list 若与调试环境不同，文件树会空白、且所有
// 依赖文件的按钮会静默无操作。403 就是那个信号。
await check("文件列目录（allow-list）", `/api/files/${encodeURIComponent(cwd)}?type=list`);
await check("Git 状态", `/api/git/status?cwd=${encodeURIComponent(cwd)}`);

// SSE：只验证响应头，不消费完流。
// 事件流是按会话挂的（/api/agent/<id>/events），所以先取一个真实会话 id。
{
  let sessionId = null;
  try {
    const list = await fetch(`${base}/api/sessions`, { redirect: "manual" }).then((r) => r.json());
    sessionId = list?.sessions?.[0]?.id ?? null;
  } catch {
    // 列表拿不到就不测这一条，下面的结果里会体现为"没有会话可测"。
  }
  if (!sessionId) {
    results.push({ label: "会话事件流（SSE）", path: "(无会话可测)", status: "skip", ok: true });
  } else {
    const path = `/api/agent/${encodeURIComponent(sessionId)}/events`;
    const { ok, response } = await check("会话事件流（SSE）", path);
    if (ok && response) {
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("text/event-stream")) {
        results.push({ label: "SSE content-type", path, status: type || "(空)", ok: false });
      }
      await response.body?.cancel().catch(() => {});
    }
  }
}

console.log("接口检查：");
for (const line of results) {
  const mark = line.ok ? "✓" : "✗";
  console.log(`  ${mark} ${String(line.status).padEnd(4)} ${line.label}  (${line.path})${line.error ? ` — ${line.error}` : ""}`);
}

const failed = results.filter((line) => !line.ok);
console.log("\n需要人工确认（脚本无法代替）：");
console.log("  1. 窗口能打开且不是白屏（白屏优先看主进程日志里的“缺少构建产物”）。");
console.log("  2. 发一句话能收到回复（否则看 /api/agent/* 与 SSE）。");
console.log("  3. 文件树能列目录、能打开一个文件（403 时对照上面的“文件列目录”一条）。");
console.log("  4. 终端 Tab 能起一个 shell 并执行 echo（失败多为 node-pty 的 ABI/执行位）。");
console.log("  5. 设置里的模型/Skills/MCP 面板能打开（失败多为 /api/* 404）。");
console.log("  6. 点几个按钮后回看主进程 stdout：出现 [pinkslab] blocked 开头的行，");
console.log("     说明那次点击被导航拦截吞掉了（这是“按钮无反应”的典型成因）。");

if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} 项接口检查失败。`);
  console.error("排查顺序：服务是否在跑 → .next 是否为 prod 构建 → .next/node_modules 是否注入 → allow-list 根目录是否包含目标 cwd。");
  console.error("可先跑：node scripts/verify-desktop-bundle.mjs");
  server?.kill("SIGTERM");
  process.exit(1);
}

console.log(`\n${results.length} 项接口检查全部通过。`);
server?.kill("SIGTERM");
