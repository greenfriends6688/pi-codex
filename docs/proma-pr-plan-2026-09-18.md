# Proma 借鉴项 · PR 拆分与实施计划

日期：2026-09-18
配套对比：[`proma-comparison-2026-09-18.md`](./proma-comparison-2026-09-18.md)
基准：`@agegr/pi-web` 0.9.1 fork（HEAD `05af204`）

***

## 0. 拆分原则

| 原则 | 说明 |
| --- | --- |
| **单一意图** | 一个 PR 只做一件事；皮肤/CSS 与功能**绝不**混在一个 PR |
| **可独立回滚** | 每个 PR revert 后系统仍可用；新文件新路由优先于改老文件 |
| **不引入第二个 agent loop** | 所有"工具执行前拦截"走 pi 扩展的 `tool_call` 事件（`docs/extensions.md:778-817`），不新建 orchestrator |
| **不引入第二套配置根** | 新能力的数据进 `~/.pi/agent/` 或 localStorage，且 pi CLI 忽略后不报错 |
| **不做桌面绑定** | EventKit / Agent Island / 多窗口 / 强依赖全局热键的能力不做；Web 端有等价退化才做 |
| **自带测试** | 新增 `lib/` 逻辑必须带 `.test.mjs`；纯 UI PR 至少一个源码断言测试（本仓库惯例） |
| **i18n 三语同步** | 新增文案必须同时进 `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`（`lib/i18n/registry.test.mjs` 会卡住） |
| **搬运带证据** | 每个 PR 的「依据」列到 Proma 的 `file:line`，实施时对照，不凭记忆 |
| **合并既有计划** | 与 MU-/PR-/UI- 编号重叠的，在对应 PR 里注明"并入"，不另开条目 |

### 统一 DoD

```bash
node_modules/.bin/tsc --noEmit     # 必过
npm run lint                       # 0 error
npm test                           # 除 README 已登记的两条环境性用例外全过
# 改动 app/globals.css 时追加：
node docs/codex-skin/audit-tokens.mjs
mv .next $(mktemp -d)/next && npm run prod   # 干净重建
node docs/codex-skin/verify-themes.mjs
# 涉及 Electron 主进程/打包时追加：
npm run desktop                    # 起桌面壳冒烟
```

**子代理红线的复用**：给子代理的扩展不能暴露保留工具名（`Agent`/`get_subagent_result`/`steer_subagent`），见 ADR-0003。PROMA-02/03 的工具拦截实现必须遵守同一条。

***

## 1. 阶段总览

| 阶段 | 主题 | PR 数 | 依赖 | 风险 | 价值密度 |
| --- | --- | --- | --- | --- | --- |
| **P1** | Agent 编排与权限 | 4 | — | 中高（碰工具执行链） | ★★★★★ |
| **P2** | 上下文与协作 | 4 | PROMA-01（阻塞冒泡复用审批通道） | 中 | ★★★★☆ |
| **P3** | 右栏与文件 | 5 | — | 低 | ★★★☆☆ |
| **P4** | 平台能力 | 6 | — | 低-中 | ★★★☆☆ |
| **P5** | 评估型（先 spike） | 3 | 视 spike 结论 | 高 | ★★☆☆☆ |

**推荐节奏**：`P1 → (P2 ∥ P3) → P4 → P5`。

- **P1 必须最先做**：它是 Proma 与本仓库差距最大的一面，也是 P2 里"子会话阻塞冒泡"等条目的前置（要有个能等用户回答的通道）。
- **P2 与 P3 无代码依赖**，可双线并行。
- **P4 全部独立**，任何一条都能单独插队。
- **P5 一律先 spike 再决定做不做**，spike 不合并。

---

## 2. P1 — Agent 编排与权限（4 个 PR）

> 这一阶段回答一个产品问题：**现在的 Pi 是全自动的，用户没有任何刹车。**
> Proma 用「权限模式 + 工具审批 + 计划模式」三级刹车回答了它，而且它的实现路径（pi `tool_call` 阻断 + 前端确认卡）在我这里完全可用。

### PROMA-01 · 工具审批卡 + 审批引擎

- **目标**：工具执行前可按策略弹出审批卡；支持「允许一次 / 本次会话总是允许 / 拒绝」；多张请求按 FIFO 排队；页面刷新后待决请求可恢复。

- **依据**：
  - 升级链与白名单：`agent-permission-service.ts:120-167`（worker 自动放行 → 会话白名单 → 只读放行 → 建请求阻塞）
  - 不可白名单的一次性确认：`:169-195`
  - PowerShell 永不入白名单：`:197-218, 265-305`
  - abort → 拒绝：`:155-162`
  - 危险评估与人话描述：`:336-445`
  - 卡片 UI 与键位：`PermissionBanner.tsx:39, 51-66, 68-84, 95-118, 201-205, 207-218`
  - 刷新恢复：`useGlobalAgentListeners.ts:982-995`

- **接入点**：
  - 新 `lib/approval-policy.ts`（纯函数：风险档判定、白名单匹配、只读/安全命令分类）+ `.test.mjs`
  - 新 `lib/approval-extension.ts`：pi 扩展，`pi.on("tool_call")` 里按策略决定放行/挂起，通过扩展 UI 通道发请求（复用 `extension_ui_request` 事件类型，新增 `method: "approval"`）
  - `hooks/useAgentSession.ts`：新增 `approvalRequests` 状态 + `respondToApproval`
  - 新 `components/fork/ApprovalCard.tsx`（渲染在 `ChatWindow` 的 extension dialog 位置旁，支持多张队列）
  - 会话白名单持久化：`lib/session-tool-grants.ts`（新增 `pi-web:tool-grants:<sessionId>` custom entry，走既有的 versioned custom entry 模式）

- **注意**：
  - **不要**改成"所有工具都要确认"——默认策略必须保持全放行，只有用户显式打开或命中危险模式才拦（对齐 Proma 的 `bypassPermissions` 默认）。
  - 只读/安全判定必须**宁可漏放不可误判为安全**：Proma 的 Bash 只读正则（`agent-orchestrator.ts:1204-1240`）是有价值参考，但要连同危险模式一起搬，不要只搬白名单。
  - 卡片只显示参数摘要，**不要**把完整密钥/长内容回显；沿用 `lib/redact`-类思路（若无则新建最小脱敏）。
  - 审批等待期间要能停止本轮（`stop` 必须能打断挂起的 Promise，对齐 `:155-162`）。
  - **引擎侧无需等上游**：本 PR 不属于"被阻塞项"。`delta.md:1199-1205` 的「不做（等引擎）」结论已在本计划配套对比文档 §3.2.1 推翻——pi 官方文档把 permission gate 列为扩展首要用例（`docs/extensions.md:19`）并给了完整片段（`:70-74`），而本仓库的 UI 与回答链（`ChatWindow.tsx:1812-1990` + `useAgentSession.ts:805-814` + `lib/rpc-manager.ts:973`）已经做完。本 PR 从零写的只有**语义层**（风险档 / 摘要 / 白名单 / 队列 / 恢复）。落地时同步更新 `delta.md` §27 的结论。

