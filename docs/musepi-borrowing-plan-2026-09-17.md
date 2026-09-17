# MusePi 逐项对比与借鉴清单（功能 / 布局 / 视觉 / 按钮级）

分析日期：2026-09-17
基准：本仓库 `@agegr/pi-web` 0.9.1 · Codex 皮肤 fork（Next.js 16 App Router + 进程内 pi SDK）
对象：`pi参考项目/MusePi-main`（MusePi **0.4.16**，Electron GUI + Bun/TS monorepo + 7 个 Rust crate）

> 本文回答一个问题：**照着 MusePi 读一遍代码，我们这里有哪些按钮、哪些样式、哪些交互纪律可以搬过来，搬到哪个文件，多大代价，会不会撞 Codex 皮肤纪律。**
> 结论集中在 §4 的 `MU-01…MU-33`，每条都能独立合入、独立回滚。
> 新增功能：**定时任务**、**记忆**（见 `codex-skin/delta.md` §25，SDK 两者都没有，均在 pi-web 侧实现）。
> 落地进度：**MU-32 / MU-01 / MU-02 / MU-21 / MU-33 / MU-15 / MU-14 / MU-19 / MU-20 / MU-22 / MU-30 / MU-09 / MU-27 已实现，MU-28 部分**（`components/fork/ProjectChip.tsx` + 接线，见 `codex-skin/delta.md` §21）。

---

## 0. 与既有文档的分工

| 文档 | 管什么 | 本文是否重复 |
| --- | --- | --- |
| [`ref-projects-comparison-2026-09-16.md`](./ref-projects-comparison-2026-09-16.md) | 四个参考项目的**粗粒度**对比（MusePi 只占一节） | 本文把 MusePi 那一节**展开到组件/按钮/样式级** |
| [`desktop-ui-borrowing-plan-2026-09-16.md`](./desktop-ui-borrowing-plan-2026-09-16.md) | `pi-web-desktop` 深度借鉴 | 不重叠（不同仓库、不同接触面） |
| [`ui-layout-pr-plan-2026-09-17.md`](./ui-layout-pr-plan-2026-09-17.md) | 布局与样式的「挪位置 / 改样式」（UI-01…UI-14） | 互补：那份管**东西放哪**，本文管**东西长什么样、点了会怎样**；去重见 §4.9 |
| [`codex-skin/delta.md`](./codex-skin/delta.md) | 皮肤改动台账 | 本轮落地按它的格式登记 |
| [`patches/README.md`](./patches/README.md) | `fork:` 标记约定 | 本文全部建议沿用同一套标记 |

**本文新增（既有文档未覆盖）**：按钮级全量对照表、MusePi 的动效令牌与浮层纪律、morphicons/两段式入场、悬浮状态卡、轮次折叠、划词工具条、三态发送键、命令面板、Todo/队列/pause 的 UI 点位、以及「哪些**不要**抄」的冲突清单。

---

## 1. 形态差异：先看清骨架，别照抄

| 维度 | 本仓库 pi-web 0.9.1 | MusePi 0.4.16 | 结论 |
| --- | --- | --- | --- |
| 形态 | **浏览器/单页**（Next.js App Router，URL 即状态） | **Electron 桌面应用**（Vite 纯 SPA）+ daemon + 手机端 + TUI | 骨架不通用 |
| 引擎连接 | **进程内嵌 pi SDK**（`lib/rpc-manager.ts`，一进程一会话包装器） | 独立 daemon，WebSocket JSON-RPC，多客户端并发 | 本文不搬架构，只搬 UI |
| 窗口 | 浏览器窗口；侧栏 / 主区 / 右栏**共边**、可拖拽分隔 | 无边框窗口 + **玻璃背景 + 8px gutter 的圆角卡片**（`.gui-float-card`，`gui-chat.css:329`） | 卡片骨架**不抄**（会推翻现有分栏几何） |
| 主区结构 | 聊天 + 悬浮 minimap + 扩展状态条 | Chat ↔ **Canvas 双轴**（同一棵 entry 树既可当 transcript 也可当会话树地图） | Canvas 列为 P2 |
| 右栏 | `TabBar` 管 `file / terminal / browser` 三类标签 + 独立 `.explorer-column` | 44px **图标 rail** + surface 注册表（8 内置 + 扩展槽 15+），宽度 260–1200 + snap points + maximize | 借 rail 分组/溢出，不换骨架 |
| 设置 | 模态 1080×84vh + 左列导航 184px + 5 分区**手写控件** | 全窗口替换 + 左列导航 + **28 个分区**，其中 336 项**由 daemon schema 驱动** | 借「搜索 + 匹配高亮」，schema 化不做 |
| 空态 | `components/fork/NewSessionHome.tsx`：hero + 4 张 starter 卡 | `WelcomeComposer`：点阵品牌图 + 8 个建议 chip + 实时提醒面板 | 借 chips 行 |
| 正文排版 | 系统 sans，13px（`--chat-content-font-size`） | **衬线正文**（Source Serif 4）+ Maple Mono NF CN，14px | 只借「正文/壳层字号解耦」，字体不换 |
| 主题 | 6 套 Codex 调色板 + pi 主题 JSON 叠加 + 壁纸（已领先） | 4 条正交轴（theme × ui-theme 18 套 × accent × platform）+ 560ms 磨皮翻转仪式 | 借动效与令牌，**不借多主题体系** |
| 图标 | 自绘 SVG + token 化 CSS | `lucide-react` + `morphicons`（图标形变）+ oc-icons sprite | 不引库；借「图标形变」的轻量替代 |
| 玻璃 | 壁纸层 + 分区 scrim/blur（wallpaper.css） | 单层 `backdrop-filter` + 实色卡片 + 平台降级 | 借**两段式入场纪律**（§2.7） |
| 键盘 | 只有 `Esc` / `Ctrl+Alt+N`（`hooks/useKeyboardShortcuts.ts`） | 15 条窗口级 + 各组件局部 + **设置里有快捷键表** | 差距最大的一块，见 §2.12 |

**一句话**：MusePi 值得抄的是**交互细节、动效纪律、组件规范和功能点位**；它的窗口骨架、多主题、玻璃卡片属于它自己的产品形态。

---

## 2. 逐区域对比

每节固定四段：**我 /
MusePi 的做法（带 file:line）/
可借鉴（落到哪个文件）/
不跟（以及为什么）**。

### 2.1 外壳与窗口 chrome

* **我**：`.app-shell-layout` 三区 flex；≥960px `main-panels` 三轨 grid + 拖拽改 track；641–959 右区浮层 560px；≤640 抽屉 + 全屏；工作区可**互换角色**（`workspace-swapped` + `inert` + `aria-hidden`，`AppShell.tsx:2268-2272`）。这一点**我们领先**。

* **MusePi**：`gui-shell` flex → `gui-main`（唯一的 `backdrop-filter` 层，`gui-chat.css:394`）+ `--gui-card-gutter: 8px`；每个 pane 都是圆角卡（`gui-chat.css:12, 5047-5056`）；平台分支 `[data-platform="win32"] .gui-main { backdrop-filter: none }`（`gui-chrome.css:186-215`）。

* **可借鉴**：无（骨架层）。只有一个小点：**窗口级&#x20;**`--gui-card-gutter`**&#x20;单一变量**统一所有 pane 外边距——我们的边距散落在各组件 inline style，`fork-ui.css` 里可加 `--pane-gutter` 但收益有限，可选。

* **不跟**：玻璃卡片工作区、无边框拖拽区（我们没有原生标题栏，Electron 壳由 `pi-web-desktop` 负责）。

### 2.2 顶栏

* **我**（46px，`AppShell.tsx:2273`）：会话标题 + 统计胶囊 + Full history + Generate title + Agents + Branches + 系统提示 + 工具定义 + `⋯` + 边界三键（侧栏开关 / 面板开关 / 角色交换）。功能不少但**全是常驻图标**。

* **MusePi**（48px，`GuiHeader.tsx:612`）：

  * 左：侧栏开关 + **项目动作胶囊**（`scan-2` 自动发现 dev server → `stop` → `loader-4`；`global` 打开预览；下拉 `add new action` / `auto discover` / `no dev script`，`GuiHeader.tsx:635-735`）。

  * 中：标题即**会话切换器**（点开=最近 10 个会话 + `new session`，`GuiHeader.tsx:748-846`）+ `⋯`（rename / copy session id / share / export markdown / move to new worktree / archive / delete，`:846-935`）。

  * 右：**两级暂停**（本会话 `pause all agents` + 全局 `pause all sessions`，带 `mm:ss` 计时，`:938-980`）、终端开关、看板、右栏开关、**迷你聊天 PiP**（`:1013`）、Open-in 外部 App 胶囊（`:1023-1116`）、实例/远端切换器（`:1140-1355`）。

* **可借鉴**：

  1. **标题即切换器**：我这里的会话标题是纯文本，点击无行为。MusePi 把它做成「最近会话 + 新建」下拉（`GuiHeader.tsx:748`）。落到 `AppShell.tsx` 的 `.main-workspace-header`，复用已有的 `ContextMenu`/`SessionSearch` 数据源；T1。

  2. **项目动作胶囊**：`package.json` 里读 `dev` 脚本 → 一键起/停 dev server + 打开预览。我们没有，但和 `app/api/terminal` 现有能力同构（T1，需后端 30 行）。

  3. **会话&#x20;**`⋯`**&#x20;里的&#x20;**`export markdown`：MusePi 直接导出 `.md`（`GuiHeader.tsx:895`）。我们有 `/api/sessions/[id]/export`（HTML），补一个 markdown 分支成本很低。

* **不跟**：全局暂停（我们没有 daemon 级 gate，属功能不属 UI）、迷你聊天 PiP（Electron 独有）、Open-in 外部 App（桌面端才有）、远端实例切换器（我们没有多 host）。

### 2.3 侧栏

* **我**（`SessionSidebar.tsx`，默认 244px）：品牌头 + 搜索开关 + New task + worktree 下拉 + Projects 分区（`⋯` / `+`）+ 会话行（展开子代理 / rename / delete）+ 归档区 + 底部三键（模型 / 技能 / 设置，已图标化）+ 右键菜单（Pin / Archive / Copy reference，`SessionRowContextMenuBridge.tsx:37,50,64`）。

* **MusePi**（`SessionSidebar.tsx`，可折叠 0↔256，拖拽 180–420）：

  * **5 个主入口常驻**：`new task`(⌘N) / `search`(⌘K) / `scheduled tasks` / `board` / `agents center` / `extensions`（`:474-520`）。

  * **groups ↔ projects 双 tab**（胶囊滑动 thumb，`:535-551`），右侧簇：`search sessions… (⌘F)` / `expand or collapse all` / `new group` / `view and sort`（`by project` / `timeline` + `sort by updated/created`）/ `archive`（`:556-638`）。

  * **会话行状态系统**：状态点（complete / interrupted / error / aborted / pending）、进行中 spinner、暂停 icon、fork 标记、未读点、手工 tag（`SessionList.tsx:234-252`）；右键菜单含 `tag complete/interrupted/error/aborted/pending` + `clear tag` + `copy path` + `copy session id` + `open in finder`（`:1198-1262`）。

  * 分组右键：`rename group` / `group color {color}`（`GROUP_COLORS`）/ `delete group`（`:1276-1295`）。

  * 底部：`本地守护进程` 状态灯 + `settings` + `mobile remote control` + `Disconnect`（`:1147-1172`）。

