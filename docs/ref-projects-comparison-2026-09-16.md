# 四个参考项目对比与可借鉴清单

分析日期：2026-09-16
分析对象：`参考项目/` 下的 4 个仓库
基准项目：本仓库（`@agegr/pi-web` 0.9.1 · Codex Style fork）

> 本文与既有的 [`fork-comparison-2026-09-16.md`](./fork-comparison-2026-09-16.md) 互补。
> 那份文档只覆盖了 pi-web-main / pi-web-desktop-main 两个「同血缘」项目；
> 本文补齐 **mcode-master** 与 **MusePi-main** 两个「异血缘」项目，
> 并补齐既有文档中与代码不符的两处结论（见 §8）。
>
> **第三个配套文档**：[`desktop-ui-borrowing-plan-2026-09-16.md`](./desktop-ui-borrowing-plan-2026-09-16.md)
> —— 那份只聚焦 `pi-web-desktop-main` 一个仓库，且只谈**样式 / 布局 / 功能**三面的深度对比
> 与 22 个可独立落地的 PR（本文对 desktop 的 UI 部分较薄，那部分以那份为准）。

---

## 1. 基线快照：本仓库现状

| 维度 | 现状 |
| --- | --- |
| 版本 | `@agegr/pi-web` **0.9.1**，Codex Style fork |
| 框架 | Next.js **16.3.1** App Router + Turbopack，React 19.2，Tailwind 4.2 |
| 构建 | `next build --webpack`，dev/prod 共用 `.next`（`scripts/next-mode.mjs` 兜底切换） |
| 规模 | `lib/` 130+、`components/` 50+、`hooks/` 11、`app/api` **56 个路由**、**191 个 `.test.mjs`** |
| 样式 | `app/globals.css` **2433 行 / 249 个 CSS 变量**，Codex skin 覆盖 6 套色板 |
| 主题 | `lib/theme.ts` 仅 **22 行**（只有色板 ID + 首屏注入脚本），实现全在 CSS |
| 桌面端 | **无 `electron/` 目录**（历史上曾剔除，见 §7） |
| 版本控制 | **当前工作副本不是 git 仓库**（无 `.git`，见 §7） |
| 独有能力 | 终端（xterm + node-pty）、MCP 面板、Web Push、Provider 用量、Markdown WYSIWYG（ProseMirror）、内嵌 subagent、Browser 面板、3 语 i18n |

关键文件规模（决定改动成本）：

```
components/AppShell.tsx          2941      lib/rpc-manager.ts          2154
components/ChatInput.tsx         2992      hooks/useAgentSession.ts    2277
components/SessionSidebar.tsx    2280      lib/session-reader.ts        730
components/ChatWindow.tsx        2229      lib/subagents.ts             603
components/MessageView.tsx       2005      lib/subagent-runtime.ts      587
app/globals.css                  2433
```

---

## 2. 四个参考项目定位速览

| 代号 | 目录 | 版本 / 血缘 | 技术栈 | 对我们的价值 |
| --- | --- | --- | --- | --- |
| **desktop** | `参考项目/pi-web-desktop-main` | `@iswitthere/pi-web-desktop` 0.8.10-f，fork 自上游 **0.7.16** | Next 16.3.1 + Electron 43 + electron-builder 26 | ★★★★★ **Electron 封装的唯一现成模板**（兄弟分支，UI 自主） |
| **upstream** | `参考项目/pi-web-main` | `@agegr/pi-web` **0.14.6** | **TanStack Start + Vite + Nitro**（已弃 Next） | ★★★★ 一批小而独立的行为修正 + 一套成熟设计规范文档 |
| **mcode** | `参考项目/mcode-master` | Mcode 0.1.13，异血缘 | **electron-vite + 纯 SPA**，pnpm + turbo monorepo | ★★★★ **桌面工程骨架与血泪踩坑**（打包/更新/分发/防御） |
| **musepi** | `参考项目/MusePi-main` | MusePi 0.4.x，pi-mono 血统 | Rust（7 crate）+ TS（23 包）+ Bazel + Nix + Bun | ★★★ 架构级思路（daemon 解耦）+ 可直接搬的 React/CSS/i18n 契约 |

**一句话分工**：`desktop` 给**外壳代码**，`mcode` 给**工程纪律**，`upstream` 给**交互修正与设计规范**，`musepi` 给**架构视野与契约模式**。

---

## 3. 维度一：页面布局

### 3.1 三方 shell 结构对比

