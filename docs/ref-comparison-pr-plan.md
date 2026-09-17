# 参考项目对比与 PR 拆分计划

日期：2026-09-16
现状分支：`desktop-release`（`@agegr/pi-web` 0.9.1，Next.js 16.3.1 + pi SDK 0.85.1）
已有对比文档：`docs/fork-comparison-2026-09-16.md`（三方代码级对比，本文不再重复贴行号细节，细节以那篇为准）

本文目标：把 `~/Downloads/pi参考项目` 下三个参考项目的**不一样点**、**可借鉴点**固定下来，
并拆成一个个可独立落地的 PR（含范围、涉及文件、风险、验收标准），供逐个评审执行。

---

## 1. 参考项目概览

| 代号 | 路径 | 版本 | 一句话定位 |
| --- | --- | --- | --- |
| 上游 | `pi参考项目/pi-web-0.14.6` | `@agegr/pi-web` 0.14.6 | 官方最新，已从 Next.js 迁到 **TanStack Start + Vite + Nitro**；SDK 反而稍旧（0.84.2） |
| desktop | `pi参考项目/pi-web-desktop-main` | `@iswitthere/pi-web-desktop` 0.8.10-f | 上游 0.7.16 的 Electron 桌面分支，UI 自主、服务端持续挑上游补丁；与我是兄弟分支 |
| MusePi | `pi参考项目/MusePi-main` | 自有版本 0.4.29（bun monorepo） | 不是上游 pi 本体，是独立下游分叉；其中 `packages/guest-client` 是只渲染不执行的 Guest 瘦客户端 + 桌面/移动共享渲染内核 |

规模对照（不含测试，来自已有对比文档）：我 lib 130 / components 50 / hooks 11 / API 路由 56 / 约 57k 行；
上游 lib 100 / components 37 / hooks 12 / 路由 45 / 约 43k 行；
desktop lib 126 / components 46 / hooks 18 / 路由 48 / 约 57k 行。

---

## 2. 不一样的点

### 2.1 架构层

| 维度 | 我（0.9.1） | 上游 0.14.6 | desktop 0.8.10-f | MusePi guest-client |
| --- | --- | --- | --- | --- |
| 框架 | Next.js App Router + Turbopack，`app/api/**/route.ts` 用 `NextRequest/NextResponse` | TanStack Start + Vite + Nitro；`app/api` 改为框架中立 `Request/Response`，`src/routes/api/*` 只做薄适配 | Next.js（16.2.12），`NextRequest/NextResponse` | 全静态 SPA（`dist/`），无服务端，直连 relay WebSocket |
| 会话执行 | 进程内 `AgentSession`（`lib/rpc-manager.ts` 直调 SDK） | 同路，但 `rpc-manager` 简化（删 `clone`/`fork_branch`，fork 经 `SessionManager.createBranchedSession`） | 同路，`rpc-manager` 更短（1603 行） | **不执行**，只经 relay 看直播 + 发言/中断 |
| 构建/发布 | `next build --webpack`，dev/prod 共用 `.next`（`scripts/next-mode.mjs` 兜底） | 输出到**仓库外** `PI_WEB_TANSTACK_OUTPUT_DIR`，`standalone/publication` 双模式 | `next build` + electron-builder（nsis/portable/dmg/AppImage） | `bun run build` 出 content-hash 静态站 |
| 桌面壳 | 无 `electron/`（dmg 在仓库外打） | 无 | `electron/main.js` 839 行 + `preload.js` + 独立通知窗口 | Electron/Capacitor/ArkTS 三壳共用同一渲染 bundle |
| 测试 | `node --test` 约 190 个 `.test.mjs` + `e2e/*.mjs` | 167 个 + Playwright（含 subagent 会话 e2e） | 无统一 test 脚本 | codec/i18n/widget-parity 等 |
| 图标/字体 | 自绘 SVG，无图标库依赖 | lucide-react + @lobehub/icons，`@fontsource-variable/noto-sans-mono` | Phosphor Icons + @lobehub/icons，`@fontsource/ia-writer-quattro/lilex` 本地字体 | 自有 widget 主题 token |
| i18n | en / zh-CN / zh-TW | en / zh-CN / ja / ru | en / zh-CN | 按域拆分词表，en 文件 `satisfies Record<ZhKey,string>` 编译期 parity |

### 2.2 功能层（各方独有）