* **可借鉴**：

  1. **会话行状态点 + 手打 tag**（`:1198-1262`）：我们现在只有「运行中/未读」两个徽标。状态点方案（5 种语义色 + 手动 tag）落到 `SessionSidebar.tsx` + `SessionRowContextMenuBridge.tsx`，存储层已经有 `lib/session-flags.ts`（pin/archive 的 localStorage 模式可复用）。**MU-10**。

  2. **视图与排序菜单**（`by project` / `timeline`，`sort by updated/created`）：我们只有默认树。低成本（纯前端排序 + 一个 `ContextMenu`）。

  3. `expand or collapse all`：我们有每项目独立展开（`SessionSidebar.tsx:508` 的 ponytail 注释），补一个「全部展开/收起」很便宜。

  4. `copy path`**&#x20;/&#x20;**`open in finder`：我们已有 `Copy reference`，但缺「在 Finder 打开」；MusePi 把它放在项目右键里（`:1311`）。桌面壳有 `shell.showItemInFolder` 能力时才有意义，浏览器场景可退化为复制路径。

* **不跟**：groups/projects 双 tab（我们的项目树 + 独立聊天工作区是更完整的形态）、`scheduled tasks` / `board` / `agents center` 三个主入口（对应功能我们没有，列 P2）、`mobile remote control`（桌面端专属）。

### 2.4 消息区（差异最大、也最值得抄的一块）

* **我**（`MessageView.tsx` + `ProcessGroup.tsx`）：用户气泡右对齐限宽（`MessageView.tsx:417-436`）；**两行操作区常显**（Copy / Edit from here / New session fork + 时间戳，`:504-600`；助手行是 usage + Copy，`:886-929`）；工具卡可展开为 patch 分割 diff（`:1335`）；过程消息折进 `ProcessDetailsGroup`（`ChatWindow.tsx:255-320`）；思考块支持延迟拉取（`:1005-1113`）。

* **MusePi**（`guest-client/src/components/transcript/*`）：

  * **每行操作按钮**（`Transcript.tsx:387-537`）：`revert message`（撤回，只移动 leaf）/ `fork session from this message`（user 与 assistant 都支持，assistant 走 `includeTarget` 保留本条）/ `copy message`（**Copy↔Check 图标形变**，`MorphIcon`）/ `edit and resend` / `retry`（截断到产生该回复的 user 消息重发）/ `read aloud`（TTS）/ `save as image` / `quote and reply`。

  * **行 gutter 是终端式角色标签**：40/64px 槽 + mono 大写 `letter-spacing:.08em` 的 `USER` / 角色名（`transcript.css:38-52`），助手/工具整列铺开不画气泡。

  * **轮次折叠摘要**（`transcript-content.tsx:573-594`）：一轮结束时顶部一行 `activity` 摘要——`更改 N 文件` / `探索代码库` / `N 命令` / `N 工具` + 一键展开；配套 `revert message` 回到轮起点。

  * **工具卡注册表**（`tool-render/registry.ts`）：33 个工具各有专属渲染器（`tools/bash.tsx` / `edit.tsx` / `todo.tsx` / `ask.tsx` / `web-search.tsx` / `generate-image.tsx` / `lsp.tsx` / `task.tsx`…），未知工具回落通用 JSON 渲染器。

  * **工具卡折叠语义**（`ToolView.tsx:21, 89-115`）：运行中自动展开 → 结束后**延迟 1800ms 自动折叠** → 用户手动操作过就永不再自动折；artifact 卡（widget/board）不折。

  * **分支切换条**（`Transcript.tsx:250-290`）：同层多子节点时行内渲染 `switch branch` 列表（role=listbox），比下拉更接近上下文。

  * bash 卡：`$ command` + `cancelled` / `exit code N` 徽标 + `output truncated` + `collapse ↔ show all (N lines)`（`bash-card.tsx:33-61`）。

* **可借鉴**：

  1. **补&#x20;**`retry`**（重发本轮）与&#x20;**`quote and reply`**（引用回复）两个按钮**——它们是我们现在**没有**、而用户每天会用到的动作。落到 `MessageView.tsx:504-600` 附近，数据源现成（`entryIds[]` / `onEditContent` 的同级）。**MU-03**。

  2. **Copy↔Check 形变**：不引 `morphicons`，用 CSS `scale + opacity` 交叉淡入即可拿到 80% 观感。**MU-21**。

  3. **轮次折叠摘要**：我们的 `ProcessDetailsGroup` 已经做了一半（折叠 + 计数）。借它的**摘要文案生成**（改了多少文件 / 跑了几条命令 / 几个工具）+ 折叠头右侧的「回到轮起点」。落到 `ChatWindow.tsx:255-320`。**MU-19**。

  4. **工具卡折叠语义**：把「结束后 1800ms 自动折叠、用户动过就不再折」写进 `ProcessGroup`/工具卡。成本约 20 行，观感收益大（长任务不再一屏展开）。**MU-18**。

  5. **bash 卡的 exit code / truncated 徽标**：我们已有 `ProcessGroup` 的 `approval_rejected` 之类语义映射（`ProcessGroup.tsx:150`），补 exit code 徽标很便宜。

* **不跟**：TTS `read aloud`（无语音栈）、`save as image`（要引入 canvas 导出，成本高且非高频）、40px 角色 gutter（我们的气泡布局已定，改了会牵动 `--chat-content-max-width` 与 minimap 几何）。

### 2.5 Composer（按钮最密，逐颗对照）

* **我**（`ChatInput.tsx`，控件行在壳内底部）：`+` 附件（`:2547`）→ 模型（`:2570`）→ 思考档 8 级（`:2668`）→ 工具预设 4 档（`:2774`）→ compact + 上下文圆环（`:2880`/`:2993`）→ 声音开关（`:2900`）→ 圆形发送 / 方形停止（`:1753-1805`）；流式中多出 Steer / Follow-up 两键（`:1808-1860`）；手机端收进 `More controls`（`:2602`）。

* **MusePi**（`Composer.tsx:1603-1790` + `composer/action-buttons.tsx`）：

  * `attach` 菜单（`+`）：`add images` / `insert command`(`/`) / `mention file`(`@`) / `insert session`(`#`) / `insert ultrathink` / `insert workflowz` / `plan mode` / `goal mode` / `guided goal mode`（`AttachMenu.tsx:56-200`）。

  * `focus mode`（⌘⇧E，输入区占满，`action-buttons.tsx:264`）。

  * **模型 + 思考合并成一个胶囊**（左段模型 + 竖分隔 + 右段思考；容器窄时按 `@container` 逐级塌成纯图标，`ModelThinkingCapsule.tsx:20`、`gui-settings.css:182-195`）。

  * `mode toggles`（`equalizer-2`）：fast / computer / vision(auto/on/off) / prewalk（`session-mode-toggles.tsx:16-107`）。

  * Goal chip / Plan chip（`mode-chips.tsx:10,47`）。

  * `enhance`（提示词增强：`enhancing…` → `enhanced`，编辑后衰减回 idle，`action-buttons.tsx:15-34`）。

  * ContextRing（占用环 + 弹层：`used/window/utilization` / `snapcompact savings` / `subscription usage` / `compact context`，`ContextRing.tsx:64-260`）。

  * `voice input`（录音秒数 + 电平条 + `voice transcribing`，`action-buttons.tsx:38-71`）。

  * `retry last turn`（仅空闲显示，无内容时 tooltip `nothing to retry`，`action-buttons.tsx:88-102`）。

  * **三态发送键**（`action-buttons.tsx:205-260`）：空闲=发送；工作中**同一个按钮**变成胶囊——点阵 bloom loader + `working active`↔`stop turn` 文案形变，点击 abort；隐藏 sizer 保证宽度不跳。

  * 输入框上方 chip 区：`swarm members`（子代理网格）、todo 进度 chip（`done/total` + 填充条，`status-chips.tsx:39-63`）、`queue N`（队列面板：`Steering`/`After yield` 分组 + 拖拽排序 + `take back` + `send now` + `clear queue`，`queue-panel.tsx:47-171`）、引用卡（`quote-cards.tsx:8`）、长粘贴对话框（`paste inline` / `wrap as code block` / `attach as file` / `discard paste`，`long-paste-dialog.tsx:32-58`）。

* **可借鉴**（按性价比排序）：

  1. **三态发送键**（同一个键：发送 → 工作中变状态胶囊 → 点击停止）。我们现在发送/停止是两个不同按钮、位置还会变；合并后**少一个图标、状态更清楚**。落到 `ChatInput.tsx:1753-1805`。**MU-06**（P0）。

  2. `retry last turn`**&#x20;按钮**：自动重试状态我们已经显示（`ChatInput.tsx:1993` 的 `retryInfo`），但用户无法手动重发上一轮。复用队列/steer 的发送通道即可。**MU-13**。

  3. **长粘贴对话框**：现在长文本直接塞进 textarea 撑高。借它的四选项（inline / 代码块 / 附件 / 丢弃）。落到 `ChatInput.tsx` 的 paste 处理。**MU-23**。

  4. **输入框上方 chip 区**：我们已有 `ComposerContextStrip`（引用 chip）。补 **todo 进度 chip**（数据源：`lib/step-categorizer.ts:98-115` 已经能识别 todo/list 类工具）+ **队列 chip**（打开现有 queued 卡片列表）。**MU-09**。

  5. **模型+思考合并胶囊**：我们的控件行在高分屏上偏挤（模型名 + 思考档 + 工具预设 + compact + 声音 + 发送）。合并成胶囊 + `@container` 塌缩是标准解法。**MU-08**（P1，纯样式）。

  6. `focus mode`**（⌘⇧E）**：输入区占满 surface 的写作模式，实现约 30 行 CSS + 一个快捷键。**MU-07** 的一部分。

  7. `attach`**&#x20;菜单把&#x20;**`/`**&#x20;**`@`**&#x20;**`#`**&#x20;变成可发现入口**：我们的 `@`/`/` 只靠 placeholder 提示；加一个 `+` 菜单列出这三个前缀，新用户才发现得了。低成本。

* **不跟**：`enhance`（要额外模型调用与生命周期状态机）、`voice input`（无 STT 栈）、`swarm members` chip（我们子代理面板已够）、`vision/computer/prewalk` 模式开关（引擎能力决定）、plan/goal chip（没有 plan 模式）。

### 2.6 右栏

