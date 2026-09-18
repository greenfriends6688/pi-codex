# Proma-main ⇄ pi-web-0.9.0 全量功能对比矩阵

日期：2026-09-18
基准：**A** = `/Users/yingjing/Desktop/pi-web-0.9.0`（`@agegr/pi-web` 0.9.1 fork，Next.js Web 优先 + Electron 壳跑 `next start`）
对照：**B** = `pi参考项目/Proma-main`（Proma 开源版，`apps/electron` 0.19.55，Electron + Vite 纯静态 + preload IPC）

方法：五路并行只读调研（会话消息 / 输入交互 / 文件预览终端浏览器 / 模型鉴权扩展平台 / 布局性能设计），全部要求 `file:line` 证据；主会话对高影响结论做了二次核验（标 ✅ 的已核）。
**凡标「无」的项，调研时都给了检索关键词**；“两边都无”单列在 §8.3，避免把缺口和差异混在一起。

配套文档：
- 六大问题根因与修法 → [`proma-optimization-2026-09-18.md`](./proma-optimization-2026-09-18.md)
- 设计审查（impeccable 实测 + 核验） → [`design-audit-impeccable-2026-09-18.md`](./design-audit-impeccable-2026-09-18.md)
- 既有可搬项 PR 计划 → [`proma-pr-plan-2026-09-18.md`](./proma-pr-plan-2026-09-18.md)（PROMA-01…30）
- **本轮 PR 拆分** → [`proma-prs-2026-09-18.md`](./proma-prs-2026-09-18.md)（FIX / DSN / GAP 三族）

---

## 0. 底座差异（决定哪些能搬）

| 维度 | A（pi-web 0.9.1） | B（Proma 0.19.55） |
| --- | --- | --- |
| 形态 | Web 优先；`next start -H 127.0.0.1 -p 30141`；Electron 只是壳（`electron/main.js` 485 行） | 桌面优先；Vite 产物 `loadFile`，无本地 HTTP 服务（`src/main/index.ts:516-517`） |
| 前后端通道 | HTTP `/api/*` 约 60 个 route；`electron/preload.js` 36 行（无业务 IPC） | `preload/index.ts` 3114 行全量 IPC + `ipc.ts` 373 处 `handle` + `proma-file://` token 协议 |
| Agent loop | pi SDK `AgentSession`（`lib/rpc-manager.ts`，`globalThis.__piSessions`） | 自研 orchestrator 2374 行 + 自研 provider 适配 + UtilityProcess 常驻 |
| 会话存储 | pi 原生 `.jsonl`（与 pi CLI 共用同一份真相） | 自管 `~/.proma/agent-sessions/*.jsonl` + 索引 + `piEntryBindings` **双写** |
| 状态/样式 | hooks + URL + localStorage；Next 16 + React 19 + Tailwind 4 | Jotai atoms 38 个；React 18 + Vite 6 + Tailwind 3 + Radix/shadcn |
| i18n | **有**：3 语言 1014 key（`lib/i18n/registry.ts:2-38`） | 无（全硬编码简体中文） |
| Web 部署 | **有**：密码/Basic 登录 + PWA + Web Push + Docker | 无（桌面 only） |
| 包管理 | npm | bun workspaces + patchedDependencies（`pi-ai@0.85.1`、`node-pty@1.1.0`） |
| 测试 | 217 个 `.test.mjs`（`node --test`）+ Playwright e2e | `bun test` BDD，覆盖在源文件旁 |

**两条硬约束**（后面所有“可搬性”判断都基于它们）：

1. A **不能**改成纯静态 `output:export`——`/api/agent/[id]` 需要 in-process `AgentSession`（`app/api/agent/[id]/route.ts:55 → startRpcSession`）。桌面化只能走“保留本地服务”的 A 路线。
2. A 与上游**没有 merge base**，新增能力一律放 fork-only 新文件；碰上游文件要打 `fork:<slug>` 并自报接触面（见 `docs/upstream-merge-policy.md`）。

---

## 1. 会话与消息域

### 1.1 列表 / 分组 / 搜索 / 整理

| 功能点 | A（pi-web） | B（Proma） | 差异实质 | 谁更强 | 可搬性 |
| --- | --- | --- | --- | --- | --- |
| 列表数据源 | 增量扫描 + 指纹缓存 `lib/session-list-scanner.ts:298`（原子落盘 `pi-web-session-index.json`） | 自建索引 JSON `agent-session-manager.ts:295`（`readIndex:230`/`writeIndex:277`） | 都做了索引缓存；A 增量、B 全量 | 持平 | — |
| 排序 | 按最后活跃时间倒序（`session-list-scanner.ts:360`，不用文件 mtime `:126-129`） | `sortAgentSessionsByUpdatedAtDesc`（`renderer/lib/agent-session-list.ts:22`） | 同 | 持平 | — |
| 项目分组 | 从 session cwd 推导（`lib/project-groups.ts:12`、`lib/project-tree.ts:78`） | **工作区是一等实体**，可重命名/删除/重新关联（`LeftSidebar.tsx:1968,1363`） | B 把“项目”当可管理对象 | B 更强 | 中 |
| worktree 分组 | **有**：worktree 归并到主仓库一个项目行（`lib/worktree.ts:85`）+ 切换器（`SessionSidebar.tsx:1415`）+ 增删（`worktree.ts:193,254`） | **无**侧栏 worktree 分组/切换器；只有 `meta.activeWorktree`（`shared/types/agent.ts:759`）供执行 cwd 用 | A 更强 | **A 独有** | — |
| 会话树 | 仅 subagent 嵌套（`lib/session-tree.ts:9`），fork 保持根 | 仅 delegated child 嵌套（`collapsed-agent-rail.ts:96`） | 同 | 持平 | — |
| 侧栏虚拟化 | 手写窗口化（固定行高 + overscan 8，`SessionSidebar.tsx:27,1290`） | `@tanstack/react-virtual` 可变行高（`virtual-sidebar-list.tsx:27`） | B 用成熟库 | B 略强 | 中 |
| 全库内容搜索 | 有（`lib/session-search.ts:26` + `/api/sessions/search` + `SessionSearch.tsx:9`）；**预算护栏** 500 文件/30 结果/16MB/3s，超限透出 `truncated`（`:5-9`） | 有（`agent-session-manager.ts:1306` + `SearchDialog.tsx:207`）；100 会话/每会话 2 条 | A 有预算与部分结果透出 | A 更强 | 中 |
| 搜索范围 | 全库（跨项目） | 受当前模式限制（`SearchDialog.tsx:288` `appMode`） | A 更全局 | A 略强 | — |
| 搜索命中跳转 | **有**：`onSelectSession(session, entryId, blockIndex)` → 自动翻页 + `data-search-target` 高亮那句话（`SessionSearch.tsx:57`、`ChatWindow.tsx:750-793`） | 只 `openSession(...)`（`SearchDialog.tsx:344`），会话内定位另由 Cmd+F 承担 | A 能“跳到那句话” | A 更强 | — |
| 会话内查找 Cmd+F | **无**（✅ 已核：`components/` 内无 find-bar，Cmd+F 走浏览器原生） | **有**：`scroll-minimap.tsx:417-470` + `useShortcut` 绑定，Chat/Agent 都接 | B 独有 | **B 独有** | 高 |
| 搜索标题命中 | 无（只扫 message 正文，`session-search.ts:64`） | 有（标题独立列出，`SearchDialog.tsx:293-306`） | B 有标题命中 | B 有 | 高 |
| AI 语义搜索 | 无 | 有（`SearchDialog.tsx:350`，新建 Agent 会话去翻历史） | B 独有（实为 prompt 转交） | B 独有 | 中 |
| pin 置顶 | localStorage（`lib/session-flags.ts:138`，展示态） | 写入会话索引，支持父子级联（`LeftSidebar.tsx:1086,2043`） | B 持久且可级联 | B 更强 | 中 |
| 归档 | 有（`session-flags.ts:143` + `ArchivedSessionsSection:2301`） | 有 + 归档后自动关标签 + 按需加载数量（`LeftSidebar.tsx:1103,729-746`） | B 更细 | B 略强 | 中 |
| 星标 | 无（A 用的是**状态标签**） | 有 `starred`（`shared/types/agent.ts:768`） | 设计不同：A 标状态、B 标重要 | 互补 | 低 |
| 状态标签点 | **A 独有**：`complete/interrupted/error/aborted/pending`（`session-flags.ts:31-41`、`SessionTagDot:2627`） | 无 | A 独有 | A 独有 | — |
| 重命名 | 有（PATCH `/api/sessions/[id]` `:137`，行内输入 `:2679`） | 有（`LeftSidebar.tsx:1072,2013`） | 同 | 持平 | — |
| 自动命名 | **仅手动按钮**（✅ 已核：`AppShell.tsx:1027-1054` 是唯一入口，无首条消息后自动触发） | **首条消息后自动**（`agent-orchestrator.ts:411`），且“用户改过就不覆盖” | B 更强 | B 更强 | 高 |
| 删除会话 | 有 + 级联删子代理会话（`/api/sessions/[id]` `:161,186-215`） | 有（`agent-session-manager.ts:628`） | A 级联更明确 | 持平（A 略强） | — |
| 会话移动到别的项目 | **无** | **有**（`MoveSessionDialog.tsx:35,66` → `moveSessionToWorkspace:736`，含目录搬迁 `:698`） | B 独有 | **B 独有** | 中 |
| 折叠态 rail / 工作区浮层 | 无 | 有（`CollapsedSessionRail.tsx`、`CollapsedWorkspacePopover.tsx`） | B 独有 | B 独有 | 中 |
| 侧栏悬浮预览 | 无（A 的 minimap 在聊天内） | 有（`SessionMiniMapPopover.tsx`，600ms hover，末 80 条） | B 独有 | B 独有 | 中 |
| 自动化会话分组 | 无 | 有（`LeftSidebar.tsx:480` + `ARCHIVED_AUTOMATION_GROUP_ID`） | B 独有 | B 独有 | 低 |
| 空会话不进列表 | 有（`session.transient`，`SessionSidebar.tsx:1621,2740`） | 有（`isDraft`，`shared/types/agent.ts:774`） | 同 | 持平 | — |

