# 参考项目借鉴项 · 小 PR 拆分与实施计划

日期：2026-09-16
配套文档：[`ref-projects-comparison-2026-09-16.md`](./ref-projects-comparison-2026-09-16.md)
基准：`@agegr/pi-web` 0.9.1 · Codex Style fork

---

## 0. 拆分原则

| 原则 | 说明 |
| --- | --- |
| **单一意图** | 一个 PR 只做一件事。皮肤改动与功能改动**绝不混在一个 PR**（`delta.md` 的硬约定） |
| **可独立回滚** | 每个 PR 单独 revert 后系统仍可用 |
| **自带测试** | 新增 lib 逻辑必须带 `.test.mjs`；UI 改动至少带一个断言测试 |
| **先探针后大改** | 涉及未知 API 的先做 spike（不合并），再拆成实现 PR |
| **搬运带测试** | 从参考项目搬代码时**连同 `.test.mjs` 一起搬** |
| **皮肤 PR 附加验证** | 任何动 CSS 的 PR，DoD 追加 `audit-tokens.mjs` + `verify-themes.mjs` |

### 统一 DoD（Definition of Done）

```bash
node_modules/.bin/tsc --noEmit              # 必过
npm run lint                                # 0 error
npm test                                    # 除环境性用例外全过
# 以下仅当 PR 改动 app/globals.css 或 app/settings.css：
node docs/codex-skin/audit-tokens.mjs       # 必过
mv .next $(mktemp -d)/next && npm run prod  # 干净重建
node docs/codex-skin/verify-themes.mjs      # 必过（能抓重复主题块）
node docs/codex-skin/capture-themes.mjs     # 重拍截图
# 以下仅当 PR 改动主题/布局：
# 更新 docs/codex-skin/delta.md
```

---

## 1. 阶段总览

| 阶段 | 主题 | PR 数 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| **P0** | 前置：git 基线 | 1 | — | 低 |
| **P1** | 桌面端外壳（Electron） | 11 | P0 | 中高 |
| **P2** | 低风险高收益（布局/交互） | 6 | P0（可与 P1 并行） | 低 |
| **P3** | 功能补齐 | 8 | P0 | 中 |
| **P4** | 样式与工程化 | 5 | P0 | 低 |
| **P5** | 评估型（先 spike） | 3 | P3 | 高 |

**推荐节奏**：`P0 → (P1 ∥ P2) → P3 → P4 → P5`

P1 与 P2 之间**无代码依赖**，可双线并行（P1 由熟悉 Electron 的人做，P2 由熟悉 UI 的人做）。

---

## 2. P0 — 前置：git 基线

### PR-00 · 建立 git 仓库与分支基线 ★阻塞项

**为什么必须第一个做**：当前工作副本**不是 git 仓库**（无 `.git`），没有 git 就没有分支、diff、review、revert——**PR 工作流无法执行**。且 `delta.md` 引用的 `upstream` 分支（含 v0.9.1 原生 Electron 实现）也因此不可用。

**目标**：补齐 git 基线，让后续所有 PR 可评审、可回滚。

**改动面**
- 新增：`.git/`（`git init`）
- 新增：`.gitattributes`（建议加 `* text=auto eol=lf`，Windows 下避免行尾抖动）
- 检查：`.gitignore` 已含 `/release`、`/.next/`、`/node_modules` ✅
- **排除**：`参考项目/` 不应入库（建议加入 `.gitignore`，或单独放仓库外）

**验收标准**
```bash
git status --short          # 参考项目/ 与 node_modules 不在列表
git log --oneline           # 至少一个基线提交
git tag v0.9.1-skin-baseline
```

**后续动作（重要）**
1. 若能取回原始 git 历史（含 `upstream` 分支），优先恢复——那是 PR-01 的最短路径。
2. 若不能，需**手工重建** `upstream` 参照：从 npm 拉 `@agegr/pi-web@0.9.1` 原始包作为对照物。
3. 建立分支约定：`main`（稳定）+ 每 PR 一个 `feat/xxx` 分支。

**风险**：无法恢复历史 → 失去 v0.9.1 原生 Electron 代码 → PR-01 降级为「以 desktop 0.7.16 版为模板」（成本 +1~2 天）。

---

## 3. P1 — 桌面端外壳（Electron）

> **重要前提**：本 fork **曾经有过 Electron**，在 `6bd923f` 主动剔除（`delta.md:349-357`）。
> 因此优先级是：
> ① 从 `upstream` 分支取回 **0.9.1 原生实现**（最贴当前代码）
> ② 否则以 `参考项目/pi-web-desktop-main/electron/`（fork 自 0.7.16）为模板适配
> ③ `mcode` 只补工程纪律，不补外壳

### PR-01 · Electron 外壳最小可用版

**目标**：`npm run desktop` 能起一个窗口，加载本机的 Pi Web 服务。

**来源**：`参考项目/pi-web-desktop-main/electron/main.js`（839 行，取最小子集）

**改动面**
- 新增：`electron/main.js`
  - 单实例锁（`requestSingleInstanceLock` + `second-instance` → `showMainWindow()`）
  - `IS_DEV` 判定：**不能用 `app.isPackaged`**（`asar: false` 时打包后仍为 `false`）
    ```js
    const IS_DEV = !fs.existsSync(pkgRoot) && !fs.existsSync(asarRoot);
    ```
  - 生产用 **`fork()`** 起 `next start`（`process.execPath` 是 `Pi Web.exe` 而非 node，`spawn` 会失败）
  - 端口 **30141 固定**，启动前先探测已有服务，**有则复用**
  - `webPreferences`: `contextIsolation: true` / `nodeIntegration: false`
- 修改：`package.json` — 加 `"main": "electron/main.js"` + `desktop` 脚本 + `electron` devDependency
- 修改：`next.config.ts` — 若 `next build` 报错，试加 `turbopack: {}`（**先试不加**）

**验收标准**
- [ ] `npm run desktop` 打开窗口并渲染 Pi Web
- [ ] 已有 30141 服务在跑时，Electron 复用而非起第二个
- [ ] 重复启动第二个实例 → 聚焦已有窗口，不新开进程
- [ ] `npm test` / `tsc --noEmit` 不受影响