| 维度 | 本仓库 | upstream 0.14.6 | desktop |
| --- | --- | --- | --- |
| 根容器 | `app-shell-layout` 类名 | 纯 inline style | inline style |
| 侧栏 | `<div id="session-sidebar">` | **`<nav aria-label>`（语义化）** | `<div>` |
| 主区 | `main-panels` + `workspace-slot` | 顶栏/主区/右栏三段平铺 | 主区 + 右栏 tab |
| 右栏 | `ExplorerPanel` 文件树 | 文件 / changes / git-graph 多类型 | 多类型 tab + keep-alive |
| 顶栏 | 常驻图标条 | **`TaskHeader` 56px（标题+状态+溢出菜单）** | `AppTitleBar`（Electron 标题栏） |
| 工作区互换 | ✅ `workspaceSwapped` + `inert` + `aria-hidden` | ✗ | ✗ |
| 跳转链接 | ✗ | ✅ `.skip-to-chat` | ✗ |
| 第四栏 | ✗ | ✅ `.desktop-workspace-context`（container query） | ✗ |
| 移动端 | `MobilePwaLayout` | 覆盖层侧栏 + 遮罩 | 同 |

**结论**：本仓库在**工作区互换 + inert 焦点管理**上反而领先三方（这点保持）。缺口集中在四栏化能力与语义/无障碍。

### 3.2 upstream 的响应式三档（值得抄）

`app/globals.css` 用纯 media query 分三档，右栏行为逐档降级：

| 区间 | 右栏 | 左栏 |
| --- | --- | --- |
| ≥960px | 参与分栏、可拖拽、宽度动画 | 宽度动画 |
| 641–959px | `position: fixed` 覆盖层 + `translateX(100%)` 滑入 + 遮罩 | 宽度动画 |
| ≤640px | 覆盖层 | `fixed` 覆盖 280px 滑入 |

**第四栏用 container query 而非 media query**（`globals.css:4896-4921`）：

```css
.app-center-column { container-type: inline-size; container-name: chat-center; }
.desktop-workspace-context { display: none; }
@media (min-width: 1280px) {
  @container chat-center (min-width: 760px) {
    .desktop-workspace-context { width: 292px; flex: 0 0 292px; display: flex; }
    .extension-status-shelf.has-gutter-dup { display: none; }   /* 去重 */
  }
}
```

> 用 `@container` 的好处：右栏开合会改变主区宽度，`@media` 感知不到，`@container` 能。

### 3.3 upstream 的三栏可拖拽分栏（`useResizablePanel.ts`）

本仓库已有同名 hook，但 upstream 版补齐了完整 ARIA separator 契约与键盘操作：

```ts
separatorProps: { role: "separator", tabIndex: 0, "aria-orientation": "vertical",
  "aria-valuemin", "aria-valuenow", "aria-valuetext": `${width} px`, onKeyDown }
// Arrow 步进 12px / Shift+Arrow 32px / Home=min / End=max / Enter=重置
```

宽度写入 CSS 变量而非 React state（避免重渲染）；`window.blur` / `visibilitychange` 时取消拖拽。

---

## 4. 维度二：设计体系

### 4.1 upstream 有一套成文的规范，我们没有

`参考项目/pi-web-main/DESIGN.md`（9070 字节）+ `PRODUCT.md` + `.impeccable/design.json`（机器可读 schema）。

北极星（`DESIGN.md:102`）：

> Pi Web is a quiet instrument: a dense local coding desk where the sidebar is the tool rack, the conversation is the bench, and files sit in a drawer. **Personality lives in restraint, not decoration.**

六条硬规则（`.impeccable/design.json:97-104`）：

| 规则 | 原文 |
| --- | --- |
| Workbench Blue Rule | "Accent occupies a small fraction of any screen. If a layout needs color to look finished, the layout is wrong." |
| Token Role Rule | "Use `--accent`, `--error`, `--warning`, `--ok`. **Do not introduce a second red or green.**" |
| UI-Scale Rule | "Do not add a display or headline size. The largest chrome type is 0.875rem." |
| Row-Not-Card Rule | "Projects and sessions are list rows. Do not wrap them in equal-height cards." |
| Flat-By-Default Rule | "Shadows appear only on floating layers (dialog, menu, switcher)." |
| Quiet Corner Rule | "Rows stay at 5px. Do not pill an entire session row." |

**动效刻度**（`design.json:26-29`）——可直接对齐：

```json
{ "name": "panel-width",  "value": "width 0.2s ease", "purpose": "prefers-reduced-motion 下禁用" }
{ "name": "ease-out-150", "value": "150ms ease-out",  "purpose": "chevron 旋转与小控件" }
```

**断点**：`compact 480 / sidebar-desktop 641 / files-split 960 / context-gutter 1280`。
**阴影词汇表**：`dialog 0 10px 28px rgba(15,23,42,.18)` / `switcher 0 8px 18px rgba(0,0,0,.28)` / `menu 0 6px 8px rgba(0,0,0,.14)`。
**行高**：session 34px / project 36px；粗指针（触屏）把命中区提到 44px。

> ⚠️ **重要冲突**：upstream 把主题**收敛成「一套 token、两种模式」**（light/dark/auto），
> 而我们的 Codex skin 是**六套色板**。这条**不能照抄**——它和 `docs/codex-skin/delta.md`
> 记录的产品定位直接冲突。可借鉴的是**规则本身**（不要第二个红绿、扁平优先、行非卡片），
> 不是「砍掉六套色板」这个决定。