### 1.2 分支 / 回退

| 功能点 | A | B | 差异实质 | 谁更强 | 可搬性 |
| --- | --- | --- | --- | --- | --- |
| fork 新独立会话 | 有（`lib/rpc-manager.ts:732`；fork 后立即 `destroy()` 防 wrapper 污染） | 有（`agent-session-manager.ts:832`） | 同 | 持平 | — |
| 会话内多分支切换 | **有**：`navigate_tree`（`rpc-manager.ts:832`）+ `useAgentSession.ts:1607` | 无（B 一旦 rewind 就截断） | A 非破坏性 | **A 更强** | — |
| 分支导航器 / 可视化 | **有**（`BranchNavigator.tsx:27` + `:60` `compressChain`；服务端投影 `project-tree.ts:78`，深度上限 200 + `branchPreview`） | 无 | A 独有 | **A 独有** | — |
| 探索分支 + 结论带回主线 | 无（fork 不回流） | **有**：右栏 `exploration:<id>` tab + “带回结论”只复制 fork 点之后的 assistant 内容并插 `&session:` 引用（`AgentView.tsx:2531-2564`、`SidePanel.tsx:387-418`） | B 独有 | **B 独有** | 中 |
| rewind 回退 | 无（✅ `grep rewind` 仅命中注释） | **有**：严格 JSONL 解析 → branch artifact → 原子截断 → 元数据提交（失败回滚），运行中拒绝（`agent-orchestrator.ts:2333`、`agent-session-manager.ts:932,1118`） | B 独有 | **B 独有** | 中 |
| 回退同时恢复文件 | 两边都无（B 显式 `fileRewind.canRewind=false` 且有契约测试锁死） | 同 | 都无 | — | — |
| clone 会话 | **A 独有**（`rpc-manager.ts:804`） | 无 | A 独有 | A 独有 | — |
| 编辑历史消息 | 非破坏性：`navigate_tree` 后回填输入框，不删历史（`MessageView.tsx:543-566`、`ChatWindow.tsx:335`） | 破坏性 rewind 或 fork 复制 | A 更安全 | A 更强 | — |

### 1.3 消息渲染与操作

| 功能点 | A | B | 谁更强 |
| --- | --- | --- | --- |
| 复制消息 | 有（`MessageView.tsx:403-410,516`） | 有（`ChatMessageItem.tsx:272`） | 持平 |
| 原地编辑用户消息表单 | **无** | 有（`InlineEditForm.tsx:55`：改文本 + 附件增删，Enter 发送 / Esc 取消） | B 独有 |
| 重新发送 | **无**（✅ 已核，`grep resend/重发` 零命中） | 有（`ChatMessageItem.tsx:276-283`） | B 独有 |
| 删除单条消息 | **无**（✅ 已核） | 有（`ChatView.tsx:509` → `ipc.ts:2032`），含“建议同时删除对话对”警告（`DeleteMessageDialog.tsx:44-46`） | B 独有 |
| 划词引用 | 有，设置开关 `quoteSelectionEnabled`（`ChatWindow.tsx:477-519`） | 有，且能从选区直接开探索分支（`SelectionActionPopover.tsx:11-70`） | B 联动更强 |
| 时间戳 | 仅每轮最后一条 assistant（`ChatWindow.tsx:1250-1263`） | user/assistant 都显示，跨年带年份（`ChatMessageItem.tsx:72-87`） | B 略强 |
| 用量统计 | 有（`MessageView.tsx:886` `formatUsage`：in/out/cache R/cache W/$） | 有 + **轮次耗时**（`SDKMessageRenderer.tsx:204-232`、`AgentMessages.tsx:536`） | B 多耗时 |
| 工具级耗时 | 有（`MessageView.tsx:688`） | 无对应 | A 独有 |
| 整会话真实活跃时长 | **A 独有**（`lib/session-timing.ts:15`，剔除人类空闲） | 无 | A 独有 |
| 跨压缩累计 token/成本 | **A 独有**（`lib/session-stats.ts:1-60`，计数单调） | 用当前上下文 token（压缩后标 `isEstimated`） | A 更强 |
| 消息级模型标识 | 有（`ChatWindow.tsx:1268`） | 有 logo + 名称 + 头像（`ChatMessageItem.tsx:168-180`） | B 略强 |
| 消息级重试 | 无（只有 Pi 内建 auto-retry 横幅 `ChatInput.tsx:1996-2008`） | 有 + “在新会话中重试”（`SDKMessageRenderer.tsx:559,1321,1332`） | B 更强 |
| 过程折叠分组 | 有 + **最终答复与过程分离**（`lib/message-display.ts:49`） | 有（`ProcessBlockGroup.tsx`） | A 略强 |
| 工具结果大输出按需拉全 | **A 独有**（`MessageView.tsx:1941-1957` + `/api/agent/[id]/bash-output`） | 无对应 | A 独有 |
| 本轮写入文件汇总 | 有（`TurnWrittenFiles.tsx`） | 有（`TurnFileChangesSummary.tsx`） | 持平 |
| 标记消息为 Todo | 无 | 有（`SDKMessageRenderer.tsx:603`） | B 独有 |

### 1.4 长会话性能与上下文

| 功能点 | A | B | 谁更强 |
| --- | --- | --- | --- |
| 服务端分页 | **有**：`tail` 默认 50 上限 1000 + `before` 游标（`app/api/sessions/[id]/context/route.ts:18-20`），`sliceActiveBranch`（`session-reader.ts:566`） | 无（全量渲染） | **A 显著更强** |
| 长链保护 | 有：`rawWindowCap = max(MAX_RAW_WINDOW_ENTRIES, tail*30)`（`session-reader.ts:563`）+ 迭代遍历防爆栈（`:536`） | 靠渲染侧 memo | A 更强 |
| 思考内容懒加载 | **有**：`deferThinking`（`context/route.ts:13`、`message-display.ts:17`、按块路由） | 无（thinking 随消息全量到渲染层） | A 更强 |
| 媒体懒加载 | **有**：`deferMedia`（`context/route.ts:14`） | 无 | A 独有 |
| 滚动锚点 | 按 entryId + offset（`lib/chat-scroll-position.ts:16`） | 按距底部像素（`useScrollPositionMemory.ts:25`） | A 更抗内容变化 |
| 聊天 minimap | 有（按“用户轮”打点 + 悬浮 markdown + 标题导航 `ChatMinimap.tsx`） | 有（20 条横杠 + 悬浮列表 + **会话内搜索**） | 各有优势 |
| 手动 compact | 有（`rpc-manager.ts:853`、`/compact`） | 有 + 二次确认（`ContextUsageBadge.tsx`） | 持平 |
| 压缩进度浮层 | 只有按钮态（`isCompacting`） | 有独立进度浮层 + 收尾窗口（`TaskProgressOverlay.tsx:149-153`） | B 略强 |
| 压缩摘要结构化 | 有：剥离 `<read-files>`/`<modified-files>` 并结构化（`lib/compaction-summary.ts:11`） | 有：生命周期去重防多条分界线（`group.ts:171-189`） | 互补 |
| 自动压缩开关 | **A 有**（`useAgentSession.ts:1787` → `set_auto_compaction`） | 无显式开关 | A 略强 |
| 上下文用量环 | 有（`AppShell.tsx:369,1955-1982`，>90 危险 / >70 警告） | 有 16px SVG 环 + Plan 额度（`ContextUsageBadge.tsx:1-40`） | B 信息密度更高 |
| 上下文轮数控制 | 无 | 有滑块 0/5/10/15/20/∞（`ContextSettingsPopover.tsx:48`） | B 独有 |
| 清除上下文（不删消息） | 无 | 有（`ClearContextButton.tsx:25` + ContextDivider，⌘K） | B 独有 |
| 会话恢复降级 | 幂等恢复（`lib/prompt-recovery.ts:31`：失败把内容退回输入框，避免重复轮） | **上下文重放**（`agent-session-context-prompt.ts:1-60`：回填最近 20 条 + 引导用 CLI 渐进读） | 互补，B 更贴本意 |

