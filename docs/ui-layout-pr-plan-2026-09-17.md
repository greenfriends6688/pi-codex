# 布局 / 样式对比与「挪位置·改样式」PR 拆分

日期：2026-09-17
基准：本仓库 `@agegr/pi-web` 0.9.1 · Codex 皮肤 fork（Next.js 16 + pi SDK 0.85.1）
参考：`pi参考项目/pi-web-0.14.6`（上游）、`pi参考项目/Wegent-main`（Wegent Web / Wework 桌面）

> 本文只谈**布局与样式**（东西放哪、长什么样、什么时候可见），**不动功能语义**。
> 每个结论后面都跟一个「落到哪个 PR」，目标是：改完观感接近参考项目，但**下一次合并上游时冲突面不扩大**。

与既有文档的分工：

| 文档 | 管什么 | 本文是否重复 |
| --- | --- | --- |
| [`codex-skin/delta.md`](./codex-skin/delta.md) | 皮肤/布局改动台账 + 合并流水线 | 本文是它的**输入**，本轮落地已登记在 delta.md §19 |
| [`codex-skin/visual-spec.md`](./codex-skin/visual-spec.md) | 色板/圆角/排版刻度唯一依据 | 本文不改色板，只改度量与排布 |
| [`patches/README.md`](./patches/README.md) | **功能**补丁台账 + `fork:` 标记约定 | 本文沿用同一套标记与「优先新增文件」纪律 |
| [`ref-comparison-pr-plan.md`](./ref-comparison-pr-plan.md) | 上游/desktop/MusePi 的**代码级**借鉴（PR-01～15） | 本文补 **Wegent**（此前未覆盖）与**布局/样式**这一层 |
| [`desktop-ui-borrowing-plan-2026-09-16.md`](./desktop-ui-borrowing-plan-2026-09-16.md) | desktop 深度借鉴 | 不重复；去重表见 §6 |

---

## 0. 实施状态（2026-09-17 当天落地）

第一轮把「低风险 + 高观感收益」的一批做完了（§19），第二轮补齐了用户点名的上下文圆环、设置左列导航、正文列宽与顶栏溢出菜单（§20）。

| 编号 | 状态 | 备注 |
| --- | --- | --- |
| UI-01 | ✅ 已做 | 新增 `app/fork-ui.css`，`layout.tsx` 末尾导入（`// fork:ui-css`） |
| UI-02 | ✅ 已做 | 语义 token 别名 + `--radius-composer` 改为派生计算（像素不变） |
| UI-03 | ✅ 已做 | 侧栏默认宽 244、页脚图标化；分区动作上移**无需做** —— 项目/聊天分区标题行本来就有 `⋯` / `+` |
| UI-04 | ✅ 已做 | 右对齐 + `min(70%,620px)`，手机 92%，操作行常显保留 |
| UI-05 | ✅ 已做 | `components/fork/NewSessionHome.tsx` + 三语 i18n；Composer 改底部固定 |
| UI-06 | ⏸ 未做 | 需要先拆标签状态 + 给 resizer 加竖向模式，属重构而非改样式，见 §6 |
| UI-07 | ✅ 已做（调参） | 改为 `min(36vw,560)` 而非文档里的 42vw/640（保聊天列宽） |
| UI-08 | ✅ 已做 | 第二轮补成**左列导航**（184px 竖向 + 选中底色/左侧 accent 竖条） |
| UI-09 | ✅ **早已实现** | 静态清单误判为「嵌套模态」，实际已 `embedded` 内联 |
| UI-10 | 🟡 部分 | 手机 bottom-sheet 已做；`DialogShell` 全量移植明确不做（纯重构、无可视收益） |
| UI-11 | ✅ **早已实现** | `ProcessGroup` 流式期间本就保持最新一步展开 |
| UI-12 | ✅ **早已实现** | `useTheme` 已有 View Transition 圆形扩散 |
| UI-13 | ✅ 已做 | `html.keyboard-open` + 隐藏扩展状态条 |
| — | ✅ 第二轮新增 | **输入框旁上下文圆环**（用户点名）：13px conic-gradient，70/90 阈值取色，并入「压缩」按钮 |
| — | ✅ 第二轮新增 | 正文列宽 860→800（`--chat-content-max-width`） |
| UI-14 | ✅ 已做 | Tab 高 36 / tab 28 / 关闭键 hover 显现；第二轮补上顶栏 `⋯` 溢出菜单（系统提示 / 工具定义） |

> 本轮核对推翻了三项「计划要改其实已经对了」的判断（UI-09/11/12）——原文基于静态清单，
> 未逐行读代码。下面 §3 里对应的描述已就地更正，保留原文以免后人重蹈。


---

## 1. 三个项目的视觉语言，一句话

| | 我（0.9.1 Codex 皮肤） | 上游 0.14.6 | Wegent（Web / Wework 桌面） |
| --- | --- | --- | --- |
| 形态 | 单页双栏，聊天为唯一主体 | 单页双栏 + 宽屏第三栏 gutter | 多产品：Web 路由式 + 桌面「工作台」（右栏 + 底栏 + 工作区标签） |
| 语言 | **Codex**：单色墨、半透明细线、无彩度白面、安静表面 | 中性灰 + 蓝 `#2563eb`、语义化的字号 token、lucide 图标 | 中性灰 + 品牌紫蓝 `93 94 201`；桌面侧另有 Codex 风 DESIGN.md（蓝只用于焦点） |
| 密度 | 最紧：图标键 28、侧栏默认 224、正文 13px | 中：键 36、侧栏 260、正文 15px | 最松：侧栏 244 起、正文 14–16px、桌面控件 36、内容列 736–768px |
| 边界处理 | 细线 + 圆角胶囊 | 细线 + **全高单元格 tab** | 极淡线（`border/40`）+ **浮起卡片**（`rounded-3xl shadow-sidebar`） |

