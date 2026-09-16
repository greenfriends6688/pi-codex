# Codex 皮肤改造台账

本文件记录 pi-web 相对上游的全部**皮肤/布局**改动，用于将来合并上游更新时快速定位冲突并重打皮肤。这里不应出现任何功能改动；如果你发现台账之外的行为差异，视为合并事故。

## 版本与分支

| 分支/引用 | 内容 |
|---|---|
| `upstream` | 纯净上游快照链：`68e746c` = v0.9.0 原始源码包 → `aeffa53` = v0.9.1 原始源码包 |
| `main` | `a43952b` 本地基线（v0.9.0 + 旧配色改造）→ 12 个皮肤提交（`94c7741`）→ `166abb8` merge upstream v0.9.1 → `6bd923f` 剔除 Electron |
| `backup/pre-0.9.1-merge` | 合并 0.9.1 之前的 main 快照（`94c7741`），回滚用 |
| worktree | `../pi-web-upstream` 挂在 `upstream` 分支，专门用于落新版本源码包 |

**当前基线版本：v0.9.1**

## 更新流水线（收到新源码包时）

1. 先核对版本来源：以 npm `@agegr/pi-web` latest / GitHub Release 为准，不要只看 semver 最大的 tag（历史上 `v0.10.5` 比 `v0.9.0` 更早，是分叉线）。
2. 在 `../pi-web-upstream` 解压覆盖新包，提交为 `upstream vX.Y.Z`：
   ```bash
   rsync -a --delete --exclude '.git' --exclude 'node_modules' \
     --exclude '.next' --exclude 'release' --exclude '.DS_Store' \
     <新包目录>/ ../pi-web-upstream/
   git add -A && git add -f build     # build/ 被 .gitignore 的 /build 忽略，需 -f
   git commit -m "upstream vX.Y.Z (pristine upstream tarball)"
   ```
3. 回主仓库 `git merge upstream`；冲突只应出现在本台账列出的文件。
4. 冲突策略：**逻辑冲突一律取上游；皮肤冲突按本台账重打**。
5. `npm install`（依赖变化时）→ `tsc --noEmit` → `npm run lint` → `npm test` → `node docs/codex-skin/audit-tokens.mjs`。
   已知唯一环境性测试失败：`uses the CLI global lock location` 依赖全局安装，可在干净环境复现，与本皮肤无关。
6. 提交 merge commit，打 tag `skin-vX.Y.Z`，并把本台账的"当前基线版本"更新为新版本。

---

## v0.9.0 → v0.9.1 合并记录（下次照做）

上游 v0.9.1 的主要变化：新增 **Electron 桌面端**、Web 登录/鉴权页、Provider 用量统计、子代理队列、文本预览、终端改进；**主题从「亮/暗/auto」3 态升级为 6 套**（light / dark / mist / rose / pine / auto，用 `data-theme` 属性）；把内联样式组件化（`ConfigButton` 等）；把**主题选择与语言切换从顶栏搬进 `SettingsPanel`**。

冲突面：**10 个文件 / 25 处**，其余全部自动合并成功（含 3 个 i18n 文件、`package-lock.json`、`FileViewer`、`useAgentSession`、`SettingsPanel`）。

### A. 纯皮肤冲突 → 取本地（HEAD）

上游只是把 `--primary-bg` 重构成 `--accent`、把圆角数字换成字面量；本地那侧才是皮肤，直接取 HEAD：

`app/settings.css`（2）、`components/SessionSidebar.tsx`（1）、`components/ChatWindow.tsx`（2）、
`components/DirectoryPicker.tsx`（1）、`components/ProjectTrustDialog.tsx`（1）

### B. 结构性冲突 → 取上游，再补皮肤

**`components/ModelsConfig.tsx`（10 处，最费手）**
上游把内联样式抽成 `ConfigButton` / `ConfigDetailHeader` / `ConfigDetailHeaderInfo` / `ConfigDetailActions`（组件定义在 `components/SettingsUi.tsx`，样式在 `app/settings.css`），并把登录/登出按钮搬进 header、新增 `ProviderUsageSummary`。
→ 取上游结构。但上游在这份文件里**重新引入了硬编码色**，需打回 token：`#4ade80` / `#16a34a` → `var(--success)`，`#f87171` → `var(--danger)`。另有 5 处上游数字圆角需换回 `var(--radius-*)`（`4`/`5` → `--radius-xs`，`6`/`7` → `--radius-sm`，`10` → `--radius-md`；`borderRadius: 3` 的 T 徽章本地原本就保留字面量）。

**`components/ChatInput.tsx`（2 处）**
取上游新增的 `ref={atMenuRef}`（@ 菜单定位，本地那侧只有 `className="anim-popover"`，两者都要）；发送键保留本地底部栏的圆形实现（`{!isMobile && (isStreaming ? stopButton : sendButton)}`），丢弃上游的带文字按钮。

**`components/AppShell.tsx`（4 处）**
上游删除了顶栏的 `renderThemeButton` / `renderLanguageButton` / 语言下拉 / `languageBtnRef` / `LANGUAGE_MENU_WIDTH` / `activeTopPanel` 的 `"language"` 分支，改由 `SettingsPanel` 承担。
→ 取上游结构。**注意 JSX 配对**：上游把 `{!isMobile && (` 的内容换成 `<>` 片段，而本地那侧是 `<div style={{...marginLeft:"auto"}}>` + `</div>` 收尾；合并后会出现 `<>` 配 `</div>` 的失配，`tsc` 报 `TS17015`。修复方式是恢复本地那层 flex 包裹（去掉已删除的两个按钮）：

```jsx
{!isMobile && (
  <div style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 4, marginLeft: "auto", minWidth: 0 }}>
    {renderProjectTrustWarning(false)}
    {renderChatToolbarActions(false)}
    {renderSessionStatsButton(false)}
    {renderMainFileToggle(false)}
  </div>
)}
```

顶栏尺寸常量保持本地的 `TOP_BAR_ICON_BUTTON_SIZE = 28`（上游是 36）。

### C. 行为冲突 → 取本地行为 + 上游 helper

**`components/MessageView.tsx`（1 处）**
本地刻意在非流式时隐藏模型标签（Codex 的"安静表面"），上游改为始终显示、只把 token 估算放进 `isStreaming` 分支。
→ 保留本地的 `{isStreaming && (...)}` 包裹，但采用上游新抽出的 `getModelDisplayName()` helper 替换本地原来的内联 `modelNames?.[...]` 查找。

### 三个必查陷阱