- **我**：`TabBar`（file / terminal / browser）+ `.explorer-column`（容器查询 ≥760px 出现）+ 面板头 40px；终端与浏览器与文件抢同一列宽（这正是 `ui-layout-pr-plan` UI-06 要解的问题）。
- **MusePi**：**44px 图标 rail + 单面板**，surface 由注册表驱动（`lib/surfaces/registry.ts:52-165`）：

  | surface | 内容 | 关键交互 |
  | --- | --- | --- |
  | `context` | cwd / model / mode / 消息数 / 上下文条 | `copy workspace path`、`shake context` / `fresh provider` / `clear session context` |
  | `files` | 文件树 + 预览 | `new file` / `new folder` / `show gitignored` / `refresh`；预览头 `back to files` / `copy path` / `open with default app` / `close`；图片灯箱 |
  | `trajectory` | 轨迹（时间轴 overview + 事件行 + 检视器） | Timeline/Tree 双投影；区间拖选聚焦；`jump` / `re-answer here` / `fork here`；指标含 tokens / TTFT / tok/s |
  | `jobs` | 后台任务 | 每行 `cancel` |
  | `git` | 三子 tab `workspace changes` / `commit history` / `pull requests` | `flat list`/`tree view`、`stage`/`unstage`、提交框、Git 图谱列头 |
  | `notes` | 项目知识（Notes / Todos / Plans 三段） | 笔记增删、todo 拖拽排序、plan 编辑保存 |
  | `browser` | 托管浏览器 | 多 tab、viewport 预设、`pick element`、清 cookies/缓存 |
  | `agents` | 子代理名册 + 下钻抽屉 | 每行 stop/revive/chat |
  | `widget` | 常驻组件预览 | — |

  rail 细节：**primary/secondary 分组**，secondary 折叠进 `…` 溢出菜单（`RightRail.tsx:80-121`）；**拖拽重排**（`@dnd-kit`，写入 localStorage 全量顺序）；**按住 ⌘ 500ms 显示 1..N 序号**（与 ⌘1..8 跳转对应）；**徽标**（git 变更数）优先于序号并写进 `aria-label`；150ms 悬停**富 tooltip**（label + description + badge，`RailTooltip`）；宽度 260–1200 + snap points `[300,480,800]`（`ContextPanel.tsx:247`）+ maximize。
- **可借鉴**：
  1. **rail 分组 + 溢出折叠**：我们的 `TabBar` 在标签多时会横向挤压。分层（常驻 / 折叠）比加宽更稳。落到 `TabBar.tsx` + `AppShell.tsx:2832`。**MU-12**（T1）。
  2. **`⌘E` 开关面板 / `⌘1..N` 直达标签页**：我们现在只能点。低成本高收益。**MU-05**。
  3. **`git` 面板**：我们完全没有 Git 变更/提交/PR 视图（有 `app/api/git` 后端能力）。参照 `git-panel.tsx` 的 `Changes / Commits / PR` 三子 tab + `flat/tree` 切换。**MU-16**（P1，中成本）。
  4. **`trajectory` 的时间轴 + 检视器**：我们的 `ChatMinimap` 已覆盖「跳转」，缺「每轮耗时/token/TTFT 的检视」。可作为 minimap 的悬浮卡扩展（低成本、不新增面板）。
  5. **路径类动作标准化**：`copy path` / `open with default app` / `open in finder` 三个动作在 files/git/notes 面板里出现多次——值得抽成一个 `PathActions` 小组件。**MU-20**。
  6. **终端 ANSI 调色板按主题生成**：MusePi 的 `xtermTheme(scheme)` 为明暗各出一套完整 16 色（`TerminalPanel.tsx` 导出 + `test/terminal-xterm-theme.test.ts` 锁住），注释记录了真实故障——只主题化 bg/fg/cursor/selection、ANSI 槽位回落到 xterm 默认值时，浅色主题下 `ls` / `git status` 的彩色输出对比度崩掉。我们的终端配色写死在 JS（`globals.css:63-67` 的 ponytail 注释已确认此缺口）。**MU-29**。
  7. **浏览器面板的视口预设**：MusePi 的 browser menu 提供 viewport fit 预设（`ManagedBrowserPane.tsx:682-750`）——一个下拉就能把预览切到手机/平板宽度，做响应式时不用拿真机。我们的 iframe 固定 `width: 100%`（`components/BrowserPanel.tsx:156-163`），加一排预设只是 iframe 容器宽度 + 居中框。**MU-30**。
- **不跟**：把 `notes/todos/plans` 做成右栏 surface（我们已有 `MarkdownFileEditor` + 文件树，工作流不同）、`widget` 预览（我们扩展 widget 已内联）、多实例 tab（MusePi 自己也架构否决了「第二条导航轴」）。

### 2.7 浮层 / 菜单 / 对话框（MusePi 最硬的一条工程纪律）

* **我**：`ContextMenu.tsx`（portal + fixed + 子菜单 + `is-danger` + 90ms 淡入）；对话框**各自实现**（`ProjectTrustDialog` 440 / `DirectoryPicker` \~600 / 各种确认框）；`ui-layout-pr-plan` 里 UI-10 计划引进上游 `DialogShell`。

* **MusePi**：

  * **单一入口铁律**：所有浮层必须走 `components/Pop.tsx` → `lib/use-floating-menu.tsx`（portal + 全局互斥 + `gui-menu-in/out`）；**禁止手写&#x20;**`position: fixed/absolute`**&#x20;弹层**（`docs/gui-design.md` §5e）。flip/shift/clamp 语义手写复刻 floating-ui，两段式测量（先按 260×300 估算，挂载帧再量）。

  * **两段式入场（关键坑）**：浮层首帧必须是 `opacity:0` 且不打动画，**下一帧**再加 `--entered` 开始 `scale(.96)→1`。原因写在 `docs/gui-design.md`：**挂载即动画会让 Chromium 跳过 backdrop 采样**，菜单渲染成"纯半透明"（不磨砂），而 CDP 截图看不出来（离屏合成仍显示模糊），极易误判。统一 hook：`lib/use-two-phase-enter.ts`。

  * **类名拼接陷阱**（5 个首版实现全踩）：必须 `base + " " + base--entered`；写成 `base${entered}`（丢 base 类）会让浮层掉进文档流，写成 `base --entered`（空格拼接）会永远 `opacity:0` 不可见。

  * **单层卡面归属**：menu 型组件由 portal 外层承担卡面（内容要扁平），panel 型组件自己的根节点带卡面（调用方不得再传 className）——两层卡面 = 双描边玻璃。

  * 对话框：`DialogFrame` **常驻挂载**、由 `open` 驱动（条件挂载会丢 180ms 退场）；Esc 在 `document` 捕获阶段监听并 `preventDefault`；焦点入对话框、关闭后归还；确认框 Enter=确认；`finish()` 等退场动画结束才 resolve。

  * 拖拽排序用 `@dnd-kit`（`PointerSensor distance: 8`；drag handle 独立 `<button>`，不整行可拖）；**编码顺序的拖拽用库，单纯"把这个挪过去"手写**。

* **可借鉴**（全部 T0/T1，且与代码风格无关）：

  1. `useTwoPhaseEnter`**&#x20;hook**：新文件 `hooks/useTwoPhaseEnter.ts`（约 30 行），套在我们所有带 `backdrop-filter` 的浮层上（`ContextMenu`、各种 dialog、`DirectoryPicker`、文件树右键）。**MU-01（P0）**。

  2. **类名拼接的断言**：写一个小测试（`*.test.mjs`）锁住 `base + " " + base--entered` 的形态——这是文档里记了 5 次的血泪点。

  3. **单层卡面归属规则**：写进 `docs/codex-skin/delta.md`，给现有 `ContextMenu` + 未来的 `DialogShell` 用。

  4. `finish()`**&#x20;等退场动画**：我们的确认框都是立即 resolve，改成等动画结束能消除"点完就消失"的顿挫。低成本。

* **不跟**：`Pop.tsx` 单一入口的全量重构（我们只有 3-4 处浮层，收益小于重构成本）；`@dnd-kit`（我们目前没有排序需求；真要加排序再引，别提前装）。

### 2.8 设置

* **我**：模态 1080×84vh，左列导航 184px，5 分区（General / Models / Skills / Sub-agents / Plugins），General 里有 6 套调色板、pi 主题叠加、壁纸、边框深度、内容宽/字号滑杆、过程渲染模式（legacy/timeline/tabs）、语言三语。

* **MusePi**：全窗口替换 + 左列导航 + **28 个分区**，其中 **336 项由 daemon schema 驱动**（boolean→toggle / enum→select / string→input / number→input / **array→逗号分隔（blur 提交）** / **record→紧凑 JSON（内联报错）**），改动**乐观写入 + 失败回滚**；`tuiOnly` 项拆出并标注「TUI 独有」（`SchemaSettings.tsx:366-367`）。

  * **设置搜索**：搜索框在**配置项级别**过滤（分区标签 + `SECTION_SEARCH_TERMS` 关键词），命中的行加 `.gui-settings-match`（accent 13% 填充 + 24% 描边）并 `scrollIntoView` 第一个匹配（只在换查询/换分区时滚动一次，避免抖动）；`aria-hidden`/`inert` 的折叠行跳过。

  * 分区 id 有**别名解析**（`providers → model`、`plugins → skills`），未知 id 回落默认页，杜绝空白设置页（`lib/settings-nav.ts:56-88`）。

  * 设置项里含**快捷键表**（`settings-sections/shortcuts.tsx:7-22`）。

* **可借鉴**：

  1. **设置搜索 + 匹配高亮**：我们有 5 个分区、几十个开关，用户已经在滚屏找了。落到 `SettingsPanel.tsx` + `app/settings.css`。**MU-14**（T1，纯前端，性价比很高）。

  2. **分区 id 别名 + 未知 id 回落**：我们 URL state 里已经带 `settings` 分区参数，补一层别名解析（10 行）可防旧链接/拼错导致空白页。

  3. **快捷键表分区**：与 §2.12 的命令面板一起做，正好把「有哪些快捷键」变成可发现。

  4. **array / record 型输入的提交语义**（blur 提交、内联报错不提交）：我们 `ModelsConfig` 的 headers 键值对编辑可对齐这条。

* **不跟**：schema 驱动（336 项）——我们的设置项是手写但**与产品强耦合**，schema 化的收益（少写控件）远小于重构成本，且我们没有 daemon 侧 schema 来源。

> 本节的细节于 2026-09-17 对照 MusePi 浅色主题首页截图逐元素核验过（工作区 chip 下拉展开态），行号可直接定位。

* **我**：`components/fork/NewSessionHome.tsx:96-127`（π 徽标 40px + `chat.homeTitle(:cwd)` 标题 + 一行 4 张 starter 卡）— 静态，无上下文选择器，无提示行。

* **MusePi**：`WelcomeComposer.tsx`（`WelcomeComposer.tsx:1204-1880`）：

  * 背景 `DotMatrixMark`（文本栅格化成点阵：8% 底色点 + 点亮文本点 + 2% 彩色点，缓慢色相流动 + 边缘羽化 + 点击涟漪 + 鼠标光晕 + 离屏暂停）；宠物从字里探头。

  * **时段问候**：`greeting(hour)`（`:52-62`）分 7 档（<5 深夜叮嘱 / <8 清晨 / <12 早上 / <14 中午 / <18 下午 / <22 晚上 / else 深夜），**每档自带一句语气**（如「中午好，忙完记得歇一歇」）；`BlurText stepMs={38}` 逐字模糊淡入，跨档用 TextMorph 滚动切换。

  * **工作区 / 模式 chip 行**（输入框**上方、左对齐**，`openchamber DraftTargetSelectors` parity，`:1202-1300`）：
    * 左 chip = 当前项目（folder 图标 + 名称 `max-w-[200px]` 截断 + `aria-label="current project"`）；无项目时显示「不在项目中工作」。
    * 下拉 = 当前项（accent 底 + ✓）→ `已添加的工作区` 小标题 + **sidebar 项目 tab 的全集**（一键切换，`title` 挂完整路径，当前项不重复）→ 分隔线 → `打开文件夹`（`folder-open`）/ `新建空白项目`（`folder-add`）/ `远程连接`（`server`）/ `不在项目中工作`（仅在有项目时）。值走 `"folder" | "new" | "remote" | "none"`。
    * 右 chip = **preset/mode**（默认恒为真实 mode `work`；`:437-438` 注释：DSH parity，没有「无预设」状态）。
    * **注意边界**：这个菜单只能切换与新增，**移除项目仍在侧栏右键**（`SessionSidebar.tsx:1311-1332`）。

  * 输入框 placeholder = 前缀速查（`@ 用于提及文件和文件夹；/ 用于命令；# 用于插入会话`，他们真支持 `#` 会话引用）；**输入框下方另有一行轮播提示**：`TIP_KEYS` 共 14 条（`:65-93`），`nextTip()` 随机取且不重复上一条，带 shimmer 刷新（如「会话会持久保存，重启后依然在」/「暂停的会话在重启后依然保持暂停」）。

  * **8 个建议 chip**（`探索代码库` / `跟上进度` / `权衡选项` / `开始功能规划` / `创建 Goal` / `安排计划任务` / `调试问题` / `Review 变更`）+ `+` 展开「更多建议」/「收起建议」。

  * 下方 `实时提醒`面板：进行中 + 未读会话列表（项目 chip + **相对时间**），带 `一键已读`（`RemindersPanel.tsx:50,94`）。

