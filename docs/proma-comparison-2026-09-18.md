# Proma 0.19.55 完整功能对比

日期：2026-09-18　对象：`pi参考项目/Proma-main`（Proma 开源版，`apps/electron` 0.19.55）
基准：本仓库 `@agegr/pi-web` 0.9.1 fork（HEAD `05af204`）
配套：[`proma-pr-plan-2026-09-18.md`](./proma-pr-plan-2026-09-18.md)（PR 拆分与实施计划）

> 本文按「Agent 编排 / 聊天 / 右栏工作区 / 平台能力 / 设置与外壳」五个面逐项清点，
> 每一条给 `file:line` 依据。§2 是结论，§3–§7 是逐项对照，§8 反过来列我有人无，
> §9 是明确不搬清单，§10 是与既有 PR 计划的去重表。
>
> **一句话结论**：Proma 与本仓库是**同一个 pi SDK 0.85.1 上的两种架构**——
> 它把 agent loop、provider、权限、存储全部换成自己的一套（桌面优先的独立产品），
> 我只做 pi 的 UI（Web 优先，与 pi CLI 共享同一份真相）。
> 因此它的能力分三类：**能直接搬的交互与工具设计（20 项，§2.1）**、
> **必须换掉 pi 引擎才能做的（7 项，§2.3）**、**桌面平台绑定的（6 项，§2.3）**。
> 真正的「我完全没有且值得做」是 **20 项**，其中 6 项已有既有计划（§10 去重）。

---

## 1. 底座差异（决定了哪些能搬）

| 维度 | 本仓库 | Proma 0.19.55 |
| --- | --- | --- |
| 形态 | **Web 优先**：`next start` 自托管，密码登录（`lib/web-auth.ts`）、PWA、Web Push | **桌面优先**：Electron 43 + Vite，无 Web 部署路径 |
| pi SDK | `@earendil-works/pi-coding-agent` **0.85.1**（`package.json:60`） | **同一个 0.85.1**，另打两个 patch（`@earendil-works/pi-ai`、`node-pty`）（`package.json:56-59`） |
| Agent loop | pi SDK 的 `AgentSession`（`lib/rpc-manager.ts` 2154 行） | **自研 orchestrator**（`agent-orchestrator.ts` 2374 行）+ 自研 provider 适配器（`packages/core/src/providers/`：anthropic/openai/openai-responses/google/sse-reader） |
| 会话存储 | pi 自己的 `~/.pi/agent/sessions/*.jsonl`，**pi CLI 共用同一份** | 自己的 `~/.proma/agent-sessions/*.jsonl` + 自研索引 `agent-sessions.json`；pi 的原生 session artifact 另存 `~/.proma/sdk-config/sessions` |
| 配置真相 | `~/.pi/agent/`（models.json、settings.json、auth.json）——**CLI 与 Web 同一份** | `~/.proma/` 全自管（channels.json、mcp.json per workspace、planning.db、automations.json） |
| 状态管理 | React hooks + URL + localStorage | Jotai atoms（`renderer/atoms/` 38 个） |
| 前端框架 | Next.js 16.3.1 App Router + React 19.2 + Tailwind 4 | React 18 + Vite 6 + Tailwind 3 + Radix/shadcn + TipTap + ink-mde |
| 组件规模 | 59 根组件 + 9 fork 组件 | **236 个 tsx**（`renderer/components/`，25 个子目录） |
| 主进程 | `electron/main.js` 单文件 ~260 行（托盘 + 内嵌 next start） | `src/main/lib/` **200+ 服务文件**（agent/browser/planning/bridge/updater） |
| API 面 | 63 个 `route.ts` | 四层 IPC 契约（shared 常量 → main handler → preload bridge → renderer） |
| i18n | **3 语言 / 996 key**，强制三语同步（`lib/i18n/messages/`） | **无 i18n**，全硬编码简体中文（`GeneralSettings.tsx:292-297` 的"语言"行是占位） |
| 测试 | 217 个 `.test.mjs`（`node --test` + jiti） | `bun test`，BDD 风格，覆盖在源文件旁 |
| 定时任务 | **完整 5 字段 cron 表达式** + 时区（`lib/cron-expression.ts`） | **无 cron 解析器**，只有 5 种结构化 scheduleType（`shared/types/automation.ts:20`） |
| 打包 | `electron-builder` inline 配置，mac target 只有 `dir`（`package.json:158`），无签名 | `electron-builder.yml` + 四平台 dist + node-pty rebuild + 原生 helper |

**架构差异的现实后果**：Proma 的权限引擎、plan mode、rewind、并行 provider 都挂在它自研 orchestrator 上（`canUseTool`、`query options`、`reserveRunGeneration`）。这些**不能按行搬到本仓库**——本仓库的 agent loop 是 pi SDK 的。可行的搬运路径只有两条：

1. **PI 已支持的钩子**：pi 的 extension `tool_call` 事件可以 `{ block: true, reason }`（`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:778-817`），本仓库已有 `ExtensionDialog` 消费 `extension_ui_request` 的 `select/confirm/input/editor`（`components/ChatWindow.tsx:1785-1990`）。→ 权限/审批/计划审批可以在这条链上做。
2. **SDK 已有的会话 API**：`SessionManager.forkFrom` / `createBranchedSession`（本仓库已用于 fork）。→ rewind、探索分支可以在这条链上做。

Proma 自己也是走这两条路（`agent-session-manager.ts:832-930` 用 `createBranchedSession`，`agent-permission-service.ts:120-167` 用自己的 canUseTool）。所以下面的"可搬"判断都以这两条为前提。

---

## 2. 结论摘要

### 2.1 真正的独立能力：我完全没有、值得做（20 项）