**依赖**：PR-00
**风险**：dev/prod 共用 `.next` 冲突 → 复用现有 `scripts/next-mode.mjs`

---

### PR-02 · preload 桥 + 全局类型声明

**目标**：渲染进程通过 `contextBridge` 安全访问原生能力，零业务逻辑。

**来源**：`参考项目/pi-web-desktop-main/electron/preload.js`（58 行）+ `global.d.ts:31-53`

**改动面**
- 新增：`electron/preload.js`（只做 `contextBridge.exposeInMainWorld`）
- 新增：`global.d.ts` — 声明 `window.electron` / `window.piDesktop` 接口
- 修改：`electron/main.js` — `webPreferences.preload` 指向 preload.js

**验收标准**
- [ ] 渲染进程 `typeof window.electron === "object"`；浏览器模式下 `undefined`
- [ ] 渲染进程**无法** `require()` 任何 Node 模块（`nodeIntegration: false` 生效）
- [ ] `tsc --noEmit` 通过（类型声明生效）

**依赖**：PR-01

---

### PR-03 · 桌面工程防御三件套 ★强烈建议早做

**目标**：桌面端出问题时可诊断，避免"白屏 + 无日志 + 幽灵进程"三连。

**来源**：`参考项目/mcode-master/apps/desktop/src/main/window.ts`

**改动面**
- 修改：`electron/main.js`
  1. **3s 强制显窗兜底** —— `ready-to-show` 3 秒未触发就 `show()`，避免后台幽灵进程
  2. **renderer 日志落盘** —— `console-message` / `render-process-gone` / `did-fail-load` 全转发到主进程日志
  3. **外链永不进应用** —— `setWindowOpenHandler` → `shell.openExternal` + `{ action: "deny" }`
  4. **全局异常 + 重入保护** —— `handlingGlobalError` 标志位（logger 自身抛 EPIPE 会递归爆栈 `0xC0000409`）
  5. **`setName` 前快照 userData** —— `getPath("userData")` → `setName()` → `setPath()` 钉回
  6. **生产才注入 CSP**（dev 注入会让 HMR 白屏）

**验收标准**
- [ ] 人为让渲染进程抛错 → 主进程日志能看到
- [ ] 点击 `target="_blank"` 链接 → 系统浏览器打开，不新开 Electron 窗口
- [ ] 断网/服务未起时，窗口仍显示（不静默挂起）

**依赖**：PR-01
**为什么早做**：成本极低（~100 行），但省掉后续所有桌面调试的痛苦。

---

### PR-04 · 启动 splash

**目标**：消除启动期白屏。

**来源**：`参考项目/pi-web-desktop-main/public/splash.html` + `app/globals.css:2152-2161` + `AppShell.tsx:163-176`

**改动面**
- 新增：`public/splash.html`（CSP 只允许 `connect-src http://127.0.0.1:30141`，轮询 `/api/home` 后 `location.replace`）
- 修改：`electron/main.js` — 窗口先加载 splash
- 修改：`app/globals.css` — `body::before` 盖住水合间隙 ⚠️ **皮肤 PR**
- 修改：`components/AppShell.tsx` — `html.pi-booted` 淡出

**验收标准**
- [ ] 冷启动全程无白屏
- [ ] 服务就绪后自动跳到应用
- [ ] 浏览器直接访问时 splash 不出现
- [ ] `audit-tokens.mjs` + `verify-themes.mjs` 通过

**依赖**：PR-01
**风险**：改动 `AppShell.tsx`（2941 行）+ `globals.css` → **需更新 `delta.md`**

---

### PR-05 · 自定义标题栏 + 窗口控制按钮

**目标**：桌面端有原生观感的标题栏。

**来源**：`参考项目/pi-web-desktop-main/components/AppTitleBar.tsx:425-479` + `hooks/useElectronWindow.ts` + `globals.css:446-459`

**改动面**
- 新增：`components/AppTitleBar.tsx`
- 新增：`hooks/useElectronWindow.ts`（返回 `{isElectron,isMac,isMaximized,minimize,toggleMaximize,close}`，**浏览器模式全 no-op**）
- 修改：`app/globals.css` — `.app-title-bar{ -webkit-app-region: drag }` / `.app-no-drag` ⚠️ **皮肤 PR**
- 修改：`components/AppShell.tsx` — 挂载标题栏
- 修改：`electron/main.js` — `titleBarStyle: "hidden"` + `trafficLightPosition`（macOS 预留 72px）
- 修改：`electron/preload.js` — 5 个窗口控制 IPC 通道

**验收标准**
- [ ] 拖动标题栏能移动窗口；按钮区域不触发拖拽
- [ ] 最小化/最大化/关闭正常；关闭按钮 hover 变红
- [ ] macOS 保留原生红绿灯且不重叠
- [ ] **浏览器模式下标题栏不渲染**，布局无回归
- [ ] `AppShell.layout.test.mjs` 通过（或同步更新）

**依赖**：PR-01、PR-02
**风险**：`AppShell.tsx` 是最敏感文件 → **建议本 PR 只加挂载点，不动既有布局**

---

### PR-06 · 系统托盘 + 原生菜单 + DevTools 快捷键

**来源**：`参考项目/pi-web-desktop-main/electron/main.js:447-481, 614-625, 804-807`

**改动面**
- 新增：`electron/tray-icon.png`、`electron/tray-icon-mac.png`（+ 对应的 `.test.mjs` 资源存在性测试）
- 修改：`electron/main.js`
  - 托盘菜单：Show / Quit + 双击唤起
  - `backgroundThrottling: false`（托盘隐藏时不被 Chromium 节流）
  - Win/Linux：`Menu.setApplicationMenu(null)`（配合无边框）；macOS：`appMenu + editMenu`
  - `before-input-event` 拦截 F12 / Ctrl+Shift+I 开 DevTools