- **我独有**：终端（xterm + node-pty）、MCP 面板、Web Push、Provider 用量查询、Markdown WYSIWYG（ProseMirror）、
  内嵌 subagent 全系列（`subagents.ts` + `subagent-runtime.ts` + 运行时 Agent 派发 + ADR 0003 开关）、
  `AgentSessionPanel`、`Browser` 面板、`ToolDefinitionsPanel`、`SystemPromptPanel`、3 语 i18n、Codex skin 体系。
- **上游独有**：subagent 可视化树（外部 pi-subagents 扩展协议）、`ConversationPlan` 待办面板、`CodexSidebar`
  （项目 pin/archive/order + 会话归档 + 最近会话）、running SSE、`text-delta-batcher`、`token-speed`、
  `session-relations`、`DialogShell`、`GitChangesPanel`、`RemoteAccessConfig`、`TaskHeader`、`files/upload`。
- **desktop 独有**：PI-TUI 主题 JSON 兼容（51 token → CSS 变量映射）、进程分组显示（timeline/tabs）、
  Git 图谱 Tab、自绘标题栏 + 托盘 + 独立通知窗口 + 原生目录选择、右栏多类型 tab keep-alive、工作区标签页、
  欢迎大厅 + 跨编辑器最近项目、壁纸层、`ui-scale`、`input-compact`。
- **MusePi 独有思路**：每工具一文件的 React renderer + 打包成单文件 IIFE 注入 HTML 导出（在线/导出同构渲染）；
  `<omp-tool-view>` WebComponent 让主 transcript / subagent 抽屉 / 静态导出三宿主复用；
  协作帧分类（entry/event/state/bus/agents）；完整/只读两档链接（密钥只放 URL fragment，relay 零知识）；
  `local-relay` + `mock-host` 离线联调三件套。

### 2.3 我已领先、反而不要反向搬旧代码的地方

- Fork：`withSessionReplacement("fork"|"clone")` + `fork_branch`/`clone`，上游已无 clone —— 以上游为准会**丢能力**。
- 会话 liveness：我有 `session-liveness.ts` 199 行 + `PI_WEB_IDLE_TIMEOUT_MS`，上游已删（只剩硬编码 10 分钟）。
  搬上游 `rpc-manager.ts` 必须只搬片段，**整文件替换会让扩展失去 liveness 保护**。
- Chat-only：我是 `chat-only.ts` + ADR 0002（重建 wrapper，用 context files 替换系统提示），上游是粗暴清空。
- 历史分页：我用 `sliceActiveBranch()` 自切（正确），不要改回 SDK 的 `buildContextEntries`（会静默丢历史）。
- 列表版本：`getSessionListVersion()` + 读不 bump（有测试覆盖），保持。

---

## 3. 可借鉴点（按性价比）

### A 级 — 改动小、收益直接

| 编号 | 借鉴点 | 来源 | 移植量 |
| --- | --- | --- | --- |
| A1 | running 状态改 SSE，替代侧边栏 2.5s 轮询 | 上游 `app/api/agent/running/events/route.ts` + `subscribeRunningSessions()` | ~80 行 |
| A2 | 流式 `text_delta` 按帧（rAF）合批，减少重渲染 | 上游 `lib/text-delta-batcher.ts` + `useAgentSession` 接入 | 55 行 + 1 接入点 + 1 测试 |
| A3 | 队列消息单条编辑/删除/立即插话（`queue_remove`/`queue_edit`/`queue_steer_item`/`queue_steer_all`） | 上游 `rpc-manager` + `ChatInput QueueStrip` | 中；注意上游自认的 clear+requeue 竞态 |
| A4 | 用会话名正则认领 TUI 侧外部 pi-subagents 子会话 | 上游 `lib/session-relations.ts` 59 行 | 59 行 + `SessionInfo` 扩展 + 侧边栏过滤 |
| A5 | token 估算提到 `lib/token-speed.ts` 并加 tok/s 显示 | 上游 `token-speed.ts`；我已有内联估算在 `MessageView` | 搬运 + 1 处 UI + 开关 |
| A6 | 会话归档（localStorage）+ 项目 pin/archive/排序（`~/.pi/agent/pi-web-projects.json`） | 上游 `archived-sessions.ts` + `project-registry*.ts` + `recent-sessions.ts` | ~200 行 + 侧边栏 UI |
| A7 | Git 变更 review 面板 + Git 图谱（纯函数泳道机，不用 `git --graph`） | desktop `git-graph*.ts` + `/api/git/log` + `GitGraphTab` | lib 纯函数可直搬；JSX 按我方 UI 重写 |
| A8 | pi TUI 主题 JSON 解析层（只搬解析，不搬映射） | desktop `lib/theme.ts`（450 行纯逻辑可搬） | 解析直搬；51→23 映射按我方 `globals.css` 重画 |