| # | 能力 | Proma 做到什么程度 | 可搬性 | 归属 |
| --- | --- | --- | --- | --- |
| G1 | **工具审批卡 + 风险档** | FIFO 队列、危险等级配色、命令/JSON 摘要、拒绝/总是允许/允许、Enter 快捷键、会话白名单、PowerShell 永不加白名单 | ★★★★★ pi 的 `tool_call` 阻断 + 已有 ExtensionDialog（**§3.2.1 已推翻 `delta.md` §27 的「等引擎」结论**） | P1 |
| G2 | **权限模式（bypass / plan）** | 每会话持久化 + 运行时热切换 + 失败回滚；新会话默认全自动 | ★★★★☆ 需要工具层拦截 | P1 |
| G3 | **计划模式（plan mode）** | 计划写入会话 `plan/*.md`（真实路径校验 + 非符号链接 + ≤1MB）、`ExitPlanMode` 三条出口（批准→转 bypass / 拒绝 / 反馈）、审批时重新哈希校验计划文档、`allowedPrompts` | ★★★★☆ 同上 + 计划文件预览 | P1 |
| G4 | **会话回退 rewind** | 严格 JSONL 解析 → pi branch artifact → 原子截断 → 元数据提交（失败回滚）；运行中/无 pi session id 时拒绝 | ★★★★★ `createBranchedSession` 已有 | P1 |
| G5 | **探索分支 + 结论带回主线** | fork 加探索元数据（`explorationParentSessionId`/`sourceMessageId`/`sourceLabel`）；右栏 `exploration:<id>` tab；"带回结论"只复制 fork 点之后的 assistant 内容并插入 `&session:` 引用到父会话草稿（不自动发送）；父会话读分支时被指示只用 `session export --after-message` 读 fork 后内容 | ★★★★★ 本仓库已有 fork | P2 |
| G6 | **子会话阻塞冒泡** | 子会话的权限请求/AskUser 冒泡到父会话事件流，父会话直接回答；启动时把 running 的子会话标为 `interrupted`；并发上限 | ★★★★☆ 内置 subagent 已有事件链 | P2 |
| G7 | **AskUser 多问题表单** | 多题 tab、单选/多选、可选自由文本、草稿按请求持久化、↑↓/Enter/数字键、单选后 150ms 自动前进、关闭即停 Agent | ★★★★☆ ExtensionDialog 已有 select/input | P2 |
| G8 | **任务进度卡 + 覆盖层** | `TaskCreate`/`TaskUpdate` 聚合成实时进度卡 + 底部悬浮层（含压缩进度），完成后保留 4s 淡出，按签名可关闭 | ★★★★☆ 我已有 todo 状态机 | P2 |
| G9 | **改动面板** | 按 git 仓库 + 目录树分组、per-repo 文件/行统计、改动搜索、逐文件撤销（untracked 不给）、**非 git 改动按"本轮 / 更早"分开**、来源徽标（会话/工作区/附加）、未查看小圆点、每目录终端按钮 | ★★★★★ 我已有 `/api/git/status` `/api/git/diff` `turn-written-files.ts` | P3 |
| G10 | **文件写操作** | 原位重命名（自动只选中文件名）、批量删除（确认）、移动到…、**会话文件"移入项目"**、Cmd/Ctrl 多选、命令面板式右键菜单 | ★★★★★ 我已有 `/api/files` PATCH/POST | P3 |
| G11 | **XLSX / PPTX 预览** | XLSX：内建 adm-zip + XML 解析渲染表格（8 sheet / 200 行 / 40 列上限 + 截断提示）；PPTX：列出幻灯片标题+要点（80 张上限）；两者优先走 OfficeCLI | ★★★★★ 纯解析层，无 Electron 依赖 | P3 |
| G12 | **Markdown 编辑器增强三件套** | ① 编辑器内查找栏（大小写/全词/正则 + 命中计数 + Enter 导航 + CodeMirror StateField 高亮）② 目录 + scroll-spy（含最后一项可达顶部的补白）③ **表格真网格编辑**（单元格导航、右键增删行列、写回 markdown） | ★★★★☆ 我有 ProseMirror 编辑器，缺这三样 | P3 |
| G13 | **会话内消息搜索** | 预计算归一化文本（流式 token 不重扫全历史）、打分片段、2 字符下限、50 条上限 | ★★★★★ 纯前端 | P3 |
| G14 | **终端 Agent 工具（5 个）** | `TerminalOpen/Execute/Read/List/Interrupt/Close`：复用已列出的终端、分页归一化文本（默认 12k / 最大 48k）、剥控制序列、cwd 必须在授权根内、无人值守运行禁用终端 | ★★★★★ **我已有终端**（`lib/terminal-manager.ts`），只缺给 agent 的工具 | P4 |
| G15 | **定时任务生命周期语义** | ① 子会话复用策略（同日复用/跨日新建/上下文 ≥70% 换新）+ 用户手发消息即"毕业" ② 连续失败 5 次自动暂停 ③ `maxRuns` 达上限自动停用并标完成 ④ 完成通知（always/success/error 三选一） | ★★★★★ 我的 `cron-store.ts` + `cron-runner.ts` 已是同一套骨架；**时间窗/运行历史/重入跳过/错过标记我已有**，只补这四项 | P4 |
| G16 | **提醒条（Reminder rail）** | 到点主进程发系统通知（silent）+ 点击聚焦；未确认提醒在 UI 常驻成一条 rail；acknowledge/complete/snooze/open 四个动作 | ★★★★☆ Web 端用 Notification + 常驻条等价 | P4 |
| G17 | **存储管理** | 用量统计、启动清临时文件、按天数清理已归档会话消息与 SDK 数据 | ★★★★★ 我的会话 jsonl 会一直涨 | P4 |
| G18 | **快捷键系统** | 20 条默认快捷键分 4 组（app/edit/navigation/global）、点击录制、冲突即时检测、单条禁用、恢复默认、主进程 `globalShortcut`、严格修饰键匹配（防 Cmd+K 被 Cmd+Shift+K 误触） | ★★★★☆ 我有 `useKeyboardShortcuts.ts`（固定集合） | P4 |
| G19 | **自动更新（完整版）** | `electron-updater`（autoDownload=false 自控时机）、启动后 10s 首查 / 每 4h、**空闲安装**（等所有 agent 结束再退出安装）、安装包缓存清理、GitHub Release 更新日志（30 分钟缓存 + 403/429 冷却） | ★★★☆☆ 我有 `/api/app-update` 版本检查 | P4 |
| G20 | **内嵌真实浏览器 + Agent CDP 工具** | Electron `WebContentsView` + CDP：`observe/find/click/hover/drag/fill/press/waitFor/act/domAction/scroll/extract/selectOption/upload/evaluate/screenshot/...`，AX 快照带 ref + 失效语义，观察预算 240 元素，profile 按工作区隔离，本地 HTML 预览用 token 化 `proma-file://` | ★★☆☆☆ 需要 Electron 原生视图 + 大改造（先把现有 iframe 面板升级为可选 CDP 后端） | P5 spike |

### 2.2 我有等价物、只是叫法/位置不同的（不再做）

| Proma 能力 | 我的等价物 | 差异（可选补充） |
| --- | --- | --- |
| Chat 模式与 Agent 模式分离 | Chat-only 工具预设（ADR 0002，`lib/chat-only.ts`）：空工具数组 → 不加载 extensions/skills/prompts/themes | 它用独立 Chat 会话 + "迁移到 Agent"按钮；我是同一会话切预设，且我的做法不会产生两份历史 |
| 子会话 & 主会话 | 内置 subagent（`lib/subagent-extension.ts`，`Agent`/`get_subagent_result`/`steer_subagent`）+ `AgentSessionPanel.tsx` + `AgentsConfig.tsx` profile 编辑器 | 它的子会话是**真会话**（可交互、可续跑、有独立模型）；我是 headless 运行 + profile。见 G6 |
| 探索 / 分叉 | fork（新 `.jsonl`）+ in-session branch（`navigate_tree`）+ `BranchNavigator.tsx` | 缺"结论带回主线"的收口动作 → G5 |
| 工具调用分组 / 过程折叠 | `ProcessGroup.tsx` + `lib/step-categorizer.ts` + `lib/process-content.ts` | 它的工具短语（中文人话）与 8 种专属结果渲染更细 → 见 §3.6 |
| Todo | `lib/todo-extension.ts` + `lib/todo-state.ts` + `components/fork/TodoChip.tsx` | 它有 SQLite + 提醒 + 日程；我只有会话级 todo |
| 定时任务 | `lib/cron-*.ts` + `app/api/cron` + `components/fork/CronConfig.tsx` + agent 工具 | **我的 cron 表达力更强**（完整 5 字段 + 时区），它缺窗口/运行日/失败暂停 → G15 |
| 长期记忆 | `pi-memory` 包 + `/api/memory/files` + `components/fork/PiMemoryConfig.tsx` | 语义接近（MEMORY.md 索引 + 主题文件）；它多"3 天未整理就邀请回顾"和"记忆变更 diff watcher" |
| Skills | `/api/skills{,/search,/install,/check,/update}` + `SkillsConfig.tsx` | 我多 skills.sh 搜索安装与更新检查；它多"按工作区隔离 + 导入导出 + 子文件编辑器 + 版本升级" |
| MCP | `/api/mcp` CRUD + `/api/mcp/discover`（从 Claude/Codex/Cursor/VS Code 导入）+ `components/fork/McpConfig.tsx` | 我多一键导入；它多 OAuth PKCE + Keychain 加密 + 内置集成目录 + handshake 验证 |
| 模型/渠道管理 | `ModelsConfig.tsx`（2170 行）+ `models.json` + OAuth/设备码 + `/api/provider-usage` | 我多 models.dev 目录、`enabledModels` glob 作用域、模型发现、连接测试；它多 24 家 provider 预设、Keychain 加密、额度查询覆盖面 |
| 权限/审批入口 | `ExtensionDialog`（select/confirm/input/editor）+ pi `tool_call` 阻断 | 缺"审批卡"这一层 → G1/G2/G3 |
| 会话导出 | `/api/sessions/[id]/export`（HTML）+ `?format=md`（Markdown） | 对齐 |
| Worktree | `/api/worktrees` + 会话分组 + `lib/worktree.ts` | 我多"所有 worktree 归到一个项目行"；它多"会话级 activeWorktree + 子会话/终端跟随 + fork 时复制工作台文件" |
| 终端 | `lib/terminal-manager.ts`（128KB ring + lease/expiry）+ `app/api/terminal/*` + `TerminalPanel.tsx`（xterm） | 它多"独立进程 PTY + 快照恢复 + agent 工具" → G14 |
| 文件预览 | PDF + DOCX + 图片 + 音频 + 视频 + 文本/代码 + 不可预览卡片 | 缺 XLSX/PPTX → G11 |
| 内嵌浏览器 | `BrowserPanel.tsx`（sandboxed iframe + 视口预设，明确说明 X-Frame-Options 站点会白屏） | 它是真 Chromium + CDP + agent 控制 → G20 |
| 主题 | pi CLI 主题集（`/api/themes`）+ 6 套 Codex 皮肤 + 壁纸/密度/边框深度 | 我多得多；它只有 3 档外观 |
| 提示词管理 | pi 的 prompt templates + `SystemPromptPanel.tsx`（查看） | 它多"多套提示词 CRUD + 设为默认" |
| 项目信任 | `lib/project-trust.ts` + `ProjectTrustDialog.tsx` | 它有类似的项目根授权模型（`project-instruction-resolver.ts`） |
| 自动归档 | 手工 pin/archive（`lib/session-flags.ts`） | 它按 0/7/14/30/60 天自动归档 → G17 可顺带 |
| 消息编辑/删除/重发 | `MessageView.tsx`（edit / fork / delete / copy） | 它有 inline 编辑表单 + 用户/助手成对删除警告 |

### 2.3 不搬（换引擎才能做 / 桌面绑定 / 与本仓库定位冲突）