**验收标准**
- [ ] 托盘图标出现，菜单可显示/退出
- [ ] 关窗后托盘仍在，点击能唤回
- [ ] F12 能开 DevTools
- [ ] macOS 菜单栏有应用菜单

**依赖**：PR-01、PR-05

---

### PR-07 · 原生能力桥接（目录选择 / 拖拽取路径 / 外链）

**目标**：桌面端体验优于浏览器（尤其目录选择）。

**来源**：`参考项目/pi-web-desktop-main/electron/main.js:720-728, 750-760, 592-612` + `preload.js:30`

**改动面**
- 修改：`electron/main.js` — 4 个 IPC handler
- 修改：`electron/preload.js` — `selectDirectory` / `showItemInFolder` / `openExternal` / `getPathForFile`
- 修改：`components/DirectoryPicker.tsx` — 优先走原生对话框
- 修改：`hooks/useDragDrop.ts` — 桌面端走 `webUtils.getPathForFile(file)`

**验收标准**
- [ ] 桌面端点「选择目录」弹**原生**对话框（非浏览器 `showDirectoryPicker`）
- [ ] 拖文件进窗口能拿到真实路径
- [ ] 浏览器模式自动降级到原有实现，无回归

**依赖**：PR-02
**坑**：`File.path` 已被移除，`webUtils.getPathForFile` 是唯一合规方式。

---

### PR-08 · electron-builder 打包配置

**目标**：产出可分发的安装包。

**来源**：`参考项目/pi-web-desktop-main/package.json:97-140`（内联 `build` 段）+ `mcode` 的 `apps/desktop/electron-builder.yml`

**改动面**
- 修改：`package.json`
  - 加 `electron-builder` devDependency
  - 加 `build` 配置段：`appId` / `productName` / `directories.output: "release"` / `asar: false`
  - 产物：win `nsis` + `portable`、mac `dmg`、linux `AppImage`
  - **`artifactName` 必须无空格**（否则磁盘名 / `latest.yml` url / GitHub asset 名不一致 → 更新 404）
  - `npmRebuild: false`（有预编译就别重建；pnpm 下 `@electron/rebuild` 会 ENOENT）
  - `files` 排除 `.next/cache`、`.next/dev`、`*.js.map`、`electron/node_modules`、`node_modules/electron/**`
- 新增：`scripts/generate-icons.mjs`（或直接提交图标资源）
- 修改：`.gitignore` — `/release` 已在 ✅

**验收标准**
- [ ] `npm run desktop:build` 在 `release/` 产出安装包
- [ ] 安装后能启动、能加载服务
- [ ] 产物名无空格
- [ ] **`node-pty` 可用**（本仓库有终端，desktop 版没有——这是新增风险，见下）

**依赖**：PR-01~PR-07
**⚠️ 本仓库特有风险**：`参考项目/pi-web-desktop-main` **不含 `node-pty`**（它没有终端）。本仓库有终端 →
需要额外处理 native 模块：`asarUnpack: ["**/*.{node,dll}", "**/node_modules/node-pty/build/Release/**", "**/node_modules/node-pty/prebuilds/**"]`
+ 确认 Electron ABI 匹配。**这是 desktop 模板没有覆盖的部分。**

---

### PR-09 · 打包踩坑修复（Turbopack 符号链接 / lock 快照）

**目标**：让打包产物**真的能跑**。

**来源**：`参考项目/pi-web-desktop-main/scripts/build-release.mjs`

**改动面**
- 新增：`scripts/build-release.mjs`
  1. **`.next/node_modules/*` 符号链接实体化**（Turbopack 生成哈希模块 ID 指向 symlink，electron-builder 在 Windows 上**不跟随**）
  2. **打包后再手工注入** `resources/app/.next/node_modules`（builder 会过滤嵌套 `node_modules`）
  3. **`package-lock.json` 快照 + 还原**（防 `npm prune --production` 造成依赖漂移）
  4. 打包前检查 dev server 是否在跑（dev/prod 共用 `.next` **会毁生产 CSS**）
- 修改：`package.json` — `desktop:build` 走该脚本

**验收标准**
- [ ] 打包产物在**干净机器**上能启动（至少换一个用户目录测试）
- [ ] 生产 CSS 完整（无规则块丢失）
- [ ] `package-lock.json` 打包后与打包前**逐字节一致**
- [ ] dev server 在跑时打包会**报错退出**而非静默产出坏包

**依赖**：PR-08
**风险**：这是整个 P1 最容易翻车的一步。建议先做一次 spike 验证。

---

### PR-10 · 桌面通知窗口

**目标**：Agent 跑完时在桌面弹通知（跨窗口场景）。

**来源**：`参考项目/pi-web-desktop-main/electron/notification-window.html`（162 行）+ `main.js:96-232`

**改动面**
- 新增：`electron/notification-window.html`（frameless + alwaysOnTop + skipTaskbar）
- 修改：`electron/main.js`
  - 主窗口聚焦时**返回 `{shown: false}`** 让渲染进程走 in-app 兜底
  - 5 分钟 TTL 去重 + 30s 重复抑制 + hover 暂停自动隐藏
  - 主进程 3s 轮询 `/api/agent/running` 作为渲染进程冻结时的兜底
  - ⚠️ **不要用 `focusable: false`** —— Windows 上 `focusable:false` + transparent + always-on-top 可能完全不绘制
- 修改：`electron/preload.js` — `piNotification` 命名空间

**验收标准**
- [ ] 主窗口失焦时收到桌面通知；聚焦时不弹（走 in-app）
- [ ] 点击通知跳转到对应会话
- [ ] 通知在 Windows 上**能绘制出来**（重点验证）

**依赖**：PR-01、PR-02
**注意定位差异**：本仓库已有 Web Push（跨设备）；此 PR 是**本机**场景，两者不冲突。

---

### PR-11 · 自动更新 + 发布 CI（P5 评估，可延后）

**来源**：`参考项目/mcode-master/apps/desktop/src/main/updater.ts` + `.github/workflows/release.yml`

