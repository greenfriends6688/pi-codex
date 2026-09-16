# 三份 pi-web 代码对比与可借鉴清单

对比对象：

| 代号 | 路径 | 版本 | 定位 |
| --- | --- | --- | --- |
| **我** | `/Users/yingjing/Desktop/pi-web-0.9.0` | `@agegr/pi-web` 0.9.1 | upstream pi-web 0.9.x 的 **Codex 风格分支**，叠加自己的大量二开 |
| **上游** | `/Users/yingjing/Downloads/pi-web-0.14.6` | `@agegr/pi-web` 0.14.6 | 官方最新，已从 Next.js 迁到 TanStack Start + Vite + Nitro |
| **desktop** | `/Users/yingjing/Downloads/pi-web-desktop-main` | `@iswitthere/pi-web-desktop` 0.8.10-f | upstream **0.7.16** 的 Electron 桌面分支，UI 自主，服务端持续挑上游补丁 |

日期：2026-09-16

---

## 0. 一句话结论

**你和 desktop 是兄弟分支**（同一支 subagent 代码、同一套 `workspace-memory` / `file-explorer-state` / `session-search` 血统），但分别往不同方向长：你往 Web 能力纵深（终端、MCP、推送、Markdown 编辑器、多语言），desktop 往桌面体验纵深（主题 JSON、进程分组、Git 图谱、Electron 外壳）。

**上游 0.14.6 反而是三者中最「不一样」的**——它换了框架，UI 也重做了。它值得抄的是一批**小而独立的行为修正**（running SSE、text-delta 批处理、队列单条编辑、归档/置顶），不是整套组件。

规模对照（不含测试）：

| | lib | components | hooks | app/api 路由 | ts/tsx 行数 |
| --- | --- | --- | --- | --- | --- |
| 我 | 130 | 50 | 11 | 56 | 57,465 |
| 上游 | 100 | 37 | 12 | 45 | 42,653 |
| desktop | 126 | 46 | 18 | 48 | 56,879 |

---

## 1. 血缘关系

```
                     upstream pi-web
                    /              \
          0.7.16 桌面分支        0.9.x
                |                    \
   pi-web-desktop-main           pi-web-0.9.0 (我, Codex skin)
   (0.8.10-f)                         │
        │                             ├─ terminal / node-pty
        │                             ├─ MCP 面板
        │                             ├─ Web Push
        │                             ├─ Provider 用量查询
        │                             ├─ Markdown WYSIWYG 编辑器
        │                             ├─ 内嵌 subagent（ADR 0003）
        └───────── 互相挑补丁 ────────┘
                                      │
                              upstream 0.14.6
                              (TanStack 迁移，不跟进)
```

验证：`lib/` 下我与 desktop **完全字节相同**的文件有 14 个，包括 `path-security.ts`、`session-stats.ts`、`search-tree.ts`、`subagent-input.ts`、`skill-lock.ts`、`tool-preset-preference.ts`。我和上游完全相同的文件有 41 个（因为同源）。

---

## 2. 架构层差异

| 维度 | 我 | 上游 0.14.6 | desktop |
| --- | --- | --- | --- |
| 框架 | Next.js 16.3.1 App Router + Turbopack | **TanStack Start + Vite + Nitro** | Next.js 16.2.12 |
| API 形态 | `NextRequest`/`NextResponse` | 框架中立的 `Request`/`Response`，`src/routes/api/*` 是薄适配层 | `NextRequest`/`NextResponse` |
| 构建 | `next build --webpack`，dev/prod 共用 `.next`（有 `scripts/next-mode.mjs` 兜底） | 输出到仓库外 `PI_WEB_TANSTACK_OUTPUT_DIR` | `next build` |
| SDK | `pi-coding-agent` **0.85.1**（pin） | `0.84.2` | `^0.85.1` |
| 桌面外壳 | 无 `electron/`（打包在仓库外，`release/pi-web-0.9.1-arm64.dmg`） | 无 | `electron/main.js` 839 行 + preload 58 行 |
| 测试 | `node --test` 190 个 `.test.mjs` + `e2e/*.mjs` | 167 个 + Playwright | 无统一 test 脚本 |
| 图标 | 自绘 SVG / sprite，**无图标库依赖** | lucide-react + @lobehub/icons | **Phosphor Icons** + @lobehub/icons |
| i18n | en / zh-CN / zh-TW（3 语言，各 778 行） | en / zh-CN / ja / ru | en / zh-CN |

