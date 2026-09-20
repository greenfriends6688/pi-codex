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
`~/Desktop/pi-codex/pi-web-pr-inbox/`，整目录可删。

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

### 10. 界面调整：纯白、侧栏行距、文件默认开在左侧、全屏、放开编辑（2026-09-16）

按使用反馈做的五项调整，全部落在 fork 侧，不涉及上游代码。

1. **浅色阅读面纯白**：`--bg` 早先已改纯白，但文件查看器有几处内容底用的是 `--bg-panel`（≈#FAFAFA），
   文档区因此发灰。现在查看器的**内容面**用 `--bg`，工具栏/行号槽（`FILE_LINE_NUMBER_STYLE`）保留
   `--bg-panel` 以维持层次。
2. **侧栏行距**：`SESSION_LIST_ITEM_HEIGHT` 34→38，行内胶囊改为 `HEIGHT - 8` + `marginTop: 4`
   （项目行同样处理）。此前胶囊高度等于槽高 → 相邻行零间隙，项目标题与第一条会话贴在一起。
   虚拟列表的定位数学依赖该常量，所以只改常量与内缩，未动绝对定位逻辑。
3. **打开文件默认落在左侧**：`handleOpenFile` 现在会翻转一次工作区角色
   （`setWorkspaceSwapped(true)` + `setRightPanelOpen(true)`），文件查看器进入主区（左）、
   聊天留在副区（右）。
   **已知限制**：pi-web 的文件树（`ExplorerPanel`）与查看器在**同一个容器**里互斥渲染
   （无活动 Tab 时才显示树），所以做不到 openchamber 那样「文件左 + 树右」同时可见；
   要同时可见需要把树拆成独立第三栏或让它在副区渲染 —— 属单独立项，见 §11。
4. **查看器全屏**：工具栏新增全屏按钮，对 `file-viewer-shell` 调 `requestFullscreen()`，
   监听 `fullscreenchange` 同步图标与 `aria-pressed`。新增 i18n 键 `files.fullscreen` /
   `files.exitFullscreen`（三语齐备）。
5. **放开编辑范围（用户：原则上所有文件都可编辑）**：`isEditableTextPath` 从「白名单」改为
   **黑名单 + 预览类型判定** —— 归档/二进制/图片/音视频/office 文档不可编辑，其余（含未知后缀）
   一律可编辑，与查看器已有的「未知类型按 UTF-8 读」行为一致。白名单保留为快速路径并扩充了
   常见文本后缀（ini/conf/csv/log/vue/php/lua/r/nix/plist…）。

**物理边界**：pdf / docx / xlsx / pptx / 图片 / 音视频无法在浏览器里直接编辑，只能预览；
真正的可视化编辑需要 ONLYOFFICE / Collabora 这类服务端方案（见 §11 评估）。

### 11. 三栏布局：会话 | 文档 | 文件树（2026-09-16）

用户参考 PiDeck（桌面壳）的布局提出的诉求。pi-web 原来的结构是：`ExplorerPanel` 作为右侧面板的
**互斥回退内容** —— 一旦有活动 Tab（文件/终端），文件树就被查看器顶掉。所以要做的是让两者共存。

**改动**

- `AppShell` 把 `ExplorerPanel` 提取为一个共用节点 `explorerPanel`：无活动 Tab 时它仍是面板内容，
  有活动 Tab 时渲染在新增的 `.explorer-column` 里。
- 面板主体拆成 `.file-panel-body`（横向 flex）与 `.file-panel-main`（原来的纵向内容区），
  树列放在 body 的右侧（264px、`border-left`、`background: var(--bg)`）。
- **宽度闸门用容器查询**，不是 JS：`.file-panel-body { container-type: inline-size }` +
  `@container (min-width: 760px) { .explorer-column { display: block } }`。
  踩坑：一开始用 `rightPanelResizer.width >= 760` 做闸门，结果**永远不显示** ——
  面板在主区时宽度由网格 `1fr` 决定（实测 1072px），而残留的 resizer state 仍是 384。
- 打开文件时的角色翻转不再强制展开副区（`setRightPanelOpen(false)`）：否则聊天会被压成
  ~230px 的第四栏。聊天仍由工作区切换按钮一键唤出。

**副作用与测试同步**

- `components/AppShell.file-viewer-state.test.mjs` 的 `fileContentBlock()` 按注释文本切片
  （`{/* Only the active viewer`），重构后注释改名导致锚点失效；已更新为 `{/* Body: the active viewer`。
  该文件里的三条结构断言（只挂载活动 Tab、key 带 viewerRevision、状态回写）本身未变。

**未做**：PiDeck 的中栏是「聊天与文件统一的标签区」，pi-web 里聊天和文件是两个独立表面；
统一标签区属于架构级改动，不在本次范围。放大（栏内展开）与内置浏览器面板见后续条目。

### 12. 栏内展开 + 内置浏览器面板 + 面板布局修正（2026-09-16）

**① 栏内展开（PiDeck 的 ⤢）**

查看器工具栏新增「展开文档」：给 `.file-viewer-shell` 打 `data-expanded`，CSS 用
`.file-panel-body:has(.file-viewer-shell[data-expanded]) .explorer-column { display: none }`
把文件树让出的空间给文档。**与整屏全屏（Fullscreen API）是两个独立按钮**，互不干扰。
新增 i18n `files.expand` / `files.collapse`（三语）。

**② 内置浏览器面板（`kind: "browser"` 标签）**

- 新增 `components/browser-tab-state.ts`：`normalizeBrowserUrl`（裸域名补 https，loopback 补 http）、
  `browserTabLabel`（取 host:port 作标签）、`newBrowserTab`、`restoreBrowserTabs`（sessionStorage 恢复，
  id 必须 32 位 hex；无 url 视为合法的空标签）。
- 新增 `components/BrowserPanel.tsx`：地址栏 + 前进/后退/刷新 + 「在新窗口打开」+ sandbox iframe。
  后退/前进走本地历史栈（跨域 iframe 无法读它的 history）。
- `AppShell` 接线与终端标签同构：状态、sessionStorage 持久化、`panelTabs` 条目、所有浏览器标签常驻挂载
  （`hidden` 切换，避免切标签重载页面）、关闭处理；标签栏新增地球图标的「新建浏览器标签」按钮。
  `TabBar` 的 `kind` 扩为 `"terminal" | "browser"` 并补图标。
- 新增 `components/browser-tab-state.test.mjs`（4 个用例）。
- **能力边界（已知并接受）**：纯 Web 版只能 `<iframe>`，声明 `X-Frame-Options` 或
  `frame-ancestors` CSP 的站点无法嵌入（白屏），面板内提示改用「在新窗口打开」。
  PiDeck 能内嵌公网站点是因为它是 Electron 壳（webview 不受此限）。

**③ 布局修正（用户反馈：聊天不该被挪走）**

上一版让「打开文件 → 翻转工作区角色」，结果聊天被推到最右侧、文件查看器与文件树占了两栏。
用户明确要求：**聊天不动，文件树在最右**。现在 `handleOpenFile` 不再翻转角色，而是：

- 打开右侧工作区；
- 若面板窄于 760px（容器查询阈值），一次性把它加宽到 `min(视口 58%, 1020px)`，
  使「查看器 + 树列」都放得下（`rightPanelResizer.setWidth`）。

结果布局：`[会话侧栏] [聊天] [文档] [文件树]`。

**待查（用户报的两个 bug，尚未复现）**

- 「markdown 预览为空」：`.md` + Preview + `data.editable` 时走的是 `liveEditing` 分支
  （`MarkdownFileEditor`）而不是 `MarkdownFilePreview`，空白可能出在编辑器侧或内容为空；
  需要用户确认 **Source 模式是否正常** 与文件路径。
- 「文件树显示未找到文件」：本地实测同一组件的树能正常列出 165 个节点，怀疑与该项目的
  目录内容/信任状态有关；需要用户提供那是哪个项目（截图里是「招标改」）。

### 13. 修「markdown 预览空白」（2026-09-16）

**根因**：`FileViewer` 用 `next/dynamic(() => import("./MarkdownFileEditor"), { ssr: false })` 懒加载
WYSIWYG 编辑器，而 `.md` + Preview + 可编辑时走的正是这个分支（`liveEditing`）。
**两个缺口**：① 没有 `loading` 回退 → 加载期间空白；② 没有错误回退 → chunk 加载失败（最典型的是
服务重建后旧页面仍请求已被替换的 chunk，`ChunkLoadError`）就**永久空白且不报错**。
所以表现为「Source 正常（静态渲染）、Preview 白」，且硬刷新后往往就好了。

**修法**：新增 `components/MarkdownEditorBoundary.tsx`（极小的错误边界），
失败时回退到静态预览 `MarkdownFilePreview`；`dynamic()` 补 `loading` 骨架。
即：编辑器拿不到就退化成只读预览，而不是空矩形。

**顺带**：文件树头部原来只显示「文件浏览器」，现在补上它正在列出的目录名（tooltip 是完整路径）——
否则「空树」和「列错目录」在界面上无法区分。

### 14. 空目录与失败不再混同 + 编辑器回退可一键恢复（2026-09-16）

用户报「文件树为空但目录里有文件」「markdown 无法编辑」两件事，各修一处：

- **列表失败被当成空目录**：`FileExplorer.fetchEntries` 原来写 `data.entries ?? []`，
  只要响应体里没有 `entries` 数组就静默渲染成「未找到文件」。现在缺数组即抛错，
  界面会显示真实原因而不是伪装成空目录。
- **编辑器回退补上恢复入口**：上一轮给 `MarkdownFileEditor`（`next/dynamic` chunk）加了错误边界
  回退到只读预览，代价是「编辑能力没了却不说」。现在回退视图顶部有一条 warning 提示
  （新增 i18n `files.editorUnavailable` / `files.editorReload`，三语）并提供「重新加载」按钮。

已知但未修（需要用户数据才能定位）：

- 那个项目的 `type=list` 究竟返回了什么（空数组 / 403 / 过滤掉全部条目）——需要该目录的绝对路径。
- `设备词分类结果-按docx三级-通用描述.txt` 实际是 xlsx/docx（PK 头 + `xl/worksheets/sheet1.xml`）
  却按文本读出乱码。计划加**内容嗅探**：文本请求遇到 `PK\x03\x04` 等魔数时提示
  「这是压缩包/Office 文件，无法按文本预览」，而不是显示乱码。

### 15. 一次整体巡检（2026-09-16）

用 Chrome 对最新构建做了一轮覆盖式自动巡检（浅色底、侧栏行距、会话打开、面板开关、文件树、
从树打开文件、预览/编辑器、Source 模式、栏内展开、树列、内置浏览器），结论：

**真 bug（已修）**

- **右上角「显示/隐藏右侧工作区」开关在「未选中会话的空态」下被聊天区的元素盖住点不到**：
  实测 `elementFromPoint` 命中聊天区里的 SVG，`z-index` 260 的开关输给了它。
  修法：三个工作区边界开关的 `z-index` 提到 300（仍在模态之下）。
  说明：选中会话后开关是正常的，所以这个只在空态出现。