### 4.2 musepi 的三正交轴 token + 密度系数

`参考项目/MusePi-main/packages/desktop-app/src/styles/gui-base.css:146-182`：

```
data-theme（明暗） × data-accent（强调色） × data-ui-theme
--gui-density 是**无单位系数**，用于整站密度缩放：
padding: calc(32px * var(--gui-density, 1)) calc(48px * var(--gui-density, 1));
```

本仓库的 `--corner-radius-scale: 1.25` 已经是同类思路（几何系数化），
但**没有密度系数**。加一个 `--ui-density` 可以低成本换来「紧凑/舒适」两档。

### 4.3 musepi 的三个可直接搬的组件模式

| 组件 | 路径 | 解决什么 |
| --- | --- | --- |
| `HeightMorph` | `desktop-app/src/components/HeightMorph.tsx` | 高度动画；**铁律：必须裁剪 overflow** |
| `Reveal` | `desktop-app/src/components/Reveal.tsx` | 展开/收起统一实现 |
| `FadeScroll` | `desktop-app/src/components/FadeScroll.tsx` + `lib/use-scroll-shadow.ts` | 内容边缘羽化（mask-image，**溢出才挂载**） |
| `use-two-phase-enter` | `desktop-app/src/lib/use-two-phase-enter.ts` | 两阶段浮动层入场 |

`use-two-phase-enter` 对应一个真实踩坑（`docs/gui-design.md:95`）：

> animating at mount … makes Chromium **skip backdrop sampling** … CDP screenshots (offscreen compositing) still show blur and **easily mislead verification**.

即：挂载时同时播动画会让 Chromium 跳过 `backdrop-filter` 采样。本仓库大量使用玻璃层（`delta.md §3 覆盖层`），**这条必须核对**。

---

## 5. 维度三：功能缺口

### 5.1 我们有、它们没有（不要被反向"优化"掉）

| 能力 | 证据 |
| --- | --- |
| 终端 | `components/TerminalPanel.tsx`、`lib/terminal-manager.ts`、`node-pty`、`@xterm/xterm`（upstream/mcode 之外，upstream **已无**） |
| MCP 面板 | `components/PluginsConfig.tsx` + `app/api/mcp/route.ts` |
| Markdown WYSIWYG | ProseMirror 10 包 + `MarkdownFileEditor.tsx` |
| Web Push | `lib/web-push.ts` + `sw.js` |
| apply_patch 分栏 diff | `lib/apply-patch.ts`（V4A patch + `details.preview` 双数据源） |
| Minimap 书签 pin | `components/ChatMinimap.tsx`（pin 命中 17 次） |
| 六套色板 | `lib/theme.ts` + `globals.css` |
| 工作区互换 + inert | `AppShell.tsx:2737-2740` |
| 3 语 i18n（含 zh-TW） | `lib/i18n/messages/zh-TW.ts` |
| session liveness 协议 | `lib/session-liveness.ts` 199 行 + `PI_WEB_IDLE_TIMEOUT_MS` |

> **警告**：upstream 0.14.6 在重写时**删掉了 session liveness 与 idle 超时环境变量**，
> 只剩硬编码 10 分钟定时器。**绝不要整文件替换 `lib/rpc-manager.ts`。**

### 5.2 缺口清单（按性价比）