> **移植便利点**：上游 0.14.6 的 **45 个 `app/api/**/route.ts` 全部**用的是原生 `Request`/`Response`（唯一的 `NextRequest` 残留在一个测试文件里），和 Next 的差异只在少数字段。搬上游路由时把 `NextRequest` → `Request`、`NextResponse.json(x)` → `Response.json(x)`、`request.nextUrl.searchParams` → `new URL(request.url).searchParams` 就能用；反正你的 56 个路由里有 49 个已经在用 Next 类型，只需要在**新搬进来的那几个**里做适配。这是三者之间最容易直接搬运的部分。

---

## 3. 三方独有能力清单

### 3.1 我独有的（57k 行里的增量）

终端（xterm + node-pty）、MCP 服务器面板、Web Push 推送、Provider 用量查询（`provider-usage.ts` 410 行）、Markdown WYSIWYG 编辑器（ProseMirror）、内嵌 subagent 全系列（`subagents.ts` 603 + `subagent-runtime.ts` 587 + `subagent-extension.ts` 313，含内置开关 + 运行时 Agent 派发）、`AgentSessionPanel` subagent 切换面板、Browser 面板、`ToolDefinitionsPanel`、`SystemPromptPanel`、`ExplorerPanel`（文件树在右栏）、`TurnWrittenFiles`、`web-auth` 密码登录、`provider-usage`、`bash-output` 流、session 全量搜索、3 语 i18n、Codex skin 体系（`docs/codex-skin/`）。

### 3.2 上游 0.14.6 独有的

- **Subagent 可视化**（`subagent-tree.ts` 359 + `subagent-rpc.ts` 306 + `SubagentSessions.tsx` 785 + `useSubagentTree.ts` 209 + `/api/agent/[id]/subagents` 225）
- **ConversationPlan**（`ConversationPlan.tsx` + `goal-panel.ts` 200）—— 待办计划面板，轮次结束后保留
- **CodexSidebar**（1233 行）—— 项目注册表（pin/archive/remove/order 持久化到 `~/.pi/agent/pi-web-projects.json`）、会话归档、最近会话
- **running SSE**（`/api/agent/running/events` + `subscribeRunningSessions()`）—— 取代轮询
- **text-delta-batcher.ts**（55 行）—— 流式文本按帧合批
- **token-speed.ts**（85 行）+ `useTokenSpeedPreference` —— tok/s 显示
- **session-relations.ts**（59 行）—— 从会话名认领外部 pi-subagents 树
- `DialogShell` / 统一对话框、`GitChangesPanel`、`RemoteAccessConfig`、`TaskHeader`、`files/upload` 路由、`archived-sessions.ts`、`recent-sessions.ts`、`project-registry.ts`、`pi-cli.ts`、`reasoning-router.ts`、`prompt-generation.ts`

### 3.3 desktop 独有的

- **PI-TUI 主题 JSON 兼容**（`lib/theme.ts` 615 行 + 5 套内置主题 + `/api/themes`）—— 直接读 `~/.pi/agent/themes/*.json`，把 pi 的 **51 个颜色 token 映射到 ~23 个 CSS 变量**，含 256 色 → hex 转换、`vars` 引用解析、深/浅色成对解析、边框深度滑杆、View Transition 圆形揭示动画
- **进程分组显示**（`ProcessGroup.tsx` 1096 行 + `process-content.ts` + `step-categorizer.ts` + `step-visuals.ts` + `useProcessDisplayMode`）—— timeline / tabs 双模式，工具步骤按语义分类配色
- **Git 图谱**（`git-graph.ts` 100 + `git-graph-parser.ts` 54 + `git-graph-lanes.ts` 119 + `GitGraphTab.tsx` 617 + `/api/git/log`）—— 纯函数泳道状态机，不依赖 `git --graph`
- **右栏多类型 tab + keep-alive**（`tab-model.ts` + `right-tabs-memory.ts` 149）—— tab 一旦挂载就常驻，切换用 CSS 隐藏，不重新拉取
- **工作区标签页**（`workspace-tabs.ts` 164 + `useWorkspaceTabs` + `WorkspaceTabBar.tsx` 454）
- **欢迎大厅**（`WelcomeLobby.tsx` 471 + `recent-projects.ts` 404）—— 读 VS Code / Zed / Claude Code / Codex / OpenCode 的最近项目（含 `node:sqlite` 读 VS Code 数据库）
- **Electron 桌面外壳**（托盘、frameless 标题栏、独立通知窗口 `notification-window.html`、原生目录选择、`webUtils.getPathForFile` 拖拽取路径、窗口状态持久化）
- `SessionInfoBar`（上下文/成本）、`CompactionSummary`、`ChatConfig`/`DisplayConfig` 设置面板、`input-compact.ts`（阅读时收起输入框）、`ui-scale.ts`（CSS zoom 下 overlay 坐标换算）、`wallpaper.ts`、`title-generator.ts`、`PromptsConfig`