**探针问题（不是代码 bug，已澄清）**

- 「侧栏胶囊高度 36」：量到的是另一个带圆角的元素，不是会话行胶囊（会话行实测 29，符合槽 38 − 内缩 8）。
- 「Source 模式长度为 0」：我取的容器选择器不对（用户此前确认 Source 正常）。
- 「栏内展开 before=1 after=1」：我用 `count()` 判断，而 `display: none` 不会把元素从 DOM 移除，
  应改用可见性判断。CSS 规则本身正确。

**已确认正常**

浅色底 `oklch(100% 0 0)` 纯白 ✓ ｜ 会话可打开且有内容 ✓ ｜ 文件树列出 82 个节点、打开文件成功 ✓ ｜
markdown 预览有内容且 **ProseMirror 编辑器成功挂载（可编辑）** ✓ ｜ 树列 264px 且非空 ✓ ｜
内置浏览器打开 `127.0.0.1:30141` 成功 ✓ ｜ 控制台无错误 ✓ ｜ 树头显示目录名（tooltip 为完整路径）✓

**仍需用户数据**

- 用户项目「招标改」的树为空：本机同组件能列出 82 个节点，且现在列表失败不会再伪装成空目录；
  仍需该目录绝对路径以确认为空目录 / 403 / 条目被过滤。
- 浏览器面板里用户试的具体网址（公网站点受 X-Frame-Options 限制是预期行为）。

### 16. 三处小优化（2026-09-16）

用户报的三个问题，逐条定位并修：

1. **内置浏览器把对话盖住**：`handleOpenBrowser` 里残留了旧的工作区翻转
   （`setWorkspaceSwapped(true)` + `setRightPanelOpen(false)`），于是浏览器标签会独占整个主区。
   现在它与打开文档同规则：不翻转、只开面板，面板过窄时一次性加宽到 `min(58vw, 1020px)`。
   实测（1680 宽）：面板 974 / 聊天 482 / 树列 264 —— 与文档预览的宽度一致。
2. **图标不在同一排**：树列原本从标签栏下方开始，导致「浏览器图标 / 工作区角色切换」在标签栏行，
   而「文件浏览器 + 终端/搜索/上传/刷新」在下一行。现在树列向**上偏移一个工具栏高度**
   （`margin-top: -1 * --height-toolbar-pane`）并把树头 `min-height` 设为同一高度，
   两者落在同一排（实测树头 y=0）。
3. **看起来有两个「右侧面板」图标**：聊天顶栏里的**上下文窗口指示**用的是拱形图标，和真正的面板开关
   （矩形 + 竖线）撞脸。换成三根柱子的用量图标，一起看不再像两个面板开关。

> 右上角那一对其实是两个不同功能的按钮，保留：🌐 = 新建浏览器标签（本版新增），
> ⇄ = 工作区角色切换（聊天下载/文档占主区），只在右侧工作区打开时出现。

### 17. 「两个右侧面板图标」= 面板开关被渲染了两次（2026-09-16）

用户截图圈出的两处，实测是**同一个按钮的两份实例**（自动清点顶栏按钮得到）：

```
x=224  隐藏侧边栏            desktop-sidebar-toggle
x=804  隐藏右侧工作区         desktop-secondary-workspace-toggle   ← 重复 ①（聊天顶栏动作组内）
x=1188 隐藏右侧工作区         desktop-secondary-workspace-toggle   ← ② 边界控件（设计本意）
x=1546 新建浏览器标签 / x=1572 交换聊天区与工作区
```

- ②是 `#838` 布局改造留下的**边界控件**：`position: absolute`、`right: var(--right-panel-width)`，
  随面板宽度移动，且两个 header 的 inset 变量正是为它预留的。
- ①是后加进聊天顶栏动作组的同类按钮，于是同一排出现两个一模一样的图标。
- 修法：删掉①，保留②（唯一实例），并在原处留注释说明原因。
  复测确认 `隐藏右侧工作区` 只剩 1 个。

### 18. 从 pi-web-desktop 借鉴：主题引擎 / 过程分组 / 壁纸 / 右键菜单（2026-09-16）

来源是 `参考项目/pi-web-desktop-main`（`@iswitthere/pi-web-desktop` 0.8.10-f，在上游 0.7.16 处
分叉后独立演进）。完整对比与 PR 拆分见
[`docs/desktop-ui-borrowing-plan-2026-09-16.md`](../desktop-ui-borrowing-plan-2026-09-16.md)。

本轮落地的东西：

**皮肤面（会进 `globals.css` / `settings.css`，合上游时要重打）**

| 内容 | 落点 |
|---|---|
| 过程分组样式（树状连接线 / 文件 chip / chip 面板 / 推理截断与渐隐） | `globals.css` 末尾新增块 |
| 通用右键菜单样式 | 同上 |
| pi 主题选择器样式 + 设置分组小标题 | `settings.css` |
| 壁纸设置样式 | `settings.css` |
| `--explorer-column-width` 从「只写 fallback」补成 `:root` 里的真 token | `globals.css` 几何块 |

**新增文件**

- `lib/pi-theme.ts` + `lib/pi-theme-builtin.ts` + `lib/pi-theme-client.ts` —— pi CLI 主题引擎。
  把 pi 的 53 个 token 映射到本 fork 的 **34 个强制令牌**（不是照搬 desktop 的 29 个：两边 token 名
  只有 14 个交集）。**分层**而非替换：`data-theme` 仍然选六套 Codex 色板，pi 主题以 `<html>` 内联
  自定义属性叠在上面；切回色板必须 `removeProperty()` 全部 34 个，否则会留残留色。
- `components/PiThemePicker.tsx` / `app/api/themes/{route.ts,[name]/route.ts}`
- `lib/border-depth.ts` + `hooks/useBorderDepth.ts` —— 三级描边联动滑杆。快照 `--border-*-orig`
  后再混合，避免反复拖动叠加漂移。
- `lib/wallpaper.ts` / `lib/wallpaper-builtin.ts` / `hooks/useWallpaper.ts` / `components/WallpaperLayer.tsx` / `app/wallpaper.css`
- `lib/step-categorizer.ts` / `lib/process-content.ts` / `lib/session-flags.ts`
- （合入本机时删除：`lib/stream-update-scheduler.ts` / `lib/mention-tokens.ts` / `lib/file-mentions.ts` /
  `lib/time-groups.ts` / `lib/time-group-state.ts` / `lib/git-graph-*.ts` / `lib/ui-scale.ts` /
  `lib/provider-icon.ts` / `lib/input-compact.ts` —— 原作者标注「本轮未接线」，没有任何生产 import，
  连 `TimeBucket`、`Settings.sessionGrouping*` 一起不并入，等真正接线时再单独提 PR）
- `components/ProcessGroup.tsx` / `components/ContextMenu.tsx` / `components/SessionRowContextMenuBridge.tsx`
- `hooks/useProcessDisplayMode.ts` / `hooks/usePiTheme.ts`
- `public/monet-artworks/*.jpg`（6 张，5.5MB，取自 desktop 的内置壁纸）

**三个必须记住的坑**

1. **描边深度的「淡出」必须混 `transparent`，不能混 `--bg`**。Codex 的三级描边是
   `oklch(… / 0.1)` 这种**半透明**色，而 `--bg` 不透明 → `color-mix(orig, --bg)` 会把 alpha
   **抬高**：往「隐藏」滑反而画出更实的一条灰线。浏览器实测：深度 0 得到的是
   `color-mix(… 0%, white 100%)`，即一块纯色面。已改为混 `transparent`，并用 gamma 0.6/0.7
   让中段可感知（线性映射会让有用区间全挤在两端）。
2. **`lib/pi-theme.ts` 用 `fs`/`os`，绝不能被客户端 import 值**。`PI_THEME_CSS_VARS` 因此在
   `lib/pi-theme-client.ts` 里有一份副本，由 `lib/pi-theme-tokens.test.mjs` 断言两份必须逐项相同。
3. **过程分组只渲染一份摘要**。`ProcessDetailsGroup` 的表头就是唯一的摘要行，
   `ProcessGroup` 再渲染一次会叠出两行计数（实测出现过
   「处理详情 · 29 条消息 · 29 次工具调用」+「29 次工具调用 · 5 段思考」）。
   现在由 `summarizeProcessBlocks()` 算好交给表头。

**与既有设计的冲突与取舍**

- **不搬 desktop 的三栏壳**：本 fork 的 `[会话][聊天][文档][文件树]` + 容器查询闸门是自研资产（§11–§17）。
- **不合并六套色板**：desktop 是「一套 token 两种模式」，与本 fork 的产品定位冲突，只借它的主题 JSON 解析层。
- **过程分组默认仍是 `legacy`**：`hooks/useProcessDisplayMode.ts` 默认值保持平铺渲染，
  分组渲染是设置里的显式选择（`设置 → 通用 → 过程显示`）。
- **欢迎大厅未做**（用户明确不要）。
- **UI 缩放（zoom）只铺了 `lib/ui-scale.ts`，没开开关**：CSS `zoom` 会让 JS 视口坐标与 CSS 像素错位，
  本 fork 有 5 处浮层/拖拽依赖它，需逐项浏览器核对后再决定。
- **`tsconfig.json` 把 `参考项目/` 加进 `exclude`**：它导致全量 `tsc` 直接 OOM（8GB 机器），
  是这轮最大的隐性阻塞。

**验证**：`tsc --noEmit` 0 错 ｜ 1325 个测试 1314 通过（9 个环境性失败：无 git 装不了 worktree、
Windows bash 环境隔离、PTY 运行时、1 条既有 ChatInput 用例）｜ `audit-tokens` 通过
（顺手补了 3 个历史遗留未定义 token，并把 `app/wallpaper.css` 纳入审计范围）｜
`verify-themes` 5/5 ｜ `scripts/probe-theme-ui.mjs` 用 Playwright 实测描边 0/25/50/75/100 五档、
`/api/themes`、内置壁纸路径均正常。

---

### 19. 按「布局/样式对比计划」落地的一批视觉调整（2026-09-17）

依据 [`../ui-layout-pr-plan-2026-09-17.md`](../ui-layout-pr-plan-2026-09-17.md)（对比上游 0.14.6 与 Wegent）。
**只改样式与排布，不改功能语义**；每条都标了接触面等级（T0 只新增 fork 文件 / T1 上游文件接线），
合并上游时按下面的编号 grep 即可。

**新增的 CSS 分层（本次最重要的结构性决定）**

- 新增 `app/fork-ui.css`，在 `app/layout.tsx` 里**排在最后**导入（标记 `// fork:ui-css`）。
  从此**不再往 `app/globals.css` 末尾追加覆盖**——那里已有 695 行 `!important` 覆盖层，
  越长越难合并。新覆盖一律进 `fork-ui.css`，每条注明它覆盖的是哪个上游选择器、为什么。
- `app/settings.css` / `app/wallpaper.css` 是 fork 自有文件，直接改，不走覆盖层。