### 1.5 导出

| 功能点 | A | B | 谁更强 |
| --- | --- | --- | --- |
| 导出 HTML | **有**（`/api/sessions/[id]/export`，含把递归树改迭代防深链爆栈 `:83-136`） | 无 | **A 独有** |
| 导出 Markdown | 有（`?format=md`，`lib/session-markdown.ts:1-40`） | 有，但走 CLI（`apps/cli/src/commands/export.ts:22`） | 各有路径 |
| CLI 渐进式读取 | 无 CLI | **有**（`list/info/outline/search/export` + `--turns/--head/--tail/--after-message`；>50KB 拒绝灌 stdout 改落盘 `export.ts:72-91`） | **B 独有，专为不撑爆上下文设计** |
| 分享链接 | 两边都无 | 同 | — |

### 1.6 本域额外发现

| 功能点 | A | B | 谁更强 |
| --- | --- | --- | --- |
| 外部进程改写会话文件检测 | **A 独有**（`/api/sessions/[id]` `:38-51`：发现磁盘新 entry 就丢 wrapper 重建） | 靠 `piEntryBindings` + `isReplay` 去重 | A 独有 |
| 流式碎片快照去重 | 分散在 `lib/normalize.ts` 等处 | 沉淀成共享库 `session-core/transcript.ts:62` | B 工程化更好 |
| 跨进程复用的会话核心 | 无（逻辑在 `components/` + `lib/`） | **有 `packages/session-core`**（group/transcript/render-markdown/search/select/outline/tokens），主进程 + renderer + CLI 共用 | B 更强 |
| 会话被文件引用保护 | **A 独有**（`lib/session-file-references.ts:9`，删文件前检查） | 无 | A 独有 |
| 消息数警戒色 | **A 独有**（`AppShell.tsx:1940-1946`：>2000 警告 / >5000 危险） | 无 | A 独有 |

---

## 2. 输入发送与交互控制域

### 2.1 输入区（composer）

| 功能点 | A | B | 判定 |
| --- | --- | --- | --- |
| 多行输入 | 原生 `<textarea rows={1}>`（`ChatInput.tsx:2477`） | TipTap/ProseMirror contentEditable（`rich-text-input.tsx:517`） | 实现不同 |
| 输入区 markdown WYSIWYG | **无**（纯文本，不渲染） | **有**（`rich-text-input.tsx:207-209`，加粗/删除线快捷键 `:824,829`） | **B 独有** |
| 自动高度 | `scrollHeight` 自适应上限 200px（`ChatInput.tsx:1090-1095`）+ ResizeObserver（`:1099-1111`） | 三段式 101 / 200 / 500px + 可折叠（`rich-text-input.tsx:1253-1287`） | B 更丰富 |
| `@` 文件引用 | 有（`ChatInput.tsx:1197-1246` + `/api/file-index`） | 有 + 目录下钻 + workdir/附加目录标记（`FileMentionList.tsx:109-110`） | B 语义更细 |
| `/` skill 引用 | 有（走斜杠命令通道，`ChatInput.tsx:280-294`） | 有（`/` 是 mention 触发符，按 workspace 能力过滤） | 语义不同 |
| `#` MCP 引用 | **无** | 有（只列已启用且握手成功的，`mention-suggestions.tsx:294-303`） | **B 独有** |
| `&` 会话引用 | 部分（右键复制引用 → 粘贴成 chip，`AppShell.tsx:601-609`） | 有触发符 + 从侧栏拖入（`mention-suggestions.tsx:333-360`、`rich-text-input.tsx:196`） | B 更完整 |
| `~` 待办/日程引用 | **无** | 有（`mention-suggestions.tsx:363-400`） | **B 独有** |
| 粘贴图片 | 有（`ChatInput.tsx:1588-1595,975-1003`） | 有（`rich-text-input.tsx:753-758`） | 持平 |
| 粘贴任意文件 | **无**（非图片走 HTML→markdown，不产生附件） | 有（`chat/ChatInput.tsx:132`、`AgentView.tsx:1427`） | **B 独有** |
| 超长文本自动转附件 | **无** | 有（`onPasteLongText` + 阈值，`rich-text-input.tsx:151-155,772-802`） | **B 独有** |
| 拖拽上传 | 仅图片（`ChatWindow.tsx:892-896,1122-1125`；非图片抖动拒绝 `useDragDrop.ts:22-28`） | 任意文件 + 虚线卡片 + 从文件面板/会话行拖入引用（`rich-text-input.tsx:695-706`） | B 明显更宽 |
| 附件上限 | 图片 10MB / 10 张，超限**静默丢弃**（`lib/image-attachments.ts:1-2`、`ChatInput.tsx:979-984`） | 100MB（`shared/types/chat.ts:14`）；>100MB 且有源路径则**降级为路径引用**（`AgentView.tsx:1850-1860`） | B 上限高 10 倍且有降级 |
| 图片客户端压缩 | **A 独有**（>1MB 压到长边 1024 / JPEG 0.85，`ChatInput.tsx:344-393`） | 未在输入侧找到同等压缩 | A 独有 |
| 图片预览 | 56×56 缩略 + 单图 lightbox（`ChatInput.tsx:2075-2096`） | 多图翻页 + 图内编辑（`AttachmentPreviewItem.tsx:52-72`） | B 更强 |
| 输入历史 ↑ 召回 | **A 独有**（最近 50 条去重，`ChatWindow.tsx:912-925`、`ChatInput.tsx:1553-1560`） | 无 | A 独有 |
| Bash 模式 `!` / `!!` | **A 独有**（`ChatInput.tsx:619-620,2537-2540`） | 无 | A 独有 |
| 语音输入 | 无 | 有 + 全局语音浮窗 Ctrl+`（`speech-button.tsx:43`、`shortcut-defaults.ts:210-216`） | B 独有 |
| 发送前网络检查 | 无 | 有（离线 toast 拒绝，`chat/ChatInput.tsx:284-287`） | B 独有 |
| 草稿持久化 | 内存 Map + localStorage，跨会话搬家（`lib/draft-store.ts:19-40`）；提交失败可恢复 | Jotai atom，保存富文本结构 + 300ms 停顿同步（`AgentView.tsx:3121-3124`） | 持平（A 略强：可恢复提交） |

### 2.2 发送与队列（**语义差异最大的一处**）

| 维度 | A | B |
| --- | --- | --- |
| 队列归属 | pi 进程内原生 steering / followUp 队列（`lib/rpc-manager.ts:704-707`），渲染层只读镜像 | 主进程托管队列，渲染层可增删改序（`main/ipc.ts:3584,3607,3614`） |
| 队列语义 | 两种：`steer`（打断并立即注入）/ `followUp`（本轮后追加）——`ChatInput.tsx:1806-1857` | 单一：当前 turn 结束后发送（`dispatch:'after_current'`，`AgentView.tsx:2064-2070`） |
| 单条撤回 | **无**（只能整体 clear；服务端注释说明 pi 无单条出队，clear+requeue 会与 agent loop 抢消息 `rpc-manager.ts:885-889`） | **有**：逐条撤回并合并进已有草稿、还原附件与引用（`AgentView.tsx:2705-2752`） |
| 单条删除 / 拖拽排序 | 无 | 有（`AgentMessageQueue.tsx:79-135`、`agent-message-queue.ts:104-121`） |
| 立即发送（打断当前执行） | 无 | 有，且失败可回滚到队首（`AgentView.tsx:2660-2703`） |
| 队列可视化 | 纯文本行 + kind 徽标 | 7 类彩色 chip 预览（`AgentMessageQueue.tsx:224-252`） |
| 队列消费守卫 | 由 pi loop 决定 | 显式多条件（非 running / 非等待后台 / 非用户停止 / 无阻塞请求 / 有渠道与模型，`agent-message-queue.ts:26-42`） |

结论：**A 在语义上更丰富（有 steer），B 在操控上更完整（逐条可操作）**。两侧各自都值得补一半（见 PR 文档 GAP-11 / GAP-12）。

### 2.3 快捷键 / 斜杠命令 / 生命周期提示

| 功能点 | A | B | 判定 |
| --- | --- | --- | --- |
| 斜杠命令面板 | **有**（builtin/extension/prompt/skill 分组 + 二维方向键导航，`ChatInput.tsx:1149-1192,1401-1442`） | 无（`/` 被 skill mention 占用） | A 独有 |
| 内置斜杠命令 | `/compact /reload /name /session /copy /clone`（`ChatInput.tsx:253-260`） | 无（做成了按钮） | A 独有 |
| 快捷键默认表 | **无**（仅 2 个硬编码全局键：Esc 停止、Ctrl+Alt+N 新建，`hooks/useKeyboardShortcuts.ts:33-75`） | **有**：24 条 / 4 类 / Mac+Win 双默认（`lib/shortcut-defaults.ts:53-226`） | **B 独有** |
| 快捷键中央注册表 | 无（各自 addEventListener） | 有（capture 阶段单点分发 + `exclusive` 内层优先，`shortcut-registry.ts:156-211`） | B 独有 |
| 快捷键录制 / 冲突检测 / 禁用 / 恢复默认 | 全无 | 全有（`ShortcutSettings.tsx:37-473`、`shortcut-registry.ts:291-316`） | B 独有 |
| 系统级全局快捷键 | 无（Electron 层无 `globalShortcut`） | 有（Alt+Space / Cmd+Shift+P / Ctrl+`） | B 独有 |
| 停止生成 | Esc（`useKeyboardShortcuts.ts:56-68` + 输入框内自管） | Cmd+Shift+Backspace + 可定向到具体会话（`lib/stop-generation-target.ts`） | B 更严谨（含 `isStopping` 幂等） |
| 写入“已停止”标记 | 无 | 有（`stoppedByUserSessionsAtom`，阻止队列自动开跑） | B 独有 |
| 自动重试状态机 | 简版横幅（`useAgentSession.ts:1370-1375`） | 完整（scheduled/running/succeeded/exhausted/cancelled + 倒计时 + 总预算） | B 更细 |
| 全屏新手引导 | 无（只有 12 条轮换 tip，`ComposerTipLine.tsx:28-42`） | 有 9 步引导 + 可重放（`OnboardingView.tsx:1-30,668`） | B 独有 |
| 提示音 | 单一完成音（`hooks/useAudio.ts:4-19`） | 12 套音色 × 4 类语义 cue（`atoms/notifications.ts:15-105`） | B 明显更强 |
| 系统通知 | 有，三级降级（SW → window → native，`lib/browser-notifications.ts:35-160`） | 有（Electron 原生 + 日程提醒） | 持平 |
| Web Push 到手机 | **A 独有**（VAPID，`lib/web-push.ts`、`app/api/push/*`） | 无（改用飞书/钉钉/Slack/微信 bot） | A 独有 |
| 未读存在感 / 角标 | Dock 角标有；**跨会话未读无** | 有（`unviewedCompletedSessionIdsAtom` + `agent-completion-presence.ts`） | B 独有 |
| 全局快速输入浮窗 | 无 | 有（Alt+Space，`QuickTaskApp.tsx:1-50`） | B 独有 |