**共同趋势**（三家都做了，只有我没做，属于「该跟」）：① 用户消息**右对齐并限宽**；② 空会话有**首页/引导**；③ 面板**多标签 + 底部面板**承载终端与 diff；④ 设置用**左导航主从结构**；⑤ 对话框走**统一 shell**。见 §3。

---

## 2. 关键度量对照

| 度量 | 我 | 上游 0.14.6 | Wegent / Wework | 结论 |
| --- | --- | --- | --- | --- |
| 顶栏高 | 46（`--height-toolbar`） | 36（手机 44）；≥1280 用 56 的 TaskHeader | Web 44（无下边框）；Wework 标题栏 38 | **保持 46**（与 Codex 桌面 46 一致） |
| 面板工具条高 | 40（`--height-toolbar-pane`） | 36（手机 44） | 40（Wework pane toolbar） | 保持 40，**标签栏对齐到 36–40** |
| 侧栏默认宽 | 224（216–520） | 260（180–480） | Web 244（200–500）；Wework 240（240–480，DESIGN 写 300–520） | **加宽到 244–260** |
| 右栏默认宽 | 384（300–1200） | `clamp(42vw,360,640)`，fallback 560 | Wework 420（面板最小 260） | **改 `clamp(380,42vw,640)`** |
| 正文列宽 | 860 → **800** + 12 padding（2026-09-17 已调） | 760 + 16 padding | Web 768（`max-w-3xl`）/ Wework 736（46rem） | 已收窄到 800 |
| Composer 宽 / 圆 | 892 / 22px | 960 / 12（手机 20） | 820 / 16（手机 24） | 宽度保持；圆角**收回 token 体系** |
| 用户气泡 | 满宽、**左对齐**、`--bg-subtle` | `max-width:min(70%,620px)`、**右对齐**、`--user-bg`（蓝） | `min(560px,80vw)`、**右对齐**、`bg-muted`（中性） | **改右对齐 + 限宽**（颜色保持中性） |
| Tab 栏 / Tab 高 | 32 / 26 胶囊 | 36（手机 44）/ 36 全高单元 | Web 40（下边框）；Wework 40（含底栏） | **32→36** |
| 设置壳 | 模态 1080×84vh，tab 定宽 96（2026-09-17：已改为按内容宽度） | 全屏壳 `min(1080,dvw-32) × min(760,dvh-32)`，**左导航 184** | 路由页 + 横向 tab（手机 select） | 改**左导航**（结构级，见 UI-08） |
| 配置面板 | 设置壳内**内联**（`ConfigPanelShell embedded`，已实现，非嵌套模态） | 内置在设置页内（`240 / 1fr` 主从） | 路由页内 | **已完成**（原判断有误，见 §0） |
| 对话框 | 各自实现（440 / 600） | `DialogShell` 420/520/680/820/920，手机 bottom-sheet | shadcn dialog `max-w-lg`，手机 bottom-sheet | **取上游 DialogShell** |
| 移动断点 | 640 / 480，右栏 ≤640 全屏 | 640 / 960 / 1280 | 768 / 1024 / 1280 | 保持（本地已有 960 分栏） |

---

## 3. 分块对照（16 块）

每块固定四段：**我 / 上游 / Wegent / 结论**。结论只有三种：`保持`、`挪位置`、`改样式`。

### 3.1 外壳骨架（三栏 + 右栏）

- **我**：`AppShell` flex 行 = 侧栏 + 主区 + 右栏；右栏 ≥960 分栏、641–959 浮层 `min(560,100vw-48)`、≤640 全屏；`--sidebar-width` / `--right-panel-width` 运行时写入；皮肤台账 §11 §12 已加「文档 | 文件树」第三栏。
- **上游**：同为侧栏 + 中区 + 右栏；另在 ≥1280 给中区加 **292px 的上下文 gutter**（`DesktopConversationContext` 268 卡片），把"会话状态"从顶栏挪到聊天右侧常驻。
- **Wegent**：Wework 把工作台做成 **右栏 + 底栏 + 顶部工作区标签** 三层；右栏与聊天是**可拖拽的两栏**（聊天默认 420、面板最小 260），侧栏折叠后留 4px 悬停边触发预览。
- **结论**：**挪位置** —— ① 把终端/浏览器从右栏挪到新的**底栏**（UI-06）；② 右栏恢复成「文件 / 变更 / 文档」专用（UI-06 + UI-07）；③ 上下文信息**不**搬上游的 gutter（我的顶栏统计已够用，且 gutter 需要 ≥1280，收益低于改造成本）。

### 3.2 顶部栏

* **我**：46px；右侧一排 28px 图标键（无分隔线、无激活顶边）；会话标题最长 `min(46vw,560px)`；统计胶囊；三个下拉（会话信息/系统提示/工具定义）以 `position:fixed` 贴顶栏下沿全宽展开。

* **上游**：36px 紧凑栏，按钮是 **36px 宽的全高单元格 +&#x20;**`borderRight`**&#x20;分隔 + 激活 2px 顶边**；≥1280 换成 56px `TaskHeader`（两行：标题 + 状态；次级动作收进 `⋯` 菜单）。

* **Wegent**：Web 顶栏 `min-h 44`、**无下边框**，右侧 8×8 小图标键；Wework 标题栏 38px，**中间放工作区标签**，右侧窗口控制。

* **结论**：**改样式（小）** —— 保持 46 与 28px 键（Codex 纪律），但把**次级动作在窄宽度收进&#x20;**`⋯`**&#x20;溢出菜单**（上游 TaskHeader 的做法；我目前只有 ≤480 手机端这么做）。归入 UI-14。

### 3.3 侧栏

* **我**：扁平「项目 → 会话」树；项目行带彩色图标 chip + 计数；行槽 38px、胶囊 30px、`radius-md`；行 hover 出重命名/删除；底部一行三个**带文字**的入口（模型 / 技能 / 设置）。