**改动面**
- 新增：`electron/updater.ts`
  - `if (!is.prod) return;` 守卫
  - `autoUpdater.autoDownload = false`
  - **`createRequire` 加载 CJS**（ESM 下 dynamic import 拿不到 getter 定义的命名导出）
  - 更新状态持久化
  - **ad-hoc 签名检测**（macOS 下 Squirrel 会静默失败 → 引导手动下载）
- 新增：`.github/workflows/release.yml`（tag `v*.*.*` 触发，按 arch 分 runner）
- 新增：`build/adhoc-sign.cjs`（macOS ad-hoc 签名，过 Gatekeeper）
- 可选：`cask/pi-web.rb`（Homebrew Cask 作 macOS 更新通道）

**验收标准**
- [ ] dev 模式不触发更新检查
- [ ] 有新版时能提示并下载
- [ ] macOS ad-hoc 签名场景下给出手动下载引导

**依赖**：PR-08、PR-09
**前置决策**：**需要先决定是否要自己做分发**。若只是自用，本 PR 可以不做。

---

## 4. P2 — 低风险高收益（可与 P1 并行）

### PR-12 · running 状态改用 SSE，去掉 2.5s 轮询 ★建议第一个做（非桌面线）

**目标**：running 徽标零延迟；空闲时网络请求降到 0。

**来源**：`参考项目/pi-web-main/app/api/agent/running/events/route.ts`（50 行）+ `lib/rpc-manager.ts` 的 `subscribeRunningSessions()` / `notifyRunningChange()`

**现状**：`components/SessionSidebar.tsx:97` `RUNNING_SESSIONS_POLL_MS = 2500`、`:633` fetch

**改动面**
- 新增：`app/api/agent/running/events/route.ts`
- 新增：`lib/running-sessions.ts`（`globalThis.__piRunningListeners` 注册表）
- 修改：`lib/rpc-manager.ts` — **只加** `subscribeRunningSessions()` / `notifyRunningChange()`，**其余一律不动**
- 修改：`components/SessionSidebar.tsx` — `setInterval` → `EventSource`
- 新增：`lib/running-sessions.test.mjs`

**验收标准**
- [ ] 会话开始/结束 running 状态**立即**反映到侧栏
- [ ] 空闲 60s 内无 `/api/agent/running` 请求
- [ ] 断开重连能恢复
- [ ] `sessionListVersion` 机制**保留**（跨窗口列表同步仍需版本号）

**依赖**：PR-00
**四个坑（上游注释已写明）**
1. 必须**先订阅再取初始快照**，否则有窗口漏事件
2. `lastRunningSnapshot` 在无订阅者时**要清空**，否则新订阅者第一次变更被误判为"没变"
3. 需 30s 心跳（`: \n\n`）穿过代理
4. 注册表必须挂 `globalThis`（Next 热重载会丢模块级变量）

**⚠️ 反向警告**：**不要**顺手把 `lib/rpc-manager.ts` 整文件替换成上游版——上游 0.14.6 删掉了 `session-liveness.ts` 与 `PI_WEB_IDLE_TIMEOUT_MS`，会丢扩展的 liveness 保护，并丢掉 `withSessionReplacement` / `clone` / `fork_branch`。

---

### PR-13 · 流式文本按帧合批

**来源**：`参考项目/pi-web-main/lib/text-delta-batcher.ts`（55 行）

**改动面**
- 新增：`lib/text-delta-batcher.ts` + `.test.mjs`
- 修改：`hooks/useAgentSession.ts` — 接入 `text_delta` 分支

**验收标准**
- [ ] 长回复时每帧最多一次 React 更新
- [ ] `contentIndex` 变化、显式 `flush()`、`dispose()` **同步**下发（否则事件顺序错乱）
- [ ] 流式渲染结果与合批前**逐字节一致**（加对比测试）

**依赖**：PR-00
**收益**：对本仓库 2229 行的 `ChatWindow` 尤其明显。

---

### PR-14 · 跳过链接 + 分栏 ARIA 增强

**来源**：`参考项目/pi-web-main/app/globals.css:4876-4893`（`.skip-to-chat`）+ `hooks/useResizablePanel.ts`

**改动面**
- 修改：`app/globals.css` — `.skip-to-chat`（15 行）⚠️ **皮肤 PR**
- 修改：`components/AppShell.tsx` — 加 `<a class="skip-to-chat" href="#conversation">`
- 修改：`hooks/useResizablePanel.ts` — 补 `aria-valuetext`、`aria-orientation`、`role="separator"`
  - 键盘：Arrow 12px / Shift+Arrow 32px / Home=min / End=max / Enter=重置
  - `window.blur` / `visibilitychange` 时取消拖拽

**验收标准**
- [ ] Tab 首焦点出现"跳到对话"链接
- [ ] 分隔条可用键盘调整，读屏能播报当前宽度
- [ ] `useResizablePanel` 相关测试通过

**依赖**：PR-00
**成本**：极低（约 40 行），直接满足无障碍目标。

---

### PR-15 · 统一对话框原语 DialogShell

**目标**：一处修焦点陷阱/Esc/aria，全站受益。

**来源**：`参考项目/pi-web-main/components/DialogShell.tsx`（120 行）+ `globals.css:76-233` 的 `.codex-dialog-*`

**改动面**
- 新增：`components/DialogShell.tsx`
- 修改：`app/globals.css` — `.codex-dialog-*` 系统（五档尺寸 + `::backdrop` + ≤640px bottom-sheet）⚠️ **皮肤 PR**
- 新增：`components/DialogShell.test.mjs`

**关键实现**
```tsx
// 原生 <dialog showModal> 实现焦点陷阱；自动聚焦候选按优先级查找
const preferred = dialog?.querySelector<HTMLElement>([
  "[autofocus]", ".codex-dialog-input", ".codex-dialog-editor",
  ".codex-dialog-option", "[data-variant=\"primary\"]",
].join(", "));
preferred?.focus({ preventScroll: true });
```
尺寸表：`confirm 420 / request 520 / editor 680 / tool 820 / terminal 920`