1. **自造 token 必须存活。** `--primary-bg` / `--primary-fg` / `--primary-hover` 以及整套 `--radius-*`（含 `--corner-radius-scale`）**是本地发明的，上游 0.9.0 和 0.9.1 都没有**。本地 8 个文件依赖它们（`globals.css`、`settings.css`、`ModelsConfig`、`SessionSidebar`、`DirectoryPicker`、`ChatWindow`、`ProjectTrustDialog`、`ChatInput`）。一旦 `app/globals.css` 的主题块取了上游那侧，这些 token 会全部 undefined，样式大面积塌掉。**合并后务必跑 `audit-tokens.mjs`。**

2. **重复主题块会静默覆盖重打结果。** 这次踩到了：冲突区只覆盖 `:root` 与 `html.dark` 两块，上游新增的 `[data-theme="mist"]` / `[data-theme="rose"]` / `[data-theme="pine"]` 是**冲突区之外**的上下文，会自动合并保留。如果重打时在冲突区内又写了一遍这三套调色板，文件里就会出现**两份同名选择器**，后一份（上游原色）胜出——`tsc`、`lint`、`audit-tokens.mjs` 全都发现不了，只有真实渲染才暴露。
   **对策**：重打完主题层后 `grep -c 'data-theme="mist"' app/globals.css`，每个主题选择器必须**恰好出现 1 次**。同时跑下面的渲染核对。

3. **上游会重新引入硬编码色。** 除 ModelsConfig 外，`settings.css` 等文件也可能被上游改回字面量。取上游结构后逐文件确认硬编码色是否已 token 化。

### 渲染核对（改过主题层后必跑）

仅靠静态检查不够，必须让浏览器实际解析一遍 CSS 并读回 computed value：

```js
// 逐主题写入 localStorage 的 pi-theme，reload 后读 documentElement 上的 token
// 期望：data-theme 与 pi-theme 一致；dark 类只对 dark/pine 为 true；
//       --bg / --text / --accent / --primary-bg 取自本皮肤的调色板（而非上游原色）
//       --radius-md 解析为 calc(8px * 1.25) 形态
```

参考值（本节内容在「细节精修」一节后已改为暖色 oklch，当前值见下表）：

| theme | dark 类 | --bg | --text | --accent | --primary-bg |
|---|---|---|---|---|---|
| light | false | `oklch(1 0 0)` | `oklch(0.26 0 0)` | `oklch(0.66 0.16 250)` | `oklch(0.26 0 0)` |
| dark | true | `oklch(0.22 0.008 60)` | `oklch(0.94 0.01 85)` | `oklch(0.84 0.08 245)` | `oklch(0.94 0.01 85)` |
| mist | false | `oklch(0.985 0.005 165)` | `oklch(0.27 0.02 165)` | `oklch(0.46 0.07 178)` | `oklch(0.27 0.02 165)` |
| rose | false | `oklch(0.987 0.005 20)` | `oklch(0.28 0.015 12)` | `oklch(0.47 0.1 5)` | `oklch(0.28 0.015 12)` |
| pine | true | `oklch(0.22 0.008 155)` | `oklch(0.94 0.012 155)` | `oklch(0.82 0.05 155)` | `oklch(0.94 0.012 155)` |

> `verify-themes.mjs` 会把两边的 oklch 归一化成数值三元组再比，所以生产构建把
> `oklch(0.995 0.004 85)` 压缩成 `oklch(99.5% .004 85)` 也不会误报。

> 本机 Playwright 1.63 不支持 macOS 12 的 chromium 构建（`Playwright does not support chromium on mac12-arm64`），改用系统 Chrome：`chromium.launch({ channel: "chrome" })`。

---

## 皮肤改动点

### 基座 `app/globals.css` — 6 套主题全部按 Codex 设计语言重打

上游 v0.9.1 的主题结构是 `data-theme` 选调色板 + `.dark` 类同步（由 `hooks/useTheme.ts` 维护，`isDarkTheme()` 认定 `dark` 与 `pine` 属于暗色系）。本皮肤**采纳该机制**，但把 6 套调色板全部改写成 Codex 设计语言：分层表面、半透明细线而非实心灰、三级前景 alpha、单一单色主操作。**各主题之间只差强调色色相与中性色的极淡色调偏移。**

文件结构：

```css
:root { /* 主题无关：圆角尺度、阴影/描边、布局度量、动效时长 */ }

:root,
[data-theme="light"] { color-scheme: light; /* Codex light：白面 + 近黑墨 + 蓝强调 */ }

html.dark,
[data-theme="dark"]  { color-scheme: dark;  /* Codex dark：分层近黑 + 白墨 + 蓝强调 */ }

[data-theme="mist"]  { color-scheme: light; /* Codex light 面 + 极淡冷绿偏色 + 青绿强调 */ }
[data-theme="rose"]  { color-scheme: light; /* Codex light 面 + 极淡暖偏色 + 玫瑰强调 */ }

html[data-theme="pine"],
[data-theme="pine"]  { color-scheme: dark;  /* Codex dark 面 + 极淡绿偏色 + 浅绿强调 */ }
```

- **几何/布局/动效放在裸 `:root`**，不随主题变化；每个调色板块只重述颜色。
- **每个调色板块必须写全 34 个色板 token**（`audit-tokens.mjs` 会校验）。漏写会从 `:root` 泄漏成 light 的值——`pine` 会拿到 `--bg-elev: #ffffff` 这类亮色，直接坏掉。
- 圆角为 `--corner-radius-scale: 1.25` 的 calc 体系（xs 5 / sm 7.5 / md 10 / lg 12.5 / xl 15 / 2xl 20）。
- 阴影为 Codex 轻投影，含 `--elevation-stroke/prominent/sidebar`、`--scrim`、`--focus-ring`。
- 布局 token：`--chat-content-max-width: 860px`、`--height-toolbar-sm/pane`、`--spacing-token-button-composer: 28px`、`--conversation-item-gap` 等。
- 等宽字体栈 SF Mono 优先；聊天正文 13px（`--chat-content-font-size`），markdown 行高 1.62。

> **上游 token 迁移**：上游 0.9.1 用 `--accent` / `--accent-contrast` 表达实心按钮，并全仓移除了 `--primary-bg` 系列。本皮肤保留 `--primary-bg` / `--primary-fg` / `--primary-hover` 作为**单色主操作**语义（这是 Codex 的核心特征），同时在 6 套调色板里都定义了 `--accent-contrast`，保证上游新增组件（`ConfigButton variant="primary"` 等）正常工作。两套 token 并存是有意为之。

### 骨架 `components/AppShell.tsx`