### B 级 — 中等改动

| 编号 | 借鉴点 | 来源 | 备注 |
| --- | --- | --- | --- |
| B1 | `ConversationPlan` 待办常驻面板 | 上游 | 为 rpiv-todos 扩展定制的解析器，先确认是否依赖该扩展 |
| B2 | 右栏多类型 tab + keep-alive（切换不重拉） | desktop `tab-model` + `right-tabs-memory` | 与 A7 联合规划；改后删 `FileViewer` unmount 快照 |
| B3 | 阅读时收起输入框（方向感知状态机） | desktop `input-compact.ts` | UI 口味；塌陷阈值与方向判定别简化 |
| B4 | 工作区标签页（多项目切换不丢状态） | desktop `workspace-tabs` 系 | 先做 B2 再做此项 |
| B5 | Electron 外壳加固点（`fork()` 启动、非 `isPackaged` 判断、服务复用、原生目录选择、拖拽取路径、通知窗口去重） | desktop `electron/` | 取决于是否把打包收进仓库 |
| B6 | 欢迎大厅 + 跨编辑器最近项目（只读） | desktop `WelcomeLobby` + `recent-projects` | 取决于是否需要“猜项目” |
| B7 | 统一对话框 shell（焦点陷阱/Esc/aria） | 上游 `DialogShell` | 我方仅 `ProjectTrustDialog`，收益明确 |

### C 级 — 只参考思路，不移植

- C1 上游 subagent 树：协议与我方内嵌 subagent 不兼容，只抄合并原则（磁盘祖先定形状，实时数据只覆盖状态，缺失标 `inactive`，不编造终态）。
- C2 `CodexSidebar` 整块替换：不做，只挑 A6 两块能力接现有侧边栏。
- C3 `reasoning-router`：改 agent 语义，默认不开。
- C4 TanStack 迁移：57k 行 + 自制 skin，负收益，不跟。
- C5 MusePi 协作体系（relay/daemon/Guest）：单机 Web UI 不需要；只在未来做“分享链接给手机看”时抄其分帧与链接即权限模型。
- C6 MusePi `mock-host`/`local-relay`：做 SSE/工具流联调时可照做一套假 Host（归入测试基建，不单独成产品 PR）。

---

## 4. PR 拆分计划

> 每个 PR 独立分支、可独立合入、有验收标准。顺序见 §5。
> 通用要求（每个 PR 必做）：`node_modules/.bin/tsc --noEmit` 通过；新增/搬运的 `lib/*.ts` 连同名 `.test.mjs` 一起搬；
> 全局变量走 `globalThis`（热重载安全）；路径比较用 `samePath()`；写私文件用 `writePrivateFileAtomicSync` + `proper-lockfile`；
> 带副作用的 hook 保证 unsubscribe 幂等（StrictMode 双调用）。

### PR-01（docs）：更新 AGENTS.md 的 fork 段落

- 目标：AGENTS.md 里“Fork must destroy the wrapper immediately”已是旧实现，代码早已是 `createBranchedSession` + `withSessionReplacement`；同步文档，避免后人误改。
- 范围：仅 `AGENTS.md` 一段 + 本文档链接。
- 风险：零。
- 验收：文档描述与 `lib/rpc-manager.ts` 当前实现一致。

### PR-02（A1）：running 状态 SSE 化

- 目标：新增 `GET /api/agent/running/events`（SSE：先订阅再快照 + 30s 心跳），`rpc-manager` 加 `subscribeRunningSessions()/notifyRunningChange()`（`globalThis.__piRunningListeners`），侧边栏 `setInterval` 2.5s 轮询改为 `EventSource`。
- 涉及：`app/api/agent/running/events/route.ts`（新）、`lib/rpc-manager.ts`（加一段）、`components/SessionSidebar.tsx`（订阅替换轮询）。
- 不动：`sessionListVersion` 机制（SSE 只推 running id，跨窗口列表变更仍走版本号）。
- 坑：订阅→快照顺序、心跳穿代理、无订阅者时清空快照（上游注释三条照抄）。
- 验收：空闲时无轮询请求；开/停 agent 时徽标零延迟更新；多标签页一致。