| # | 能力 | 为什么不搬 |
| --- | --- | --- |
| N1 | 自研 provider 适配器层（`packages/core/src/providers/`） | 本仓库的核心约定是"pi CLI 与 Web 共用 `~/.pi/agent/` 同一份真相"。再插一层 provider 会造出 CLI 不认的平行配置（与 `omp-web-comparison-2026-09-17.md` §5 同一理由） |
| N2 | 自研 agent orchestrator（`agent-orchestrator.ts` 2374 行） | 同上；且它是权限/plan/queue/恢复的总枢纽，搬它等于重写 `lib/rpc-manager.ts` |
| N3 | 自管会话存储（`~/.proma/agent-sessions/`） | 会同时失去 `pi` CLI、会话导出、`/api/sessions/[id]/context`、分支导航的全部既有能力 |
| N4 | macOS EventKit 双向同步（N-API addon） | 原生 addon + TCC 权限 + outbox/冲突表；Web 形态无法承载。Calendar 本身也不在我的 scope |
| N5 | Agent Island（macOS 刘海 / Windows 托盘） | 原生 surface，且需要自绘窗口 |
| N6 | IM 渠道（微信 iLink 扫码 / 飞书 / 钉钉 / Slack） | 是另一条产品线（远程访问），且需要各平台 App 审核与凭据。我的远程访问走 Web + 密码 + PWA |
| N7 | Vision Relay（视觉助手降级转发） | 需要第二条模型链路；本仓库模型层面已支持 image input，按需在 `ModelsConfig` 里选视觉模型即可 |
| N8 | 语音听写（豆包流式 ASR） | 需要第三方付费 ASR + 麦克风权限链路；Web 端可行但价值密度低（浏览器自带听写已覆盖一部分） |
| N9 | 多窗口（独立预览 / 记忆窗口 / 听写浮窗 / 快速任务） | Web 形态无多窗口；快速任务可用"新标签页 + 全局快捷键"退化，见 P5 |
| N10 | Bun monorepo / Bun 运行时 | 本仓库是 npm + Next.js；迁移无收益 |
| N11 | `~/.proma` 平行配置世界（channels.json / planning.db / automations.json） | 见 N1 |
| N12 | Obsidian/Vault 深度集成 | 体量相当于一个独立产品（wiki 链接解析、库发现、双向链接、滚动记忆）。若要做，建议单独立项而不是当"顺手补" |

---

## 3. A 面：Agent 编排与权限（它最强、我最弱的一面）

这是 Proma 与所有其他参考项目拉开差距的地方：它把"agent 能自己做什么"当成一等公民，做了**两级控制**——会话级权限模式 + 工具级审批。

### 3.1 权限模式（Permission modes）

| 项 | 它的实现 | 依据 |
| --- | --- | --- |
| 模式集合 | `bypassPermissions`（全自动）/ `plan`（计划模式） | `agent-orchestrator.ts:1138-1142`；`shared` 的 `PROMA_PERMISSION_MODE_ORDER/CONFIG` |
| 默认 | 新会话默认**全自动** | `agent-orchestrator.ts:1138-1142` |
| 持久化 | 写入会话 meta，重启恢复；每会话独立 | `ipc.ts:3645-3666` |
| 运行时切换 | 乐观更新 + 失败回滚；热切换适配器并广播 `plan_mode_changed` | `PermissionModeSelector.tsx:56-88`；`agent-orchestrator.ts:2306-2327` |
| 显示逻辑 | 计划模式下按钮图标显示为 plan（覆盖底层模式） | `agent-plan-mode.ts:38-44` |
| 进入/退出信号 | 初始 `enter_plan_mode` + `plan_mode_changed`；`EnterPlanMode` 工具翻转；`ExitPlanMode` 只在后端批准后才算退出 | `agent-plan-mode.ts:9-17`；`agent-orchestrator.ts:1148-1156` |

**我的状态**：无。只有 pi 的 `approval_rejected` 事件分类（`lib/step-categorizer.ts:17`，`ProcessGroup.tsx:156`）——那是 pi 内部/扩展拒绝时的事件显示，没有用户可选的模式，也没有会话级持久化。

### 3.2 工具级审批引擎

| 项 | 它的实现 | 依据 |
| --- | --- | --- |
| 升级链 | worker 子 agent 自动放行 → 会话白名单放行 → 只读工具/安全 Bash 放行 → 否则建请求并 **Promise 阻塞** | `agent-permission-service.ts:120-167` |
| 危险单确认 | `requestSingleApproval`：不可加白名单的一次性确认（浏览器上传、规划删除**即使在 bypass 模式**也走） | `agent-permission-service.ts:169-195`；`agent-orchestrator.ts:1361-1372, 1405-1419` |
| 白名单例外 | PowerShell **永不加白名单** | `agent-permission-service.ts:197-218, 265-305` |
| 中止语义 | abort signal → 直接拒绝 | `agent-permission-service.ts:155-162` |
| 危险等级 | 危险评估 + 人话描述 | `agent-permission-service.ts:336-445` |
| UI | FIFO 队列（可连出多张）、危险等级图标/配色、命令或 JSON 摘要、**Enter 允许**、× 关闭并停止 Agent、`allowAlways === false` 时隐藏"总是允许"、底部"Enter 允许"提示 | `PermissionBanner.tsx:39, 51-66, 68-84, 95-118, 201-205, 207-218` |
| 恢复 | renderer 重载后从 `getPendingRequests()` 恢复待决请求 | `useGlobalAgentListeners.ts:982-995` |

**我的状态**：pi 的 `tool_call` 事件天生支持阻断（`docs/extensions.md:778-817`），我的 `ExtensionDialog` 也已经能跑 `confirm`。缺的正是**审批这一路的语义**：风险档、参数摘要、总是允许白名单、FIFO 队列、恢复。这个缺口在 `docs/musepi-borrowing-plan-2026-09-17.md:558`（MU-31）已被识别，但当时只当作"卡片升级"，Proma 证明它应该配一整套模式 + 引擎。

### 3.2.1 ⚠️ 需要推翻的一条既有结论：`delta.md` §27「不做（等引擎）」

本仓库 `docs/codex-skin/delta.md:1199-1205` 对 MU-31 的核实结论是 **「不做（等引擎）」**，理由是：

> SDK 里唯一的 `--approve/--no-approve` 是**项目信任**…没有 per-tool 审批协议…
> 硬做只能造一个没有数据源的空壳。**保持现状**，等上游 pi 暴露审批协议再补。

**这个结论的前提是错的**，它只找"声明式设置"（像 MusePi 的 `tools.approvalMode`），漏了 pi 提供的是**命令式钩子**。逐条证据：

| # | 事实 | 依据 |
| --- | --- | --- |
| 1 | pi 官方文档把**「Permission gates（确认 `rm -rf` / `sudo` 等）」列为扩展的首要用例** | `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:19` |
| 2 | Quick Start 里就是完整可跑的审批片段：`tool_call` 里 `await ctx.ui.confirm(...)`，拿到布尔值后 `return { block: true, reason: "Blocked by user" }` | `docs/extensions.md:70-74` |
| 3 | `ctx.ui.confirm()` 被明确归类为**阻塞式、面向用户的扩展 UI 提示**（与 `select/input/editor/custom` 同级） | `docs/extensions.md:585` |
| 4 | `tool_call` 在工具执行前触发，**明确可阻断**；返回值 `{ block, reason, terminate }` 控制阻断语义 | `docs/extensions.md:778-793` |
| 5 | **UI 这一半本仓库已经做完**：`ExtensionDialog` 已渲染 `confirm` 分支（含键盘导航、倒计时） | `components/ChatWindow.tsx:1812-1990` |
| 6 | 回答链也已打通：`respondToExtensionUi` → POST `extension_ui_response`（带 `confirmed: boolean`），`rpc-manager` 端已处理 | `hooks/useAgentSession.ts:805-814`；`lib/types.ts:202-204`；`lib/rpc-manager.ts:973` |

**所以**：审批能力的**引擎侧（工具可阻断 + 可阻塞等待用户）与 UI 侧（弹卡 + 回收答案）都已经在仓库里**。真正要从零写的只是"审批的语义层"——风险档分类、参数摘要、会话白名单（总是允许）、FIFO 队列、刷新恢复——这些全是本仓库的普通应用逻辑，不是引擎能力。

**两条结论要改**：

- `delta.md` §27 的「不做（等引擎）」应改为「**可做，引擎已支持**」；
- MU-31 的描述「升级可见卡片」低估了工作量，实际应做成本文 PROMA-01 的完整引擎 + PROMA-02 的模式选择器。

> 这个纠正本身不影响 Proma 借鉴项的数量：它只是把一个"被阻塞项"解封了。

### 3.3 计划模式