* **上游**：`CodexSidebar` = 品牌头 40 + 「新任务」34 + 工作区工具条 32 + 搜索 32 + 导航区（`flex:1`）+ 项目工具（Git 变更 / Worktree，最高 46% 高）+ **40px 图标页脚**；行高 38/36/34，嵌套会话缩进 20。

* **Wegent**：侧栏是一张**浮起卡片**（`rounded-3xl shadow-sidebar my-2 pl-3`），头部 = 产品名 + 搜索 + 图标；分区（已安排/插件/应用/云端工作、项目、任务）标题行右侧放 `⋯` / `+`（hover 显现），行高 30–32，底部用户卡。

* **结论**：**改样式** —— ① 默认宽 224→244（UI-03）；② 页脚文字键改**图标 + tooltip**（上游页脚 40px，UI-03）；③ 分区级动作移到**分区标题行**（`⋯`/`+`），行内不再挂重命名/删除（减少行内噪声，UI-03）。**不搬**浮起卡片形态：我的侧栏与主区共边、参与拖拽分栏，改成卡片需要重做分栏几何，收益不抵风险。

### 3.4 空态 / 新会话首页

* **我**：空白区 + 垂直居中的 Composer（截图确认），没有 hero、没有引导、没有快捷入口。

* **上游**：`.new-session-home` = 居中 hero + **4 列起始卡片网格** + Composer（宽 960）。

* **Wegent**：hero + **恰好四个**快捷卡（DESIGN.md 明文："not a card dashboard"，一行 hero、一行四卡、底部 composer）；Wework 空态是**居中的快捷动作清单**（每行约 48px 的浅色行，右侧带快捷键提示）。

* **结论**：**新增（挪位置）** —— 这是三家对比里我**最明显的空白**。做 fork-only `NewSessionHome`（UI-05），只在「新会话且无消息」时出现，入口沿用现有 handler（新建/切项目/开文件/开终端/开浏览器），不新增功能。

### 3.5 消息列与气泡

* **我**：用户气泡 `flex:1` 满宽、**左对齐**、`--bg-subtle` + `--border-faint`、圆角 `--radius-xl`(15)、padding 12/16、`maxHeight 300` 内滚；助手无气泡；**两行操作区常显**（刻意的 fork 决定）；正文 13px。

* **上游**：用户气泡 **右对齐**、`max-width:min(70%,620px)`、`--user-bg`（浅蓝/深蓝）着色、圆角 14、padding 10/14；操作区 **hover 才出现**（`opacity:0 → 1`，触屏常显）；正文 15px。

* **Wegent**：用户气泡**右对齐**、`min(560px,80vw)`、`rounded-2xl`、`bg-muted`（中性不着色）；助手满宽 prose；操作键 `h-6 w-6` hover-only。

* **结论**：**改样式** —— ① 用户气泡改**右对齐 + 限宽**（两家一致，且这是最容易一眼看出的差异，UI-04，**2026-09-17 已做**）；② 颜色**保持中性**（上游的蓝底属它自己的色板，与本 fork Codex 单色纪律冲突）；③ 操作区**保持常显**（这是有意偏离，已登记在 delta.md，别改回去）。

### 3.6 过程 / 工具 / 推理

* **我**：`ProcessGroup`（fork 新增）= 时间轴主干 + 肘形折线，chip 27px，行 28px，推理体 `max-height: 6.2em` + 线性淡出；工具/思考**默认全收起**。

* **上游**：`ThinkingBlock` 框架行 + 时长；`ToolCallBlock` 卡圆角 7、**边框按成功/失败染色**（`rgba(34,197,94,.25)` / `rgba(248,113,113,.45)`）、details 内滚 520–560px；diff 用 `SplitPatchView` 两列网格 + 行号。

* **Wegent**：`ToolBlocksView` 把工具按组渲染，`defaultExpanded = running || !complete`（**运行中自动展开**）；文本步骤走 `DetailedThinkingView`；子组件细分（ToolCallItem / ToolResultItem / TodoListDisplay / SubagentBlock / CollapsibleContent）；diff 走 `DiffViewer` 卡。

* **结论**：**改样式（可见性）→ 2026-09-17 核对：无需改动**。`ProcessGroup` 的 `streamingOpen` 已经让最新一步在流式期间保持展开，结束后回到 `defaultOpen`（仅推理步骤默认展开）。当时写「默认全收起」是静态清单的误读。上游的绿/红边框染色与本 fork 的 token 化状态色二选一，**保持现状**（token 化优先）。

### 3.7 Composer

* **我**：`--composer-max-width:892`、圆角 22、`--bg-elev` + `--border` + `shadow-sm`，焦点 `--shadow-md + 3px --focus-ring`；控件行在壳内底部（模型 / 思考 / 工具 / 压缩 / 声音 / 圆形发送键 32）。

* **上游**：`.composer-shell` 圆角 12（手机 20）、padding 12/14、边框 `color-mix(border 80%)`、`0 2px 12px rgba(0,0,0,.06)`；工具行手机 `grid auto 1fr auto` / 桌面 flex；chip 高 28 圆角 999；**Queue dock 贴在壳上方**（圆角 `12 12 0 0`，行 36，列表最高 180）。

* **Wegent**：**卡片式**：`min-h 112`（桌面 146）、`max-w-[820px]`、圆角 16/24、**边框用强调色**（`border-primary/40`）、悬停 `shadow-card-hover`；「设备选择」做成**从顶边探出的 tab**（`-top-[29px]`）；有展开切换（10rem ↔ 20rem）；拖拽时整卡变虚线遮罩。

* **结论**：**保持为主 + 一处收口** —— ① 圆的 22px 是唯一不在圆角刻度上的值（`--radius-xl`=15、`--radius-2xl`=20），**归一到&#x20;**`--radius-2xl`**&#x20;或写进 token 派生的&#x20;**`--radius-composer`**&#x20;计算式**（UI-02）；② 不搬 Wegent 的强调色边框（与单色纪律冲突）；③ 不搬顶边探出 tab（我的控制行已足够）。