- 顶栏按钮改 28px 圆角 chip（`TOP_BAR_ICON_BUTTON_SIZE = 28`；上游为 36）：去掉 `borderRight` 分隔线与激活态 2px accent 顶边。
- 右面板头部 46→40px（`--height-toolbar-pane`），默认宽 384（`lib/panel-layout.ts`）。
- 背景/遮罩统一 `var(--scrim)`；信任警告改 warning 软底 chip。
- **顶栏不再有主题/语言按钮**——上游 v0.9.1 已把它们迁到 `SettingsPanel`。这是上游的 IA 决定，不是皮肤回归；如需恢复顶栏快捷切换，属于新增功能，需另立提交。

### 侧边栏 `components/SessionSidebar.tsx`

- **会话行改为 Codex 单行胶囊**：`SESSION_LIST_ITEM_HEIGHT` 48→32（导出供测试推导）、`borderRadius: var(--radius-pill)`、标题 13px，时间/消息数只在 hover 时出现，running/unread 指示器移到标题前，hover 操作按钮 24px 无边框。
- 头部：标题 13.5px/600 非等宽；新建/搜索/cwd 选择器改 subtle chip。
- **文件树整段迁出**（见 ExplorerPanel），SessionSidebar 不再接收 `onOpenFile/onOpenTerminal/explorerRefreshKey/onExplorerRefresh/onAtMention/onAtMentions` 属性。

### 右侧面板 `components/ExplorerPanel.tsx`（新增）

- 由 SessionSidebar 的 FileExplorer 章节原样搬出，state 与 FileExplorer 回调不变；`ToolbarIconButton` 一并搬入。
- 无打开 Tab 时由 AppShell 右侧面板渲染，替代原 `files.noneOpen` 空态；`TabBar` 改为 32px 胶囊 Tab（去右边框分隔）。

### 消息 `components/ChatWindow.tsx` / `MessageView.tsx` / `ChatMinimap.tsx`

- 列宽 860、列内边距 12；空态标题改非等宽 24/20px；通知条 `--radius-xl` + `--bg-elev`。
- 用户气泡 80% 宽、13px、20px 圆角；时间戳 11px；工具卡/思考块沿用 token 化圆角与状态色；diff 行高 1.7。
- **模型标签仅在 `isStreaming` 时显示**（Codex 的"安静表面"）；渲染走 `getModelDisplayName()`。
- **消息下方的两行操作区都常显**，合并上游时注意别被改回 hover 门控（上游两处都是 hover 才显示）：
  - 用户消息（`复制` / `从此处编辑` / `新会话` / 时间戳）——上游用
    `{(hovered || focused || forking || copied) && (...)}` 把整行藏起来，本 fork 去掉了门控。
  - 助手消息（`N in · N out · N cache R · $x` + `复制`）——上游用 `.reveal-on-hover`
    的 `opacity: 0 → 1` 隐藏。本 fork 同样去掉了：移除内联 `opacity`/`pointerEvents`、
    移除 `.reveal-on-hover` 类（连同 globals.css 里两条失效的 `:focus-within` 规则）。
  - 两处都连带删掉了只为该门控存在的 `hovered` / `focused` 状态与
    `onMouseEnter/Leave/Focus/Blur` 处理器——上游若恢复门控，这些要一起加回来。
- Minimap 圆点改 22×3 圆角 marker（scaleX 渐进）。

### Composer `components/ChatInput.tsx` / `ModelSelector.tsx`

- 控件统一 28px（`--spacing-token-button-composer`）、gap/padding 收紧、圆角 `--radius-md`。
- 发送键改 32px 圆形图标键，位于**底部栏右侧**（`{!isMobile && (isStreaming ? stopButton : sendButton)}`）；`aria-label` 保留，测试断言 `aria-label="Send"`。Steer/Follow-up 改 12px 紧凑键。
- @ 菜单挂 `ref={atMenuRef}`（上游 v0.9.1 新增，用于定位/外点关闭）+ `className="anim-popover"`。

### 设置与弹窗 `app/settings.css` + `Settings*` / `ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `AgentsConfig` / `ProjectTrustDialog` / `DirectoryPicker`

- 遮罩统一 `var(--scrim)`；半径/阴影走 token；硬编码色（红/蓝/琥珀）全部换成 `--danger/--accent/--warning` 及 color-mix 变体。
- `ModelsConfig` 的按钮由 `SettingsUi.tsx` 的 `ConfigButton` 渲染，样式落在 `app/settings.css` 的 `.config-button-*`——**改按钮外观请改 CSS，不要回到内联样式**。
- `ModelsConfig` 内联样式仍保留本地 token 约定：主操作按钮用 `--primary-bg`/`--primary-fg`，圆角一律 `var(--radius-*)`。

### 行为常量（皮肤相关，合并时注意）

- `hooks/useChatAppearance.ts`：宽度默认 768、下限 640；字号默认 13。`clampChatContentWidth(null)` 视为默认值（修复了 `Number(null)=0` 被钳到下限的边界）。
- `lib/file-explorer-state.ts`：折叠状态 key 不变，由 ExplorerPanel 继续使用。

---

## 本 fork 的有意偏离（非皮肤）

### 从上游 PR 摘取的功能（不属于任何上游 release）

这些功能来自 `agegr/pi-web` 的开放 PR，**不在任何上游 release 里**。合上游新版本时
它们会被当作「本地改动」参与三方合并，冲突是正常的；不要误删。

| PR | 内容 | 提交 | 基点 |
|---|---|---|---|
| #844 | OpenCode Go 供应商用量配额 | `a7f1d11` | v0.9.1 |
| #838 | 工作区 Markdown 编辑器 + 可切换主/副区布局 + Composer 选区上下文 | `1f4d45a` | v0.9.1 |
| #470 | Plugins 面板中的 MCP 服务器管理（新增 `/api/mcp` + MCP 服务器区块） | `d3ee79e` | v0.8.8-beta.1（`d9b534e`） |

#### 2026-09-15 收编批次 A+B（27 个，分支 `pick/ab-2026-09-15`）

上游 439 个 PR 里，**已合并的全部已在 v0.9.1 基线内**（v0.9.1 tag 之后上游 merge 数为 0），
所以候选就是当时 **61 个 open PR**。收件箱（patch + 元数据 + 索引）在
`~/Desktop/pi-web-pr-inbox/`，整目录可删。

关键实测：大多数 open PR 的 base 就是 `8366762fa` = **"Release v0.9.1" 本身**；
`git apply --check` 直接过 23/61，`git apply -3 --check` 过 57/61。
但 **`--check` 不等于真实应用**——`-3` 的通过率是逐个对当前工作树测的，
应用完一个树就变了。**每应用一个都要重新 `-3 --check`，不要批量预检后一口气打。**

