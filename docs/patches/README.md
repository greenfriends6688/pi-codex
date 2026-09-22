# 功能补丁台账（fork patches）

本目录记录本 fork 相对上游 `@agegr/pi-web` 的**功能类**改动。

与皮肤台账 [`../codex-skin/delta.md`](../codex-skin/delta.md) 的分工：

| 台账 | 管什么 | 冲突策略 |
| --- | --- | --- |
| `docs/codex-skin/delta.md` | 皮肤 / 布局 / CSS token | 皮肤冲突按台账重打 |
| `docs/patches/*.md`（本目录） | **功能**改动（新增能力、行为变化） | 逻辑冲突一律取上游，再按本文档重接 |

## 约定

1. **一个补丁 = 一个意图**，可独立 revert，自带测试。
2. **优先新增文件**：新能力放进新的 `lib/*.ts`、`app/api/*/route.ts`、`components/*.tsx`，
   上游文件只留「接线」级别的改动。
3. **上游文件的每处改动都带 `fork:<补丁名>` 标记**，例如 `// fork:chat-workspace`。
   合并上游后 `grep -rn "fork:chat-workspace" <file>` 即可拿到完整改动清单。
4. 每个补丁产出一份 `NNNN-<name>.patch`（unified diff）+ 一份说明 `.md`。
   > `.patch` 是在 fork 已经带上其余功能改动的树上生成的，**不保证** `git apply -p1` 直接落到
   > 干净的上游 / `main` 树上：hunk 的上下文行里可能带着其他补丁引入的代码。
   > 合并上游后重打时以 `fork:<补丁名>` 标记为准，`.patch` 只作对照。
5. 合并上游后按本目录的说明逐条重打，然后跑完整 DoD：
   `tsc --noEmit` → `npm run lint` → `npm test`。

## 补丁索引