### 3.8 队列与上下文条

* **我**：`ComposerContextStrip`（引用附件 chip，26px 高，hover 出 ×）+ 引用式「compact composer」；没有独立队列条。

* **上游**：`QueueStrip`/queue dock = 壳上方连体区，行 36，>1 条可折叠，顶部圆角与壳对齐；steering 项带强调色边框。

* **Wegent**：队列/指引块在输入卡**上方**，`w-full`；移动端队列用 bottom-sheet。

* **结论**：**保持**（功能缺口落在既有 PR 计划 PR-07「队列单条操作」，属功能不属样式）。

### 3.9 右侧面板与标签栏

* **我**：面板头 40px（含「新建浏览器标签」），`TabBar` 32px、tab 26px 胶囊、`minWidth 80 / maxWidth 180`、无分隔线、关闭键常显；浏览器标签常驻挂载（`hidden` 切换）。

* **上游**：面板头 36/44，tab 是**全高单元格**（36，`borderRight` 分隔，激活面 = `--bg`），关闭键 24 hover 高亮。

* **Wegent**：右栏 tab 条 `h-10 px-3` + `border-b`，桌面可**把 tab 条搬进窗口标题栏**；关闭键 `18×18 rounded-full` hover 才出现；底栏 tab 条同样 `h-10`，且**切换不卸载**（`preserveContent`）；右栏可「展开为全宽」（隐藏对话）。

* **结论**：**改样式** —— ① tab 高 32→36、关闭键 hover-only（UI-14）；② **保留胶囊**（与 Codex 一致），不换全高单元格；③ 桌面标题栏移植**不做**（我没有原生标题栏，只有 Electron 壳，见既有 PR-11/14）。

### 3.10 文件树 / 变更 / 文档第三栏

* **我**：`ExplorerPanel`（fork 新增）在右栏，打开 Tab 时另渲染 `.explorer-column` 264px（容器查询 ≥760 才显示），实现「会话 | 文档 | 文件树」三栏。

* **上游**：文件树是右栏的**互斥回退内容**；变更列表 `GitChangesPanel` 放在侧栏项目工具区（行 28，左侧字母列 + 文件名 + 目录淡化）。

* **Wegent**：右栏 `files` 视图 = 树 + 预览 + CodeMirror 编辑器；`review` = diff；另有 `WorkItemContextPanel` 等业务面板。

* **结论**：**我领先，保持**。唯一可借：Wegent 把「变更/diff 也做成右栏 tab 类型」——我已有此结构（`file`/`terminal`/`browser`），保持。

### 3.11 终端 / 浏览器

* **我**：都在右栏当标签（`TerminalPanel` 头 38px + xterm；`BrowserPanel` 地址栏 + sandbox iframe）。

* **上游**：终端请求走 `DialogShell` 全屏对话框（`codex-dialog-terminal`），**没有常驻终端面板**。

* **Wegent**：终端在**底栏**（`BottomWorkspacePanel`，默认 320、上限 560、关闭态无 `border-t`、最小高 = 代码字号 ×1.2 + padding，xterm + Mac 键位）；浏览器在右栏（Electron webview / iframe）。

* **结论**：**挪位置** —— 新增底栏承载终端与浏览器（UI-06）。这是本次对比里**收益最大的结构改动**：终端的宽高比本来就该横着，而现在它和文件查看器抢同一个右栏宽度，聊天被压窄。

### 3.12 设置

* **我**：模态 1080×84vh；顶部 tab **定宽 96px** + 24×2 强调下划线；内容 `max-width 680`；模型/技能/插件/智能体是**第二层模态**（900×78vh，240px 主从分栏）；手机端 tab 换 `<select>`。

* **上游**：全屏壳 `min(1080,dvw-32) × min(760,dvh-32)`，**左列导航 184px** + 内容 `padding 28/32`；模型与资源设置是**设置页内的主从页**（导航 240，641–960 时 220，手机 `data-mobile-view` 列表/详情切换）；无 cwd 时技能/插件禁用。

* **Wegent**：设置是**路由页**，复用聊天同样的壳（侧栏 + 顶栏 + 内容）；tab 是横向按钮行（`border-t bg-surface px-4 py-2 overflow-x-auto`），手机 `<Select>`；编辑类用右侧抽屉（`h-[100vh] max-w-[860px]`）。

* **结论**：**已实现，无需再改** —— ① 配置面板本就在设置壳内内联（`embedded`，无第二层遮罩）；② 文档原先建议的「改内联」是误判。仍可选的只有 UI-08 的左列导航（结构级）。

### 3.13 对话框与弹窗

* **我**：`ProjectTrustDialog`（440）、`DirectoryPicker`（约 600）、各类确认框**各自实现**遮罩/Esc/焦点。

* **上游**：`DialogShell` = 原生 `<dialog>`，五档宽度（420/520/680/820/920），**手机端 confirm/request/editor 变 bottom-sheet、tool/terminal 变全屏**，遮罩 `blur(6px)`，方向键选择 + Enter 主操作 + 焦点归还。

* **Wegent**：shadcn `dialog`（`max-w-lg p-6`）、`alert-dialog` 管破坏性操作、`Modal` 尺寸映射、抽屉、手机 bottom-sheet 带拖拽手柄 `h-1 w-9 rounded-full`。

* **结论**：**新增 + 接线** —— 直接**原样落入上游&#x20;**`components/DialogShell.tsx`（UI-10）。这是"对未来合并最友好"的一类改动：新文件逐字等于上游未来版本，下次合并该文件自动通过；我现有的自定义对话框只需各改一处换成它。

### 3.14 右键菜单

* **我**：`ContextMenu`（fork 新增）portal + 固定定位 + 子菜单 + `is-danger` + 90ms 淡入。