| 项 | 它的实现 | 依据 |
| --- | --- | --- |
| 计划产物 | 强制写进会话 `plan/` 目录下的 `.md`，必须绝对路径、真实目录（非符号链接）、≤1MB；新文件只能在存在的非符号链接父目录下 | `agent-plan-file-policy.ts:9-42`；`agent-orchestrator.ts:1430-1443` |
| 审批请求 | 携带 `allowedPrompts` + 文档 sha256；阻塞等待 | `agent-exit-plan-service.ts:65-113` |
| 批准 | **重新校验位置与哈希**，过期文档直接拒绝（"计划文档在审批期间已变更"），转为 `bypassPermissions` | `agent-exit-plan-service.ts:125-140`；`isPlanDocumentCurrent` `:254-258` |
| 拒绝 / 反馈 | 拒绝 → deny；反馈 → deny + feedback 消息 | `agent-exit-plan-service.ts:141-160` |
| 计划模式下的工具策略 | 只读工具白名单；Write/Edit 仅限 `plan/*.md`；Bash 走只读正则分类器；PowerShell 只放行显式只读 cmdlet + 安全 git/bun/npm；浏览器只放行 observe/find/extract/screenshot/list/preview-open；planning MCP 只读；REPL/Workflow/cron/monitor/通知类一律拒绝；终端创建/操作拒绝 | `agent-orchestrator.ts:1249-1268, 1204-1240, 1242-1264, 1424-1487` |
| UI | 三选项横幅（批准并全自动 / 拒绝 / 反馈）、↑↓+Enter+数字键 1-3、反馈输入 Enter 提交、"查看计划"打开只读预览、关闭即停 Agent | `ExitPlanModeBanner.tsx:35-58, 63, 105-112, 141-204, 341-345` |
| 视觉 | 计划模式下输入区外框虚线（SVG + ResizeObserver 精确 dash，无布局影响） | `PlanModeDashedBorder.tsx:10-13, 22` |
| 完成后引导 | 本地会话给"请执行该计划"建议（外部渠道不给） | `agent-orchestrator.ts:2113-2124` |

**我的状态**：完全无。搜索 `plan_mode|ExitPlanMode|EnterPlanMode` 在整个 `app/ components/ hooks/ lib/` 只有注释里的偶然命中。

### 3.4 会话回退（Rewind）

| 项 | 它的实现 | 依据 |
| --- | --- | --- |
| 前置拒绝 | 运行中 / 旧 Claude 记录 / 无 pi session id → 拒绝 | `agent-orchestrator.ts:2329-2355` |
| 事务顺序 | 严格 JSONL 解析（任何坏行即中止）→ 创建 pi branch artifact → **原子截断** JSONL → 提交元数据；元数据失败则还原原 JSONL | `agent-session-manager.ts:932-1030, 110-117, 1000-1012` |
| 截断语义 | 按 UUID **含**该条截断（`truncateSDKMessages`） | `agent-session-manager.ts:1118-1145` |
| 文件回退 | **明确不支持**，返回 `fileRewind.canRewind = false` 作为正常能力边界而非错误 | `agent-orchestrator.ts:2346-2352`；契约测试 `agent-rewind-contract.test.ts:17-24` |
| UI | 警示对话框"回退将截断该消息之后的所有对话。此操作不可撤销…"、成功/部分成功两种 toast、成功后刷新消息列表与 diff | `AgentView.tsx:3177-3193, 2599-2614, 2582-2594` |

**我的状态**：无 rewind。但有 fork（写新文件）与 in-session branch（`navigate_tree`），所以底层能力在——缺的是"截断当前文件"这一动作，以及它的原子性纪律。

### 3.5 消息队列（Proma 托管队列）

| 项 | 它的实现 | 依据 |
| --- | --- | --- |
| 分发决策 | 流式中 → 入 Proma 队列；软空闲（backgroundWaiting）→ 立即注入；空闲 → 直接运行 | `AgentView.tsx:2022, 2043-2108, 2110-2162, 2164-2279` |
| 主进程协调 | `AgentQueueCoordinator`：返回 `started|queued`，只在非 active/dispatching 时派发，运行结束与后台任务完成时唤醒 | `agent-queue-coordinator.ts:17-107, 110-152` |
| 引用类型 | `/skill:` `#mcp:` `&session:` `&todo:` `&calendar_event:` `&quote:` `@file:` 七种，display 与 sdkText 分离（`@file` 解码给 agent，显示保留原样） | `agent-message-queue.ts:127-351, 353-380` |
| UI | 逐条"立即发送（打断当前执行）"、"撤回到输入框"、删除、拖拽排序（before/after 指示）、引用 chip | `AgentMessageQueue.tsx:24, 44-72, 159-168, 180-210` |
| 恢复 | renderer 重载后从主进程快照恢复队列 | `useGlobalAgentListeners.ts:1132-1160` |
| 旧代码 | `shouldAutoDispatchQueuedMessage` 是**无生产调用者**的死代码 | `agent-message-queue.ts:34`（全仓只有定义处命中） |

**我的状态**：pi 自带 steer/followUp 队列，`ChatInput.tsx:1806-1991` 已渲染计数与单条撤回（`onRecallQueue`）。缺拖拽排序与"立即发送（打断）"语义。

### 3.6 其他 Agent 面细节（值得单独抄的）

| 项 | 它的实现 | 依据 | 我的状态 |
| --- | --- | --- | --- |
| 工具人话短语 | `getToolPhrase` / `getToolResultSummary`，支持 `_intent` 与 Bash description，MCP 显示 `SERVER / TOOL`，diff 统计 | `tool-phrase.ts:35, 105, 483`；`tool-utils.ts:117, 522, 537` | 无（我显示原始工具名） |
| 8 种专属工具结果渲染 | Bash / Read / Edit / Write / Grep / Glob / WebSearch / WebFetch + CollapsibleResult + PreviewOpenButton | `tool-result-renderers/index.tsx:29-52` | 部分（ANSI/bash-output） |
| 子 agent 渲染 | 折叠的子工具、prompt 气泡、工具计数、最终输出、用量 footer、编辑冒泡到父轮次 | `ContentBlock.tsx:320-330, 410-600` | 部分 |
| 过程组自动折叠 | 流式结束后倒计时自动折叠；最终文本被**拉出**过程组作为答案，若后面还有工具则放回 | `ProcessBlockGroup.tsx:21-28, 58-105, 195` | 部分（`ProcessGroup.tsx`） |
| 实时轮次边界 | `buildLiveGroupSet` 按 run startedAt + 最近压缩边界限定"实时"范围，让上一条排队消息自动折叠 | `live-group-set.ts:22, 40-56` | 部分 |
| 消息合并去重 | 持久化消息 + 实时流按稳定 key/UUID 合并；分组缓存复用避免重渲染 | `AgentMessages.tsx:1010-1052, 1081-1094` | 有（`useAgentSession.ts`） |
| 空思考帧过滤 | 只有空 thinking/text 帧的 live 轮次不渲染 | `AgentMessages.tsx:120, 1105-1110` | 无 |
| 划词操作 | 历史里选中文本 → "添加到 Agent" / "探索此分支"（仅主线 assistant 消息，需 `piEntryBindings`） | `AgentHistorySelectionLayer.tsx:386-446` | 部分（文件查看器有引用浮层；聊天区无 → MU-04 已规划） |
| 并排双栏消息 | `ParallelChatMessages`：用户列 / 助手列，按上下文分隔线分段，各自独立滚动 | `ParallelChatMessages.tsx:79-118, 193-203, 241` | 无 |
| 上下文用量环 | 环形按钮显示 used/window；悬浮显示 token 明细 + 套餐额度；到自动压缩阈值 80% 变琥珀；手动压缩**二次确认** | `ContextUsageBadge.tsx:30-33, 161` | 部分（TokenEstimate + compact 按钮） |
| 系统提示词管理 | 提示词列表 + 设为默认 + 编辑 + 侧栏 CRUD（500ms 防抖保存），内置标记 | `SystemPromptSelector.tsx:24, 40-65`；`PromptEditorSidebar.tsx:27-29` | 部分 |
| 长文本转附件 | >2000 字符自动转附件 | `AgentView.tsx:1698-1709` | 无（MU-23 已规划） |
| 模型/思考变更延迟到下一轮 | 运行中改模型不打断当前轮 | `AgentView.tsx:1958, 2001` | 无（我的改动即时生效） |
| 会话悬浮迷你地图 | 600ms hover 预览 Chat/Agent 结构，复用 tab 缓存或读 JSONL，末 80 条，视口内定位 | `SessionMiniMapPopover.tsx:52-59, 80-158, 262-310, 359` | 部分（ChatMinimap 是滚动图，非悬浮预览） |

---