---

## 3. 文件 / 预览 / 编辑器 / 终端 / 浏览器域

### 3.1 文件树

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| 多根合并（会话/项目/附加目录） | 无（单 `cwd`，`FileExplorer.tsx:28-40`） | **有**（`file-browser-roots.ts:5-11`、`FileBrowser.tsx:249-256`） | **真缺口** |
| 作用域徽标 | 无 | 有（“会话文件”徽标 `FileBrowser.tsx:917-923`） | 真缺口 |
| 懒加载 | 有（`:63-79,260-276`） | 有（`FileBrowser.tsx:793-822`） | 等价 |
| 虚拟化 | 双方都无 | 同 | — |
| 排序 | 服务端目录优先 + `localeCompare`（`app/api/files/[...path]/route.ts:702-712`） | 客户端同规则（`FileBrowser.tsx:126-132`） | 等价 |
| 搜索 | 有（`/api/file-index` + `lib/file-fuzzy.ts`，150ms 防抖） | 有（多源 + 前缀/目录/短路径优先排序 `FileSearchBar.tsx:37-52`） | 等价 |
| 搜索命中自动定位 | **无**（只渲染结果树） | **有**（展开祖先 + 滚动居中，`FileBrowser.tsx:640-700`） | **真缺口** |
| 作用域过滤 | 无 | 有 `all/session/project`（`FileSearchBar.tsx:22-27`） | B 有 |
| 空目录延迟重试 | 无 | 有（800ms 后重试一次，抗 agent 写入竞态，`FileBrowser.tsx:800-812`） | B 有 |
| 最近修改标记 | 标“刚上传”（`FileExplorer.tsx:316-330`） | 标“最近被 Agent 修改”（`FileBrowser.tsx:192-209`） | 语义不同 |
| 粘性目录行 + 祖先导引线 | 无 | 有（最多 8 层，`tree-row-layout.tsx:16-59`） | **真缺口** |
| 拖拽引用 | 无 HTML5 拖拽（hover 出“引用”按钮） | 有 `draggable` + `file-panel-drag.ts:57-58` | 能力等价 |
| 多选 | 无 | 有 Cmd/Ctrl 多选（`FileBrowser.tsx:212,281-295`） | **真缺口** |
| 右键/三点菜单 | 无（✅ `onContextMenu` 零命中） | 有 9 项菜单（`FileBrowser.tsx:969-1105`） | **真缺口** |

### 3.2 文件操作

| 操作 | A | B | 判定 |
| --- | --- | --- | --- |
| 新建文件 / 文件夹 | 文件树内无（仅 `DirectoryPicker` 可建目录） | 双方都无“新建文件” | 都缺 |
| 重命名 | 文件树内无 | 有（文件+目录，自动只选中文件名，`FileBrowser.tsx:319-351`） | B 有 |
| 删除 | 文件树内无 | 有 + `AlertDialog` 二次确认 + 目录递归提示（`:354-375,500-530`） | B 有 |
| 移动 / 移入项目 | 无 | 有（`:377-417`、`file-move-service.ts:1-49`） | B 有 |
| 批量删除/移动 | 无 | 有（菜单带 `(N)`） | B 有 |
| 复制文件 | 双方都无 | 同 | — |
| 上传 | **有且更完整**：`type=upload` + `upload-check`，单文件 25MB / 总量 100MB，冲突三策略 `error/overwrite/skip`，XHR 进度 + 结果摘要 + 上传后一键 @ 引用（`app/api/files/[...path]/route.ts:44-48,186+`、`lib/file-upload.ts:1-60`、`FileExplorer.tsx:141-200,660-830`） | 有（`FileDropZone.tsx:26-171`，落盘到会话/工作区文件区，>100MB 跳过并 toast） | A 更强（写当前浏览目录） |
| 下载 | 有（`?type=download`） | 本地应用无“下载”，有另存（`saveImageAs`） | 路线不同 |
| 在文件管理器/默认应用打开 | 有（`/api/files/reveal` + `lib/path-actions.ts:38-52`） | 有 + 默认应用名/图标 + `KNOWN_EDITORS` 白名单（`ipc.ts:1652-1720`） | B 更细 |
| 在终端打开目录 | 有（`ExplorerPanel.tsx:63-66`） | 有 + 目录行/菜单/改动面板三处入口 | B 入口多 |

### 3.3 预览（逐格式）

| 格式 | A | B | 判定 |
| --- | --- | --- | --- |
| 文本/代码 | 有，懒加载高亮 + wrap + 256KB 分块续读（`lib/text-preview.ts:1-49`） | 有，`@pierre/diffs` 高亮，>500k 字符降级（`DiffTabContent.tsx:117,2029`） | 等价 |
| Markdown | 预览/Source 切换 + frontmatter 卡片（`MarkdownFilePreview.tsx:1-165`） | Live 预览/编辑一体（`DiffTabContent.tsx:1983-1998`） | 等价 |
| HTML | `iframe srcDoc` + sandbox（相对资源不可用） | `proma-file://` token URL（相对资源可用） | B 更强 |
| 图片 | 有，10MB，**无缩放**（`FileViewer.tsx:526-689`） | 有，0.1–5x 缩放 + 平移（`DiffTabContent.tsx:1899-1930`） | **A 缺缩放** |
| PDF | 浏览器原生 viewer（无缩放控件/无搜索） | 自建 pdfjs-dist + 缩放百分比同步（`file-preview-service.ts:600+`） | **B 有缩放** |
| DOCX | mammoth → 同源 iframe + CSP，支持帧内选区引用（`app/api/files/...:534-560`） | OfficeCLI → mammoth 降级 | 等价 |
| XLSX | **无专用预览**（落入文本分支，实际乱码） | 有（adm-zip + XML，8 sheet / 200 行 / 40 列上限，`file-preview-service.ts:28-30,414-467`） | **真缺口** |
| PPTX | **无** | 有（80 页上限，提取标题+要点，`:31,501-528`） | **真缺口** |
| 旧 .doc/.xls/.ppt | 无 | 显式识别并按“无高保真预览”兜底 | 差异小 |
| 音视频 | **有**（Audio/VideoViewer + Range 流式，`FileViewer.tsx:698-1019`） | **无内联预览** | **A 独有** |
| 不可预览/二进制 | **无降级卡片**（以 UTF-8 文本渲染） | 有元数据卡片 + 默认应用打开（`UnsupportedFilePreview.tsx:1-82`） | **真缺口** |
| 预览内查找 | 无 | 有（大小写/整词/正则 + 计数 + 上下跳，`PreviewFindBar.tsx:18-35,194-230`） | 真缺口 |
| Markdown 大纲/scroll-spy | 无 | 有（`MarkdownToc.tsx:1-60`） | 真缺口 |
| 独立预览窗口 | 无 | 有（`DetachedPreviewApp.tsx` + 主进程窗口管理） | 真缺口（桌面绑定） |