| 编号 | 名称 | 状态 | 上游文件接触面 |
| --- | --- | --- | --- |
| 0001 | [独立聊天工作区（不在项目中的对话）](./0001-chat-workspace.md) | 已实现（待运行时验收） | 8 个文件，均为接线级改动 |
| 0002 | [`?session=` 会话恢复竞态](./0002-session-url-restore.md) | 已实现（含新单测 + 浏览器验证） | 1 个文件（3 处） |
| 0003 | [行内引用体系（`&` 会话 / `#` MCP / `~` 待办）](./0003-composer-references.md) | 已实现（含 20+ 单测 + 浏览器冒烟） | 6 个文件，均为接线级改动 |
| 0004 | [Windows 上 `npm run prod` / `dev:clean` 静默失败](./0004-windows-next-mode.md) | 已实现（Windows 实测） | 无（本仓脚本） |
| 0005 | [附件模型：任意文件 + 上传上限 + 超限降级为路径引用](./0005-composer-attachments.md) | 已实现（含 15 单测 + 浏览器冒烟） | 8 个文件，均为接线级改动 |
| 0006 | [队列逐条操控（撤回 / 删除 / 拖拽排序 / 立即发送）](./0006-queue-controls.md) | 已实现（含 11 单测 + 端到端交付顺序验证） | 7 个文件，均为接线级改动 |
| 0007 | [DSN-07 收尾：内联字号全部收口到 token](./0007-typography-tokens.md) | 已实现（DSN-07 完成，带全仓守卫） | 10 个文件，均加一行 import + 字号换 token |
| 0008 | [文件树：多根 + 作用域徽标 + 三个细节](./0008-file-tree-roots.md) | 已实现（GAP-08/10，含 13 单测 + 浏览器冒烟） | 6 个文件，均为接线级改动 |
| 0009 | [工具审批 + 权限档位 + 计划模式（PROMA-01/02/03）](./0009-permission-and-plan.md) | 已实现（含 32 单测 + 浏览器/端到端实测；`.patch` 已补） | 6 个文件，均为接线级改动 |
| 0010 | [会话回退「回退到此处」（PROMA-04）](./0010-session-rewind.md) | 已实现（含 9 单测 + 浏览器/端到端实测） | 5 个文件，均为接线级改动 |
| 0011 | [过程显示实时时间线](./0011-process-live-timeline.md) | 已实现（3 单测 + 浏览器截图实测）；**无 `.patch`**（无编辑记录可反演） | 1 个文件 |
| 0012 | [待办清单实时化 + 面板改版](./0012-todo-live.md) | 已实现（5 + 10 单测 + 浏览器截图实测）；**无 `.patch`** | 4 个文件 |
| 0013 | [定时任务模型下拉只剩「默认」](./0013-cron-model-list.md) | 已实现（3 单测 + 浏览器截图实测）；**无 `.patch`** | 4 个文件 |
| 0014 | [dev 热更新后陈旧 wrapper 自愈](./0014-fix-stale-wrapper.md) | 已实现（dev 实测；无单测） | 1 个文件 |
| 0015 | [探索分支 + 结论带回主线（PROMA-05）](./0015-exploration.md) | 已实现（9 单测 + 浏览器冒烟 7 项；含右栏并排只读 tab） | 6 个文件 |
| 0016 | [子会话「没跑完」显示为已中断（PROMA-06 之一）](./0016-subagent-status.md) | 已实现（5 单测 + 浏览器冒烟 4 项）；阻塞冒泡待做 | 4 个文件 |
| 0017 | [dev 服务看门狗](./0017-dev-watchdog.md) | 已实现（真杀真拉：5 秒恢复） | 无（纯新增脚本） |
| 0018 | [命令环境测试的平台修正](./0018-command-env-test-platform.md) | 已实现（修掉 Windows 假失败，7/7） | 1 个文件（测试） |
| 0019 | [过程步骤里的文件 chip 不再是嵌套 `<button>`](./0019-fix-nested-button.md) | 已实现（3 源码守卫 + 浏览器校验脚本） | 1 个文件 |
| ~~0020~~ | ~~ZC-01 命令面板（⌘K）~~ | **已按用户要求移除**（2026-09-21）：用户判定它与顶栏按钮/侧栏搜索重复。删掉 4 个文件（含 17 单测）、AppShell 接线、9 个 i18n key、快捷键表里的 ⌘K 只读行 | — |
| 0021 | ZC-02 会话内查找（⌘F，计数/步进/高亮） | 已实现（14 单测 + 浏览器实测 4 项）；**含交付后深修**：命中展开四根因（渲染窗口/过程组 reveal/toolResult blockIndex/ToolBody 透传），画出命中 2→15 | 4 个文件（ChatWindow 多处、MessageView、ProcessGroup、conversation-find） |
| 0022 | ZC-06 右栏 tab 概览 + 最近关闭 | 已实现（12 单测 + 浏览器实测 5 项） | 2 个文件，均接线级 |
| 0023 | ZC-18 MCP OAuth 入口（复制 `/mcp-auth <server>`） | 已实现（5 单测，含注入用例） | 2 个文件，均接线级 |
| 0024 | ZM-01 折叠动效（`grid-template-rows` 0fr↔1fr + 两段式挂载） | 已实现（6 单测 + 浏览器实测展开/收起双向） | 2 个文件 |

> 0020–0024 来自 `docs/zcode-comparison-2026-09-21.md` / `docs/zcode-pr-plan-2026-09-21.md`。
> 它们的 `.patch` **未生成**：本仓现在有 git（不像 0011–0013 那个时期），重打以 `fork:<slug>` 标记为准，
> 需要 diff 时直接 `git diff <base> -- <file>` 即可，无需再走 `scripts/fork-patch.mjs` 的分阶段基线。
> slug 对应：`fork:zc-01` / `fork:zc-02` / `fork:zc-06` / `fork:zc-18` / `fork:zm-01`。

### 第二批（ZCode 借鉴项全部落地，0025–0046）

同一次交付里把计划中剩余的 22 项一次做完。每个补丁的完整规格仍在
`docs/zcode-pr-plan-2026-09-21.md`；下面只记「做了什么 / 落在哪里 / 验到什么程度」。