---

## 4. 值得借鉴的（按性价比排序）

### A 级 — 改动小、收益直接，建议做

#### A1. running 状态改用 SSE，去掉 2.5s 轮询 ★推荐第一个做

- **上游**：`app/api/agent/running/events/route.ts`（50 行）+ `lib/rpc-manager.ts` L1798-1830 的 `subscribeRunningSessions()` / `notifyRunningChange()`
- **我**：`components/SessionSidebar.tsx` 每 2.5 秒 `GET /api/agent/running`
- **移植量**：~80 行（含 `globalThis.__piRunningListeners` 注册表），侧边栏把 `setInterval` 换成 `EventSource`
- **收益**：running 徽标零延迟；空闲时网络请求降到 0
- **坑**（上游注释已写明，别踩）：
  1. 必须**先订阅再取初始快照**，否则快照与订阅之间有窗口漏事件
  2. `lastRunningSnapshot` 在无订阅者时要清空，否则新订阅者会拿到旧状态，第一次变更被误判成「没变」
  3. 需要 30s 心跳（`: \n\n`）穿过代理
  4. 你已有的 `sessionListVersion` 机制别删——SSE 只推 running id 集合，跨窗口的会话列表变更还是要靠版本号触发重载

#### A2. 流式文本按帧合批

- **上游**：`lib/text-delta-batcher.ts` 55 行，接在 `useAgentSession.ts` 的 `text_delta` 分支
- **移植量**：55 行 + 1 处接入 + 1 个测试
- **收益**：长回复时每帧最多一次 React 更新，而不是每个 token 一次；对你 2229 行的 `ChatWindow` 尤其明显
- **坑**：`contentIndex` 变化、显式 `flush()`、`dispose()` 必须**同步**下发，否则事件顺序错乱

#### A3. 队列消息支持单条编辑 / 删除 / 立即插话

- **上游**：`lib/rpc-manager.ts` L385-467（`mutateQueue` + `steerAllQueued`）+ L806-826（4 个新命令）+ `components/ChatInput.tsx` L359-600（`QueueStrip`，242 行）
- **我**：只能显示排队消息 + 整体 `onRecallQueue`，打错字只能清空重发
- **底层依赖已齐**：上游只用 `clearQueue()` / `steer()` / `followUp()`，你三个都有
- **新增命令**：`queue_remove`、`queue_edit`、`queue_steer_item`、`queue_steer_all`
- **坑（重要）**：上游自己的注释承认这是已知竞态——

  > pi has no single-item dequeue, and clear+requeue races against the agent loop pulling messages mid-flight.

  移植时保留这段注释；如果你想要更稳的行为，可以在 streaming 中禁用编辑/删除，只允许「立即插话」。**这是用户明确要的功能才做**，不是必须。

#### A4. 认领外部 pi-subagents 创建的子会话

- **上游**：`lib/session-relations.ts` 59 行 + `SessionInfo` 加 4 个可选字段（`sessionRole` / `rootSessionId` / `subagentAgent` / `subagentRunId` / `subagentIndex`）
- **原理**：用正则 `^subagent-(<agent>)-<runId>(-\d+)?$` 从**会话名**推断 subagent 关系，再向上走到根
- **我的缺口**：我的内嵌 subagent 靠 `pi-web:subagent` custom entry 认领，但用户在 **TUI 里**用外部 pi-subagents 扩展生成的会话，在我的侧边栏里会被当成普通 fork 显示
- **移植量**：59 行 + `SessionInfo` 扩展 + 侧边栏过滤 `sessionRole !== "subagent"`
- **收益**：跨 runtime 的会话归组一致（你在 TUI 和 Web 之间来回切换时不再看到错乱的树）
- **注意**：`activeSessionRoots()` 这个辅助函数把 running 状态上浮到根会话行，是附带的小福利

#### A5. 把 token 估算提到 lib 并加 tok/s 显示