**改动清单**

| 编号 | 改了什么 | 接触面 | 回滚方式 |
| --- | --- | --- | --- |
| ui-02 | `fork-ui.css` 补上游同名语义 token：`--text-ui/--text-chat/--text-title/--text-meta/--leading-*/--weight-*`，值仍映射本 fork 刻度；`--radius-composer` 由字面量 22px 改为 `calc(var(--radius-2xl) + 2px)`（像素值不变） | T0 | 删 `fork-ui.css` 对应段；`globals.css` 那行改回字面量 |
| ui-03 | 侧栏默认宽 224→244（`lib/panel-layout.ts`）；侧栏页脚三个入口去文字改图标 + tooltip（`AppShell.tsx`） | T1（2 个文件各 1 处） | 改回常量与 `<span>{label}</span>` |
| ui-04 | 用户消息改**右对齐 + `min(70%,620px)` 限宽**（`MessageView.tsx`），手机 92% 走 `--fork-user-bubble-max`；操作行同步右对齐。**两行操作区常显保持不变** | T1（1 处） | 恢复 `alignItems:flex-start` + `flex:1` |
| ui-05 | 新会话空态首页 `components/fork/NewSessionHome.tsx`：π 徽标 + 标题（含 cwd 名）+ 一行 4 张起始卡，点击走 `insertIfEmpty` **只填输入框不发送**；Composer 由「垂直居中」改为「底部固定」（上游与 Wegent 同款）。i18n 三语 +10 键（键名与上游 `chat.homeTitle*` 对齐） | T0 + ChatWindow 两处接线（`// fork:ui-newhome`） | 删组件 + 两处 JSX + i18n 键，恢复尾部 `min-h-0 flex-1` 占位 |
| ui-07 | 右栏默认宽 `getDefaultRightPanelWidth` 由固定 384 上限改为 `min(36vw,560)`、下限 380（`lib/panel-layout.ts`）。**上限刻意低于上游的 640**：1440 视口下 640 会把聊天压到 600 以下 | T1（1 处 + 测试期望） | 改回 `Math.min(viewportWidth * 0.42, 384)` |
| ui-08 | 设置分区 tab 由定宽 96px 改为按内容宽度（`app/settings.css`），长标题不再截断 | fork 自有 CSS | 恢复 `flex: 0 0 96px; width: 96px` |
| ui-10 | 手机端对话框变 bottom-sheet：`ProjectTrustDialog` 加 `data-fork-dialog="trust"`，`DirectoryPicker` 复用已有 class，几何写在 `fork-ui.css`（含 safe-area 与 reduced-motion 分支）。**上游 `DialogShell` 全量移植未做**（纯重构，无可视收益） | T1（1 行属性）+ T0 | 删 CSS 段与属性 |
| ui-13 | `hooks/useViewportHeight.ts` 键盘弹起时给 `<html>` 加 `.keyboard-open`，`fork-ui.css` 隐藏扩展状态条 | T1（1 处）+ T0 | 删 class 切换与 CSS |
| ui-14 | `TabBar` 高 32→36、tab 26→28、关闭键 24→22 且**仅在激活/hover/键盘聚焦时可见**（`TabBar.tsx`） | T1（1 个文件） | 恢复 32/26/24 与常显 |

**本次核对后判定「计划里其实已经实现」的三项**（不要再做一遍）：

- **ui-09 配置面板内联**：`SettingsPanel` 已经在设置壳内以 `embedded` 渲染 `ModelsConfig`/`SkillsConfig`，
  没有第二层遮罩。此前对比文档基于静态清单误判为「嵌套模态」，已更正。
- **ui-11 运行中的工具行默认展开**：`ProcessGroup` 的 `streamingOpen` 已让最新一步在流式期间保持展开。
- **ui-12 主题切换圆形扩散**：`useTheme.setThemePreference` 已有 View Transition 实现（含 reduced-motion 分支）。

**有意不做**（写明理由，避免下次又被当成待办）：

- **ui-06 终端/浏览器下移到底部面板**：这是本次唯一真正需要动 AppShell 标签模型的结构改动
  （`activeFileTabId` 目前由文件/终端/浏览器共用，`handleCloseFileTab` 里还有工作区翻转逻辑）。
  计划里给的验收标准要求四档截图实测，盲改风险高于收益 —— 留作单独一项，需在 dev server 起着的状态下做。
- **ui-10 全量 `DialogShell`**：见上表说明。
- **ui-14 顶栏次级动作收进 `⋯`**：手机端已有溢出菜单；桌面端需要新增宽度侦测状态，收益仅「少几个图标」。

### 26. 面板宽度不再自己跳 + 壁纸补齐四个漏掉的实心面（2026-09-17）

用户反馈「文件树一会儿大一会儿小」「壁纸没盖到文件树」，以及截图里指出的其它位置。

| 问题 | 真因 | 改法 |
| --- | --- | --- |
| 文件树区域自己变大变小 | `handleOpenFile` / `handleOpenBrowser` 在面板窄于 760px 时**强制**把宽度设到 `min(58vw, 1020)`；而 `getRightPanelMaxWidth` 的上限是 `viewport - 420 - sidebar`（1440 视口 + 244 侧栏 = 776），随后一次 reclamp 又把它拉回 776 → 一开一关就来回跳 | 删掉两处强制加宽（含 `EXPLORER_COLUMN_MIN_PANEL_WIDTH` 常量）。宽度只属于用户与响应式默认值；面板窄时树就按既有容器查询退化成单面，本来就设计好了 |
| 壁纸没盖到文件树 | 面板容器对 `trans` 只是「72%→65% 半透明」，叠在 70% 遮罩上 ≈ 90% 不透明，看着就是白板 | `trans` 现在真的透明（面板不再自建表面）；`blur` = 半透明表面 + `backdrop-filter`；`none` = 实心。三个档位从此语义清晰 |
| 顶栏那条白带 | 顶栏**外层包装 div**（`AppShell` 里 inline `background: var(--bg)`）没有被壁纸规则覆盖，`.main-workspace-header` 那层才被覆盖 | 用 `:has(> .main-workspace-header)` 选中包装层并透明（纯 CSS，不动 React） |
| minimap 悬停预览、设置弹窗 | `.preview`（CSS module 作用域）与 `.settings-dialog-surface` 都是实心 `var(--bg)` | 各自改为 `color-mix(--bg 88%, transparent)`；module 里用 `:global(html[data-wallpaper="on"]) .preview` |

**验证**：`tsc`/`lint` 0 错 ｜ `test` 1265/1265 ｜ 浏览器实测（1440、壁纸开、panel=trans）：
面板宽度 518（= `min(36vw,560)` 默认，不再跳到 835）、`panelBg`/`barWrapBg`/`treeBg` 均为 `rgba(0,0,0,0)`、
`.chat-wallpaper` 的 left/right 均为 0（图层铺满），截图里侧栏 / 聊天 / 文件面板共用同一张画。

### 25. 顶栏边界按钮对齐 + ⤢ 不再抢整屏（2026-09-17）

| 反馈 | 实测 | 改法 |
| --- | --- | --- |
| 顶栏没对齐 | 顶栏 46px、内容中心 y=23；三个**绝对定位**的边界按钮是 `top: 0` + 28px 高 → 中心 y=14，**偏高 9px** | 侧栏开关 / 副区开关 / 工作区角色开关三处 `top` 改为 `calc(env(safe-area-inset-top,0px) + (var(--height-toolbar,46px) - var(--control-md,28px)) / 2)`，实测 cy 均回到 23 |
| 点 ⤢ 直接整屏，应该只占工作区那块 | 工具栏上有两个相近按钮：栏内展开（`data-expanded`，文件树让位）与 Fullscreen API（`requestFullscreen()`） | **删掉 Fullscreen API 那个**，⤢ 图标交给栏内展开；`isFullscreen` state、`fullscreenchange` 监听、`shellRef` 一并移除。实测点击后 `data-expanded=true`、文件树隐藏、`document.fullscreenElement=false`、查看器宽 775px |

### 24. 供应商报错里的链接可点（2026-09-17）

用户在 web 端用 `opencode-go:muse-spark-1.3-contributor` 收到 `DataPolicyError (403)`，报文里带一条
必须去点的 opt-in 链接（`https://opencode.ai/workspace/<id>/go`）。

- **根因在供应商侧**：`-contributor` 档位要求先在该 workspace 显式同意「数据用于改进模型」；
  `@earendil-works/pi-ai` 的 `opencode-go` provider 定义里除 API key 外没有任何 opt-in 参数
  （`dist/providers/opencode-go.js`），本地配置无法绕过。同 provider 的非 contributor 档位
  （`muse-spark-1.3`）与 `opencode` provider 下的 `-contributor-free` 不需要这个开关。
- **本仓库的改动**：`MessageView` 的 provider 错误框原来整段纯文本。新增 `splitErrorLinks()`，
  把 `http(s)` token 渲染成 `<a target="_blank" rel="noreferrer noopener">`，其余文本**原样拼接**
  （不包 `<span>`，否则既有断言 `Error: OpenAI API error (403)` 会被拆断）。
  测试用真实报文新增一例。

### 23. 性能：git status 3.7s→0.16s、首屏 3.6s→0.9s（2026-09-17）

用户反馈「加载慢」。实测（prod 构建 + curl/Playwright，非估算）：

| 位置 | 改前 | 改后 | 根因 |
| --- | --- | --- | --- |
| `GET /api/git/status` | **3.699s / 3.6MB** | **0.156s 冷 / 0.007s 缓存 / 8.6KB** | `--untracked-files=all` 在这个工作区列出 **18164** 条未跟踪路径（`.playwright-mcp/`、`release/`、截图…），其中逐文件 `readFileSync` 数行数占了约 3.4s |
| 首屏加载 | 3.6s | 0.75–0.95s | 就是上面那个调用阻塞了 `networkidle`（其余接口全部 ≤32ms） |
| 内置壁纸 | 每次加载拉 860KB | 壁纸关闭时 **0 请求** | `WallpaperLayer` 无论开关都解析内置画作 `<img src>`，CSS 只是把它藏了 |

改法（`fork:ui-perf`）：

- `readStatusEntries`: `--untracked-files=all` → `normal`（未跟踪目录折叠成一行，和所有 git UI 一致；同一个树 18164 条 → 57 条）。
- `countUntrackedTextLines` 加**字节预算**（2MB）：行数只是摘要，不值得为它读满整个工作区。
- `getGitStatus` 加 **2.5s TTL 缓存**（`globalThis.__piGitStatusCache`，热重载安全，上限 32 条）：explorer 在刷新、展开目录、切会话时会重复问同一个 cwd。
- `WallpaperLayer`：只有 `data-wallpaper="on"` 时才给 `<img>` 设 `src`（enabled 进 state，`MutationObserver` 的 attributeFilter 加 `data-wallpaper`）。

**顺带查到的两个事实**（未改，留作下一轮）：