| # | 缺口 | 来源 | 证据路径 | 成本 |
| --- | --- | --- | --- | --- |
| 1 | running 状态靠 **2.5s 轮询** | upstream | `SessionSidebar.tsx:97` `RUNNING_SESSIONS_POLL_MS = 2500`、`:633` fetch；上游 `app/api/agent/running/events/route.ts` + `rpc-manager.ts` 的 `subscribeRunningSessions()` | ~80 行 |
| 2 | 流式文本未合批 | upstream | `lib/text-delta-batcher.ts` 55 行 → 接 `useAgentSession.ts` 的 `text_delta` 分支 | 55 行 + 1 接入 |
| 3 | **无命令面板** | upstream | `CodexSidebar.tsx:454-511, 1022-1078`（`Ctrl/Cmd+K` + 焦点还原 + 键盘循环） | 中 |
| 4 | **无统一对话框** | upstream | `components/DialogShell.tsx` 120 行 + `.codex-dialog-*`（`globals.css:76-233`），五档尺寸 + ≤640px bottom-sheet | 低 |
| 5 | **无跳过链接 / 分栏 ARIA 不全** | upstream | `.skip-to-chat`（`globals.css:4876-4893`）；`useResizablePanel.ts` 的 `aria-valuetext`/Home/End | 极低 |
| 6 | **无计划面板** | upstream | `ConversationPlan.tsx` + `globals.css:323-390` | 中 |
| 7 | **无会话归档 / 项目置顶** | upstream | `lib/archived-sessions.ts` 27 行、`lib/project-registry.ts` 113 行、`lib/recent-sessions.ts` 53 行 | ~200 行 |
| 8 | **无第四栏上下文 gutter** | upstream | `DesktopConversationContext.tsx` + `globals.css:4896-4921` | 低 |
| 9 | **无 Git 变更面板 / 图谱** | desktop | `git-graph.ts` 100 + `git-graph-parser.ts` 54 + `git-graph-lanes.ts` 119（**纯函数带测试**）+ `GitGraphTab.tsx` 617 | 中 |
| 10 | 右栏单类型 tab | desktop | `tab-model.ts` + `right-tabs-memory.ts` 149 行 | 中 |
| 11 | **无工作区标签页** | desktop | `workspace-tabs.ts` 164 + `WorkspaceTabBar.tsx` 454 | 中 |
| 12 | 阅读时输入框不收 | desktop | `lib/input-compact.ts` 73 行（方向感知状态机） | 低 |
| 13 | 无 tok/s 显示 | upstream | `lib/token-speed.ts` 85 行（本仓库估算函数内联在 `MessageView.tsx:35-83`） | 低 |
| 14 | 队列消息不能单条改 | upstream | `rpc-manager.ts:385-467` `mutateQueue` + `ChatInput.tsx:359-600` `QueueStrip` | 中 |
| 15 | 外部 subagent 会话不认领 | upstream | `lib/session-relations.ts` 59 行（正则 `^subagent-(<agent>)-<runId>(-\d+)?$`） | 低 |
| 16 | **无桌面端** | desktop / upstream / mcode | 见 §6 | 高 |
| 17 | 设置面板手写控件 | musepi | `settings.schema` + `SchemaSettings.tsx`（336 项 schema 驱动） | 中 |
| 18 | i18n 无编译期 parity | musepi | `as const satisfies Record<ZhKey, string>` + `TranslationKey = keyof typeof zhCN` | 低 |
| 19 | 文档无双语一致性门控 | musepi | `README.i18n.yaml` blob-hash + `scripts/verify-translation-pairing.ts` | 低 |
| 20 | 无统一 logger | musepi / mcode | musepi `AGENTS.md:239-251`「**Code that may run while the TUI, RPC, SDK, workers … MUST NOT use `console.log`**」 | 低 |

---

## 6. 维度四：桌面打包（Electron）

### 6.1 三个项目的路线对比

| | desktop（pi-web-desktop） | mcode | musepi |
| --- | --- | --- | --- |
| 前端形态 | **Next.js（内嵌 server）** | Vite 纯 SPA | Vite 纯 SPA |
| 生产启动 | `fork()` 起 `next start`，端口 **30141 固定** | `loadFile(renderer/index.html)` | 同 mcode |
| 自定义协议 | 无 | 无（`app://` 仅注释） | 有 |
| 打包器 | electron-builder 26（配置**内联** `package.json`） | electron-builder（独立 `electron-builder.yml`） | electron-builder |
| `asar` | **`false`** | `true` + `asarUnpack` native | — |
| 产物 | win nsis + portable / mac dmg / linux AppImage | win nsis / mac dmg+zip | mac/linux/win 矩阵 |
| 签名 | 无 | mac **ad-hoc**（`build/adhoc-sign.cjs`） | — |
| 自动更新 | **无** | ✅ electron-updater + GitHub Releases | ✅ |
| 分发渠道 | 本地脚本 | GitHub Releases + **Homebrew Cask** | 同 |
| CI 发布 | 无 `.github/` | ✅ `release.yml` 按 arch 分 runner | ✅ 5 平台矩阵 |

### 6.2 desktop 的 6 条血泪经验（必抄）

摘自 `参考项目/pi-web-desktop-main/AGENTS.md:503-509` 与 `scripts/build-release.mjs`：

1. **生产用 `fork()` 不用 `spawn()`**
   > Uses `fork()` (not `spawn()`) in production because `process.execPath` is `Pi Web.exe`, not Node.js

2. **`IS_DEV` 不能用 `app.isPackaged`**（因为 `asar: false`，打包后仍返回 `false`）：
   ```js
   const IS_DEV = !fs.existsSync(pkgRoot) && !fs.existsSync(asarRoot);
   ```

3. **dev/prod 共用 `.next` 会毁生产 CSS**：
   > Running the release build while the app's dev server is up has been observed to **corrupt the production CSS output** (whole rule blocks dropped from the emitted chunk, e.g. `.chat-input-ghost`).

   > 本仓库已有 `scripts/next-mode.mjs` 处理同类问题，是天然优势。