- **我**：`estimateTokens` / `estimateUpdatedTokens` 已经内联在 `components/MessageView.tsx` L35-83（这段代码本身和 desktop 的 `MessageView.tsx` L115-165 几乎一样，说明同源）
- **上游**：提到 `lib/token-speed.ts`（85 行），增加了 `computeStreamingTps()`、`billedOutputTokens()`（注意 reasoning > output 时要输出 `output + reasoning`）、`estimateStreamingTokens()` 带缓存
- **移植量**：把内联函数搬到 `lib/token-speed.ts` + 加 TPS 计算 + UI 一处显示 + `useTokenSpeedPreference` 开关
- **收益**：能看到流式速度；顺带让 `MessageView` 少 50 行

#### A6. 会话归档 + 项目置顶/排序

- **上游**：`lib/archived-sessions.ts`（27 行，localStorage 存归档的 session id）、`lib/project-registry.ts`（113 行）+ `project-registry-core.ts`（51 行，`~/.pi/agent/pi-web-projects.json`，字段 `pinned/archived/removed/order`）、`lib/recent-sessions.ts`（53 行）
- **我**：`lib/workspace-memory.ts` 只记「上次打开的会话」，没有 pin / archive
- **移植量**：~200 行 + 侧边栏 UI
- **坑**：
  - 项目注册表是**路径键**，Windows 上必须用 `samePath()` / `toNativePath()` 比较（你的 AGENTS.md 已经踩过这个坑，别再踩一次）
  - 写文件要用你已有的 `writePrivateFileAtomicSync` + `proper-lockfile`（上游也是这么做的）
  - 归档 **只写 pi-web 自己的注册表**，绝不隐式改名/删除 `.jsonl`（上游 PRODUCT.md 的硬性原则，值得照抄）

#### A7. Git 变更 review 面板 + Git 图谱

- **desktop**：`lib/git-graph.ts` 100 + `git-graph-parser.ts` 54（unit-separator 解析）+ `git-graph-lanes.ts` 119（纯函数泳道状态机）+ `git-graph-palette.ts` + `GitGraphTab.tsx` 617 + `ChangesTabView.tsx` 102 + `app/api/git/log/route.ts`
- **我**：`/api/git/status` 和 `/api/git/diff` 只用在 `FileExplorer` / `FileViewer` 里，没有独立的 review 面板
- **移植量**：git-graph 的 4 个 lib 文件是**纯函数 + 有测试**，可以直接搬；`GitGraphTab` 617 行要按你的 UI 重写（别搬 JSX）
- **收益**：不离开 pi-web 就能看提交历史、分支结构、逐文件 diff
- **坑**：几何完全从 parent 链推导，不用 `git --graph`——这点别改，`--graph` 的 ASCII 输出在宽度自适应下很难看

#### A8. 支持 pi TUI 主题 JSON（需要重写映射层）

- **desktop**：`lib/theme.ts` 615 行 + `lib/themes/` 5 套内置 + `app/api/themes/route.ts` + `app/api/themes/[name]/route.ts` + `hooks/useTheme.ts`
- **能力**：扫描 `~/.pi/agent/themes/` 和 `<cwd>/.pi/themes/`，解析 pi CLI 主题 JSON，支持 hex / 256 色调色板索引 / `vars` 引用 / 空字符串（取默认），按 `name-dark.json` / `name-light.json` 配成主题组，映射到 CSS 变量
- **移植量**：615 行里**大约 450 行是纯逻辑**（256 色表、`vars` 解析、文件扫描、成对解析），可以直接搬。**但最后那段「51 token → 23 CSS 变量」的映射表必须重写**——那是针对 desktop 的变量体系的
- **收益**：用户能直接复用 pi 生态的主题，不用等你改代码
- **坑（重要）**：你的 Codex skin 是一套自制变量体系，`docs/codex-skin/delta.md` 记录了所有刻意的偏离。直接搬 desktop 的映射会打乱你的皮肤。**只搬解析层，映射层按你的 `app/globals.css` 变量重画**。
- 如果只是想要「更多主题」，成本更低的做法是在你现有的 6 套配色里加几套，不要引入整个系统。**先问清楚自己要的是 ecosystem 还是更多配色。**

---

### B 级 — 中等改动，体验提升明显

#### B1. ConversationPlan：待办计划常驻面板