* **上游**：无通用右键菜单（只有项目行 `⋯` 菜单 172px）。

* **Wegent**：业务级菜单，无通用件。

* **结论**：**保持**（我已领先）。

### 3.15 移动端

* **我**：≤640 侧栏改抽屉（280 / 85vw + 拖拽关闭）、右栏全屏、≤480 顶栏溢出菜单、Composer 字号 `max(16px, ...)` 防 iOS 缩放、`useViewportHeight` 写 `--app-viewport-height`、PWA。

* **上游**：同一套思路 + **44px 触控目标**、对话框 bottom-sheet、设置主从页 list/detail 切换、`html.keyboard-open`**&#x20;时隐藏目标面板与状态条**。

* **Wegent**：768/1024/1280 断点、`touch-target`(44px) 工具类、`smart-h-screen = min(100vh,100dvh)`、bottom-sheet 带手柄与安全区。

* **结论**：**改样式（小）** —— 补 `keyboard-open` 键盘态（UI-13）；断点不动（我 640/960 分栏已与 960 SPLIT 常量绑定）。

### 3.16 主题 / 壁纸

* **我**：6 套 Codex 调色板 + pi CLI 主题 JSON 叠加 + 壁纸层（scrim + 分区域模糊）—— 三家最深。

* **上游**：`light/dark/auto` + **View Transition 圆形扩散**切换动画 + `theme-color` 同步。

* **Wegent**：`data-theme` + `.dark` 双写、切换期 `.no-transition` 抑制过渡闪烁、存储键 `wegent.theme`。

* **结论**：**2026-09-17 核对：已经实现**（`setThemePreference` 内建 View Transition + reduced-motion 分支）。Wegent 的 `.no-transition` 守卫**不做**：本 fork 没有全局颜色过渡，切换期不存在渐变闪烁，加了只是无用规则。调色板与壁纸不动。

***

## 4. 汇总：要动的三张清单

### A. 挪位置（结构）

| # | 动作 | 从 | 到 | PR |
| --- | --- | --- | --- | --- |
| A1 | 终端 / 浏览器标签 | 右栏 | 新增底栏（可拖高，默认 320/上限 560） | UI-06 |
| A2 | 配置面板（模型/技能/插件/智能体） | 第二层模态 | 设置壳内内联 | UI-09 |
| A3 | 设置分区切换 | 顶部定宽 tab | 左侧 184px 导航列 | UI-08 |
| A4 | 侧栏分区动作（重命名/删除/新建） | 行内 hover | 分区标题行 `⋯` / `+` | UI-03 |
| A5 | 空会话引导 | 无 | 中区 hero + 一行快捷入口 | UI-05 |

### B. 改样式（观感）

| # | 动作 | 依据 | PR |
| --- | --- | --- | --- |
| B1 | 用户气泡右对齐 + `min(70%,620px)` | 上游 + Wegent 一致 | UI-04 |
| B2 | 侧栏默认宽 224 → 244 | 上游 260 / Wegent 244 | UI-03 |
| B3 | 右栏默认宽 → `clamp(380,42vw,640)` | 上游 42vw 公式 | UI-07 |
| B4 | Tab 高 32 → 36，关闭键 hover-only | 上游 36 / Wegent 40 | UI-14 |
| B5 | Composer 圆角收进 token 体系 | 22 不在刻度上 | UI-02 |
| B6 | 侧栏页脚改图标 + tooltip | 上游 40px 图标页脚 | UI-03 |
| B7 | 顶栏次级动作收进 `⋯` | 上游 TaskHeader | UI-14 |
| B8 | 运行中的工具行默认展开 | Wegent `running \|\| !complete` | UI-11 |

### C. 体系层（为「以后好合并」）

| # | 动作 | 收益 | PR |
| --- | --- | --- | --- |
| C1 | 新增 `app/fork-ui.css` 作为 fork 覆盖层 | 上游 `globals.css` 可整文件被替换，不再需要逐 hunk 重打 | UI-01 |
| C2 | 补上游的**语义 token 别名**（`--text-ui/--text-chat/--text-title/--text-meta/--leading-prose/--weight-*`） | 上游新增 CSS 引用这些名字时，我这边直接成立、不改值 | UI-02 |
| C3 | 原样落入上游 `DialogShell.tsx` | 该文件未来可自动合并 | UI-10 |
| C4 | 所有 fork 新增 UI 放 `components/fork/`，只依赖 `lib/` + 类型 | 上游换框架（0.10+ 已迁 TanStack）时，这部分不用重写 | UI-05/06/09 |

***

## 5. 「不影响以后收到上游更新」的落地纪律

上游从 0.10 起已把 Next.js 换成 **TanStack Start + Vite + Nitro**，也就是说**下一次合并本来就要重接大量上游文件**。所以纪律只有一条：**把我们的东西尽量挪到上游不会碰的地方**。

### 5.1 三个接触面等级（每个 PR 必须自报等级）

| 等级 | 含义 | 合并时的代价 | 允许做吗 |
| --- | --- | --- | --- |
| **T0 零接触** | 只新增 fork-only 文件（`components/fork/*`、`app/fork-ui.css`、`lib/fork/*`） | 无冲突 | 鼓励 |
| **T1 接线** | 上游文件内 ≤10 行改动，且每处带 `// fork:ui-<slug>` 标记 | `grep -rn "fork:ui-<slug>"` 拿到清单，按台账重打 | 允许，但必须登记 |
| **T2 结构性** | 重写上游组件的 DOM/状态结构 | 按 `delta.md` 重新贴皮肤 | 仅当 §3 明确"要动"时才做，且必须"取上游结构 + 覆盖层" |

### 5.2 CSS 分层（UI-01 打底）