**验收标准**
- [ ] Esc 关闭、焦点陷阱、`::backdrop` 生效
- [ ] ≤640px 自动降级为 bottom-sheet
- [ ] 先只迁移 1~2 个现有对话框验证，**不批量替换**

**依赖**：PR-00
**建议**：本 PR 只引入原语 + 迁移 1 个对话框；后续每个对话框迁移**单独出 PR**（保持单一意图）。

---

### PR-16 · 命令面板（Ctrl/Cmd+K）

**目标**：导航体验最大单点提升。

**来源**：`参考项目/pi-web-main/components/CodexSidebar.tsx:454-511, 1022-1078` + `lib/codex-sidebar-search.ts`（50 行）

**改动面**
- 新增：`components/CommandPalette.tsx`
- 新增：`lib/palette-search.ts`（搬 `codex-sidebar-search.ts` 的匹配逻辑）
- 修改：`components/AppShell.tsx` — 挂载 + 快捷键
- 修改：`lib/i18n/messages/{en,zh-CN,zh-TW}.ts` — 新增 key（3 语言都要加）
- 新增：`components/CommandPalette.test.mjs`

**关键实现**
```tsx
// 在输入框内时不拦截
if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
// 打开时记录焦点，关闭时还原
quickPreviousFocusRef.current = document.activeElement;
```

**验收标准**
- [ ] `Ctrl+K` / `Cmd+K` 唤起；在输入框内**不**拦截
- [ ] 上下键循环选择、Enter 打开、Esc 关闭并**还原焦点**
- [ ] 3 个语言文件都补齐 key（否则 `npm test` 的 i18n 一致性测试会挂）

**依赖**：PR-15（复用 DialogShell 的焦点管理，可选）
**⚠️ 不要整搬 1246 行的 `CodexSidebar.tsx`** —— 只摘面板部分。

---

### PR-17 · 第四栏上下文 gutter

**来源**：`参考项目/pi-web-main/components/DesktopConversationContext.tsx` + `globals.css:4896-4921`

**改动面**
- 新增：`components/ConversationContextGutter.tsx`
- 修改：`app/globals.css` — `.desktop-context-*` + `.app-center-column { container-type: inline-size }` ⚠️ **皮肤 PR**
- 修改：`components/ChatWindow.tsx` — 挂载 gutter

**关键实现**（CSS 变量驱动，不重排）
```tsx
const progressStyle = { "--context-percent": `${percent}%`, "--context-tone": getContextTone(percent) };
```
```css
.desktop-context-progress > span { width: var(--context-percent); background: var(--context-tone);
  transition: width 180ms ease, background-color 180ms ease; }
```
阈值：`≥95% → --error`、`≥80% → --warning`、否则 `--accent`

**验收标准**
- [ ] **用 `@container` 而非 `@media`**（右栏开合会改主区宽度，`@media` 感知不到）
- [ ] 主区宽度不足时 gutter 自动隐藏
- [ ] 与既有 `.extension-status-shelf` 不重复显示

**依赖**：PR-00
**数据源**：本仓库已有 `lib/conversation-context.ts`，属"接线"工作。

---

## 5. P3 — 功能补齐

### PR-18 · token 估算提到 lib + tok/s 显示

**来源**：`参考项目/pi-web-main/lib/token-speed.ts`（85 行）

**现状**：`estimateTokens` / `estimateUpdatedTokens` 内联在 `components/MessageView.tsx:35-83`

**改动面**
- 新增：`lib/token-speed.ts` + `.test.mjs`（`computeStreamingTps()`、`billedOutputTokens()`、`estimateStreamingTokens()` 带缓存）
- 修改：`components/MessageView.tsx` — 删内联函数，改 import（**减 ~50 行**）
- 修改：`components/ChatInput.tsx` 或消息区 — 显示 tok/s
- 新增：`hooks/useTokenSpeedPreference.ts` — 开关

**验收标准**
- [ ] 流式时显示 tok/s
- [ ] `reasoning > output` 时输出 `output + reasoning`
- [ ] 开关状态持久化
- [ ] `MessageView.test.mjs` 通过

**依赖**：PR-00

---

### PR-19 · ConversationPlan 计划面板

**来源**：`参考项目/pi-web-main/components/ConversationPlan.tsx` + `globals.css:323-390`

**原理**：解析扩展 widget 的 box-drawing 输出
```ts
const headingMatch = heading.match(/^([●○])\s+.+?\s+\((\d+)\/(\d+)\)$/);
const row = line.match(/^[├└]─\s+([○◐✓✗])(?:\s+#\d+)?\s+(.+)$/);
```

**改动面**
- 新增：`components/ConversationPlan.tsx` + `.test.mjs`
- 新增：`lib/conversation-plan.ts`（解析器，纯函数）
- 修改：`app/globals.css` — `.conversation-plan-*` + `grid-template-rows: 0fr → 1fr` 折叠动画 ⚠️ **皮肤 PR**
- 修改：`components/ExtensionWidgets.tsx` — 接入

**验收标准**
- [ ] 计划在轮次结束后**仍然可见**（`planCacheRef` 缓存最后一次有效 widget）
- [ ] `aria-live="polite"` + `aria-atomic` 播报进度
- [ ] `prefers-reduced-motion` 下用静态图标替代动画

**依赖**：PR-00
**⚠️ 前置决策**：这是为 **rpiv-todos 扩展**定制的特例解析器，不是通用协议。
**要么**也依赖那个扩展，**要么**泛化成"任意 todo widget"的通用面板。**先确认再动手。**

---

### PR-20 · 会话归档

**来源**：`参考项目/pi-web-main/lib/archived-sessions.ts`（27 行）

**改动面**
- 新增：`lib/archived-sessions.ts` + `.test.mjs`（localStorage 存 session id）
- 修改：`components/SessionSidebar.tsx` — 归档/取消归档操作 + 折叠区
- 修改：`lib/i18n/messages/*.ts` — 3 语言 key

**验收标准**
- [ ] 归档后从主列表消失，可在归档区找回
- [ ] **绝不隐式改名/删除 `.jsonl`**（上游 PRODUCT.md 硬性原则）
- [ ] 跨窗口同步（复用现有 `sessionListVersion`）