- **上游**：`components/ConversationPlan.tsx`（`parseTodoWidget` 解析 `rpiv-todos` 扩展 widget 的 `● 标题 (3/7)` + `├─ ○ 条目` 格式）+ `lib/goal-panel.ts` 200 行
- **我**：`components/ExtensionWidgets.tsx` 不解析这个格式，plan widget 会当普通 widget 渲染
- **收益**：计划在轮次结束后仍然可见（`planCacheRef` 缓存最后一次有效的 widget）
- **坑**：这是为 **rpiv-todos 扩展**定制的一个特例解析器，不是通用协议。你要么也依赖那个扩展，要么把它泛化成「任意 todo widget」的通用面板

#### B2. 右栏支持多类型 tab + keep-alive

- **desktop**：`components/tab-model.ts`（判别联合 `file` / `changes` / `git-graph`）+ `lib/right-tabs-memory.ts` 149 行（按 workspace 持久化）+ AGENTS.md 的明确规则
- **我**：`components/file-tab-state.ts` 只有 file tab，且 FileViewer 有 unmount 快照机制（`onStateChange` / `saveFileViewerState`）
- **收益**：切换 tab 不重新拉取、不丢滚动位置；配合 A7 一起做
- **坑（desktop 踩过）**：一旦改成 keep-alive，`FileViewer` 的 unmount 快照机制必须删掉，否则两套状态互相打架。tab 上只保留「初始显示模式」的种子值。
- 你的 `file-tab-state.ts` 已有 `viewerRevision` 的概念，思路和 desktop 的 `viewerRevision` 一致，说明你已经走到半路

#### B3. 阅读时收起输入框（input-compact）

- **desktop**：`lib/input-compact.ts` 73 行 —— 方向感知的状态机
- **收益**：向上滚动阅读时输入框塌成一行，回到底部自动展开
- **坑（注释里写得很清楚，别简化掉）**：塌陷会改变容器高度 → 浏览器把 scrollTop 钳回底部 → 被误判为「向下滚动」→ 立刻又展开 → 在边界抖动。所以**只在真实向上滚动且离底部超过 120px 时塌陷**，只在主动向下滚动时恢复。这是一个看起来简单、实际必须有方向判定的状态机。

#### B4. 工作区标签页

- **desktop**：`workspace-tabs.ts` 164 + `useWorkspaceTabs.ts` 50 + `WorkspaceTabBar.tsx` 454 + `workspace-restore.ts` 72 + `workspace-switch.ts` 63
- **收益**：同时开多个项目，来回切换不丢状态
- **建议**：先做 B2（tab 模型），再做这个；顺序反了会返工

#### B5. Electron 桌面外壳

- **desktop**：`electron/main.js` 839 行 + `preload.js` 58 行 + `notification-window.html` 162 行
- **值得抄的具体点**：
  1. **生产环境用 `fork()` 不用 `spawn()`** —— 打包后 `process.execPath` 是 `Pi Web.exe` 而不是 `node`，`spawn` 会失败
  2. **`IS_DEV` 判断不能用 `app.isPackaged`** —— 因为 `asar: false`，打包后 `isPackaged` 仍然是 `false`。要用 `resources/app` / `resources/app.asar` 是否存在来判断
  3. **等待已有服务**：先在 30141 上探测是否有健康的服务，有就复用，没有才自己起
  4. **原生目录选择**：`dialog:select-directory` IPC，比浏览器里的 `showDirectoryPicker` 体验好得多
  5. **拖拽取路径**：`webUtils.getPathForFile(file)` —— `File.path` 已被移除，这是唯一合规方式
  6. **通知窗口**：独立 BrowserWindow + 主窗口聚焦时不弹（返回 `{shown: false}` 让渲染进程走 in-app 兜底）+ 5 分钟 TTL 去重 + 30s 重复抑制 + hover 暂停自动隐藏
- **注意定位差异**：desktop 用轮询 `pollRunningSessions` 发现「哪个会话跑完了」；你已经有 Web Push (`web-push` + `sw.js`)，那是**跨设备**场景。两者服务不同需求，不冲突。
- 你的 dmg 在仓库外打（`release/pi-web-0.9.1-arm64.dmg`），如果想把打包收进仓库，desktop 的 `electron/` + `package.json` 的 `build` 段是现成模板。

#### B6. 欢迎大厅 + 最近项目

- **desktop**：`WelcomeLobby.tsx` 471 + `recent-projects.ts` 404
- **能力**：只读扫描 VS Code 家族（Code/Cursor/Windsurf/Trae）、Zed、Claude Code、Codex、OpenCode 的最近工作区数据，去重后作为「你可能想打开的项目」列表
- **坑**：读 VS Code 要 `node:sqlite`（Node ≥23.4 才稳定），不可用时静默降级到 JSON 源（VS Code `storage.json`、Claude Code history）
- **原则（desktop 注释里写明的）**：只读，永不写别的应用的数据；不做「已经加过了」的过滤，跨源重复按路径取最新去重