### 3.4 编辑器

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| Markdown 编辑路线 | ProseMirror WYSIWYG（`MarkdownFileEditor.tsx:1-503`），复杂语法保留为 `raw_block` | CodeMirror 6 实时预览 + （孤儿）TipTap 富文本 | 路线不同 |
| 编辑器工具栏 | **无**（仅 Mod-b/Mod-i） | 有（标题/列表/任务/引用/代码块/表格插入/链接/截图，`MarkdownEditorToolbar.tsx:181-200,343-401`） | **真缺口** |
| 表格网格编辑 | 无（落 raw_block） | 有（`TableBubbleMenu.tsx`） | 真缺口 |
| frontmatter | 只读卡片 | 可编辑 Properties（`live-markdown-frontmatter.ts:31-81`） | B 有 |
| 图片粘贴/截图入文 | **无** | 有（`markdown-media-service.ts:1-64`） | 真缺口 |
| 自动保存 / 脏标记 | 有（debounce + 串行写 + 重试 `markdown-sync.ts:48-177`；`saveState`） | 有（序列化队列 + `autosaveStatus`） | 等价 |
| 外部变更冲突检测 | **A 显著更强**：写前必须带 `baseContent`（缺失 428），不一致 409 + 返回磁盘内容；服务端同 fd 比对写入；编辑器 diff3 三方合并（`app/api/files/...:160-181`、`lib/markdown-file.ts:16-45`、`lib/markdown-sync.ts:14-30`） | **无**：直接 `writeFileSync`，并发编辑会静默覆盖（`ipc.ts:4232-4251`） | **A 独有（B 真缺陷）** |
| 通用代码编辑器 | **A 独有**（CodeMirror 多语言可编辑，`CodeFileEditor.tsx:1-354`，服务端校验 NUL/symlink/读回一致） | 无（非 Markdown 文本只读或用 textarea） | A 独有 |

### 3.5 Diff / 改动面板

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| git status / 单文件 diff | 有（`lib/git-changes.ts:46-57,110-130,194-275`，2.5s TTL） | 有（`git-diff-service.ts:305-530,731-839`，索引/HEAD 指纹失效） | 等价 |
| diff 渲染 | 自绘逐行 + 上下文折叠，无 split | `@pierre/diffs` MultiFileDiff，支持 split/unified | B 略强 |
| 分仓库/目录分组 + 目录树压缩 | 无（扁平列表 + 目录小黄点） | 有（`DiffChangesList.tsx:237-267,356-400`、`diff-file-tree.ts`） | **真缺口** |
| 逐文件撤销 | **无** | 有（`git restore --staged --worktree` + 确认，`git-diff-service.ts:840-852`） | **真缺口** |
| 非 git 改动（本轮/更早） | 无面板（对话内有“本轮写入文件”，`TurnWrittenFiles.tsx`） | 有（`session-file-changes.ts:76+`） | 真缺口 |
| 来源徽标（会话/工作区/附加） | 无 | 有（`diff-change-sources.ts:11-31`） | 真缺口 |
| 未查看标记 | 无 | 有（`agentDiffUnseenFilesAtom`） | 真缺口 |
| 改动搜索 | 无 | 有（`DiffChangesList.tsx:305-325`） | B 有 |
| worktree 作为 diff 基准 | 无（固定 HEAD） | 有（`getWorktreeChanges(worktreePath, baseBranch)`） | 真缺口 |

### 3.6 worktree / 终端 / 浏览器

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| worktree 列出/创建/删除 | **有全部**（`lib/worktree.ts:154-270`、`/api/worktrees`，脏树 409 二次确认） | 只有列出 + 切换 + 基准 diff | **A 独有** |
| 会话级 activeWorktree（Agent/终端跟随） | 无（只有分组推导） | 有（`meta.activeWorktree` 参与授权根与终端 cwd，`ipc.ts:499-504`） | B 有 |
| 终端进程位置 | `node-pty` 在 Next 服务进程内（`lib/terminal-manager.ts:1-110`） | 独立 utility process（崩溃隔离更好，`utility/terminal-runtime.ts:1-40`） | B 隔离更好 |
| 输出传输 | HTTP 写 + SSE 读，128KB 尾缓冲重放，`Last-Event-ID` 续传，断连保留 120s | IPC + 序号 ack 背压 + 1MB 可重放快照（`terminal-service.ts:245-258`） | B 更完整 |
| Agent 终端工具 | **无** | 有（6 个工具 + cwd realpath 越界拒绍 + 输出分页供模型读，`terminal-agent-policy.ts:1-31`） | **真缺口** |
| 从文件区开终端 | 有（面板头部） | 有（三处入口） | 等价 |
| 内嵌浏览器 | sandboxed iframe（`BrowserPanel.tsx`，`X-Frame-Options: DENY` 站点白屏，面板文案已说明） | Electron `WebContentsView` + 完整 CDP + 24 个 agent 工具 + 风险告知门 + profile 隔离 | **真缺口（最大单项）** |
| 回答里的外链路由 | `target="_blank"` → 系统浏览器（`MarkdownBody.tsx:85`、`electron/main.js:212-220`） | 路由到应用内受管浏览器（`AgentBrowserLinkProvider.tsx`） | 真缺口（可独立先做） |
| 本地 HTML 预览 | 文件查看器 `iframe srcDoc`（相对资源不可用） | `BrowserPreviewOpen` + token 协议（目录 URL 使相对资源可用） | B 更强 |

### 3.7 文件访问安全边界

| 维度 | A | B | 判定 |
| --- | --- | --- | --- |
| 授权根 | 会话 cwd + 项目根 + `~/pi-cwd-*` + chat workspace + `allowFileRoot()`（`lib/file-access.ts:17-58`，5s 缓存） | 工作区聚合根 + 预览临时目录 + 会话附加目录/活动 worktree/附加文件（`ipc.ts:487-524`） | 路线不同 |
| 校验算法 | 两段：lexical（Windows 大小写折叠 + `path.win32`）+ realpath 后再比，唯一实现 `isPathWithinRoots`（`lib/path-security.ts:11-42`） | realpath 后 `relative` 判 `isUnderRoot`（`ipc.ts:536-565`） | 等价 |
| 符号链接 | 编辑拒 symlink；上传目标 realpath 后再判根（`app/api/files/...:100-146`） | realpath + 越界拒绍；Markdown 相对图片必须仍在文档目录内；终端 cwd 拒越界 symlink | 等价 |
| 请求来源校验 | 有（HTTP 面）：`isApiRequestAllowed` + JSON Content-Type 强制 | 无 HTTP 面（全 IPC，参数经字段白名单） | 路线不同 |
| 逃生开关 | 无 | 有 `unrestricted`（默认 false，仅用户主动选外部文件时置位） | B 有更宽通道 |
| 本地文件 URL 协议 | 无（HTTP 直接读流） | `proma-file://<uuid>` token：60 分钟 TTL / 500 条上限 / realpath 越界拒绍；renderer 从不拿绝对路径 | **B 更严** |
| 敏感操作 | `reveal`/`open` 走同一 allow-list，argv 数组不经 shell | 默认应用限制在 `KNOWN_EDITORS` 白名单 | 等价 |

---

## 4. 模型 / 鉴权 / 扩展能力域

### 4.1 模型与渠道

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| provider 预设 | 无内置预设，`~/.pi/agent/models.json` 自配（读 `app/api/models-config/route.ts:6`） | **24 家预设 + custom**（`shared/types/channel.ts:11-42,47+`） | B 有预设 |
| 模型发现（拉上游列表） | 有（`app/api/models-config/discover` + `lib/model-discovery.ts:31-40`） | 有（IPC `FETCH_MODELS`） | 对齐 |
| 连接测试 | 有（`/api/models-config/test`，messages ping + 超时） | 有（`channel-manager.ts:794,1783`，15s 超时，无 `/models` 的走极小 ping） | 对齐 |
| 价格目录 | **models.dev 全量目录**（`/api/models-config/catalog` + `lib/model-catalog.ts` 414 行） | **无**（成本写死默认值 `pi-model-registry.ts:37-52`） | **A 独有** |
| 额度查询 | 有，白名单 9 家（`lib/provider-usage-ids.ts:1-12`） | 有（Codex wham/usage、Copilot、Kimi、MiniMax、DeepSeek、智谱） | 各有覆盖 |
| enabledModels 作用域 | **有**：minimatch glob + fuzzy + `:level` 思考 pin，委托 SDK `resolveModelScopeWithDiagnostics`（`lib/model-scope.ts:23-24,134,159-213`） | 无此概念（等价物是渠道内模型白名单 `agent-model-selection.ts:36-58`） | A 独有 |
| 思考档与 per-model pin | pin 由作用域表达式携带，启动原子应用 | 全局 `agentEffort`（`agent-thinking-level.ts:7-31`）+ 能力解析 | 实现不同 |
| 模型热切换时机 | **即时生效**（`set_model`，`rpc-manager.ts:718-726`） | **延迟到下一轮**（`AgentView.tsx:1907,1927` 明确运行中不换） | B 更稳 |
| 多模型并行 | 两边都无 | 同 | — |