- **工作量**：M–L（~600 行 + 测试 + i18n 约 20 key）
- **风险**：中高。碰的是工具执行链；唯一的兜底是"策略放行"分支必须与现状完全等价（可用现有 e2e 断言锁住）。
- **并入**：MU-31（`musepi-borrowing-plan-2026-09-17.md:558`）。MU-31 只升级卡片，本 PR 做完整引擎，实施时以本 PR 为准。

### PROMA-02 · 权限模式（bypass / ask / plan）

- **目标**：每会话可选「全自动 / 需审批 / 计划」三档；运行中可切换且失败回滚；模式随会话恢复；计划档的图标优先显示。

- **依据**：
  - 模式集合与默认：`agent-orchestrator.ts:1138-1142`
  - 会话级持久化与热切换：`ipc.ts:3645-3666`；`agent-orchestrator.ts:2306-2327`
  - 乐观更新 + 失败回滚：`PermissionModeSelector.tsx:56-88`
  - 恢复优先级：`:40-53`
  - 显示模式覆盖：`lib/agent-plan-mode.ts:38-44`
  - 进入/退出信号：`agent-plan-mode.ts:9-17`

- **接入点**：
  - 新 `lib/permission-mode.ts`（纯函数：模式定义、显示名、从工具事件推导状态）+ `.test.mjs`
  - 会话持久化：新增 `pi-web:permission-mode` custom entry（与 `lib/session-tool-selection.ts` 同一写入模式）
  - `components/ChatInput.tsx` 控件行：加模式切换按钮（在工具预设旁）
  - `hooks/useAgentSession.ts`：模式读取/写入/热切换（切换只需更新 wrapper 的扩展配置，不需要重建会话）

- **注意**：
  - 模式存储**必须**是会话级 custom entry，不能放 localStorage（会话要能跨浏览器/跨机器带模式）。
  - 依赖 PROMA-01 的引擎；若 PROMA-01 未合，本 PR 只能先落"模式 UI + 持久化"，拦截逻辑留空（拆成两个 PR 的降级路径）。
  - 与 ADR-0002 的 Chat-only 预设交叉：Chat-only 会话下模式无意义，控件要隐藏。

- **工作量**：S–M（~250 行 + 测试 + i18n ~8 key）
- **风险**：低。纯状态 + UI，不改工具链。
- **依赖**：PROMA-01（软依赖，见上）

### PROMA-03 · 计划模式（plan mode）

- **目标**：计划模式下 agent 只读，只能把计划写进会话的 `plan/` 目录；提交计划时弹审批（批准 → 转全自动 / 拒绝 / 反馈）；审批时重新校验计划文档未被改动；计划可在只读预览中查看。