#### B7. 统一对话框 shell

- **上游**：`components/DialogShell.tsx` + `DialogConfirmations` + `DialogTools`
- **我**：只有 `ProjectTrustDialog.tsx` 一个对话框，其余是内联的 modal 样式
- **收益**：焦点陷阱、Esc 关闭、aria 语义统一，一处修处处好

---

### C 级 — 参考思路，不建议直接移植

#### C1. 上游的 Subagent 树（协议不兼容）

上游的 `subagent-rpc.ts` 是给**外部 pi-subagents 扩展**用的客户端：通过 `pi.events` 事件总线上的 `subagents:rpc:v1:request` / `reply:<id>` 通道，调用 `ping/status/steer/interrupt/resume`，`ping` 必须声明 `capabilities.runStatus.version === 1` 才认为兼容。

你的内嵌 subagent 走的是完全不同的路：`pi-web:subagent` / `pi-web:subagent-status` / `pi-web:subagent-result` 三种 custom entry 存在子会话自己的 `.jsonl` 里。**两套协议不能对接。**

**真正值得抄的是它的合并模型**（`subagent-tree.ts` 注释）：

> Durable session ancestry defines the tree. Exact live (runId, index) state overrides only lifecycle, activity, and timing. A durable node without a matching live record is `inactive`; the server must never fabricate a terminal outcome or timing from session metadata.

即：**磁盘上的祖先关系定义树形状，实时记录只覆盖状态字段，实时数据缺失时标 `inactive`，绝不从会话元数据编造终态**。这条原则可以直接用在你的 `AgentSessionPanel` 上。

顺带：A4（`session-relations.ts`）是唯一能让你**同时**理解外部 pi-subagents 会话的小改动。

#### C2. CodexSidebar 整块替换

上游 1233 行的 `CodexSidebar.tsx` 和你的 `SessionSidebar.tsx`（2280 行）是同一个位置的两种实现，功能集有交集但不重合：

| | 我 | 上游 CodexSidebar |
| --- | --- | --- |
| 项目置顶/排序/归档 | ✗ | ✓（项目注册表） |
| 会话归档 | ✗ | ✓（localStorage） |
| 最近会话 | ✗ | ✓ |
| 会话全量搜索 | ✓ | ✗（只有侧边栏内过滤） |
| worktree 切换 | ✓ | ✓ |
| 拖拽排序 | ✗ | ✓ |
| subagent 过滤 | ✓（AgentSessionPanel） | ✓（`sessionRole` 过滤） |

**结论**：不要把 CodexSidebar 搬进来。你 README 里明确写了 Codex skin 是自己的产品资产，侧边栏是你的重做成果。**只挑 A6 的两块能力（归档 + 置顶）接到你现有侧边栏上。**

#### C3. reasoning-router（主观口味，会改语义）

`lib/reasoning-router.ts` 181 行：用正则把用户 prompt 分类成 `build` / `fix`，再映射到三档 persona（`spec` / `weak` / `react`）注入到系统提示里，设置值 (`off`/`auto`/具体模式) 存在会话 custom entry 里。

有意思的点：它专门处理了「不要调用工具」这种否定句，避免因为含「工具」二字就被判成 build 任务（`classificationText()`）。

**但这会改变 agent 的行为语义**，是产品级口味决策。建议只当参考，不要默认开启。如果要做，至少做成默认 `off` + 明确标注的实验开关。

#### C4. TanStack Start + Vite + Nitro 迁移

上游为了摆脱 Next.js 做了整仓迁移。你 57k 行代码 + 自制的 Codex skin + 自制的 `scripts/next-mode.mjs` dev/prod 切换机制，迁移是**负收益**：收益（构建速度、依赖减重）远小于成本（全量重测、Next 特有 API 改写、你自己的工具链全部重做）。

**不跟。**

#### C5. 其他不值得动的
- `terminal-input.ts` / `custom-ui-terminal.ts` / `path-security.ts` / `session-stats.ts` / `search-tree.ts` / `subagent-input.ts` / `skill-lock.ts` / `tool-preset-preference.ts` —— 这些我和 desktop 已经**字节相同**，动它没有意义
- 上游的 `RemoteAccessConfig` —— 你已经有 `web-auth` + `app/api/web-auth` 的密码登录，语义等价
- 上游的 `files/upload` —— 你已经在 `app/api/files/[...path]/route.ts` 里实现了（`POST ?type=upload`，支持 `conflict` 策略）