**A 组（14 个，零皮肤冲突）**

| PR | 内容 | 提交 |
|---|---|---|
| #835 | 流式首个 chunk 被重复渲染 | `c955034` |
| #809 | 关机时关闭 SSE 流（僵尸 node / 502） | `aa7ff0d` |
| #810 | tail 窗口只按可见消息计数 | `4ea5888` |
| #796 | 读取其他 pi 进程写入的会话 | `29c31a9` |
| #811 | manual-code 握手 token 改 randomUUID | `2300b57` |
| #818 | session cookie 改 SameSite=Lax | `b909aa0` |
| #827 | plugins `relativePath` 分隔符归一 | `313c5c6` |
| #833 | 扩展注册的 provider 进设置/鉴权路由 | `89940d1` |
| #847 | 前台子代理完成文本带 session ID | `09bcf08` |
| #823 | RISC-V 关闭 Wasm 懒编译 | `1d7b436` |
| #732 | worktree 先 fetch origin、放宽 git 超时 | `74a9b11` |
| #805 | 离线用缓存的 app shell | `44b1c13` |
| #837 | 插件更新检查绕开 `npm.cmd`（取代 #817） | `66c2bd3` |
| #846 | 提高 Next 代理 body 缓冲（>10MB 上传 500） | `4873b02` |

**B 组（13 个，皮肤面 1–2 文件）**

| PR | 内容 | 提交 | 皮肤重打 |
|---|---|---|---|
| #785 | 顶栏显示会话消息数 | `96fa785` | 冲突：保留 fork 的「统计行常显 + 零值降透明度」，新增消息数 span 跟随同一约定；`#ef4444`→`var(--danger)`、`rgba(234,179,8,.95)`→`var(--warning)`（顺带修掉 `contextColor` 里漏 token 的琥珀色） |
| #853 | 变更文件行「提及」按钮 + 路径中省略 | `314a6a9` `78d4166` | `borderRadius: 4` → `var(--radius-xs)`，与同组件文件树上的提及 chip 对齐 |
| #771 | 列表位移后删除按钮不出现 | `ae9b5ec` | base 早于 v0.9.1、结构漂移大，**放弃三方合并、手工嫁接增量**（详见下）。**2026-09-15 已回滚**：指针几何探测拖慢 hover，见「细节精修」§8 |
| #828 | `/auto-compact` 斜杠命令 | `cb4b592` | 无 |
| #839 | 扩展 widget 更新时保持顺序 | `0370aca` | 新增 `lib/extension-widgets.ts` |
| #724 | 扩展弹窗标题支持代码围栏 | `effbbc0` `4936e23` | `borderRadius: 6`→`var(--radius-sm)`；`rgba(239,68,68,.10/.35)`→ danger 的 color-mix；`3px solid #ef4444`→`var(--danger)` |
| #761 | 扩展对话框底部停靠 | `1fbc91c` | 上游把 `CHAT_COLUMN_PADDING` 12→16，**保留 fork 的 12**；标题拆分实现被 #724 取代，只取其增量 |
| #735 | composer 预览待发送图片 | `b180805` | `borderRadius: 6` → `var(--radius-sm)` |
| #743 | 流式更新时保持工具块展开 | `ba2e0d0` | 保留 fork 的 `toolResults` 传递与 `ToolCallIcon`；去掉 `prevAssistantEntryId`（fork 的 `Props` 没有这个字段） |
| #826 | 工具卡折叠时也显示结果图片 | `d95f7db` | 4 处 rgba/hex → `--danger`/`--success` 的 color-mix；`borderRadius: 6`→`var(--radius-sm)` |
| #744 | `apply_patch` 渲染成 split diff | `4b634e7` | `rgba(34,197,94,.15)` → `var(--success)` 的 color-mix；去掉 #826 已删除的 `images` prop 传参 |
| #799 | 模型 provider 图标 | `942d9a7` `46c1e6c` | 只保留图标部分；**Windows 启动器（cmd/ps1/launcher.js/proxy-bootstrap）已剔除**——本 fork 纯 Web、无桌面端 |
| #834 | 第三方子代理会话嵌到父级下 | **搁置** | 见下 |

**本轮搁置 / 排除**

- **#834 搁置（重要）**：它把 `family.subagents` 聚合模型改成 `family.children` 嵌套行模型
  （`sessionRows` / `collapsedSessionFamilyIds` / depth 渲染），横跨 `lib/session-family.ts`、
  `lib/session-list-scanner.ts`、`lib/session-reader.ts` + `SessionSidebar.tsx`。
  这与本 fork **刻意的**「子代理行聚合进父行」设计直接相冲
  （见 `SessionSidebar.test.mjs` 的 *hides subagent rows and aggregates their state into the main session row*）。
  收它等于推翻该设计并重写虚拟列表行模型，需单独立项决策。
- **#817 / #831**：分别是 #837 / #832 的前身，取更完整的那个。
- **#801**：被已摘取的 #838 覆盖（文件集是 #838 的子集）。
- **#819 / #820 / #821 / #852**：纯 `AGENTS.md` 文档；#852 还想把 Next 自动生成的
  agent rules 块提交进仓库，与本 fork 的 AGENTS 处理方式冲突。
- **#812 / #816 / #832**：D 组，本轮不做。其中 #816 把 pi 依赖改成 `file:../pi/packages/*`
  本地 monorepo + `next.config.ts` 的 `localPiAliases` + 重写 lock，**在本 fork 不可用**。
- **C 组 22 个**（#713 / #725 / #726 / #727 / #733 / #736 / #777 / #790 / #800 / #807 /
  #813 / #814 / #815 / #824 / #825 / #830 / #836 / #841 / #843 / #845 / #849 / #854）：
  皮肤面 3–8 文件，等 A+B 验证通过后再做。注意 **#725 与 #843 互斥**
  （都重写 `MessageView.tsx` 的 `SplitPatchView` 区段）。

**#771 的移植方式（下次遇到结构漂移照做）**

PR 的 base（`0e712013d`）早于 v0.9.1，`SessionSidebar.tsx` 的结构与 fork 差得远，
三方合并吐出 4 处冲突（其中一处 ours 为空、theirs 64 行，混着上游早已被 fork 移除的
File Explorer 区段）。正确做法不是硬解，而是**放弃 patch、按 PR 的 diff 手工嫁接功能增量**：

1. 先 `git checkout --` 还原冲突文件；
2. 只读 PR 的 `.diff`，把「功能增量」逐条列出来（refs / state / callbacks / props / 渲染分支）；
3. 用 Edit 逐条打进 fork 的现有结构；
4. 同步改测试断言。