### PR-03（A2）：`text-delta-batcher` 流式合批

- 目标：新增 `lib/text-delta-batcher.ts`（55 行，按帧合并同 `contentIndex` 的 `text_delta`），`hooks/useAgentSession.ts` 的 `text_delta` 分支接入；附 1 个 `.test.mjs`。
- 验收：长回复肉眼流畅度不变，React 更新次数下降（可打点验证）；`contentIndex` 切换/flush/dispose 顺序正确。

### PR-04（A4）：认领外部 pi-subagents 会话

- 目标：新增 `lib/session-relations.ts`（会话名正则 `^subagent-(<agent>)-<runId>(-\d+)?$` 推断关系 + 上走到根 + `activeSessionRoots()`），`SessionInfo` 加可选字段，侧边栏过滤 `sessionRole === "subagent"`。
- 验收：TUI 里用外部扩展建的子会话在 Web 侧边栏不再混入 fork 树；running 上浮到根行。

### PR-05（A5）：token 估算提 lib + tok/s

- 目标：把 `MessageView.tsx` 内联估算搬到 `lib/token-speed.ts`（`computeStreamingTps`/`billedOutputTokens`/`estimateStreamingTokens` 带缓存），消息统计处显示 tok/s，加 `useTokenSpeedPreference` 开关。
- 验收：`MessageView` 减约 50 行；流式时显示速度；reasoning > output 时按 `output + reasoning` 计费口径。

### PR-06（A6）：归档 + 项目注册表

- 目标：`lib/archived-sessions.ts`（localStorage）+ `lib/project-registry*.ts`（`~/.pi/agent/pi-web-projects.json`，`pinned/archived/removed/order/name`，加锁写）+ `lib/recent-sessions.ts`；侧边栏接归档 + 置顶/排序 UI。
- 坑：路径键 Windows 比较用 `samePath()`；归档只写自家注册表，不改名/删 `.jsonl`。
- 验收：pin/archive/order 重启持久化；归档会话不出现在主树。

### PR-07（A3，可选）：队列单条操作

- 目标：`rpc-manager` 加 `queue_remove`/`queue_edit`/`queue_steer_item`/`queue_steer_all`（底层复用现有 `clearQueue/steer/followUp`），`ChatInput` 加 `QueueStrip`。
- 坑：保留上游竞态注释；streaming 中可只允许“立即插话”禁用编辑/删除。
- 验收：排队消息可单条改/删/插话；并发场景不丢消息（注释 + 手测）。

### PR-08（B7）：统一 `DialogShell`

- 目标：新增 `components/DialogShell.tsx`（焦点陷阱、Esc、aria），`ProjectTrustDialog` 先接， 后续对话框跟进。
- 验收：键盘/无障碍行为统一；现有对话框视觉不变。

### PR-09（A7）：Git 图谱 + 变更面板（分两步）

- 步骤 1（lib+API）：直搬 `lib/git-graph*.ts`（纯函数 + 测试）+ 新增 `/api/git/log`。
- 步骤 2（UI）：按我方 UI 重写图谱/变更面板（不搬 desktop JSX），与 B2 联合规划 tab 类型。
- 验收：不离 pi-web 看提交历史/分支结构/逐文件 diff；几何不依赖 `git --graph`。

### PR-10（B2）：右栏多类型 tab + keep-alive

- 目标：引入判别联合 tab-model（`file`/`changes`/`git-graph`）+ `right-tabs-memory` 按 workspace 持久化；切换用 CSS 隐藏常驻组件。
- 坑：删 `FileViewer` unmount 快照机制（两套状态打架）；tab 只保留初始显示模式种子值。
- 验收：切换 tab 不重拉、不丢滚动；与 PR-09 联调。

### PR-11（B5）：Electron 外壳加固（按需，详见 §7）

- 目标（可再拆）：生产用 `fork()` 而非 `spawn(execPath)`；`resources/app[.asar]` 存在性判断替代 `isPackaged`；
  启动先探测复用已有 30141 服务；原生目录选择 IPC；`webUtils.getPathForFile` 拖拽取路径；通知窗口去重/TTL/hover 暂停。
- MusePi 方向（§7，长期）：daemon 二进制化 + `vendor/daemon` 随包 + electron-updater OTA + CI 矩阵发布。
- 注意：我方已有 Web Push（跨设备），通知窗口是本机场景，不冲突。
- 验收：打包后启动/托盘/通知/目录选择全链路可用。