1. 变更按钮之前**恒显示「暂无改动」**——不是命名问题，是这份 3.6MB 响应在客户端侧拿不到结果，`changesCount` 一直是 0。修完之后实测按钮显示「变更（59 个文件）」。
2. `GET /api/sessions/<id>` 单次 **5.8MB**（95 条消息：`toolResult` 4.1MB + `user` 1.3MB，最大两条分别 2.3MB / 1.8MB）。这是切长会话的主要开销，属于响应瘦身（大 toolResult 截断 + 按需展开），需要单独一轮。

**验证**：`tsc`/`lint`/`test`（1264）全绿；`/api/git/status` 连测三次 0.156s → 0.007s → 0.006s；
首屏连测三次 955/918/751ms；壁纸关闭时 `monet-artworks` 请求数为 0。

### 22. 第三轮反馈的收尾修正（2026-09-17）

| 反馈 | 改法 |
| --- | --- |
| 「在项目中 / 不在项目中」用错了地方 —— 侧栏分区应该还是「聊天 / 项目」 | 回滚 `sidebar.projects` → 项目、`sidebar.chatWorkspace` → 聊天（三语）。**选择器**里的「在项目中 / 不在项目中（聊天）」保留：那是上一轮用户点名要统一的 |
| 壁纸不是全局，只在中间；透明度不能设置 | ① 右栏的**内层surface**（`.explorer-column` / `.file-panel-body` / `.file-panel-main` / `.file-viewer-shell`）自己画着不透明的 `var(--bg)`，所以容器透明了里面还是实心板 → 一并透明；② 新增 **一个总旋钮** `--wp-panel-alpha: max(35%, calc(var(--wallpaper-scrim) - 5%))`，侧栏 / 右栏 / 顶栏都吃它 —— 遮罩滑杆从此同时控制「图片露多少」，不再是写死的 72%（desktop fork 也是写死的，这里按用户要求做成可调）；③ 遮罩滑杆与三个区域模式原本被 `url && active` 挡住，**用内置壁纸时整组控件都不出现** —— 改成只看 `enabled` |
| 那个按钮不是「审查」是「变更」，功能本来就有 | `sidebar.reviewChanges` → 「变更（{count} 个文件）」、`sidebar.noChanges` → 「变更（暂无改动）」（三语）。点击行为不变（在树里展开/收起变更文件列表） |

**验证**：scrim=40 时侧栏实测 `alpha 0.35`、外壳与聊天列透明 → 壁纸铺满整窗（截图确认）；侧栏分区标题回到「聊天 / 项目」；
变更按钮 tooltip 为「变更（暂无改动）」；`tsc`/`lint`/`test`（1264）全绿。

### 21. 用户截图反馈的一批问题（2026-09-17 第三轮）

用户拿八张截图逐条指出问题，全部落地：

| 图 | 问题 | 改法 |
| --- | --- | --- |
| 1 | 推理块被截断，底部浮着一个半透明的「展开全文」，看着像坏了；而且不知道为什么要有第二层折叠 | **删掉整层 clamp**：`ReasoningBody` 不再接 `clamped`/`onToggleClamp`，删除 `expandedIds`/`toggleClamp`、`is-clamped` 与 `::after` 渐变、`process-reasoning-more` 按钮及相关 CSS。行的 chevron 已经是唯一的开合控件（推理块本身**是**实时渲染的：每步结束时立即出现，不是切会话后才补） |
| 2a | 设置页右侧一大片空白 | `.settings-general` 的 `max-width: 680px` → `840px`（原来是内容列比容器窄 200 多 px） |
| 2b | **壁纸打开后完全没反应** | 真因：外壳 `.app-shell-layout` 与聊天列 `.chat-slot` 各自画着不透明的 `var(--bg)`，图片被压在下面，只能靠 sidebar 的 72% 半透明透一点。现在 `html[data-wallpaper="on"]` 时这两层让位（`.chat-slot` 仅在 ≥960 分栏时让位：窄屏它可能是覆盖层，透明会露出下面的编辑器），顶栏与 composer 并入面板半透明层 |
| 3 | minimap 悬停预览太密，一屏全是字 | 预览密度：用户提示 4 行 → 2 行、字号 14→13；助手行降级为 12px/`--text-muted` 且只保留前 5 行（`.outline > :nth-child(n+6)`）；当前 turn 的序号改用 accent 色 |
| 4 | 圆环不该替换压缩图标 —— 圆环要独立放在输入框里 | `ContextUsageRing` 从「压缩」按钮里挪出来，作为独立读数放在发送键左侧（15px、hover 出百分比/tokens），压缩按钮恢复原图标 + 文案 |
| 5–7 | 项目选择器 / 侧栏用词不统一 | 三语统一为「在项目中 / 不在项目中」：侧栏分区头 `sidebar.projects` → 在项目中、`sidebar.chatWorkspace` → 不在项目中；新建任务选择器标题与项目 `⋯` 菜单标题同词（后者原本是硬编码中文「已添加的工作区」，已改走 i18n）、菜单底部「使用默认目录」→「不在项目中（聊天）」 |
| 8 | 文件浏览器两排图标、且少了审查按钮 | `ExplorerPanel` 新增 `trailingActions` 槽：树在面板里时，面板级的「新建浏览器标签」并进树工具栏 → 只有一排（标题 + 终端/审查/搜索/上传/刷新/浏览器 = 7 个）。新增 `fork:ui-review-button`：变更数 0 时按钮**不再消失**（原来 `changesCount > 0` 才渲染，于是审查入口时有时无），改灰色禁用 + tooltip「没有未提交的改动」，有变更时 tooltip「审查变更（N 个文件）」 |

**验证**：`tsc` 0 错 ｜ `lint` 0 错 ｜ `test` 1264/1264 ｜ prod 构建 + Chrome 实测：
`.chat-slot` 背景变透明、两处 header 为 `0.72` 半透明（壁纸可见，见截图）；`.process-reasoning-body.is-clamped`
与 `.process-reasoning-more` 均为 0 个；圆环独立存在（title「83% used / 827.8k / 1.0M tokens」）
且 conic-gradient 只剩 1 处（压缩键已恢复原图标）；树工具栏一行 7 个按钮含「没有未提交的改动」的审查键。

### 20. 补上 §19 没落的三项 + 顶栏溢出菜单（2026-09-17 第二轮）

用户反馈「分析过的还没加上」，回头把计划里剩下能安全落地的做掉：

| 编号 | 改了什么 | 接触面 | 回滚 |
| --- | --- | --- | --- |
| ui-context-ring | **输入框旁的上下文圆环**（`components/fork/ContextUsageRing.tsx`）：13px `conic-gradient` 环 + 中心挖空，按 >70% warning / >90% danger 取色；放进现有「压缩」按钮当图标 —— 悬停显示「83% used / 827.8k / 1.0M tokens / 压缩上下文」，点击仍是压缩。不新增控件、不动手机控件行。数据走 `ChatWindow` 已持有的 `contextUsage` → `ChatInput` 新可选 prop | T0 + 2 处接线 | 删组件与 prop，恢复原压缩图标 |
| ui-08（结构版） | 设置改**左列导航**：`SettingsPanel` 新增 `.settings-dialog-body` 两列壳，184px 竖向导航（选中 = `--bg-selected` + 左侧 accent 竖条 2×16），横向 tab 那套 96px/下划线规则删除；手机仍用顶部 select | T1（SettingsPanel 结构）+ fork 自有 CSS | 恢复 `settings-section-tabs` 的横向规则与 nav 的 DOM 位置 |
| ui-width | 正文列宽 **860 → 800**（`--chat-content-max-width` 与 `CHAT_CONTENT_WIDTH_DEFAULT`）：上游 760、Wegent 768，860 的段落行太长。用户可在「设置 → 通用」覆盖（下限 640 不变） | T1（globals.css + hook 常量 + 测试期望） | 两处常量改回 860 |
| ui-14（溢出） | 顶栏「系统提示词 / 工具定义」收进 `⋯` 菜单（桌面端）：`activeTopPanel` 新增 `"more"`，弹出面板右对齐、宽 200px；手机端保留原内联按钮（它本来就有溢出层） | T1（AppShell 1 处按钮搬家 + 菜单分支） | 还原两个按钮的渲染条件与菜单分支 |

**仍然没做的两项，以及为什么**

- **ui-06 底部面板**：需要先把 `activeFileTabId` 拆成「右栏 tab / 底栏 tab」两个 id，并给 `useResizablePanel` 加竖向模式；
  `handleCloseFileTab` 里还混着工作区翻转逻辑。这不是样式改动而是标签模型重构，应单独一轮做（并在浏览器里四档实测）。
- **ui-10 全量 `DialogShell`**：手机 bottom-sheet 已经拿到（§19），剩下的部分是桌面端一致性，可视收益接近零。

**验证**：`tsc` 0 错 ｜ `lint` 0 错 ｜ `test` 1264/1264 ｜ prod 构建后 Chrome 实测：
圆环 13×13 且 83% 时为 warning 色、title 三段齐全；设置导航 `flex-direction: column` / 宽 184 / 选中 `oklch(0.3 0 0 / .095)`；
正文列 800px、composer 832px；顶栏按钮变为「完整历史 / 生成标题 / 更多操作」，
`⋯` 菜单含「系统提示词 / 工具定义」，点第一项后系统提示面板正常展开（宽 1196）。