### 4.2 鉴权

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| 凭据位置 | `~/.pi/agent/auth.json`（与 pi CLI 共用） | `~/.proma/channels.json` | 实现不同 |
| 加密 | **无加密**，靠 0600 + 目录 0700 + proper-lockfile（`lib/provider-credential-store.ts:7-12,30-40`） | `safeStorage`（Keychain/DPAPI/Secret Service）+ 不可用时回退明文并告警（`channel-manager.ts:432-463`） | **A 弱** |
| OAuth 设备码 | 有（`/api/auth/login/[provider]` `:154-156,190`） | 有（Codex / Copilot / xAI 三家） | 两边都有 |
| 手动码回填 | **A 有**（`:8,18,123-125`） | **无**（只有设备码轮询 + 取消） | A 独有 |
| 登出 | 有（同锁删除 `removeStoredCredentialIfType`） | 靠删除渠道 | 实现不同 |
| provider 列表去重（双鉴权） | 能力驱动去重（`lib/provider-listing.ts`） | 无此问题（一个渠道 = 一个 provider） | 实现不同 |
| 代理设置 | **无 UI**（走 `HTTP_PROXY` + undici dispatcher，`lib/http-dispatcher.ts`） | **有应用内设置**（system/manual + URL 脱敏，`proxy-settings-service.ts:1-137`） | **A 缺 UI** |

### 4.3 Skills / Plugins / MCP / Subagents

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| Skills 作用域 | pi 三层（全局/项目/包，`lib/skills-service.ts:6-16`） | 工作区级（目录移动切换启停，`config-paths.ts:345`） | 实现不同 |
| 项目 ambient skills | 启用但受 project trust 门禁（`lib/project-trust.ts:24-47`） | **显式禁用**（`pi-resource-loader-overrides.ts:12-19`） | 策略相反 |
| 内置技能 | **无** | **17 个**（automation / agent-collaboration / docx / xlsx / pptx / pdf / session-cleaner / skill-creator / tool-builder …） | **A 缺** |
| skills.sh 搜索 / 安装 | **A 有**（`/api/skills/search`、`npx skills add --agent pi`） | 无 | A 独有 |
| 更新检查 | 有（`lib/skill-updates.ts` + `/api/skills/check|update`） | 有内置技能版本升级 + 退役 slug 清理 | 各有 |
| 禁用机制 | 外科式只改 `disable-model-invocation`（`lib/skill-frontmatter.ts:35-43`） | 移动目录 | 实现不同 |
| Skill 子文件编辑 | **无** | 有（LIST/READ/WRITE/CREATE/DELETE/RENAME + `SkillFilesPanel.tsx`） | **A 缺** |
| Skill 导入导出（跨工作区） | 无 | 有（`IMPORT_SKILL_FROM_WORKSPACE` / `BATCH_IMPORT`，同名拒绍） | A 缺 |
| Plugins / 包管理 | **A 全部有**（`/api/plugins` 391 行 + `lib/plugin-updates.ts` + 禁用写空数组 + `resourceCount/installedPath/status` 诊断） | **完全没有**（`grep DefaultPackageManager` 零命中） | **A 独有** |
| MCP CRUD | 有（`/api/mcp` add/remove/enable/disable/update/move/test/get） | 有（每工作区 `mcp.json` + 按工作区串行队列） | 对齐 |
| MCP 配置导入（别家工具） | **A 有**（Claude / Codex / Cursor / Windsurf / VS Code 两级 + Codex TOML + shadowed 标记） | 无 | A 独有 |
| MCP 启用前握手验证 | **无**（只有手动 test，启用不校验） | **有**：验证通过才写 `enabled`（`mcp-validator.ts:44,99,138`、`mcp-configuration-service.ts:102-113`） | **A 缺（安全相关）** |
| MCP OAuth PKCE + Keychain | 无 | 有（`mcp-oauth-service.ts:281-539`，PKCE + 本地 callback + 动态注册 + safeStorage） | A 缺 |
| MCP 内置集成目录 | 无 | 有 18 个 / 4 类（`integration-catalog.ts:233-422`） | A 缺 |
| MCP Agent 自管工具 | 无 | 有 2 个（先 list 再 configure，`pi-builtin-tools.ts:159,169`） | A 缺 |
| Subagent 形态 | headless + profile 文件（`lib/subagents.ts` 603 行，内置 general-purpose/explore/plan） | **真子会话**（可交互/可续跑，`agent-collaboration-tools.ts` 1189 行，11 个工具） | 实现不同 |
| Subagent 工具白名单 / profile 级技能扩展开关 | **A 有**（`tools` 含 `ext:`，`load_skills`/`load_extensions`） | 无 profile 概念（有 `role`/`goal`/深度） | A 独有 |
| 委派阻塞冒泡 | **无**（只有 `get_subagent_result` / `steer_subagent` 拉取） | **有**（`delegation_blocked` + `answer_delegation_question` + `continue_delegation`） | **A 缺** |
| 嵌套约束 / 并发上限 | 有（深度 + `maxConcurrent` 默认 10 上限 32 + 队列） | 有（`triggeredBy==='delegation'` 或 `delegationDepth>0` 拒绍再委派） | 两边都有 |
| 总开关 | 有（`builtInEnabled` 默认 false） | 无（协作工具常驻） | 实现不同 |

---

## 5. 平台能力域

### 5.1 定时任务

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| 调度表达 | **完整 5 字段 cron + 时区**（`lib/cron-schedule.ts:17`、`cron-expression.ts`、`cron-timezone.ts`） | 结构化 5 类，无 cron 解析（`shared/types/automation.ts:13`） | **A 更强** |
| 时间窗口 | `idleWindow` 可跨午夜（`cron-schedule.ts:20-24,38-39`） | `activeWindowStart/End + activeWeekdays`，窗口起点作锚防漂移 | 两边都有 |
| 限次 | `once` 有；**`maxRuns` 自动停用无** | 有（达上限停用并标 `completedAt`） | **A 缺** |
| 失败处理 | 只记 `lastStatus/lastError`；**不自动暂停** | 连续失败 5 次自动暂停 | **A 缺** |
| 子会话策略 | **每次新建**（`cron-runner.ts:68`） | `daily`（同日复用/跨日新建/上下文 ≥0.7 换新）/ `reuse` + 用户手发消息即“毕业” | **A 缺** |
| 无人值守 | 普通会话运行，**无超时** | headless + 强制 bypass + 单次 2h 超时 | **A 缺** |
| 重入保护 | 有（`cron-runner.ts:35,49-51`） | 有 | 对齐 |
| 错过执行 | `skipped (server was not running)` + UI `missed` 标记（`:103-105`） | 顺延一个完整间隔防雪崩 | 实现不同 |
| 运行历史 | 有（上限 20 条 + `lastSessionId`） | 有（`AutomationRun[]` 可点进子会话） | 对齐 |
| 完成通知 | 无（有 Web Push 可复用） | 飞书卡片（always/success/error 三选一） | **A 缺** |
| Agent 自建工具 | **无**（只有面板 + CRUD API） | **7 个**（list/get/create/update/delete/run_now；自动运行中禁递归） | **A 缺** |
| 存储 | `<agentDir>/pi-web-cron.json` | `~/.proma/automations.json` | 实现不同 |

### 5.2 Todo / 日程 / 提醒

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| Todo | 会话级工具，状态存 tool result `details`（随分支回退，`lib/todo-extension.ts:1-40`） | 独立持久化模型 + 工作区归属 + 分组 + 标签 | B 更强 |
| 日程 | **无**（全仓 `planning|reminder` 在 `app/ lib/ components/ hooks/` 命中 0） | 有（月视图 1188 行 `CalendarWorkspace.tsx`） | **A 缺** |
| 提醒 | 无 | 有（30s 轮询 + 原生通知 silent + 常驻 rail + snooze/acknowledge） | A 缺 |
| 存储 | localStorage / 会话文件 | SQLite `~/.proma/planning.db`（`planning-manager.ts` 1369 行） | 实现不同 |
| Agent 工具数 | 1（`todo`） | **25 个 `mcp__planning__*`** | A 缺 |
| 删除类二次确认策略 | 无 | 有（`planning-permission-policy.ts:4-14`，bypass 下也确认） | A 缺 |
| Agent 变更自动切面板 | 无 | 有（`agent-component-activation.ts:3-28`） | A 缺 |
| macOS EventKit 双向同步 | 无 | 有（N-API addon；桌面绑定，不建议搬） | A 缺（不搬） |