* **可借鉴**：

  1. ✅ **已做（MU-32）——不是新能力，只是搬家**：`components/NewTaskPicker.tsx` 已经覆盖了 4/6 项（当前项 ✓、项目全集、不在项目中、添加项目），只是入口在侧栏一个 26×36 的 chevron 上（`NewTaskPicker.tsx:47-63`）；首页只能看标题里的目录名（`chat.homeTitle {cwd}`），改不了。需要做的三件事：① 把 chip + 菜单提到空态 composer 上方；② 补「打开文件夹」（复用 `DirectoryPicker`，选中后只设 `newSessionCwd`——pi-web 的项目本来就由会话 cwd 推导，首条消息后它自然出现）；③ 补「新建空白项目」（先复用 `/api/default-cwd` 的 `~/pi-cwd-<日期>`，不做命名弹框）。
     时机安全：`ensureNewSession()` 是懒创建（`useAgentSession.ts:638-690`），首条消息前换 cwd 只是改 prop；唯一要处理的是「已打开过系统提示/工具面板 → wrapper 已建」时丢弃 draft（写进验收）。**"不在项目中"我们已经比它深**：独立聊天工作区（`lib/chat-workspace.ts` 专属目录 + `<agentDir>/pi-web-chat.json`），侧栏还是跟「项目」平级的分区（`ChatWorkspaceRow.tsx`）。不跟「远程连接」（无远程宿主）。
  2. **轮播提示行**（14 条，随机不重复上一条）：把我们现有能力（`⌘K` 命令面板、`@` 文件、`!!` 本地 shell、工具预设、上下文环、声音开关、壁纸主题…）写成 8–12 条提示轮播；成本 = 一张 i18n 键表 + 一个定时器。**MU-33（P1，成本极低）**。
  3. **建议 chip 从 4 张卡升级为 chips 行 + 「更多」折叠**：观感更轻、能放更多入口，且不会像卡片网格那样在小窗口换行难看。落到 `NewSessionHome.tsx`（fork 文件，T0）。**MU-11**。
  4. **实时提醒面板**（未读会话 + 相对时间 + 一键已读）：我们侧栏已有活动徽标（`SessionSidebar.tsx:2092-2184`），把它做成空态上的一张卡是低成本回流入口。归入 **MU-11**。
  5. **时段问候**：7 档的**语气分档**可以借（只换标题文案，不做逐字动画）。可选，1 张 i18n 表。
  6. **占位文案要与实际能力一致**：他们的 placeholder 会列出真实支持的前缀（含 `#`）；我们的 placeholder 只写 `/` 与 `@`，而 `#` 确实没实现——若要抄这条，先把 `#` 会话引用做了（见 §3.4）。

* **不跟**：点阵品牌背景 + 宠物探头（`DotMatrixMark` 300+ 行 canvas，且与 Codex 皮肤的单色墨气质冲突）、`BlurText` 逐字模糊入场（与克制纪律冲突）、preset/mode chip（我们没有会话 preset 概念，工具预设是能力档不是模式）。

### 2.10 视觉语言（令牌 / 字体 / 玻璃 / 滚动条 / 密度）

* **我**：`globals.css` 六条 scale（radius / type / control / z / shadow / motion）+ 每套主题 34 个颜色变量 × 6 套；`--corner-radius-scale: 1.25`；`prefers-reduced-motion` 全局塌缩；壁纸三区域 scrim/blur。

* **MusePi**：

  * **一个文件管住颜色**：`guest-client/src/styles/tokens.css` 是唯一允许写裸色的文件（文件头注释即规定），其余 CSS 只写 `var()`；语义层 `--color-*` + shadcn 兼容层都从同一批原语派生 → 18 套 ui-theme × 4 accent × 明暗全自动跟随。

  * **正文与壳层字号解耦**：`--ui-font-size`（壳层，根 15px，派生 sm/xs/lg/xl）与 `--tr-font-size`（消息正文 14px）**两条独立刻度**，标题/代码/表格全按消息刻度 `calc()` 派生（`transcript.css:770-799`）。

  * `--gui-density`：无单位系数（0.5–2.0），全站 padding 走 `calc(32px * var(--gui-density,1))`。

  * **动效令牌**（`gui-base.css:54-71`）：`--gui-motion-menu-in/out 130ms` / `chip 180ms` / `fade 160ms` / `height 240ms`（上限 480）/ `blur 280ms` / `roll 240ms` + 位移 `6/10px` + 模糊 `8/24px` + 缓动 `--gui-ease-out: cubic-bezier(.22,1,.36,1)`。

  * **三条弹簧曲线**：`--spring`(300,30) / `--spring-snappy`(400,34) / `--spring-bouncy`(320,16)，全部是 damped-spring 生成的 `linear()` 点列（`gui-base.css:13-52`），所有浮层/morph/折叠共用，**禁止 ad-hoc cubic-bezier**。

  * **输入框视觉**：0.5px **透明**边框 + 玻璃 + `--gui-input-shadow`（四层：0.5px 高光 / 近影 / 远影 / 内高光）；聚焦与「增强中」态只在 `::after` 叠 **conic-gradient 旋转彩虹环**（`@property --pi-angle`，1.1s 线性）；输入框本体**永远没有硬边框**（`gui-composer.css:105-155`）。

  * **会话行**：左侧 2px accent 竖条用 `scaleY(0→1)` 弹出（160ms），选中态 = accent 14% 洗底 + 22% 描边，**比 hover 更强**（`gui-chrome.css:343-407`）。

  * **用户气泡**：`min(70%, 620px)` + **单角收窄** `16px 16px 4px 16px` + accent 13% 洗底（`transcript.css:116-126`）。

  * **滚动条**：系统滚动条全局 `display:none !important`，改用**自绘悬浮轨**（12px，fixed，`pointer-events:none`，只有拇指可点；idle 变"幽灵"仍可拖；两套皮肤 `gummy`/`pacman`）；内容边缘用 `mask-image` 渐隐（转录 24/32px）——**只在真正溢出且未贴边时挂载**。

  * **性能刹车**：shimmer 1.4s、launcher shine **明确限制 20 次**（注释记录了无限 background-position 绘制卡死渲染进程的事故）、离屏 beam `data-paused`、Windows 关 blur、reduced-motion 压到 0.01ms。

  * 焦点策略：全局 `:focus-visible { outline:none; box-shadow:none }` —— **故意不要焦点环**，靠控件自身强调态表达。

* **可借鉴**：

  1. **弹簧令牌 + 时长令牌**（写进 `app/fork-ui.css` 的 `:root`）：我们的动效只有 `120/150/250ms + 一条 cubic-bezier`，且各组件散落 inline。补 3 条 `linear()` 弹簧 + 6 条时长（menu/chip/fade/height/blur/roll），并规定**新动效必须读 token**。T0，零风险。**MU-02（P0）**。

  2. **消息字号与壳层字号解耦**：我们已有 `--chat-content-font-size`，但代码/表格/标题未完全按它派生。统一后「字号滑杆」才真正全局生效。T1。

  3. `--ui-density`**&#x20;密度系数**：我们已有内容宽/字号滑杆，缺"整体紧凑度"。加一个 0.85/1.0/1.15 三档乘在 padding 上。T1，**MU-22**。

  4. **边缘羽化（mask-image 渐隐）**：比阴影更现代，且**只在溢出时挂载**的写法可直接抄（`lib/useScrollShadow` 的思路，30 行）。落到聊天列 + 会话列表 + 文件树。**MU-17**。

  5. **会话行竖条**、**用户气泡单角收窄**、**输入框伪元素表达聚焦**——三个纯 CSS 小改动，观感收益高、不撞 Codex 单色纪律。**MU-04**。

  6. **滚动条皮肤**：我们已经有 `::-webkit-scrollbar` 主题化（`globals.css:648-655`），**不抄**全局隐藏 + 自绘悬浮轨（可访问性 + 兼容成本高，收益只是"好看"）。

  7. **三条零成本细节**（各 1 行 CSS，见 `transcript.css:38-52, 747-816, 1106`）：

     * `font-variant-numeric: tabular-nums` —— 所有 token / 用量 / 计时 / tok/s 数字等宽，刷新时不再跳动；我们顶栏统计胶囊与会话统计弹层最需要。

     * `word-break: keep-all` —— 中文按词换行（现在长中文句子会被硬切）；落在 `MarkdownBody` 的正文块。

     * `content-visibility: auto` + `contain-intrinsic-size: auto 60px` —— 消息行离屏跳过布局/绘制，长会话（几百条）滚动明显更稳；我们 `MessageView` 每行还没加。**MU-28**。

* **不跟**：单一裸色文件（我们的 6 套调色板是产品决策）、18 套 ui-theme、全局禁用焦点环（无障碍）、衬线正文（Codex 皮肤是 sans）。

### 2.11 动效体系

- **我**：`--motion-fast/base/slow` + `--ease-out`；主题切换有 View Transition 圆形扩散；`prefers-reduced-motion` 全局塌缩。
- **MusePi**（`docs/gui-design.md` §3）：
  | 场景 | 机制 |
  | --- | --- |
  | 条件块显隐 | `<Reveal open>`：px 高度 240ms `cubic-bezier(.22,1,.36,1)` + 外层 160ms 淡入；关闭态 `aria-hidden` + `inert`，**节点不卸载** |
  | 高度变化（换 tab / 列表增长） | `<HeightMorph morphKey>`：渲染时抓旧高 → 提交新内容 → 高度过渡 → 落回 auto；**过渡期必须 `overflow:hidden`**，否则新内容瞬间填满、只看到盒子边缘在动 = "没有动画"；高度差 <1px 时跳过钉高只播淡入（否则滚动条消失 300ms）；时长按差值 240→480ms 自适应 |
  | 高度动画的铁律 | 子元素**直接渲染进带 ref 的外层**，不要包中间 div（否则 grid 退化成单列，70 张卡在 4234px 处"伪丝滑"） |
  | 禁止 | `grid-template-rows: 0fr↔1fr`（Chromium 单向动画问题） |
  | 浮层 | 两段式入场（见 §2.7） |
  | 主题切换 | 全屏磨砂幕 200ms 入 → 200ms 后幕色 340ms 过渡 + 图标形变 → 560ms 换色再淡出；**重复点当前主题 → 400ms 抖动**（"已激活"的触感） |
  | 图标形变 | `morphicons`（Procrustes 最优旋转 + 极坐标插值 + 弹簧）；**禁止**两个 SVG 叠着做淡入淡出的假形变 |
