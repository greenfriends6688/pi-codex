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
| light | false | `oklch(0.995 0.004 85)` | `oklch(0.26 0.015 55)` | `oklch(0.66 0.16 250)` | `oklch(0.26 0.015 55)` |
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
- **玻璃**：`--glass-blur|saturation|opacity|popover-opacity|tooltip-opacity`。

### 3. 覆盖层（`globals.css` 末尾）

组件把表现放在内联样式里，内联优先级高于任何选择器，所以凡是跨组件收敛的属性
（圆角、阴影、动效时长、焦点环）都放在一层带 `!important` 的覆盖层里，规则按「收敛什么」分组：

| 收敛项 | 命中方式 |
|---|---|
| 浮层圆角/阴影/玻璃 | `.anim-popover` / `.anim-popover-down` / `.anim-dialog` |
| 输入框玻璃与焦点环 | `.chat-content div[style*="--radius-composer"]`（该内联变量全仓唯一） |
| 焦点环 | `:where(button, a[href], …):focus-visible`，压掉 21 处内联 `outline: "none"` |
| 动效时长 | `@media (prefers-reduced-motion: no-preference)` 下的控件 `transition` 简写，回收 ~70 处内联 `0.1–0.3s` |
| 会话节奏 | `.chat-content [data-entry-id] > div` 用回 `--conversation-item-gap`（此前 token 定义了却没人用，消息写死 20px、过程详情 14px） |
| 工作区边界按钮 | 去掉与 header 重复的 1px 分隔线，补 hover / focus 同款 chip |

**玻璃只在内容真的从下面经过的地方**：下拉、菜单、扩展弹窗、输入框。
全屏模态（`config-panel-root.is-modal` / `settings-dialog-surface`）坐在 `--scrim` 上，
模糊买不到效果，保持不透明——这一条与最初计划不同，按实际判断排除。
`@supports not (backdrop-filter)` 与 `prefers-reduced-transparency: reduce` 都有回落。

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

- `audit-tokens.mjs` 新增「皮肤刻度 token 齐全」检查（32 个），并保持 34 token × 5 套调色板校验。
- `verify-themes.mjs` 期望值改为暖色 oklch，且**按数值比较**，不再依赖压缩后的字面串。
- 新增 `capture-themes.mjs`：跑 `npm run prod` 后重拍 5 套主题 + 设置页截图。

### 7. 本次**没有**修掉的（需要改 .tsx，留给下一轮）

- 侧栏会话行/文件树行、消息动作行、composer 内控件尺寸仍由内联样式决定；
  覆盖层只能收敛它们共有的属性，改不了它们各自写死的数值。
- 触摸端 hover 残留：`onMouseEnter/Leave` 直接写内联样式，CSS 无法撤销。
- 内联 z-index 的 22 个散值、`ModelSelector` 等浮层各自的阴影字面量。