### PR-12（B6，可选）：欢迎大厅 + 最近项目

- 目标：无工作区时 Lobby；只读扫描 VS Code 系/Zed/Claude/Codex/OpenCode 最近项目去重推荐。
- 坑：VS Code 读库 `node:sqlite` 不可用时降级 JSON；只读不写别家数据。
- 验收：冷启动推荐可用；无数据源时静默降级为空态。

### PR-13（B1/B3/A8，按需三选一或全不做）

- B1 `ConversationPlan`：先确认是否用 rpiv-todos 扩展，否则不做。
- B3 `input-compact`：纯 UI 口味，方向判定不可简化。
- A8 pi 主题 JSON：先回答“要 ecosystem 还是要更多配色”——后者直接在我方 6 套里加配色，成本远低。

### 明确不做的

- 上游 `rpc-manager.ts` 整文件替换；`CodexSidebar` 整块替换；TanStack 迁移；`reasoning-router` 默认开启；
  `RemoteAccessConfig`（已有 `web-auth` 等价）；`files/upload`（已有等价实现）。

---

## 5. 建议执行顺序

```
第一梯队（各 1 天内，独立低风险）: PR-01 → PR-02 → PR-03 → PR-04 → PR-05
第二梯队（2-3 天）              : PR-06 → PR-07(可选) → PR-08
第三梯队（一周，需联合设计）      : PR-09 ─┐
                                   PR-10 ─┴─ 一起规划 → PR-11/PR-12 看需求
第四梯队（看需求，可能不做）      : PR-13 三项各自决策
桌面深化（按需，前置 PR-11）      : PR-14（主进程结构重整）→ PR-15（OTA + CI 矩阵发布），详见 §7
```

## 6. 参考文件索引

- 上游关键新增：`app/api/agent/running/events/route.ts`、`app/api/projects/route.ts`、
  `app/api/remote-access/route.ts`、`lib/text-delta-batcher.ts`、`lib/session-relations.ts`、
  `lib/project-registry*.ts`、`lib/archived-sessions.ts`、`lib/recent-sessions.ts`、
  `lib/token-speed*.ts`、`lib/subagent-tree.ts`（只看合并原则）、`components/DialogShell.tsx`。
- desktop 关键新增：`electron/main.js` + `preload.js` + `notification-window.html`、
  `lib/theme.ts` + `lib/themes/`、`lib/git-graph*.ts` + `GitGraphTab.tsx`、
  `components/AppTitleBar.tsx`、`components/WelcomeLobby.tsx`、`lib/recent-projects.ts`、
  `lib/input-compact.ts`、`lib/ui-scale.ts`、`lib/wallpaper.ts`、`tab-model.ts` + `right-tabs-memory.ts`。
- MusePi 关键参考：`packages/guest-client/scripts/build-tool-views.ts`、
  `packages/guest-client/src/tool-render/`、`*mock-host.ts`/`local-relay.ts`、`docs/collab.md`、`docs/gui-design.md`。
- MusePi 桌面打包：`packages/desktop-app/package.json`（build 段）、`electron/*.cjs`、
  `scripts/dev-desktop.mjs`/`relaunch-gui.mjs`/`fix-dist-html.mjs`/`build-haptic.mjs`、
  `.github/workflows/gui-release.yml`。详见 §7。

---

## 7. MusePi 桌面打包链路详解与借鉴

> 范围：`MusePi-main/packages/desktop-app`（`@musepi/desktop-app` 0.4.29）+ 仓库根 `gui-release.yml`。
> 看完结论：MusePi 和我方是**两种桌面架构**——它是“瘦壳 + daemon 二进制 + 静态渲染包”，
> 我方是“Electron 套 Next server（267 行 `electron/main.js`，spawn 起服务）”。
> 短期只能抄散点（D1–D4），D5 之后是换架构才划算的事，已对应到 PR-11 与新增 PR-14/15。

### 7.1 总览