- **可借鉴**：
  1. **`HeightMorph` 的两条经验**（"过渡期必须裁剪" + "高度未变时跳过钉高"）——即使不搬组件，也该写进 `delta.md` 免得重踩。**MU-15**。
  2. **`Reveal` 的 `inert + aria-hidden` 收起**：我们的折叠块（如 `ProcessDetailsGroup`）收起后仍在 tab 序列里吗？值得核对一遍。
  3. **主题切换的"重复点击抖动"**：我们已有 450ms 圆扩散；补一个"再点当前主题 → 短抖动"确认反馈（10 行）。**MU-24**。
  4. **图标形变替代**：不引 `morphicons`；对 Copy↔Check 这类二态用 CSS `scale/opacity` 交叉（见 MU-21），并在 `delta.md` 注明"不做假 SVG 形变"。
- **不跟**：`HeightMorph` 组件本身（我们的折叠是"显示/隐藏块"，不是"内容换高度"）。

### 2.12 键盘与命令面板（差距最大的一块）

- **我**：只有 `Esc`（停 agent）与 `Ctrl+Alt+N`（新会话）（`hooks/useKeyboardShortcuts.ts:48-75`）+ 若干组件局部键。
- **MusePi**（`app.tsx:2386-2496`，且**设置里有可查的快捷键表**）：
  | 键 | 行为 |
  | --- | --- |
  | `⌘N` | 新建会话 |
  | `⌘K` | **命令面板**（tab：`all` / `actions` / `tasks`；动作含 `new task` / `open workspace` / `settings` / `toggle sidebar` / `toggle terminal` / `toggle preview` / `agents center`；tasks = 会话搜索命中） |
  | `⌘F` | 侧栏会话搜索 |
  | `⌘,` | 设置 |
  | `⌘B` / `⌘J` / `⌘E` | 侧栏 / 终端 / 右栏开关 |
  | `⌘⇧E` | 专注模式（输入区占满） |
  | `⌘1..8` | 按 rail 顺序直达第 N 个 surface（面板自动展开） |
  | `⌘O` | 打开文件夹 |
  | `⌘L` / `⌘⇧L` | 引用选区进输入框 / 对选区"问一问"（不写 transcript） |
  | `⌘↓` | 平滑滚到最新 |
  | `⌘↩` | 发送（工作中 = 与 `busyEnter` 相反的行为） |
  | `Esc` | 优先退出专注模式；否则中断本轮（未被其它 surface 认领时） |
  | 局部 | `Alt+↑` 取回最新队列消息；AskCard 里 `←/→` 切题、`N` 开关备注；Git 提交 `⌘↩` |
- **可借鉴**：
  1. **`⌘K` 命令面板**：这是用户"找不到功能"时的兜底入口。我们没有 `cmdk`，手写约 200 行（复用 `ContextMenu` 的定位与键盘循环、`SessionSearch` 的数据源）。落到 `components/fork/CommandPalette.tsx`（T0 新文件）+ `AppShell.tsx` 一处接线（T1）。**MU-05（P1）**。
  2. **`⌘B` / `⌘J` / `⌘E` / `⌘⇧E` / `⌘1..N` / `⌘↓` / `⌘F` / `⌘,`**：全部映射到我们**已有**的 handler（侧栏开关、右面板开关、滚动到底、设置模态、会话搜索）。合起来约 60 行，观感提升明显。**MU-05**。
  3. **`⌘L` / `⌘⇧L` 选区操作**：配合划词工具条（MU-04）一起做。**MU-04**。
  4. **设置里的快捷键表**：放 Settings → General，数据即上面的映射表（单一来源，避免文档漂移）。
- **不跟**：`⌘O`（我们没有原生文件对话框的通用入口）、AskCard 的 `N`（我们没有 ask 卡）。

### 2.13 通知 / 声音 / 提醒

* **我**：完成音（`hooks/useAudio.ts` + `localStorage: pi-sound-enabled`）+ 浏览器通知 + Web Push（VAPID）+ 侧栏活动徽标。

* **MusePi**：**按事件可配的声音**（10 个事件：发送 / 首条 / 完成（`agent_end`，且 stopReason 非 aborted/error 才响）/ 审批请求 / 批准 / 拒绝 / 切会话 / 停止本轮 / 工具结果 / 错误），每个事件可换音色 + 试听 + 14 色板（`lib/sfx.ts`，`settings-sections/notifications.tsx`）；用 `agent_end` 而不是 `turn_end`（**turn\_end 每次模型调用都触发**，多工具任务会连响，且与 abort 的停止音叠加——这条修正记录在 `docs/gui-design.md`）；通知分三档（completion / error / ask）+ 空闲 recap。

* **可借鉴**：

  1. **把「完成音」拆成可配事件表**：我们现在只有一个开关。至少补 **error** 与 **等待用户输入（审批/ask）** 两类，避免长任务里"跑完了"和"卡住了"听起来一样。落到 `hooks/useAudio.ts` + Settings。**MU-24**（低成本）。

  2. `agent_end`**&#x20;作为"完成"信号**：核对我们的播放点位是否也可能被重试/压缩触发多次（`AGENTS.md` 里已提到不要在第一个 `agent_end` 就关流——音效同理）。**MU-24**。

* **不跟**：Web Audio 合成 14 种音色（我们只有一条提示音，够用）、空闲 recap（要额外 LLM 调用）。

### 2.14 架构与数据（只列与 UI 直接相关的）

| 议题 | MusePi | 我 | 是否值得做 |
| --- | --- | --- | --- |
| 事件流可靠性 | 每连接拿 `seq`，8ms 窗口聚合成 `batch`，journal + checkpoint 支持断线重放（`daemon/event-batcher.ts`、`journal.ts`） | SSE 无游标，刷页/断网丢事件，靠轮询 + `agent_settled` 兜底（`hooks/useAgentSession.ts:1130-1400`） | **是**：给 SSE 事件加单调 `seq` + 事件内 `catch-up` 请求即可（P2，纯后端） |
| 跨会话搜索 | SQLite 物化视图（messages/agents 投影表），可常驻、可分页 | 3s 限时扫文件，无索引（`lib/session-search.ts:25` 的 ponytail 注释） | 视数据量；已标 ponytail，暂不动 |
| 消息树 | `buildMessageTree(entries)` + 可缩放画布（`message-tree.ts:41` / `SessionTreeCanvas.tsx:192`） | 只有下拉式 `BranchNavigator`（`lib/session-tree.ts:8` 注释："Forks remain roots; only subagents nest"） | **是（P2）**：会话内分支画布是纯前端可算的（`entry.parentId` 已有） |
| 工具审批 | `approval-request` envelope 广播给所有订阅者 + 工具声明 read/write/exec 三档 + `tools.approvalMode` + 独立 `ApprovalCard`（⌘/Ctrl+Enter 确认）+ 托盘/桌宠内联 Allow/Deny + 全局热键 `⌘⇧Y`/`⌘⇧N` | **已有交互**：`ExtensionDialog` 消费 `extension_ui_request` 的 `select/confirm/input/editor`（`ChatWindow.tsx:1785-1990`，含键盘导航与倒计时，`hooks/useAgentSession.ts:850-890`）；缺的是独立审批卡（风险摘要 + 「允许一次 / 总是允许 / 拒绝」）、全局确认热键、审批结果留痕 | **是（已收窄）**：不用等引擎，把现有 `ExtensionDialog` 的 confirm 分支升级成审批卡即可 → **MU-31** |
| Ask 卡 | `AskCard`：单选/多选/多题 tab/备注/预览/超时自动选 | **部分已有**：同一个 `ExtensionDialog` 已支持 `select`（选项列表 + ↑↓/Home/End）与 `input/editor`；缺的是「推荐项标记 / 多题 tab / 备注 / 倒计时归因」等交互细化 | 低优先：现有卡已能跑通问答，细化等真实抱怨再说 |
| Todo | `session.todo` 契约 + composer chip + 面板 | 只有 `lib/step-categorizer.ts` 的分类能力 | **是**：不需要引擎改动，chip 用现有事件推断即可（MU-09） |

---

## 3. 全量按钮对照表

> 图例：**有** = 我方已有等价物；**无** = 缺失，可借鉴；**不跟** = 已明确不做。

### 3.1 顶栏 / 外壳

| 区域 | MusePi 控件 | 我 | 备注 |
| --- | --- | --- | --- |
| 左 | 侧栏开关 | 有 | — |
| 左 | dev server 胶囊（run / stop / auto discover） | 无 | 需 `/api/terminal` 接线，MU-18 |
| 左 | open preview | 无 | 同上 |
| 中 | 会话标题 = 最近会话切换器 | 无（纯文本） | MU-18 |
| 中 | 会话 `⋯`：rename / copy id / share / export md / worktree / archive / delete | 部分有（rename / delete / pin / copy reference） | 补 `export markdown` + archive |
| 右 | 暂停本会话 / 暂停全部 | 无 | 不跟（无 daemon gate） |
| 右 | 终端开关 / 看板 / 右栏开关 / PiP | 部分（终端在右栏 Tab） | 借键盘快捷键即可 |
| 右 | Open-in 外部 App | 无 | 不跟（桌面壳专属） |
| 右 | 实例 / 远端切换 | 无 | 不跟 |
| 我独有 | Full history / Generate title / Agents 计数 / Branches / 系统提示 / 工具定义 / session stats 弹层 / 工作区角色互换 | — | **保持**（MusePi 没有） |

### 3.2 侧栏

| MusePi 控件 | 我 | 备注 |
| --- | --- | --- |
| `new task`(⌘N) / `search`(⌘K) / `scheduled tasks` / `board` / `agents center` / `extensions` | 部分（New task / 搜索 / 模型 / 技能 / 设置） | 前两项借快捷键；后三个不跟 |
| groups ↔ projects 双 tab | 不跟 | 我们的项目树更完整 |
| `search sessions…`(⌘F) | 有 | 补快捷键 |
| `expand or collapse all` | 无 | MU-10 |
| `view and sort`（by project / timeline；updated / created） | 无 | MU-10 |
| `archive` 视图 | 有（归档区） | — |
| 会话行状态点（5 种）+ 未读点 + 手工 tag | 部分（运行/未读） | MU-10 |
| 会话右键：pin / rename / archive / tag / copy path / copy id / open finder | 部分 | MU-10 |
| 分组右键：rename / color / delete | 部分（项目 rename / delete） | 借"颜色" |
| 底部：daemon 状态灯 / settings / mobile remote / disconnect | 部分（模型 / 技能 / 设置） | 借"状态灯"形态 |

### 3.3 消息行操作