**#833 的冲突（A 组唯一的冲突）**：`app/api/auth/login/[provider]/route.ts` 的 import 区，
#811 刚加了 `randomUUID`、#833 要删掉已不再使用的 `ModelRuntime` import。
取「保留 `randomUUID`、删掉 `ModelRuntime`」。

**摘取方法（重要）**：本 fork 的 `upstream` 分支是**源码包快照**，与真实上游 git 历史
**没有共同祖先**，PR 分支却带着完整上游历史（数百提交）。所以**不能 merge PR 分支**，
只能把 PR 相对其基点的 diff 用 `git apply -3 --binary` 打进来：

```bash
git remote add agegr https://github.com/agegr/pi-web.git
git fetch --no-tags agegr pull/838/head:pr-838
base=$(git log --format='%h %s' pr-838 | grep -m1 'Release v' | cut -d' ' -f1)  # 找到 PR 的真实基点
git diff --binary "$base" pr-838 > /tmp/pr838.patch
git apply -3 --binary --whitespace=nowarn /tmp/pr838.patch
```

这样 `upstream` 分支保持纯净，后续快照式合并流程完全不受影响。

**受影响文件（下次合上游时预期冲突面）**：#844 → `ModelsConfig` 相关；
#838 → `SessionSidebar` / `ExplorerPanel` / `useAgentSession`；
#470 → `components/PluginsConfig.tsx`、`lib/api-types.ts`、`lib/i18n/messages/{en,zh-CN,zh-TW}.ts`，
以及上游永远不会有的新文件 `app/api/mcp/route.ts`。

**#838 的移植要点**：PR 给 `SessionSidebar` 的文件树区域加 CSS 类名，但本皮肤已把文件树
搬到 `ExplorerPanel`——所以那些 `file-explorer-*` 类名和 `@container` 响应式规则
（含 `file-explorer-compact-icon`）要打在 `ExplorerPanel` 上，不能跟着 PR 放回侧栏。
另外 PR 把 `modeHint` 从 `"diff"` 拓宽为 `"preview" | "diff"`，
`ExplorerPanel` 的 `onOpenFile` prop 类型要同步拓宽。

**#470 的移植要点**（`d3ee79e`）：PR 的基点是 v0.8.8-beta.1，那时 `PluginsConfig.tsx`
还是内联样式旧结构，而本 fork 在 v0.9.1 已把它组件化（`ConfigSidebar` / `ConfigDetail` /
`ConfigButton` / `ConfigSwitch`）。所以做法是**保留本地结构，只嫁接功能增量**：

- 按 `@@@` 分块把 PR 相对 `d9b534e` 的增量（两个新组件 `McpServerDetail` /
  `AddMcpServer`、10 个 MCP `useCallback`、侧栏区块、底部第二个 action、详情区三分支切换）
  用脚本精确拼进本地文件，而不是手工解冲突——旧内联 JSX 与本地组件树逐块冲突，
  按行合并几乎必错。
- **不要引入 PR 的 `useIsMobile`**：它只服务于 PR 自己的内联弹窗外壳（宽度/高度/方向），
  本地已由 `ConfigPanelShell` 承担响应式；照搬会变成未使用导入。
- 硬编码色/圆角按本皮肤 token 化：`#ef4444` → `var(--danger)`、
  `#16a34a` → `var(--success)`、`borderRadius: 6` → `var(--radius-sm)`。
  `borderRadius: 3` 的徽章字面量与 `rgba(120,120,120,0.12)` 与 `PackageDetail` 保持一致，保留。
- **i18n 要补三套**：PR 只给了 en / zh-CN，本 fork 还有 `zh-TW.ts`，而
  `lib/i18n/registry.test.mjs` 要求所有语言键集合与 en 完全一致。`mcp.*` 共 51 个键，
  漏一套就会挂在 `built-in locale packages have the complete English key ...`。
- PR 的 5 个 MCP `useCallback` 依赖数组漏了 `t`，已按本文件既有惯例加
  `// eslint-disable-line react-hooks/exhaustive-deps`（与 `loadPlugins` 的 effect 同款）。
- 该路由读的是全局 `~/.pi/agent/mcp.json` 与项目 `.pi/mcp.json`；GET 复用
  `getAllowedFileRoots()`，所以只有"已存在会话的 cwd"或 `~/pi-cwd-*` 才允许访问
  （与 `/api/plugins` 行为一致，"Access denied" 是正常的）。项目范围写入需项目已受信任。

> **能力边界**：pi 核心**不含内置 MCP**（`@earendil-works/pi-coding-agent` 的
> `docs/usage.md` 明写 "It intentionally does not include built-in MCP ..."）。
> 所以这个面板管理的是给 MCP 扩展/包（如 PR 提到的 `pi-mcp-adapter`）用的配置文件，
> **本身不会把 MCP 服务器接进 agent**。装上面板≠Agent 会用 MCP。

### Electron 桌面端已剔除（`6bd923f`）

上游 v0.9.1 新增 Electron 桌面端。本 fork 保持纯 Web，已移除：

- `electron/main.js`、`scripts/gen-icons.mjs`、`scripts/after-pack.mjs`、`build/` 图标
- `package.json`：`productName`、`main`、`desktop` / `desktop:icons` 脚本、`electron` / `electron-builder` / `@resvg/resvg-js` 依赖、electron-builder 的 `build` 配置块
- `.gitignore`：忽略 `/release`（electron-builder 输出目录）

`upstream` 分支上的快照仍完整保留这些内容，需要时可从那里取回。

### 依赖变化

`node-pty` 1.1.0 → **1.2.0-beta.15**（上游 v0.9.1 变更）。上游同时新增的 `electron` / `electron-builder` / `@resvg/resvg-js` 已被剔除。

---

## 已知测试断言同步

以下测试断言的是皮肤数值，合并上游若覆盖需同步：
`ChatAppearance`（768/13）、`SessionSidebar`（行高常量推导）、`AgentSessionPanel`（`--radius-md` 圆角）、`ImagePreview`（`--radius-md`/`--bg-elev`）、`MessageView`（`--border` 工具卡）、`MobilePwaLayout`（`--height-toolbar`/`--height-toolbar-pane`）、`panel-layout`（384 默认宽）、`SettingsPanel`（`THEME_OPTIONS.map` / `setThemePreference(option.id)` / `setLocale(plugin.id)`）。

细节精修后新增/改写的断言（排版刻度 token 化、焦点环下沉到覆盖层）：