**依赖**：PR-00
**成本**：低（~60 行）

---

### PR-21 · 项目置顶 / 排序 / 自定义名

**来源**：`参考项目/pi-web-main/lib/project-registry.ts`（113 行）+ `project-registry-core.ts`（51 行）

**改动面**
- 新增：`lib/project-registry.ts` + `project-registry-core.ts` + `.test.mjs`
- 修改：`components/SessionSidebar.tsx` — 项目行菜单
- 修改：`lib/i18n/messages/*.ts`

**存储**：`~/.pi/agent/pi-web-projects.json`，字段 `pinned / archived / removed / order`

**验收标准**
- [ ] 置顶后项目排在最前，重启后保持
- [ ] **Windows 路径比较必须用 `samePath()` / `toNativePath()`**（`===` 必出问题）
- [ ] 写文件用 `writePrivateFileAtomicSync` + `proper-lockfile`（`stale: 30_000` + 指数退避）
- [ ] 并发写不损坏文件（加并发测试）

**依赖**：PR-00、PR-20（同一 UI 区域，建议顺序做）

---

### PR-22 · 认领外部 pi-subagents 创建的子会话

**来源**：`参考项目/pi-web-main/lib/session-relations.ts`（59 行）

**原理**：正则从**会话名**推断关系
```
^subagent-(<agent>)-<runId>(-\d+)?$
```
再向上走到根。附赠 `activeSessionRoots()` 把 running 状态上浮到根会话行。

**改动面**
- 新增：`lib/session-relations.ts` + `.test.mjs`
- 修改：`lib/api-types.ts` — `SessionInfo` 加 4 个可选字段（`sessionRole` / `rootSessionId` / `subagentAgent` / `subagentRunId` / `subagentIndex`）
- 修改：`components/SessionSidebar.tsx` — 过滤 `sessionRole !== "subagent"`

**验收标准**
- [ ] 在 TUI 里用外部 pi-subagents 生成的会话，在侧栏**正确归组**而非显示为普通 fork
- [ ] 本仓库内嵌 subagent（`pi-web:subagent` custom entry）不受影响

**依赖**：PR-00
**成本**：低（~60 行）

---

### PR-23 · Git 变更面板

**来源**：`参考项目/pi-web-main/components/GitChangesPanel.tsx`

**改动面**
- 新增：`components/GitChangesPanel.tsx` + `.test.mjs`
- 修改：`components/ExplorerPanel.tsx` — 挂载折叠块
- 修改：`app/globals.css` — 面板样式 ⚠️ **皮肤 PR**

**验收标准**
- [ ] 显示状态字母 + 文件图标 + 目录灰字
- [ ] 点击直接开 diff tab（复用现有 `lib/git-changes.ts` 的 `onOpenFile(path, name, { modeHint: "diff" })`）
- [ ] 超出上限显示 "更多变更文件"

**依赖**：PR-00、PR-24（建议先做 tab 模型）
**数据源**：本仓库已有 `/api/git/status` + `/api/git/diff`

---

### PR-24 · 右栏多类型 tab + keep-alive

**来源**：`参考项目/pi-web-desktop-main/components/tab-model.ts` + `lib/right-tabs-memory.ts`（149 行）

**改动面**
- 修改：`components/file-tab-state.ts` → 泛化为判别联合（`file` / `changes` / `git-graph`）
- 新增：`lib/right-tabs-memory.ts` + `.test.mjs`（按 workspace 持久化）
- 修改：`components/ExplorerPanel.tsx` — tab 渲染改 keep-alive（挂载后 CSS 隐藏）

**验收标准**
- [ ] 切换 tab 不重新拉取、不丢滚动位置
- [ ] **必须删掉 `FileViewer` 的 unmount 快照机制**（`onStateChange` / `saveFileViewerState`）——否则两套状态互相打架（desktop 踩过）
- [ ] tab 上只保留"初始显示模式"的种子值

**依赖**：PR-00
**说明**：本仓库 `file-tab-state.ts` 已有 `viewerRevision` 概念，与 desktop 思路一致——**已经走到半路**。

---

### PR-25 · 阅读时收起输入框（input-compact）

**来源**：`参考项目/pi-web-desktop-main/lib/input-compact.ts`（73 行）

**改动面**
- 新增：`lib/input-compact.ts` + `.test.mjs`（方向感知状态机）
- 修改：`components/ChatInput.tsx` — 接入

**验收标准**
- [ ] 向上滚动阅读时输入框塌成一行，回到底部自动展开
- [ ] **边界不抖动**：只在**真实向上滚动且离底部 >120px** 时塌陷，只在主动向下滚动时恢复
- [ ] 状态机有方向判定（这是看起来简单、实际必须方向判定的典型）

**依赖**：PR-00
**说明**：UI 口味项，**看实际用着顺不顺再决定是否保留**。

---

## 6. P4 — 样式与工程化

### PR-26 · 设计规范文档化

**来源**：`参考项目/pi-web-main/DESIGN.md` + `PRODUCT.md` + `.impeccable/design.json`

**改动面**
- 新增：`docs/design-system.md` —— 把本 fork 的 Codex skin 规则**成文**
  - 复用 upstream 的六条硬规则中**适用的部分**（不要第二个红绿 / 扁平优先 / 行非卡片 / 最大 chrome 字号）
  - 本 fork 特有：六套色板、`--corner-radius-scale`、三级前景 alpha、暖色 oklch
  - 动效刻度：`panel-width 0.2s ease`、`ease-out-150`、dialog `.12s`、view transition `450ms`
  - 断点：`480 / 641 / 960 / 1280`
  - 阴影词汇表：`dialog` / `switcher` / `menu` 三档
- 修改：`docs/codex-skin/visual-spec.md` — 交叉引用

**验收标准**
- [ ] 文档中的每条数值都能在 `app/globals.css` 中找到对应 token
- [ ] **不引入"砍掉六套色板"** —— 与产品定位冲突