**验证**（本次全部通过）：`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 全是既有的）｜
`npm test` 1264/1264 ｜ `npm run prod` 后在真实 Chrome（Playwright + 系统 Chrome）实测：
空态首页 1440/390 两档（4 卡、手机两列、点击只填输入框）、用户气泡右对齐且右边缘与列对齐（`gap=0`，
宽 602 上限生效）、设置 tab 宽度 69–81px 变宽自适应、`--radius-composer` 仍为 22px。

### 21. 新会话首页的工作区选择器（2026-09-17 第三轮，MU-32）

MusePi 的首页在输入框上方有一行「这条会话在哪跑」的选择器（`WelcomeComposer.tsx:1202-1300`）。
本 fork 的能力其实早就有了 —— 侧栏「新建任务」右边那个 26px chevron 里就是同一个 `NewTaskPicker` ——
但首页看不到、也改不了。这一轮只是把它搬到看得见的地方，并补齐它缺的两个动作。

| 编号 | 改了什么 | 接触面 | 回滚 |
| --- | --- | --- | --- |
| fork:ui-projectchip | 新组件 `components/fork/ProjectChip.tsx`：输入框上方左对齐的胶囊（folder 图标 + 目标名 + chevron），点开走**共享 `ContextMenu`**（不手写浮层）：当前目标（✓，仅一行不再重复成动作）→ 其他项目 → 分隔线 → `打开文件夹` / `新建空白项目` / `不在项目中（聊天）`。移除项目仍然只在侧栏右键，与参考实现一致 | T0 新文件 + T1 接线 | 删组件与 `newSessionTargets` prop |
| — | 「打开文件夹」复用 `DirectoryPicker`，选中后先过 `/api/cwd/validate`（顺带把新根加进 `/api/files` 白名单），再 `handleCwdChange(cwd, projectRoot, projectKey)` + `handleNewSession(tempId, cwd)` —— 与侧栏 `startSessionIn` 完全同一条路径。「新建空白项目」复用现有 `/api/default-cwd`（`~/pi-cwd-<日期>`），不做命名弹框 | T1（AppShell handler） | 去掉两个 action 的 handler 与 `DirectoryPicker` 挂载 |
| — | `ContextMenuProvider` 从「只包 `SessionRowContextMenuBridge`」提升到包住整棵 AppShell 树：它此前是主界面的**兄弟**节点，所以主界面里的组件拿不到 `useContextMenu`（首页胶囊一挂上去就抛 `must be used inside a ContextMenuProvider`）。这是这次唯一的结构性改动，也让以后任何面板都能直接用同一个浮层入口 | T1（AppShell 首尾各一行） | 把 provider 挪回 bridge 外层 |
| fork:ui-projectchip（CSS） | `app/fork-ui.css` 给 `.context-menu` 补 `max-height: calc(100dvh - 16px)` + `overflow-y: auto` + `overscroll-behavior: contain`：上游只有 `max-width`，项目多时菜单会长过视口，被自身的贴边 clamp 顶掉首行导致点不到 | T0（fork 自有 CSS） | 删该块 |

**时机安全**：`ensureNewSession()` 是懒创建（`hooks/useAgentSession.ts:638-690`），首条消息之前换 cwd 只改 prop、不落任何文件；
`handleNewSession` 内的 `invalidateWorkspaceRestore()` 会作废 `handleCwdChange` 刚发起的「恢复上次会话」请求，
所以换完项目不会被旧会话顶掉（token 校验，`AppShell.tsx:682-700`）。

**验证**：`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 均为既有）｜ `npm test` 1272/1272（新增 `components/fork/ProjectChip.test.mjs` 7 例：选中行只出现一次、项目行带全路径 title、三个动作齐全、聊天项在当前时不再重复、chatPath 缺失时 disabled、SSR 渲染标签与 aria）｜
`npm run prod` 后真实 Chrome（Playwright + 系统 Chrome，1440×900）实测：胶囊显示 `pi-web-0.9.0` →
菜单 12 个项目 + 分隔线 + 三个动作 → 切到「不在项目中（聊天）」后胶囊跟随、再开菜单聊天项只剩 ✓ 那一行 →
切回项目正常 → Esc 关闭 → **console 0 error**。

### 22. 第一批「借鉴清单」落地（2026-09-17，MU-01/02/21/28/33 + MU-15 台账）

按 `docs/musepi-borrowing-plan-2026-09-17.md` §6 的顺序做掉第一梯队里互不依赖的几项。
共同点：都**不改行为**，只补纪律与反馈。

| 编号 | 改了什么 | 接触面 | 回滚 |
| --- | --- | --- | --- |
| MU-02 | `app/fork-ui.css` `:root` 补动效词汇表：三条阻尼弹簧 `--fork-spring / -snappy`（逐点抄参考实现的 `linear()` 点列，手写贝塞尔过冲感不一样）+ `--fork-motion-menu/chip/fade/height` + `--fork-travel-menu`。约定：新动效读 token，关键帧可覆写、时长/缓动不得硬编码 | T0 | 删该块（现有动画不受影响） |
| MU-01 | 浮层**两段式入场**：新 `hooks/useTwoPhaseEnter.ts`（`enteredClass()` 组合类名 + 双 rAF 置位），`ContextMenu` 接上 `context-menu--entered`，CSS 在 `fork-ui.css`。此前 `.context-menu` 只有退场过渡 —— 菜单是从**终态挂载**的，所以入场动画根本不会播（真机实测：改前 opacity 直接是 1，改后 0 → 1 走完 130ms） | T0 新 hook + T1（ContextMenu 两行） | 去掉 hook 调用与那段 CSS，菜单回到瞬时出现 |
| MU-21 | 复制按钮的二态图标：新 `components/fork/CopyStateIcon.tsx`（两个 glyph 常驻 + `data-copied` 驱动），`fork-ui.css` 里 opacity/scale/rotate 交叉淡入；替换 `MessageView` 两处 `{copied ? <Check/> : <Copy/>}`。按钮宽度不再因换图标跳动 | T0 新组件 + T1（MessageView 两处） | 恢复原来的条件渲染 |
| MU-28（部分） | 数字对齐与 CJK 折行：`tabular-nums` 给 `.chat-stats-center / .session-info-popover / .mobile-session-stat-*`；`word-break: keep-all` + `overflow-wrap: anywhere` 给 `.markdown-body` 的 p/li/td/th/blockquote。**没做** `content-visibility: auto`：minimap 与滚动恢复依赖真实行高（`ChatMinimap` 吃 `messageRefs` 的测量值），`contain-intrinsic-size` 会喂给它们占位高度 —— 要做必须先把 minimap 改成从会话索引推导位置 | T0（fork 自有 CSS） | 删该块 |
| MU-33 | 输入框旁的**轮播提示行**：新 `components/fork/ComposerTipLine.tsx`（12 条提示 × 3 语种，20s 轮换、随机且不重复上一条）+ `fork-tipline` 淡入动画，接在首页「工作区胶囊」右边，出现错误时让位给错误文案。12 条全部描述**当前已存在**的能力（没把未实现的 ⌘K 写进去） | T0 新组件 + T1（ChatWindow 一行 + 三份 i18n 各 12 行） | 删组件与三处 i18n 键 |
| MU-15 | 台账两条铁律（下次做高度动画时照做）：① 高度过渡期间**必须 `overflow: hidden`**，否则新内容瞬间填满、只看到盒子边缘在动＝没有动画；② 高度差 <1px 时**跳过钉高**只播淡入，否则滚动条会消失 300ms | T0（文档） | — |

**顺带修掉一个真 bug（MU-01 的连带）**：入场 `scale(0.98)` 让 `ContextMenu` 的贴边 clamp 量到偏小的矩形（过渡首帧的 `getBoundingClientRect` 已带缩放），390×844 上菜单会**溢出视口 2px**。改用不受 transform 影响的 `offsetWidth/offsetHeight` 做 clamp（`entered` 重测无效 —— 那是过渡第一帧，量的还是缩放值，已实测排除）。

**验证**：`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 均为既有）｜ `npm test` **1280/1280**（新增 10 例：`enteredClass` 类名拼接的两种失败模式、提示行三语完整性/轮换不重复/单条退化/SSR 渲染、复制图标两态常驻）｜
`audit-tokens.mjs` 29 个刻度 token 齐全且五套调色板 OK ｜ `verify-themes.mjs` 五套全 OK ｜
prod 构建后真实 Chrome 实测：提示行 `fork-tipline-in 0.16s` 且显示中文提示；菜单类名 `context-menu context-menu--entered`、transition 0.13s、opacity **0 → 1**；
注入实测计算样式 `word-break: keep-all` / `overflow-wrap: anywhere` / `font-variant-numeric: tabular-nums`、复制图标 idle{1,0} → copied{0,1}；390×844 菜单 y=427 高 411 全在视口内（修前 435/溢出 2px）；**console 0 error**。

### 23. 第三梯队的可落地部分（2026-09-17，MU-14/19/20/22/30 + MU-09 结论）

第三梯队里 5 项落地、1 项经核实**没有增量**、3 项留到下一轮。

| 编号 | 改了什么 | 接触面 | 回滚 |
| --- | --- | --- | --- |
| MU-14 | **设置搜索**：左列导航上方加输入框；关键词表（中英双语）命中分区时给导航项加 `--hit` 高亮；同时扫描当前分区里的行（`.settings-general-section > *`）加 `.settings-search-match` 并 `scrollIntoView({block:"center"})`；无命中显示一行提示。**已知上限**：Models/Skills/Agents/Plugins 的内容在自己组件里，没有稳定行元素，只由关键词表覆盖（跳分区仍有效） | T1（SettingsPanel 结构）+ fork 自有 `settings.css` | 删输入框、`sectionSearchTerms`、高亮 effect 与两段 CSS |
| MU-19 | **轮次摘要升级**：`summarizeSteps` 除工具/失败/思考外，新增「N 个文件 / N 条命令」：写入类工具用 `lib/tool-names.ts` 判定 + `file_path ?? path` 取路径（**去重**，同一文件改三次算一个），`apply_patch` 走 `extractApplyPatchPaths` 精确取多目标，只读类工具单独计 reads。修正了一个真实误判：`classifyDocumentChangeKind` 对**任何**工具都返回非空，原顺序会把 read 算成改文件 | T0（ProcessGroup 内部函数）+ 3 个 i18n 键 | 恢复旧 `summarizeSteps` |
| MU-20 | **PathActions + 后端**：新 `lib/path-actions.ts`（纯函数，argv 数组、不经 shell）、新路由 `app/api/files/reveal`（`POST {path, action}`，白名单校验同 `/api/files`，`spawn` + `detach`）、新 `components/fork/PathActions.tsx`（复制路径 / 文件管理器显示 / 默认应用打开），接在文件查看器工具栏。**reveal 目录时打开目录本身**（原设计会打开父目录，测试抓到了） | T0 新文件 + T1（FileViewer 一行） | 删组件/路由/lib 与那一行 |
| MU-22 | **界面密度**：`lib/ui-density.ts`（三档 + 因子）+ `hooks/useUiDensity.ts`（照 `useBorderDepth` 的模式，写 `--fork-density` 与 `data-density`）+ 设置里的下拉 + CSS 让 `--conversation-item-gap` 与聊天列 gutter 跟着缩放。**上限**：会话行不缩放 —— 侧栏列表按固定 `SESSION_LIST_ITEM_HEIGHT` 虚拟化，改行高会和虚拟器错位（提示文案里也写了） | T0 新 lib/hook + T1（设置 + ChatWindow 两处 padding） | 删两文件、设置项与 CSS 块 |
| MU-30 | **浏览器视口预设**：面板工具栏加下拉（填满 / 390 / 768 / 1024 / 1280），非填满时 iframe 定宽居中 + 细边框。实测 390 生效，768 在 511px 宽的面板里被 `maxWidth:100%` 收住（预期行为） | T1（BrowserPanel 三处）+ 5 个 i18n 键 | 删下拉与 iframe 的宽度分支 |
| MU-09 | **核实结论：不做**。① 队列本来就已经是常显列表（`Queued · N` 头部 + 卡片 + Recall），再加一个 chip 是重复；② todo 半边没有数据源 —— 仓库与 pi SDK 都没有 `todo` 工具（`lib/tool-presets.ts` 的工具集是 read/bash/edit/write/grep/find/ls），MusePi 的 todo chip 建立在它自己的 `todo` 工具上。等上游有该工具再接 | — | — |

**验证**：`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 均为既有）｜ `npm test` **1299/1299**（新增 21 例：路径命令三平台 + 恶意路径不拆参数 + reveal 目录语义、reveal 路由的 5 条边界、轮次摘要 4 例、密度 3 例、设置搜索与源码形状断言 3 例）｜
prod 构建后真实 Chrome：搜索「密度」→ 命中行 accent 洗底 + 导航 `--hit`（截图 `test-results/tier34/1-settings-search.png`）；密度切紧凑 → `--fork-density: 0.85`、`--conversation-item-gap: calc(16px * 0.85)`、`data-density="compact"`；浏览器视口 填满 511 → 390 生效 → 回填满 511；路由守卫 `/etc/hosts` 403、非法 action 400；**console 只有我自己守卫测试产生的 403/400**。