### 5.3 记忆

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| 位置 | `<agentDir>/memory/{MEMORY.md, SCRATCHPAD.md, daily/}` | 工作区级 `~/.proma/agent-workspaces/{slug}/memory/` | 实现不同 |
| 能力归属 | **不由本仓实现**：外部 `npm:pi-memory` 拥有写入与注入（`lib/pi-memory.ts:4-8`） | 自研（`agent-workspace-manager.ts` memory CRUD + legacy 迁移） | 实现不同 |
| 注入方式 | 由包自行注入（7 个工具） | 正文不自动注入，只给目录/索引路径与写入规则（`agent-prompt-builder.ts:159-175`） | 实现不同 |
| 刷新邀请 | **无** | 有（>3 天未整理且有新会话 → 邀请，含冷却） | **A 缺** |
| 变更监听 | **无** | 有（180ms 去抖 / ≤128 目录 / 512 文件 / 深度 6 / symlink 防护） | **A 缺** |
| UI | 简版面板（`PiMemoryConfig.tsx` + 白名单读写 256KB） | 记忆 tab + **独立记忆窗口** + 变更 Shelf | 实现不同 |
| 初始化引导 | 无 | 有（两段受授权 prompt，禁全量扫描） | A 缺 |

### 5.4 通知 / 多窗口 / 更新 / 部署

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| 通知通道 | 浏览器通知 + Electron 原生 + **Web Push**（桌面壳下主动跳过 Web Push 避免双通知） | Electron 原生 + 四类提示音 | 各有 |
| 提示音库 | 单一完成音 | 12 套 × 4 类语义 | B 更强 |
| 多窗口 | **单窗** | **7 个窗口**（闪屏/主窗/悬停小窗/独立预览/快速任务/截图/语音 + 记忆窗） | B 独有（多为桌面绑定） |
| 托盘 | 只有“显示/退出” | 托盘菜单含运行中 + 最近会话 | B 更强 |
| 自动更新 | **只查版本**（npm registry + 12h 缓存） | **完整**（electron-updater + 空闲安装 + 缓存清理 + Release 日志） | A 缺（依赖打包 target） |
| 启动闪屏 | **无**（最坏等 `waitReady` 90s 空窗口） | 有（renderer 前静态闪屏） | **A 缺，性价比最高** |
| i18n | **有 3 语言 1014 key** | 无 | **A 独有** |
| Web 自托管 | **有**（密码/Basic + cookie + PWA + Web Push + Docker） | 无 | **A 独有** |
| 存储管理 / 用量清理 | 无 | 有（`storage-service.ts:418-554` + `StorageSettings.tsx`） | A 缺 |
| Onboarding / 迁移 | 无 | 有 | A 缺 |
| 运行时性能诊断面板 | 无 | 有（`lib/performance-monitor.ts`，`?perf=1`） | A 缺（100 行可原样移植） |

### 5.5 工作区模型 / 信任 / 附加目录

| 项 | A | B | 判定 |
| --- | --- | --- | --- |
| 项目信任 | **有**（`lib/project-trust.ts`，与 pi CLI 共用 trust store） | 无“信任”概念，改为“用户授权根 + 绝不越过” | 实现不同 |
| 项目指令文件发现 | pi 原生 AGENTS.md（受 trust 门禁） | AGENTS.md / AGENTS.MD / CLAUDE.md 候选，64KB/源上限，旧文件迁移 | B 更显式 |
| AGENTS.md 双层 | 单层（项目根） | **双层**（工作区执行环境 + 项目地图，`combinePromaInstructionFiles`） | A 缺 |
| 附加目录 | 无“附加”概念（只有内部 allow-list） | 会话级 + 工作区级，可 detach/引用，提示词列出 `<attached_directories>` | A 缺 |
| 工作区实体 | 会话 cwd（不可变）+ worktree 分组 + chat workspace | 独立索引 + 每工作区 `mcp.json`/`skills/`/`memory/`/`AGENTS.md`/`workspace-files/` | 实现不同 |
| 项目根健康检测 | 无 | 有（`project-root-health.ts` + RELINK/RESTORE） | A 缺 |

---

## 6. 布局 / 视觉 / 可访问性 / 性能工程

### 6.1 布局与交互

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| 主/次区角色互换 | **A 独有**（`workspaceSwapped`，轨道固定只换 `grid-area`，`AppShell.tsx:295`、`globals.css:2062-2069`） | 无 | A 独有 |
| 右栏多 tab | 有（file / terminal / browser + ExplorerPanel） | 有（files / changes / chat / temporary-agent / delegation / exploration / preview / browser / terminal …） | B 类型多 |
| 真分屏（双 pane） | 半有（面板内再分列，560px 阈值） | **有**（右工作区 `{leftTab,rightTab,ratio}`，比例按宽度夹取，可拖分隔条） | B 有 |
| tab 拖拽排序 | 无 | 表观有实为残留（`dragging` 无消费者、`reorderTabs` 零调用者、无 onDrop） | 双方实际都无 |
| 拖 tab 转分屏 | 无 | 有（>24px tear-off，仅 preview） | B 有 |
| Ctrl+Tab MRU | 无 | 有（两段 MRU + 运行脉冲） | B 独有 |
| tab 悬浮预览 | 无 | 有（300ms + portal 面板 + 消息 minimap） | B 独有 |
| per-tab 错误边界 | 仅 1 处（`MarkdownEditorBoundary`），无 `app/error.tsx` | ≥4 处（Tab / Preview / Vault / Mention） | **A 缺** |
| 折叠态 rail | 无 | 有（`CollapsedSessionRail` + 3 个折叠弹层） | B 独有 |
| 移动端 | **有**（抽屉侧栏、紧凑工具条 + More、`visualViewport` 键盘避让、34 处 `safe-area-inset`、`pointer: coarse`、PWA） | **无宽度断点**（`globals.css` 仅 3 个 `@media` 全为 reduced-motion；窗口下限 800×600） | **A 明显更强** |
| 设置面板 | 8 段 + 搜索 + 懒挂载保活 | 11–14 段 + 未保存内容拦截 | B 有 dirty 拦截 |

### 6.2 视觉与主题

| 能力 | A | B | 判定 |
| --- | --- | --- | --- |
| 调色板 | 6 套（light/dark/mist/rose/pine/auto），oklch | 4 模式 + 7 套特殊风格 | A 更成体系 |
| 叠加主题引擎（读 pi CLI 主题 JSON → 内联 CSS 变量） | **A 独有** | 无 | A 独有 |
| 壁纸 / 界面密度 / 边框深度 / 正文字号列宽 | **A 全有**（`WallpaperSettings.tsx`、`lib/ui-density.ts`、`lib/border-depth.ts`、`hooks/useChatAppearance.ts:5-12`） | 仅 Markdown 预览三档字号 | A 明显更强 |
| 主题预览图 | 无（色块 swatch） | 有 7 张图 | B 有 |
| token 体系 | Tailwind 4 `@theme` + 裸 `:root` 几何/动效层，247 token、2631 处 `var()`、`--radius-*` 引用 265 次 | Tailwind 3 + shadcn HSL token，特殊风格必须进 safelist | A 更完整 |
| 设计契约文档 | 无 DESIGN.md，但有等效的 `docs/codex-skin/visual-spec.md` + 可执行 `verify-themes.mjs` / `audit-tokens.mjs` | 无 DESIGN.md | A 更强 |
| token 被内联字面量绕过 | **A 的问题**：391 处内联 `fontSize` 数字 vs 89 处 `var(--text-*)`；`var(--control-*)` 只被引用 10 次而内联 height 写的是梯度原值 | — | 见设计审查 P2 |

### 6.3 可访问性（细节见设计审查）

| 项 | A | B |
| --- | --- | --- |
| `aria-*` / `role` | 17 种约 470 处 / 24 种约 90 处（`alert` 23、`status` 21） | 14 种约 296 处 / 18 种约 42 处（`alert` 0） |
| 焦点管理 | **缺**：无焦点陷阱；`SettingsPanel` 声明了 `role=dialog aria-modal` 但组件内 `grep focus` 零命中 | 由 16 个 Radix 包承担 |
| 分隔条键盘可达 | **有**（`role="separator"` + `aria-valuenow` + ←→） | 仅 `onMouseDown` |
| reduced-motion | 7 CSS 块 + 6 处 JS 分支 | 仅 3 CSS 块，0 处 JS |
| 对比度实测 | **浅色三主题 `--text-dim` 仅 3.19–3.32:1、light 的 accent on panel 2.93:1（不达 AA）**；自带 `e2e/themes.mjs` 断言 `>=4.5` 但**是孤儿脚本且在 oklch 下必然 NaN 失败** | 未测（无对应脚本） |
| 触控目标 | `--control-touch: 44px` 定义但**零使用**，控件梯度最高 36px | 无移动端 |

### 6.4 性能工程

| 项 | A | B |
| --- | --- | --- |
| 动态 import | 4 处且命中热点（高亮器 ~1.5MB 移出首屏、FileViewer 子视图） | 仅 5 个次要窗口；主窗口 240 个 tsx **零** lazy/Suspense |
| 列表虚拟化 | 手写固定行高窗口化 | `@tanstack/react-virtual` 可变行高 |
| 请求去重/缓存 | 有（`lib/models-cache.ts` TTL + inFlight + generation；file-access 5s 缓存） | 无通用层（IPC + jotai） |
| 轮询 | 主动 2 处（running 2.5s、reconcile 15s），SSE 宽限 30s | 无运行态轮询（主进程推） |
| 节流防抖 | 以 rAF 为主（10+ 处） | 以防抖为主 |
| 错误重试/重连 | 分级重连 + 签名去重 + 半开连接对账 | 无对应 HTTP/SSE 重连层 |
| 性能诊断面板 | 无 | 有 `?perf=1` |