| 文件 | 断言 |
|---|---|
| `SettingsPanel.test.mjs` | `.settings-chat-option` 字号为 `var(--text-sm)`；`.web-login-composer` 圆角为 `var(--radius-lg)`；当前选中 tab 的焦点规则**不再**含 `outline: none`，并断言覆盖层提供 `outline: 2px solid var(--accent) !important` |
| `SettingsUi.test.mjs` | `.config-sidebar-text` → `var(--text-sm)`、`.config-sidebar-group-label` → `var(--text-2xs)`、`.config-field-label` → `var(--text-xs)`、`.config-empty-state` → `var(--text-sm)` |

A+B 收编批次新增/改写的断言：

| 文件 | 断言 |
|---|---|
| `AppShell.session-stats.test.mjs`（#785 新增） | 消息数 span 断言 `color: messageCountColor, opacity: totalMessages ? 1 : 0.45`（fork 的「常显」约定，不是上游的 `{totalMessages > 0 && ...}` 门控）；阈值色断言 `var(--danger)` / `var(--warning)` |
| `SessionSidebar.test.mjs`（#771 改写） | `{showHover && !session.transient ? (`（原 `hovered`）；新增「stationary pointer 重新探测」用例；**顺带修掉一条既有失败断言**——fork 把项目行改成 `if (project.key === selectedProject?.key) {`，上游的 `isSelectedProject && (` 已匹配不上 |
| `ChatWindow.extension-request.test.mjs`（#761 增删） | 新增底部停靠 + 音效去抖两条；**删掉**上游的「标题拆段」用例——该实现被 #724 取代 |

## 合并后自检清单

```bash
node_modules/.bin/tsc --noEmit              # 必过；JSX 失配会在这里暴露
npm run lint                                # 0 error（注意：release/ 构建产物会让 eslint . 爆量，先删或忽略）
npm test                                    # 除 CLI global lock 与 plugin-updates 这类环境性用例外全过
node docs/codex-skin/audit-tokens.mjs       # 必过；自造 token、皮肤刻度、6 套色板完整性、CSS 括号配平
npm run prod                                # 必须**干净重建**（见下），然后另开一个终端：
node docs/codex-skin/verify-themes.mjs      # 必过；重复主题块 + 实际渲染出的 token 值
node docs/codex-skin/capture-themes.mjs     # 重拍 5 套主题 + 设置页截图
```

> 前四项都是静态检查，**抓不到重复主题块**——那类错误只有第五项（真实渲染）能暴露。改过主题层就一定要跑完第五项。
>
> **`.next` 里的 CSS 缓存会骗人**：`npm run prod` 在已经是 prod 模式时不会挪走 `.next`，
> webpack 有可能直接吐回旧的 CSS 产物——表现是 `verify-themes.mjs` 报出一整套旧色板，
> 而源码和 `audit-tokens.mjs` 都是新的。踩过之后：改过主题层就
> `mv .next $(mktemp -d)/next` 再 `npm run prod`。

---

## 细节精修：暖色 oklch + 玻璃层（skin-v0.9.1 之上）

目标：不动任何功能，只把「看起来还差点意思」的细节收敛成一套可验证的刻度。
规范与判定依据全部写在 `docs/codex-skin/visual-spec.md`，本节只记改动面与坑。

**范围约束**：只改 CSS（`app/globals.css`、`app/settings.css`），**不动任何 `.tsx`**。
代价与天花板见 visual-spec.md §7。

### 1. 色板：6 套全部改写为暖色 oklch

- 中性面改暖色（浅色色相 80、深色 60；chroma 0.003–0.012），交互层用带暖色相的
  `oklch(L C H / α)` 而不是中性灰；前景三级仍是 100% / 72% / 52% 同色相同亮度。
- `--primary-bg` 改为该主题的「墨色」（浅色主题近黑暖、深色主题近白暖），
  与 `--accent-contrast`（强调色实心上的文字）分开，两者不再混用——
  任务列表勾号原本用 `--primary-fg` 画在强调色底上，浅色主题下会变成近黑勾号，已改为 `--accent-contrast`。
- 每套色板仍然写全 `audit-tokens.mjs` 的 34 个 token；选择器各出现 1 次（`verify-themes.mjs` 会数）。

### 2. 新增语义刻度（定义在裸 `:root`）

- **排版**：`--text-2xs|xs|sm|md|lg|xl|2xl|3xl` = 10/11/12/13/14/15/18/24px，
  与代码里的字号字面量 **1:1** 对应。`globals.css` 替换 27 处、`settings.css` 替换 38 处。
  未替换的都是刻意的：`em` 相对字号、移动端 `16px`（防 iOS 缩放）、登录页输入框、关闭按钮的 `×` 字形。
- **控件尺寸**：`--control-xs|sm|md|lg|xl|touch` = 22/26/28/32/36/44px。
- **层级**：`--z-base|raised|sticky|panel|drawer|popover|modal|toast`。
  组件内联的 z-index（1→1100 共 22 个散值）CSS 无法覆盖，这套刻度只服务于
  新写的规则与覆盖层里能用类名命中的层。
- **玻璃**：~~`--glass-blur|saturation|opacity|popover-opacity|tooltip-opacity`~~
  **已于 2026-09-15 回滚**（见 §8）。

### 3. 覆盖层（`globals.css` 末尾）

组件把表现放在内联样式里，内联优先级高于任何选择器，所以凡是跨组件收敛的属性
（圆角、阴影、动效时长、焦点环）都放在一层带 `!important` 的覆盖层里，规则按「收敛什么」分组：

| 收敛项 | 命中方式 |
|---|---|
| 浮层圆角/阴影 | `.anim-popover` / `.anim-popover-down` / `.anim-dialog`（类名是 inert hook，入场动画见 §8） |
| 输入框圆角/焦点环 | `.chat-content div[style*="--radius-composer"]`（该内联变量全仓唯一） |
| 焦点环 | `:where(button, a[href], …):focus-visible`，压掉 21 处内联 `outline: "none"` |
| 会话节奏 | `.chat-content [data-entry-id] > div` 用回 `--conversation-item-gap`（此前 token 定义了却没人用，消息写死 20px、过程详情 14px） |
| 工作区边界按钮 | 去掉与 header 重复的 1px 分隔线，补 hover / focus 同款 chip |

~~**玻璃只在内容真的从下面经过的地方**：下拉、菜单、扩展弹窗、输入框。~~
**玻璃层已于 2026-09-15 整体回滚**（见 §8），浮层恢复组件内联的不透明背景。

### 4. 终端：从硬编码色改为 token 岛