```
MusePi 安装包内容                    运行时关系
┌─────────────────────────┐
│ dist/          静态渲染包 │──── Electron BrowserWindow loadFile()
│ electron/      主进程    │
│ vendor/daemon/ musepi    │──── detached 子进程 `musepi serve --port P`
│   (asarUnpack, 可执行)    │         │ JSON-RPC over WebSocket
│ *.node         原生模块  │◀────────┘ (napi, asarUnpack 解出)
│   (asarUnpack)          │
└─────────────────────────┘
发现机制：daemon 启动后把端口写到 `$TMPDIR/musepi-daemon/ws.port`，
         Electron 读文件 + TCP 连通双重确认才算就绪。
归属机制：谁 spawn 谁负责收尸——`client.pid` 存 spawner pid，只有属主退出时才杀 daemon；
         crash 走不到 quit 路径，daemon 故意活下来不断连。
```

与我方对照：

| 维度 | 我方现在 | MusePi |
| --- | --- | --- |
| 包内服务形态 | Next server（`spawn(process.execPath, [nextBin])`，动态端口） | 编译好的 `musepi` 二进制（`vendor/daemon`），固定协商端口 |
| 渲染包 | `.next`（服务端渲染） | `dist/` 纯静态（`bun build index.html/pet.html/pin.html/tray-menu.html`，hash 命名） |
| 主进程 | 单文件 267 行 | 拆模块：`main.cjs`（窗口/生命周期）+ `daemon.cjs`（纯 Node，可单测）+ `tray.cjs` + `updater.cjs` + `managed-browser.cjs` + `preload.cjs` |
| 更新 | 无（仓库外手打 dmg） | electron-updater OTA（GitHub feed）+ 手动安装包兜底 + `update-manifest.json` 发版说明 |
| 发布 CI | 无 | `gui-release.yml`：5 桌面矩阵 + 安卓 APK，打包→收产物→合并 feed→发 release |
| dev 联调 | `npm run dev:clean`（dev/prod `.next` 互斥） | `desktop:dev`：Vite HMR + Electron 指过去 + **数据隔离**（见 7.6） |
| asar | `asar: false`（平铺，`isPackaged` 恒 false 坑） | asar 打包 + `asarUnpack` 白名单（`*.node`、daemon、haptic helper） |

### 7.2 构建管线（`package.json` scripts + build 段）

- `build = tailwind → bun build(bundle) → 并行(pdf worker / fix-dist-html / haptic)`，产物只有 `dist/`。
- `pack = build && electron-builder --mac dir && codesign --deep --sign -`（本地 dir 包自签名验证）。
- build 段要点：`files` 只收 `dist/electron/vendor/node_modules/@musepi/pi-natives`（不像我方 `**/*` 大包围再排除）；
  `asarUnpack: ["**/*.node", "electron/haptic-helper", "vendor/daemon/**"]`——可执行与原生模块必须解出 asar 才能跑；
  `npmRebuild: false`（bun workspace 不重编）；mac `dmg+zip+dir` 三 target、`identity: "-"`（CI 无证书时 ad-hoc）、
  hardenedRuntime + entitlements 文件；win NSIS **assisted 非 one-click**（可改目录、逐用户免管理员、建桌面快捷方式、
  中英双语）；linux AppImage + deb 双 target；`publish.provider: github`。
- `fix-dist-html.mjs`：bun 1.3.14 给产物打 `crossorigin`，`file://` 下 Chromium 会 CORS 拒载白屏，
  构建后统一 strip——凡静态 `loadFile` 方案都要有这一步（我方 `.next` 服务端渲染无此问题，迁静态方案时才需要）。
- `build-haptic.mjs`：`clang` 现场编译 ObjC 小工具（macOS 触感），非 darwin/无 clang 静默跳过、功能降级为 no-op。
  模式可学：可选原生能力 = 构建期编译 + 运行时探测 + 失败降级，三处缺一不可。

### 7.3 daemon 生命周期（`electron/daemon.cjs`，364 行，纯 Node 无 electron 依赖）

- `probe()`：读 `ws.port` 文件取端口；`probeWeb()`：读 `web.port` 取兼容渲染地址。
- `daemonCommand(port)` 解析顺序：**包内 `app.asar.unpacked/vendor/daemon` → dev checkout（`bun cli.ts serve`）→ PATH**。
  包内置于 PATH 之前——理由写在注释里：PATH 上可能有卸载残留的 shim，spawn 瞬间退出会误报。
  另有胖二进制校验：<256KB 且缺 `.bunx` 兄弟文件的候选直接跳过（bun shim 特征）。
- `start(port)`：detached + `stdio: ignore` + `windowsHide: true`（Windows 下子进程弹黑窗，opencode/kimi 同款修法）+
  `MUSEPI_VERSION` 品牌版本号注入；就绪条件是“`ws.port` 值 == 我要的端口 **且** TCP 能连上”（防陈旧文件误认）；
  成功后写 `client.pid` 确权；shell 关闭时删陈旧 `web.port` 防下次误加载。