### 24. Todo 工具 + 任务面板（2026-09-17，MU-09 / MU-27 复活）

**推翻一条早先的错误结论**：§23 写过「MU-09 todo 半边没有数据源，上游没有 todo 工具，不做」。
那只查了 *内建工具*，没查 *扩展*。事实是：

- SDK 的工具注册面是扩展（`docs/extensions.md`「Custom tools」），pi-web 自己就用它注册了 `Agent` / `get_subagent_result` / `steer_subagent`（`lib/subagent-extension.ts`）；
- SDK 官方示例里**直接有一个 todo 扩展**：`node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts`（297 行）；
- SDK 文档《State Management》给的范式就是「状态放 tool-result `details`，`session_start`/`session_tree` 从当前分支重建」——这个属性比外置文件更强：**分支回退时列表跟着回退**。

据此实现（PR 形态）：

| 编号 | 改了什么 | 接触面 | 回滚 |
| --- | --- | --- | --- |
| fork:ui-todo（核心） | `lib/todo-state.ts`：纯状态机（`list/set/add/toggle/remove/clear`、错误不改状态、`set` 保留同名条目的完成态、`nextId` 只增不复用）+ 从转写里回读（`extractTodoState`，last-wins、按 `kind` 与工具名双重校验、分支回退即回退） | T0 新文件 | 删文件与 3 处引用 |
| fork:ui-todo（工具） | `lib/todo-extension.ts`：内联扩展，`defineTool` 注册 `todo` 工具（带 `promptSnippet`/`promptGuidelines`，让模型知道何时用），`session_start`/`session_tree` 重建；工具**无条件注册**（不像 subagent 那样跟设置走） | T0 新文件 + T1（`lib/rpc-manager.ts` 的 `extensionFactories` 一项） | 删文件与那一项 |
| fork:ui-todo（UI） | `components/fork/TodoChip.tsx`：输入框上方的 `2/4` 胶囊 + 进度条，点开只读面板（勾选/划线 + 「复制清单」）；`ChatWindow` 用 `useMemo` 从消息派生（`extractTodoState(messages)`）后经 `ChatInput` 的新 prop 传入。**只读是刻意的**：在 UI 里改会去重写已落盘的 tool result，而会话格式不允许改写历史 | T0 新组件 + T1（ChatWindow / ChatInput 各一处）+ 6 个 i18n 键 | 删组件、prop 与 i18n 键 |