---

## 5. 我领先的地方（写下来是为了避免误搬旧代码）

有几处你已经**比上游 0.14.6 更新**，上游版本反而更旧：

| 能力 | 我 | 上游 0.14.6 |
| --- | --- | --- |
| Fork 实现 | `withSessionReplacement("fork" \| "clone")` + `shutdownAfterSessionReplacement()`，用 `SessionManager.createBranchedSession()`，还额外支持 `fork_branch` / `clone` | 同样用 `createBranchedSession()`，但没有 clone |
| 历史分页 | `sliceActiveBranch()` 自己切片（正确做法） | 同样不用 `buildContextEntries` |
| 跨窗口列表同步 | `getSessionListVersion()` | **已移除** |
| Chat-only 模式 | `lib/chat-only.ts` + ADR 0002，重建 wrapper，加载 context files 替换系统提示 | `forceEmptySystemPrompt`，直接清空系统提示（更粗暴） |
| 会话 liveness | `session-liveness.ts` 199 行 + `PI_WEB_IDLE_TIMEOUT_MS` 环境变量 | **两者都已移除**（只剩硬编码的 10 分钟 idle 定时器） |
| subagent 服务端 | `subagents.ts` 603 行 + status/result 双 entry + 运行时 Agent 派发 + 内置开关 | 走外部扩展 RPC，是另一条路 |
| 语言 | 3 语言（含 zh-TW） | 4 语言（含 ja/ru） |

> 所以上面 A 级清单里的项目，**都要先 `git diff` 确认你确实没有**再动手。特别是我在你的 `AGENTS.md` 里看到关于 fork 的描述还停留在旧版本（「Fork must destroy the wrapper immediately」），但代码已经是新的 `createBranchedSession` 实现了——**你的 AGENTS.md 该更新这一段**。

### 5.1 一个反向警告：别从上游搬 `rpc-manager.ts` 的 idle 段

上游 0.14.6 在重写时**砍掉了两块基础设施**：

- `lib/session-liveness.ts`（你 199 行，desktop 113 行）—— 扩展可以声明「我还有后台工作，别把我 idle 回收」的版本化注册表 `globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")]`
- `PI_WEB_IDLE_TIMEOUT_MS` 环境变量

上游现在只剩 `rpc-manager.ts` L186/L500-509 的硬编码 10 分钟定时器，扩展再也没法阻止自己的会话被回收。你的 `README.md` 里还完整记录着这套协议，desktop 也保留着。

**所以：A1 只能抄 `subscribeRunningSessions` / `notifyRunningChange` 那一小段，`rpc-manager.ts` 其余部分一律以你的版本为准。** 直接整文件替换会让扩展失去 liveness 保护，而且会丢掉你的 `withSessionReplacement` / `clone` / `fork_branch`。

另一个相关的上游行为变化：上游 L153 明确要求「不要在第一个 `agent_end` 上关闭 SSE」，因为重试、压缩、扩展排队的消息可能延续同一个逻辑轮次。你的 `useAgentSession.ts`（2277 行）已经比上游（2117 行）更复杂，**先核对你的实现是否也有这个陷阱再决定要不要动**。

---

## 6. 交叉验证出的两条硬规则（desktop 用血换来的）

这两条 desktop 明确写进了自己的 AGENTS.md，建议核对你的实现：

### 6.1 历史渲染必须绕开 SDK 的 context 过滤

> `buildContextEntries` 会丢掉任何不包含 compaction 的 `firstKeptEntryId` 的窗口，**静默丢历史**。

**你的状态**：`lib/session-reader.ts` L469 / L509 / L566 已经在用 `sliceActiveBranch()` 自己切，**没有踩这个坑**。✅ 保持现状，不要让任何人把它改成走 SDK 的过滤。

### 6.2 会话列表版本号只增不改

> `/api/sessions` 和 `/api/agent/running` 暴露 `sessionListVersion`；侧边栏检测到版本变化才重载列表。**读操作绝对不能 bump 版本**（否则 refresh 无限循环）。

**你的状态**：`lib/session-reader.ts` L364 `getSessionListVersion()`，且 `session-reader.test.mjs` L733-743 明确测了「缓存命中不通知其他窗口」。✅ 已经做对了，且有测试。

