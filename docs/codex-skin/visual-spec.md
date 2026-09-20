# 视觉规格（Zeno 中性灰 + 平面材质）

本文件是皮肤的精修**唯一依据**：所有色板、材质、圆角、排版刻度、层级都必须先在这里
定下，再落到 `app/globals.css` / `app/settings.css` / `app/fork-ui.css`。

> **fork:zn-11（2026-09-19）**：本节由「暖色 oklch + 玻璃层」改为 **Zeno 中性灰 +
> 平面材质**。改动的理由、逐项对比与迁移清单见
> 本地文档 `docs/zeno-comparison-2026-09-19.md`（规划/对比类文档按本仓惯例不入仓）；本文件只写
> **现状**，因为它才是落代码时的依据。三处必须同步：本文件、`app/globals.css`、
> `docs/codex-skin/verify-themes.mjs`。

约束：改动以 CSS 为主。组件里内联写死的值（圆角、尺寸、层级）由 `app/fork-ui.css`
与 `globals.css` 末尾的覆盖层收敛；确需改 `.tsx` 时带 `// fork:zn-xx` 标记。

> **fork:boardui（2026-09-20，PR-02）**：颜色层已交给 **BoardUI 语义 token**。
> `app/globals.css` 末尾的 `fork:boardui-bridge` 把 `--bg` / `--text*` / `--border*` /
> `--accent*` / `--primary-*` / 状态色全部指向 `--color-*`（定义在
> `app/boardui/theme.css`），所以六套 palette 的颜色槽位收敛为 BoardUI 的亮/暗
> 两组值：light / mist / rose 同亮色，dark / pine 同暗色。版式（圆角、阴影、排版
> 刻度）仍是 Zeno 的，组件结构在后续 PR 逐个换成 BoardUI。
> `docs/codex-skin/verify-themes.mjs` 的期望值已同步。

参考对象：`参考项目/zeno-main`（`apps/desktop/src/renderer/styles.css`）。

---

## 1. 色板规则

6 套主题（`light` / `dark` / `mist` / `rose` / `pine` / `auto`，`auto` 解析为明暗两套）
共享同一套**中性面阶梯**。

核心变化（fork:zn-11）：

| 项 | 旧（Codex 暖色） | 现（Zeno） |
|---|---|---|
| 深色中性面 | 暖褐黑 `oklch(0.22 0.008 60)` | 纯中性 `#191919` |
| 前景 | 暖白 `oklch(0.94 0.01 85)` | 近纯白 `oklch(0.985 0.004 260)` |
| 交互层（hover / 选中 / 边框） | 暖白 alpha（0.06 / 0.1 / 0.09） | **实色** `#383838` / `#3f3f3f` / `#3c3c3c` |
| 次要文字 | 前景 alpha 0.72 / 0.56 | **实色灰** `#a9abb0` / `#83858a` |
| 代码底 | 比画布更亮（原等于 `--tool-bg`） | **比画布更暗** `#0f0f0f` |
| 浅色主题 | 纯白 + 近白侧栏 `oklch(0.98 0 0)` | 纯白 + 冷灰侧栏 `#f1f2f4` |

为什么把 alpha 改成实色：alpha 叠加在「画布 / 侧栏 / 浮层」三种底上会各算出一个
不同的灰，同一个「6% hover」在三处看起来是三种颜色；Zeno 一种意图一个灰值。

### 深色阶梯（`html.dark, [data-theme="dark"]`）

| 用途 | token | 值 |
|---|---|---|
| 画布 | `--bg` | `#191919` |
| 侧栏 / 面板底 | `--bg-panel` | `#151515` |
| 浮层 / 卡片 | `--bg-elev` | `#2d2d2d` |
| hover | `--bg-hover` | `#383838` |
| 选中 | `--bg-selected` | `#3f3f3f` |
| 极淡底 | `--bg-subtle` | `#242424` |
| 用户气泡 | `--user-bg` | `#272727` |
| 输入卡 | `--bg-composer` | `#2b2b2b` |
| 输入卡上方条 | `--composer-protrusion` | `#1f1f1f` |
| 工具面 | `--tool-bg` | `#242424` |
| 代码底 | `--code-bg` | `#0f0f0f` |
| 边框 | `--border` / `--border-strong` | `#3c3c3c` / `#4a4a4a` |
| 正文 / 次要 / 淡 | `--text` / `-muted` / `-dim` | `oklch(0.985 0.004 260)` / `#a9abb0` / `#83858a` |
| 主操作 | `--primary-bg` / `--primary-fg` | `oklch(0.985 0.004 260)` / `#191919` |

### 浅色阶梯（`:root, [data-theme="light"]`）