```
app/layout.tsx
  import "./globals.css";       ← 上游文件（皮肤已整篇重写过，继续保留）
  import "./settings.css";      ← fork 新增（设置相关）
  import "./wallpaper.css";     ← fork 新增（壁纸）
  import "./fork-ui.css";       ← 新增：本次全部覆盖写这里（// fork:ui-css）
```

规则：
1. **不再往&#x20;**`globals.css`**&#x20;末尾追加覆盖**（那里现在有 695 行的 `!important` 覆盖层，越长越难合并）。新覆盖一律写 `fork-ui.css`。

2. `fork-ui.css` 里每条覆盖都写明**来源与理由**：`/* fork:ui-04 ← upstream .chat-user-row（0.14.6 globals.css:4779）*/`。

3. 选择器优先用 `.fork-*` 类名或 `:where()`，避免为了压过内联样式而生出新的 `!important` 岛。

4. 退役路径：等上游把我想要的结构做出来了，**删掉**对应覆盖块，而不是留着重写。

### 5.3 每个 UI PR 的 DoD

- `node_modules/.bin/tsc --noEmit` + `npm run lint` + `npm test` 通过；
- 自带一条可运行的断言（现有约定：`*.test.mjs`；纯 CSS 改动则用 `docs/codex-skin/audit-tokens.mjs` / `verify-themes.mjs` 兜底）；
- 更新 `docs/codex-skin/delta.md`（新增一节：改了什么、接触面、如何回滚），T2 项另在 `docs/patches/` 留说明；
- 截图对照：`docs/codex-skin/capture-themes.mjs` 出图，与 `skin-v0.9.1-*.png` 基线比一眼；
- 可独立 revert（一个 PR 一个意图，互不依赖——`UI-01` 是唯一前置）。

---

## 6. PR 拆分

> 命名 `UI-nn`，与既有 `PR-01…PR-15` 区分。每项都可单独合入、单独回滚。
> 「接触面」按 §5.1 的 T0/T1/T2 标注。

### UI-01（T0）CSS 分层基建：`app/fork-ui.css` — ✅ 2026-09-17 已做
- **做什么**：新增空文件 + `layout.tsx` 一行 import（末尾）+ `delta.md` 记一节（约定 §5.2 原文）。
- **接触面**：`app/layout.tsx` 1 行（T1，带 `// fork:ui-css`）。
- **风险**：零（空文件）。**验收**：`tsc` 通过；构建产物 CSS 顺序为 globals → settings → wallpaper → fork-ui。

### UI-02（T0）语义 token 别名 + 圆角收口 — ✅ 2026-09-17 已做
- **做什么**：在 `fork-ui.css` 的 `:root` 补上游同名的语义排版 token 别名（`--text-ui/--text-chat/--text-title/--text-meta/--leading-prose/--leading-ui/--weight-medium/--weight-semibold`），值**映射到我的现有刻度**（13/14/12…），不改变任何观感；把 `--radius-composer: 22px` 改为由 `--radius-2xl` 派生的 calc（或明确写进 `:root` 注释为"皮肤常量"）。
- **接触面**：T0 纯新增 + `globals.css` 删除 1 行。
- **风险**：低。**验收**：`audit-tokens.mjs` 通过；`verify-themes.mjs` 不变；截图逐像素无差异（除 Composer 圆角 ≤2px）。

### UI-03（T1）侧栏：宽度 / 页脚 / 分区动作 — ✅ 已做（宽度 + 页脚）；⏸ 分区动作上移未做
- **做什么**：`SIDEBAR_DEFAULT_WIDTH` 224→244（min 216 保持）；页脚三个文字键改 40px 图标 + `title`；重命名/删除/新建从行内 hover 收进**分区标题行**（项目区 `⋯` + `+`，会话区 `⋯`）——沿用现有 handler，不加功能。
- **接触面**：`lib/panel-layout.ts`（1 行，T1）、`components/SessionSidebar.tsx`（页脚 + 分区标题，约 3 处，T1）。
- **风险**：中——虚拟列表定位依赖 `SESSION_LIST_ITEM_HEIGHT`，本 PR **不动**该常量；分区动作迁移后要核对右键菜单（`SessionRowContextMenuBridge`）仍能拿到同一批回调。
- **验收**：项目/会话的创建、重命名、删除三个动作在新的位置均可用；虚拟滚动无错位；`SessionSidebar.*.test.mjs` 全绿。

### UI-04（T1）用户气泡右对齐 + 限宽 — ✅ 2026-09-17 已做
- **做什么**：`MessageView` 用户行 `alignItems: flex-end`，气泡 `maxWidth: min(70%, 620px)`（去掉 `flex:1`），手机 92%；**保持** `--bg-subtle` + `--border-faint`；**保持**两行操作区常显。
- **接触面**：`components/MessageView.tsx`（1 处，T1）；`delta.md` 的「行为冲突」节补一行（提醒：合上游时上游已是右对齐，届时删掉本地覆盖）。
- **风险**：低-中——长命令/多图消息在 620px 内会换行，需要确认 `USER_BUBBLE_MAX_HEIGHT=300` 内滚仍符合预期。
- **验收**：短消息右对齐、长消息不超 70%；图片网格不溢出；编辑态（`onEditContent`）宽度一致。

### UI-05（T0）新会话首页 `components/fork/NewSessionHome.tsx` — ✅ 2026-09-17 已做
- **做什么**：fork-only 组件。只在「新会话 && 消息数 0 && 不在 validating」时渲染：一行 hero（标题 + 一句副标题）+ **一行四个快捷入口**（新建会话 / 打开文件 / 打开终端 / 切换项目），入口全部复用现有 handler；Composer 位置不变（仍居中）。
- **接触面**：`components/ChatWindow.tsx` 一处条件分支（T1，`// fork:ui-newhome`）；其余 T0。
- **风险**：中——空态与 Composer 的垂直布局要一起调（现在 Composer 靠两个 `flex-1` 撑到中间）。
- **验收**：新会话显示首页、发第一条后消失；四个入口各自生效；`ChatWindow.*.test.mjs` 全绿。