| 编号 | 名称 | 状态 | 新增文件（T0） | 上游接触面（T1） |
| --- | --- | --- | --- | --- |
| 0025 | ZC-03 本地用量统计 | 已实现（单测 15 + 浏览器实测分区在） | `lib/usage-stats.ts`、`app/api/usage-stats/route.ts`、`fork/UsageStatsPanel.tsx`、`fork/usage-charts.tsx` | `SettingsPanel.tsx`、`settings-navigation.ts` |
| 0026 | ZC-04 快捷键内核 + 设置表 | 已实现（单测 15 + 分区在；⌘K/⌘F 以只读行展示，未改注册方） | `lib/shortcuts.ts`、`hooks/useShortcutBindings.ts`、`fork/ShortcutsSettings.tsx` | `useKeyboardShortcuts.ts`、`SettingsPanel.tsx` |
| ~~0027~~ | ~~ZC-05 Git 变更面板~~ | **已按用户要求移除**（2026-09-21）：面板与路由整删（`fork/GitChangesPane.tsx`、`app/api/git/changes/route.ts`）、pane 专用导出与 4 条测试、AppShell tab 接线、TabBar/TabOverview 的 `changes` kind 与图标、16 个 i18n key。**保留 `lib/git-changes.ts` 的共享基础层**（`git()` / `findRepositoryRoot()` / `getGitStatus()` / `getGitFileDiff()`）—— 文件树状态色、git 图、查看器 diff 都依赖它 | — |
| 0028 | ZC-07 词级行内 diff | 已实现（单测含长行回退与 CJK） | `lib/diff-intraline.ts` | `MessageView.tsx`、`FileViewer.tsx` |
| 0029 | ZC-08 附件预览扩展 | 已实现（单测 + 类型分类） | `fork/AttachmentPreview.tsx` | `ChatInput.tsx`、`composer-attachments.ts` |
| ~~0030~~ | ~~ZC-10 计划文档侧栏~~ | **已按用户要求移除**（2026-09-21）：计划正文本来就在聊天里，切档已有 composer 档位按钮。删 `lib/plan-document.ts`（+9 单测）、`fork/PlanPane.tsx`、ChatWindow 的计划广播与权限事件监听、AppShell 的 tab 接线与自动展示、8 个 i18n key | — |
| 0031 | ZC-11 侧栏用户分组 + 拖拽 | 已实现（单测 16 + 浏览器实测入口） | `lib/session-groups.ts`、`fork/GroupedProjectList.tsx` | `SessionSidebar.tsx` |
| 0032 | ZC-12 CSV/TSV 表格预览 | 已实现（单测 + 浏览器实测真实 csv 渲染） | `lib/csv-preview.ts`、`fork/CsvPreview.tsx` | `FileViewer.tsx`、`file-preview-support.ts` |
| ~~0033~~ | ~~ZC-13 模型轨迹（近似快照）~~ | **已按用户要求移除**（2026-09-21）：聊天里已有消息，系统提示/工具定义已有专门弹层。删 `lib/model-trajectory.ts`（+13 单测）、`fork/ModelTrajectoryPane.tsx`（+2 单测）、ChatWindow 的面板与懒加载触发、AppShell 顶栏入口与 props、35 个 i18n key、`fork:zc-13` 的 51 条 CSS 选择器 | — |
| 0034 | ZC-14 cron 运行历史 | 已实现（单测 + 分区在） | `lib/cron-history.ts` | `lib/cron-*.ts`、`fork/CronConfig.tsx`、`app/api/cron/route.ts` |
| ~~0035~~ | ~~ZC-15 设置搜索覆盖全分区~~ | **已按用户要求移除**（2026-09-21）：连上游原有的搜索框一起删（用户判定与命令面板重复）。删掉 entry index、两个搜索函数、搜索 UI、18 处 `data-settings-entry` 锚点、4 个 i18n key、7 条死 CSS | — |
| 0036 | ZC-16 自定义命令管理 | 已实现（单测含 frontmatter 保留与越界拒绝） | `lib/prompt-files.ts`、`app/api/prompts/route.ts`、`fork/PromptsConfig.tsx` | `SettingsPanel.tsx` |
| 0037 | ZC-17 空状态引导 | 已实现（三条起步路径 + 复用 recent-projects） | `fork/EmptyStateGuide.tsx` | `ChatWindow.tsx` |
| 0038 | ZC-19 cron 引擎健壮性 | 已实现（单测含错过/单飞/退避/规则往返一致） | `lib/cron-rule.ts`、`lib/cron-failure.ts` | `lib/cron-*.ts`、`fork/CronConfig.tsx` |
| 0039 | ZC-20 记忆目录视图 | 已实现（单测含穿越/符号链接逃逸拒绝） | `lib/memory-catalog.ts` | `fork/PiMemoryConfig.tsx`、`app/api/memory/files/route.ts`（GET 读取面 + catalog） |
| 0040 | ZC-21 cron 的 agent 工具 | 已实现（单测含递归护栏与窄更新面） | `lib/cron-extension.ts` | `lib/rpc-manager.ts`（注册 2 处） |
| 0041 | ZM-02 流式入场 + 逐条 stagger | 已实现（单测 9 + 源码守卫） | `lib/stream-enter-memory.ts` | `ProcessGroup.tsx`、`app/fork-ui.css` |
| 0042 | ZM-03 滚动正确性 + 渐隐遮罩 | 已实现（单测 + 浏览器实测遮罩状态随滚动切换） | `lib/scroll-follow.ts`、`fork/ScrollFadeViewport.tsx` | `ChatWindow.tsx`、`app/fork-ui.css`（删除死规则 `.fork-scroll-fade-b`） |
| 0043 | ZM-04 倒计时条 + 数字滚动 | 已实现（单测含 reduced-motion 静态文本） | `fork/RollingNumber.tsx` | `ChatWindow.tsx`、`SessionStatsBar.tsx` |
| 0044 | ZM-05 TabBar 滑动指示器 | 已实现（源码守卫 5 条 + 浏览器实测已挂载） | — | `TabBar.tsx`、`app/fork-ui.css` |
| 0045 | ZM-06 FLIP 列表重排 | 已实现（单测 10） | `lib/flip-animate.ts` | `SessionSidebar.tsx`、`fork/GroupedProjectList.tsx` |
| 0046 | ZM-07 等待态状态行 | 已实现（单测含队列上限/迟到丢积压） | `fork/PhaseRoll.tsx` | `ChatWindow.tsx` |