## 4. B 面：聊天面（我基本对齐，差距在细节）

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| 消息列表虚拟化 + 顶部加载 | 顶部 `<100px` 触发，锚点保持；键盘滚动算手动交互；流式结束用 instant 避免跳动 | `useAgentSession` + `ChatWindow` lazy-load | 对齐 |
| 流式平滑 | `useSmoothStream` | text-delta 批处理 | 对齐 |
| 消息操作 | inline 编辑（附件增删、拖放、粘贴）、删除（成对警告）、重发、复制、引用 | edit / fork / delete / copy | 它多"成对删除警告"与"inline 编辑表单" |
| 系统提示词 | 多套 CRUD | pi prompt templates + 查看面板 | 见 §3.6 |
| 工具开关 | `ToolSelectorPopover`（Chat 工具 / Agent 模式推荐 / 自定义工具） | 工具预设 4 档（none/read-only/default/full）+ 持久化首选 | 我更强（预设 + ADR） |
| 上下文轮数 | 0/5/10/15/20/∞ 轮滑杆 | 无（靠压缩） | 它多一个粗粒度上下文控制 |
| 思考档 | 开关 + Gemini 3 深度（minimal/low/medium/high，按模型能力显隐） | 思考档 + per-model pin | 对齐 |
| 模型选择器 | 按渠道分组 + 搜索 + 渠道套餐额度角标 + 选中/高亮视觉态 | `ModelSelector` + 搜索 + 清空缓存/重新加载 + 用量摘要 | 对齐 |
| 附件 | 100MB 策略：超限但有本地路径 → 作为路径引用；否则跳过并提示 | 图片 + 文件上传（拖拽） | 略有差距 |
| 清除上下文 | 独立按钮 + 平台键位提示 | 压缩（compact） | 对齐 |
| 迁移 Chat→Agent | `MigrateToAgentButton`：建 Agent 会话、复制聊天历史、打开 tab | Chat-only 预设切换（同一文件） | 我更好 |
| 会话标题 | 可编辑（Enter 保存 / Esc 取消 / 100 字符）+ pin + 并排 + 系统提示词 | 可编辑 + 自动命名 API + 标题即切换器（fork 已做） | 对齐 |

---

## 5. C 面：右栏工作区与文件（它最厚的一面）

### 5.1 面板骨架

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| 右栏多 tab + 加号菜单 | files / changes / workspace 组件（Todo/日程/定时/Skills/MCP/记忆/Obsidian）/ preview / terminal / 问答 / exploration / delegation / browser | `TabBar.tsx`（chat / file / terminal / browser，含溢出折叠） | 它多 6 类 tab |
| **双 pane 分屏** | 拖 tab 到左右半区 → 分屏；可拖分隔条（双击回 50%）；比例按会话持久化；关闭绑定 tab 自动收起 | 无 | **缺** |
| 标签拖拽排序 | 指针拖拽（5px 阈值）+ 滚轮横向滚动 + 新 tab 自动滚入 | 无（`TabBar` 只有点击） | **缺** |
| Ctrl+Tab MRU 切换器 | 按最近使用排序，分"当前协作 / 最近访问"，运行/阻塞脉冲指示 | 无 | **缺** |
| 标签悬浮预览 | 300ms hover 显示 280px 迷你地图（最近消息 + markdown + 模型/用户头像） | 无 | **缺** |
| 预览撕离到分屏 | 拖出标签栏 >24px → 迁移到右栏 preview tab | 无 | **缺** |
| 独立预览窗口 | 独立 Electron 窗口按 `previewId` 加载 | 无 | 不搬（N9） |
| per-tab 错误边界 | 每个 tab 包错误边界 + sessionId 上下文 | 有 `MarkdownEditorBoundary`（单点） | 它更完整 |

### 5.2 文件树与文件操作

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| 多根合并树 | 会话文件 + 项目文件合并，带"会话文件"徽标；空目录加载成功后`hideEmpty` | 会话/项目/工作树分组 + `FileExplorer` | 对齐（分组方式不同） |
| 懒加载 + 空目录重试 | 首次展开才列；空列表 800ms 后重试一次（对抗 agent 写入竞态） | 懒加载 + 刷新 | 它多这个重试（细节好抄） |
| **文件写操作** | 原位重命名（100ms 后只选中文件名）、批量删除确认、移动到…、**会话文件移入项目** | 无（只读浏览 + 上传） | **缺**（G10） |
| 多选 | Cmd/Ctrl 多选 + 点空白清空 + 批量动作计数 | 无 | **缺** |
| 粘性目录行 + 引导线 | 目录行按深度粘住（最多 8 层）+ 祖先竖线（VS Code 风） | 无 | **缺**（低成本高观感） |
| 图标集 | `@react-symbols/icons` 按文件名 | `FileIcons.tsx` 自绘 | 对齐 |
| 最近被 agent 修改标记 | 60s 窗口内主色圆点 + aria-label | 无 | **缺** |
| 拖拽引用到输入框 | 行 `draggable`，写 `application/x-proma-file-panel` JSON + text/plain 兜底 | 拖拽上传 + `@path` 引用 | 对齐 |
| 搜索自动定位 | 搜索结果自动展开祖先 + 平滑滚到中间（可选选中） | 文件搜索 + 结果树 | 部分 |
| 双投放区 | 左区上传进会话文件，右区挂载目录（或路径挂载文件），投错给 toast 指引 | 拖拽上传 | 它更明确 |
| 附加文件/目录区 | 会话级 + 工作区级，可 detach / 引用 / Finder / 终端；附加目录子项懒加载（防过期响应） | 无（有 allowed roots） | **缺**（与工作台模型配套） |

### 5.3 改动面板（G9 详表）

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| 分组 | 按 git 仓库 + 目录树，per-repo 文件/行统计 | 文件树上的 `M/U` 角标 + 行统计 | **缺面板** |
| 改动搜索 | 有 | 无 | 缺 |
| Worktree 选择器 | 列出仓库的 worktree，可切换 diff 基准（会话改动 / worktree vs 基准分支），可开终端 | `SessionSidebar` 的 worktree 切换 + `/api/worktrees` | 对齐（位置不同） |
| 撤销文件改动 | 逐文件 revert + 确认；**untracked 不给** | 无 | **缺** |
| 非 git 改动 | 按"本轮 / 更早"分组 + 失效路径清理 | `lib/turn-written-files.ts` 有数据 | **缺 UI** |
| 来源徽标 | 会话 / 工作区 / 两者 / 仅附加，带色 | 无 | **缺** |
| Diff 渲染 | `@pierre/diffs` MultiFileDiff，split/unified，5000 行降级提示 | `FileViewer.tsx` 自绘 diff（上下文折叠 + 逐行） | 对齐（它能 split） |
| 未查看点 | agent 写工具 bump 版本号 → 改动 tab 显示小圆点直到被查看 | 无 | **缺** |
| 空 diff 自动关闭 | old === new 时预览自己关掉 | 无 | 缺 |

### 5.4 Markdown / 文档

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| 实时编辑器 | ink-mde（CodeMirror）：语法标记在非光标行隐藏（Obsidian Live Preview） | ProseMirror WYSIWYG（`MarkdownFileEditor.tsx`） | 对齐（路线不同） |
| 块级 widget | 代码块（Shiki + 复制按钮）、**表格真网格**、mermaid、行内/块数学、原始 HTML、hr | mermaid + 代码高亮 + KaTeX | 缺表格网格 |
| 点击 widget 选中源码 | 有 | 无 | 缺 |
| YAML frontmatter | 渲染成 key/value 行 + 日期识别 + 增删 | `FrontmatterCard.tsx`（只读卡片） | 它可编辑 |
| 本地图片解析 + 粘贴图片 | 相对路径校验（无 scheme、无 `..`）+ token URL 缓存；粘贴图片自动保存并插 markdown | 图片预览 + 上传 | 部分 |
| **编辑器内查找** | 大小写/全词/正则 + 命中计数 + Enter/Shift+Enter + CodeMirror StateField 高亮（含 shadow DOM 感知） | 无 | **缺**（G12） |
| 目录 + scroll-spy | 提取标题（含编辑器 heading 属性）+ 滚动同步 + 编辑器 `scrollToPosition` 跳转 + 末尾补白 | ChatMinimap 大纲（聊天，非文件） | **缺**（G12） |
| 纯文本编辑模式 | `.txt/.log` 显式编辑 + 1500ms 自动保存 + Cmd/Ctrl+S + Esc 退出 + 草稿/滚动持久化 | `CodeFileEditor.tsx`（CodeMirror） | 对齐 |
| 富文本 TipTap 编辑器 | **存在但无任何引用者**（`MarkdownRichEditor.tsx` + toolbar + TableBubbleMenu 全是孤儿代码） | 我的 ProseMirror 才是生产路径 | 参考价值只有 toolbar 设计 |

### 5.5 预览能力矩阵

