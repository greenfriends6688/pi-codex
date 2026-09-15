# 视觉规格（暖色 oklch + 玻璃层）

本文件是皮肤细节精修的**唯一依据**：所有色板、玻璃层、圆角、排版刻度、层级都必须先在
这里定下，再落到 `app/globals.css` / `app/settings.css`。

约束：本次**只改 CSS 文件**（不改 `.tsx`）。因此凡是组件用内联样式写死的属性
（圆角、阴影、动效时长、焦点环、尺寸），统一由 `globals.css` 末尾的
`!important` 覆盖层收敛，见「覆盖层与代价」。

参考对象：`openchamber`（`packages/ui/src/styles/design-system.css`、`typography.css`）。
借鉴的是它的**视觉语言纪律**，不是它的组件结构：
暖色 oklch 中性面、玻璃浮层、语义化排版刻度、单一焦点环策略。

---

## 1. 色板规则

6 套主题（`light` / `dark` / `mist` / `rose` / `pine` / `auto`，`auto` 解析为明暗两套）共享同一套
中性面规则，**只有强调色色相与中性色的极淡偏色不同**。

| 规则 | 取值 |
|---|---|
| 浅色中性面基准色相 | `80`（暖沙） |
| 深色中性面基准色相 | `60`（暖褐黑） |
| 浅色面 chroma | `0.003 – 0.008`（温暖可感知，但不显色） |
| 深色面 chroma | `0.008` 固定 |
| 交互层（hover/selected/border） | 用带暖色相的 `oklch(L C H / α)`，不用中性灰 |
| 前景三级 | `--text` 满值 / `-muted` = 72% / `-dim` = 52%（同一色相与亮度） |
| 实心主操作 | `--primary-bg` 取该主题的墨色（浅色=近黑暖，深色=近白暖），全主题单色，不用强调色 |

### 各主题关键值（`verify-themes.mjs` 断言这 4 个值）

| theme | 色系 | `--bg` | `--text` | `--accent` | `--primary-bg` |
|---|---|---|---|---|---|
| light | 暖白 + 蓝 | `oklch(0.995 0.004 85)` | `oklch(0.26 0.015 55)` | `oklch(0.66 0.16 250)` | `oklch(0.26 0.015 55)` |
| dark | 暖褐黑 + 淡蓝 | `oklch(0.22 0.008 60)` | `oklch(0.94 0.01 85)` | `oklch(0.84 0.08 245)` | `oklch(0.94 0.01 85)` |
| mist | 暖白 + 青绿 | `oklch(0.985 0.005 165)` | `oklch(0.27 0.02 165)` | `oklch(0.46 0.07 178)` | `oklch(0.27 0.02 165)` |
| rose | 暖白 + 玫瑰 | `oklch(0.987 0.005 20)` | `oklch(0.28 0.015 12)` | `oklch(0.47 0.10 5)` | `oklch(0.28 0.015 12)` |
| pine | 暖褐黑 + 淡绿 | `oklch(0.22 0.008 155)` | `oklch(0.94 0.012 155)` | `oklch(0.82 0.05 155)` | `oklch(0.94 0.012 155)` |

> 每套色板仍必须写全 `audit-tokens.mjs` 里的 **34 个 token**；漏写会从 `:root` 泄漏。
> 自定义属性不会被解析成 rgb，所以 `verify-themes.mjs` 的期望值就是这里的**原文串**。

### 状态色

危险 / 成功 / 警告三组沿用现有语义，只把 hex 换成 oklch 并统一 chroma 阶梯：
浅色主题 `L≈0.53–0.66`，深色主题 `L≈0.72–0.78`；`-soft` 变体一律是同色相 `α 0.11–0.18`。

---

## 2. 玻璃浮层

所有浮层共用一套玻璃规则，**只允许存在一个玻璃层**（玻璃叠玻璃会模糊到自身内容）。

| 层 | 选择器 | 命中什么 |
|---|---|---|
| popover | `.anim-popover` / `.anim-popover-down` | 全部下拉、菜单、模型选择、@/slash 面板 |
| dialog | `.anim-dialog` | 扩展请求弹窗（浮在聊天之上） |
| composer | `.chat-content div[style*="--radius-composer"]` | 聊天输入框 |

**全屏模态不进玻璃**：`config-panel-root.is-modal` / `settings-dialog-surface` 坐在 `--scrim` 上，
后面只有遮罩，模糊买不到任何效果、只多一次合成，所以它们保持不透明。
（原计划把模态也列入玻璃层，实施时按此判断排除。）

参数：`--glass-blur: 22px`（深色 26px）、`--glass-saturation: 1.24`（深色 1.16）、
`--glass-opacity: 52%`（popover 50% / tooltip 62%）。

降级必须同时提供：`@supports not (backdrop-filter: blur(1px))` → 回落到不透明 `--bg-elev`；
`@media (prefers-reduced-transparency: reduce)` → 关掉模糊并回落到不透明面。

---

## 3. 圆角与阴影

圆角尺度不变（`--corner-radius-scale: 1.25` 的 calc 体系，`md` 解析为 `calc(8px * 1.25)`），
本次只做两件事：把内联写死的数字圆角统一到刻度上；新增玻璃浮层用的 `--radius-2xl`。