| MusePi | 我 | 备注 |
| --- | --- | --- |
| `revert message`（user，只移动 leaf） | 无 | 与 `navigate_tree` 同类操作，MU-03 |
| `fork session from this message`（user + assistant） | 部分（New session 仅 user） | MU-03 |
| `copy message`（Copy↔Check 形变） | 有（无形变） | MU-21 |
| `edit and resend`（user） | 有（Edit from here） | — |
| `retry`（assistant，截断到对应 user 消息重发） | **无** | MU-03 |
| `read aloud` / `save as image` | 无 | 不跟 |
| `quote and reply` | 无 | MU-03 |
| 分支切换条（行内 listbox） | 有（顶栏 BranchNavigator） | 保持 |

### 3.4 Composer

| MusePi | 我 | 备注 |
| --- | --- | --- |
| `attach` 菜单（`/` `@` `#` 入口 + 计划模式 + 魔法词） | 部分（只有 `+` 图片 + placeholder 提示） | 借"前缀可发现"这一半 |
| `focus mode`(⌘⇧E) | 无 | MU-07 |
| 模型 + 思考合并胶囊（窄容器塌缩） | 两个独立控件 | MU-08 |
| `mode toggles`(fast/computer/vision/prewalk) | 无 | 不跟 |
| Goal / Plan chip | 无 | 不跟 |
| `enhance`（提示词增强） | 无 | 不跟 |
| ContextRing（环 + 用量/配额/压缩弹层） | 有（环 + 压缩按钮） | — |
| `voice input` | 无 | 不跟 |
| `retry last turn` | 无 | MU-13 |
| **三态发送键**（发送 → 工作胶囊 → 停止） | 发送 + 停止两个键 | MU-06 |
| swarm chip / todo chip / queue chip / 引用卡 / 长粘贴对话框 | 部分（引用卡有） | MU-09 / MU-23 |
| `/` `@` `!` `!!` 前缀 | 有 | — |
| `#` 会话引用 / `$` Python / 魔法词 | 无 | `#` 可借（见 §4 MU-09 备注） |
| Enter / Alt+Enter / ↑ 历史 / ↑↓ 补全 | 有 | — |

### 3.5 右栏与浮层

| MusePi | 我 | 备注 |
| --- | --- | --- |
| 44px rail + 分组 + 溢出折叠 + 拖拽重排 + 序号提示 + 富 tooltip | 无（TabBar 平铺） | MU-12 |
| 宽度 snap points + maximize | 部分（拖拽 + 上下限） | 借 snap points |
| files（新建文件/夹、show gitignored、copy path、open with default app、灯箱） | 部分（文件树 / 上传 / 下载 / 预览） | 借 `copy path` / `gitignored` |
| git（changes / commits / PR 三子 tab + flat/tree + stage/unstage + commit 框 + 图谱） | **无** | MU-16 |
| trajectory（时间轴 + 检视器 + 指标） | 部分（minimap） | 借检视卡 |
| jobs（后台任务 + cancel） | 无 | 不跟（无 job 概念） |
| notes（notes/todos/plans） | 无 | 不跟 |
| agents 名册 + stop/revive/chat | 部分（子代理树 + 打开） | 借 `stop` |
| 统一浮层规范（单一入口 / 两段式 / 类名拼接 / 卡面归属） | 部分（ContextMenu） | MU-01 |
| 确认框等退场动画再 resolve | 无 | MU-01 |

---

## 4. 建议清单（按性价比排序）

接触面等级沿用 `ui-layout-pr-plan-2026-09-17.md` §5.1：
**T0** = 只新增 fork-only 文件（无合并冲突）；**T1** = 上游文件内 ≤10 行且带 `// fork:` 标记；
**T2** = 结构性改动（需重贴皮肤）。

| 编号 | 做什么 | 证据（MusePi） | 落到 | 接触面 | 成本 | 与 Codex 皮肤的冲突 |
| --- | --- | --- | --- | --- | --- | --- |
| **MU-01** ✅ 已做 | `useTwoPhaseEnter` + 浮层退场动画契约 | `lib/use-two-phase-enter.ts`、`docs/gui-design.md` §"两段式" | `hooks/useTwoPhaseEnter.ts`（新）+ `ContextMenu` 等 4 处接线 | T0/T1 | 低 | 无 |
| **MU-02** ✅ 已做 | 补弹簧/时长令牌并规定"动效必须读 token" | `gui-base.css:13-71` | `app/fork-ui.css` `:root` | T0 | 极低 | 无 |
| **MU-03** | 消息补 `retry` + `quote and reply`（+ assistant fork） | `Transcript.tsx:387-537` | `components/MessageView.tsx:504-600` | T1 | 低-中 | 无 |
| **MU-04** | 划词工具条（引用 / 复制 / 以此新建会话）+ ⌘L / ⌘⇧L | `SelectionToolbar.tsx:152-160`、`app.tsx:2418-2459` | `components/fork/SelectionToolbar.tsx`（新）+ `ChatWindow` 接线 | T0/T1 | 中 | 无（复用文件查看器已有的引用浮层样式） |
| **MU-05** | 命令面板 ⌘K + 常用快捷键（⌘B/J/E/⇧E/1..N/↓/F/,） | `CommandPalette.tsx:28-311`、`app.tsx:2386-2496` | `components/fork/CommandPalette.tsx`（新）+ `hooks/useKeyboardShortcuts.ts` | T0/T1 | 中 | 无（自绘，不引 cmdk） |
| **MU-06** | 三态发送键（发送 / 工作胶囊 / 停止） | `action-buttons.tsx:205-260`、`gui-composer.css:705-810` | `components/ChatInput.tsx:1753-1805` | T1 | 低 | 无 |
| **MU-07** | 输入区专注模式 ⌘⇧E | `action-buttons.tsx:264`、`gui-chat.css:1727-1745` | `ChatWindow` + `fork-ui.css` | T1 | 低 | 无 |
| **MU-08** | 模型 + 思考合并胶囊（`@container` 塌缩） | `ModelThinkingCapsule.tsx:20`、`gui-settings.css:182-195` | `components/ChatInput.tsx:2570-2760` | T2 | 中 | 无 |
| **MU-09** ✅ 已做（todo 半边：见 delta.md §24；队列本就常显，不另加 chip） | composer chip 区：todo 进度 chip + 队列 chip | `status-chips.tsx:39-63`、`Composer.tsx:1556/1578` | `components/ComposerContextStrip.tsx` 邻位 | T1 | 低-中 | 无 |
| **MU-10** | 侧栏：会话状态点 + 手工 tag + 视图/排序 + 全部展开 | `SessionList.tsx:234-252`、`SessionSidebar.tsx:556-638,1198-1262` | `SessionSidebar.tsx` + `SessionRowContextMenuBridge.tsx` + `lib/session-flags.ts` | T1 | 中 | 无 |
| **MU-11** | 空态：chips 行 + 「更多建议」+ 一行状态说明 | `WelcomeComposer.tsx:1204-1880` | `components/fork/NewSessionHome.tsx`（已有，T0） | T0 | 低 | 无 |
| **MU-12** | 右栏 TabBar 分组 + 溢出折叠（+ `⌘E`） | `RightRail.tsx:80-121`、`ContextPanel.tsx:247` | `components/TabBar.tsx` + `AppShell.tsx:2832` | T1 | 中 | 无 |
| **MU-13** | `retry last turn` 按钮（空闲态） | `action-buttons.tsx:88-102` | `components/ChatInput.tsx` 控件行 | T1 | 低 | 无 |
| **MU-14** ✅ 已做 | 设置搜索 + 命中高亮 + 分区别名回落 | `SettingsView.tsx:613-621`、`lib/settings-nav.ts:56-88` | `components/SettingsPanel.tsx` + `app/settings.css` | T1 | 中 | 无 |
| **MU-15** ✅ 已做（写进 delta.md §22） | 高度动画两条铁律（必须裁剪 / 高度未变跳过钉高）写进台账 | `docs/gui-design.md` §3 | `docs/codex-skin/delta.md` | T0 | 极低 | 无 |
| **MU-16** | Git 面板（Changes / Commits / PR + flat/tree + stage/unstage + 提交框） | `git-panel.tsx:571-819`、`lib/git-graph-lanes.ts` | 右栏新 surface + `app/api/git` 扩展 | T1 | 高 | 无 |
| **MU-17** | 边缘羽化（mask-image，只在溢出时挂载） | `lib/use-scroll-shadow.ts`、`FadeScroll.tsx` | `hooks/useScrollShadow.ts`（新）+ 聊天列/会话列表/文件树 | T0/T1 | 低 | 无 |
| **MU-18** | 标题即切换器 + dev server 胶囊 + export markdown | `GuiHeader.tsx:635-735,748-846,895` | `AppShell.tsx` 顶栏 + `app/api/terminal` | T1 | 中 | 无 |
| **MU-19** ✅ 已做 | 轮次折叠摘要行（改了多少文件 / 命令数 / 工具数 + 回到轮起点） | `transcript-content.tsx:573-594`、`round-collapse.ts` | `components/ChatWindow.tsx:255-320` + `ProcessGroup.tsx` | T1 | 中 | 无 |
| **MU-20** ✅ 已做 | `PathActions`（copy path / 默认应用打开 / Finder）小组件 | `FilePane.tsx:892-943`、`GuiHeader.tsx:1311` | `components/fork/PathActions.tsx`（新） | T0 | 低 | 无 |
| **MU-21** ✅ 已做 | Copy↔Check 二态图标用 CSS 交叉（不做假 SVG 形变） | `Transcript.tsx:422-437`、`gui-design.md` §5b | `MessageView.tsx` + `fork-ui.css` | T1 | 极低 | 无 |
| **MU-22** ✅ 已做 | `--ui-density` 三档密度系数 | `gui-design.md` §2、`appearance.ts:174-180` | `fork-ui.css` + Settings | T1 | 低 | 无 |
| **MU-23** | 长粘贴对话框（inline / 代码块 / 附件 / 丢弃） | `long-paste-dialog.tsx:32-58` | `components/ChatInput.tsx` paste 分支 | T1 | 低-中 | 无 |
| **MU-24** | 完成音拆成事件表（至少补 error 与"等待用户"）+ 重复点主题抖动 | `lib/sfx.ts`、`gui-design.md` §5、`tokens.css:794-810` | `hooks/useAudio.ts`、`hooks/useTheme.ts` | T1 | 低 | 无 |
| MU-25（P2） | 会话内消息树画布 | `message-tree.ts:41`、`SessionTreeCanvas.tsx:192` | `components/fork/SessionCanvas.tsx`（新） | T0 | 高 | 无 |
| MU-26（P2） | SSE 事件加 `seq` + 断线补发 | `event-batcher.ts`、`journal.ts` | `lib/agent-event-stream.ts` + `useAgentSession.ts` | T1 | 中 | 无 |
| MU-27（P2） | Todo 面板（不只是 chip） | `tools/todo.ts`、`todo-panel.tsx:25` | 右栏新 surface 或 composer 弹层 | T1 | 中 | 无 |
| **MU-28** 🟡 部分已做（tabular-nums / CJK 折行；content-visibility 见 §4.10） | 三条 1 行 CSS：`tabular-nums` / CJK `word-break: keep-all` / 消息行 `content-visibility: auto` | `transcript.css:38-52, 747-816, 1106` | `app/fork-ui.css` + `MarkdownBody` / `MessageView` | T0/T1 | 极低 | 无 |
| **MU-29** | 终端 ANSI 16 色调色板按明暗主题生成（现在硬编码在 JS） | `TerminalPanel.tsx` 导出 `xtermTheme(scheme)` + `test/terminal-xterm-theme.test.ts:6-11`（注释记录了真实故障：只主题化了 bg/fg/cursor/selection，ANSI 槽位回落到 xterm 默认值 → 浅色主题下 `ls`/`git status` 彩色输出对比度崩） | `components/TerminalPanel.tsx:54` + `app/globals.css:63-67`（已有 ponytail 注释确认此缺口） | T1 | 低 | 无 |
| **MU-30** ✅ 已做 | 浏览器面板视口预设（手机 / 平板 / 桌面宽度档 + 居中框） | `ManagedBrowserPane.tsx:682-750`（browser menu 的 viewport fit 预设） | `components/BrowserPanel.tsx:156-163`（iframe 目前固定 `width:100%`） | T1 | 低 | 无 |
| **MU-31** | 把现有 `ExtensionDialog` 的 confirm 分支升级为**审批卡**：工具名 + 参数摘要 + 风险档 + 「允许一次 / 总是允许 / 拒绝」+ 全局确认热键 | `ApprovalCard.tsx:24,70`（⌘/Ctrl+Enter 确认）、`electron/main.cjs:1770-1781`（`⌘⇧Y`/`⌘⇧N` 全局审批热键）、`docs/approval-mode.md:1-30`（read/write/exec 三档） | `components/ChatWindow.tsx:1785-1990`（`ExtensionDialog` 已消费 `select/confirm/input/editor`） | T1 | 低-中 | 无 |
| **MU-32** ✅ 已做（2026-09-17，见 `codex-skin/delta.md` §21） | **把现有的「新建任务」项目选择器镜像到新会话首页**（composer 上方左对齐一个 `ProjectChip`）：当前项目 + 下拉（当前 ✓ / 已添加工作区 / 打开文件夹 / 新建空白项目 / 不在项目中工作）；移除项目仍留侧栏右键。**不是新增能力**：`NewTaskPicker.tsx` 已覆盖 4/6 项，缺的只是「打开文件夹」「新建空白项目」两个动作 + 首页这个位置 | `WelcomeComposer.tsx:1202-1300`（chip 行 + `saved workspaces` 全集 + `folder/new/remote/none` 四种值） | 新组件 `components/fork/ProjectChip.tsx` + `NewSessionHome` / `ChatWindow` composer 上方；数据源与 handler 全部现成（`SessionSidebar.tsx:1351` 的 `projects/activeKey/chatPath/onNewIn`）；`打开文件夹` 复用 `DirectoryPicker`，`新建空白项目` 复用 `/api/default-cwd` | T0/T1 | 低-中 | 无（复用现有 handler，不新增能力） |
| **MU-33** ✅ 已做 | 输入框下方的**轮播提示行**（8–12 条，随机且不重复上一条） | `WelcomeComposer.tsx:65-93`（14 条 `TIP_KEYS` + `nextTip()` + shimmer 刷新） | i18n 键表 + `NewSessionHome` / `ChatInput` 下方一行 | T0 | 极低 | 无 |