| 格式 | 它 | 我 |
| --- | --- | --- |
| Markdown | 实时编辑 | WYSIWYG 编辑 |
| HTML | 沙箱 iframe + 源码切换 | 有（viewer） |
| PDF | pdfjs-dist 自渲 + 50–300% 缩放 | 有 |
| DOCX | OfficeCLI → mammoth → officeparser 三级降级 | 有 |
| **XLSX** | OfficeCLI → 内建 adm-zip+XML 表格（8 sheet/200 行/40 列上限） | **无** |
| **PPTX** | OfficeCLI → 内建解析（80 张上限） | **无** |
| 旧版 Office | 明确不支持 + 提示用默认 App | 同 |
| 图片 | 10–500% 缩放 + Ctrl/Cmd 滚轮 + 拖拽平移 + 初始 25% 适应 | lightbox |
| 文本/代码 | `@pierre/diffs` highlighter + wrap + 500k 字符/5MB 上限 | CodeMirror/高亮 |
| 音频/视频 | 有 | 有 |
| 不可预览 | 元数据卡片（名/大小/mtime）+ 默认 App 打开，绝不解码 | 有 (`/api/files/reveal`) |
| 缓存 | LRU（session/path/version/scope）+ 滚动缓存 + watcher 静默刷新 + markdown 等滚动恢复完再显示 | `useMarkdownFile` 冲突检测/外部变更 |

### 5.6 终端与浏览器

| 项 | 它 | 我 | 判定 |
| --- | --- | --- | --- |
| PTY 位置 | 独立 utility process（MessagePort 协议，16ms 批处理、1MB 背压、1MB 重放） | Node 主进程 `lib/terminal-manager.ts`（128KB ring + lease） | 对齐 |
| 快照恢复 | 挂载时缓冲输出 → 写快照 → 按序列 ack → 渲染在途事件 | SSE `Last-Event-ID` 重放 | 对齐 |
| 尺寸纪律 | FitAddon + ResizeObserver，忽略 0×0 隐藏 tab（防 Windows ConPTY 回流/光标跳），只有变化才发 rows/cols | 有 fit | 它这个细节值得抄 |
| 退出提示 | 灰字"终端已退出（code）" | 有 | 对齐 |
| **Agent 终端工具** | 6 个工具 + 分页归一化输出 + cwd 授权 + 无人值守禁用 | **无** | **缺**（G14） |
| 从文件区开终端 | 文件树每目录 hover 按钮、改动面板每目录按钮、worktree 按钮 | 部分（右栏终端 tab） | 缺入口 |
| 浏览器 | Electron `WebContentsView`（原生栈顶）+ 完整 CDP + 24 个 agent 工具 + 风险告知门 + profile 隔离 | sandboxed iframe（明确不支持 X-Frame-Options 站点） | **缺**（G20，P5 spike） |

---

## 6. D 面：平台能力

### 6.1 定时任务（Automation）

| 项 | 它 | 我 |
| --- | --- | --- |
| 调度表达 | `interval / daily / weekly / monthly / once`（**无 cron 解析**） | `daily / weekly / once / cron`（**5 字段 cron + 时区**）`lib/cron-schedule.ts:17` |
| 时间窗口 | `interval` 叠加每日 `activeWindowStart–End` + `activeWeekdays`，窗口起点作锚点防漂移 | **已有**：`idleWindow`（HH:MM–HH:MM，允许跨午夜，窗口外顺延到窗口起点）`lib/cron-schedule.ts:20-24, 38-39`；运行日靠 `weekdays` 或 cron 表达式表达 |
| 限次 | `once` + `maxRuns`，达上限自动停用并标 `completedAt` | `once` 有；**无 `maxRuns` 自动停用** |
| 失败处理 | 连续失败 5 次**自动暂停** | 只记 `lastStatus`/`lastError`；**不自动暂停** |
| 子会话策略 | `daily`（同日复用/跨日新建/上下文≥70% 换新）/ `reuse`（始终复用）；用户手发消息即"毕业"，调度器不再注入 | **每次运行都新建会话**（`lib/cron-runner.ts:68` 用 `startRpcSession(\`__cron__${randomUUID()}\`)`），无复用、无毕业机制 |
| 无人值守 | headless 运行、强制 bypass、单次 2h 超时 | 用普通会话运行（`startRpcSession`，`lib/cron-runner.ts:68`）；**无超时**（跑多久都不会被自己砍掉） |
| 重入保护 | 运行中重入跳过 | **已有**：`runningTasks()` + `"already running"`（`lib/cron-runner.ts:35, 49-51`） |
| 错过的执行 | 顺延一个完整间隔（防重启雪崩） | **已有等价物但语义不同**：超出容差窗口的直接跳过并写 `lastError: "skipped (server was not running)"`（`lib/cron-runner.ts:103-105`），UI 用 `missed` 标记（`CronTaskView.missed`） |
| 运行历史 | 记录可点进子会话 | **已有**：`CronRunRecord[]`（`lib/cron-schedule.ts:302-310`，上限 20 条）+ `lastSessionId` |
| 通知 | 完成按 always/success/error 三选一发飞书卡片（**目前只实现飞书**） | 无（有 Web Push 基础设施可复用） |
| Agent 自建 | 7 个 MCP 工具（list/get/create/update/delete/run_now），自动运行中禁止递归创建 | 有 cron 工具（递归保护需核对） |

结论：**我的调度表达力与可观测性更强**（真 cron、时区、idleWindow、历史、missed 标记都是现成的），它的优势集中在**运行生命周期语义**：会话复用 + 失败自动暂停 + 限次自动完成 + 完成通知。G15 只应该做这四件事，不要重做已经有的。

### 6.2 Todo / 日程 / 提醒

| 项 | 它 | 我 |
| --- | --- | --- |
| 存储 | SQLite（`~/.proma/planning.db`，schema v9 + 顺序迁移，`BEGIN IMMEDIATE`） | localStorage（`lib/todo-state.ts`） |
| Todo 字段 | 标题/说明/优先级/截止/分组/标签/工作区/状态 | 有（会话级） |
| 日程 | 独立模型 + 月视图 + 分组 + 关联 Todo | **无** |
| 提醒 | 主进程系统通知（silent）+ 30s 轮询 + snooze/acknowledge 工具 + 常驻 rail | **无** |
| Agent 工具 | 22+ 个 `mcp__planning__*`（Todo/日程/分组/标签/提醒的 CRUD + complete + snooze） | 有 todo 工具 |
| Agent 变更自动展示 | 写 Todo/日程 → 自动切到对应项目组件（记忆除外，等 watcher 真实 diff） | 有 TodoChip |
| macOS EventKit 双向同步 | N-API addon + 权限状态机（7 态）+ 30s 轮询 + 变更通知 + outbox 重试 + 冲突表 + 有界导入窗口（-30 天~+12 月） | 不搬（N4） |
| Agent Island | macOS 刘海 / Windows 托盘显示待接手 agent + 1h 内到期项（最多 3 条，标逾期） | 不搬（N5） |
| 快速任务浮窗 | 全局 `Alt+Space` 无边框置顶窗口 + 附件 + Chat/Agent 切换 + `⌘1/⌘2` | 不搬（N9）/ P5 退化版 |

### 6.3 记忆

| 项 | 它 | 我 |
| --- | --- | --- |
| 位置 | 工作区级 `~/.proma/agent-workspaces/{slug}/memory/`；`MEMORY.md` 只作索引 | pi-memory 包（`lib/pi-memory.ts` + `/api/memory/files`） |
| 注入方式 | **正文不自动注入**：系统提示词给目录/索引路径 + 写入规则，agent 按需 Read | 同类（pi-memory 的机制） |
| 引导 | 按文件真实缺口生成：缺 `user-profile.md` 时提示渐进建画像；自动化/委派/Bridge 运行绝不触发 | 无 |
| 周检邀请 | >3 天未整理且有新会话 → 邀请 agent 用 AskUser 征求授权，冷却状态写工作区 config | 无 |
| 变更 watcher | 受限防符号链接监听（180ms 去抖、≤128 目录/512 文件、深度 6）→ created/modified/deleted + 小 diff | 无 |
| UI | 能力中心记忆 tab + 独立记忆窗口（AGENTS.md + memory 文件树 + 自动保存 + 外部冲突检测 + 变更 Shelf/时间线） | `PiMemoryConfig.tsx`（安装/状态/文件） |
| 初始化引导 | 两段受授权 prompt（建知识 / 历史会话补证据），带 1/2/3 月范围 + "最多 3 个高信号会话"预算 + 禁止全量扫描 | 无 |

### 6.4 Skills / MCP