4. **Turbopack 哈希符号链接 electron-builder 不跟随**：
   > turbopack generates hashed module IDs (e.g. `pi-coding-agent-4cdde81112ef3dc5`) that point to real npm packages via **symlinks**. electron-builder on Windows doesn't follow symlinks, so the packaged app **can't resolve these hashed names**. Replace each symlink with a copy of its real target.

   处理：`build-release.mjs:199-220` 实体化 `.next/node_modules/*`；`:251-257` 打包后**再手工注入** `resources/app/.next/node_modules`（builder 会过滤嵌套 node_modules）。

5. **打包前后要快照/还原 `package-lock.json`**（`:161-183, 263-273`），防止 `npm prune --production` 造成依赖漂移。

6. **`asar: false` 的连带后果**：`app.isPackaged` 失效 + 必须自己处理嵌套 `node_modules` 过滤。

### 6.3 mcode 的桌面工程纪律（选抄）

| 做法 | 路径 | 为什么值得抄 |
| --- | --- | --- |
| **窗口防御三件套** | `src/main/window.ts` | ① `ready-to-show` 3s 兜底强制显窗（防"后台幽灵进程"）② renderer `console-message`/`render-process-gone`/`did-fail-load` 全落盘 ③ `setWindowOpenHandler` 外链永不进应用 |
| **全局异常 + logger 重入保护** | `src/main/index.ts`、`lib/logger.ts` | `log.error` 自身抛 EPIPE 会递归爆栈 `0xC0000409`；`handlingGlobalError` 标志位是血换的 |
| **`setName` 前快照 userData** | `src/main/index.ts` | 改名会改 `userData` 路径 → 用户数据"消失"；先 `getPath` 再 `setPath` 钉回 |
| **生产才注入 CSP** | `src/main/index.ts` | dev 下注入会让 HMR 白屏 |
| **失焦才发原生通知** | `notifications/NotificationManager.ts` | `if (win.isFocused() && !win.isMinimized()) return;` 前台交给 in-app toast |
| **自绘标题栏配色同步** | `lib/theme.ts` + `window.ts` | `nativeTheme` + `setTitleBarOverlay`，macOS 需 guard |
| **`artifactName` 必须无空格** | `electron-builder.yml` | 让磁盘文件名 / `latest.yml` url / GitHub asset 名三者一致，否则更新 404 |
| **`npmRebuild: false`** | `electron-builder.yml` | pnpm 下 `@electron/rebuild` 会 ENOENT；有预编译就别重建 |
| **macOS ad-hoc 签名** | `build/adhoc-sign.cjs` | 无付费证书也能过 macOS 15+ Gatekeeper |
| **Homebrew Cask 作更新通道** | `cask/mcode.rb` | ad-hoc 签名下 electron-updater 会静默失败，brew 才是真实更新渠道 |
| **`createDbGuardedIpc`** | `src/main/ipc/index.ts` | 所有 handler 自动 `await awaitDb()`，让建窗与 DB 初始化并行 |
| **契约包用源码包 + alias** | `packages/contracts/src/ipc.ts` | 不产 dist、不发布，直接 bundle；zod 校验 + `RpcMap` 强类型 preload |

### 6.4 明确不要抄

| 做法 | 原因 |
| --- | --- |
| 把 agent 二进制打进安装包 | mcode `AGENTS.md` 明写 License 合规红线；单平台 +600MB |
| `sql.js`（内存整库 + 每次写全量 export） | mcode 因此把主进程 RSS 顶到 1.6GB，已迁 better-sqlite3 |
| 手动设 `Content-Length` 走 undici fetch | Electron 33 的 undici 6.x 抛 `UND_ERR_INVALID_ARG` |
| 裸 `fetch` 做下载（代理环境） | undici **不读** `*_proxy`，且把所有故障压成无信息的 `fetch failed`；应走 curl |
| `webPreferences.sandbox: false` | mcode 为兼容旧依赖放开；新项目应 `sandbox: true` |
| 无 Developer ID 就上 electron-updater 自动安装 | macOS Squirrel 静默失败 |
| Bazel + Nix 全家桶（musepi） | 纯 TS 项目无原生产物，引入是纯负担 |

### 6.5 musepi 的架构级思路（评估后定，不建议一期做）

`参考项目/MusePi-main/docs/gui-implementation.md` + `desktop-app/src/lib/rpc.ts:1-28`：

> The daemon multiplexes **two kinds of frames on one connection**:
> - JSON-RPC responses: `{ jsonrpc, id, result | error }`
> - subscription events: bare `{ kind, seq, payload }` envelopes pushed by `session.subscribe` / `session.resume`

核心四点：
1. **常驻 daemon 进程**，GUI 退出后存活，重连即续
2. **一条连接复用两类帧**（响应 + 订阅事件）
3. **零依赖 wire 契约包**，宿主与 Web 客户端共同 import 防漂移
4. **状态归宿主**：`pause` 是 host-layer state，**不属于 agent 事件流**（`gui-implementation.md:32`）