### 4.9 与既有 PR 计划的去重

| 既有 | 本文关系 |
| --- | --- |
| UI-06（底栏承载终端/浏览器） | 与 MU-12 同属"右栏瘦身"，但方向不同：UI-06 挪到底栏，MU-12 是分组/折叠。**先做 UI-06，MU-12 只处理剩下的 tab 溢出** |
| UI-10（统一 `DialogShell`） | MU-01 是它的**前置纪律**（两段式 + 卡面归属），先做 MU-01 再落 `DialogShell` |
| PR-07（队列单条操作） | MU-09 的队列 chip 是它的 UI 入口，不重复实现 |
| PR-05（tok/s） | 与 MU-19 的摘要行共用数据源，先落 PR-05 |
| PR-12（欢迎大厅） | MU-11 是其轻量版，在 `NewSessionHome` 上做，不冲突 |

### 4.10 视需求（已评估、未排期）

以下几条值得知道，但**不建议现在做**——列在这里是为了下次有人重提时不用重新调研：

| 项 | MusePi 的做法 | 为什么没排期 |
| --- | --- | --- |
| 消息行 `content-visibility: auto` | `transcript.css:38-52`（`content-visibility: auto` + `contain-intrinsic-size: auto 60px`，长会话滚动更稳） | **已评估但不做**：minimap 与滚动恢复依赖真实行高（`ChatMinimap` 吃 `messageRefs` 测量值），`contain-intrinsic-size` 会把占位高度喂给它们。要做先得让 minimap 从会话索引推导位置 |
| SQLite 物化视图做跨会话搜索 | `daemon/view-store.ts:1-46`（messages/agents 投影表） | 我们已有 `lib/session-search.ts` 的 ponytail 降级；先量真实延迟再决定是否引索引 |
| 定时任务（cron） | `daemon/crons.ts:1-80` | ✅ **已做**（见 codex-skin/delta.md §25）：daily/weekly/once + 本机时区 + 错过窗口跳过，调度器在服务进程内，跑出来的是普通会话 |
| 两级 pause（会话 / 全局） | `docs/gui-implementation.md:22-33` + `pause.json` sidecar | 我们单进程内嵌 SDK，没有 daemon 级 gate；要做先在 `rpc-manager` 加一层 |
| 声明式 slash 命令注册表 | `slash-commands/types.ts` + `builtin-registry.ts`（一个 spec 同时带 handle / handleTui / subcommands / inlineHint / allowArgs） | 我们只有 6 条前端内建（`ChatInput.tsx:252-260`），数据驱动现在收益小；**命令数超过 ~15 条时再改** |
| MCP 注册表搜索一键部署 | `builtin-session.ts:617` 的 Smithery 子命令 | 依赖外部注册表 API；现有面板已能按 spec 手动添加 |
| `@file` 语义化注入（服务端读文件） | `utils/file-mentions.ts:14,293`（含图片/大文件阈值/hashline 锚） | **待核实**：我们只插 `@path` 文本 token，展开行为取决于所嵌 pi SDK 版本——先实测再决定要不要在 web 侧展开 |

---

## 5. 明确不做（以及为什么）

| 不做 | 为什么 |
| --- | --- |
| Electron 无边框窗口 + 玻璃圆角卡片工作区 | 我们的分栏几何（共边 + 拖拽 + 工作区互换）是刻意设计，改卡片要重做整套布局 |
| 18 套 ui-theme + 4 条正交主题轴 | 6 套 Codex 调色板 + pi 主题叠加已更深；多体系只会打架 |
| 自绘悬浮滚动条 + 全局隐藏系统滚动条 | 可访问性与兼容成本高，收益仅观感；我们已有主题化细滚动条 |
| 全局禁用 `:focus-visible` 焦点环 | 无障碍倒退（MusePi 是桌面应用，我们还有键盘/触屏用户） |
| 衬线正文 / 点阵品牌背景 / 桌宠 / 迷你窗口 / 托盘 | 产品形态不同 |
| schema 驱动设置（336 项） | 无 daemon schema 来源，手写控件与产品强耦合 |
| `morphicons` / `@dnd-kit` / `lucide-react` / `cmdk` 等新依赖 | 我们的图标与菜单是自绘 + token 化；需要时手写同语义实现（见 MU-05/21） |
| TTS / STT / computer-use / plan·goal 模式 | 引擎能力不具备 |
| 把 `notes/todos/plans` 做成右栏 surface | 我们的 `MarkdownFileEditor` + 文件树工作流不同 |

---

## 6. 实施顺序

```
第一梯队（T0/T1、低风险、观感立竿见影）
  MU-01（浮层纪律）→ MU-02（动效令牌）→ MU-21（二态图标）→ MU-15（台账两条铁律）
  → MU-06（三态发送键）→ MU-17（边缘羽化）→ MU-11（空态 chips + 提醒卡）→ MU-28（tabular-nums / CJK 换行 / content-visibility）→ MU-33（轮播提示行）

第二梯队（每天都会用到，但要多改几处）
  MU-03（retry + 引用回复）→ MU-05（⌘K + 快捷键全集）→ MU-04（划词工具条）
  → MU-13（retry last turn）→ MU-23（长粘贴）→ MU-07（专注模式）→ MU-24（音效分档）→ MU-29（终端调色板）

第三梯队（结构/组件级）
  MU-14（设置搜索）→ MU-10（会话状态点/tag/排序）→ MU-09（todo/queue chip）
  → MU-12（TabBar 分组溢出）→ MU-19（轮次摘要）→ MU-18（标题切换器/dev 胶囊）→ MU-32（首页工作区 chip 行）→ MU-20 / MU-22 / MU-30

第四梯队（按需）
  MU-16（Git 面板）→ MU-08（模型思考胶囊）→ MU-31（审批卡）→ MU-25（会话画布）→ MU-26（SSE seq）→ MU-27（Todo 面板）
```

**每个 MU 的 DoD**（沿用既有纪律）：`tsc --noEmit` + `npm run lint` + `npm test` 通过；带一条可运行断言（`*.test.mjs`；纯 CSS 用皮肤脚本兜底）；在 `docs/codex-skin/delta.md` 登记接触面与回滚方式；截图对照（`docs/codex-skin/capture-themes.mjs` 出 6 色板基线图）。

---

## 7. 剩余工作一览（每个梯队还剩什么）

> 状态截至 2026-09-17 第三轮。**已做**：MU-01 / 02 / 15 / 21 / 32 / 33，MU-28 部分。
> 下面按梯队列出**还没做的**，每条写清「用户能感知到什么 / 为什么值得 / 落在哪 / 成本」。
> 依赖顺序：第二、三梯队内部基本互不依赖，可以任选；第四梯队是独立大件。

### 7.1 第一梯队（还差 2 项）

| 编号 | 用户能感知到什么 | 为什么值得 | 落在哪 | 成本 |
| --- | --- | --- | --- | --- |
| **MU-11** | 空会话页不再是「4 张卡 + 空白」：变成一行芯片式入口（能放更多入口、小窗口也不难看），下面多一张「未读 / 进行中」提醒卡，一键已读 | 这是新用户的第一个界面；卡片网格放不下第 5 个入口，提醒卡把「别的会话有动静」从侧栏徽标搬到会看见的地方 | `components/fork/NewSessionHome.tsx`（T0 改造）+ 复用 `SessionSidebar` 的 running/unread 数据（`onRunningSessionIdsChange` / `useSessionFlags`） | 中 |
| **MU-28 剩余** | —— | `content-visibility: auto` 能省长会话的渲染，但 minimap 与滚动恢复吃真实行高，**已评估不做**（见 §4.10），这条不用再动 | — | — |

### 7.2 第二梯队（每天都会用到的 8 项）

