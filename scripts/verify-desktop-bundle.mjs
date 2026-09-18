#!/usr/bin/env node
// FIX-05 — 桌面打包产物硬门禁。
//
// 为什么需要它：`release/` 里的 `.app` 起不来时，用户看到的是「界面在、按钮点不动」，
// 而根因往往是打包流程漏了一步：没跑 `npm run build`、`.next/node_modules`
// 没注入、node-pty 二进制不对（ABI/执行位）、或者 `files` 排除表把必要文件剔了。
// 这些都能在**构建期**发现，没必要等到用户点按钮才发现。
//
// 用法：
//   node scripts/verify-desktop-bundle.mjs              # 校验当前工作区的打包前置条件
//   node scripts/verify-desktop-bundle.mjs --app <dir>  # 额外校验一个已打出的 .app
// 退出码：0 = 通过，1 = 有硬错误（打印具体缺什么、怎么修）。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];
const passes = [];

/** serverExternalPackages：这些包被 Next 外部化，必须能随产物一起走。 */
const EXTERNAL_PACKAGES = [
  "node-pty",
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
];

function fail(message, hint) {
  failures.push(hint ? `${message}\n    → ${hint}` : message);
}

function pass(message) {
  passes.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(execFileSync("cat", [path], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. 构建产物
// ---------------------------------------------------------------------------
const nextDir = join(projectDir, ".next");
if (!existsSync(nextDir)) {
  fail(
    "缺少 .next 构建产物",
    "先跑 `npm run build`（或 `npm run prod`，脚本会自动处理 dev/prod 缓存切换）",
  );
} else {
  const hasServerApp = existsSync(join(nextDir, "server", "app"));
  if (!hasServerApp) {
    fail(
      ".next/server/app 不存在，构建产物不完整",
      "删除 .next 后重新 `npm run build`（dev 与 prod 的产物不兼容，混用会得到半残的服务）",
    );
  } else {
    pass(".next/server/app 存在（生产构建）");
  }
  if (existsSync(join(nextDir, "dev", "lock"))) {
    fail(
      ".next 里残留 dev 模式产物（.next/dev）",
      "用 `npm run prod` 启动，它会先把不匹配的缓存挪走；不要直接 next build + next start 混用",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. 外部化依赖（serverExternalPackages）
// ---------------------------------------------------------------------------
const externalsDir = join(nextDir, "node_modules");
const externalsPresentAtBuild = existsSync(externalsDir);
if (!externalsPresentAtBuild) {
  // 这个仓库的 `npm run build` 走 `next build --webpack`：webpack 路径会把
  // serverExternalPackages 直接打进入口 bundle，而不是外部化成 .next/node_modules
  // 符号链接。此时 afterPack 的注入是无操作（脚本自身也有"为空则跳过"分支），
  // 所以这里只提示、不拦截——真出现 MODULE_NOT_FOUND 时再回头看这一行。
  warn(
    "没有 .next/node_modules：当前构建未把外部依赖外部化（webpack 路径会内联它们）。afterPack 注入将跳过，这属于预期",
  );
} else {
  const present = new Set(readdirSync(externalsDir));
  const missing = EXTERNAL_PACKAGES.filter(
    (pkg) => ![...present].some((entry) => entry === pkg || entry.startsWith(`${pkg}-`)),
  );
  if (missing.length > 0) {
    fail(
      `.next/node_modules 缺少外部化依赖：${missing.join(", ")}`,
      "这是「打包后部分按钮失效」的典型原因：node-pty/undici/pi SDK 缺失会让终端、SSE、会话接口在包里静默失败",
    );
  } else {
    pass(`.next/node_modules 含全部 ${EXTERNAL_PACKAGES.length} 个外部化依赖`);
  }
}

// ---------------------------------------------------------------------------
// 3. node-pty 原生二进制（ABI + 执行位）
// ---------------------------------------------------------------------------
const ptyDir = join(projectDir, "node_modules", "node-pty");
if (!existsSync(ptyDir)) {
  fail("node_modules/node-pty 不存在", "跑 `npm install`；终端面板依赖它");
} else {
  const builds = join(ptyDir, "build", "Release");
  const hasBinding = existsSync(join(builds, "pty.node")) || existsSync(join(builds, "conpty.node"));
  if (!hasBinding) {
    warn(
      "node-pty 未找到 build/Release/*.node：若产物里终端不可用，需要为 Electron 的 Node ABI 重建（electron-rebuild），Dev 模式下可能本来就没构建",
    );
  } else {
    pass("node-pty 原生二进制存在");
  }
  const spawnHelpers = existsSync(builds)
    ? readdirSync(builds).filter((name) => name.startsWith("spawn-helper"))
    : [];
  const notExecutable = spawnHelpers.filter((name) => {
    try {
      return (statSync(join(builds, name)).mode & 0o111) === 0;
    } catch {
      return true;
    }
  });
  if (notExecutable.length > 0) {
    fail(
      `node-pty 的 spawn-helper 缺少可执行位：${notExecutable.join(", ")}`,
      "electron-builder 重建 node_modules 后会丢执行位；CI 上必现（可参考 bin/prepare-terminal.js）",
    );
  } else if (spawnHelpers.length > 0) {
    pass("node-pty spawn-helper 可执行位正常");
  }
}

// ---------------------------------------------------------------------------
// 4. package.json 的打包配置
// ---------------------------------------------------------------------------
const pkg = readJson(join(projectDir, "package.json"));
if (!pkg?.build) {
  fail("package.json 缺少 build 段", "electron-builder 配置缺失，无法打包");
} else {
  const targets = pkg.build?.mac?.target ?? [];
  if (!targets.includes("dmg") || !targets.includes("zip")) {
    warn(
      `mac.target = ${JSON.stringify(targets)}：未同时包含 dmg 与 zip。zip 是自动更新（latest-mac.yml）的前提`,
    );
  } else {
    pass("mac.target 含 dmg + zip");
  }
  if (!pkg.build.afterPack) {
    fail(
      "package.json build 段缺少 afterPack",
      "没有 afterPack 就不会注入 .next/node_modules，产物里的服务会半残",
    );
  } else {
    pass("afterPack 钩子已配置");
  }
}

// ---------------------------------------------------------------------------
// 5. 可选：校验已打出的 .app
// ---------------------------------------------------------------------------
const appIndex = process.argv.indexOf("--app");
if (appIndex !== -1) {
  const appPath = process.argv[appIndex + 1];
  if (!appPath) {
    fail("--app 后面需要跟一个 .app 路径");
  } else {
    const resources = join(resolve(appPath), "Contents", "Resources", "app");
    if (!existsSync(resources)) {
      fail(
        `${appPath} 里找不到 Contents/Resources/app`,
        "asar:false 时项目会被平铺到该目录；找不到说明打包配置与预期不符",
      );
    } else {
      const injected = join(resources, ".next", "node_modules");
      if (!existsSync(injected) && externalsPresentAtBuild) {
        // 只有"构建期确实有外部化产物"时，产物里缺失才是硬错误。
        fail(
          "产物里缺少 .next/node_modules，但构建期存在（afterPack 没有生效）",
          "这是打包后 /api/terminal、SSE、会话接口失效的直接原因",
        );
      } else if (existsSync(injected)) {
        pass("产物含注入后的 .next/node_modules");
      } else {
        warn("产物里没有 .next/node_modules（构建期也没有，属预期）");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
for (const line of passes) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
if (failures.length > 0) {
  console.error("\n打包前置条件未满足：");
  for (const line of failures) console.error(`  ✗ ${line}`);
  console.error(`\n共 ${failures.length} 项硬错误、${warnings.length} 项提示。`);
  process.exit(1);
}
console.log(`\n打包前置条件全部通过（${passes.length} 项检查，${warnings.length} 项提示）。`);