`.terminal-panel` 原来写死 `#1a1a1a`/`#1f1f1f`/`#333333`…，而 xterm 的主题
（`TerminalPanel.tsx` 内的 JS 对象）用的是 `#111318`，两层近黑叠出可见接缝。
现在面板底色与 viewport 都取 `--terminal-surface`（**必须等于 JS 主题的 background**），
外壳灰阶走 `--terminal-chrome/border/hover/text/text-dim`，状态灯改用
`--warning/--success/--danger`，报错条用 `color-mix` 在 `--danger` 上算。
让终端真正跟随主题需要改 JS 里的 xterm 调色板，超出本次范围。

### 5. 顺手清掉的硬编码与死 token

- `settings.css`：`.skill-update-status.is-success` 的 `#16a34a` → `--success`；
  `.config-scope-tag.is-project` 的 indigo `rgba(99,102,241,…)` → `--accent-soft`/`--accent`；
  `.agents-concurrency-control input` 的 `border-radius: 4px` → `--radius-xs`。
  `.config-scope-tag` 基础态的 `rgba(120,120,120,0.12)` 与 `border-radius: 3px` 保留，
  因为它们要和 `ModelsConfig` 里内联的包徽章保持一致。
- `globals.css`：登录页阴影与错误色、文件查看器保存状态色、Markdown 行内代码
  （补 hairline 边框，浅色下原本几乎看不见）、Markdown 编辑器与目录选择器的焦点环、
  移动抽屉与遮罩的阴影/背景。
- 删掉死 token：`--elevation-prominent`、`--elevation-sidebar`、`--height-toolbar-sm`、
  `--radius-token-composer-single-line`、`--conversation-grouped-item-gap`（全仓无人引用）。
- `--shadow-sm|md|lg|xl` 名字保留（组件内联在引用），值改为统一的「描边 + 暖黑分层」四级阶梯。

### 6. 脚本与截图

- `audit-tokens.mjs` 新增「皮肤刻度 token 齐全」检查（现为 29 个，含 §8 删掉 `--glass-*` 后的数量），并保持 34 token × 5 套调色板校验。
- `verify-themes.mjs` 期望值改为暖色 oklch，且**按数值比较**，不再依赖压缩后的字面串。
- 新增 `capture-themes.mjs`：跑 `npm run prod` 后重拍 5 套主题 + 设置页截图。

### 7. 本次**没有**修掉的（需要改 .tsx，留给下一轮）

- 侧栏会话行/文件树行、消息动作行、composer 内控件尺寸仍由内联样式决定；
  覆盖层只能收敛它们共有的属性，改不了它们各自写死的数值。
- 触摸端 hover 残留：`onMouseEnter/Leave` 直接写内联样式，CSS 无法撤销。
- 内联 z-index 的 22 个散值、`ModelSelector` 等浮层各自的阴影字面量。

### 8. 回滚：动效 / 玻璃 / 会话行指针探测（2026-09-15）

用户反馈「这些交互细节影响整体性能」，实测后回滚三块。**回滚面不涉及上游代码**，
合上游时无需重打，但不要在后续 PR 摘取中把它们再引回来。

1. **动效层（来自 `8112c7c`）**：删掉 `popover-in/popover-in-down/dialog-in/backdrop-in/
   message-in/skeleton-shimmer/phase-dot/blink` 八组 keyframes，以及 `.anim-message-in`、
   `.anim-backdrop`、`.streaming-caret`、`.phase-dots` 规则和全局 `button/a` 的按压过渡
   （`:active scale(0.97)`）。`.anim-popover|.anim-popover-down|.anim-dialog` 类名保留，
   但只剩覆盖层的圆角/阴影，**入场动画已不存在**——它们是 inert hook。
   ChatMinimap 预览的 `minimap-preview-in` 一并删掉。
   保留：`:focus-visible` 描边、键盘可达性（`role`/`tabIndex`/`onKeyDown`）、
   `prefers-reduced-motion` 兜底、`chat.dropImagesOnly` 提示。
   `.skeleton-line` 保留但改为静态底色（原来是无限 `background-position` 微光）。
2. **玻璃层 + 全局过渡覆盖（来自 `11289af`）**：删掉 `--glass-*` token（含 dark/pine
   里的覆盖值）、`.anim-popover|.anim-dialog` 与 composer 的 `backdrop-filter` 与半透明
   `background-color`，以及 `@media (prefers-reduced-motion: no-preference)` 里那条
   带 `!important` 的全局控件 `transition`（它带了 `width/height`，会反复触发布局）。
   覆盖层保留浮层圆角/阴影、composer 圆角/焦点环、chat rhythm、边界按钮等纯视觉规则。
   `audit-tokens.mjs` 的皮肤刻度清单同步删掉三个 `--glass-*`（29 个）。
3. **#771 的指针几何探测（来自 `ae9b5ec`）**：删掉 `listPointerRef` / `pointerSessionId` /
   `syncPointerSession` / `handleListPointerMove|Leave` / 列表容器上的 4 个 pointer/mouse
   处理器 / `useLayoutEffect` 重探 / `pointerActive` prop，`SessionItem` 回到
   `const showHover = hovered`（逐行 `onMouseEnter/Leave`）。
   代价：删掉一条会话后，滑到光标下的下一行不再自动出现重命名/删除按钮（上游行为）。
   `SessionSidebar.test.mjs` 里那条「stationary pointer 重新探测」用例同步删除。

复测数据（同一台 M1 / 生产构建）：空闲 3s 任务时间 0.012s、0 个运行中动画；
滚动长会话 60fps；鼠标扫过 13 行侧栏 150 次移动的任务时间 **0.41s → 0.23s**
（其中脚本时间 0.12s → 0.05s），样式重算 250 → 221 次，布局 45 → 39 次。
幅度不算大，因为剩下的开销是逐行 `onMouseEnter` 的 React 重渲染——那是上游行为。

> 另一处与本次无关但被用户点名的现象：`处理详情` 组在回答落地时
> 从「进行中展开」变为「完成后折叠」是**上游 `isLiveTail` + `defaultExpanded={!finalAnswerMessage}`
> 的设计**（v0.9.0 原始包即如此），不是这两批改动引入的。这次只是去掉了放大它的
> `anim-message-in`，闪动感随之减轻；要不要改行为（比如完成后不自动折叠）需另立决策。

### 9. e2e 套件：本机可运行化 + 与 fork 行为对齐（2026-09-15）

背景：这批 pick 的「测试环节」一直没跑完，**根因不是慢，是跑不起来**——
Playwright 自带的 chromium 在这台机器上不存在（`chromium_headless_shell-1243` 缺失），
而 macOS 12 又没有 Playwright 1.63 的 chromium 构建，只能用系统 Chrome。
`e2e/run.mjs` 里是裸 `chromium.launch()`，一启动就死。本机跑法：