| 项 | 它 | 我 |
| --- | --- | --- |
| 作用域 | **工作区级**（`skills/` ↔ `skills-inactive/` 目录移动切换）；项目内 ambient skills **被显式禁用** | pi 的三层（全局/项目/包）+ `disable-model-invocation` 手术式改写 |
| 内置 | 17 个随包技能（automation / agent-collaboration / session-cleaner / skill-creator / pdf / docx / xlsx / pptx …） | 无内置（依赖用户装 + skills.sh） |
| 升级 | 按 `SKILL.md` frontmatter `version` 比较，bundled 更新才覆盖；退役 slug 清理 | `skill-updates.ts` + `/api/skills/check` `/update` |
| 分发 | 工作区导入/导出（复制/批量），同名拒绝 | skills.sh 搜索 + 安装 |
| 子文件编辑 | Skill 子文件树 + 新建/重命名/删除（10MB / 深度 8 限制） | `SkillsConfig` 只切 `disable-model-invocation` |
| MCP 配置 | 每工作区 `mcp.json`（stdio/http/sse）；**启用前必须真实 handshake + listTools 验证，成功才写 enabled**；并发写按工作区串行 | `/api/mcp` CRUD + `/api/mcp/discover`（一键导入别家配置） |
| MCP 凭据 | OAuth PKCE（本地 callback + RFC 8707 resource）+ API Key 全 `safeStorage` 加密进 Keychain；stdio 凭据与启动命令绑定比对防偷 | 明文/pi auth.json |
| 内置集成目录 | 4 类（OAuth / API Key / 引导 / CLI）共 18 个：GitHub、Notion、Google 日历、Linear、Vercel、Supabase、Stripe、Exa、Brave、Tavily、腾讯文档、通达信、携程问道、百度网盘、企查查、东方财富、企业微信、钉钉、飞书 | 无 |
| Agent 自管 MCP | 系统提示词要求先 list 再 configure，禁止直接编辑 mcp.json | 无 |
| CLI | 打包 `proma` 二进制，只读会话检查（list/info/outline/search/export），采用"渐进式读取"设计 | pi CLI 本身（同一份数据，能力更全） |

### 6.5 渠道与 provider

| 项 | 它 | 我 |
| --- | --- | --- |
| provider 数 | 24 家预设（Anthropic/OpenAI/Codex/Copilot/xAI/DeepSeek/Kimi/智谱/火山方舟/MiniMax/通义/小米/Google/custom…） | models.json 自配 + models.dev 目录 + 发现 |
| 密钥加密 | `safeStorage`（Keychain/DPAPI/Secret Service），不可用回退明文 + 告警 | pi auth.json（明文，pi CLI 共用） |
| OAuth | Codex / Copilot / xAI 设备码，UI 展示 device code 可复制/扫码/取消；运行时取 access token 按 expires 刷新（并发锁 + 条件回写） | OAuth + 设备码 + 手动码回填（`/api/auth/login/[provider]`） |
| 连接测试 | 每家走真实 endpoint（无 `/models` 的用极小 messages ping），15s 超时 | `/api/models-config/test` |
| 额度查询 | Codex wham/usage、Kimi coding、MiniMax token_plan、DeepSeek balance、智谱 quota（5h/周/余额窗口 + reset） | `/api/provider-usage`（OpenCode Go 等） |
| Vision relay | 视觉助手降级转发 | 不搬（N7） |
| 代理 | 应用内设置（系统/手动模式 + URL） | `lib/http-dispatcher.ts`（HTTP_PROXY 环境变量） |

### 6.6 工作台文件模型

| 项 | 它 | 我 |
| --- | --- | --- |
| 项目索引 | `~/.proma/agent-workspaces.json`，slug 唯一、可排序、可绑本地根；非 ASCII 回退 `workspace-{ts}`；Windows 保留名处理 | 会话 cwd 派生 + allow-list（`lib/file-access.ts`） |
| 工作区目录 | `mcp.json` / `skills/` / `skills-inactive/` / `memory/` / `AGENTS.md` / `workspace-files/` / 每会话一个工作台目录 | 无（git worktree 是唯一"项目级"概念） |
| 项目文件 vs 会话文件 | 本地项目 → 用户目录；空白项目 → 托管 `workspace-files/`；会话私有（todo/plan/交接）写会话工作台；项目级跨会话资料写 `.context/` | chat-workspace（单一全局聊天目录，patch 0001） |
| 附加目录 | 会话级 + 工作区级，父目录自动授权，提示词用 `<attached_directories>` 列出，启动清理失效路径 | allow-list + `@path` 引用（无"附加"概念） |
| 会话 cwd 解析 | worktree > `agentCwdMode=project` 的项目根 > 会话工作台 | 会话 cwd（不可变）+ worktree 分组 |
| AGENTS.md 双层 | 项目根（项目地图）+ 工作区（Proma 执行环境），不一致时保留两份等用户处理，绝不覆盖；旧 CLAUDE.md 安全迁移 | project instructions（pi）+ project-trust |
| 草稿会话 | `isDraft` 临时会话跨重启保留，完成未确认标记 | draft-store（输入草稿，非会话） |

---

## 7. E 面：设置、快捷键、外壳

### 7.1 设置面板

| 它的 tab | 内容 | 我的对应 |
| --- | --- | --- |
| general | 用户档案（emoji/图片头像/用户名）、语言（占位）、Todo/日程/Obsidian 开关、桌面通知与提示音库、Windows 状态通知、macOS 灵动岛、自动归档 0/7/14/30/60 天、长文本转附件阈值、输入框 markdown 渲染、会话悬浮预览、Git/PR 推广标识 | `SettingsPanel` general 段（外观/密度/边框/壁纸/声音/推送/引用/PowerShell） |
| channels | 渠道 CRUD + 24 provider 表单 + OAuth + 额度 | `ModelsConfig` |
| vision-relay | 视觉助手 | 无 |
| prompts | 提示词 CRUD | 部分 |
| proxy | 代理 | 无（走环境变量） |
| voice-input | 豆包 ASR | 无（N8） |
| bots | 飞书/Slack/微信/钉钉 + 用法 + 品牌素材 | 无（N6） |
| **shortcuts** | 快捷键总表 + 录制 + 冲突 + 禁用 + 恢复默认 | **无**（G18） |
| migration | 迁移压缩包/恢复 prompt | 无 |
| **storage** | 用量统计 + 清理策略 | **无**（G17） |
| appearance | 主题模式 / 界面缩放 / markdown 字号 | 我多得多（6 套皮肤 + pi 主题 + 壁纸 + 密度 + 边框深度） |
| onboarding | 重放新手引导 | 无 |
| about | 版本/运行时/协议/更新卡片/Agent Shell（Windows Git Bash/WSL 选择与检测）/版本历史 | 部分（about + app-update 提示） |
| （关闭纪律） | Cmd+W/ESC 关闭（Radix 优先）；渠道表单有未保存内容时切 tab/关闭/点会话都弹确认 | 无 dirty 提示（omp 计划 PR-11 已识别） |

### 7.2 快捷键