**验证**（隔离 agent 目录，不动用户真实会话）：
`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 均为既有）｜ `npm test` **1308/1308**（新增 9 例：`set/toggle` 语义、`set` 保留完成态、id 不复用、6 类错误调用不改状态、list 渲染、转写回读 last-wins、分支回退、外来/畸形 details 被忽略、类型守卫）｜
工厂直测：注册 `todo`、订阅 `session_start`/`session_tree`、`execute` 返回正确 details ｜
活会话实测：`POST /api/agent/<id> {type:"get_tools"}` 返回 13 个工具，**含 `todo`**（与 `Agent`、`get_subagent_result`、`steer_subagent` 并列）｜
端到端（临时 `PI_CODING_AGENT_DIR` + 造一条含 todo tool result 的会话 + 侧栏点开）：胶囊显示 `2/4`、面板 4 条状态与勾选正确、「复制清单」在位、**console 0 error**（截图 `test-results/tier34/4-todo-chip.png`）。

**顺带发现（未修，非本次改动引入）**：URL 里的 `?session=<id>` 不会打开会话 —— 真实会话的 4 个 id 与隔离环境造的新会话都复现；点侧栏进入正常。下次单独排查（`AppShell` 的 `initialSessionId` → 侧栏恢复链路）。

### 25. 定时任务 + 记忆（2026-09-17，两个新功能）

用户点名要的两项。先查了能力面：**SDK 两者都没有** —— 没有 `cron/schedule` API，也没有 `memory_*` 工具（`docs/*.md` 里 memory 只出现在 "in-memory" 之类的无关句子）。所以都在 pi-web 侧实现，且都**复用已有设施**（进程内 SDK、agent 目录配置、内联扩展），没有新依赖。

#### 定时任务（fork:cron）

| 文件 | 作用 |
| --- | --- |
| `lib/cron-schedule.ts`（纯） | 时间解析与下次运行计算：`daily` / `weekly` / `once` + 多个 `HH:MM`（本机时区）。**刻意不做 cron 表达式**：没有依赖、也不需要教用户五段语法。另有 `cronDueState()` —— 到点判定 + **错过窗口**（5 分钟）：服务停机期间错过的运行跳过而不是补跑 |
| `lib/cron-store.ts` | `<agentDir>/pi-web-cron.json`（`{version, tasks}`），与 `pi-web-chat.json` 同一套约定；损坏文件降级为空而不是让调度器挂掉；`normalizeTask()` 只接受能跑的字段 |
| `lib/cron-runner.ts` | 30s tick；到点用**进程内** `startRpcSession()` + `session.send({type:"prompt"})` 打开一条**普通会话**（所以定时跑出来的会话在侧栏能打开/分支/归档）；每任务 running 守卫；成功/失败写回 `lastStatus` / `lastRunAt` / `lastSessionId` / `runCount` |
| `instrumentation.ts` | 服务启动时 `startCronScheduler()`（`NEXT_RUNTIME === "nodejs"` 分支内，timer 已 `unref`） |
| `app/api/cron/route.ts` | GET / POST / PATCH（含 `action:"run"` 立即运行）/ DELETE，全部走 `isApiRequestAllowed` + JSON 校验 |
| `components/fork/CronConfig.tsx` | 设置里新分区「定时任务」：新建（名称/提示词/工作目录/重复/时间/日期/星期）+ 列表（启用开关、下次运行、上次状态、立即运行、删除） |

#### 记忆（fork:memory）

| 文件 | 作用 |
| --- | --- |
| `lib/memory-store.ts` | `<agentDir>/pi-web-memory.json`；条目 `{text, scope, source, createdAt}`，scope = `global` 或某个项目路径；**去重**（同文本同 scope 只存一份）、文本上限 500 字（防止一条记忆吞掉注入预算）、增删改查 + `recallMemory()`（令牌全覆盖 + 覆盖率排序，CJK 也按字串切）+ `renderMemoryBlock()`（分 Project / Global 两段，无可注入内容时返回空串） |
| `lib/memory-extension.ts` | 内联扩展：`remember` / `recall` 两个工具（模型可自己写、自己查，scope 默认取会话 cwd）+ **`before_agent_start` 每轮注入**当前记忆（SDK 文档的 injection 通道，`display:false`）——所以会话中途记住的事，下一轮就生效；单测/无记忆时注入为空 |
| `app/api/memory/route.ts` | GET / POST / PATCH / DELETE（用户侧管理，`source: "user"`） |
| `components/fork/MemoryConfig.tsx` | 设置里新分区「记忆」：新增（内容 + 作用范围）、列表（编辑 / 删除 / 来源 / 日期） |

**刻意没做**：embedding / SQLite / 语义检索（MusePi 有独立的 `packages/mnemopi`）。`ponytail:` 上限写在文件头 —— recall 是子串扫描，条目上量后再考虑索引；把记忆做成搜索产品不是这个仓库该干的事。

**验证**（全部在**隔离 `PI_CODING_AGENT_DIR`** 里跑，不碰真实会话与配置）：
`tsc --noEmit` 0 错 ｜ `npm run lint` 0 错（8 条 warning 均为既有）｜ `npm test` **1323/1323**（新增 15 例：时间解析/下次运行/due 与错过窗口/描述、记忆持久化/去重/上限/作用范围隔离/改删/recall 排序与 CJK/注入块为空）｜
prod 构建后 API 实测：记忆 空表 → 新增（`source:user`）→ **重复新增仍是 1 条且 id 相同** → 编辑生效 → 落盘；`get_tools` 返回 **11 个工具含 `todo` / `remember` / `recall`**；定时任务 非法时间 400、缺提示词 400、创建（`nextRunAt` 正确算到当天 18:30）、列表、停用、**立即运行真的跑了 runner**（隔离目录没有 API key，于是 `lastStatus:"error"` + `lastError` 是真实的模型报错 + `runCount:1` + `lastSessionId` 已记录 —— 错误路径也是通的）、删除；UI 两个新分区都能打开并渲染（截图 `test-results/tier34/5-cron.png`、`5-memory.png`），**console 0 error**。

### 26. 记忆加开关与自动学习、定时任务补 cron/闲时窗口/时区（2026-09-17，按用户对照补功能）

用户拿参考实现的截图比对，指出两处缺东西：**记忆是静态的、没有开关**；**定时任务缺 cron 表达式 / 闲时窗口 / 时区 / 模型与思考级别**。以下按截图逐项补齐。

#### 记忆：开关 + 自动学习

| 改了什么 | 说明 |
| --- | --- |
| **两个开关，默认全关** | `MemorySettings { enabled, autoLearn }` 写进同一个 `pi-web-memory.json`（旧文件无 `settings` 字段 → 迁移为关闭，条目保留）。**关闭时不注入任何内容**，`remember` / `recall` 的 `execute` 直接返回 `memory is disabled` |
| 开关**不做工厂期拦截** | 工具常驻注册、`execute` 里判开关 —— 与 subagent 开关（改了要手动 reload 会话）不同，这里用户在设置里一拨就立刻生效，不会出现「开了没反应」 |
| **停止时自动捕获** | `agent_start` 武装 + `agent_settled` 触发一次 `pi.sendUserMessage(MEMORY_CAPTURE_PROMPT)`；捕获回合自身不再武装（`capturing` 标志），否则会自追自。提示词要求**最多两条**并允许明确回「nothing to remember」，避免没东西可记时编造条目。默认关（要花 token，截图里原文也这么提示） |
| 面板 | 顶部开关区（启用 / 自动学习 / 一行状态「记忆已开启 · 自动学习开 · 已保存 · N」）+ 条目搜索框（>4 条时出现）+ 原有增删改 |

#### 定时任务：表达式 / 闲时窗口 / 时区 / 模型与思考

| 改了什么 | 说明 |
| --- | --- |
| `lib/cron-expression.ts`（新，纯） | 手写 5 字段解析器：`*`、`N`、`a-b`、`a,b`、`*/n`、`a-b/n`；日/星期同时限定时采用 Vixie 的「或」规则；星期接受 0 与 7 都算周日；解析失败返回**可读原因**（直接显示在表单里）。无依赖 |
| `lib/cron-timezone.ts`（新，纯） | 用 `Intl` 做两个方向的换算（`zonedParts` / `zonedTimeToInstant`，后者用两遍偏移猜测处理 DST）。cron 字段匹配的是**目标时区的墙上时间** |
| 闲时窗口 | `idleWindow {start,end}`，支持跨午夜；**窗口外触发顺延到窗口开始**而不是丢弃（截图原文语义），24 小时窗口会被归一化掉 |
| 扫描策略 | 按天筛 + 只在命中的那天扫 1440 分钟，最多 366×2 天 —— 否则「2 月 29 日」这类表达式要按分钟走好几年 |
| 任务级 `model` / `thinking` | 透传给 `startRpcSession` 的 `initialModel` / `thinkingLevel`；`cwd` 允许留空 → runner 回退到默认工作目录（聊天工作区），对应截图里的「留空用默认工作目录」 |
| 表单 | 名称 / 模型（读 `/api/models?cwd=`）/ 思考级别 / 提示词 / 工作目录 / 计划类型（Cron 表达式 · 每天 · 每周 · 仅一次）/ 表达式 + 五字段说明 + **5 条可点示例**（与截图同串同文案）/ 星期 chips / 闲时窗口起止 + 清除 / 时区（主机 + `Intl.supportedValuesOf("timeZone")`）/ 启用开关；列表行显示表达式·时区·窗口·模型·思考 |

**修掉的两个真问题**：① 示例按钮复用了 `.settings-chat-reset`（那是 28×28 图标按钮），把示例挤成了逐字竖排 —— 改为自撑开的一行；② `/api/models` 不带 `cwd` 会被 403（它按可浏览根校验），表单里现在带上面板的 cwd。

**验证**：`tsc` 0 错 ｜ `lint` 0 错 ｜ `npm test` **1335/1335**（新增 12 例：表达式解析与错误文案/Vixie 或规则/5 条示例都能算出下次运行/不可能表达式不空转、闲时窗口跨午夜与顺延、时区换算与 DST、记忆开关三态与自动捕获不自追、跨项目作用域隔离）｜
live API：默认 `{enabled:false,autoLearn:false}` → 打开后持久化；`schedule.expression/idleWindow/timezone/model/thinking` 全部落盘，`nextRunAt` 实测按 `America/New_York` 的 09:00 算出（=13:00Z）；4 字段表达式被 400 拒绝 ｜
UI（隔离 agent 目录 + 真 Chrome）：记忆页 4 个开关与状态行正确，定时任务页切到「Cron 表达式」后 5 条示例、2 个闲时窗口输入框都在位，**console 0 error**（截图 `test-results/tier34/6-memory-v2.png`、`7-cron-v2.png`）。

**仍未对齐参考实现的部分（有意）**：记忆后端选择（关闭 / 本地 / Mnemopi SQLite / Hindsight 远程）——我们只有「本地」一档，另两档是它自己的引擎包；记忆文件列表（learned.md 等 4 个 .md）——我们用 JSON + 面板，条目级改删更可靠；定时任务的日历视图与运行历史浏览器；月/年计划类型（cron 表达式已能表达）。

### 27. MCP 独立菜单 + 记忆改用户点名读 pi-memory + MU-10（2026-09-17）

#### MCP 从插件页拎出来（fork:mcp-section）

用户要求 MCP 有独立菜单。做法是**一个实现两个入口**而不是搬 500 行代码：`PluginsConfig` 新增
`only="mcp"` 模式（该模式下强制 MCP 视图、隐藏插件侧栏/详情/按钮；默认模式反过来隐藏 MCP），
新组件 `components/fork/McpConfig.tsx` 只做一层包装，设置里多了独立分区「MCP 服务器」
（枚举 + 导航 + 插头图标 + 搜索词）。实测：分区列表 `["常规","模型","技能","子代理","插件","MCP 服务器","定时任务","记忆"]`，
MCP 页有「添加 MCP / 从其他工具导入」且**没有**插件页的按钮；插件页不再出现 MCP。

#### 记忆：改用 npm 官方包 pi-memory（用户点名）

`pi-memory` 确实存在（npm 0.4.2，作者 jayzeng，官方 pi 包目录收录，2431 行）：7 个工具
（`memory_write/read/forget/restore`、`scratchpad`、`memory_search`、`memory_status`）、
markdown 落盘 `~/.pi/agent/memory/`、`before_agent_start` 选择性注入、可选 qmd 语义搜索。
它比本 fork 自研的 JSON 记忆强一个量级，所以：

- 通过 pi-web 既有的插件 API 安装（`POST /api/plugins {action:"install", source:"npm:pi-memory"}`，
  与 `pi install npm:pi-memory` 同一条 `DefaultPackageManager.installAndPersist` 路径）；
- **退役自研实现**：删掉 `lib/memory-store.ts`、`lib/memory-extension.ts`、`components/fork/MemoryConfig.tsx`、
  `app/api/memory/route.ts` 与它们的测试，以及 `rpc-manager` 里的扩展注册 —— 两套记忆会重复注入、
  工具重名，必须只留一套；
- 新面板 `components/fork/PiMemoryConfig.tsx` + `app/api/memory/files/route.ts`（只读、限定在记忆目录内）：
  显示安装/启用状态、一键安装/启用/禁用、工具清单、记忆文件列表与内容预览。

实测：安装后活会话 `get_tools` 返回 22 个工具，其中 7 个 `memory_*`；`~/.pi/agent/memory/{daily,recovery}` 自动创建；
设置面板显示 `pi-memory · 0.4.2 · 已安装并启用` + 目录 + 「还没有文件」（确实还没写过）✓。

#### MU-10：会话状态标记 + 排序 + 全部展开

| 改了什么 | 说明 |
| --- | --- |
| 状态标记（tag） | `lib/session-flags.ts` 增加 `tags: Record<id, tag>`，5 档（complete/interrupted/error/aborted/pending）+ 各自的 token 色彩；仍是 localStorage、仍是展示层，不写会话文件 |
| 行内圆点 | 指示位优先级 running > tag > unread；右键菜单新增「状态标记」子菜单（子菜单类型不支持分隔符，所以「清除标记」自己占一行） |
| 排序 | 项目头部工具条新增排序切换（按更新 / 按创建）；`orderedProjectSessions()` 成为唯一的「项目→有序行」入口，5 处列表调用点统一走它，避免各写一份排序 |
| 全部展开/收起 | 同一条工具条；对当前可见项目集合生效 |

**验证**：`tsc` 0 错 ｜ `lint` 0 错 ｜ `npm test` **1336/1336**（新增 9 例：flags 旧载荷兼容/未知 tag 丢弃/token 色彩齐全 + 排序与标记的既有断言更新）｜ 真 Chrome：排序按钮 `按更新时间`→`按创建时间`、全部展开可用、MCP 分区与 pi-memory 面板如上（截图 `test-results/tier34/11-mu10-sidebar.png`、`12-mcp-section.png`、`13-pi-memory.png`）。

#### MU-31 的核实结论：不做（等引擎）

SDK 里唯一的 `--approve/--no-approve` 是**项目信任**（是否加载项目内的 settings/extensions），
没有 per-tool 审批协议；pi-web 现在渲染的 `ExtensionDialog`（`select/confirm/input/editor`）已经是
扩展发起审批/问答的唯一通路，且带键盘导航、倒计时、Esc。MusePi 的「审批卡 + 允许一次/总是允许/拒绝 + 托盘热键」
建立在它自己 daemon 的 `approval-bridge` + `tools.approvalMode` 上，本仓库的引擎没有对应能力，
硬做只能造一个没有数据源的空壳。**保持现状**，等上游 pi 暴露审批协议再补。

### 28. MU-18（导出 Markdown / 标题即切换器）与 MU-12（标签溢出折叠）（2026-09-17）

| 编号 | 改了什么 | 说明 |
| --- | --- | --- |
| MU-18a | **导出 Markdown**：`GET /api/sessions/<id>/export?format=md`（`?inline=1` 不下载），新 `lib/session-markdown.ts` 纯函数 —— 正文逐字、工具调用压成一行（名称 + 首个参数）、工具结果折叠进 `<details>` 且截断 600 字、**思考块丢弃**（它不属于"说出来的话"）。入口在顶栏 `⋯` → 「导出 Markdown」，仅在有选中会话时出现 | 「把对话给我」是真实需求，HTML 导出是给分享用的，另一条路 |
| MU-18b | **标题即会话切换器**：顶栏标题变按钮，点开最近 10 条会话（当前项打勾）+ 「新建任务」。实现走 AppShell 已有的 top-panel 机制而不是 ContextMenu —— AppShell 自己在 `ContextMenuProvider` **之外**（provider 是它的子节点），这一点上次做工作区胶囊时已经踩过 | 换会话不必回侧栏 |
| MU-12 | **标签溢出折叠**：TabBar 逐标签量宽 → 纯函数 `splitVisibleTabs()` 决定「哪些留在栏里、哪些收进 `…」`；两条规则：① **活动标签永不隐藏**（藏在 `…` 里的活动标签和坏掉的面板没区别）；② 折叠按钮自身占宽，预算要预先扣掉。折叠菜单用 `position: fixed` —— TabBar 是 `overflow-x: hidden`，in-flow 下拉会被裁掉 | `lib/tab-overflow.ts` + 5 例单测 |

**验证**：`tsc` 0 错 ｜ `lint` 0 错（8 条既有 warning）｜ `npm test` **1344/1344**（新增 13 例：markdown 三例、溢出split 五例、以及 i18n 三语键一致性）｜
真 Chrome：标题按钮打开面板并列出「新建任务」✓；选中会话后 `⋯` 菜单出现「导出 Markdown」✓；
`/api/sessions/<id>/export?format=md` 返回 `text/markdown` 且正文/工具摘要格式正确（实测一份 500 条会话）✓；
1000px 宽 + 打开 6 个文件 → 只留活动标签 `tsconfig.json`，折叠按钮显示 `5`，菜单列出被折叠的 5 个（各带关闭）✓
（截图 `test-results/tier34/14-title-switcher.png`、`15-more-menu-export.png`、`16-tab-overflow.png`）。

**备注**：dev server 胶囊没有做 —— 「起/停 dev server」需要往终端会话里注入命令，`/api/terminal` 目前只有创建/输入/关闭通道，TerminalPanel 没有"带初始命令创建"的入口；把这条链路补上属于独立一件（要动终端面板与标签状态），留在下一轮。

### 29. 记忆面板 v3：真开关 + 让记忆文件看得见（2026-09-17）

用户反馈两点：**要一个开关**、**看不到任何记忆文档**。两点都成立：

| 问题 | 原因 | 改法 |
| --- | --- | --- |
| 没有开关 | 上一版是「启用 / 禁用」两个按钮，语义对但不是开关 | 换成 `ConfigSwitch` —— 拨动即调用插件 API 的 `enable`/`disable`。关闭 = 包被禁用 = **工具不注册、不注入**（不是把文件藏起来），面板文案写清了这一点 |
| 看不到记忆文档 | 面板只列**已存在**的文件，而新装的 pi-memory 目录里只有空的 `daily/`、`recovery/`，于是显示"还没有文件" | 面板现在列出 pi-memory 的**已知文件全集**：`MEMORY.md`、`SCRATCHPAD.md`、`daily/<今天>.md`。不存在的显示「尚未创建」+ 一键**新建**（带 starter 模板）；存在的可**预览**、**手改**（PUT，256KB 上限）、或**在编辑器打开** |

配套：
- `app/api/memory/files/route.ts` 增加 `PUT`，写入白名单只允许 `MEMORY.md` / `SCRATCHPAD.md` / `daily/<YYYY-MM-DD>.md`（路径包含检查 + 正则），原子写、大小上限；`GET` 时 `allowFileRoot(记忆目录)`，这样主文件查看器（含 markdown 编辑器）能打开这些路径 —— 之前它们在任何会话 cwd 之外，查看器会以"未受保护路径"拒绝。
- `SettingsPanel` 新增 `onOpenFile`，由 AppShell 接到既有的 `handleOpenFile`（与 `onOpenSession` 同一层）。

**验证**：`tsc` 0 错 ｜ `lint` 0 错（8 条既有 warning）｜ `npm test` 1344/1344 ｜ 三语键集合一致（1003 × 3，memory.* 23 键）｜ prod 构建后真 Chrome + 隔离 agent 目录实测：开关拨动写入 `settings.json` 的 packages 状态、`MEMORY.md`/`SCRATCHPAD.md` 显示「尚未创建」并可新建、PUT 拒绝越界路径（403）。
### 30. macOS 原生适配 + 改名 Pi Codex（2026-09-17，electron 壳）

用户反馈打包后「窗口不能移动、系统通知不工作、很多没适配」，并要把产品名改成 **Pi Codex**。

**根因（逐条）**：

| 症状 | 根因 | 改法 |
| --- | --- | --- |
| **窗口不能移动** | 主进程用 `titleBarStyle: "hidden"`（为了交通灯浮在自家顶栏上），但**网页里没有任何 `-webkit-app-region: drag` 区域** —— 隐藏标题栏 + 无拖拽区 = 没有任何可抓的地方 | `lib/desktop-shell.ts` 在检测到 preload 桥时给 `<html>` 加 `data-desktop-shell`，`app/fork-ui.css` 据此把顶栏设为拖拽区、并把其中所有控件（button/a/input/select/textarea/tab/menuitem/contenteditable）设为 `no-drag`；双击拖拽区仍是原生 zoom |
| **macOS 系统通知不工作** | 通知只走渲染层的 Web Notification API（preload 桥根本不存在）；窗口隐藏/失焦时才需要通知，而那时 Web API 在 Electron 里最不可靠 | 新增 `electron/preload.js`（contextBridge）+ 主进程 `ipcMain.handle("desktop:notify")` → 原生 `Notification`；点击通知会 focus 窗口并把 url 回传渲染层（`desktop:action`），渲染层据此跳到对应会话。渲染层 `showBrowserNotification` 现在优先走 native，失败再回落 service worker / window |
| 其他未适配 | 见下 | 菜单栏 role 化（含视图缩放 / 全屏 / 帮助）、`setAboutPanelOptions`、窗口位置尺寸记忆（含多屏 clamp）、Dock 角标（运行中的会话数）、任务运行时 `powerSaveBlocker` 防息屏、渲染进程崩溃对话框、`will-navigate` 外链交给系统浏览器、**`tray.setTemplateImage` 修到 `nativeImage` 上**（原来调在 Tray 上，技能台账里明确记录过这个 API 不存在） |
| 改名 | 产品名散在 4 处 | `package.json` 顶层 `productName`（决定 userData 与单实例锁）+ `build.productName` + `build.appId` → `com.greenfriends6688.picodex`；渲染层 `layout.tsx` 元数据 / `manifest.ts` / `login` / `AppShell` 窗口标题 / 侧栏品牌标题。**另加一次性 userData 迁移**：`~/Library/Application Support/pi-web` → `Pi Codex`，否则老的书签/草稿/布局状态在新名字下全部消失 |

**验证**：`tsc` 0 错 ｜ `lint` 0 错 ｜ `npm test` **1346/1346**（新增 2 例：原生通知优先且不触发渲染层 onClick、桥拒绝时回落 window 通知；并把 header 让位断言更新为含交通灯 inset）｜ 打包后按技能清单验签名 / DMG / 冒烟 / 架构。

### 31. Zeno 皮肤：中性灰 + 平面材质（2026-09-19，分支 `integrate`）

用户点名「喜欢 `参考项目/zeno-main` 的整体样式」，第一轮只改了间距/圆角被判定为
没做到位；这一轮是把**视觉语言本体**换掉。逐项对比、迁移清单、PR 拆分与验收标准见本地文档
`docs/zeno-comparison-2026-09-19.md`（规划/对比类文档按本仓惯例不入仓，
同 [`ui-layout-pr-plan-2026-09-17.md`](./ui-layout-pr-plan-2026-09-17.md) 的处境）。

**改了什么（`fork:zn-01` … `fork:zn-12`）**

| 面 | 改动 | 文件 |
| --- | --- | --- |
| 色板 | 暖褐黑 oklch → **Zeno 中性石墨阶梯**（`#191919` 画布 / `#151515` 侧栏 / `#2d2d2d` 面板 / `#383838` hover / `#3f3f3f` 选中 / `#272727` 用户气泡 / `#2b2b2b` 输入卡 / `#1f1f1f` 输入条）；前景暖白 → `oklch(0.985 0.004 260)`；次要文字改**实色灰** `#a9abb0` / `#83858a` | `globals.css` 5 套调色板 |
| 材质 | 交互层从 alpha 叠层改**实色**；代码底改**比画布更暗** `#0f0f0f`；弹层不进玻璃，坐实色 `--bg-elev` | `globals.css` |
| 圆角 | Codex `×1.25` calc 尺度 → **Zeno 6/10/12**；`--radius-composer` 22px → `var(--radius-lg)`=12px | `globals.css` `:root` |
| 阴影 | 四级暖黑堆叠 → 单层；`--shadow-sm` 只剩发丝线（输入卡**完全无阴影**，焦点改 3px 光环） | `globals.css` |
| 排版 | `--text-md` 13 → **14px**（全局 UI/正文）；`--chat-content-font-size` 默认 13 → 14；`TEXT.lg` 14 → 15 | `globals.css` + `hooks/useChatAppearance.ts` |
| 侧栏 | `SESSION_LIST_ITEM_HEIGHT` 38 → **32**、去掉内缩胶囊与行间隙；品牌 15 → **18px**；分区标题 14px medium + `--text-dim`；动作组 hover 才显；长标题末端渐隐 | `SessionSidebar.tsx`、`ChatWorkspaceRow.tsx`、`fork-ui.css` |
| 默认宽 | 侧栏 244 → **272**（Zeno `--sidebar-width`） | `lib/panel-layout.ts` |
| 空态 | 无消息时**不渲染顶栏**（Zeno `timelineReady && hasActivity`）；hero 标 40 → 48px、标题 → 26px semibold | `AppShell.tsx`、`ChatWindow.tsx`、`NewSessionHome.tsx` |
| 输入框 | 项目条与输入卡**焊接**（条只留上圆角 + 无下边框，卡片压平上圆角）；条是独立面 `--composer-protrusion`；卡片用 `--bg-composer`；项目 chip 改无铬（透明 + hover 10% 前景）；发送键 32 → **28px**；去掉 68px 不对称右内边距 | `ChatWindow.tsx`、`ChatInput.tsx`、`ProjectChip.tsx`、`fork-ui.css` |
| 消息 | 用户气泡改实色 `--user-bg` + 无边框；操作行 **hover/focus 才显**（触屏常显）；助手行距 26px | `MessageView.tsx`、`fork-ui.css` |
| 顶栏 | 「回滚历史 / 生成标题」收进 `⋯`（`fork:zn-08`），桌面只剩 标题 + 分支 + `⋯` + 会话信息 | `AppShell.tsx` |
| 设置 | 分区改卡片（发丝描边）；搜索框 28px 方框 → **36px 胶囊** | `app/settings.css` |
| 运行中 | 工具行 verb 扫光（`data-live`），`prefers-reduced-motion` 回落实色 | `ProcessGroup.tsx`、`fork-ui.css` |