> 本仓库现为「Next.js API route 内 spawn pi + 事件流转发」，属同进程耦合。
> 但**本仓库已有 `lib/agent-event-wire.ts` / `agent-event-connection.ts` 的雏形**，
> 借鉴重心应放在「帧信封格式 + 重连语义」而非整体 daemon 化。

---

## 7. 两个必须先解决的前置问题

### 7.1 本仓库不是 git 仓库

```
$ ls -d .git        → 当前目录无 .git
$ ls -d ../.git     → 上级目录无 .git
```

但 `docs/codex-skin/delta.md:5-13` 引用了完整的 git 历史：

```
upstream   68e746c = v0.9.0 → aeffa53 = v0.9.1
main       a43952b → 12 个皮肤提交 → 166abb8 merge upstream v0.9.1 → 6bd923f 剔除 Electron
```

**后果**：
1. **PR 工作流无法执行** —— 没有 git 就没有分支、diff、review、revert。
2. **`upstream` 分支不可用** —— 而它正是恢复 Electron 的最短路径（见 7.2）。
3. `delta.md` 的合并流水线（`git merge upstream`）当前无法执行。

**建议**：作为 PR-00 先补 git 基线。

### 7.2 Electron 曾被本 fork 主动剔除

`docs/codex-skin/delta.md:349-357`：

> ### Electron 桌面端已剔除（`6bd923f`）
> 上游 v0.9.1 新增 Electron 桌面端。本 fork 保持纯 Web，已移除：
> - `electron/main.js`、`scripts/gen-icons.mjs`、`scripts/after-pack.mjs`、`build/` 图标
> - `package.json`：`productName`、`main`、`desktop` / `desktop:icons` 脚本、`electron` / `electron-builder` / `@resvg/resvg-js` 依赖、electron-builder 的 `build` 配置块
> - `.gitignore`：忽略 `/release`
>
> `upstream` 分支上的快照仍完整保留这些内容，**需要时可从那里取回**。

**两个佐证**：
- `.gitignore` 末尾仍留着 `# electron-builder output (upstream desktop target)` + `/release`
- `package.json` 里已无 `electron` / `electron-builder` 依赖

**这意味着**：如果现在要做桌面端，**上游 v0.9.1 的 Electron 实现（针对 0.9.1 代码库写的）比 desktop 的 0.7.16 版本更贴我们的代码**。
优先级应该是：

```
① 从 upstream 分支取回 0.9.1 原生 Electron 实现（若 git 历史可恢复）
② 否则用 desktop 的 electron/ 作为模板（fork 自 0.7.16，需要适配）
③ mcode 只补工程纪律（打包/更新/防御），不补外壳
```

---

## 8. 对既有 `fork-comparison-2026-09-16.md` 的两处修正

| 既有文档的说法 | 实际 | 依据 |
| --- | --- | --- |
| `:60` desktop 的 Next 版本是 `16.2.12` | **16.3.1**（与本仓库一致） | `参考项目/pi-web-desktop-main/package.json:62` |
| `:98` desktop 有「窗口状态持久化」 | **没有**。`electron/` 内唯一的 `setBounds` 在 `main.js:175`，是给通知弹窗按内容调高度；主窗口不记忆位置尺寸 | 全仓 `electron-window-state` / 主窗口 `getBounds` 零命中 |
| `:307` 本仓库 AGENTS.md 关于 fork 的描述过时 | 待核对 | 需 `grep` `AGENTS.md` 的 fork 段落 |

另：既有文档的路径是 `/Users/yingjing/...`（macOS），当前工作副本在 `C:\Users\Administrator\Desktop\pi-codex-main`，**路径需按本机改写**。

---

## 9. 明确不做清单

| 不做 | 理由 |
| --- | --- |
| **TanStack Start + Vite + Nitro 迁移**（upstream 0.14.6） | 57k 行 + 自制 Codex skin + 自制 `next-mode.mjs` 工具链；收益（构建速度/依赖减重）远小于成本。**负收益。** |
| **CodexSidebar 整块替换** | 1233 行 vs 我们的 `SessionSidebar.tsx` 2280 行，功能集不重合；Codex skin 是产品资产。只挑「归档 + 置顶」两块能力。 |
| **整文件替换 `lib/rpc-manager.ts`** | 会丢掉 `withSessionReplacement` / `clone` / `fork_branch`，并让扩展失去 liveness 保护。只抄 `subscribeRunningSessions` / `notifyRunningChange` 片段。 |
| **把六套色板收敛成两模式** | 与 Codex skin 产品定位直接冲突。 |
| **Bazel / Nix / Rust 原生层** | 纯 TS 项目无原生产物。 |
| **musepi 桌宠 / collab / harmony** | 业务强相关，参考价值有限。 |
| **打包 agent 二进制** | License 合规红线。 |
| **照搬「无 lint / 无测试 / CI 只 typecheck」** | mcode 的 `turbo lint` 是空跑；本仓库有 191 个测试与 eslint，不应降级。 |