---

## 7. 建议执行顺序

```
第一梯队（各 1 天以内，独立、低风险）
  A1 running SSE          ← 收益最高，先做这个
  A2 text-delta 合批
  A4 外部 subagent 会话认领
  A5 token 估算提到 lib

第二梯队（2-3 天）
  A3 队列单条编辑（可选，注意竞态）
  A6 归档 + 置顶
  B7 DialogShell

第三梯队（一周，需要设计）
  A7 Git 变更面板 + 图谱  ─┐
  B2 右栏多类型 tab        ├─ 这三个有依赖关系，一起规划
  B4 工作区标签页          ─┘

第四梯队（看需求，可能不做）
  B1 ConversationPlan      ← 先确认你是否依赖 rpiv-todos 扩展
  B3 输入框塌陷            ← UI 口味，看你自己用着顺不顺
  B5 Electron 外壳收进仓库  ← 取决于你要不要自己做分发
  B6 欢迎大厅              ← 取决于你是否需要「猜用户想开哪个项目」
  A8 pi 主题 JSON          ← 先问清楚：要 ecosystem 还是要更多配色？
```

**两个「别做」**：C2（CodexSidebar 整块替换）、C4（TanStack 迁移）。

---

## 8. 移植时的通用注意事项

1. **SDK 版本差异**：上游 0.14.6 是 `0.84.2`，你是 `0.85.1`。搬上游代码后**必须跑 `tsc --noEmit`**，上游可能引用了旧 API 名。
2. **Next 版本差异**：desktop 是 `16.2.12`，你是 `16.3.1`。desktop 的 `next.config.ts` 里那两条（`turbopack: {}` 空配置让 `next build` 不报错、webpack `node:` 前缀 external）在你的版本可能已不需要，先试不加。
3. **React 严格模式**：dev 下 effect 双调用。搬任何带副作用的 hook（尤其是 SSE 订阅、事件监听）时，unsubscribe 必须幂等。
4. **`globalThis` 而非模块级变量**：你的 `rpc-manager.ts` 已经用 `globalThis.__piSessions` / `__piStartLocks`。A1 的 `__piRunningListeners` 必须同样处理，否则 Next 热重载会丢订阅。
5. **路径比较用 `samePath()`**：涉及项目注册表（A6）、worktree、文件访问的改动，Windows 上 `===` 一定出问题。
6. **写文件用 `writePrivateFileAtomicSync` + `proper-lockfile`**：A6 的项目注册表和上游一样要加锁（`stale: 30_000`、指数退避重试）。
7. **`.test.mjs` 自带测试**：上游和 desktop 的 lib 文件多数带同名 `.test.mjs`，搬代码时**连同测试一起搬**，那是唯一能证明你搬对了的东西。你的 `npm test` 已经覆盖 `lib/**/*.test.mjs`。
8. **别混用 dev/prod 的 `.next`**：来回切走你自己的 `npm run prod` / `npm run dev:clean`。

---

## 附：三方同名文件的版本对照（便于判断该抄哪边）

| 文件 | 我 | 上游 | desktop | 抄谁 |
| --- | --- | --- | --- | --- |
| `lib/rpc-manager.ts` | 2154 | 1995 | 1603 | 只抄 A1/A3 的片段 |
| `lib/session-reader.ts` | 730 | 556 | 691 | 我 |
| `hooks/useAgentSession.ts` | 2277 | 2117 | 2096 | 抄 A2 的接入点 |
| `components/ChatWindow.tsx` | 2229 | 1366 | 1886 | 我（上游删了很多） |
| `components/ChatInput.tsx` | 2992 | 2685 | 3739 | 抄 A3 的 QueueStrip |
| `components/MessageView.tsx` | 2005 | 1726 | 1827 | 我（含 subagent 集成） |
| `components/AppShell.tsx` | 2911 | 2497 | 1635 | 我 |
| `lib/subagents.ts` | 603 | — | 410 | 我 |
| `lib/subagent-runtime.ts` | 587 | — | 411 | 我 |
| `lib/theme.ts` | 22 | — | 615 | desktop（仅解析层） |
| `lib/session-liveness.ts` | 199 | **已删除** | 113 | 我（+ desktop） |
| `lib/tool-presets.ts` | 48 | 42 | 47 | 三方同源，不动 |
| `lib/path-security.ts` | ✓ | ✓ | ✓ | **三方字节相同**，不动 |