| 用途 | token | 值 |
|---|---|---|
| 画布 / 浮层 | `--bg` / `--bg-elev` | `#ffffff` |
| 侧栏 / 面板底 | `--bg-panel` | `#f1f2f4` |
| hover / 选中 | `--bg-hover` / `--bg-selected` | `#f6f6f6` / `#eceef1` |
| 用户气泡 | `--user-bg` | `#f5f5f5` |
| 输入卡 | `--bg-composer` | `#ffffff` |
| 代码底 | `--code-bg` | `#f1f2f4` |
| 边框 | `--border` / `--border-strong` | `#d7d9e0` / `#b8bac2` |
| 正文 / 次要 / 淡 | `--text` / `-muted` / `-dim` | `#171717` / `#5f6167` / `#7b7d84` |
| 主操作 | `--primary-bg` / `--primary-fg` | `#171717` / `#fafafa` |

### 各主题关键值（`verify-themes.mjs` 断言这 4 个值）

比较走**实际像素**（canvas 取色），所以 hex / oklch 两种写法都能通过。

| theme | 色系 | `--bg` | `--text` | `--accent` | `--primary-bg` |
|---|---|---|---|---|---|
| light | 纯白 + 蓝 | `#ffffff` | `#171717` | `oklch(0.61 0.16 250)` | `#171717` |
| dark | 中性石墨 + 淡蓝 | `#191919` | `oklch(0.985 0.004 260)` | `oklch(0.78 0.12 253)` | `oklch(0.985 0.004 260)` |
| mist | 暖白 + 青绿 | `oklch(0.985 0.005 165)` | `oklch(0.27 0.02 165)` | `oklch(0.46 0.07 178)` | `oklch(0.27 0.02 165)` |
| rose | 暖白 + 玫瑰 | `oklch(0.987 0.005 20)` | `oklch(0.28 0.015 12)` | `oklch(0.47 0.1 5)` | `oklch(0.28 0.015 12)` |
| pine | 深绿灰 + 淡绿 | `oklch(0.22 0.008 155)` | `oklch(0.95 0.012 155)` | `oklch(0.82 0.05 155)` | `oklch(0.94 0.012 155)` |

> 每套色板仍必须写全 `audit-tokens.mjs` 里的 **34 个 token**；漏写会从 `:root` 泄漏。
> mist / rose / pine 保留各自色相，但交互层同样是实色（不再用 alpha）。

### 状态色

危险 / 成功 / 警告三组沿用现有语义；`-soft` 变体一律是同色相低 alpha。
`--danger-contrast` / `--success-contrast` 决定实心底上的文字色（浅色主题用白字，
深色主题用深字）。

---

## 2. 材质：平面，不玻璃

| 项 | 规则 |
|---|---|
| 玻璃 | **只保留壁纸层**（`app/wallpaper.css`）。弹层 / 菜单 / 对话框**不进玻璃**：它们坐实色 `--bg-elev` + 发丝边框。 |
| 输入卡 | `--bg-composer` + `--composer-border`，**无阴影**；焦点只给 3px `--focus-ring`。 |
| 输入卡上方条 | 独立面 `--composer-protrusion`，只留上圆角、无下边框；同时把卡片上圆角压平（`fork:zn-04` 焊接成 Zeno 的「两段式」）。 |
| 弹层 | 发丝描边 + 单层柔黑阴影（`--shadow-md`）。 |
| 代码块 | `--code-bg` 比画布更暗，让代码后退而不是浮起。 |

焊接的实现要点：条与卡片必须是**相邻兄弟**，中间不能有横幅。模型告警横幅因此排在
条的上方（横幅是瞬时告警，条是结构），由 `ChatInput` 的 `protrusion` 插槽保证顺序。

---

## 3. 圆角与阴影

fork:zn-11 用 **Zeno 三档圆角**取代 Codex 的 `×1.25` calc 尺度：

| token | 值 | 用途 |
|---|---|---|
| `--radius-xs` | 4px | 小 chip、内嵌格 |
| `--radius-sm` | 6px | 列表行、图标键 |
| `--radius-md` | 10px | 控件、卡片、输入卡上方条 |
| `--radius-lg` | 12px | 面板、弹窗、输入卡 |
| `--radius-xl` | 12px | 与面板对齐 |
| `--radius-2xl` | 14px | 大面 |
| `--radius-composer` | `var(--radius-lg)` = 12px | 输入卡（旧值 22px，那是 Codex 的胶囊输入框） |

阴影收敛为四级，但**第一级只是发丝线**（这正是「平面」的来源）：

| token | 形态 |
|---|---|
| `--shadow-sm` | 仅 `--elevation-stroke`（无投影） |
| `--shadow-md` | 发丝 + `0 6px 18px rgb(0 0 0 / .16)` |
| `--shadow-lg` | 发丝 + `0 14px 38px rgb(0 0 0 / .22)` |
| `--shadow-xl` | 发丝 + `0 24px 56px rgb(0 0 0 / .28)` |

`--elevation-stroke` 保留（被 sm–xl 引用）。

---

## 4. 排版刻度

字号阶定义在 `globals.css` 裸 `:root`；**`md` 从 13px 提到 14px**（Zeno 的 `--ui-font-size`）：