---

## 10. 借鉴项总清单（按来源项目）

### 10.1 来自 `pi-web-desktop-main`（Electron 外壳）

| 项 | 路径 | 成本 |
| --- | --- | --- |
| Electron 主进程骨架 | `electron/main.js`（839 行） | 高 |
| preload 桥（3 命名空间） | `electron/preload.js`（58 行）+ `global.d.ts:31-53` | 低 |
| 启动 splash | `public/splash.html` + `globals.css:2152-2161` `body::before` + `AppShell.tsx:163-176` `html.pi-booted` | 低 |
| 自定义标题栏 | `components/AppTitleBar.tsx`（425-479 窗口控制）+ `globals.css:446-459` 拖拽区 | 中 |
| 窗口状态 hook | `hooks/useElectronWindow.ts`（浏览器模式全 no-op） | 低 |
| 托盘 | `main.js:447-481` | 低 |
| 通知窗口 | `electron/notification-window.html`（162 行）+ `main.js:96-232` | 中 |
| 打包脚本 | `scripts/build-release.mjs`（符号链接实体化 + 注入 + lock 快照） | 高 |
| 图标生成 | `scripts/generate-icons.mjs` | 低 |
| pi TUI 主题 JSON 解析层 | `lib/theme.ts`（615 行，**仅解析层 ~450 行可搬**） | 中 |
| 进程分组显示 | `ProcessGroup.tsx` 1096 + `step-categorizer.ts` + `step-visuals.ts` | 中 |
| Git 图谱 | `git-graph.ts` 100 + `git-graph-parser.ts` 54 + `git-graph-lanes.ts` 119 | 中 |
| 右栏多类型 tab + keep-alive | `tab-model.ts` + `right-tabs-memory.ts` 149 | 中 |
| 工作区标签页 | `workspace-tabs.ts` 164 + `WorkspaceTabBar.tsx` 454 | 中 |
| 欢迎大厅 + 最近项目 | `WelcomeLobby.tsx` 471 + `recent-projects.ts` 404 | 中 |
| 输入框阅读时塌陷 | `lib/input-compact.ts` 73 | 低 |

### 10.2 来自 `pi-web-main`（上游 0.14.6）

| 项 | 路径 | 成本 |
| --- | --- | --- |
| running SSE | `app/api/agent/running/events/route.ts` + `rpc-manager.ts` `subscribeRunningSessions()` | 低 |
| text-delta 合批 | `lib/text-delta-batcher.ts` 55 | 低 |
| token 速度 | `lib/token-speed.ts` 85 | 低 |
| 外部 subagent 会话认领 | `lib/session-relations.ts` 59 | 低 |
| 会话归档 | `lib/archived-sessions.ts` 27 | 低 |
| 项目注册表（pin/archive/order） | `lib/project-registry.ts` 113 + `project-registry-core.ts` 51 | 中 |
| 最近会话 | `lib/recent-sessions.ts` 53 | 低 |
| 命令面板 | `CodexSidebar.tsx:454-511, 1022-1078` | 中 |
| 统一对话框 | `DialogShell.tsx` 120 + `globals.css:76-233` `.codex-dialog-*` | 低 |
| 计划面板 | `ConversationPlan.tsx` + `globals.css:323-390` | 中 |
| 目标面板 | `GoalPanel.tsx` 117 + `lib/goal-panel.ts` | 低 |
| 第四栏上下文 | `DesktopConversationContext.tsx` + `globals.css:4896-4921` | 低 |
| 顶栏 TaskHeader | `TaskHeader.tsx` 86 | 低 |
| 跳过链接 | `globals.css:4876-4893` | 极低 |
| 分栏 ARIA 增强 | `useResizablePanel.ts` | 极低 |
| 队列单条编辑 | `rpc-manager.ts:385-467` + `ChatInput.tsx:359-600` | 中 |
| 设计规范文档 | `DESIGN.md` + `PRODUCT.md` + `.impeccable/design.json` | 低 |
| subagent 树合并原则 | `subagent-tree.ts` 注释（祖先定形状、实时只覆盖状态、缺失标 `inactive`） | 低 |
| API 方法 405 契约 | `src/api-methods.ts` + `lib/tanstack-route-inventory.test.mjs` 思路 | 低 |

### 10.3 来自 `mcode-master`