**依赖**：PR-00
**成本**：低（纯文档），但**是后续所有皮肤 PR 的判据**。

---

### PR-27 · 动效刻度收敛 + 高度动画组件

**来源**：`参考项目/MusePi-main` 的 `HeightMorph.tsx` / `Reveal.tsx` / `FadeScroll.tsx` / `use-two-phase-enter.ts`

**改动面**
- 新增：`components/HeightMorph.tsx`、`components/Reveal.tsx`、`components/FadeScroll.tsx` + 各带 `.test.mjs`
- 新增：`lib/use-two-phase-enter.ts`、`lib/use-scroll-shadow.ts`
- 修改：`app/globals.css` — 动效时长/缓动对齐 PR-26 的刻度 ⚠️ **皮肤 PR**

**验收标准**
- [ ] 高度动画**必须裁剪 overflow**（musepi 铁律）
- [ ] `FadeScroll` 只在**溢出时**才挂载
- [ ] **核对 `backdrop-filter` 玻璃层**：挂载时同时播动画会让 Chromium **跳过 backdrop 采样**
      （musepi `docs/gui-design.md:95` 明确记录，且 **CDP 截图会显示模糊、误导验证**）
- [ ] `prefers-reduced-motion` 下全部禁用

**依赖**：PR-26
**⚠️ 风险**：本仓库大量使用玻璃层（`delta.md §3 覆盖层`），第 3 条必须实测核对。

---

### PR-28 · i18n 编译期 parity

**来源**：`参考项目/MusePi-main/packages/guest-client/src/i18n/**` + `docs/gui-design.md:11-22`

**改动面**
- 修改：`lib/i18n/messages/*.ts` — 用类型技巧锁定 key 对齐
  ```ts
  const zhCN = { ... } as const;
  type ZhKey = keyof typeof zhCN;
  const en: Record<ZhKey, string> = { ... };   // 缺/多 key → 编译错误
  export type TranslationKey = keyof typeof zhCN;
  ```
- 新增：`lib/i18n/index.test.mjs` — 运行时兜底校验

**验收标准**
- [ ] 三语言文件缺 key 时 `tsc --noEmit` **报错**
- [ ] 现有 i18n 测试仍通过
- [ ] 无运行时开销

**依赖**：PR-00
**成本**：低（纯类型技巧）

---

### PR-29 · 文档双语一致性门控

**来源**：`参考项目/MusePi-main/README.i18n.yaml` + `scripts/verify-translation-pairing.ts`

**改动面**
- 新增：`docs/i18n-pairing.json`（记录各语言对的 blob hash）
- 新增：`scripts/verify-doc-pairing.mjs`
- 修改：`package.json` — 加 `docs:verify` 脚本

**验收标准**
- [ ] `README.md` 改动后若 `README.zh-CN.md` 未同步，脚本**报错并列出文件**
- [ ] 本仓库现有 4 个 README（en / zh-CN / ja / ru）纳入门控

**依赖**：PR-00
**说明**：本仓库已有 `docs/i18n.md`，此 PR 补的是**门控**。

---

### PR-30 · 集中式 logger

**来源**：`参考项目/MusePi-main/AGENTS.md:239-251` + `mcode` 的 `src/main/lib/logger.ts`

**目标**：让"不能污染协议流"这条约束可执行。

**背景**（musepi 原文）：
> Code that may run while the TUI, RPC, SDK, workers … **MUST NOT use `console.log`**

本仓库有 API 路由与 SSE 流式响应，**同样是硬约束**——`console.log` 会污染 stdout。

**改动面**
- 新增：`lib/logger.ts` + `.test.mjs`
- 修改：`AGENTS.md` — 加约定条款
- 可选：`eslint.config.mjs` — 加 `no-console` 规则（对 `app/api/**` 生效）

**验收标准**
- [ ] logger 输出到 stderr 而非 stdout
- [ ] 有重入保护（logger 自身抛错不递归）
- [ ] `app/api/**` 下 `console.log` 被 lint 拦截

**依赖**：PR-00
**成本**：低

---

## 7. P5 — 评估型（先 spike，不直接合并）

### PR-31 · 密度系数（spike → 实现）

**来源**：`参考项目/MusePi-main/packages/desktop-app/src/styles/gui-base.css:146-182`

**思路**：本仓库已有 `--corner-radius-scale: 1.25` 这类几何系数，加一个 `--ui-density` 可低成本换"紧凑/舒适"两档。

**Spike 内容**：验证 `--ui-density` 能否在不破坏 6 套色板与 `audit-tokens.mjs` 的前提下生效。

**验收标准**
- [ ] `audit-tokens.mjs` 通过（**这是主要风险点**：脚本会检查"自造 token"）
- [ ] 两档密度下 6 套主题渲染正确
- [ ] 与 `--corner-radius-scale` 不冲突

**依赖**：PR-26

---

### PR-32 · schema 驱动设置面板（spike）

**来源**：`参考项目/MusePi-main/packages/daemon/src/...` 的 `settings.schema` + `SchemaSettings.tsx`（336 项 schema 驱动）

**思路**：设置项增多后，手写每个控件不可维护。

**Spike 内容**：把 `components/SettingsPanel.tsx` 中**一个分区**改为 schema 驱动，验证可行性。

**验收标准**
- [ ] schema 能表达现有控件类型（开关/下拉/文本/数字）
- [ ] 不引入运行时依赖
- [ ] 若不可行 → **明确记录结论并放弃**（spike 的价值也在于此）

**依赖**：PR-26

---

### PR-33 · daemon 化解耦（架构 spike，仅调研）

**来源**：`参考项目/MusePi-main/docs/gui-implementation.md` + `desktop-app/src/lib/rpc.ts:1-28`

**现状**：本仓库是「Next.js API route 内 spawn pi + 事件流转发」，**同进程耦合**。

**musepi 的证明**（四点）
1. 常驻 daemon 进程，GUI 退出后存活，重连即续
2. **一条连接复用两类帧**：
   - JSON-RPC 响应：`{ jsonrpc, id, result | error }`
   - 订阅事件：裸信封 `{ kind, seq, payload }`