| token | 值 | 用途 |
|---|---|---|
| `--text-2xs` | 10px | 徽章、极致元信息 |
| `--text-xs` | 11px | 时间戳、token 计数、辅助标签 |
| `--text-sm` | 12px | 次要 UI、菜单脚注 |
| `--text-md` | **14px** | 主要 UI、侧栏行、设置行、聊天正文 |
| `--text-lg` | 15px | 分区标题 |
| `--text-xl` | 16px | 面板 / 弹窗标题 |
| `--text-2xl` | 18px | 品牌字、空态变体 |
| `--text-3xl` | 24px | 首屏标题 |

`--chat-content-font-size` 默认 **14px**（旧 13px），用户仍可在 设置 → 通用 里调。
改这个默认值必须同步 `hooks/useChatAppearance.ts` 的 `CHAT_CONTENT_FONT_SIZE_DEFAULT`
与 `e2e/chat-appearance.mjs` 里的断言。

分区 / 分组标签：`--group-label-size: var(--text-md)` + `--group-label-weight: 500`，
颜色走 `--text-dim` —— **不用更小的字号做层级**（与 Zeno 一致）。

字重只用 400 / 500 / 600 / 650；行高 1.45（UI）、1.62（正文）。

Zeno 侧长的元素名（会话标题）用**末端渐隐**（`.fork-fade-title` 的 mask）而不是省略号；
内联的 ellipsis 保留作为 mask 不支持时的回退。

---

## 5. 控件尺寸与层级

控件尺寸阶梯（`--control-xs` … `--control-touch`）不变：22 / 26 / 28 / 32 / 36 / 44。
新增/使用的 Zeno 度量别名见 `fork-ui.css` 的 `fork:zn-01`：
`--zn-row: 32px`、`--zn-radius-row: 6px`、`--zn-brand: 18px`、`--zn-thread: 760px`、
`--zn-send: 28px`、`--zn-header-title: 13px`、`--zn-hero-title: 26px`。

发送键 28px（`--zn-send`）；侧栏行 32px 通栏（无内缩胶囊、无行间隙）。

z-index 阶梯（`--z-base` … `--z-toast`）不变：0 / 10 / 40 / 100 / 500 / 250 / 1000 / 1100。

---

## 6. 焦点与 hover 约定

- **焦点**：`button` / `a` / `[role="button"]` / `[tabindex]` 的 `:focus-visible` 一律
  `outline: 2px solid var(--accent)` + `outline-offset: 2px`；输入卡用 `:focus-within`
  的 3px `--focus-ring`。
- **hover**：新写的 hover 规则**必须**包在 `@media (hover: hover)` 里，并与
  `:focus-visible` 或 `:focus-within` 成对书写。
- **触屏**：没有 hover 可依赖，所以「hover 才显」的元素在触屏必须常显。
  先例：`.fork-msg-actions`（消息操作行）、`.fork-section-actions`（分区动作组）都在
  `@media (hover: hover)` 里隐藏，触屏保持可见。
- **已知限制**：组件的 `onMouseEnter/Leave` 直接写内联样式（CSS 无法撤销），
  触摸端点击后可能残留 hover 态。彻底修需要改 `.tsx`，属于范围外。

---

## 7. fork 覆盖层（`app/fork-ui.css`）

所有 fork 覆盖写在 `app/fork-ui.css`，每条带 `/* fork:zn-xx */` 与来源说明，
选择器优先用 `.fork-*` 类名或 `:where()`。

两条纪律：

1. **只有打到内联样式的属性才用 `!important`**，并在注释里说明原因。
2. **注意特异性**。`globals.css` 里已存在带 `!important` 的规则（例如聊天气泡节奏
   `.chat-content [data-entry-id] > div` 是 0-2-1），fork 覆盖必须用够特异性或同样
   `!important`，否则会**静默失效**。`fork:zn-07` 踩过一次：0-2-0 的
   `.chat-content [data-message-role="assistant"]` 被 0-2-1 压掉，26px 从未生效。
   修法是补上 `[data-entry-id]`（0-3-0）赢得同级 `!important` 的比较。

---

## 8. 验收

```bash
node_modules/.bin/tsc --noEmit          # 仅 CSS/样式改动，应无变化
npm run lint
npm test
node docs/codex-skin/audit-tokens.mjs   # 34 token × 6 套 + 括号配平 + token 定义齐全
npm run dev                             # 另开终端
node docs/codex-skin/verify-themes.mjs  # 5 套调色板（像素比较）+ 三档圆角
```

改完主题 / 材质后需重拍截图基线，并把变更登记进 `docs/codex-skin/delta.md`。

Zeno 侧对照文件：`参考项目/zeno-main/apps/desktop/src/renderer/styles.css`
（`:root` 与 `[data-theme]` 块 40–300 行）、`components/Composer.tsx`、
`components/AppSidebar.tsx`、`components/TimelineRow.tsx`、`components/ThreadHeader.tsx`。