**接触面**：T0（`fork-ui.css`、`app/settings.css`、`components/fork/*`）+ T1（
`globals.css` 主题层、`AppShell.tsx`、`ChatInput.tsx`、`ChatWindow.tsx`、`MessageView.tsx`、
`ProcessGroup.tsx`、`SessionSidebar.tsx`、`ChatWorkspaceRow.tsx`、`lib/panel-layout.ts`、
`hooks/useChatAppearance.ts`），每处带 `fork:zn-xx` 标记，`grep -rn "fork:zn-"` 可列全。
**无 T2**（没有重写任何组件的 DOM/状态结构）。

**顺手修掉的两个真缺陷**

1. `audit-tokens.mjs` 的 `CSS_FILES` 漏了 `app/fork-ui.css` —— UI-01 之后新 token 的
   家在那里，不漏读的话任何新自造 token 都被误报「未定义」（该检查此前一直是红的）。
2. `verify-themes.mjs` 按**字面串**比颜色，而构建链会把 `oklch()` 重写成 `lab()`
   （`--accent-soft` 读回来是 `lab(59.8% -5.25 -53.8 / .12)`），且 CSS Color 4 会
   保留色彩空间、`color: lab()` 原样回读 `lab()` —— 于是「期望 oklch / 实际 lab」
   永不相等。改成**把两边都画到 canvas 再读像素**（容差 ±2），口径与色彩空间写法解耦。
   同时把「`--radius-md` 必须含 `*`（calc 尺度）」的断言换成核对 **10/12/12** 三档。

**已知偏离（有意）**：mist / rose / pine 三套保留自己的色相，只跟随材质变化；它们不是
默认底，用户主动选才生效。

**验证**：`tsc` 0 错｜`lint` 0 错（warning 基线 245 不变）｜`npm test` 回到改前基线
（3 个既存失败：2 个 ProjectChip 的 `useContextMenu` 测试夹具 + 1 个 ChatInput 图片
告警断言；另 2 个 PTY 失败是本机 node-pty 环境）｜`audit-tokens.mjs` 通过（
122 引用 / 151 定义 / 6 套调色板齐全）｜`verify-themes.mjs` 5 套全绿
（`dark bg = rgb(25,25,25)` = `#191919`）｜实拍截图对照见
`test-results/zn{,2,3,4}/`（gitignored）。

**回滚**：整块 revert 本轮 commit 即可；若只想退掉色板而保留材质，把 5 套调色板的
`--bg/--bg-panel/--bg-elev/--bg-hover/--bg-selected/--border*`/`--text*`/`--code-bg` 换回
`docs/codex-skin/visual-spec.md` 的上一版表格值（该表在 git history 里），并同步
`verify-themes.mjs` 的 `EXPECTED`。