**门禁（本次交付）**：`tsc --noEmit` 退出码 0 · `npm test` **2034/2034** · `npm run lint` **0 error**（250 warning 全为既有）·
`npm run prod` 构建成功 · 浏览器实测 **13/14 项通过**（唯一失败项是我自己写错了属性名，复测通过）· 页面零错误。

**用户验收后的移除（2026-09-21）**：用户复核时判定 **命令面板（ZC-01）** 与 **设置搜索（ZC-15）**
属于重复入口 —— 命令面板的「动作」组镜像顶栏按钮、会话/文件组与侧栏搜索重叠；设置搜索与命令面板
都在做「打字找东西」。两项**整块移除**，共删 4 个源文件、17 + 14 条单测、13 个 i18n key、18 处锚点、7 条 CSS。

> 移除时的教训记在这里：批量删属性时用 `re.sub` 匹配 `key={...}` 会误伤**模板字符串键**
> （`` key={`a-${b}`} `` 里 `${b}` 的 `}` 会让 `[^}]*` 提前收尾）。本次因此弄坏了 12 处 JSX
> 键与 1 处属性，靠 tsc 全量报错逐个修回。**动 JSX 属性的批量脚本必须按括号/反引号配对扫描，
> 不能靠 `[^}]*` 这类近似正则。**

**用户验收后的第二次移除（2026-09-21）**：用户看截图后判定**模型轨迹 / 计划 / 变更**三个右栏面板重复
（轨迹 = 聊天 + 两个弹层；计划 = 聊天正文 + composer 档位按钮；变更 = 文件树状态色 + 查看器 diff），
三项**整块移除**：删 8 个源文件、24 条单测、59 个 i18n key、51 条 CSS 选择器。

> ⚠️ **`lib/git-changes.ts` 不能整删**：GIT-DIFF 代理把**既有 git 基础层**（`git()` / `findRepositoryRoot()` /
> `getGitStatus()` / `getGitFileDiff()`）也搬进了这个文件，文件树的 git 状态色、git 图、查看器 diff 全依赖它。
> 本次只删了 pane 专用的那半（`getGitChanges` / `getGitFileDiffForSource` / 分组排序纯函数）。
> **教训：删「某功能新增的模块」前，先按导出逐个查外部使用者，别按文件名判断归属。**

**集成阶段拆掉的一处症状级补丁**：ZC-04 原先是用 CSS 选择器去 DOM 里找顶栏按钮再 `.click()` 来切换
侧栏/右栏（当时 `AppShell.tsx` 归另一个补丁所有）。集成时 AppShell 已空闲，于是改成 AppShell 直接把
`handleSidebarToggle` / `handleRightPanelToggle` 传给快捷键层，**选择器与 `clickFirstAvailable` 全部删除**
（`hooks/useKeyboardShortcuts.ts` 里 DOM 查询归零）。实测 ⌘B / ⌥⌘B / ⇧⌘L 三项均生效。

**两处仍需知道的技术债**（已写进代码注释）：
1. **ZM-03 的 `container.scrollTo` 拦截是症状级补丁**。根因在 `hooks/useAgentSession.ts` 的
   `isNearBottomRef`：它由 `scroll` 事件驱动，因而把程序化滚动也当成了用户意图。正确做法是让
   live-follow 只被用户输入（wheel/touch/键盘）改变；当时改动那个 hook 的风险高于它修的问题，
   所以保留拦截并在此记账。