阴影收敛为**四级阶梯**（内联只引用了 `--shadow-sm|md|lg|xl`，名字必须保留）：

| token | 用途 | 形态 |
|---|---|---|
| `--shadow-sm` | 贴边控件（composer、field） | 单层 1px 浅投影 + 描边 |
| `--shadow-md` | 下拉、菜单、chip | 描边 + 2 层 |
| `--shadow-lg` | 弹窗、抽屉 | 描边 + 3 层 |
| `--shadow-xl` | 浮层里的浮层 | 描边 + 4 层 |

`--elevation-stroke` 保留（被 sm–xl 引用）；**删除 `--elevation-prominent` 与 `--elevation-sidebar`**
（全仓未被引用，属于死 token）。

---

## 4. 排版刻度

新增语义字号（`globals.css` 裸 `:root`），取代散落的 `10/11/12/12.5/13/13.5/14/15/18/20/24px`：

| token | 值 | 用途 |
|---|---|---|
| `--text-2xs` | 10px | 徽章、极致元信息 |
| `--text-xs` | 11px | 时间戳、token 计数、辅助标签 |
| `--text-sm` | 12px | 次要 UI、菜单项 |
| `--text-md` | 13px | 主要 UI、聊天正文（= `--chat-content-font-size`） |
| `--text-lg` | 14px | 二级标题 |
| `--text-xl` | 15px | 面板/弹窗标题 |
| `--text-2xl` | 18px | 空态标题 |
| `--text-3xl` | 24px | 首屏标题 |

映射是 **1:1** 的：代码中出现的每个字号字面量都恰好对应一档（10/11/12/13/14/15/18/24）。
字重只用 400 / 500 / 600 / 650 四档；行高推荐 1.45（UI）、1.62（正文）。

---

## 5. 控件尺寸与层级

控件尺寸阶梯（内联写死的 22/24/26/28/30/32/34/36/44 收敛到）：

| token | 值 | 用途 |
|---|---|---|
| `--control-xs` | 22px | 消息动作行按钮 |
| `--control-sm` | 26px | 面板工具栏图标键 |
| `--control-md` | 28px | composer 控件、顶栏图标键 |
| `--control-lg` | 32px | 主操作按钮、Tab |
| `--control-xl` | 36px | 侧栏主导航行 |
| `--control-touch` | 44px | 触摸端最小目标 |

z-index 阶梯（当前存在 1→1100 共 22 个散值）：

| token | 值 | 用途 |
|---|---|---|
| `--z-base` | 0 | 常规内容 |
| `--z-raised` | 10 | 卡片内悬浮 |
| `--z-sticky` | 40 | 吸顶/吸底条 |
| `--z-panel` | 100 | 面板内浮层 |
| `--z-popover` | 500 | 全局下拉/菜单 |
| `--z-drawer` | 250 | 移动端抽屉与副工作区 |
| `--z-modal` | 1000 | 设置与配置弹窗 |
| `--z-toast` | 1100 | 通知条 |

> 内联 z-index 无法被 CSS 覆盖，本阶梯只用于**新写的规则**与覆盖层里能用类名命中的层
> （`.anim-popover*` → `--z-popover`、`.config-panel-root.is-modal` → `--z-modal`）。

---

## 6. 焦点与 hover 约定

- **焦点**：`button` / `a` / `[role="button"]` / `[tabindex]` 的 `:focus-visible` 一律
  `outline: 2px solid var(--accent)` + `outline-offset: 2px`，用 `!important` 压掉 21 处
  内联 `outline: "none"`。只允许 `.focus-ring-inset` 这类显式例外。
- **hover**：新写的 hover 规则**必须**包在 `@media (hover: hover)` 里，并且与 `:focus-visible`
  成对书写，保证键盘用户拿到同样的提示。
- **已知限制**：组件里的 `onMouseEnter/Leave` 会直接写内联样式（CSS 无法撤销），
  触摸端点击后可能残留 hover 态。彻底修需要改 `.tsx`，本次范围外，记录于此。

---

## 7. 覆盖层与代价

`globals.css` 末尾新增一层「皮肤覆盖层」，只做一件事：把内联写死的
圆角 / 阴影 / 动效时长 / 焦点环 / 层级，用 `!important` 收敛到上面的刻度。

```css
/* ponytail: 覆盖层用 !important 压内联样式，天花板是内联优先级不可撤销。
   等允许改 .tsx 时，把这层删掉、在内联处直接写 token。 */
```

判定规则：**新样式不写 `!important`**；只有与内联样式冲突的属性才允许用，且在注释里说明原因。

---

## 8. 验收

```bash
node_modules/.bin/tsc --noEmit          # 仅 CSS 改动，应无变化
npm run lint
npm test
node docs/codex-skin/audit-tokens.mjs   # 34 token × 6 套 + 括号配平
npm run dev                             # 另开终端
node docs/codex-skin/verify-themes.mjs  # 期望值须与第 1 节表格一致
```

改完主题/浮层后需重拍 `skin-v0.9.1-{dark,light,mist,pine,rose}.png` 与
`skin-v0.9.1-settings-themes.png`，并把变更登记进 `docs/codex-skin/delta.md`。