| 项 | 路径 | 成本 |
| --- | --- | --- |
| 窗口防御三件套 | `apps/desktop/src/main/window.ts` | 低 |
| 全局异常 + logger 重入保护 | `src/main/index.ts` + `lib/logger.ts` | 低 |
| `setName` 前快照 userData | `src/main/index.ts` | 极低 |
| 生产才注入 CSP | `src/main/index.ts` | 极低 |
| 失焦才发通知 | `notifications/NotificationManager.ts` | 低 |
| 自绘标题栏配色同步 | `lib/theme.ts` + `window.ts` | 低 |
| electron-builder 独立 yml 最佳实践 | `apps/desktop/electron-builder.yml` | 低 |
| macOS ad-hoc 签名 | `build/adhoc-sign.cjs` | 低 |
| Homebrew Cask 分发 | `cask/mcode.rb` | 低 |
| 自动更新正确写法 | `src/main/updater.ts` | 中 |
| 发布 CI 矩阵 | `.github/workflows/release.yml` + `merge-mac-update-yml.cjs` | 中 |
| 契约包 + zod IPC 校验 | `packages/contracts/src/ipc.ts` | 中 |
| `createDbGuardedIpc` | `src/main/ipc/index.ts` | 低 |
| shell 冒烟测试模式 | `apps/desktop/scripts/*/run.sh` | 中 |
| fetch 错误诊断 | `providers/bridge/bridgeServer.ts` `describeFetchError()` | 低 |

### 10.4 来自 `MusePi-main`

| 项 | 路径 | 成本 |
| --- | --- | --- |
| 三正交轴 token + 密度系数 | `desktop-app/src/styles/gui-base.css:146-182`、`gui-chat.css:2368` | 低 |
| 两阶段浮动层入场 | `lib/use-two-phase-enter.ts` + `docs/gui-design.md:95-96` | 低 |
| 高度动画组件 | `components/HeightMorph.tsx`、`Reveal.tsx` | 低 |
| 内容边缘羽化 | `lib/use-scroll-shadow.ts`、`components/FadeScroll.tsx` | 低 |
| schema 驱动设置面板 | `daemon/server.ts` `settings.schema` + `SchemaSettings.tsx` | 中 |
| i18n 域化 + 编译期 parity | `guest-client/src/i18n/**`、`docs/gui-design.md:11-22` | 低 |
| 文档双语配对门控 | `README.i18n.yaml` + `scripts/verify-translation-pairing.ts` | 低 |
| 对话框键盘所有权契约 | `components/DialogFrame.tsx` | 低 |
| 集中式 logger（禁 console） | `AGENTS.md:239-251` | 低 |
| 活文档制度 | `docs/gui-design.md:1-9`、`docs/gui-implementation.md:1-7` | 极低 |
| 双类帧信封协议 | `desktop-app/src/lib/rpc.ts:1-28` | 中 |
| 零依赖 wire 契约包 | `packages/wire/src/index.ts` | 中 |
| 协议版本协商 + 大帧分块 | `modes/rpc/rpc-frame.ts`、`docs/rpc.md:39-72` | 中 |
| 逐工具 React 渲染器 | `guest-client/src/tool-render/**` | 中 |
| 消息树 / trajectory 双投影 | `lib/message-tree.ts`、`components/TrajectoryView.tsx` | 中 |

---

## 11. 通用移植注意事项

1. **先 `git diff` 确认没有，再动手** —— 本仓库比 upstream 0.14.6 在若干处更新（fork 实现、历史分页、跨窗口同步、chat-only、liveness、subagent 服务端）。
2. **SDK 版本**：upstream 是 `0.84.2`，本仓库 pin `0.85.1`；搬完必跑 `tsc --noEmit`。
3. **Next 版本**：desktop 的 `next.config.ts` 有 `turbopack: {}` 与 webpack `node:` external 两条 workaround，本仓库 16.3.1 可能已不需要，**先试不加**。
4. **React 严格模式**：dev 下 effect 双调用，搬任何带副作用的 hook（SSE 订阅、事件监听）时 unsubscribe 必须幂等。
5. **`globalThis` 而非模块级变量**：`rpc-manager.ts` 已用 `globalThis.__piSessions` / `__piStartLocks`；新增的订阅注册表必须同样处理，否则 Next 热重载丢订阅。
6. **路径比较用 `samePath()`**：项目注册表、worktree、文件访问在 Windows 上 `===` 必出问题。
7. **写文件用 `writePrivateFileAtomicSync` + `proper-lockfile`**：项目注册表需加锁（`stale: 30_000` + 指数退避）。
8. **`.test.mjs` 连同测试一起搬** —— 那是唯一能证明搬对了的东西。
9. **别混用 dev/prod 的 `.next`** —— 走 `npm run prod` / `npm run dev:clean`。
10. **改过主题层必须跑完整验证链**（`delta.md:385-402`）：
    ```bash
    node_modules/.bin/tsc --noEmit
    npm run lint
    npm test
    node docs/codex-skin/audit-tokens.mjs
    npm run prod   # 改过主题层要先把 .next 挪走
    node docs/codex-skin/verify-themes.mjs
    node docs/codex-skin/capture-themes.mjs
    ```
11. **改主题或布局后更新 `docs/codex-skin/delta.md`** —— 这是本 fork 的硬约定。
12. **`delta.md` 的自检提醒**：`.next` 里的 CSS 缓存会骗人，改过主题层要先 `mv .next $(mktemp -d)/next`。