2. **ZC-13 是近似快照**。SDK 确实有 `before_provider_request` 事件携带最终请求体
   （`dist/core/extensions/types.d.ts:519`），但只对进程内扩展可见，pi-web 未捕获。
   要做成真实请求体需在 `lib/rpc-manager.ts` 注册扩展 + 服务端环形缓冲 + 新 SSE 事件。
   当前 UI 已用 `data-trajectory-approximation="true"` 和一行说明明确标注。

**未做（有意）**：ZC-09 多会话分屏。计划的判定是「先 spike，不通过就砍」——
`sessionId` 单值贯穿 `useAgentSession`（SSE/流式/草稿/滚动），两 pane = 两份独立实例 + 两套 SSE，
不是加一层 CSS grid 能解决的；PROMA 计划也早已判定方向相反（`proma-pr-plan:953`）。

## 工具：没有版本控制时怎么产出 `.patch`

本机的树是从 macOS 拷过来的，**没有 `.git`，也没有 `git` / `diff` / `python`**
（`docs/proma-prs-2026-09-18.md` 附录 E.2 已记录）。而本目录要求每个补丁产出一份 unified diff，
于是仓内自带一个零依赖实现：

```bash
# 生成：改前 / 改后两个文件 → unified diff（可多文件拼接，用 --out 写文件）
node scripts/fork-patch.mjs --old <旧> --new <新> --path <仓库相对路径> --out docs/patches/000N-x.patch

# 自检：LCS diff 的边界用例 + 往返（生成后再应用回去必须逐字节等于新文件）
node scripts/fork-patch.mjs --selftest

# 回滚 / 前滚：把补丁应用到工作树（--check 只看会不会改）
node scripts/fork-patch.mjs --apply docs/patches/0003-composer-references.patch --check
node scripts/fork-patch.mjs --apply docs/patches/0003-composer-references.patch
```

约定：`--- a/<path>` 的路径相对 `--root`（默认当前目录），新增文件的目标不存在时按空文件处理；
上下文不匹配就**报错退出**，不做“猜着改”。

### 基线要分阶段

一个文件可能被多个补丁改过（`components/ChatInput.tsx` 先后被 0003、0005 改）。
补丁 0003 的「改前」必须是**两个补丁都没打**的样子，0005 的「改前」必须是**只打了 0003** 的样子；
而每个 `.patch` 的「改后」也**不是当前文件**，而是下一个阶段的基线 —— 否则 0003 的
`.patch` 会把 0005 的改动一起打包进去。

本仓的做法：`test-results/build-baseline.mjs`（一次性工具）按阶段**倒序**反推，每退一层存一份
`test-results/fork-patch-baseline/<阶段>/<路径>`，`test-results/make-patches.mjs` 再据此生成补丁并跑三项校验：

1. 基线能被 TS 解析（反推出的语法错误 = hunk 的“改前”是假的）；
2. `apply(基线, 该补丁 diff)` 逐字节等于该补丁的「改后」；
3. 从最早基线依次打上各阶段补丁，**等于当前文件**（台账能当回滚/前滚依据的前提）。

这两个脚本放在 gitignored 的 `test-results/` 下（一次性工具）；`--selftest` 则在仓内的
`scripts/fork-patch.mjs` 里，随时可跑。

### 忘了快照怎么办：从会话记录反演

0009/0010 是回头补的（当时没先跑 `snapshot-stage.mjs`）。补法不是手写反演锚点，而是拿 pi 会话文件里
每次 `edit` 的 `oldText`/`newText`，按时间**倒序**把 `newText` 换回 `oldText` —— 每步要求唯一匹配，
对不上就跳过（记录里混有实际未生效的 op），再用「基线里不能有本补丁的 `fork:` 标记」「基线必须能解析」
「连续重复行扫描」三条兜底，最后只留 2 处人工修正。

一致性证明：把新阶段挂进 `make-patches.mjs` 后重跑，**已入库的 `0002–0008` 必须逐字节不变** ——
变了就说明新反演的基线跟原链条不兼容。

工具：`test-results/build-baseline-0009-0010.mjs`、`check-baselines.mjs`、`scan-baseline-artifacts.mjs`。
**新补丁一律先 `node test-results/snapshot-stage.mjs <编号> <文件...>` 再动手改。**