| 编号 | 用户能感知到什么 | 为什么值得 | 落在哪 | 成本 |
| --- | --- | --- | --- | --- |
| **MU-03** | 助手回复多一个「重试」按钮；任意消息多一个「引用回复」；助手消息也能「从这条开新会话」 | 现在重发要手动复制粘贴；引用回复是长对话里最基本的动作 | `components/MessageView.tsx:504-600`（用户行）与 `:886-929`（助手行），数据源现成（`entryIds` / `onEditContent` / `onFork`） | 低-中 |
| **MU-05** | `⌘K` 命令面板（动作 + 会话搜索两级）；`⌘B/J/E/⇧E/1..N/↓/F/,` 一串快捷键；设置里多一页**快捷键总表** | 功能一多就有「找不到」的问题；命令面板是兜底入口，快捷键是熟练用户的第一需求。这些键全部映射到**已有** handler | 新 `components/fork/CommandPalette.tsx` + `hooks/useKeyboardShortcuts.ts` + 设置分区 | 中 |
| **MU-04** | 在聊天里划一段文字 → 浮出小工具条：引用进输入框 / 复制 / 用它开新会话；另有 `⌘L` 引用选区、`⌘⇧L` 对选区「问一问」（不写进对话） | 文件查看器里已经有这套浮层（`FileSelectionQuotePopover`），聊天区却没有；`⌘L/⌘⇧L` 是 MusePi 里被用得最多的两条快捷键 | 新 `components/fork/SelectionToolbar.tsx` + `ChatWindow` 接线（复用现有浮层样式） | 中 |
| **MU-13** | 输入框空着时多一个「重试上一轮」按钮（自动重试状态已有显示，但用户无法手动重发） | 网络抖动/模型报错后不用重新打字 | `components/ChatInput.tsx` 控件行（复用 steer/followUp 的发送通道） | 低 |
| **MU-23** | 粘贴一大段文本时弹对话框：保持内联 / 包成代码块 / 存成附件 / 丢弃 | 现在长文本直接塞进 textarea 撑高，还会把上下文挤满 | `components/ChatInput.tsx` 的 paste 分支 + 一个 fork 对话框 | 低-中 |
| **MU-07** | `⌘⇧E` 专注模式：输入区放大占满，只留写作 | 长提示词/长回复时的舒适模式；实现约 30 行 CSS + 一个快捷键 | `ChatWindow` + `app/fork-ui.css` | 低 |
| **MU-24** | 提示音分事件：完成音之外补「出错」与「等待你确认」两类；重复点当前主题给一次短抖动反馈 | 长任务里「跑完了」和「卡住了」现在听起来一样 | `hooks/useAudio.ts` + 设置；抖动在 `hooks/useTheme.ts` | 低 |
| **MU-29** | 终端配色跟随主题（浅色主题下 `ls` / `git status` 的彩色输出不再看不清） | 现在终端配色写死在 JS（`globals.css:63-67` 的 ponytail 注释已确认）；参考实现用 `xtermTheme(scheme)` 出全套 16 色并有测试锁住 | `components/TerminalPanel.tsx:54` + `app/fork-ui.css` | 低 |

### 7.3 第三梯队（结构 / 组件级 9 项）

| 编号 | 用户能感知到什么 | 为什么值得 | 落在哪 | 成本 |
| --- | --- | --- | --- | --- |
| **MU-14** | 设置里能搜：输关键词，命中分区跳到该分区并高亮那一行 | 已经 5 个分区、几十个开关，全靠滚屏找 | `components/SettingsPanel.tsx` + `app/settings.css` | 中 |
| **MU-10** | 会话行有状态点（完成/中断/出错/中止/待办）+ 未读点；右键可打 tag、清 tag、复制路径、在 Finder 打开；「按项目/时间线」视图 + 「按更新/创建」排序 + 全部展开收起 | 会话一多就只剩标题和计数，看不出哪个跑完了哪个挂了 | `SessionSidebar.tsx` + `SessionRowContextMenuBridge.tsx` + `lib/session-flags.ts`（已有 localStorage 模式） | 中 |
| **MU-09** | 输入框上方多两个 chip：todo 进度（`3/7` + 填充条，点开清单）与队列条数（点开队列面板） | 长任务里「还有多少没做」「排队了几条」现在要翻消息才能知道；`lib/step-categorizer.ts` 已经能识别 todo 类工具 | `components/ComposerContextStrip.tsx` 邻位 + 一个 fork 弹层 | 低-中 |
| **MU-12** | 右栏标签多了就分层：常驻一组、次要收进 `…`；`⌘E` 开关面板 | 标签一多 `TabBar` 会横向挤压；参考实现用分组 rail 解决 | `components/TabBar.tsx` + `AppShell.tsx:2832` | 中 |
| **MU-19** | 每一轮结束多一行摘要：改了几个文件 / 跑了几条命令 / 几个工具 + 一键回到轮起点 | 现在只有 `ProcessDetailsGroup` 的折叠计数；「这轮到底动了什么」要展开才看得到 | `components/ChatWindow.tsx:255-320` + `ProcessGroup.tsx` | 中 |
| **MU-18** | 顶栏的会话标题变成可点的「最近会话 + 新建」下拉；多一个 dev server 胶囊（起/停/打开预览）；会话 `⋯` 里多「导出 Markdown」 | 换会话现在只能去侧栏；起项目 dev server 要切终端 | `AppShell.tsx` 顶栏 + `app/api/terminal` | 中 |
| **MU-20** | 路径类动作统一成三件套：复制路径 / 用默认应用打开 / 在 Finder 显示（文件树、Git、笔记面板共用） | 同一动作现在散在各面板各写一遍 | 新 `components/fork/PathActions.tsx` | 低 |
| **MU-22** | 设置里多一档「界面密度」（紧凑 / 标准 / 宽松），整体 padding 跟着缩放 | 高分屏用户想塞更多内容；已有字号/列宽滑杆，缺整体密度 | `app/fork-ui.css` + 设置 | 低 |
| **MU-30** | 浏览器面板能切视口（手机 / 平板 / 桌面宽度档 + 居中框），不用拿真机 | 做响应式时最常用的一步；iframe 目前固定 `width:100%` | `components/BrowserPanel.tsx:156-163` | 低 |

### 7.4 第四梯队（按需，6 项大件）

| 编号 | 用户能感知到什么 | 为什么值得 | 落在哪 | 成本 / 风险 |
| --- | --- | --- | --- | --- |
| **MU-16** | 右栏多一个 Git 面板：变更（flat / tree、逐行 stage/unstage、提交框）/ 提交历史（含 lane 图谱）/ PR | 现在只有文件树上的 `U/M` 角标，改动、提交、历史都要切终端 | 右栏新 surface + `app/api/git` 扩展 + 抄 `lib/git-graph-lanes.ts` 的分道算法（带测试） | 高 |
| **MU-08** | 模型与思考档合并成一个胶囊，窗口变窄时自动塌成纯图标 | 控件行在高分屏偏挤（模型名 + 思考档 + 工具预设 + 压缩 + 声音 + 发送） | `components/ChatInput.tsx:2570-2760` | 中（T2，会动控件行结构） |
| **MU-31** | 工具审批从「对话框式确认」升级成**审批卡**：显示工具名 + 参数摘要 + 风险档，按钮「允许一次 / 总是允许 / 拒绝」，并给全局确认热键 | 现在已经有 `ExtensionDialog` 在跑 `select/confirm/input/editor`，但审批这一路缺风险信息与「总是允许」；改法是升级已有卡，不用等引擎 | `components/ChatWindow.tsx:1785-1990` | 低-中 |
| **MU-25** | 会话内的消息树可以当画布看：缩放、搜索、点节点切分支、从节点 fork | 现在只有顶栏下拉式分支器，分支一多看不出结构；数据纯前端可算（`entry.parentId`） | 新 `components/fork/SessionCanvas.tsx` | 高（新交互面） |
| **MU-26** | 断网/刷新后事件不丢：SSE 带 `seq`，重连补发缺口 | 现在刷页或断线会丢中间事件，靠轮询兜底；参考实现是 `seq` + 8ms 批量 + journal | `lib/agent-event-stream.ts` + `hooks/useAgentSession.ts` | 中（碰事件协议，必须配实测） |
| **MU-27** ✅ 已做（只读面板 + 复制清单） | chip 是入口，面板才是操作面；引擎侧有 `todo` 工具即可闭环 | 右栏新 surface 或 composer 弹层 | 中 |

### 7.5 视需求（已评估、未排期）——§4.10 的同一批

- **SQLite 物化视图做跨会话搜索**：先量真实延迟，再决定要不要引索引
- **定时任务（cron）**：要新增调度器与持久化，属新功能不属 UI
- **两级 pause（会话 / 全局）**：我们单进程内嵌 SDK，没有 daemon 级 gate
- **声明式 slash 命令注册表**：命令数超过 ~15 条时再改
- **MCP 注册表搜索一键部署**：依赖外部注册表 API
- **`@file` 语义化注入**：**待核实**——展开行为取决于所嵌 pi SDK 版本，先实测
- **消息行 `content-visibility`**：已评估不做（见 §4.10）

### 7.6 建议的下一批（如果要继续）

```
批次 A（半天，纯收益、无结构改动）
  MU-13（retry last turn）→ MU-29（终端调色板）→ MU-24（音效分档）→ MU-20（PathActions）→ MU-22（界面密度）

批次 B（一天，交互面）
  MU-03（retry + 引用回复）→ MU-07（专注模式）→ MU-23（长粘贴）→ MU-11（空态 chips + 提醒卡）

批次 C（一天半，体系）
  MU-05（⌘K + 快捷键全集 + 设置里的快捷键表）→ MU-04（划词工具条 + ⌘L/⌘⇧L）

批次 D（按需，大件）
  MU-31（审批卡）→ MU-16（Git 面板）→ MU-08（模型思考胶囊）→ MU-27（Todo 面板）
  MU-25 / MU-26 单独评估（前者新交互面，后者碰事件协议）
```

---

## 8. 证据索引（MusePi 侧关键文件）

| 主题 | 文件 |
| --- | --- |
| 设计规范（布局/令牌/动效/浮层/拖拽/设置/i18n/音效） | `docs/gui-design.md`（276 行）、`docs/gui-design.zh-CN.md` |
| 实现契约与踩坑 | `docs/gui-implementation.md`（570 行）、`docs/gui-right-panel-redesign.md` |
| 令牌唯一来源 | `packages/guest-client/src/styles/tokens.css` |
| 壳层样式 | `packages/desktop-app/src/styles/gui-{base,chat,composer,chrome,settings,widgets,workspace,board,taskcenter,misc}.css` |
| 消息与工具卡 | `packages/guest-client/src/components/transcript/*`、`tool-render/*`（33 个工具渲染器） |
| Composer | `packages/desktop-app/src/components/Composer.tsx`、`composer/*`（22 个文件）、`action-buttons.tsx` |
| 顶栏 / 侧栏 / 右栏 | `GuiHeader.tsx`、`SessionSidebar.tsx`、`ContextPanel.tsx`、`RightRail.tsx`、`lib/surfaces/registry.ts` |
| 浮层基建 | `components/Pop.tsx`、`lib/use-floating-menu.tsx`、`lib/use-two-phase-enter.ts`、`DialogFrame.tsx` |
| 动效组件 | `Reveal.tsx`、`HeightMorph.tsx`、`FadeScroll.tsx`、`lib/use-scroll-shadow.ts`、`vendor/border-beam/*` |
| 快捷键 | `app.tsx:2386-2496`、`lib/shortcuts.ts`、`settings-sections/shortcuts.tsx` |
| 引擎/架构（本文只取 UI 相关） | `packages/coding-agent/src/daemon/{server,event-batcher,journal,view-store}.ts`、`slash-commands/*` |

**采集方法**（供复核）：本文的 file:line 全部来自 2026-09-17 对 `pi参考项目/MusePi-main` 的逐文件阅读（4 路并行清点：GUI 组件清单 / 视觉系统 / pi-web 现状 / 引擎能力），未运行构建、未截图比对；行号会随参考项目更新而漂移，按文件+符号名复核更稳。