- `kill(port)`：`listenerPid()` 查占用者（Windows 用 `netstat -ano`，mac/Linux 用 `lsof -tiTCP:port -sTCP:LISTEN`，
  注释点名旧代码在 Windows 上 `spawn("lsof")` 永远失败导致杀不掉），SIGTERM 3s → SIGKILL 2s 两级升级，
  否则 restart 会新旧并存（EADDRINUSE 或静默服务旧进程）。
- `killOwnedDaemon()` / `ownsDaemon()`：quit 时只杀自己生的 daemon；连上别人的（另一实例、自启、终端手起）必须留活。
- `before-quit`  hold 住退出（`event.preventDefault()`），异步杀完再 `app.quit()`——Electron 不等待异步 quit handler，
  不 hold 就会杀一半退出。

### 7.4 OTA（`electron/updater.cjs` 520 行 + `gui-release.yml` publish job）

- `electron-updater` v6，`autoDownload: false` + `autoInstallOnAppQuit: false`，状态机
  `idle/checking/preparing/downloading/downloaded/error` 推给渲染器；Windows 任务栏进度条同步。
- `checkForUpdates()` 把 feed 版本比对 + `update-manifest.json`（notes+手动包 URL）并行拉一次返回，
  给 toast 一次到位的“有新版 + 更新说明 + 下载按钮”。
- **签名探测**（macOS）：`codesign -d -r-` 看 designated requirement，ad-hoc（cdhash-only）签名的包
  Squirrel 永远装不上更新——探到就 `otaCapable: false`，渲染器改推手动下载 dmg（经 Chromium session 下载、
  落 Downloads、自动 `openPath` 挂载），而不是放一个点了没反应的按钮。
- `quitAndInstall()` 15s grace：Squirrel 的失败是异步 `error` 事件，超时未报错才算“正在重启安装”，
  失败则状态回滚到 `downloaded` 可重试。另有 `updater.log` 文件日志（打包后 console 不可见，
  “重启还是旧版”类问题无日志不可查）。
- 发版侧：beta tag（`v*-beta*`）写 `-c.publish.channel=beta`，stable 客户端 `allowPrerelease=false` 看不到；
  Windows x64/arm64 各自产出同名 `latest.yml` 会互踩——CI 里改名 `latest-win-<arch>.yml` 再合并成一个多 `files[]` 的
  `latest.yml`（v0.4.16/0.4.17 曾因合错 arch 推错安装包，注释里有复盘）；release body 与 manifest 的 changelog
  取“第一个 `## [x.y.z]` 节”（跳过尾部 `[Unreleased]`），由 CI 从 CHANGELOG 现场生成。

### 7.5 主进程拆分与窗口/原生细节（`main.cjs` 3037 行）

- 单实例锁 + dev 期 `userData` 隔离（见 7.6）；`close → hide` 到托盘（仅非 darwin），真退出走托盘 quit → `before-quit`。
- 窗口材质走**平台原生**而非 CSS 仿：macOS `vibrancy: under-window` + 透明底；Win11 `backgroundMaterial: acrylic`
  （DWM 合成，窗口保持不透明，注释记录透明窗口在 Win 下闪烁、软渲染 119 个 backdrop-filter 面卡的教训）；
  Win/Linux 用 `titleBarOverlay`（透明色 + 48px 高与 header 对齐）补原生最小/最大/关闭。
- preload 桥按最小权限拆 `invoke/on` 对（daemon、窗口、剪贴、通知、OTA、pet、managed-browser、tray-menu），
  `contextIsolation + sandbox`，注释标明 HTML5 Notification 在 macOS 不冒泡所以走主进程 `Notification`。
- 稳健性散点：`render-process-gone` 非 clean-exit 自动 reload（daemon 重连恢复会话）；`setWindowOpenHandler` +
  `will-navigate` 双层外链拦截（http(s) 走系统浏览器，站内才放行）；`resolveCompatUrl` 对 `web.port` 做
  TCP 存活校验，陈旧文件 fallback 本地 bundle 永不白屏；主窗口 bounds 持久化 + 按当前显示器 workArea 钳位
  （拔掉外接屏不丢窗）；GPU 默认强制开、`OMP_SOFTWARE_GL=1` 才退软件渲染。