```bash
E2E_SERVER_MODE=start E2E_CHROME_CHANNEL=chrome node e2e/run.mjs   # 需先有生产构建
```

**改动一：launch 加环境变量门控**（`e2e/run.mjs`）。CI 不设该变量，行为不变。

**改动二：5 处断言与 fork 行为对齐**（上游 e2e 写的是上游数值/行为）：

| 位置 | 上游期望 | fork 实际 | 处理 |
|---|---|---|---|
| compacted 会话窗口 | `entryIds[0]=="compact"`、无 user 消息 | `#810` 让窗口只数可见消息，51 条 fixture 整段进窗口 → 首条是 `user` | 改断言：分页含 compaction 分隔条 + 无更早历史（行为本身符合 `buildSessionContext` 的「history pages retain compacted messages」） |
| 完成态消息的模型名 | 显示 `test/E2E Model` | fork 只在 `isStreaming` 时显示（Codex 安静表面） | 改断言为 0 处 |
| 聊天宽度/字号默认值 | 820 / 14 / 下限 820 | **860 / 13 / 下限 640**（`useChatAppearance.ts`） | 改断言为 fork 值 |
| 代码围栏字号 | `16.5px` | CodeBlock 用 `calc(12.5px + offset)` → font=18 时为 **17.5px** | 改断言为 17.5px 并注明公式来源 |
| 侧栏会话行 tooltip | 裸名字 `[title="X"]` | fork 是 `"<名字> · <相对时间>"` | 改前缀匹配 `[title^="X · "]`，时间文案与语言无关 |
| 关面板后再读滑块 | 先 `closeSettings()` 再读滑块值 | fork 里 **Escape 会关掉设置面板**，滑块随即从 DOM 消失 | 把该断言移到关闭之前（两处断言意图都保留） |
| Settings 点击时机 | 一次点击即可 | fork 的入口在侧栏底部，水合更晚；`domcontentloaded` 后立即点会丢事件 | 加 `openSettingsPanel()` 重试直到面板出现 |

实测（Post-rollback 生产构建）：`E2E_SERVER_MODE=start` 下 **8/8 PASS**，
含 1280px 与 390px 两轮（分页/分支/markdown/代码/工具卡/compaction 导航、扩展弹窗键盘与超时、
聊天外观持久化）。单测 1126/1130（4 条既有环境性失败），`tsc --noEmit` 干净，
`audit-tokens` 29 刻度 + 34×5 调色板，`verify-themes` 5/5。

### 批次 C-1（2026-09-16，分支 `pick/c-2026-09-16`）

批次 C 共评估 34 个候选（上游 61 个 open PR 去掉已收的 27 个）。评估口径是**三条污染面**：
① 依赖/构建配置（会污染每一次上游合并）、② 皮肤文件（将来合上游要重打）、③ 与 fork 刻意设计冲突。
本轮只收「小改动 + 功能独立 + 皮肤面 ≤3」的，收到 6 个，2 个因结构性重叠转入手工嫁接队列。

**收下（6 个）**

| PR | 内容 | 提交 | 皮肤重打 |
|---|---|---|---|
| #855 | 文件选区工具栏不被会话侧栏遮挡 | `166e02f` | 无 |
| #777 | 运行中的回合显示推理级别 | `e221058` | 新增的只读块原本写死上游控件几何（`8px 12px` / `h32`），按它**自己那条测试的意图**改成 fork 的 `6px 10px` / `h28`，测试断言同步（`5e3dc8b`） |
| #733 | 扩展 widget 字号设置 | `8bfde49` | `--extension-widget-font-size` 的兜底从字面量 `14px` 改为 `var(--text-lg)` |
| #830 | 响应被输出上限截断时提示 | `e18cd88` | 琥珀色字面量 → `--warning` / `--warning-soft`；`borderRadius: 6` → `--radius-md`；丢弃 PR 里为 hover 门控加的 `hovered` 状态（fork 的操作行常显） |
| #836 | 从 minimap 加载更早历史 | `96ff438` | 上游在自己的滚动区里再渲染一个 ChatMinimap；fork 已用 `hasChatMinimap` 挂了一个，故**丢弃那段渲染**、把三个新 prop 接到 fork 已有的挂载点；预览框保留 fork 的 pin 按钮并加上 PR 的「Load earlier」行 |
| #845 | 「滚动到最新」按钮 | `64e6cd7` | 保留 fork 的底部 marker div（grid 列 + zIndex），只取 PR 的内层按钮块；`32px`/`999px` 对齐到 `--control-lg` / `--radius-pill` |

**转入手工嫁接队列（2 个，本轮未收）**

- **#790 文件面板全宽开关**：5 处冲突全在 `AppShell.tsx` 的同一区域——它的补丁假设上游布局，而 fork 有已收 #838 的「主/副区可切换」布局（`workspace-swapped` / `main-workspace` / `secondary-workspace`）。按台账规矩（结构漂移大的不硬解）放弃 patch，需要读 diff 手工打进 fork 结构。
- **#841 PDF `#page=` 锚点**：4 处冲突分别叠在 fork 自己的功能上——`file-tab-state.ts` 的 `modeHint: "preview" | "diff"`（#838）、`AppShell` 的 `locationTarget`、`FileViewer` 的选区引用接口（155 行）。其中 `file-tab-state` 还涉及「谁负责 bump revision」的重构，硬解风险高。

**评估结论（供后续批次参考）**

- 34 个里只有 **2 个**碰依赖/构建配置：#725（`package.json` 加依赖）、#801（Windows `bin/` 启动器，且是已收 #838 的子集）→ 都建议不收。
- 4 个纯文档（#819/#820/#821/#852）→ 不收：fork 的 AGENTS.md 已大改，且 #852 要把 Next 自动生成的规则块提交进仓库。
- 其余 22 个属「皮肤面 1–5」或「与 fork 设计冲突」（#813 思考级别持久化、#814 模型标签常显、#825 面板拖拽、#834 子代理嵌套），价值/成本见当次评估表，未动。

**踩坑记录**

- **不能在索引有未解冲突时继续叠补丁**：`git apply -3 --check` 会报 `does not exist in index` 并回退成 `direct application`，把后面几个 PR 连带写成冲突态。正确节奏是「一个 PR → 解冲突 → `git commit` → 再 check 下一个」。
- **`both` 式合并 CSS 要验括号**：冲突两侧直接拼接时，闭合括号可能落在冲突区之外，产物是「无编译错误提示、只有 `next build` 报 `Unclosed block`」。`audit-tokens.mjs` 的括号配平检查只覆盖 `globals.css` / `settings.css`，`*.module.css` 不在内 —— 这次是靠构建才发现的。