| 项 | 它 | 我 |
| --- | --- | --- |
| 默认表 | 20 条 / 4 组（app/edit/navigation/global），mac/win 双默认，菜单角色类标 `readonly` | `hooks/useKeyboardShortcuts.ts`（固定集合） |
| 全局键 | 快速任务 `Alt+Space`、显示主窗 `Cmd/Ctrl+Shift+P`、语音 `` Ctrl+` `` | 无 |
| 分发 | 单一 capture 阶段 keydown + Map 分发；解析 accelerator；exclusive 模式让最内层独占；禁用项不进缓存 | 模块级注册表 + abort handler registry |
| 严格匹配 | 防 `Cmd+K` 被 `Cmd+Shift+K` 误触 | 有 |
| 录制 UI | 点按录制 + 修饰键提示 + F1–F24 + 冲突即时提示 | 无 |
| 主进程注册 | `globalShortcut` + 用户覆盖 + 禁用（null）+ 注册失败告警 + 变更重注册 | 无 |

### 7.3 外壳与发布

| 项 | 它 | 我 |
| --- | --- | --- |
| 多窗口 | 主窗 + 预览窗 + 记忆窗 + 听写窗 + 指示器窗 + 快速任务窗 | 单窗 |
| 托盘/状态 | Agent Island + 托盘 | 托盘（显示/退出） |
| 自动更新 | 完整（见 G19） | `/api/app-update`（npm registry 版本比对 + 12h 缓存） |
| 更新 UI | 设置 about 的更新卡片（checking/downloading/downloaded/error + 进度 + 空闲安装/取消）+ 版本历史 + ReleaseNotesViewer | ChatWindow 顶部提示条（有更新时） |
| 发布日志 | GitHub Release API（30 分钟缓存 + 403/429 冷却 15 分钟 + 中文错误） | 无 |
| 打包 | 四平台（mac arm/intel + win + linux deb/AppImage），node-pty rebuild、原生 helper 编译、officecli 准备 | mac `dir` target，`after-pack.mjs` 注入 externalized 包 |
| 自我约束 | 每次改动必须递增版本号（含默认 skill 的 frontmatter version） | 无（版本号按 release 手改） |
| i18n | **无** | 3 语言 996 key + 三语同步测试 |
| Web 部署 | 无 | 自托管 + 密码 + PWA + Web Push + Docker（omp 计划 PR-15） |

---

## 8. 反向：我有、它没有（20 项）

写在这里是为了避免对比失衡——下面这些是**本仓库更强的地方**，PR 计划里不应该出现"因为 Proma 有所以补"的条目。

| # | 我的能力 | 它的状态 |
| --- | --- | --- |
| 1 | 3 语言 i18n（996 key，三语同步测试强制） | 无，硬编码中文 |
| 2 | Web 自托管 + 密码认证 + PWA + Web Push | 无（桌面 only） |
| 3 | **完整 cron 表达式 + 时区 + 时间窗 + 运行历史 + missed 标记** | 只有结构化 scheduleType，无 cron 解析 |
| 4 | 与 pi CLI 共享同一份状态（会话/模型/设置/技能全通） | 自管一套平行世界 |
| 5 | 模型层：models.dev 目录、`enabledModels` glob 作用域、模型发现、thinkingLevelMap、连接测试、价格 | 只有 provider 预设 + 额度查询 |
| 6 | MCP 配置一键导入（Claude / Codex / Cursor / VS Code） | 无 |
| 7 | 项目信任（project trust）+ 命令环境隔离（ADR 0001） | 有授权模型但无独立信任 UI |
| 8 | 会话导出 HTML + Markdown | 只有 proma CLI 的 export |
| 9 | Worktree 归组（一个仓库所有 worktree 显示在一个项目行） | 会话级 worktree + selector |
| 10 | 技能搜索/安装（skills.sh）+ 更新检查（`/api/skills/check` `/update`） | 工作区导入/导出 |
| 11 | 插件包管理（npm 级 install/remove/update/enable/disable + resources 分组 + 诊断） | 无 |
| 12 | Subagent profile 编辑器（scopes、模型/思考、技能与扩展开关、frontmatter 往返） | 有协作工具但无 profile 体系 |
| 13 | 皮肤系统：6 套 Codex 色板 + 壁纸 + 密度 + 边框深度 + 聊天外观（字号/列宽/widget 字号） | 3 档外观 |
| 14 | 分支导航器 + 消息树投影（`BranchNavigator` + `lib/session-tree.ts`） | 只有 header 里的探索分支下拉 |
| 15 | 安全边界：`/api/files` 白名单 + host/origin 白名单 + `lib/path-security.ts` 单一实现 | 有路径校验但无统一边界文档 |
| 16 | Provider 用量查询面板 | 额度查询在渠道表单里 |
| 17 | 跨会话全文搜索（`lib/session-search.ts`） | 有（`agent-session-manager.ts:1306`，上限 100 会话/各 2 条） |
| 18 | 文件上传（拖拽 + bounded form data） | 有（另存到会话工作台） |
| 19 | 扩展 widgets / status line / 自定义 UI（pi extension 生态直通） | 自研 UI 协议 |
| 20 | 工具预设 4 档 + ADR-0002 的 Chat-only 资源策略 | Chat/Agent 双模式（两条会话） |

---

## 9. 明确不搬清单（不做，且理由已定）

见 §2.3 的 N1–N12。补充三条会在 PR 计划里被反复引用的边界：

- **不引入第二个 agent loop**。任何需要"在工具执行前拦截并等待用户"的功能，都走 pi 扩展的 `tool_call` 事件，不新建 orchestrator。
- **不引入 `~/.proma` 式的第二套配置根**。新能力的数据一律进 `~/.pi/agent/` 或浏览器 localStorage，且必须能被 pi CLI 忽略而不报错。
- **不做桌面绑定能力**（EventKit / Agent Island / 多窗口 / 全局热键的强依赖版本）。Web 端有等价退化就做退化版，没有就不做。

---

## 10. 与既有 PR 计划的去重表

已识别的缺口里，有 6 项已经在别的文档里排过队。PR 计划里以"引用 + 合并"方式处理，不重复开条目：

| Proma 项 | 已有计划 | 处理 |
| --- | --- | --- |
| MU-31 审批卡 | `musepi-borrowing-plan-2026-09-17.md:558` **MU-31** | 本计划的 PROMA-01 是 MU-31 的**超集**（MU-31 只升级卡片；PROMA-01 连引擎、白名单、恢复、风险档一起做）。且 **MU-31 的「不做（等引擎）」结论已在 §3.2.1 被推翻**——引擎已支持，无阻塞。建议 MU-31 并入 PROMA-01 |
| 划词工具条 | `musepi-borrowing-plan-2026-09-17.md:531` **MU-04** | Proma 的 `AgentHistorySelectionLayer` 多一个"探索此分支"动作 → 并入 PROMA-05 |
| Git 面板 | `musepi-borrowing-plan-2026-09-17.md:543` **MU-16** | Proma 的改动面板（G9）是 MU-16 的**只读半边**（不做 stage/commit/PR）。建议先做 PROMA-09，MU-16 的 stage/commit 后置 |
| 更新对话框 | `omp-web-pr-plan-2026-09-17.md` **PR-13/PR-14** | Proma 的 G19 是这两条的实现参考。PROMA-18 与 PR-13/14 **合并为一个 PR** |
| 命令面板 + 快捷键 | `musepi-borrowing-plan-2026-09-17.md:532` **MU-05** | Proma 的 G18 是 MU-05 的"设置页 + 录制"半边。PROMA-17 只做快捷键表/录制/冲突，命令面板留给 MU-05 |
| 消息树画布 | `musepi-borrowing-plan-2026-09-17.md:674` **MU-25** | 与本计划无重叠（Proma 没有消息树画布） |
| 底部面板 / 右栏瘦身 | `ui-layout-pr-plan-2026-09-17.md` **UI-06 / MU-12** | Proma 的右栏双 pane（G-5.1）与 UI-06 方向相反，**本计划不做双 pane** |

---

## 附录 A：证据索引（Proma 侧关键文件）

```
apps/electron/src/main/lib/
  agent-orchestrator.ts            2374 行：发送流水线 / 权限初始化 / canUseTool / 恢复 / rewind / 队列注入
  agent-permission-service.ts      权限引擎：升级链 / 白名单 / 危险评估 / respond
  agent-exit-plan-service.ts       计划审批：路径+哈希校验 / 三出口
  agent-plan-file-policy.ts        计划文件路径策略
  agent-session-manager.ts         自管会话存储 / fork / rewind / 截断 / 搜索
  agent-collaboration-tools.ts     9 个子会话协作工具 + 阻塞冒泡
  agent-queue-coordinator.ts       队列调度
  agent-prompt-builder.ts          系统提示词 / 动态上下文 / 记忆引导
  agent-memory-refresh-service.ts  3 天周检邀请
  browser-controller.ts            CDP 控制器（16 种操作 + ref 失效语义）
  pi-builtin-tools.ts              内置 MCP 工具总表（automation/planning/collaboration/browser/terminal/vault）
  planning-manager.ts              SQLite Todo/日程
  planning-native-sync-coordinator.ts  EventKit 双向同步
  automation-scheduler.ts          定时任务调度
  bridge-*.ts                      微信/飞书/钉钉/Slack
  updater/auto-updater.ts          自动更新

apps/electron/src/renderer/
  components/agent/                Agent 主视图与全部运行 UI（权限/计划/Ask/进度/队列/探索）
  components/chat/                 Chat 模式
  components/planning/             Todo / 日程 / 定时任务工作区
  components/file-browser/         多根文件树 + 文件操作
  components/diff/                 改动 + 预览 + Diff
  components/markdown/             实时 Markdown 编辑器
  components/browser/              受管浏览器
  components/obsidian/             Vault
  components/settings/             14 个设置面板
  lib/shortcut-*.ts                快捷键系统
```

## 附录 B：本次对比用到的探索结论（保存供 PR 计划引用）

- Proma **没有** `agent-rewind-contract.ts` 实现文件，只有契约测试（`agent-rewind-contract.test.ts`）。
- `shouldAutoDispatchQueuedMessage`（`agent-message-queue.ts:34`）**无生产调用者**，队列实际由主进程 `AgentQueueCoordinator` 派发。
- `components/diff/MarkdownRichEditor.tsx` + toolbar + TableBubbleMenu + `markdown-preview-extensions.tsx` **全是孤儿代码**（无引用者），生产路径是 `markdown/LiveMarkdownEditor.tsx`。
- Automation 完成通知**只实现了飞书**（`automation-notification-service.ts:5` 文件头注释）。
- 记忆正文**不自动注入**，只注入目录/索引路径与写入规则。
- Skills/MCP 是**工作区级**，项目内 ambient skills/MCP/context 被显式禁用（`pi-resource-loader-overrides.ts:12-24`）。
- 文件回退（file rewind）**明确不支持**，以 `fileRewind.canRewind = false` 正常返回。
- EventKit 仅 **macOS 14+**，只扫描用户明确连接的集合。
- 计划模式下 planning MCP **只读**，REPL/Workflow/cron/monitor/通知类工具一律拒绝。