---

## 7. 「六大重点」在本矩阵中的位置

| 用户关切 | 矩阵结论一句话 | 优化文档章节 |
| --- | --- | --- |
| Markdown 预览慢 | 每条消息逐 delta 全量重解析 + 插件链比 B 重一倍 + 高亮“结束时一次性”；B 用 rAF 批处理 + 80ms 节流 + token LRU + 历史/live 分离 memo | §1（P0-1 / P0-2） |
| 打包 dmg/exe 后按钮失效 | 机制问题：Electron 只是本地 Next 服务的壳，按钮全是 HTTP；`mac.target` 只有 `dir`；漏 `afterPack` 或 allow-list 换目录就半残 | §2（P0 硬门禁 + 冒烟清单） |
| 文件树 | 有骨架：无虚拟化、无 watch 订阅（服务端 `type=watch` 已实现但前端没接）、逐目录 HTTP、每次刷新重拉 git status | §3 |
| 记忆 | 不是缺失：`pi-memory` 插件拥有记忆，本仓只有白名单面板；缺独立 UI / 周检邀请 / watcher | §4 |
| 定时任务 | 表达力**强于** B（真 cron + 时区 + idleWindow + 历史 + missed）；缺 B 的四个生命周期语义 | §5 |
| 思考过程展示 | 事件双轨与 LRU 懒加载都对；缺自动折叠、展开预取、流式期禁同步布局读 | §6 |

---

## 8. 三张清单

### 8.1 A 有、B 无 —— 不要为了“对齐 Proma”而删掉

1. 服务端消息分页 + 客户端窗口 + `deferThinking` / `deferMedia`（`context/route.ts:13-20`）
2. 分支导航器 + 分支可视化 + in-session 非破坏性多分支
3. worktree 分组 / 切换 / 创建 / 删除
4. 会话导出 HTML（含深链爆栈修补）
5. 自动压缩开关
6. 会话总活跃时长 + 跨压缩累计 token/成本
7. 外部进程改写会话文件的检测与 wrapper 重建
8. 会话内 bash 大输出按需拉取
9. 会话被文件引用保护
10. 手动会话状态标签（complete/interrupted/error/aborted/pending）
11. clone 会话
12. “编辑自此处”非破坏性改支
13. Markdown 保存 baseline 冲突检测 + diff3 三方合并（**B 是静默覆盖**）
14. 通用代码编辑器（CodeMirror 多语言）
15. 音视频内联预览
16. 文件树内上传（冲突三策略 + 进度 + 结果摘要 + 上传后引用）
17. Plugins / pi 包管理（安装/卸载/更新/启停/诊断）
18. skills.sh 搜索与安装、skill 更新检查
19. MCP 配置一键导入（Claude / Codex / Cursor / Windsurf / VS Code）
20. models.dev 价格目录 + `enabledModels` glob 作用域 + per-model 思考 pin
21. OAuth 手动码回填
22. Subagent profile（工具白名单、技能/扩展开关、模型与思考）
23. 真 cron 表达式 + 时区
24. 主/次区角色互换
25. 移动端完整体验（无宽度断点的 B 反而没有）
26. 壁纸 / 密度 / 边框深度 / 正文字号列宽 / 叠加 pi 主题引擎
27. 3 语言 i18n（1014 key）
28. Web 自托管（密码 + PWA + Web Push + Docker）
29. 请求缓存/去重层 + SSE 分级重连
30. token 审计 + 主题渲染核对（`audit-tokens.mjs`、`verify-themes.mjs`）

### 8.2 B 有、A 无 —— 候选搬运项（PR 见 GAP / DSN 族）

1. 会话内 Cmd+F 查找 + 标题命中 + 搜索命中定位
2. 自动命名（首条消息后，且不覆盖用户改名）
3. rewind 回退 / 探索分支带结论回主线 / 消息级重试
4. 原地编辑用户消息 / 重发 / 删除单条消息
5. 队列逐条撤回、删除、拖拽排序、立即发送
6. 快捷键中央注册表 + 录制 + 冲突检测 + 全局键
7. 输入区 WYSIWYG + `#`MCP/`&`会话/`~`待办引用 + 任意文件拖拽 + 超长文本转附件 + 附件降级为路径
8. 多根文件树 + 作用域徽标 + 行操作菜单（重命名/删除/移动/批量/多选）+ 粘性目录行 + 搜索定位 + 空目录重试
9. XLSX / PPTX 预览、不可预览降级卡片、预览内查找、Markdown TOC、图片/PDF 缩放、独立预览窗
10. 改动面板（分仓库/目录分组、来源徽标、未查看标记、非 git 改动、改动搜索、逐文件撤销、worktree 基准）
11. Agent 终端工具 + 终端快照 API
12. 受管浏览器（CDP + agent 工具 + 链接路由 + 本地 HTML token 预览）
13. MCP 握手验证 + OAuth PKCE + 凭据加密 + 内置集成目录 + agent 自管
14. Skill 子文件编辑 + 跨工作区导入导出 + 17 个内置技能
15. 委派阻塞冒泡 + 委派工具补全
16. 定时任务四件（会话复用/毕业、失败暂停、maxRuns、超时+通知）+ Agent 自建工具
17. Planning 全套（Todo 持久化 + 日程 + 提醒 + 25 个 agent 工具 + 删除类二次确认）
18. 记忆变更 watcher + 3 天周检邀请 + 独立记忆窗口 + 初始化引导
19. 附加目录模型（会话级 + 工作区级）+ AGENTS.md 双层 + 项目根健康检测
20. 渠道 API Key 加密存储 + 代理设置 UI
21. 桌面壳增强：启动闪屏、多窗口、托盘会话菜单、提示音库、空闲安装自动更新、存储管理、`?perf=1` 诊断
22. 每 tab 错误边界、Ctrl+Tab MRU、tab 悬浮预览、右栏真分屏

### 8.3 双方都没有（避免“因为 Proma 有所以补”）

1. 消息级 tps（tokens/秒）
2. 回退同时恢复文件内容（B 明确 `canRewind: false` 且有契约测试）
3. 会话分享链接 / 云端分享
4. 消息树（DAG）可视化画布
5. 导出 PDF / DOCX 等文档格式
6. 会话列表的自定义文件夹分组（两边都只按项目/工作区自动分组）
7. 同一条消息多次编辑历史的 diff 视图
8. 文件树虚拟化、文件复制/粘贴、批量重命名
9. tab 拖拽排序（B 的代码是残留）
10. 多模型并行调用

---

## 附录 · 调研可信度与未决项

子任务**自己标注**的不确定点（未被我二次核验，引用时请留意）：

| # | 不确定点 | 来源 |
| --- | --- | --- |
| 1 | Proma `tool-result-renderers/` 下每个渲染器的分页能力未逐文件核 | 会话域 |
| 2 | Proma `LeftSidebar.tsx`（5095 行）与 `SessionMiniMapPopover.tsx` 交互分支未穷举 | 会话域 |
| 3 | Proma 自动重试的**主进程**写入点未定位（只确认渲染层状态机） | 输入域 |
| 4 | Proma 是否在主进程做图片压缩未核（故只判 A 的客户端压缩独有） | 输入域 |
| 5 | Proma 内部快捷键文档不一致（`tips.ts:44` 写 ⌘.，`shortcut-defaults.ts:145` 是 ⌘⇧⌫） | 输入域 |
| 6 | Proma `browser-controller.ts`（1815 行）与 `git-diff-service.ts`（1060 行）以函数签名定位，未逐行确认 | 文件域 |
| 7 | Proma 的 bundle 体积**无法实测**（`apps/electron/dist` 不存在，完整构建需 node-pty rebuild） | 布局域 |
| 8 | Proma 的 tab 拖拽排序是“重构未完成”还是“主动移除”无法从代码判定 | 布局域 |
| 9 | Proma `default-mcp.json` 当前 `servers: []`，历史内置 MCP 需回看 release notes | 平台域 |
| 10 | `pi-memory` 的注入实现不在本仓（外部 npm 包） | 平台域 |
| 11 | 本仓 `.next` 为 dev+prod 混合缓存，chunk 体积不等于首屏传输量 | 布局域 |

**已由我二次核验并修正的点（✅）**：

- 自动命名：A 确为**手动按钮**触发，无首条消息后自动触发（`AppShell.tsx:1027-1054` 唯一入口）。
- 会话内查找、消息删除/重发：A 确无实现（`grep` 零命中）。
- 对比度：改为**浏览器实测值**（canvas 填充读回像素），并发现自带的 AA 门禁是孤儿脚本 + oklch 下必失败。
- `detect` 的 em-dash 与 numbered-section-markers 误报，已用计数（U+2014=3 vs `--`=1211）定量证明。
- impeccable 版本：本机存在 2.3.2 与 4.1.0 两份，`skills install` 行为不同（详见设计审查 §0.1）。