3. 零依赖 wire 契约包，宿主与 Web 客户端共同 import 防漂移
4. 状态归宿主：`pause` 是 host-layer state，**不属于 agent 事件流**

**Spike 内容**：**只输出评估报告，不写代码**。重点回答：
- 本仓库已有的 `lib/agent-event-wire.ts` / `agent-event-connection.ts` 距此模型有多远？
- 帧信封格式（`{kind, seq, payload}`）能否**增量**引入而不动进程模型？
- 重连语义（`onStatus("closed")` → 全量 `boot()`）能否直接借鉴？

**验收标准**
- [ ] 产出 `docs/adr/0004-daemon-decoupling-evaluation.md`
- [ ] 给出「做 / 不做 / 部分做」的明确结论与理由
- [ ] **不写生产代码**

**依赖**：PR-12（running SSE 会先建立事件订阅的基础设施）
**⚠️ 风险**：这是**架构级改动**，成本高、收益不确定。**建议只做 ADR，不做实现**，除非多端复用成为明确需求。

---

## 8. 依赖关系图

```
PR-00 (git 基线) ★阻塞
   │
   ├──────────────────────────────┬──────────────────────────────┐
   │                              │                              │
   ▼ P1 桌面端线                  ▼ P2 交互线                    ▼ P4 工程线
PR-01 外壳骨架                PR-12 running SSE             PR-26 设计规范
   │                            PR-13 text-delta 合批          ├── PR-27 动效+组件
   ├── PR-02 preload 桥          PR-14 skip-link + ARIA         ├── PR-31 密度系数
   │      │                      PR-15 DialogShell             └── PR-32 schema 设置
   │      ├── PR-07 原生能力          │
   │      │                      PR-16 命令面板
   ├── PR-03 工程防御             PR-17 上下文 gutter
   ├── PR-04 splash                          │
   ├── PR-05 标题栏                          │
   │      └── PR-06 托盘                      ▼ P3 功能线
   ├── PR-08 打包配置            PR-18 token 速度
   │      └── PR-09 打包踩坑      PR-19 ConversationPlan
   ├── PR-10 通知窗口             PR-20 会话归档
   └── PR-11 自动更新(P5)          └── PR-21 项目置顶
                                  PR-22 外部 subagent 认领
                                  PR-24 右栏 tab 模型
                                       └── PR-23 Git 面板
                                  PR-25 输入框塌陷

PR-28 i18n parity ──┐
PR-29 文档门控      ├── 独立，随时可做
PR-30 logger       ─┘

PR-33 daemon spike ← 依赖 PR-12
```

---

## 9. 里程碑建议

| 里程碑 | 内容 | 交付物 |
| --- | --- | --- |
| **M0** | PR-00 | 可用的 git 仓库 + 基线 tag |
| **M1** | PR-01 ~ PR-03 + PR-12 ~ PR-14 | 桌面能开窗（可诊断）+ 3 个体验修正 |
| **M2** | PR-04 ~ PR-07 + PR-15 ~ PR-17 | 桌面端观感完整 + 交互现代化 |
| **M3** | PR-08 ~ PR-09 | **可分发安装包**（这是用户要的最终目标） |
| **M4** | PR-18 ~ PR-25 | 功能补齐 |
| **M5** | PR-26 ~ PR-30 | 规范与工程化沉淀 |
| **M6** | PR-31 ~ PR-33 | 评估结论（可做可不做） |

---

## 10. 三个决策点（需先拍板）

| # | 决策 | 影响 PR | 说明 |
| --- | --- | --- | --- |
| **D1** | **能否恢复 git 历史（含 `upstream` 分支）？** | PR-00 → PR-01 | 能 → 直接用 v0.9.1 原生 Electron（最省事）；不能 → 用 desktop 0.7.16 模板适配（+1~2 天） |
| **D2** | **桌面端要不要做分发（自动更新 + CI + Cask）？** | PR-11 | 只是自用 → **不做**，M3 完成即收工；要给别人用 → 必做 |
| **D3** | **ConversationPlan 是否依赖 rpiv-todos 扩展？** | PR-19 | 依赖 → 直接搬；不依赖 → 需泛化成通用 todo 面板（成本 +50%） |

**另有一个口味决策**：PR-25（输入框塌陷）是 UI 口味项，建议实现后**实际用几天再决定是否保留**。

---

## 11. 明确不做的清单（避免误排期）

| 不做 | 理由 |
| --- | --- |
| **TanStack Start + Vite + Nitro 迁移** | 57k 行 + 自制 skin + 自制 `next-mode.mjs`；收益远小于成本，**负收益** |
| **CodexSidebar 整块替换** | 与 `SessionSidebar.tsx`（2280 行）功能集不重合；只挑归档 + 置顶（PR-20/21） |
| **整文件替换 `lib/rpc-manager.ts`** | 会丢 `withSessionReplacement` / `clone` / `fork_branch` 与 liveness 保护。PR-12 只加两个函数 |
| **把六套色板收敛成两模式** | 与 Codex skin 产品定位直接冲突 |
| **Bazel / Nix / Rust 原生层** | 纯 TS 项目无原生产物 |
| **打包 agent 二进制** | License 合规红线（mcode `AGENTS.md` 明写） |
| **照搬 mcode 的「无 lint / CI 只 typecheck」** | 本仓库有 191 个测试 + eslint，不应降级 |
| **`webPreferences.sandbox: false`** | mcode 为兼容旧依赖放开；新代码应保持 `sandbox: true` |
| **裸 `fetch` 做下载** | undici 不读 `*_proxy`，且把故障压成无信息的 `fetch failed`；应走 curl |

---

## 12. 立刻可做的三件事

如果只想先动起来，按这个顺序：

1. **PR-00**（git 基线）—— 不做这个，后面全是空谈
2. **PR-12**（running SSE）—— 与桌面端完全解耦，收益立竿见影，风险最低
3. **PR-03**（桌面工程防御）—— 若已开始桌面线，这个必须早做，否则调试全靠猜

然后按 §9 的里程碑推进。