- **依据**：
  - 计划文件路径策略（绝对路径、真实目录、非符号链接、≤1MB、新文件父目录存在）：`agent-plan-file-policy.ts:9-42`；`agent-orchestrator.ts:1430-1443`
  - 审批请求带 `allowedPrompts` + sha256、阻塞等待：`agent-exit-plan-service.ts:65-113`
  - 批准时**重新校验位置与哈希**，过期即拒：`:125-140`；`isPlanDocumentCurrent` `:254-258`
  - 拒绝 / 带反馈拒绝：`:141-160`
  - 计划模式工具策略全表：`agent-orchestrator.ts:1249-1268`（只读白名单、Write/Edit 仅 plan/*.md、Bash 只读分类、PowerShell 显式只读、浏览器只 observe/find/extract/screenshot/list/preview-open、planning 只读、REPL/Workflow/cron/monitor/通知类拒绝、终端拒绝）
  - 三选项横幅 + 键位：`ExitPlanModeBanner.tsx:35-58, 63, 105-112, 141-204, 341-345`
  - 虚线外框：`PlanModeDashedBorder.tsx:10-13, 22`
  - 完成后引导"请执行该计划"（仅本地会话）：`agent-orchestrator.ts:2113-2124`

- **接入点**：
  - 新 `lib/plan-mode.ts`：计划目录解析、路径策略、文档哈希校验（纯函数，可单测）
  - 新 `lib/plan-extension.ts`：注册 `EnterPlanMode` / `ExitPlanMode` 工具；`EnterPlanMode` 翻模式，`ExitPlanMode` 发审批请求并阻塞
  - 复用 PROMA-01 的审批通道（`method: "approval"` 扩展成 `method: "plan-review"`，或直接复用带 `options[]` 的通用确认卡）
  - 计划文件通过既有文件查看器打开：`/api/files/[...path]` 已支持读取，`FileViewer` 加 `readonly` 模式即可
  - `components/fork/PlanModeBorder.tsx`（SVG 虚线，纯 CSS/测量，不动布局）

- **注意**：
  - **哈希校验是这个功能的灵魂**，不要省。没有它，"批准的计划"和"实际执行的计划"可以不一致。
  - 计划目录必须在会话工作目录下，且要过 `lib/path-security.ts` 的 allow-list（`isPathWithinRoots()` 是唯一安全边界实现，别另写一份）。
  - 只读工具白名单要跟 pi 的工具名对齐（`lib/tool-names.ts` 已有别名表），不要照抄 Proma 的工具名。
  - 计划模式的"只读"要覆盖 pi 的 `bash`（这是最容易绕过的一环）。

- **工作量**：L（~700 行 + 测试 + i18n ~25 key）
- **风险**：中高。拦截面广，容易误伤正常工具。缓解：策略表独立成数据（便于测试与放宽），并为每条规则写单测。
- **依赖**：PROMA-01、PROMA-02

### PROMA-04 · 会话回退（rewind）

- **目标**：消息右键「回退到此处」→ 截断该消息之后的所有对话；运行中/无 pi session id 时拒绝并给明确原因；截断是原子的（失败回滚）。

- **依据**：
  - 前置拒绝（运行中 / 旧记录 / 无 session id）：`agent-orchestrator.ts:2329-2355`
  - 事务顺序（严格解析 → branch artifact → 原子截断 → 元数据提交，失败还原）：`agent-session-manager.ts:932-1030, 110-117, 1000-1012`
  - 按 UUID **含**该条截断：`agent-session-manager.ts:1118-1145`
  - 文件回退**明确不支持**（正常返回而非报错）：`:2346-2352`；契约测试 `agent-rewind-contract.test.ts:17-24`
  - UI：警示对话框 + 成功/部分成功两种 toast + 成功后刷新消息与 diff：`AgentView.tsx:3177-3193, 2599-2614, 2582-2594`

- **接入点**：
  - 新 `lib/session-rewind.ts`：严格 JSONL 读取、按 entryId 截断、原子写（复用 `lib/atomic-file.ts`）
  - 新 API `app/api/sessions/[id]/rewind/route.ts`（POST `{ entryId }`）：先 `send("fork")` 拿 pi branch artifact，再截断。**必须**先 `destroy()` wrapper（沿用 fork 的既有纪律，见 AGENTS.md「Fork must destroy the wrapper immediately」）
  - `components/MessageView.tsx`：消息操作里加「回退到此处」（放在 fork 旁边）+ 警示对话框
  - `hooks/useAgentSession.ts`：回退后重载消息与 `entryIds`

- **注意**：
  - **必须先 destroy wrapper**：fork 会原地改写 `inner.sessionId`，回退同样要重建，否则下一次请求拿到脏状态（AGENTS.md 已记录这个坑）。
  - 截断后父会话的 `parentSession` 链不受影响（那是展示元数据）。
  - 拒绝路径要**返回可读原因**而不是 500（"运行中不能回退"是最常见的情况）。
  - 不提供文件回退（对齐 Proma 的 `canRewind: false` 边界）；UI 上不要暗示"文件也会回退"。

- **工作量**：M（~400 行 + 测试）
- **风险**：中。写会话文件，但有原子写 + 回滚纪律，且 fork 已经把这条路走通了。

---

## 3. P2 — 上下文与协作（4 个 PR）

> 这一阶段回答：**长会话的上下文怎么组织，以及多个 agent 怎么协作。**
> 我已有 fork、in-session branch、内置 subagent；Proma 的价值在"收口动作"——把探索结论带回主线、把子会话的阻塞冒泡到父会话。

### PROMA-05 · 探索分支 + 结论带回主线

- **目标**：从任意主线消息一键开探索分支（继承该点之前上下文）；分支在右栏以独立 tab 打开、可与主线并排看；分支跑完可以「带回结论」——只把 fork 点之后的内容插入父会话草稿（不自动发送）。

- **依据**：
  - 探索元数据（`explorationParentSessionId` / `sourceMessageId` / `sourceLabel`）：`packages/shared/src/types/agent.ts:780-788, 1402-1411`；持久化 `agent-session-manager.ts:891-897`
  - 右栏 `exploration:<sessionId>` tab 与"带回"动作：`SidePanel.tsx:313-452`
  - 从消息操作栏创建：`AgentView.tsx:2530-2566`，守卫为"仅主线 assistant 消息有 `piEntryBindings`"
  - 从划词创建：`AgentHistorySelectionLayer.tsx:402-446`
  - header 里重开已有关闭的探索分支：`AgentHeader.tsx:37-62`
  - 父会话读分支时的上下文卫生：`agent-session-context-prompt.ts:201-210`（注入 `<exploration_delta>`，指示只用 `session export --after-message` 读 fork 后内容）
  - 边界：嵌入的探索窗格内**禁用**再探索（防嵌套）；子 agent 的 sidechain uuid 拒绝并给友好错误：`AgentMessages.tsx:238`；`AgentHistorySelectionLayer.tsx:44`；`AgentView.tsx:2560-2563`

- **接入点**：
  - 复用现有 fork：`POST /api/agent/[id]` 的 `fork` 命令 + `lib/session-family.ts`（已有父子关系）
  - 新 `lib/exploration.ts`（纯函数：探索元数据读写、回带内容裁剪、"只取 fork 点之后"的过滤）+ `.test.mjs`
  - 新 `components/fork/ExplorationPanel.tsx`：右栏探索 tab（复用 `TabBar` 的 tab 类型扩展）
  - `components/MessageView.tsx`：加「探索此分支」动作；`components/fork/SelectionToolbar.tsx`（MU-04 若已做）加同一动作
  - 父会话提示词：`lib/session-reader.ts` 的 `buildSessionContext` 或 prompt 组装处注入 `<exploration_delta>` 段

- **注意**：
  - "带回结论"**不自动发送**（Proma 明确如此），只写进草稿并加 `&session:<id>` 引用。自动发送会污染主线，这是设计意图不是遗漏。
  - 只取**fork 点之后**的 assistant 内容；pre-fork 内容已在父会话里，重复注入等于双倍上下文。
  - 与 in-session branch（`navigate_tree`）别混：探索 = 新文件，in-session branch = 同文件多 leaf（AGENTS.md 已强调这个区分）。
  - 关闭分支 tab 不等于删除分支（分支是独立会话，仍可从 header 重开）。
- **工作量**：M–L（~550 行 + 测试 + i18n ~15 key）
- **风险**：中。与既有 fork 逻辑相邻，注意别改坏 fork。
- **并入**：MU-04 的「探索此分支」动作（`musepi-borrowing-plan-2026-09-17.md:531`）。

### PROMA-06 · 子会话阻塞冒泡 + 委派状态

- **目标**：子会话遇到需要用户回答的情况（审批 / 提问）时，父会话直接看到并能回答；子会话在侧栏有状态（运行/完成/未查看/中断）；启动时把上次没跑完的子会话标为中断而不是假装在跑。

- **依据**：
  - 阻塞事件冒泡（`delegation_blocked`）：`agent-collaboration-tools.ts:108-170`
  - 父→子映射与委派 tab 标签：`renderer/atoms/agent-atoms.ts:700-702, 735-741`
  - 未查看完成态的绿色标记：`agent-atoms.ts:1149-1230`
  - 折叠侧栏的子会话列表与弹出：`CollapsedSessionRail.tsx:33-50`；`CollapsedDelegatedSessionsPopover.tsx:49, 96-146`
  - 启动时把 running 标记为 interrupted（不可续）：`agent-session-manager.ts:1240-1256`；`main/index.ts:747-748`
  - 并发上限：`agent-collaboration-tools.ts:306-307`

- **接入点**：
  - `lib/subagent-extension.ts`（已有 `Agent`/`get_subagent_result`/`steer_subagent`）：把子会话的 `extension_ui_request` 转发到父会话 SSE 流
  - `lib/agent-event-stream.ts`：事件增加 `sourceSessionId` 字段（父会话据此区分自己 vs 子会话）
  - `components/AgentSessionPanel.tsx`：加状态点与"未查看"标记
  - 中断标记：`lib/session-liveness.ts` 已有 liveness registry，启动时把无 lease 的 running 子会话标中断

- **注意**：
  - 回答子会话的请求必须走**同一条审批/提问通道**（PROMA-01），不要另开一套。
  - 子会话默认应拒绝继承"总是允许"白名单（Proma 是反过来：worker 子 agent 自动放行）。**我的安全取舍应该是更严的一侧**：子会话不自动继承父会话的会话白名单。
  - 保留工具名红线（ADR-0003）：冒泡实现不得让子会话拿到 `Agent`/`get_subagent_result`/`steer_subagent`。

- **工作量**：M（~450 行 + 测试）
- **风险**：中。事件流改动要小心不要破坏既有 SSE 语义（`prompt_done` / `agent_settled` 的既有纪律）。
- **依赖**：PROMA-01

### PROMA-07 · AskUser 多问题表单卡

- **目标**：扩展对话框的 `select` 升级成完整表单：多题 tab、单选/多选/自由文本、↑↓ 选择、Enter 下一题/确认、单选后自动前进、关闭即停 agent。

- **依据**：`AskUserBanner.tsx:46, 99-140, 80-98, 180-210, 246-274, 337-345, 375-377`（多题 tab / 键盘 / 草稿 / 提交 / 自动前进 / 底部提示）

- **接入点**：
  - `components/ChatWindow.tsx:1760-1990`（`ExtensionDialog`）：把 `select` 分支升级为 `questions[]` 形态（不破坏现有 `select` 的向后兼容）
  - `hooks/useAgentSession.ts:850-890`（`extension_ui_request` 处理）：支持多题 payload + 草稿状态
  - 新 `components/fork/AskUserCard.tsx`

- **注意**：向后兼容优先——现有 `select` 是 pi 扩展的通用接口，不能改语义；多题是**新增** payload 形状。
- **工作量**：S–M（~300 行 + 测试 + i18n ~10 key）
- **风险**：低。

### PROMA-08 · 任务进度卡 + 覆盖层

- **目标**：会话内 todo/任务类工具调用聚合成一张实时进度卡；底部可以有悬浮层显示进度（含压缩进度）；完成后短暂保留然后淡出；可关闭。

- **依据**：
  - 聚合：`components/agent/task-progress.ts:108`
  - 卡：`TaskProgressCard.tsx:116`
  - 覆盖层 + 保留时长 + 按签名关闭：`TaskProgressOverlay.tsx:11-12, 44-49, 91`
  - 压缩进度与抑制规则：`AgentMessages.tsx:124-206, 1037-1048`

- **接入点**：
  - `lib/todo-state.ts` 已有状态机 → 新 `lib/task-progress.ts`（聚合模型，纯函数）+ `.test.mjs`
  - 新 `components/fork/TaskProgressCard.tsx` + `TaskProgressOverlay.tsx`
  - `components/ChatWindow.tsx` 挂载覆盖层；`components/fork/TodoChip.tsx` 复用同一数据源

- **注意**：别做成"又一个 todo 面板"——它和 `TodoChip` 是同一份状态的两个视图；覆盖层只在运行中且有待办时出现。
- **工作量**：S–M（~280 行 + 测试 + i18n ~8 key）
- **风险**：低。

---

## 4. P3 — 右栏与文件（5 个 PR）

> 这一阶段对我风险最低、感知最直接：全是可独立验证的前端 + 只读/落盘逻辑。

### PROMA-09 · 改动面板（只读半边）

- **目标**：一个专门的"改动"surface：按仓库 + 目录树分组、改动搜索、逐文件撤销、非 git 改动按"本轮/更早"分组、来源徽标、未查看小圆点。

- **依据**：
  - 分组与统计：`DiffChangesList.tsx:99-120, 183-207, 236-264`
  - 改动搜索：`:274, 292-318`
  - 逐文件撤销（untracked 不给）：`:213-224, 449, 750-759`
  - 非 git 改动按轮次：`:524-596`
  - 来源徽标：`diff-change-sources.ts:6-21`
  - 未查看点与刷新信号：`useGlobalAgentListeners.ts:1522, 1562, 2056`；`DiffPanelTabBar.tsx:95-98, 358`
  - 空 diff 自动关闭：`DiffTabContent.tsx:987-997`

- **接入点**：
  - `/api/git/status`（已有）+ `/api/git/diff`（已有）→ 新增 `POST /api/git/revert`（单文件 checkout）
  - `lib/turn-written-files.ts`（已有：本轮写过的文件）→ 新 `lib/change-groups.ts`（分组 + 来源判定，纯函数）+ `.test.mjs`
  - 新 `components/fork/ChangesPanel.tsx`，挂到 `AppShell` 的右栏 tab 类型（`components/file-tab-state.ts` 附近扩展）
  - 复用 `FileViewer.tsx` 的 diff 渲染（已有上下文折叠实现）

- **注意**：
  - 撤销是**破坏性操作**：必须二次确认，且必须过 `lib/path-security.ts` 的 allow-list。
  - untracked 文件不给撤销（对齐 Proma）——因为没有"原版本"可回。
  - 不做 stage/unstage/commit/PR（那是 MU-16 的后半，本 PR 只做只读 + 撤销）。
  - 非 git 改动的"本轮"边界用 `lib/turn-written-files.ts` 已有语义，别新造一套。

- **工作量**：M–L（~600 行 + 测试 + i18n ~20 key）
- **风险**：中（撤销是写操作）。缓解：撤销走单一 route，白名单 + 确认 + 测试。
- **关系**：MU-16（`musepi-borrowing-plan-2026-09-17.md:543`）的只读半边。建议本 PR 先做，MU-16 的 stage/commit 后置。

### PROMA-10 · 文件写操作

- **目标**：文件树支持原位重命名、删除（批量 + 确认）、移动到…、Cmd/Ctrl 多选、以及"会话文件移入项目"。

- **依据**：
  - 重命名 + 同名检查 + Enter/Esc/blur 语义 + 只选中文件名：`FileBrowser.tsx:329-351, 770-790, 814-830`
  - 批量删除确认（目录提示"包含所有子文件"）：`:354-377, 516-546`
  - 移动到…：`:380-400`
  - 会话文件提升为项目文件（含 tooltip 解释可见范围）：`:403-418, 1046-1070`
  - 多选：`:279-298, 831`

- **接入点**：
  - `/api/files/[...path]` 已有 `PATCH`（改名）、`POST`（上传）→ 补齐 `DELETE`（可选 recursive）与 `MOVE`
  - `components/FileExplorer.tsx`：行内重命名状态机、多选集合、右键菜单项
  - `components/fork/PathActions.tsx`（已有）：把新动作并入同一菜单

- **注意**：
  - 删除目录要区分"空目录失败"与"非空需确认"，并且**必须**过 allow-list。
  - 重命名要防"覆盖同名"（Proma 是先查兄弟名再改）。
  - 移动要有"目标在源之下"的自环检查（把目录移进自己的子目录）。
- **工作量**：M（~500 行 + 测试 + i18n ~18 key）
- **风险**：中。破坏性操作，全部要有确认 + 测试。

### PROMA-11 · Office 预览补齐（XLSX / PPTX）

- **目标**：XLSX 渲染成表格（含 sheet 切换、行号列标、上限截断提示）；PPTX 列出幻灯片标题与要点；旧版 `.xls/.ppt/.doc` 明确提示用默认应用打开。

- **依据**：
  - XLSX 内建解析（adm-zip + XML，8 sheet / 200 行 / 40 列上限 + 截断提示）：`file-preview-service.ts:257-450`
  - PPTX 解析（80 张上限）：`:452-520`
  - 旧版 Office 明确不支持 + toast 指引：`DiffTabContent.tsx:87, 1013-1015`
  - 文本/二进制判定与 5MB 上限：`file-preview-service.ts:540-586`

- **接入点**：
  - `lib/file-types.ts`：加 `XLSX_PREVIEW_MAX_BYTES` / `PPTX_PREVIEW_MAX_BYTES` 与扩展名映射
  - 新 `lib/office-preview/xlsx.ts` + `pptx.ts`（纯解析，输入 Buffer 输出结构）+ `.test.mjs`
  - 新 `app/api/files/[...path]/office/route.ts`（或复用现有 GET 加 `?preview=xlsx`）
  - 新 `components/OfficeSheetPreview.tsx` / `OfficeSlidesPreview.tsx`；`FileViewer.tsx` 接类型分派
  - 依赖：`adm-zip`（若未装，评估是否用 `node:zlib` + 手写 unzip 以避免新依赖——**优先后者**）

- **注意**：
  - **优先不加依赖**：zip 是 zlib + 简单目录解析，Proma 用 adm-zip 是因为它已有。先评估 `node:zlib.inflateRawSync` 手写 200 行是否够（够就别加包）。
  - 解析必须限额（行/列/sheet/幻灯片/字节），否则大表会卡死服务端。
  - 公式不要求计算，显示 raw 值即可；共享字符串表（`sharedStrings.xml`）必须支持，否则表格全是数字索引。
- **工作量**：M–L（~700 行 + 测试 + i18n ~12 key）
- **风险**：中（解析脏数据）。缓解：全部限额 + 失败降级到"不可预览卡片"。

### PROMA-12 · Markdown 编辑器三件套

- **目标**：① 编辑器内查找栏（大小写/全词/正则 + 命中计数 + Enter 导航）② 目录 + scroll-spy ③ 表格真网格编辑（单元格导航 + 右键增删行列 + 写回 markdown）。

- **依据**：
  - 查找栏：`PreviewFindBar.tsx:33-35, 196-201, 356-370, 425-450`；编辑器侧高亮 StateField `LiveMarkdownEditor.tsx:30, 44-64, 118-139`
  - 目录 + scroll-spy + 末尾补白：`MarkdownToc.tsx:29-110`；`LiveMarkdownEditor.tsx:167-206`
  - 表格网格：`LiveMarkdownTableEditor.tsx:1-80`；`lib/live-markdown-table.ts`、`lib/live-markdown-table-inline.ts`
  - frontmatter Properties（可选）：`LiveMarkdownPreview.tsx:347-470, 622-626`

- **接入点**：
  - `components/MarkdownFileEditor.tsx`（ProseMirror 已有 schema）→ 查找栏可直接用 `@tiptap`/ProseMirror 的 decoration（若我的实现是 ProseMirror，用 `Plugin` + `DecorationSet` 比 Proma 的 CodeMirror StateField 更自然）
  - 新 `components/fork/MarkdownFindBar.tsx` + `MarkdownToc.tsx`
  - 表格：`lib/markdown-editor.ts`（schema 里若已有 table node，则只需 UI 层）
  - 也可用于 `MarkdownFilePreview.tsx`（只读态 DOM 高亮）

- **注意**：
  - 查找栏要能同时服务"编辑器态"与"只读预览态"（Proma 是两套路径：编辑器用 StateField，预览用 DOM 高亮 + shadow DOM 感知）。若只做一套，优先编辑器态。
  - 目录跳转要处理"最后一个标题无法滚到顶部"的补白问题（Proma 的解决办法值得照搬）。
  - 表格写回不要全量重排 markdown（会毁掉用户的列宽/对齐格式）；只改受影响的行。
- **工作量**：M–L（~650 行 + 测试 + i18n ~15 key）
- **风险**：中。编辑器是已有复杂模块，改动要带回归测试（`docs/specs/markdown-editor-check.md` 是现成的手测清单）。

### PROMA-13 · 会话内消息搜索

- **目标**：当前会话里搜消息：输入即搜、命中片段高亮、上下条跳转、2 字符下限、结果数上限。

- **依据**：`session-message-search.ts:26, 37-78`（预计算归一化文本、打分片段、2 字符下限、50 条上限）；性能意图见 `AgentMessages.tsx:1110-1122`（流式 token 不重扫全历史）

- **接入点**：
  - 新 `lib/message-search.ts`（纯函数：建索引 + 查询 + 片段打分）+ `.test.mjs`
  - `components/ChatWindow.tsx`：加查找入口（Ctrl/Cmd+F）
  - 复用 `components/ChatMinimap.tsx` 的跳转能力做结果导航

- **注意**：索引只在消息**结构**变化时重建（流式过程中不要每 token 重建）——这是这个功能唯一的性能坑。
- **工作量**：S–M（~250 行 + 测试 + i18n ~8 key）
- **风险**：低。

---

## 5. P4 — 平台能力（6 个 PR）

### PROMA-14 · 定时任务生命周期语义

- **目标**：在现有 cron 之上补**运行生命周期**（不重做已有的时间窗 / 历史 / 重入保护）：① 子会话复用策略（同日复用 / 跨日新建 / 上下文 ≥70% 换新）+ 用户手发消息即"毕业" ② 连续失败 N 次自动暂停 ③ `maxRuns` 达上限自动停用并标完成 ④ 单次运行超时上限（Proma 是 2h；我现在没任何上限） ⑤ 完成通知（always / success / error 三选一）。

- **我已有的（不要重做）**：完整 5 字段 cron + 时区（`lib/cron-schedule.ts:17`）、`idleWindow` 时间窗（`:20-24, 38-39`）、运行历史 20 条 + `lastSessionId`（`:302-310`）、重入跳过（`lib/cron-runner.ts:35, 49-51`）、missed 跳过 + 标记（`lib/cron-runner.ts:103-105`）、`runCount` / `lastStatus` / `lastError`。

- **依据（Proma）**：
  - 子会话复用策略与"毕业"：`automation-scheduler.ts:40-50, 134-166`；`agent-service.ts:281-293`；`shared/types/automation.ts:107-119`
  - 连续失败 5 次自动暂停：`automation-manager.ts:307-352`
  - `maxRuns` / `once` 自动完成 + 重新启用清零：`automation-manager.ts:539-546, 598-616`；UI 区分"已完成/已暂停"：`AutomationsListView.tsx:100-103`
  - 完成通知按 trigger 三选一 + 截断 12000 字：`automation-notification-service.ts:30-47`；`automation-notification-format.ts:20-27, 42-76`

- **接入点**：
  - `lib/cron-schedule.ts` 的 `CronTask`：加 `maxRuns?` / `completedAt?` / `consecutiveFailures?` / `pausedReason?` / `sessionMode?: "daily" | "reuse"` / `reusedSessionId?` / `graduated?`
  - `lib/cron-runner.ts`：复用会话（取代 `startRpcSession(\`__cron__${randomUUID()}\`)`，`lib/cron-runner.ts:68`）、失败计数与自动暂停、达 `maxRuns` 停用、运行超时上限
  - 毕业机制：在 `hooks/useAgentSession.ts` / `lib/rpc-manager.ts` 的发送路径里识别"这是一次自动任务的会话，且消息来自用户" → 写 `graduated`
  - 通知：复用 `lib/web-push.ts` + `lib/browser-notifications.ts`（已有）
  - `components/fork/CronConfig.tsx`：状态徽标（已完成/已暂停）、复用策略选择、通知触发条件

- **注意**：
  - **会话复用是这一批里唯一有真实难点的**：复用意味着同一会话被多次注入，上下文会持续增长；Proma 的"上下文 ≥70% 换新"是必需的配角，不能只做复用不做换新。
  - 复用会改变现有行为（每个任务一个会话 → 每任务一条时间线），UI 上要让用户看得见“这是第 N 次运行”。
  - 数据迁移：`cron-store.ts` 的 JSON 要能读旧条目（新字段全可选）。
  - 通知默认关，不要默认开（避免用户莫名收到推送）。

- **工作量**：M–L（~550 行 + 测试 + i18n ~20 key）
- **风险**：中（定时器 + 复用会话的上下文增长 + 持久化迁移）。

### PROMA-15 · 终端 Agent 工具（6 个）

- **目标**：把已有的终端暴露给 agent：`TerminalOpen` / `TerminalExecute` / `TerminalRead` / `TerminalList` / `TerminalInterrupt` / `TerminalClose`。输出分页、剥控制序列、cwd 必须在授权根内、无人值守运行禁用。

- **依据**：
  - 工具集与语义：`pi-builtin-tools.ts:1378-1535`
  - 输出归一化 + 分页（默认 12k / 最大 48k）+ 剥控制序列：`terminal-output-buffer.ts:40-105, 110-125`
  - cwd 授权（必须在会话授权根内，realpath 解析）：`terminal-agent-policy.ts:6-31`；`terminal-service.ts:151`
  - 无人值守禁用：`pi-builtin-tools.ts:1379-1380`
  - 优先复用已列出的终端：`:1378-1535`（工具描述约定）

- **接入点**：
  - `lib/terminal-manager.ts`（已有 PTY registry + 128KB ring + lease）→ 加 `read(offset, limit)` 归一化读接口
  - 新 `lib/terminal-tools-extension.ts`：注册 6 个工具（走 ADR-0003 的 inline extension 模式）
  - 复用 `lib/path-security.ts` 做 cwd 校验；复用 `lib/tool-names.ts` 命名

- **注意**：
  - **输出绝不能自动进 tool result**：必须显式 `TerminalRead`（Proma 明确如此），否则交互式程序的输出会污染上下文。
  - 剥控制序列要保留可读的颜色语义（至少不要让 `ls` 输出变成乱码）。
  - cwd 校验走 `isPathWithinRoots()` 单一实现，别另写。
  - 子代理/无人值守场景（cron、subagent）必须禁用终端工具——这是安全底线。
- **工作量**：M（~450 行 + 测试 + i18n ~14 key）
- **风险**：中（给 agent 执行能力）。缓解：只复用**用户已经打开的**终端，不新开；cwd 白名单；无人值守禁用。

### PROMA-16 · 提醒条 + 统一规划页（退化版）

- **目标**：把 todo 与定时任务收进一个统一入口；到点的提醒在 UI 常驻一条（可 acknowledge / complete / snooze / 打开）；Web 端用浏览器 Notification 替代系统通知。

- **依据**：
  - 提醒调度 + 系统通知（silent）+ 点击聚焦：`planning-reminder-scheduler.ts:1-6, 16, 25-60`
  - 常驻 rail + 四动作 + 合并且去重排序：`PlanningReminderRail.tsx:18-22, 42-62, 64-90`
  - 三 tab 统一页（Todo / 日程 / 定时任务）：`PlanningView.tsx:35-44, 87-167`
  - 空态文案引导"可用对话创建"：`AutomationsListView.tsx:307`
  - 布局响应式（≥840 三列 / ≥600 两列 / 否则单列）：`todo-layout.ts:1-10`

- **接入点**：
  - `lib/todo-state.ts`（已有）→ 加 `dueAt` / `remindAt` / `snoozeUntil` / `priority` / `notes`
  - 新 `lib/reminder-scheduler.ts`（浏览器端定时器 + Notification API；页面关闭则降级为"下次打开时补提醒"）+ `.test.mjs`
  - 新 `components/fork/ReminderRail.tsx`；`SettingsPanel` 的 cron/memory 段旁边加"规划"段
  - 复用 `lib/web-push.ts`（已有 Web Push）——页面关闭时也能提醒，这比 Proma 的系统通知更适合 Web

- **注意**：
  - **不做日历**（无 EventKit，日程会是半成品）。这一条只做 Todo + 定时任务的统一入口 + 提醒。
  - 浏览器 Notification 需要权限，且页面关闭后只能靠 Web Push 或下次打开补——这是 Web 形态的固有边界，UI 上要写清。
- **工作量**：M–L（~600 行 + 测试 + i18n ~22 key）
- **风险**：中（定时器 + 通知权限 + 跨重启）。

### PROMA-17 · 存储管理 + 自动归档

- **目标**：设置里显示磁盘用量（会话文件、上传文件、附件、记忆、日志），支持按天数清理已归档会话消息与临时文件；会话自动归档（0/7/14/30/60 天）。

- **依据**：
  - 用量统计 + 启动清临时文件 + 按天数清理已归档会话与 SDK 数据：`StorageSettings.tsx:147-224`
  - 自动归档（pinned 豁免）：`agent-session-manager.ts:1210-1238`
  - 归档天数选项 0/7/14/30/60：`GeneralSettings.tsx:192-430`

- **接入点**：
  - 新 `lib/storage-usage.ts`（扫描 `~/.pi/agent/` 各子目录算大小，纯函数可测）+ `.test.mjs`
  - 新 API `app/api/storage/usage`（GET）+ `app/api/storage/cleanup`（POST）
  - `lib/session-flags.ts`（已有 pin/archive）→ 加自动归档判定（在列表扫描时按 mtime 推导，**不要**写回 localStorage 制造大批量写入）
  - `components/SettingsPanel.tsx`：加"存储"段

- **注意**：
  - 清理是**破坏性**的：默认只清"已归档且超过 N 天"的会话，且要能预览"将删除什么"。共享 `~/.pi/agent/sessions/` 是 pi CLI 的数据，删除会影响 CLI —— 必须在 UI 上明说，并默认不动。
  - 自动归档只改**显示分组**，不移动/删除文件。
- **工作量**：M（~450 行 + 测试 + i18n ~18 key）
- **风险**：中高（删数据）。缓解：默认只做统计不做清理；清理要二次确认 + 白名单 + 只碰 `~/.pi/agent/` 下的已知子目录。

### PROMA-18 · 快捷键系统（总表 + 录制 + 冲突）

- **目标**：设置里有一张快捷键总表，可按分组查看；点击进入录制态重新绑定；冲突即时提示；可单条禁用；可恢复默认；严格修饰键匹配（防 `Cmd+K` 被 `Cmd+Shift+K` 误触）。

- **依据**：
  - 默认表（20 条 / 4 组 / mac+win 双默认 / 只读项）：`shortcut-defaults.ts:10-45, 56-247`
  - 中央分发（capture 阶段单 listener + Map + exclusive + 禁用项不进缓存 + 严格修饰键）：`shortcut-registry.ts:1-6, 110-126, 201-348`
  - 录制 UI（F1–F24 可单用、修饰键提示、冲突提示、平台化显示）：`ShortcutSettings.tsx:44-140, 251-263`
  - 冲突检测跳过已禁用项：`shortcut-registry.ts:300+`

- **接入点**：
  - `hooks/useKeyboardShortcuts.ts`（已有固定集合）→ 抽成注册表 + 默认表 + 用户覆盖
  - 新 `lib/shortcut-defaults.ts` + `lib/shortcut-registry.ts` + `.test.mjs`（严格匹配与冲突检测是纯函数，好测）
  - 新 `components/fork/ShortcutsConfig.tsx`；`lib/settings-navigation.ts` 加段
  - 用户覆盖存 localStorage（UI 偏好，不进 pi 配置）

- **注意**：
  - **不做主进程 `globalShortcut`**（那是 Electron 专属，且 Web 端无意义）。只做应用内快捷键。
  - 严格修饰键匹配是**必须的**（本仓库已有一处相关工作），否则用户一旦绑了组合键就会误触。
  - 只读项（菜单角色类）不可改，对齐 Proma。
- **工作量**：M（~500 行 + 测试 + i18n ~25 key）
- **风险**：低-中。风险在"改分发器会动到所有既有快捷键"，要带回归测试。
- **关系**：MU-05（`musepi-borrowing-plan-2026-09-17.md:532`）只做命令面板；本 PR 只做快捷键表，二者不重叠。

### PROMA-19 · 自动更新完整版

- **目标**：Electron 壳接入 `electron-updater`：启动后 10s 首查、之后每 4h；下载进度推送；**空闲安装**（等所有 agent 跑完再退出安装）；安装包缓存清理；更新日志来自 GitHub Release。

- **依据**：
  - 自控下载时机（`autoDownload=false` / `autoInstallOnAppQuit=false`）：`updater/auto-updater.ts:1-6, 283-284`
  - 检查节奏与"下载中跳过检查"、"已下载仍追赶更高版本"：`:91-140, 368-384`
  - 状态推送（checking/available/downloading/downloaded/not-available/error）+ 进度字段：`:20-44, 288-366`
  - 空闲安装（等所有 agent 结束，可取消，安装前二次检查防竞态）：`:45-57, 144-197`；`updater/idle-install-scheduler.ts`
  - 缓存清理生命周期（新版窗口稳定 15s 后才清、下载中禁清、失败重试 2 次、崩溃延后保留）：`:30-33, 219-280`；`updater/update-cache-cleanup.ts:39-80`
  - 版本比较（完整 SemVer + 预发布）：`updater/version.ts:1-10`
  - 更新日志（GitHub Release，30 分钟缓存，403/429 冷却 15 分钟，中文错误）：`github-release-service.ts:1-30, 25-76, 81-120`

- **接入点**：
  - `electron/main.js`（单文件，~260 行）→ 抽出 `electron/updater.js`
  - `app/api/app-update/route.ts`（已有版本检查）→ 保留为 Web 端路径；Electron 端走主进程事件 + preload 桥
  - 新 `components/fork/UpdateDialog.tsx`（状态机 + 进度 + 空闲安装开关）
  - 复用 `/api/app-update` 的 release URL 解析

- **注意**：
  - **mac target 现在只有 `dir`**（`package.json:158`），`dir` 产物装不了更新。要走更新必须先改成可发布的 target（dmg/zip）并接受签名/Gatekeeper 提示。这是本 PR 的前置条件，**先决策再开工**（见 §9 的 D2）。
  - 空闲安装的"所有 agent 结束"判定要看到后台任务（subagent、cron 运行中的任务），不能只看前台。
  - 缓存清理只在打包生产环境启用（对齐 Proma）。
- **工作量**：M–L（~550 行 + 测试）
- **风险**：中高（打包链路 + 签名）。
- **关系**：**并入** omp-web 计划的 PR-13（更新对话框）+ PR-14（一键自更新），见 `omp-web-pr-plan-2026-09-17.md`。

---

## 6. P5 — 评估型（3 个，先 spike 不合并）

### PROMA-20 · 内嵌浏览器 CDP 化 + Agent 浏览器工具（spike）

- **目标**：确认能否把现有 iframe 面板升级为 Electron `WebContentsView` + CDP，并给 agent 一组浏览器工具（先做 5 个：`Observe` / `Navigate` / `Click` / `Fill` / `Extract`）。

- **依据**：
  - CDP 控制器 16 种操作 + ref 失效语义：`browser-controller.ts:217, 723, 1322-1784`；失效提示 `:1425-1428`
  - 观察预算（默认 240 元素，min 20 / max 400，交互角色优先 2/3 预算）：`browser-observation-policy.ts:1-57`；`browser-cdp.ts:1-13`
  - 操作上限（JS 20k 字符 / selector 1k / text 10k / extract 50k / scroll 50k）：`browser-script-policy.ts:1-11`
  - 按键语义（Windows 虚拟键码 + `Input.insertText`）：`browser-key-policy.ts:1-49`
  - URL 规范化（裸域 → HTTPS，localhost/局域网 → HTTP，否则 Google 搜索）：`browser-policy.ts:1-58`
  - profile 隔离（按工作区 hash 分区 + UA 附加版本）：`browser-profile-policy.ts:6-15`；`browser-identity.ts:4-11`
  - 风险告知门（版本化确认）：`browser-risk-disclaimer.ts:6-10`
  - 本地 HTML 预览用 token 化协议：`browser-preview-service.ts:20-50`
  - 24 个 agent 工具：`pi-builtin-tools.ts:946-1290`

- **spike 要回答的问题**：
  1. `WebContentsView` 在现有 Electron 单窗架构（内嵌 next start）里能否正确贴到右栏区域（原生栈顶 vs DOM 布局的层级问题）？
  2. 用户能同时看到一个可见 tab 与 agent 的工作 tab 吗？抢占/仲裁怎么定（Proma 用 `browser-presentation-policy.ts`）？
  3. URL 白名单/黑名单策略（我不能让 agent 随便访问内网）？
  4. Web 部署形态（非 Electron）下这个功能如何降级——还是干脆只在桌面端可用？

- **结论预期**：**很可能只在桌面端可用**，Web 端保留 iframe 面板。如果 spike 显示改造面 > 800 行或需要重排右栏布局，则**不做**。
- **风险**：高（原生视图 + 布局 + 安全 + 双形态）。
- **工作量**：spike S（~1 天，产出结论文档，不合并代码）；若做，L–XL。

### PROMA-21 · 会话工作台文件模型（评估）

- **目标**：评估是否给每个会话一个私有工作目录（放 plan / 交接 / 临时参考），并把"项目级跨会话资料"与"会话私有资料"分开。

- **依据**：
  - 工作区目录布局与会话工作台：`config-paths.ts:297-410, 719-727`；`agent-prompt-builder.ts:56-77`
  - 会话 workbench 布局（新会话放根，历史会话兼容 `.context/`）：`agent-session-manager.ts:344-359`
  - 文件归属规则（本地项目 → 用户目录；空白项目 → 托管 workspace-files；会话私有 → 会话工作台；项目级 → `.context/`）：`agent-prompt-builder.ts:139-146, 156-163`
  - 附加目录（父目录自动授权 + 启动清理失效路径）：`agent-workspace-manager.ts:2100-2125`

- **spike 要回答的问题**：
  1. 现有 `chat-workspace`（patch 0001）已经给了"不在项目中的对话"一个目录，是否只需给它加**会话级子目录**？如果是，这个 PR 从 L 降到 S。
  2. 会话私有文件的清理策略（会话删了目录要不要删？用户数据丢失风险）。
  3. 与 `~/.pi/agent/sessions/` 的关系：pi CLI 不认识这个目录，会不会让 CLI 会话看不懂项目的文件引用？
- **结论预期**：可能退化成"chat-workspace 加会话子目录"，或干脆不做（现状够用）。
- **风险**：中（数据模型 + 清理语义）。

### PROMA-22 · 快速任务浮窗（退化版，评估）

- **目标**：全局快捷键唤起一个轻量输入窗（不打开主窗），输入后创建会话。

- **依据**：`quick-task-window.ts:1-8, 26-45, 82-118`；`QuickTaskApp.tsx:1-8, 109-140, 144-202, 291-300`（失焦自动隐藏、`⌘1/⌘2` 切模式、>100MB 文件作路径引用）

- **退化方案（Web 优先）**：主窗内一个浮层（不新建窗口），快捷键唤起；Electron 端可选加第二个 BrowserWindow。
- **spike 要回答的问题**：不做独立窗口的话，这个功能和"新建会话首页 + 全局快捷键"的差别是否还值得做？如果只是"唤起输入框"，那 PROMA-18 的快捷键 + 现有输入框已经覆盖。
- **结论预期**：很可能**不做**（退化后价值不足）。
- **风险**：低。

---

## 7. 明确不做（与对比文档 §9 一致）

| 不做 | 理由 |
| --- | --- |
| 自研 provider 适配器层 | 破坏"pi CLI 与 Web 共用同一份真相"的核心约定 |
| 自研 agent orchestrator | 同上；且搬它等于重写 `lib/rpc-manager.ts` |
| 自管会话存储 | 会失去 pi CLI / 导出 / 分支导航的全部既有能力 |
| macOS EventKit 同步、Agent Island | 原生绑定，Web 形态无法承载 |
| IM 渠道（微信/飞书/钉钉/Slack） | 另一条产品线；远程访问走 Web + 密码 + PWA |
| Vision Relay、语音听写 | 需要第二条链路 / 第三方付费服务；价值密度低 |
| 多窗口（独立预览 / 记忆窗 / 听写窗） | Web 形态无多窗口 |
| 右栏双 pane 分屏 | 与已规划的 UI-06（底部面板）/ MU-12（右栏瘦身）方向相反 |
| 标签 MRU 切换器 / 悬浮预览 / 撕离分屏 | 需要多窗口或多 pane 前提；单独做收益低 |
| 日历 / 日程 | 没有 EventKit 会是半成品 |
| Obsidian / Vault 深度集成 | 体量相当于独立产品，应单独立项 |
| Bun monorepo / 运行时 | 无收益 |
| 独立预览窗口 / 独立记忆窗口 | 同"多窗口" |
| 自管 `~/.proma` 式配置根 | 造出 CLI 不认的平行配置 |

---

## 8. 依赖图与推荐节奏

```
P1 (必须最先，它是 P2 的前置)
  PROMA-01 审批卡+引擎 ──┬──► PROMA-02 权限模式
                        └──► PROMA-03 计划模式 ──► (需要 02)
  PROMA-04 会话回退  (独立)

P2 (PROMA-06 依赖 01)
  PROMA-05 探索分支+带回   (复用 fork，独立)
  PROMA-06 子会话阻塞冒泡  (依赖 01)
  PROMA-07 AskUser 表单    (独立)
  PROMA-08 任务进度卡      (独立)

P3 (全独立，可与 P2 并行)
  PROMA-09 改动面板 ──► PROMA-10 文件写操作 (相邻文件，建议同批次)
  PROMA-11 Office 预览补齐 (独立)
  PROMA-12 Markdown 三件套 (独立)
  PROMA-13 会话内搜索      (独立)

P4 (全独立，可任意插队)
  PROMA-14 定时任务增强
  PROMA-15 终端 Agent 工具
  PROMA-16 提醒条 + 规划页
  PROMA-17 存储管理 + 自动归档
  PROMA-18 快捷键系统
  PROMA-19 自动更新（并入 omp PR-13/14）

P5 (spike 不合并，结论出来再决定)
  PROMA-20 浏览器 CDP（预期：只桌面端）
  PROMA-21 会话工作台文件（预期：退化或不做）
  PROMA-22 快速任务浮窗（预期：不做）
```

**批次建议**：

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 批 1 | PROMA-01 → 02 → 03 | 一个连续叙事：有了刹车、才有档位、才有计划模式。中途不要插其他 PR |
| 批 2 | PROMA-04 + PROMA-05 | 都是"会话文件操作"，共用 wrapper destroy 纪律 |
| 批 3 | PROMA-07 + 08 + 13 | 三个小 PR 一起清掉聊天面细节 |
| 批 4 | PROMA-09 + 10 + 11 + 12 | 右栏/文件一整批，全部可独立验证 |
| 批 5 | PROMA-14..19 | 平台能力，按实际痛点排序 |
| 批 6 | PROMA-06 | 依赖审批通道，放最后做风险最低 |
| 批 7 | PROMA-20..22 spike | 只在有余力时做 |

---

## 9. 三个待决策（开工前必须定）

| # | 决策 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | **权限默认档** | (a) 默认全自动（对齐 Proma）(b) 默认"危险工具需确认"(c) 首次进入时让用户选 | **(a)**。默认拦截会让所有现有用户以为工具坏了；把选择权放在 PROMA-02 的切换器 + 首次提示里 |
| D2 | **mac 打包 target** | (a) 保持 `dir`（PROMA-19 无法落地）(b) 改成 dmg/zip + ad-hoc 签名（能做更新但会有 Gatekeeper 提示） | **(b)**，但这是独立决策；若不做，PROMA-19 降级为"只做更新日志展示 + 复制安装命令"（即 omp PR-13 的范围） |
| D3 | **PROMA-20 的形态边界** | (a) 只做桌面端 (b) 桌面端 + Web 端 iframe 保留（两套代码）(c) 不做 | **(a)**。Web 端不引入第二套浏览器实现；iframe 面板保持现状 |

---

## 10. 与既有计划的合并执行

| 既有编号 | 处理 |
| --- | --- |
| MU-31 审批卡 | **并入 PROMA-01**（MU-31 是子集） |
| MU-04 划词工具条 | PROMA-05 里包含"探索此分支"动作；划词的其余部分仍归 MU-04 |
| MU-16 Git 面板 | PROMA-09 先做只读半边（改动/撤销）；MU-16 的 stage/commit/PR 后置 |
| omp PR-13 更新对话框 | **并入 PROMA-19** |
| omp PR-14 一键自更新 | **并入 PROMA-19**（受 D2 影响） |
| MU-05 命令面板 | PROMA-18 只做快捷键表，命令面板仍归 MU-05 |
| MU-12 右栏分组/溢出 | 与本计划不冲突（本计划不做右栏双 pane） |
| UI-06 底部面板 | 与本计划不冲突（本计划不动右栏布局） |

---

## 附：本计划自身对应的 PR

本文与 [`proma-comparison-2026-09-18.md`](./proma-comparison-2026-09-18.md) 作为一个纯文档 PR 提交，不包含任何代码改动。

分支：`docs/proma-comparison`
包含：两个新文件（本文件 + 对比文档）

### 本 PR 顺带修正的仓库内错误结论

对比文档 **§3.2.1** 推翻了 `docs/codex-skin/delta.md:1199-1205` 对 MU-31 的「不做（等引擎）」结论：那份核实只找了**声明式设置**（像 MusePi 的 `tools.approvalMode`），漏了 pi 提供的是**命令式钩子**——`pi.on("tool_call")` + `await ctx.ui.confirm()` + `return { block: true }`，pi 官方文档本身就是把它当 permission gate 的示例给出的（`docs/extensions.md:19, 70-74, 585, 778-793`）。

结论：**PROMA-01 不被上游阻塞，可以立即开工**；原判断低估了工作量（MU-31 描述的"升级可见卡片"其实只是这个功能的一小半）。

> 本次只改文档，**没有**直接改 `delta.md`——那份台账有自己的编号与更新纪律，替它做决定不合适。建议在 PROMA-01 落地时一并更新 §27 的结论。

> 后续每个 PROMA-xx 按 §0 的拆分原则单独开分支与 PR，并在 `docs/patches/` 台账里按需登记（涉及上游文件的改动用 `fork:` 标记）。