### UI-06（T0）底部面板 `components/fork/BottomPanel.tsx`（终端 / 浏览器下移）— ⏸ 本次未做

> **为什么跳过**：`activeFileTabId` 由文件/终端/浏览器三类共用，`handleCloseFileTab` 里还混着工作区翻转与右栏开关逻辑（`AppShell.tsx:1160-1200`），不是「一个挂载点」。改动必须伴随四档截图实测，而本机没有可用浏览器时盲改风险高于收益。下次做时先把 tab 状态拆成「右栏 tab / 底栏 tab」两个 activeId，再搬渲染块。
- **做什么**：fork-only 底栏，承载 `terminal` / `browser` 两类标签；默认高 320、上限 560、关闭态无 `border-t`、最小高 = 代码字号 ×1.2 + padding；拖拽改高（复用现有 `panelResizer` 的指针逻辑）；右栏从此只留 `file`/变更/文档。标签状态沿用 `terminal-tab-state.ts` / `browser-tab-state.ts`。
- **接触面**：`AppShell` 挂载点 1 处（T1，`// fork:ui-bottompanel`）；`lib/panel-layout.ts` 加一个常量（T1）。
- **风险**：中-高——三栏 + 底栏的网格要重新算（≥960 分栏、≤640 全屏的既有规则都要复核）；终端 xterm 在高度变化时要 `fit()` 重算。
- **验收**：终端在底栏可交互、改高后 xterm 自适应；右栏不再出现终端标签；切标签不重载；移动端底栏默认收起。

### UI-07（T1）右栏宽度公式 — ✅ 2026-09-17 已做（上限改为 560，见下）
- **做什么**：`RIGHT_PANEL_FALLBACK_WIDTH` 384 → `clamp(380, 42vw, 640)`（对齐上游），保持 min 300 / max 1200；`--explorer-column-width` 264 保持。
- **接触面**：`lib/panel-layout.ts`（T1）。**风险**：低（但和 UI-06 同改此文件，注意顺序）。**验收**：1440 / 1920 / 960 三档宽度下右栏与聊天列都不小于各自下限。

### UI-08（T2，可选）设置改「左列导航 + 内容」 — 🟡 只做了 CSS-only 版（tab 按内容宽度）
- **做什么**：把 `SettingsPanel` 顶部 96px 定宽 tab 换成 184px 左列导航（对齐上游 `SettingsPage` 的 `grid-template-columns: 184px minmax(0,1fr)`），手机仍走 `<select>`。
- **接触面**：`components/SettingsPanel.tsx`（T2）、`app/settings.css`（fork 文件）。
- **风险**：中——这是上游文件的结构改动，会进 `delta.md` 的皮肤接触面。**缓解**：先做「tab 按内容宽度 + 允许换行」的 CSS-only 版本（零结构改动）观察一周，确有必要再升 T2。
- **验收**：四个分区可切换、键盘可达；手机 select 仍工作；`SettingsPanel.test.mjs` / `SettingsUi.test.mjs` 全绿。

### UI-09（T1）配置面板内联化 — ✅ **早已实现，本次核对确认**
- **做什么**：在设置壳内渲染「模型/技能/插件/智能体」时传 `embedded`，走**已存在**的 `.config-panel-root.is-embedded`（`app/settings.css:7`），不再叠第二层遮罩；返回按钮改面包屑/左上返回。
- **接触面**：4 处调用点（`SettingsPanel`/`ModelsConfig`/`SkillsConfig`/`PluginsConfig`/`AgentsConfig`，各 1–2 行，T1）。
- **风险**：低-中——两层壳的滚动位置与 Esc 层级要复核（Esc 现在只应关内层）。
- **验收**：四个面板在设置内打开时无第二层遮罩；移动端仍全屏；Esc/返回行为正确。

### UI-10（T0+T1）统一 `DialogShell` — 🟡 只做了手机 bottom-sheet（可见部分）；全量移植未做
- **做什么**：原样落入上游 `components/DialogShell.tsx`（含 `.codex-dialog-*` 样式，移植进 `fork-ui.css`），`ProjectTrustDialog`、`DirectoryPicker`、删除/覆盖类确认框各换一次；手机端自动获得 bottom-sheet。
- **接触面**：新增文件 T0；替换点 4–6 处 T1。
- **风险**：中——原生 `<dialog>` 与现有 portal 遮罩的 z-index 体系要对齐（我 `--z-modal:1000`）；`DirectoryPicker` 有移动端触控高度规则要迁。
- **验收**：对话框焦点陷阱/Esc/焦点归还一致；手机端 confirm 类为 bottom-sheet；`DialogConfirmations.test.mjs` 类断言照旧通过。

### UI-11（T0）运行中的工具行默认展开 — ✅ **早已实现，本次核对确认**
- **做什么**：`ProcessGroup` 行的默认展开态 = `running || !complete`，结束后自动收起（用户手动展开过的行不自动收）。功能不变，只改默认可见性。
- **接触面**：`components/ProcessGroup.tsx`（T0，fork 新增文件）。
- **风险**：低。**验收**：长跑工具运行中可见输出；跑完自动收起；手动展开状态不被覆盖；`ProcessGroup.test.mjs` 补 1 例。

### UI-12（T1）主题切换动效 + 防闪烁 — ✅ **早已实现，本次核对确认**
- **做什么**：抄上游的 View Transition 圆形扩散（`hooks/useTheme.ts`），抄 Wegent 的 `.no-transition` 切换期抑制（写进 `fork-ui.css`）；`prefers-reduced-motion` 直接跳过动画。
- **接触面**：`hooks/useTheme.ts`（2 处，T1）+ `fork-ui.css`（T0）。
- **风险**：低。**验收**：切换主题有扩散动画；无动画偏好下瞬切；`theme-color` 与壁纸层不闪。