### 7.6 dev 流程（`dev-desktop.mjs` / `relaunch-gui.mjs`，血泪注释型脚本）

- `desktop:dev` = 起 Vite（`--strictPort`）→ 等端口 → `MUSEPI_GUI_DEV=1` 起 Electron 指 dev server；
  Electron 退出即杀 Vite。两个防呆都是线上复现过的：①先扫掉本仓库残留 Electron（单实例锁会让新进程直接退出、
  老冻窗被聚焦，表现为“启动了但卡住”）；②`:5173` 已有占用直接报错退出，绝不把 Electron 指到未知 dev server。
- **dev 数据隔离**：dev 实例的 `PI_CONFIG_DIR` / `MUSEPI_DAEMON_DIR` / Electron `userData` 全指到
  `.desktop-build/development/` 下，`requestSingleInstanceLock` 的锁文件也随之隔离——dev 与用户正式安装
  可并存，互不读写对方会话；`MUSEPI_GUI_DEV_SHARED_DATA=1` 可退出隔离。匹配器只杀本仓库路径下的 Electron
  二进制，不碰用户别的 App。
- `desktop`（prod 验证）= `build` → 先杀残留实例（`rm -rf dist` 后老窗口仍跑旧包，不杀就叠窗）→ `electron .`。

### 7.7 可借鉴清单（D 系列，对应 PR）

| 编号 | 借鉴点 | 落到哪个 PR | 成本 |
| --- | --- | --- | --- |
| D1 | `files` 白名单 + `asarUnpack`（`*.node`/可执行/daemon 解出 asar） | PR-11（打包收进仓库时） | 小 |
| D2 | quit 只杀自己生的服务（`client.pid` 确权 + `before-quit` hold 住异步清理） | PR-11 | 小 |
| D3 | 查端口占用者跨平台两套实现（`netstat -ano` / `lsof -tiTCP:port`，一次参数） | PR-11（服务复用/重启逻辑） | 小 |
| D4 | dev 数据隔离（dev userData/daemon 目录独立 + 残留进程先杀 + 端口占用硬失败） | PR-11（或 dev 脚本 PR） | 小 |
| D5 | 主进程拆模块（daemon 纯 Node 可单测；updater/tray/浏览器各一模块） | PR-14（Electron 结构重整） | 中 |
| D6 | preload 最小桥 + sandbox + 双层外链拦截 + 白屏永不 fallback（存活校验） | PR-14 | 中 |
| D7 | 窗口原生材质（mac vibrancy / Win11 acrylic / titleBarOverlay）+ bounds 钳位 + 渲染崩溃自恢复 | PR-14（UI 味） | 中 |
| D8 | electron-updater OTA 全套（状态机、任务栏进度、签名探测、手动画包兜底、updater 文件日志、beta 通道） | PR-15（OTA） | 大 |
| D9 | CI 矩阵发布（5 桌面 target + APK；daemon/原生模块先编再 `vendor/` 归位；`--publish never` 后收产物；Win 双 arch feed 合并；manifest+release notes 现场生成） | PR-15（发布基建） | 大 |
| D10 | 构建期后处理与可选原生能力三件套（`fix-dist-html` 类 CORS 修、clang 小工具编译+降级） | 按需，静态化/要原生能力时 | 小 |

### PR-14（新增，D5–D7）：Electron 主进程结构重整（按需）

- 目标：`electron/main.js` 按 MusePi 拆模块（daemon 纯 Node 可单测先行）；preload 收敛最小桥；
  窗口材质/外链策略/bounds/崩溃恢复照 D6–D7 做。
- 前置：先做 PR-11 的散点（D1–D4），确认要把打包收进仓库。
- 不做：pet 窗口、managed-browser、tray-menu 自绘——那是 MusePi 产品功能，不是打包链路。

### PR-15（新增，D8–D9）：OTA + CI 矩阵发布（按需，大）

- 目标：electron-updater 接入（D8 全套含签名探测与手动包兜底）+ `gui-release.yml` 同款矩阵 CI（D9）。
- 前置：包内服务形态先定——MusePi 的 OTA 假设“包内是 daemon 二进制 + 静态渲染包”；
  我方包内是 Next server，feed/回滚/版本比对要重写，不要生搬。
- 验收：beta 通道与 stable 隔离可验证；Win 双 arch 不再互踩（抄改名+合并）；发版说明由 CHANGELOG 现场生成。

