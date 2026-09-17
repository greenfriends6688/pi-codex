# pi-web-desktop 深度对比与借鉴 PR 计划（样式 / 布局 / 功能）

分析日期：2026-09-16
对比对象：`参考项目/pi-web-desktop-main`（`@iswitthere/pi-web-desktop` 0.8.10-f）
基准：本仓库 `@agegr/pi-web` 0.9.1 · Codex Style fork

> 本文**只聚焦 desktop 这一个仓库**，且只谈**样式 / 布局 / 功能**三面（不含 Electron 打包，
> 那部分见 [`ref-projects-comparison-2026-09-16.md`](./ref-projects-comparison-2026-09-16.md) §6
> 与 [`ref-projects-pr-plan-2026-09-16.md`](./ref-projects-pr-plan-2026-09-16.md) 的 PR-01～PR-11）。
>
> 与既有文档的关系：
> - 既有 `ref-projects-*` 覆盖 4 个仓库的**广度**（Electron 外壳、工程纪律、架构）；
> - 本文补 **desktop 的深度**——它比本仓库多了约 **7 个版本**的独立 UI/UX 演进，
>   而这一段恰好是既有文档里写得最薄的（既有文档只从 desktop 取了 tab-model / input-compact /
>   git-graph / welcome-lobby 四条线）。
>
> 去重表见 [§8](#8-去重表与既有-pr-计划的关系)。

---

## 1. 为什么两边 UI 会差这么多：两条血缘

| | desktop | 本仓库 |
| --- | --- | --- |
| 包名 / 版本 | `@iswitthere/pi-web-desktop` **0.8.10-f** | `@agegr/pi-web` **0.9.1** |
| 谱系 | fork 自上游 **0.7.16**，之后**完全独立演进** | fork 自上游 **0.9.1**，叠加 Codex 皮肤 + 自研能力 |
| 上游合并 | 无（自己就是一条线） | 有（`git merge upstream v0.9.1`，见 `delta.md`） |
| 前端形态 | Next.js 16.3.1 + **Electron 43 外壳** | Next.js 16.3.1 + **纯 Web / PWA** |
| 设计语言 | 跟随 **pi CLI 主题**（主题 JSON 直读） | **Codex 皮肤**，六套自研色板 |

**一句话**：desktop 在 **0.7.16 的时间点分叉**，然后把「UI 打磨」这件事做了七轮——
主题引擎、壁纸、UI 缩放、过程分组、欢迎大厅、工作区标签、Git 图谱、设置原语全部出自这段时间。
本仓库从 **0.9.1** 分叉，拿到的是上游 0.9.1 的骨架 + 自己加的终端/MCP/推送/WYSIWYG/浏览器面板，
**但 0.7.16 → 0.8.10 那段 UI 演进整体缺失**。

这就是为什么两边版本号接近（0.8.10 vs 0.9.1）但 UI 观感完全不同——**不是一个快慢问题，是两条分支**。

---

## 2. 规模对照

| 指标 | desktop | 本仓库 | 说明 |
| --- | --- | --- | --- |
| `app/components/hooks/lib` 源码 | 248 文件 / **55,774 行** | 258 文件 / **57,071 行** | 总量相当 |
| `.test.mjs` | 139 | **191** | 本仓库测试更厚 |
| `app/api` 路由 | 48 | **56** | 本仓库后端更厚 |
| 同名组件 | — | 21 个 | 见下 |
| desktop 独有组件 | **25 个** | — | 本文的主要素材 |
| 本仓库独有组件 | — | **28 个** | 勿被反向"优化"掉 |

`components/` 同名 21 个：`AgentsConfig` `AppShell` `BranchNavigator` `ChatInput` `ChatMinimap`
`ChatWindow` `FileExplorer` `FileIcons` `FileViewer` `MarkdownBody` `MessageView` `ModelsConfig`
`PluginsConfig` `ProjectTrustDialog` `ProviderIcon` `SessionSearch` `SessionSidebar` `SkillsConfig`
`TabBar` `TurnWrittenFiles` `models-config-helpers`

> ⚠️ **"同名"不等于"同实现"**。同名文件的行数差极大，说明两边都在各自动过：

| 文件 | desktop | 本仓库 | 差 |
| --- | --- | --- | --- |
| `components/AppShell.tsx` | 1,556 | **2,812** | +1,256（本仓库的布局改造都堆在这里） |
| `components/FileViewer.tsx` | 1,188 | **2,579** | +1,391（本仓库重写过） |
| `components/SessionSidebar.tsx` | **2,969** | 2,168 | −801（desktop 加了时间分组/置顶/多选） |
| `components/ChatInput.tsx` | **3,580** | 2,852 | −728（desktop 加了 mention overlay / ghost / compact） |
| `components/MarkdownBody.tsx` | **429** | 124 | −305（desktop 加了 mention 插件与增量渲染） |
| `lib/ansi.ts` | **187** | 74 | −113（desktop 的 ANSI 渲染器更完整） |
| `lib/models-config-store.ts` | **187** | 72 | −115 |

---

## 3. 维度一：样式系统

### 3.1 【最大缺口】pi CLI 主题 JSON 直读

这是全文最重要的发现。

| | desktop | 本仓库 |
| --- | --- | --- |
| 引擎 | `lib/theme.ts` **540 行** | `lib/theme.ts` **22 行**（只有色板 ID 常量 + 首屏注入脚本） |
| 内置主题 | `lib/themes/*.json` **10 个文件 / 5 套**（gruvbox / miku-aqua / orbital-rose / scarlet-tether / solarized，各含 dark+light） | 6 套色板**硬编码在 CSS** |
| 用户主题 | ✅ 扫描 `~/.pi/agent/themes/*.json` + `<cwd>/.pi/themes/*.json`，同名时**用户覆盖内置** | ❌ 无 |
| API | `GET /api/themes`（列集合）+ `GET /api/themes/[name]?mode=dark\|light`（解析成 CSS 变量） | ❌ 无 |
| 色彩解析 | ✅ 256 色索引 → hex、`vars` 变量引用展开、空串→从色板推导、`searchMatch*` 回退 | ❌ 无 |
| 对比度保障 | ✅ `ensureContrast()`（相对亮度 + 逐步 darken/lighten 到 3:1） | ❌ 无 |

**desktop 做对了什么**：`pi CLI 主题 JSON` 是 pi 生态的公开契约（
`https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json`）。
解析它意味着**用户的 TUI 主题和 Web 端观感一致**——这是"像 pi"的最短路径，
而本仓库目前是"像 Codex 但不像 pi"。

关键实现（`参考项目/pi-web-desktop-main/lib/theme.ts`）：

```ts
// 1. 文件名约定判变体
parseThemeFilename("gruvbox-dark.json") // → { base: "gruvbox", variant: "dark" }
parseThemeFilename("monokai.json")      // → { base: "monokai", variant: null }（内容判极性）

// 2. 53 个 pi token → CSS 变量的映射层（mapToCssVars）
//    缺 token 用 vars.bg0/fg0/red/green/orange 兜底

// 3. 极性判据是相对亮度而非文件名
const isDark = relativeLuminance(bg0) < 0.5;

// 4. git 状态色做最小对比度修正（3:1，不是 4.5:1）
css["--git-status-added"] = ensureContrast(gitAdded, bg1);
```

> ⚠️ **移植时的最大坑：token 名不匹配。**
> desktop 的映射输出是 `--bg / --bg-panel / --bg-secondary / --bg-card / --bg-card-hover /
> --bg-hover / --bg-selected / --bg-subtle / --border / --border-hover / --text / --text-muted /
> --text-dim / --accent / --accent-hover / --accent-blue / --accent-red / --accent-green /
> --accent-orange / --git-status-* ×6 / --user-bg / --assistant-bg / --tool-bg / --hatch-color`
> （29 个）；而本仓库 Codex 皮肤的**强制令牌集**是
> `--bg / --bg-panel / --bg-elev / --bg-hover / --bg-selected / --bg-subtle /
> --border / --border-strong / --border-faint / --text / --text-muted / --text-dim /
> --accent / --accent-hover / --accent-contrast / --accent-soft / --accent-border /
> --primary-bg / --primary-fg / --primary-hover / --user-bg / --assistant-bg / --tool-bg / --code-bg /
> --danger / --danger-soft / --success / --success-soft / --warning / --warning-soft /
> --diff-added / --diff-removed / --focus-ring / --scrim`（34 个，由
> `docs/codex-skin/audit-tokens.mjs` 的 `REQUIRED_PER_THEME` 强制）。
> **交集只有 14 个**。所以 `mapToCssVars()` 必须**重写**，不能直接搬。

### 3.2 边框深度滑杆

`hooks/useTheme.ts:applyBorderDepth()`（`参考项目/pi-web-desktop-main/hooks/useTheme.ts:239-283`）

```
depth  0  → border = background（隐形）
depth 25  → 默认（细描边）
depth 50  → 主题原始值（直通，无 color-mix 开销）
depth 100 → border = text（最大对比）
```

实现要点：
- 先把主题原始边框色**快照**到 `--border-orig` / `--border-hover-orig`，滑杆只从快照推导，
  避免反复 color-mix 导致色彩漂移；
- 内置主题（CSS-only）没有快照 → `ensureBorderOrig()` 用 `getComputedStyle` 反读并缓存；
- 表达式用 `color-mix(in srgb, var(--border-orig) N%, var(--bg) M%)`。

**本仓库的适配点**：Codex 皮肤有**三级边框**（`--border` / `--border-strong` / `--border-faint`），
滑杆需要同时驱动三级（建议保持相对关系：strong = depth 曲线 +16%，faint = −40%）。
`--focus-ring` 不能跟着变（否则可访问性受颜色影响）。

### 3.3 UI / 文字缩放（`--app-ui-scale`）

desktop 用 `zoom: var(--app-ui-scale, 1)` 在 `<html>` 上做整站缩放，范围 **0.8 – 1.5**，步进 0.01。

**真正的价值不是滑杆，是 `lib/ui-scale.ts` 那 32 行代码（其中 24 行是注释）**——它把 CSS `zoom` 的坐标系陷阱写清楚了：

> Under CSS `zoom`, Chromium keeps JS viewport APIs (`clientX`/`clientY`, `getBoundingClientRect()`,
> `innerWidth`/`innerHeight`, `visualViewport`) reporting **physical** pixels, while CSS pixel lengths —
> including `position: fixed` overlay offsets — are painted at `zoom ×` their value.
> An overlay positioned from raw JS numbers therefore drifts by `(zoom − 1) × offset`（125% 时偏 25%）。

```ts
export function cssPx(physical: number): number { return physical / getUiScale(); }
export function cssViewportSize(): { width: number; height: number }
```

同一仓库里三处印证：
- `AppShell` 根容器 `height: calc(100dvh / var(--app-ui-scale, 1))`；
- `ContextMenu` 用 `cssPx()` 换算指针坐标（`components/ContextMenu.tsx:14`）；
- `toggleTheme()` 的 `startViewTransition` 圆形擦除也要 `÷ uiScale`（`hooks/useTheme.ts:388-403`）。

**本仓库的风险面**（必须逐条核对，这是本项改动的真正成本）：

| 风险点 | 位置 | 说明 |
| --- | --- | --- |
| 视口高度 | `hooks/useViewportHeight.ts` → `--app-viewport-height` | 本仓库已有一层 JS 视口计算，与 `zoom` 叠加会双重换算 |
| 移动端覆盖层 | `AppShell` 的 `.sidebar-overlay-backdrop`（`position: fixed` + `inset: 0`） | `zoom` 下 `inset: 0` 仍正确，但 JS 定位的按钮会漂 |
| 面板拖拽 | `hooks/useResizablePanel.ts`（`clientX` 计算宽度） | 拖 1px 物理像素 ≠ 1 CSS 像素 |
| 弹层定位 | `app/settings.css` 的 `config-panel-*`、`MessageView` 的定位 popover | 凡是用 `getBoundingClientRect()` 的都受影响 |
| 全屏查看器 | `FileViewer` 的 `requestFullscreen()` | 与 `zoom` 无冲突，但工具栏图标尺寸会跟着缩放 |

→ **本项必须拆成 spike + 实现两步**（见 D-PR-03）。

### 3.4 聊天外观：本仓库已有，参数不同

| 常量 | desktop | 本仓库 |
| --- | --- | --- |
| 内容宽默认 | 820 | **860** |
| 内容宽范围 | 820 – 2000 | 640 – 2000 |
| 字号默认 | 14 | **13** |
| 字号范围 | 12 – 24 | 12 – 24 |
| 扩展 widget 字号 | ❌ 无 | ✅ 有（`--extension-widget-font-size`） |

**结论：各有胜负，不要搬。** desktop 的优势是 `width` 的最小值 = 默认值（不会缩到比默认更窄）；
本仓库的优势是**多了一个扩展 widget 字号维度**（desktop 没有扩展 widget 体系）。
唯一可抄的是 desktop 的 `clampChatContentWidth` 对 `Number(value)` 的 NaN 防御写法，
而本仓库已有（`hooks/useChatAppearance.ts:33-38`）。→ 判定为 **不做**。

### 3.5 壁纸层

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `app/wallpaper.css` | **223** | 图层、scrim、分区域效果模式、面板玻璃化 |
| `components/WallpaperLayer.tsx` | 63 | `<img>` + `data-wallpaper-ready` 淡入门控 + `MutationObserver(html[data-theme])` 换画 |
| `hooks/useWallpaper.ts` | 205 | 设置读写 + 变更广播（`WALLPAPER_CHANGED_EVENT`） |
| `lib/wallpaper.ts` | 182 | 按主题选内置 Monet 画作 + 数据 URL 解析 |

**三条硬核经验（这是最值得抄的部分）**：

1. **图片必须走 `<img src>`，不能用 CSS `background-image`**
   > Chromium silently drops CSS property values above ~1MB, and a PNG photo data URL easily exceeds that.
   > DOM attributes have no such limit. —— `app/wallpaper.css` 顶部注释

2. **scrim 用 `color-mix` 由 `--wallpaper-scrim` 百分比驱动**，主题安全（跟随 `--bg`）：
   ```css
   .chat-wallpaper::after { background: color-mix(in srgb, var(--bg) var(--wallpaper-scrim, 70%), transparent); }
   ```

3. **欢迎页要更透**，但不能自引用变量（会 computed-value time 失效）——改用 `:has()` 写在新规则上：
   ```css
   html[data-wallpaper="on"] .chat-wallpaper:has(~ .chat-column .chat-welcome)::after {
     background: color-mix(in srgb, var(--bg) max(0%, calc(var(--wallpaper-scrim) - 25%)), transparent);
   }
   ```

4. **分区域独立效果模式**：`message` / `panel` / `input` 各自一个 `data-*` 属性，
   独立选 off / blur / transparent。（`app/wallpaper.css:61+`）

> ⚠️ **与本仓库的冲突**：Codex 皮肤里侧栏/面板是**不透明 `--bg-panel`**，
> 要开壁纸必须让面板变半透明玻璃层——这会同时影响 **6 套色板**的对比度，
> 且必须过 `verify-themes.mjs`。**本项是纯口味项，建议放在最后或不做。**

### 3.6 字体体系

desktop：
```jsonc
"@fontsource/ia-writer-quattro": "^5.3.0",   // 正文字体（衬线感、阅读性）
"@fontsource/lilex": "^5.3.0",                // 等宽（连字）
```
`globals.css:582` 的字体栈把它们插在 zedMono / JetBrains Mono 之前，并保留中日文回退
（`PingFang SC` / `Microsoft YaHei`）。

本仓库：`--font-mono` + `--font-noto-mono` 走 `next/font`（`audit-tokens.mjs` 的 `RUNTIME_SET` 里有记录），
没有 UI 正文字体（用系统栈）。

→ **可抄**：`@fontsource` 自托管字体（不依赖 CDN、不闪烁）这条路。
→ **不抄**：具体字体。Codex 皮肤的身份是"几何无衬线 + 系统栈"，换 iA Writer 会改产品气质。

### 3.7 设置面板的样式原语

| | desktop | 本仓库 |
| --- | --- | --- |
| 原语文件 | `components/settings-ui.tsx` **661 行** | `components/SettingsUi.tsx` 232 + `app/settings.css` **1,241 行** |
| 实现方式 | **内联 style + CSS token** | **CSS 类（`config-*`）** |
| 布局壳 | `SettingsPane`（两栏 + 可选 footer，窄屏自动堆叠） | `ConfigPanelShell` / `ConfigSplitView` |
| 分区 | `SettingsSection` / `SettingsGroup` | `ConfigSectionTitle` |
| 行 | `SettingsRow`（标题 + 右对齐控件 + 全宽描述） | `ConfigField`（label + children，竖排） |
| 导航模型 | `lib/settings-nav.ts` **纯数据** + `scope: global \| workspace` + 页面描述 | `lib/settings-navigation.ts`（只存"上次选的 section/条目"） |

**判定**：
- desktop 的 token 驱动内联 style **不适合本仓库**——Codex 皮肤是"CSS 类 + audit 脚本"体系，
  内联 style 会绕过 `audit-tokens.mjs` 的检查面。→ **不抄实现方式**。
- desktop 的两件**可抄**：
  1. **`settings-nav.ts` 的纯数据导航模型**——本仓库的 section 列表散在 `SettingsPanel.tsx` 的
     `SettingsSectionIcon` 里（`if (section === "general") …` 五连 if），
     加一个 section 要改三处。搬成纯数据后可以带单测。
  2. **`SettingsRow` 的"标题行 + 全宽描述行"排布**——比本仓库 `ConfigField` 的竖排更适合长描述。
  3. 缺一个统一 metric token：desktop 用 `--control-height / --control-radius / --control-pad-x /
     --settings-pad-x / --settings-section-gap`；本仓库有 `--control-xs…xl` 阶梯但**没有**
     "默认控件高度"这一个 token，`settings.css` 里各处自己写高度。

### 3.8 ProviderIcon：本仓库反而更省

| | desktop | 本仓库 |
| --- | --- | --- |
| 依赖 | `@lobehub/icons` + `@phosphor-icons/react` | 自建 `public/provider-icons.svg` sprite |
| provider 映射表 | **完全相同**（41 个 id，逐条对得上） | 同上 |
| 额外能力 | `lib/provider-icon.ts`：**图标模式**（`auto / api / letter / emoji`）+ API 类型角标（`C/R/X/M/G/B/P`）+ 自定义 emoji（`Intl.Segmenter` 取 grapheme） | ❌ 无 |

→ **不抄**图标库（自建 sprite 少一个依赖，且已覆盖同样的 provider 面）。
→ **可选抄**「API 类型角标」这一小条（`resolveApiBadge()`，~30 行）——它能在模型列表里
一眼区分 `openai-completions` / `openai-responses` / `anthropic-messages` 等协议族。
本仓库已有 `provider-listing.ts` 的 capability 判定，接进去成本极低。**列为低优先可选。**

---

## 4. 维度二：布局

### 4.1 壳结构对照

| 位置 | desktop | 本仓库 |
| --- | --- | --- |
| 根容器 | `div`（inline style） | `.app-shell-layout`（class，`--app-viewport-height`） |
| 顶栏 | **`AppTitleBar`**（Electron 标题栏 + 侧栏开关 + 主题切换 + 会话统计 popover + 右栏开关 + 设置 + 工作区选择器） | 顶栏动作组（散在 `AppShell.tsx`，2,812 行） |
| 左栏 | `.sidebar-container` + `.workspace-panel-splitter` | `#session-sidebar` + `.sidebar-container`（**同名**） |
| 主区 | `.chat-column` | `main-panels` + `workspace-slot`（**四栏可互换**） |
| 右栏 | 多类型 tab（file / changes / git-graph）+ keep-alive | `.file-panel-body`：查看器 + **文件树列**（264px，容器查询闸门） |
| 欢迎页 | **`WelcomeLobby`**（三区网格） | 空态是一块空白（`ChatWindow.tsx:1539`） |
| 移动端 | 覆盖层 + `sidebar-mobile-pending` 防闪 | 同名机制（同血缘） |

> **本仓库的布局已经走在自己的路上**：`[会话侧栏] [聊天] [文档] [文件树]` 四栏，
> 且聊天的四栏都有对应的响应式与容器查询闸门（见 `delta.md` §11–§17）。
> **不要用 desktop 的三栏结构覆盖它**。可借鉴的是**局部**能力（空态、标签、面板记忆）。

### 4.2 classic / tabs 双视图模式 + 工作区标签栏

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `lib/workspace-tabs.ts` | **151** | 纯函数：`openWorkspace` / `closeTab` / `activateTab` / `updateTabCwd` / `reorderTab`（含"关闭活动标签后取右邻，最后一个取左邻"） |
| `components/WorkspaceTabBar.tsx` | **432** | 浏览器式标签：拖拽重排、关闭按钮、活动指示、`focusToken` 键盘焦点接力 |
| `hooks/useViewMode.ts` | 57 | `classic \| tabs`，`useSyncExternalStore`，key `pi-web:view-mode` |
| `hooks/useWorkspaceTabs.ts` | — | 标签状态的持久化与恢复 |

**架构亮点**：
1. **模式只改"谁来渲染"，不改状态机**。注释原话：
   > Both modes share the same underlying workspace state machine; the mode only changes which UI hosts render.
2. **标签栏通过 `createPortal` 挂到标题栏的 host div**（`AppShell.tsx:1345-1357`），
   而不是与标题栏做 flex 布局——这样 classic 模式下标题栏不留空洞。
3. **`workspaceKeyOf()` = `projectRoot ?? cwd`**，所以同一仓库的所有 worktree **共用同一个标签槽**。

**本仓库的适配判断**：`useViewMode` 的"模式只切宿主"这条**思路可抄**，
但**具体功能不建议做**——本仓库的主区已经有一个 `TabBar`（终端 / 浏览器标签，
`components/TabBar.tsx`），再叠一层"工作区标签"会出现两套标签语义。
真正的缺口在 §4.3（右侧面板 tab）。

### 4.3 右侧面板 tab：判别联合 + keep-alive + 按工作区持久化

> ⚠️ **本项已由 [既有计划](./ref-projects-pr-plan-2026-09-16.md) 的 PR-24 覆盖**，此处只补细节。

`components/tab-model.ts`（判别联合）+ `lib/right-tabs-memory.ts`（149 行持久化）：

```ts
export type Tab = FileTab | ChangesViewTab | GitGraphViewTab;
// id 前缀（file: / changes: / git-graph:）兼作 kind 标记，
// 所以持久化与查找不依赖内存里的 type
```

三条本仓库 PR-24 里**没写清**的细节（补进那个 PR 的验收标准）：

1. **`right-tabs-memory` 必须做结构校验**（`sanitizeTabs`）——旧版本存的、手改过的、
   写了一半的 JSON **绝不能**以畸形 tab 进入面板。desktop 对 `viewerState` 逐字段校验
   （`displayMode` 必须在 `{source,preview,diff}` 里、`wrapLines` 必须是 boolean、
   `scrollTop/Left` 必须是有限数）。
2. **key 归一化要用 `normalizePathKey()` + Windows 折叠扫描**（`foldWindowsKey`），
   否则大小写/斜杠不同会产生**两个标签槽**。本仓库已有 `lib/paths.ts` 的 `samePath()`，
   但持久化层的 key 需要单独的 fold 扫描（desktop 的做法：先精确查 → 再折叠查）。
3. **必须删掉 `FileViewer` 的 unmount 快照机制**（`onStateChange` / `saveFileViewerState`），
   否则 keep-alive 的常驻实例和快照回写会互相打架。本仓库 `components/file-tab-state.ts`
   目前**同时存在**这两套（`saveFileViewerState` + `viewerRevision`），
   与 desktop 的注释警告完全对上——desktop 已经踩过这个坑。

### 4.4 欢迎大厅 WelcomeLobby

`components/WelcomeLobby.tsx`（449 行）——无工作区时的首页，**三区网格**：

1. **New workspace**：选文件夹（桌面走原生对话框，浏览器走内联路径输入）+ 快速草稿工作区。
   **永远可见，即使两个列表都空**（新装用户唯一能点的东西）。
2. **Pi workspaces**：pi 自己的最近工作区，时间戳取该项目最后一次会话活动时间，
   数据**复用 `/api/sessions` 的共享缓存**（与侧栏同一份去重逻辑），冷启动**零额外请求**。
   Top-3 工作区下面内联展示"最近 7 天最多 3 条会话"。
3. **Recommended workspaces**：跨编辑器探测的最近项目（见 §5.8），设置里可关
   （`pi-recent-projects-enabled`，默认开）。

**设计原则（写进了注释，值得抄）**：
> Shown honestly — no filtering against pi's own workspaces, no "already added" markers.
> 每个列表为空时**整块隐藏**（不显示"暂无"占位）。

**本仓库缺口确认**：新会话空态现在是**空白**（`ChatWindow.tsx:1539` 只渲染了
`NewSessionUpdateLink` + 空 flex 撑高），用户没有任何"从这里开始"的入口。
这是**投入产出比最高的一项**。

### 4.5 会话信息条 SessionInfoBar（552 行）

desktop 把它做成一条**消息区顶部的信息条**，承载：

| 控件 | 实现 |
| --- | --- |
| 上下文用量环 | `session-info-bar-donut` / `-arc`（SVG 弧，CSS 变量驱动百分比） |
| 会话统计 popover | 复制 file/id/projectDir/gitBranch/gitWorktree（`SessionCopyField` 五字段）+ 用时 / token / 成本 |
| 分支 popover | **内联 `BranchNavigator`**（不是独立组件） |
| 系统提示 popover | 渲染完整 system prompt（含 markdown 的完整样式表：`h1-h6` / code / table / blockquote 各一档字号） |
| 压缩按钮 | `is-compacting` 旋转动画 + `compactError` 展示 |
| 声音 / 通知开关 | 图标 + 可选文字标签（`showSoundLabel`） |
| 项目信息 | `projectRoot / cwd / branch / isWorktree` |
| 会话标题 | tabs 模式下标题栏让位时**移到信息条** |

**本仓库现状**：`sessionStats` / `contextUsage` 已经在 `AppShell` 里（`:316` / `:344`），
统计 popover 也有（`:2427+`，还带 `session-info-pop` 弹入动画）。
缺的是：**上下文进度环**（现在只有文字百分比）、**系统提示 popover**（`SystemPromptPanel` 是独立面板）、
**压缩按钮的 in-bar 状态**。

→ 本项**不是"加一条 bar"，而是"把现有三处信息合并成一处"**。属信息架构调整，中优先。

### 4.6 右栏空态引导 RightPanelEmptyState

`components/RightPanelEmptyState.tsx`（73 行）——右栏无标签时不是空白，而是：

```
Changes    （GitDiff 图标）
Git graph  （GitMerge 图标，scaleY(-1) 翻转成向下分叉）
```
每个是一条全宽按钮（`disabled={!cwd}`），hover 走 `--bg-hover`。

**本仓库缺口**：右侧面板空态（`ExplorerPanel`）目前直接显示文件树，**没有"这里还能干什么"的引导**。
成本极低（~80 行 + 3 个 i18n 键 × 3 语言）。

### 4.7 通用右键菜单 ContextMenu

`components/ContextMenu.tsx`（536 行）——`ContextMenuProvider` + `useContextMenu()`。

| 能力 | 实现要点 |
| --- | --- |
| 渲染位置 | `createPortal` 到 `document.body`（永远浮在所有 stacking context 之上） |
| 边界翻转 | 指针跟随 + 视口边缘翻转（子菜单有独立的 `submenuFlipped`） |
| 关闭时机 | 外部点击 / Escape / **用户滚动（wheel/touch）** / `window.blur` / `resize`；**程序化滚动（流式聊天）不关** |
| 键盘 | ↑/↓ + Enter/Space |
| 反馈态 | `feedbackLabel`：选中后把 label 临时换成 "已复制"，1.2s 后自动关（`FEEDBACK_MS`） |
| 勾选态 | `checked`（图标槽显示对勾，用于"当前选项"） |
| 嵌套 | **只允许一级**——类型上用 `Omit<ContextMenuItem, "submenu">[]` 从类型层面禁止二级 |
| 坐标换算 | 用 `lib/ui-scale.ts` 的 `cssPx()` / `cssViewportSize()` |

**本仓库现状**：`AppShell.tsx:2866+` 有一个**手写的会话行右键菜单**——
`useState<SessionRowContextMenuDetail>` + 手动 clamp（`Math.min(clientY, innerHeight - 64)`）
+ 手动 `contains()` 判外部点击，**没有键盘导航、没有 Escape、没有滚动关闭、没有子菜单**。

→ **典型的重构型 PR**：抽出 provider，迁移这唯一一处，然后删掉 `AppShell` 的 300+ 行胶水。

### 4.8 窗口标题栏（仅 Electron 相关）

`AppTitleBar.tsx`（644 行）+ `TitleBarDismissOverlay.tsx` + `hooks/useElectronWindow.ts`。
**已在既有计划的 PR-05 覆盖**，是 Electron 线的依赖项，本文不重复。
只补一条既有文档没提的：desktop 的标题栏还**兼任工作区选择器宿主**
（`WorkspacePickerMenu`）+ **会话统计 popover** + **上下文用量**入口，
所以本仓库若要照搬，需要先做 §4.5 的信息架构统一。

---

## 5. 维度三：功能与交互

### 5.1 过程分组 ProcessGroup —— 单点体验差距最大的一项

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `lib/step-categorizer.ts` | **625** | 工具调用 → 9 种语义 tone 的分类器（纯函数） |
| `lib/step-visuals.ts` | — | tone → 图标名 / 视觉映射 |
| `lib/process-content.ts` | **153** | 消息 → `ProcessContentBlock`（带 `origin: { phase, placement, groupId }`） |
| `components/ProcessGroup.tsx` | **1,012** | 步骤渲染（可折叠、tabs/timeline 双模式、文件徽标） |
| `hooks/useProcessDisplayMode.ts` | 44 | `timeline \| tabs`，localStorage + 跨组件事件 |

**核心概念**：把一次 assistant 回复里的 `thinking` / `text` / `toolCall` 序列，
从"平铺的一堆块"变成**语义化的步骤列表**：

```ts
export type StepTone =
  | "document_change" | "document_read" | "document_search"
  | "directory_list"  | "file_find"      | "command_execution"
  | "todo_update"     | "artifact_output" | "approval_rejected";
```

分类器的**关键顺序坑**（注释里写明了）：

```ts
// Command execution — must be checked FIRST so bash/shell commands aren't
// misclassified by the regex patterns below (e.g. "bash cat" matching "cat"
// in document_read, "bash ls" matching "ls" in directory_list)
```

还有 `Step` 判别联合里的 `toolGroup` 变体——**连续同类工具合并成一个步骤**：

```ts
| { kind: "toolGroup"; blocks: ToolCallBlock[]; leadBlocks: ToolBlock[][];
    iconName: StepIconName; tone: StepTone; typeLabel: string;
    targetLabels: string[]; targets: string[] }
```

**步骤标签是"类型 + 信息量"的组合**，不是工具名：
```
"编辑 src/main.ts"     ← document_change + 目标文件 basename
"读取 README.md"       ← document_read
"运行 npm test"        ← command_execution
"修改 xxx"             ← file_edit
```

**本仓库现状**：`components/ChatWindow.tsx` 走的是 **legacy 平铺渲染**
（`countToolCallBlocks` / `splitFinalAssistantBlocks` / `isMessageGroupAnchor`，
`lib/message-display.ts`），没有语义分组。

**判定：这是全文最有价值、也最有风险的一项。**
- 价值：直接改变"读一次 agent 跑了什么"的成本，是 pi web UI 的核心体验。
- 风险：要**替换 `ChatWindow` 的渲染路径**（本仓库 `ChatWindow.tsx` 2,122 行的核心），
  且 `MessageView.tsx`（1,883 行）的 `ToolCallBlock` / `ThinkingBlock` 会被 ProcessGroup 复用。
- 缓解：desktop 的实现天然支持**渐进迁移**——它保留了 legacy 分支
  （`ChatWindow.tsx:974` 注释："ProcessGroup path too instead of the legacy flat renderer"），
  可以先并行走新路径、用 feature flag 切换。

### 5.2 `@file` / `/skill:` mention 高亮

`lib/mention-tokens.ts`（167 行）+ `lib/file-mentions.ts`（53 行）。

**两处渲染、一套 tokenizer**：

```ts
// 边界规则与 TUI 自动补全一致：只在行首或空白之后触发，所以 foo@bar.com 不匹配
const MENTION_RE = /(?<=^|[\s\u00A0])(@"[^"\n]*"|@[^\s"]+|\/skill:[^\s]+)/g;
```

1. **输入框**：textarea 上面盖一层 highlight overlay（`chat-input-highlight`），
   正则命中且**解析为真实文件/skill** 的 token 才上样式（accent + 点状下划线）。
   **"valid 才高亮"是硬规则**——注释原话：
   > Return `undefined` when the index has not been loaded yet (treated as invalid until data arrives
   > — highlighting must never guess).
2. **渲染后的用户消息**：同一 tokenizer 做成 **remark 插件**（`mentionRemarkPlugin`），
   在 **AST 层**打标记——**代码块内的 mention 永远不会被改**（只处理 `text` 节点）。
   产出的 inline HTML 走 `rehype-raw` → `rehype-sanitize`，所以做了完整转义。

**输入框还有一个配套的"正在编辑的 token 不高亮"机制**：
`tokenizeMentions(text, validators, activeTokenStart)` —— 光标所在的那个 `@` token
保持纯文本，避免打字过程中闪烁。

**本仓库现状**：`ChatInput.tsx` 已有 `@` 自动补全菜单（`lib/file-fuzzy.ts` / `file-index`），
但**输入框里没有高亮**，**渲染后的用户消息里 mention 也是纯文本**。

→ 判定：**中高价值，低风险**（纯函数 + 只在输入框加一层 overlay + 一个 remark 插件）。

### 5.3 阅读时输入框塌陷（input-compact）

> ⚠️ **已由既有计划 PR-25 覆盖**，此处只补一条最容易做错的细节。

`lib/input-compact.ts`（67 行）是一个**方向感知状态机**，不是"滚动就收起"。
原因写在注释里（这是真正的坑）：

> Collapsing the composer grows the reading area, which shrinks the container's maximum `scrollTop`
> and makes the browser **clamp the viewport back to the bottom**（an artificial "upward" scroll）.
> Without direction tracking, that clamp would immediately re-expand the input, and leaving the bottom
> would oscillate between the two states on every scroll tick.

```ts
export const COMPACT_RESTORE_TRIGGER = 8;   // ≤8px 视为"在底部"
export const COMPACT_COLLAPSE_TRIGGER = 120; // 必须离底部 >120px 才允许收起

// 在底部：只有"主动向下滚"才恢复（"up"/"none" 一律不恢复，否则夹紧会闪）
// 离底部：只有"真实用户意图 + 向上滚 + >120px"才收起；focus 永远展开
```

→ PR-25 的验收标准应追加 **`userIntent` 参数**（区分 wheel/touch/keyboard/scrollbar-drag 与程序化滚动），
desktop 的血泪点就在这里。

### 5.4 流式更新调度器

`lib/stream-update-scheduler.ts`（132 行）——把一串"追加型快照"合并成**每动画帧最多一次 React 更新**，
且带显式 FPS 上限（默认 **30**）。

三个容易忽略的设计点：

1. **保留"完整最新快照"而不是重建 delta**——注释原话：
   > Keeping the whole latest snapshot (instead of reconstructing deltas) also preserves tool-call
   > and thinking-block changes emitted by the Pi SDK.
2. **提交走 `queueMicrotask` 而不是直接在 rAF 回调里 `setState`**：
   > Dispatching a React state update directly from a rAF/setTimeout callback can nest into a
   > concurrent render pass and trip React's **"Maximum update depth exceeded"** guard on large
   > streaming sessions.
3. **限速用"帧 + 定时器混合"**：帧率超出上限时不丢帧，而是排一个 setTimeout 补齐剩余间隔。

**与既有 PR-13（text-delta 合批）的区别**：PR-13 抄的是 upstream 的
`lib/text-delta-batcher.ts`（55 行，只处理 text 增量）；desktop 这个是**更泛化、更安全**的版本
（快照式、含 FPS 上限、含 React 最大更新深度防护、可测试——所有定时器/帧函数都可注入）。
→ **建议 D-PR-13 直接采用 desktop 版本**，并在既有 PR-13 里标注被替换。

### 5.5 Git 图谱 / 变更面板 / Worktree 面板

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `lib/git-graph-parser.ts` | 54 | `git log` 输出 → commits（**不要 `--graph`**，geometry 由客户端算） |
| `lib/git-graph-lanes.ts` | **107** | 泳道状态机（commit 落到第一个 pending parent 是该 hash 的 lane；首个 parent 继承 lane；额外 parent 向右开新 lane；root 释放 lane；`compact` 回收 / `faithful` 只向右长） |
| `lib/git-graph-refs.ts` | — | `%D` 装饰 → `HEAD / branch / remote / tag` 四类标签 |
| `lib/git-graph-palette.ts` | — | **主题派生调色板**：lane 0 用 `--accent` 原色，其余**绕色轮旋转 hue 但固定 S/L**，保证明暗两套主题都可辨 |
| `lib/git-graph.ts` | 100 | 服务端：bounded `git log`（多取 1 条判截断）+ 每 commit 改动文件列表 |
| `components/GitGraphTab.tsx` | **573** | 渲染 |
| `components/ChangesTabView.tsx` / `QuickChangesPanel.tsx` | 95 / 183 | 变更面板（完整 / 精简两版） |
| `components/WorktreePanel.tsx` | 350 | worktree 管理 |

**本仓库现状**：已有 `/api/git/status` + `/api/git/diff` + `lib/git-changes.ts`（211 行）
+ `lib/worktree.ts`（239 行）+ `/api/worktrees`，**后端齐了，缺的是 UI**。

**判定**：
- **Git 图谱**：后端零成本（`git log` 解析三个纯函数 lib，共 ~273 行 + 自带测试）。
  UI 573 行是主要成本。**中价值、低技术风险、纯函数部分可直接搬。**
- **变更面板**：既有计划的 PR-23 已经从 upstream 抄了 `GitChangesPanel.tsx`。
  → 建议**合并**：用 desktop 的 `ChangesTabView` 作为实现（它带 tab 集成），
  保留 PR-23 的挂载点设计。
- **Worktree 面板**：本仓库已有 worktree 后端与 `SessionSidebar` 的 worktree 切换器
  （`lib/worktree.ts` 239 行 > desktop 205 行）。→ **不抄**。

### 5.6 会话时间分组 + 置顶

| 文件 | 作用 |
| --- | --- |
| `lib/time-groups.ts` | `bucketOf(modified, now)` → `today / yesterday / week / month / earlier` |
| `lib/time-group-state.ts` | 分组折叠状态持久化 |
| `lib/types.ts:302` | `TimeBucket` 含 `"pinned"`；`SessionInfo.pinned?: boolean` |

**关键正确性细节**：分桶用**本地日历日**，不是滚动 24 小时，且用 `Math.round` 而非 `floor`：
> Both values are UTC milliseconds of *local* midnight, so **rounding (not flooring) absorbs DST
> transitions** where a calendar day is 23/25 hours long.

未来的会话（时钟偏移 / 跨时区）落进 `today` 而不是"负数天"。

**本仓库现状**：`SessionSidebar` 只有"按项目分组"，**没有时间分组、没有置顶**
（`lib/project-groups.ts` 只做 `getRecentProjects` / `getProjectActivity`）。

→ 判定：**成本低（~120 行纯函数 + 侧栏渲染），体感提升明显**。
既有计划的 PR-20（归档）/ PR-21（项目置顶）是同一 UI 区域，**建议合并到一个批次**做，
共用一次侧栏重构，避免三次改同一个 2,168 行文件。

### 5.7 草稿会话（draft sessions）

`lib/draft-sessions.ts` + `AppShell` 的 `draftSessions / activeDraftId`。
用户点"新建会话"后**立刻**在侧栏出现一条草稿行，可以并行开多个、切换、关闭，
只有真正发出第一条消息才落成 `.jsonl`。

本仓库的 `lib/draft-store.ts`（168 行，比 desktop 的 73 行更厚）是**单一草稿输入框内容**的持久化，
**不是多草稿会话**。

→ 判定：**中价值**。它解决的是"我想同时准备三个任务"的真实场景。
但会牵动 `AppShell` + `SessionSidebar` + `useAgentSession` 三处，成本不低。**列为中优先。**

### 5.8 跨编辑器最近项目探测

`lib/recent-projects.ts`（**377 行**）+ `app/api/recent-projects/route.ts`。

从本机其他编辑器/agent 的**本地数据**里读"最近打开的工作区"：

| 来源 | 读取方式 |
| --- | --- |
| VS Code 家族（Code/Cursor/Windsurf/Trae/…） | `storage.json` 的 MRU（**无时间戳**） |
| Zed | SQLite |
| Claude Code | `history` JSON |
| OpenAI Codex | SQLite |
| OpenCode | SQLite |

**三条明确原则（注释里写死）**：
> - Read-only, **never writes** to other applications' data.
> - Honest presentation: no filtering against pi's own workspaces, no "already added" markers.
> - Sources that cannot be read are **skipped silently** — every source is best-effort.

**两个技术点**：
- 用 **`node:sqlite`**（Electron 43 带 Node 24 时已稳定）；Node < 23.4 需要 `--experimental-sqlite`，
  不可用时**优雅降级**（JSON 源照常工作）——用 lazy `import()` 包在 try/catch 里。
- `file://` URI 解码；**远程工作区（非 file URI）返回 null**。

**本仓库适配**：本仓库跑在 Node（≥22.19）上，**`node:sqlite` 可能不可用** →
需要 `--experimental-sqlite` 或换 `better-sqlite3`。这是本项的主要风险，**先做 spike 验证**。

### 5.9 其他可抄的小项

| 项 | desktop 路径 | 价值 | 成本 |
| --- | --- | --- | --- |
| **CompactionSummary 压缩摘要卡** | `components/CompactionSummary.tsx` | 中（本仓库有 `lib/compaction-summary.ts` 但无卡片） | 低 |
| **相对时间格式化统一** | `lib/format-relative-time.ts` | 低（本仓库有 `lib/i18n/format.ts` 的 `formatRelativeTime`） | 极低 → **不做** |
| **API 类型角标** | `lib/provider-icon.ts:resolveApiBadge()` | 低（模型列表可辨协议族） | 极低 |
| **`session-cache` / `session-list`** | `lib/session-cache.ts`（87）/ `session-list.ts` | 低（本仓库有 `session-list-scanner.ts` 330 行，更强） | **不做** |
| **思考等级记忆 / 画像** | `lib/thinking-level-memory.ts` / `thinking-levels.ts` / `thinking-profile.ts` / `thinking-request-core.ts` | 中（本仓库只有 `lib/thinking-expansion-preference.ts`） | 低 |
| **工具参数渲染** | `lib/tool-parameters.ts` | 中（参数格式化） | 低 |
| **markdown 增量 / 列表 / 图片** | `lib/markdown-incremental.ts` / `markdown-list.ts` / `markdown-images.ts` / `prism-theme.ts` | 中（本仓库 `MarkdownBody.tsx` 只有 124 行） | 低 |
| **PromptsConfig 提示词管理** | `components/PromptsConfig.tsx` + `/api/prompts` | 中（本仓库设置里**没有**提示词一节） | 中 |
| **ToolsPanel 工具面板** | `components/ToolsPanel.tsx` | 低（本仓库有 `ToolDefinitionsPanel.tsx`） | **不做** |
| **草稿 / `useResizableHeight`** | `hooks/useResizableHeight.ts` | 低 | 低 |

---

## 6. 反向清单：本仓库领先，**不要被 desktop 反向"优化"掉**

| 能力 | 本仓库证据 | desktop |
| --- | --- | --- |
| **终端** | `components/TerminalPanel.tsx` + `lib/terminal-manager.ts` + `node-pty` + `@xterm/xterm` | ❌ 无 |
| **MCP 面板** | `app/api/mcp/route.ts`（367 行） | ❌ 无 |
| **Markdown WYSIWYG** | ProseMirror 10 包 + `MarkdownFileEditor.tsx`（474 行） | ❌ 无 |
| **Web Push** | `lib/web-push.ts` + `public/sw.js` | ❌ 无 |
| **Provider 用量查询** | `lib/provider-usage.ts`（374 行） | ❌ 无 |
| **`apply_patch` 分栏 diff** | `lib/apply-patch.ts` | ❌ 无 |
| **内置浏览器面板** | `components/BrowserPanel.tsx` + `browser-tab-state.ts` | ❌ 无 |
| **扩展 widget / 状态条** | `ExtensionWidgets.tsx` / `ExtensionStatusBar.tsx` | ❌ 无 |
| **PWA / 离线页** | `app/manifest.ts` + `public/sw.js` + `public/offline.html` | ❌ 无 |
| **四栏可互换工作区** | `AppShell` 的 `workspaceSwapped` + `inert` + `aria-hidden` | ❌ 无 |
| **容器查询闸门** | `.file-panel-body` + `@container (min-width: 760px)` | 用 `@media` |
| **测试厚度** | 191 个 `.test.mjs` | 139 |
| **API 路由数** | 56 | 48 |
| **i18n 语言数** | 3（en / zh-CN / zh-TW） | 2（en / zh-CN） |
| **代码审阅工具链** | `docs/codex-skin/{audit-tokens,verify-themes,capture-themes}.mjs` | ❌ 无 |

**特别警告**：
1. **不要用 desktop 的 `SessionSidebar.tsx`（2,969 行）替换本仓库的（2,168 行）** ——
   两边功能集不重合，本仓库有 worktree 分组 / 项目身份 / 虚拟列表。
   只摘「时间分组 + 置顶」（§5.6）。
2. **不要用 desktop 的 `ChatInput.tsx`（3,580 行）替换本仓库的（2,852 行）** ——
   本仓库的输入框已经接了 tool preset、模型选择、扩展 widget、composer context strip。
   只摘 mention 高亮（§5.2）与 compact（§5.3）。
3. **不要用 desktop 的 `MessageView.tsx`（1,704 行）替换本仓库的（1,883 行）** ——
   本仓库多了 quoted selection / restore / search / token-estimate 四条分支。
   ProcessGroup 应作为**新增渲染路径**接入，而非替换。

---

## 7. 移植风险清单（动手前必读）

| # | 风险 | 依据 | 应对 |
| --- | --- | --- | --- |
| 1 | **token 名不匹配**（§3.1） | desktop 映射 29 个 var，本仓库强制 34 个，交集 14 | `mapToCssVars()` 重写，过 `audit-tokens.mjs` + `verify-themes.mjs` |
| 2 | **CSS 改动必须过三件套** | `docs/codex-skin/delta.md:385-402` | 每个皮肤 PR 的 DoD 追加 `audit-tokens` + `verify-themes` + `capture-themes` |
| 3 | **`--border` 是三级不是一级** | `REQUIRED_PER_THEME` 含 `--border-strong` / `--border-faint` | 边框深度滑杆要同时驱动三级 |
| 4 | **`zoom` 坐标系陷阱** | `参考项目/.../lib/ui-scale.ts:1-24` | 凡 `getBoundingClientRect()` / `clientX` 定位的浮层都要 `cssPx()` |
| 5 | **本仓库布局已是四栏** | `delta.md` §11–§17 | 不搬 desktop 的三栏壳；只搬局部能力 |
| 6 | **`AppShell.tsx` 是最敏感文件** | 2,812 行，已有 6 个 `.test.mjs` 结构断言 | 每个 PR 只加挂载点，拆小步；注意 `AppShell.*.test.mjs` 会按注释文本切片 |
| 7 | **`FileViewer` 状态双写** | `components/file-tab-state.ts` 同时有 `saveFileViewerState` 与 `viewerRevision` | keep-alive PR（既有 PR-24）必须删掉快照机制 |
| 8 | **`node:sqlite` 版本依赖** | `参考项目/.../lib/recent-projects.ts:16-21` | 先 spike；不可用就只做 JSON 源（VS Code / Claude Code） |
| 9 | **React 严格模式双调用** | dev 下 effect 双调用 | 搬带副作用的 hook（`MutationObserver`、事件订阅）时 unsubscribe 必须幂等 |
| 10 | **统一做法：`.test.mjs` 一起搬** | desktop 有 139 个测试 | `process-content` / `stream-update-scheduler` / `git-graph-*` / `time-groups` / `input-compact` / `right-tabs-memory` 都有测试 |
| 11 | **SDK 版本差异** | desktop 用 `^0.85.1`（浮动），本仓库 pin `0.85.1` | 搬完必跑 `tsc --noEmit` |
| 12 | **SDK 主题契约可能漂移** | `theme-schema.json` 是外部 URL | 解析层要有"未知 token 忽略 + 缺失 token 兜底"（desktop 的 `ALL_COLOR_TOKENS` 填充空串） |

---

## 8. 去重表：与既有 PR 计划的关系

既有计划 `ref-projects-pr-plan-2026-09-16.md` 里**已经**覆盖的 desktop 内容：

| 既有 PR | 内容 | 来源 | 本文处理 |
| --- | --- | --- | --- |
| PR-01 ~ PR-11 | Electron 外壳 / preload / 防御 / splash / 标题栏 / 托盘 / 原生桥 / 打包 / 通知 / 更新 | desktop + mcode | **不重复**，本文 §4.8 交叉引用 |
| PR-13 | 流式文本按帧合批 | upstream `text-delta-batcher.ts` | **建议改用 desktop 版本**（见 §5.4），由 **D-PR-C04** 承接 |
| PR-17 | 第四栏上下文 gutter | upstream | 与本文 §4.5 互补，不冲突 |
| PR-24 | 右栏多类型 tab + keep-alive | desktop `tab-model.ts` + `right-tabs-memory.ts` | **保留**，本文 §4.3 补了 3 条验收标准 |
| PR-25 | 阅读时收起输入框 | desktop `lib/input-compact.ts` | **保留**，本文 §5.3 补了 `userIntent` 验收标准 |
| PR-23 | Git 变更面板 | upstream | **建议改用 desktop 的 `ChangesTabView`**，由 **D-PR-D01** 承接 |
| PR-04 / PR-05 | splash / 自定义标题栏 | desktop | **不重复** |

**本文新增（既有计划完全没覆盖）**：
主题引擎、边框深度、UI 缩放、壁纸、字体、ContextMenu、右栏空态、工作区标签、
欢迎大厅、跨编辑器最近项目、过程分组、mention 高亮、CompactionSummary、
会话信息条统一、Git 图谱、会话时间分组+置顶、草稿会话、Prompt 管理、设置导航模型纯数据化。

---

## 9. PR 拆分

### 9.0 统一 DoD

```bash
node_modules/.bin/tsc --noEmit        # 必过
npm run lint                          # 0 error
npm test                              # 除环境性用例外全过
```

**仅当改动 `app/globals.css` / `app/settings.css` / 主题层时追加**：

```bash
node docs/codex-skin/audit-tokens.mjs
mv .next $(mktemp -d)/next && npm run prod
node docs/codex-skin/verify-themes.mjs
node docs/codex-skin/capture-themes.mjs
# 并更新 docs/codex-skin/delta.md
```

### 9.1 阶段总览

| 阶段 | 主题 | PR 数 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| **A** | 样式地基（主题 / 缩放 / 壁纸 / 字体 / 设置导航） | 5 | — | 中（A-01/02 高风险，其余低） |
| **B** | 布局原语（菜单 / 空态 / 标签 / 欢迎 / 最近项目 / 信息条） | 6 | A（仅 B-02 需 A-05） | 低 |
| **C** | 对话体验（过程分组 / mention / 摘要 / 调度） | 4 | — | **高（C-01）**，其余低 |
| **D** | 仓库视图（Git 变更 / 图谱） | 2 | 既有 PR-24、B-02 | 中 |
| **E** | 会话管理（时间分组 / 草稿） | 2 | — | 低 |
| **F** | 附带项（Prompt 分区 / 字体 / 角标） | 3 | A-05（F-01） | 极低 |

**合计 22 个 PR。**

**推荐节奏**：`A ∥ B ∥ C(先 C-02/C-03/C-04) → D → E → F`，
其中 **A-01、A-03、C-01 三个是"高风险大件"**，不要并行。

---

### 阶段 A · 样式地基

#### D-PR-A01 · pi CLI 主题引擎（解析层）★高风险高收益

**目标**：让本仓库能直接读 pi CLI 的主题 JSON，用户的 TUI 主题 = Web 观感。

**来源**：`参考项目/pi-web-desktop-main/lib/theme.ts`（540 行，**取解析层 ~450 行**）
+ `lib/themes/*.json`（10 个内置）
+ `app/api/themes/route.ts` + `app/api/themes/[name]/route.ts`

**改动面**
- 新增：`lib/pi-theme.ts` —— 解析 / 色彩解析（256 色索引、`vars` 引用）/ 极性判定 /
  对比度修正 / 主题集合扫描
- 新增：**`mapToCodexTokens()`** —— ⚠️ **不是**直接搬 `mapToCssVars()`，
  而是映射到本仓库 34 个强制令牌（见 §3.1 的对照）
- 新增：`lib/pi-themes/*.json`（内置 5 套）
- 新增：`app/api/themes/route.ts`（列集合）、`app/api/themes/[name]/route.ts`（解析成 CSS 变量）
- 新增：`lib/pi-theme.test.mjs` —— **连同 desktop 的边界用例一起搬**
  （空串 token → 从色板推导、未知引用、`searchMatch*` 回退、DST 无关的极性判定）

**关键设计决策（需要先拍板）**：

| 方案 | 说明 | 推荐 |
| --- | --- | --- |
| **A. 叠加** | `data-theme` 保持六套 Codex 色板；pi 主题通过 `<html>` 的 **inline style CSS 变量**叠加。切回 Codex 色板时必须 `removeProperty()` 清空。 | ✅ **推荐**：与 `verify-themes.mjs` / 六套色板产品定位零冲突 |
| **B. 统一** | 把六套 Codex 色板也做成"主题集合"里的条目 | ❌ 与 `delta.md` 的产品定位冲突 |

**方案 A 的额外要求**（desktop 的做法 + 一处改进）：
- desktop 用 `data-theme` 预置属性 + `applyingRef` 守卫做挂载后 reconcile（会有一次异步 fetch）；
- 本仓库**已有** `THEME_INIT_SCRIPT` 首屏注入 → **改进**：把解析结果按 `name::mode` 缓存进
  localStorage，由 `THEME_INIT_SCRIPT` 在首帧同步应用，避免 FOUC。

**验收标准**
- [ ] `GET /api/themes` 能列出 `~/.pi/agent/themes/` + `<cwd>/.pi/themes/` + 内置，同名时用户覆盖内置
- [ ] `GET /api/themes/gruvbox?mode=dark` 返回完整 CSS 变量表，**34 个强制令牌全部有值**
- [ ] 切到 pi 主题后 6 套 Codex 色板仍可正常切回（inline style 已清空）
- [ ] `audit-tokens.mjs` 通过（不得引入未定义 token）
- [ ] `verify-themes.mjs` 通过（不得出现重复主题块）
- [ ] `delta.md` 更新

**依赖**：无
**风险**：token 映射（§7 #1）——这是全阶段最容易翻车的一步，**建议先做 spike 验证映射表**。

---

#### D-PR-A02 · 主题选择 UI + 边框深度滑杆

**目标**：把 A-01 的能力暴露给用户。

**来源**：`components/DisplayConfig.tsx`（478 行，取主题段）+ `hooks/useTheme.ts:applyBorderDepth()`（45 行）

**改动面**
- 修改：`components/SettingsPanel.tsx` 的「通用」分区
  - 主题模式三态（light / dark / system，本仓库已有 6 选 1，需要重新组织
    「模式」与「色板」两个概念）
  - 主题集合选择（tag 网格，active 用 `--accent` + `accent-soft`）
  - 边框深度滑杆 0–100
- 新增：`lib/border-depth.ts` + `.test.mjs` —— 纯函数产出 color-mix 表达式（可测）
- 修改：`app/globals.css` —— `--border-orig` / `--border-strong-orig` / `--border-faint-orig` 快照注释
  ⚠️ **皮肤 PR**
- 修改：`lib/i18n/messages/{en,zh-CN,zh-TW}.ts` —— 三语 key

**关键实现**
```ts
// 三级同时驱动，保持相对关系
--border        ← depth 曲线直通
--border-strong ← 在 depth 结果上偏 16%（更实）
--border-faint  ← 在 depth 结果上偏 −40%（更虚）
--focus-ring    ← 不参与（可访问性不随颜色变）
```

**验收标准**
- [ ] 切主题即时生效，无闪烁
- [ ] 边框深度 0 = 隐形、50 = 主题原值、100 = 最大对比；三级边框相对关系保持
- [ ] 滑杆是 `role="slider"` + `aria-valuenow` / `aria-valuetext`（参考既有 PR-14 的 ARIA 契约）
- [ ] 六套 Codex 色板 + 五套 pi 主题两两组合渲染正确（10 张截图）
- [ ] `delta.md` 更新

**依赖**：D-PR-A01

---

#### D-PR-A03 · UI / 文字缩放（`--app-ui-scale`）★先 spike

**目标**：整站缩放 0.8–1.5。

**来源**：`hooks/useTheme.ts`（`FONT_SCALE_*` + `applyFontScale`）+ `lib/ui-scale.ts`（32 行，其中 24 行是坐标系陷阱的注释）

**Spike 内容（不合并）**：只加 `html { zoom: var(--app-ui-scale, 1) }` 与一个临时输入框，
逐项验证 §3.3 的 5 个风险点，产出实测报告。

**改动面（spike 通过后）**
- 新增：`lib/ui-scale.ts`（`getUiScale` / `cssPx` / `cssViewportSize`）+ `.test.mjs`
- 新增：`hooks/useUiScale.ts`
- 修改：`app/globals.css` —— `html { zoom: var(--app-ui-scale, 1) }` ⚠️ **皮肤 PR**
- 修改：`components/ContextMenu`（若 A/B-02 已落地）/ `SettingsPanel` 的浮层 /
  `AppShell` 根容器高度（`calc(var(--app-viewport-height) / var(--app-ui-scale, 1))`）
- 修改：`hooks/useResizablePanel.ts` —— 拖拽用 `cssPx()`
- 修改：`hooks/useViewportHeight.ts` —— 与 zoom 的叠加关系
- 修改：`hooks/useTheme.ts` 的 `startViewTransition` 圆形擦除坐标（÷ uiScale）

**验收标准**
- [ ] **必须逐条核对 §3.3 表格的 5 个风险点**，每条给出实测证据
- [ ] 125% 下：侧栏覆盖层、设置 modal、右键菜单、composer 弹层**位置全部正确**
- [ ] 125% 下：面板拖拽 1:1 跟手（无加速/减速）
- [ ] 80% / 100% / 150% 三档各一张截图
- [ ] `prefers-reduced-motion` 与 `zoom` 不冲突

**依赖**：无（但与 A-02 同为 CSS 皮肤 PR，**不要同时开**）
**风险**：这是全文**技术风险最高**的一项（`zoom` 的坐标系语义）。若 spike 发现不可控，
**明确记录结论并降级为"只调字号与控件高度，不做 zoom"**。

---

#### D-PR-A04 · 壁纸层

**目标**：可选的背景图（含分区域玻璃效果）。

**来源**：`app/wallpaper.css`（223 行）+ `components/WallpaperLayer.tsx`（63）+ `hooks/useWallpaper.ts`（205）+ `lib/wallpaper.ts`（182）

**改动面**
- 新增：`app/wallpaper.css`（需适配 `@import` 到 `globals.css`）
- 新增：`components/WallpaperLayer.tsx` + `hooks/useWallpaper.ts` + `lib/wallpaper.ts` + `.test.mjs`
- 修改：`components/AppShell.tsx` —— 挂载 `<WallpaperLayer />` 为工作区行的**第一个子节点**
- 修改：`app/globals.css` / `settings.css` —— 侧栏与右栏在 `data-wallpaper="on"` 下变半透明玻璃
  ⚠️ **皮肤 PR，且会牵动 6 套色板**
- 修改：`components/SettingsPanel.tsx` —— 壁纸设置区（选图 / 移除 / scrim 滑杆 / 三个区域模式）

**必须保留的 4 条经验**
1. 图片走 `<img src>`，**不用** CSS `background-image`（Chromium 丢 >1MB 的 CSS 值）
2. scrim = `color-mix(in srgb, var(--bg) var(--wallpaper-scrim, 70%), transparent)`
3. 欢迎页要更透 → 用 `:has()` 写**新规则**，不要自引用变量
4. 分区域 mode（message / panel / input）各自一个 `data-*`

**验收标准**
- [ ] 选图后即时生效；刷新后保持；移除后回到纯色
- [ ] 六套色板 × 三个 scrim 档位，文字对比度全部达标（截图 + 目视）
- [ ] `data-wallpaper-ready` 门控生效（解码前不闪）
- [ ] `data-theme` 变化时内置画作跟随切换
- [ ] `verify-themes.mjs` / `audit-tokens.mjs` 通过
- [ ] `delta.md` 更新

**依赖**：D-PR-A02（边框深度已把 `--border-orig` 机制建立起来，两者共用）
**风险**：面板玻璃化会影响 6 套色板的对比度 → **本项是纯口味项，可延后或不做**

---

#### D-PR-A05 · 设置导航模型纯数据化

**目标**：加一个设置分区不再需要改三处。

**来源**：`lib/settings-nav.ts`（63 行，纯数据 + `scope` + 页面描述）

**改动面**
- 修改：`lib/settings-navigation.ts` —— 增加 `SETTINGS_NAV_SECTIONS` 纯数据模型
  （`{ id, labelKey, scope: "global" | "workspace", items[] }`）
- 修改：`components/SettingsPanel.tsx` —— 删掉 `SettingsSectionIcon` 里的五连 `if`，
  改为数据驱动 + `Record<section, ComponentType>` 图标表
- 修改：`app/settings.css` —— `--control-height` / `--settings-pad-x` /
  `--settings-section-gap` 三个 metric token（把散落的硬编码收口）⚠️ **皮肤 PR**
- 新增：`lib/settings-navigation.test.mjs` —— 断言每个 `labelKey` 三语齐备、
  `scope: "workspace"` 的项在无 cwd 时被过滤

**验收标准**
- [ ] 新增一个分区只需改数据 + 加一个组件
- [ ] 每个 nav `labelKey` 在 en / zh-CN / zh-TW 都存在（测试强制）
- [ ] 无 cwd 时 workspace scope 的分区不可选
- [ ] 设置面板视觉无变化（回归截图）

**依赖**：无
**成本**：低
**收益**：是 D-PR-A02（新增主题区）、D-PR-F01（新增 Prompt 区）的前置。

---

### 阶段 B · 布局原语

#### D-PR-B01 · 通用右键菜单 ContextMenu

**目标**：一处修键盘/边界/滚动关闭，全站受益；顺手删掉 `AppShell` 里的手写实现。

**来源**：`components/ContextMenu.tsx`（536 行，**取 ~400 行**）

**改动面**
- 新增：`components/ContextMenu.tsx` —— `ContextMenuProvider` + `useContextMenu()`
- 新增：`components/ContextMenu.test.mjs`（关闭时机、边界翻转、子菜单一级限制）
- 修改：`components/AppShell.tsx` —— 挂载 provider；
  **删掉 `:2866+` 的手写菜单**（`sessionContextMenu` 状态 + `sessionContextMenuRef` +
  手动 clamp + `contains()` 外部点击判定），改为 `openMenu(x, y, entries)`
- 修改：`components/SessionSidebar.tsx` —— 发事件改为直接调 `useContextMenu()`
- 修改：`lib/session-row-context-menu.ts` —— 导出 `ContextMenuEntry[]` 而非自定义事件 detail
- 修改：`app/globals.css` —— 菜单样式（若不用内联 style）⚠️ **皮肤 PR**

**关键实现**
```ts
// 关闭时机：用户滚动关，程序化滚动（流式聊天）不关
// 子菜单只允许一级：类型上就禁止
submenu?: Omit<ContextMenuItem, "submenu">[];
// 坐标必须过 ui-scale 换算（若 A-03 已落地）
const pos = { x: cssPx(x), y: cssPx(y) };
```

**验收标准**
- [ ] 会话行右键 → 菜单跟随指针、边缘自动翻转
- [ ] Escape / 外部点击 / 滚轮 / `window.blur` / `resize` 都能关
- [ ] **流式聊天自动滚动时不关**
- [ ] ↑/↓ + Enter 可操作；`feedbackLabel`（"已复制"）生效
- [ ] `AppShell.tsx` **净减 ≥250 行**
- [ ] `AppShell.file-viewer-state.test.mjs` 的切片锚点未被破坏（注意注释文本）

**依赖**：无（A-03 落地后追加坐标换算）
**成本**：中；**收益**：高（一次改动修掉 5 个交互缺口）

---

#### D-PR-B02 · 右栏空态引导

**来源**：`components/RightPanelEmptyState.tsx`（73 行）

**改动面**
- 新增：`components/RightPanelEmptyState.tsx`
- 修改：`components/ExplorerPanel.tsx` —— 无标签且无 cwd 时渲染空态
- 修改：`app/settings.css`（或 `globals.css`）—— 空态样式 ⚠️ **皮肤 PR**
- 修改：`lib/i18n/messages/*.ts` —— 3 个 key × 3 语言

**验收标准**
- [ ] 无 cwd 时两个入口 disabled 且有 `title` 说明原因
- [ ] 有 cwd 时点击直达对应 tab（Changes / Git graph）
- [ ] 三个语言 key 齐备

**依赖**：D-PR-D01 / D-PR-D02（入口指向的功能）→ **可先做视觉占位，功能随 D 阶段接线**
**成本**：极低（~80 行）

---

#### D-PR-B03 · 工作区标签栏（classic / tabs 双视图）

**目标**：浏览器式工作区标签，快速在多个项目间跳。

**来源**：`lib/workspace-tabs.ts`（151）+ `components/WorkspaceTabBar.tsx`（432）+ `hooks/useViewMode.ts`（57）+ `hooks/useWorkspaceTabs.ts`（46）

**改动面**
- 新增：`lib/workspace-tabs.ts` + `.test.mjs`（**纯函数，测试直接搬**）
- 新增：`hooks/useViewMode.ts` + `hooks/useWorkspaceTabs.ts`
- 新增：`components/WorkspaceTabBar.tsx`
- 修改：`components/AppShell.tsx` —— classic 模式不动；tabs 模式把标签栏 `createPortal`
  挂到顶栏的 host div
- 修改：`components/SettingsPanel.tsx` —— 视图模式开关
- 修改：`app/globals.css` —— `.workspace-tab-*` ⚠️ **皮肤 PR**

**⚠️ 前置决策**：本仓库主区**已有** `TabBar`（终端 / 浏览器标签）。
在工作区层面再加一层标签会产生两套标签语义。**两个选项**：
- **① 只做"工作区切换器下拉增强"**（不引入第二层标签）——**推荐，成本 1/3**
- **② 完整做双视图模式**——需先统一两套标签的语义（工作区标签在顶栏、文档标签在主区）

**验收标准（选②时）**
- [ ] classic 模式：顶栏无空洞，布局与现在**完全一致**
- [ ] tabs 模式：拖拽重排 / 关闭后取右邻（最后一条取左邻）/ 中键关闭
- [ ] `workspaceKeyOf()` 同一仓库的 worktree **共用同一标签槽**
- [ ] 关闭标签**绝不**触碰会话或任务（注释里写死的契约）
- [ ] 视图模式持久化（`pi-web:view-mode`）

**依赖**：无
**风险**：与现有 `TabBar` 的语义冲突 → **建议先做①**

---

#### D-PR-B04 · 欢迎大厅 WelcomeLobby

**目标**：新会话空态从"空白"变成"从这里开始"。

**来源**：`components/WelcomeLobby.tsx`（449 行，取 ~350）+ `components/PiLogo.tsx`（19）

**改动面**
- 新增：`components/WelcomeLobby.tsx`
- 新增：`components/PiLogo.tsx`
- 修改：`components/ChatWindow.tsx` —— `isEmptyNew` 分支改为渲染 lobby
- 修改：`hooks/useProjectContext` 等价物 —— 复用现有 `lib/project-groups.ts` 的
  `getRecentProjects()` / `getProjectActivity()`（**零额外请求**，与侧栏同一份数据）
- 修改：`app/globals.css` —— `.chat-welcome` 三区网格 ⚠️ **皮肤 PR**
- 修改：`lib/i18n/messages/*.ts` —— 约 15 个 key × 3 语言

**关键实现**
```tsx
// 三段式，每段为空时整块隐藏（不显示"暂无"占位）
// 第 2 段的数据从已有的 /api/sessions 缓存派生，冷启动零额外请求
// 第 3 段（推荐工作区）可关，key: pi-recent-projects-enabled，默认开
```
**注意**：D-PR-A04（壁纸）的 `:has(~ .chat-column .chat-welcome)` 依赖 `.chat-welcome` 这个类名，
两者要约定好。

**验收标准**
- [ ] 新会话（无消息）显示三段；有消息后不再显示
- [ ] 两个列表都为空时，"New workspace" 仍然可见（新装用户唯一入口）
- [ ] 选择项目走**现有**的工作区打开链（`/api/cwd/validate` → allow-list），不新增旁路
- [ ] 打开 lobby 期间 `/api/sessions` **零新增请求**
- [ ] 移动端布局不破（`useIsMobile`）

**依赖**：无（第 3 段依赖 D-PR-B05，可先隐藏）
**成本**：中；**收益**：高

---

#### D-PR-B05 · 跨编辑器最近项目探测

**目标**：把用户在其他编辑器里已有的项目直接端上来。

**来源**：`lib/recent-projects.ts`（377）+ `app/api/recent-projects/route.ts`（21）

**改动面**
- 新增：`app/api/recent-projects/route.ts`
- 新增：`lib/recent-projects.ts` + `.test.mjs`（**URI 解码 / 去重 / 排序都有测试**）
- 修改：`components/WelcomeLobby.tsx` —— 第三段
- 修改：`components/SettingsPanel.tsx` + `lib/i18n` —— 开关

**⚠️ Spike 前置**：本仓库跑 Node ≥22.19，**`node:sqlite` 是否可用需实测**
（`node -e "require('node:sqlite')"`）。
- 可用 → 全源支持
- 不可用 → **只做 JSON 源**（VS Code 家族 `storage.json` + Claude Code `history`），
  SQLite 源（Zed / Codex / OpenCode）优雅降级

**三条硬原则（照抄注释）**
- 只读，**绝不写**其他应用的数据
- 诚实呈现：不与其自身工作区做过滤、不加"已添加"标记
- 读不到的源**静默跳过**（best-effort）

**验收标准**
- [ ] `GET /api/recent-projects` 返回去重（按 path，保留最新时间戳）的列表
- [ ] `file://` URI 正确解码；**远程工作区（非 file URI）返回 null 而非乱码路径**
- [ ] 所有源都读不到时返回空数组**而不是 500**
- [ ] 在本机不写任何文件（用文件 mtime 快照验证）
- [ ] Windows 路径大小写折叠去重

**依赖**：D-PR-B04
**成本**：中高（377 行，但一半是各编辑器的解析分支）

---

#### D-PR-B06 · 会话信息条信息架构统一

**目标**：把散在三处的会话/上下文/系统提示信息合并成一处。

**来源**：`components/SessionInfoBar.tsx`（552，取 ~300）+ `components/SessionActivityIndicators.tsx`（69）

**改动面**
- 新增：`components/ContextDonut.tsx` —— SVG 弧 + CSS 变量驱动百分比
  ```tsx
  style={{ "--context-percent": `${pct}%`, "--context-tone": tone }}
  // 阈值 ≥95% → --danger，≥80% → --warning，否则 --accent
  ```
- 新增：`components/SystemPromptPopover.tsx` —— 复用 `SystemPromptPanel` 的内容，
  改 popover 形态（含 desktop 那套完整 markdown 样式：h1–h6 各一档字号）
- 修改：`components/AppShell.tsx` —— 顶栏 popover 合并（现有 `:2427+` 的 `sessionStats` popover）
- 修改：`components/BranchNavigator.tsx` —— 支持内联到 popover
- 修改：`app/globals.css` —— `.session-info-*` ⚠️ **皮肤 PR**
- 修改：`lib/i18n/messages/*.ts`

**验收标准**
- [ ] 上下文环的百分比与 `contextUsage.percent` 一致；`percent === null` 时显示"?"（不显示 0%）
- [ ] 系统提示 popover 渲染完整 markdown（标题/代码/表格/引用各一档）
- [ ] 压缩中显示旋转态；`compactError` 有展示位
- [ ] 复制字段（file / id / projectDir / gitBranch / gitWorktree）成功后有反馈态
- [ ] **不新增第二条信息条**（现有顶栏就是宿主）

**依赖**：无
**成本**：中

---

### 阶段 C · 对话体验

#### D-PR-C01 · 过程分组 ProcessGroup ★高风险高收益

**目标**：把"一堆平铺的工具调用"变成"语义化步骤列表"。

**来源**：`lib/step-categorizer.ts`（625）+ `lib/step-visuals.ts`（139）+ `lib/process-content.ts`（153）
+ `components/ProcessGroup.tsx`（1,012）+ `hooks/useProcessDisplayMode.ts`（44）

**强烈建议拆成 3 个 PR：**

**C01-a · 纯逻辑层（可独立合并、零 UI 风险）**
- 新增：`lib/step-categorizer.ts` + `.test.mjs`（**测试一起搬**）
- 新增：`lib/step-visuals.ts`
- 新增：`lib/process-content.ts` + `.test.mjs`
- 新增：`hooks/useProcessDisplayMode.ts`
- **不带任何 UI**，所以 CI 绿就是绿

**C01-b · 渲染层（feature flag 并行）**
- 新增：`components/ProcessGroup.tsx`
- 修改：`components/ChatWindow.tsx` —— **新增** ProcessGroup 分支，
  `localStorage: pi-process-renderer = legacy | grouped`（默认 legacy）
- 修改：`components/MessageView.tsx` —— 复用 `ToolCallBlock` / `ThinkingBlock`
- 修改：`app/globals.css` —— `.process-tab-*` / `.process-file-tag` / `.tool-call-*`
  ⚠️ **皮肤 PR**（注意 desktop 用了 Tailwind 的 `group/process` 语法，本仓库 Tailwind 4 可用）
- 修改：`lib/i18n/messages/*.ts` —— 约 20 个 key × 3 语言

**C01-c · 切换开关 + 默认值**
- 修改：`components/SettingsPanel.tsx` —— 过程显示模式（timeline / tabs）
- 稳定一周后把默认值翻成 `grouped`

**必须保留的 3 条经验**
1. **分类顺序**：`command_execution` 必须**最先**判定，否则 `bash cat` 会被 `document_read` 抢走
2. **`toolGroup` 合并**：连续同类工具合并为一步（数据形状见 §5.1）
3. **步骤标签是"类型 + 目标"**：`"编辑 src/main.ts"` 而不是工具名

**验收标准**
- [ ] `legacy` 渲染路径**逐像素不变**（回归截图）
- [ ] `grouped` 路径下：连续 3 次 `edit` 合并为 1 步，显示 3 个文件徽标
- [ ] `bash ls` 归到 `command_execution`（不是 `directory_list`）
- [ ] 折叠态/展开态都有 `aria-expanded`；`prefers-reduced-motion` 下无动画
- [ ] `useProcessDisplayMode` 跨组件同步（`storage` 事件 + 自定义事件）
- [ ] `tsc --noEmit` / `npm test` 全过

**依赖**：无（C01-a 与其它 PR 完全独立）
**风险**：`ChatWindow.tsx`（2,122 行）是第二敏感文件；
**必须用 feature flag 而非直接替换**。

---

#### D-PR-C02 · `@file` / `/skill:` mention 高亮

**来源**：`lib/mention-tokens.ts`（167）+ `lib/file-mentions.ts`（53）

**改动面**
- 新增：`lib/mention-tokens.ts` + `.test.mjs`（**测试一起搬**）
- 新增：`lib/file-mentions.ts`（若本仓库的 file-index 已有等价物则只做适配）
- 修改：`components/ChatInput.tsx` —— textarea 上层加 highlight overlay
  （desktop 的 `.chat-input-highlight-viewport` / `.chat-input-highlight`，与 textarea 严格同字体同 padding）
- 修改：`lib/markdown.ts` —— 接入 `mentionRemarkPlugin`
- 修改：`app/globals.css` —— `.mention-token` / `.mention-token-skill` + 点状下划线 ⚠️ **皮肤 PR**
- 修改：`app/api/files/[...path]/route.ts` 或 `/api/file-index` —— 提供 validators 需要的存在性查询

**必须保留的 2 条契约**
1. **valid 才高亮**：索引未加载 → 一律不高亮（`undefined` ≠ `true`）
2. **正在编辑的 token 不高亮**：`activeTokenStart` 参数
3. **渲染侧在 AST 层做**：`walkTextNodes` 只处理 `text` 节点 → 代码块内的 `@x` 永不被改
4. 产出的 inline HTML 必须完整转义（走 `rehype-raw` → `rehype-sanitize`）

**验收标准**
- [ ] 输入 `@` + 已知路径 → 高亮；`@` + 未知路径 → 不高亮
- [ ] `foo@bar.com` **不**匹配（边界规则）
- [ ] `@"my dir/file"`（带空格的引号形式）正确解析；**未闭合引号不高亮**
- [ ] 代码块里的 `@src/main.ts` 渲染后**保持纯文本**
- [ ] 斜杠命令菜单（`/skill:`）与现有 `@` 补全菜单不冲突
- [ ] `lib/mention-tokens.test.mjs` 全过

**依赖**：无
**成本**：中低；**收益**：中高（输入反馈 + 消息可读性）

---

#### D-PR-C03 · CompactionSummary 压缩摘要卡

**来源**：`components/CompactionSummary.tsx` + `globals.css` 的 `.compaction-file-*` / `.markdown-compaction-message`

**改动面**
- 新增：`components/CompactionSummary.tsx` + `.test.mjs`
- 修改：`components/ChatWindow.tsx` / `MessageView.tsx` —— 压缩条目渲染为卡片
- 修改：`app/globals.css` —— ⚠️ **皮肤 PR**
- 复用：本仓库已有 `lib/compaction-summary.ts`

**验收标准**
- [ ] 压缩卡片显示 `tokensBefore` 与摘要 markdown
- [ ] 折叠的"压缩涉及文件"明细可展开（`<details>` 语义）
- [ ] 三语 key 齐备

**依赖**：无
**成本**：低

---

#### D-PR-C04 · 流式更新调度器（并替换既有 PR-13 的方案）

**目标**：每帧最多一次 React 更新 + 30fps 上限 + React 最大更新深度防护。

**来源**：`lib/stream-update-scheduler.ts`（132，**测试一起搬**）

**改动面**
- 新增：`lib/stream-update-scheduler.ts` + `.test.mjs`
- 修改：`hooks/useAgentSession.ts` —— 接入（**快照式**，不是 delta 式）
- 可选：`lib/text-delta-batcher.ts`（既有 PR-13 的方案）→ 标注为被本方案取代

**关键实现（三条都是血泪）**
```ts
// 1. 保留完整最新快照而非重建 delta → 保住了 tool-call / thinking-block 的变更
enqueue(snapshot);
// 2. 提交走 queueMicrotask → 避免 React "Maximum update depth exceeded"
    if (deferToMicrotask) queueMicrotask(doCommit);
// 3. 帧 + 定时器混合限速 → 超帧率上限时不丢帧
    if (elapsed < minIntervalMs) timerHandle = setTimer(() => scheduleFrame(), minIntervalMs - elapsed);
```

**验收标准**
- [ ] 长回复（>2000 行）流式时**无** "Maximum update depth exceeded"
- [ ] `maxUpdatesPerSecond = 30` 生效（用注入的 `now()` / `requestFrame` 断言）
- [ ] tool-call 与 thinking 的变化**不丢**（与未合批的结果做等价断言）
- [ ] `contentIndex` 变化 / 显式 `flush()` / `destroy()` 是**同步**下发
- [ ] 本仓库既有 2.5s 轮询 + reconciliation 不受影响

**依赖**：无
**成本**：低（源文件 132 行 + 测试 + 1 处接入）；**收益**：中（本仓库 `ChatWindow` 2,122 行，收益明显）

---

### 阶段 D · 仓库视图

#### D-PR-D01 · Git 变更面板（合并既有 PR-23）

**来源**：`components/ChangesTabView.tsx`（95）+ `components/QuickChangesPanel.tsx`（183）
（**优先于** upstream 的 `GitChangesPanel.tsx`）

**改动面**
- 新增：`components/ChangesTabView.tsx`（完整版，进右栏 tab）
- 新增：`components/QuickChangesPanel.tsx`（精简版，进侧栏折叠块）
- 修改：`components/ExplorerPanel.tsx` —— 挂载 QuickChangesPanel
- 修改：`components/AppShell.tsx` —— `changes:` tab 类型（与既有 PR-24 的 tab 模型一起做）
- 修改：`app/globals.css` —— 状态字母 / 文件图标 / 目录灰字 ⚠️ **皮肤 PR**
- 复用：本仓库已有 `/api/git/status` + `/api/git/diff` + `lib/git-changes.ts`

**验收标准**
- [ ] `M / A / D / R / C / T / U` 状态字母 + 对应色（用 `--diff-added` / `--diff-removed`，**不新造红绿**）
- [ ] 点击直接开 diff tab（`onOpenFile(path, name, { modeHint: "diff" })`）
- [ ] 超出上限显示"更多变更文件"
- [ ] 与既有 PR-24 的 tab 模型共享 `changes:` 前缀 id

**依赖**：既有 PR-24
**成本**：中

---

#### D-PR-D02 · Git 图谱 tab

**来源**：`lib/git-graph-parser.ts`（54）+ `lib/git-graph-lanes.ts`（107）+ `lib/git-graph-refs.ts` + `lib/git-graph-palette.ts` + `lib/git-graph.ts`（100）+ `components/GitGraphTab.tsx`（573）

**建议拆 2 个 PR：**

**D02-a · 纯逻辑 + 服务端（零 UI 风险）**
- 新增：`lib/git-graph-parser.ts` + `.test.mjs`
- 新增：`lib/git-graph-lanes.ts` + `.test.mjs`（**泳道状态机的测试必须一起搬**）
- 新增：`lib/git-graph-refs.ts` + `.test.mjs`
- 新增：`lib/git-graph-palette.ts` + `.test.mjs`
- 新增：`lib/git-graph.ts` + `app/api/git/log/route.ts` + `app/api/git/log/files/route.ts`

**D02-b · 渲染**
- 新增：`components/GitGraphTab.tsx`
- 修改：`AppShell` 的 tab 模型（`git-graph:` 前缀）
- 修改：`app/globals.css` ⚠️ **皮肤 PR**

**必须保留的关键点**
- **不要用 `git --graph`**：parser 只读 `hash / parents / refs / author / date / subject`，
  几何由客户端泳道状态机算
- **调色板必须主题派生**：lane 0 = `--accent` 原色；其余 lane **绕色轮转 hue 但固定 S/L**
  （desktop 注释：so they stay distinguishable on both dark and light backgrounds）
- 服务端 bounded log：**多取 1 条判截断**，不额外跑 count 查询
- `GIT_GRAPH_MAX_BUFFER = 16MB`

**验收标准**
- [ ] 纯函数测试全过（含 `compact` / `faithful` 两种 lane 模式）
- [ ] 大仓库（>5000 commit）不卡（限制条数 + 截断提示）
- [ ] 六套色板下 lane 颜色两两可辨
- [ ] 非 git 目录返回 `isGitRepository: false`，UI 显示空态而不是报错

**依赖**：既有 PR-24（tab 模型）
**成本**：D02-a 低（纯函数），D02-b 中

---

### 阶段 E · 会话管理

#### D-PR-E01 · 会话时间分组 + 置顶

**来源**：`lib/time-groups.ts`（51）+ `lib/time-group-state.ts`（42）+ `lib/types.ts` 的 `TimeBucket` / `pinned`

**改动面**
- 新增：`lib/time-groups.ts` + `.test.mjs`（**DST 用例必须搬**）
- 新增：`lib/time-group-state.ts` + `.test.mjs`
- 修改：`lib/types.ts` —— `TimeBucket` 类型 + `SessionInfo.pinned?: boolean`
- 修改：`components/SessionSidebar.tsx` —— 时间分组折叠区 + 置顶操作
- 修改：`lib/i18n/messages/*.ts` —— 6 个 group 标签 × 3 语言

**建议与既有 PR-20（归档）/ PR-21（项目置顶）合并为一个批次**——
三个都改 `SessionSidebar.tsx`（2,168 行），拆成三次 PR 会让同一个文件被重排三次。

**关键正确性点**
```ts
// 本地日历日，不是滚动 24h；Math.round 吸收 DST 的 23/25 小时日
const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
// 未来时间戳（时钟偏移/跨时区）落 today，不是负数天
if (diffDays <= 0) return "today";
```

**验收标准**
- [ ] 分组边界按**本地日历日**（`today` / `yesterday` / `2-7d` / `8-30d` / `earlier`）
- [ ] DST 切换日不产生错组（测试覆盖）
- [ ] 未来时间戳落 `today`
- [ ] 置顶项排最前，重启后保持
- [ ] **绝不隐式改名/删除 `.jsonl`**
- [ ] 空分组整块隐藏

**依赖**：无
**成本**：低（~180 行纯函数 + 侧栏渲染）

---

#### D-PR-E02 · 草稿会话（多草稿）

**来源**：`lib/draft-sessions.ts`（81）+ `AppShell` 的 `draftSessions / activeDraftId`

**改动面**
- 新增：`lib/draft-sessions.ts` + `.test.mjs`
- 修改：`components/AppShell.tsx` —— 草稿列表状态（`draftSessions` / `activeDraftId` /
  `activeDraftIdRef` 同步）
- 修改：`components/SessionSidebar.tsx` —— 草稿行渲染
- 修改：`hooks/useAgentSession.ts` —— 草稿态与真实会话的边界
- 修改：`lib/i18n/messages/*.ts`

**与现有 `lib/draft-store.ts` 的关系**：本仓库的（168 行）是**单一输入框内容**的持久化；
本 PR 增加的是**多条草稿会话**。两者是不同层级，**不要合并**。

**验收标准**
- [ ] 点"新建会话"立刻出现一条草稿行；可并行开多条
- [ ] 切换草稿保留各自输入内容
- [ ] **只有发出第一条消息才创建 `.jsonl`**
- [ ] 关闭草稿不触发任何后端调用
- [ ] 刷新后草稿恢复

**依赖**：无（与 D-PR-E01 同文件，建议顺序做）
**成本**：中高

---

### 阶段 F · 附带项

#### D-PR-F01 · Prompt 管理分区

**来源**：`components/PromptsConfig.tsx`（203）+ `app/api/prompts/route.ts` + `lib/settings-nav.ts`（63）的 `prompts` 项

**改动面**
- 新增：`app/api/prompts/route.ts`
- 新增：`components/PromptsConfig.tsx`
- 修改：`lib/settings-navigation.ts` + `components/SettingsPanel.tsx`（依赖 D-PR-A05）
- 修改：`app/settings.css`（复用 `Config*` 原语即无需改）

**验收标准**
- [ ] 列出全局 / 项目 prompt 文件（复用 `/api/skills` 的 `DefaultResourceLoader` 思路保持一致）
- [ ] 可查看/编辑/新建/删除；删除有确认
- [ ] 与 skills / plugins 的 scope 分组视觉一致

**依赖**：D-PR-A05
**成本**：中

---

#### D-PR-F02 · 字体：正文字体自托管（可选）

**来源**：`@fontsource/ia-writer-quattro` / `@fontsource/lilex` 的**做法**（不是字体本身）

**改动面**
- 修改：`package.json` —— 加自托管字体包
- 修改：`app/layout.tsx` —— `@fontsource` 导入
- 修改：`app/globals.css` —— `--font-ui` / `--font-mono` 字体栈（保留中日文回退）⚠️ **皮肤 PR**

**⚠️ 前置决策**：Codex 皮肤的身份是"几何无衬线 + 系统栈"。
换 iA Writer Quattro（衬线感）会改产品气质 → **建议只自托管等宽字体（Lilex），正文字体保持系统栈**。

**验收标准**
- [ ] 字体本地加载（无 CDN 请求、无 FOUT）
- [ ] 中日文回退顺序正确（`PingFang SC` / `Microsoft YaHei` 在后）
- [ ] 打包体积增量记录在案

**依赖**：无
**成本**：极低

---

#### D-PR-F03 · Provider API 类型角标（可选小件）

**来源**：`lib/provider-icon.ts:resolveApiBadge()`（约 30 行）

**改动面**
- 新增：`lib/provider-icon-badge.ts` + `.test.mjs`
- 修改：`components/ProviderIcon.tsx` —— 右下角角标
- 修改：`components/ModelsConfig.tsx` —— 模型列表显示协议族

**验收标准**
- [ ] `openai-completions` → `C`，`openai-responses` → `R`，`anthropic-messages` → `M` 等
- [ ] 未知 API 类型 → `null`（不显示角标，不显示 `?`）
- [ ] 角标字号随图标尺寸缩放，小尺寸（14px）下不糊

**依赖**：无
**成本**：极低

---

## 10. 依赖关系图

```
阶段 A（样式地基）                    阶段 B（布局原语）            阶段 C（对话体验）
──────────────────                  ──────────────────            ──────────────────
A-01 主题引擎 ★
   └── A-02 主题 UI + 边框深度          B-01 ContextMenu ★            C-01-a 过程分组·纯逻辑 ★
A-03 UI 缩放 ★（先 spike）               └─(可选 A-03 坐标换算)        C-01-b 过程分组·渲染
A-04 壁纸（可选，纯口味）           B-02 右栏空态                     └── C-01-c 切换开关
A-05 设置导航数据化                  B-03 工作区标签（建议降级①）      C-02 mention 高亮 ★
   ├── A-02（需要新分区）            B-04 欢迎大厅 ★                   C-03 压缩摘要卡
   └── F-01 Prompt 分区                  └── B-05 跨编辑器最近项目     C-04 流式调度器 ★
                                     B-06 会话信息条统一
                                                                            │
阶段 D（仓库视图）                    阶段 E（会话管理）                    │
──────────────────                  ──────────────────                   │
既有 PR-24 右栏 tab 模型 ──┬── D-01 变更面板                            │
                          └── D-02-a 图谱纯逻辑 + 服务端                  │
                                  └── D-02-b 图谱渲染                    │
                                                                        │
E-01 时间分组 + 置顶 ─┐                                                  │
E-02 草稿会话        ─┴─（同一文件区，顺序做；建议与既有 PR-20/21 合并批次）

（★ = 建议第一批做）
```

---

## 11. 里程碑建议

| 里程碑 | 内容 | 交付物 |
| --- | --- | --- |
| **M1** | A-05 + B-01 + B-02 + B-04 + C-01-a + C-04 | 设置可扩展、右键菜单统一、欢迎大厅、过程分组逻辑层、流式更稳 |
| **M2** | A-01（spike → 实现）+ A-02 | pi 主题可直读，与 TUI 观感一致 |
| **M3** | C-01-b/c + C-02 + C-03 | 过程分组上线（默认仍 legacy，可切） |
| **M4** | D-01 + D-02 + E-01 | 仓库视图 + 会话管理 |
| **M5** | A-03（spike 通过则做）+ A-04 + B-03 + B-05/B-06 | 缩放、壁纸、标签栏、发现能力 |
| **M6** | E-02 + F-01 + F-02 + F-03 | 草稿会话、Prompt 分区、字体、角标 |

**排序理由**：
- M1 全是**低风险 + 独立**的项，能立刻见效且互不阻塞；
- M2 是**最大收益但最大风险**，需要单独一个窗口期，不要和别的皮肤 PR 并行；
- M3 依赖 C-01-a 的稳定；
- A-03（zoom）**永远排在最后**——它的价值不如 A-01/A-02，风险却是最高的。

---

## 12. 五个决策点（需先拍板）

| # | 决策 | 影响 | 说明 |
| --- | --- | --- | --- |
| **D1** | **pi 主题是「叠加」还是「统一」？** | A-01 / A-02 | 叠加 → 六套 Codex 色板与 pi 主题并存（**推荐**）；统一 → 与 `delta.md` 产品定位冲突 |
| **D2** | **`zoom` 缩放要不要做？** | A-03 | 若 spike 发现 5 个风险点不可控 → **降级为"只调字号/控件高度"**，不做 zoom |
| **D3** | **过程分组是「并行路径」还是「替换」？** | C-01-b | 并行（feature flag，**强烈推荐**）：`ChatWindow` 2,122 行，直接替换风险过高 |
| **D4** | **工作区标签栏做不做？** | B-03 | 本仓库主区已有终端/浏览器 `TabBar`，两层标签语义会打架 → 建议降级为"工作区切换器下拉增强" |
| **D5** | **壁纸做不做？** | A-04 | 会让侧栏/面板变玻璃层，牵动 6 套色板对比度；**纯口味项，可延后或不做的** |

---

## 13. 明确不做的清单

| 不做 | 理由 |
| --- | --- |
| 用 desktop 的 `SessionSidebar.tsx`（2,969）替换本仓库的（2,168） | 功能集不重合；本仓库有 worktree 分组 / 项目身份 / 虚拟列表。只摘 §5.6 |
| 用 desktop 的 `ChatInput.tsx`（3,580）替换本仓库的（2,852） | 本仓库已接 tool preset / 模型选择 / 扩展 widget / composer context。只摘 §5.2 / §5.3 |
| 用 desktop 的 `MessageView.tsx`（1,704）替换本仓库的（1,883） | 本仓库多 quoted selection / restore / search / token-estimate。ProcessGroup 用**新增路径** |
| 用 desktop 的三栏壳替换本仓库四栏布局 | 本仓库的 `[会话][聊天][文档][文件树]` + 容器查询闸门是自研资产（`delta.md` §11–§17） |
| 把六套 Codex 色板收敛成"一套 token 两模式" | 与 `delta.md` 产品定位直接冲突 |
| 引入 `@lobehub/icons` / `@phosphor-icons/react` 替换现有图标 | 本仓库自建 sprite 已覆盖同样的 provider 面，少两个依赖；且替换面覆盖每个组件 |
| 整文件替换 `lib/rpc-manager.ts` | 会丢 `withSessionReplacement` / `clone` / `fork_branch` 与 liveness 保护 |
| `lib/session-cache.ts` / `session-list.ts` | 本仓库 `session-list-scanner.ts`（330 行 + bench）更强 |
| `lib/format-relative-time.ts` | 本仓库已有 `lib/i18n/format.ts:formatRelativeTime`（带 locale） |
| `components/ToolsPanel.tsx` | 本仓库已有 `ToolDefinitionsPanel.tsx` |
| `@fontsource/ia-writer-quattro`（正文字体换成衬线感） | 会改 Codex 皮肤的产品气质；只建议自托管等宽字体 |
| Electron 打包相关（`electron/`、`scripts/build-release.mjs`） | 已在既有计划 PR-01～PR-11 覆盖 |

---

## 14. 立刻可做的三件事

如果只想先动起来：

1. **C-01-a + C-04**（`step-categorizer` / `process-content` 纯逻辑 + `stream-update-scheduler`）
   —— **零 UI 风险、零依赖、带测试一起搬**，是"先把最值钱的地基搬过来"。
2. **B-01 + B-02**（ContextMenu + 右栏空态）
   —— 一个能净减 `AppShell` 250 行，一个只要 80 行，都是**当天可完成**的量级。
3. **B-04**（欢迎大厅）
   —— 新会话空态从"空白"变成有内容，是**用户第一眼就看到**的改善。

**然后**按 M2 单独开一个窗口做 **A-01（主题引擎）**——它是收益最大、也最容易翻车的一项，
需要完整的 `audit-tokens` / `verify-themes` / `capture-themes` 验证链，不要和别的皮肤 PR 混在一起。