### UI-13（T0）移动端键盘态 — ✅ 2026-09-17 已做
- **做什么**：`visualViewport` 判定键盘弹起时给 `<html>` 加 `.keyboard-open`（复用已有 `useViewportHeight`），`fork-ui.css` 里在键盘态隐藏扩展状态栏、把 Composer 贴底。
- **接触面**：`hooks/useViewportHeight.ts`（1 处，T1）+ `fork-ui.css`（T0）。
- **风险**：低-中（iOS 判断要有阈值）。**验收**：iOS Safari 聚焦输入框时状态栏让位、Composer 不被键盘遮挡。

### UI-14（T1）顶栏与标签栏的密度对齐 — ✅ 标签栏已做；⏸ 顶栏溢出菜单未做
- **做什么**：`TabBar` 高 32→36、tab 26→28、关闭键改 18px 圆形且 hover-only（Wegent）；顶栏次级动作（系统提示、工具定义、分支）在宽度不足时收进 `⋯`（上游 TaskHeader 的做法）。
- **接触面**：`components/TabBar.tsx`（T1）、`components/AppShell.tsx`（跟随已有 `useIsNarrowMobile` 分支，T1）。
- **风险**：低。**验收**：标签可点/可关；窄窗口无按钮重叠；`AppShell.mobile-toolbar.test.mjs` 全绿。

### 与既有 PR 计划的去重

| 既有 | 本文关系 |
| --- | --- |
| PR-08（统一 `DialogShell`） | **同一件事**，本文收敛为 UI-10（并明确「原样取上游文件」） |
| PR-10（右栏 tab + keep-alive） | UI-14 只做尺寸；keep-alive 仍走 PR-10 |
| PR-06（归档 + 项目注册表） | UI-03 的分区动作是它的 UI 前置，不重复实现 |
| PR-03（流式合批）/ PR-05（tok/s） | 纯逻辑，与布局无关 |
| PR-12（欢迎大厅） | UI-05 是**轻量版**（不扫别家编辑器最近项目）；PR-12 若要做得更重，在 UI-05 之上加数据源 |
| desktop-ui 计划的 B3（input-compact）/ B6（欢迎大厅） | B3 不做；B6 见上一行 |

---

## 7. 执行顺序

```
第一梯队（1 天，零/低风险，先打地基）
  UI-01 → UI-02 → UI-04 → UI-07 → UI-11

第二梯队（1–2 天，观感收益最大）
  UI-14 → UI-03 → UI-09 → UI-12 → UI-13

第三梯队（3–5 天，结构动，需实测）
  UI-05 → UI-06        ← 两件都要截图对照 1440/1920/960/390 四档

第四梯队（按需）
  UI-08（先跑一周 CSS-only 版本再决定）→ UI-10
```

## 8. 明确不做

| 不做 | 为什么 |
| --- | --- |
| 引入 `lucide-react` / `@heroicons` / shadcn | 我自绘 SVG + token 化 CSS，加图标库会与皮肤台账打架，收益只是"省几个 SVG" |
| 侧栏改浮起卡片（Wegent） | 卡片形态不需要与主区共边，会推翻现有拖拽分栏几何 |
| 设置改路由页（Wegent） | 我是单页 + URL state 架构，改路由牵动 AppShell 整条状态链 |
| 搬上游 0.14.6 的上下文 gutter（≥1280 第三栏） | 与 UI-06 的底栏方向不同；我的顶栏统计已覆盖同一信息 |
| 搬上游 `CodexSidebar` 整块 | 我的侧栏有项目树/独立聊天/归档置顶等自有能力，整块替换会丢 |
| 改用户气泡底色 / 加强调色边框 | Codex 单色纪律（`visual-spec.md`）；两家的着色属各自色板 |
| 恢复操作区 hover-only 门控 | delta.md 已登记为**有意偏离** |
| 跟上游 TanStack 迁移 | 57k 行 + 自制皮肤，负收益（既有 PR 计划 C4 已定论） |

## 9. 文件索引

- 上游布局关键文件：`components/AppShell.tsx`、`components/CodexSidebar.tsx`、`components/TaskHeader.tsx`、`components/SettingsPage.tsx`、`components/DialogShell.tsx`、`components/DesktopConversationContext.tsx`、`components/GitChangesPanel.tsx`、`app/globals.css`（对话框 73–229 / 设置 2188–3031 / 资源设置 4236–4547 / 工作区 gutter 4800–4823）、`lib/panel-layout.ts`。
- Wegent Web 关键文件：`frontend/src/app/(tasks)/chat/ChatPageDesktop.tsx`、`frontend/src/features/tasks/components/sidebar/{TaskSidebar,ResizableSidebar,TaskListSection}.tsx`、`frontend/src/features/tasks/components/input/ChatInputCard.tsx`、`frontend/src/features/tasks/components/chat/{ChatArea,MessagesArea}.tsx`、`frontend/src/features/tasks/components/workbench/Workbench.tsx`、`frontend/src/app/globals.css`、`frontend/tailwind.config.js`。
- Wework 桌面关键文件：`wework/DESIGN.md`（§3 度量 / §5 壳与侧栏）、`wework/src/components/topnav/ChromeTitlebar.tsx`、`wework/src/components/layout/DesktopWorkbenchLayout.tsx`、`workspace-panels/{RightWorkspacePanel,BottomWorkspacePanel,useResizableWorkspacePanel}.ts`、`wework/src/components/chat/MessageList.tsx`、`wework/src/styles/globals.css`。
- 我的接触面台账：`docs/codex-skin/delta.md` §117–201（皮肤改动点）、§587–660（界面调整 §10–12）；`docs/patches/README.md`（`fork:` 标记约定）。
- 截图基线：`skin-v0.9.1-{light,dark,mist,rose,pine,settings-themes}.png`（`docs/codex-skin/capture-themes.mjs` 生成）。
