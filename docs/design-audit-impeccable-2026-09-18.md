# pi-web-0.9.0 设计审查（impeccable 实测 + 手工核验）

日期：2026-09-18
工具：`impeccable`（`detect` 实测）；本机 npx 缓存里同时存在 **2.3.2** 与 **4.1.0** 两个版本，两者 `detect` 输出结构一致
范围：`app/`、`components/`、`hooks/`、`lib/`（排除 `pi参考项目/`、`node_modules/`、`.next/`）
模式判定：**Operate**（应用内 UI，用户来完成任务；可扫描性、一致性、原生预期优先于表现力）

> **版本说明（复现时请显式写版本）**：
> `npx --yes impeccable --version` → **2.3.2**（`~/.npm/_npx/1a4eb60c8f6b0f89`，本次 `detect` 与首次 `skills install` 命中的就是它）；
> `npx --yes impeccable@latest --version` → **4.1.0**（`~/.npm/_npx/e555c4d541bb0b6f/…`）。
> 两者的 `detect` 规则集与本报告结论一致；差别只在 `skills install` 的下载实现对重定向的处理（见 §0.1）。

> 本文只写**核验过**的问题。每条都有 `file:line` 或可复现的测量命令。
> 配套：`docs/proma-feature-matrix-2026-09-18.md`（全量功能对比）、`docs/proma-prs-2026-09-18.md`（PR 拆分）。

---

## 0. 先说工具本身的结论（两条，都必须如实说）

### 0.1 `skills install` 的行为按版本分裂：2.3.2 失败、4.1.0 成功（但装到**家目录**）

复现（在临时目录，不污染仓库）：

```bash
cd /tmp/imp-skill && yes | npx --yes impeccable skills install
# Target harness folder(s): .claude, .agents, .cursor, .gemini, .opencode, .qoder
# Install impeccable skills into 6 folder(s)? (Y/n)
# Downloading impeccable skills...
#   End-of-central-directory signature not found.  Either this file is not a zipfile...
# Download failed: Command failed: unzip -qo ".../impeccable-update-*.zip" -d ...
```

根因已定位到 URL 层，不是网络不通：

| 步骤 | 结果 |
| --- | --- |
| CLI 请求的地址（`cli/bin/commands/skills.mjs:117`） | `https://impeccable.style/api/download/bundle/universal` |
| 该地址响应 | `HTTP/2 302` → `location: https://github.com/pbakaus/impeccable/releases/download/skill-v4.3.1/universal.zip` |
| CLI 行为 | 未跟随重定向，把 302 的响应体（空/HTML）写成 `.zip`，`unzip` 因“不是 zip”失败 |
| 手工跟随重定向 | `curl -sSL <location>` → `http=200 size=15625571`，是正常 zip |

**但用 4.1.0 重试就成功了**，差别只在下载实现：

| 版本 | 下载实现 | 结果 |
| --- | --- | --- |
| 2.3.2 | 无 `redirect` 处理 | 把 302 当正文写成 `.zip` → `unzip` 失败 |
| 4.1.0 | `cli/bin/cli.js:33` `fetch(URL, { redirect: 'follow' })` | 正常拿到 15.6MB zip 并安装 |

**结论**：`skills install` 需要 `@latest`（4.1.0）；2.3.2 在本机 npx 缓存里是坏的那一份。

### 0.1.1 ⚠️ 我执行 4.1.0 安装时产生的副作用（需要你决定是否清理）

`npx impeccable@4.1.0 skills install` 会**按已安装的 harness 推断目标**，且这里的目标是**家目录**，不是本项目：

```
Installed Claude Code agents into: ~/.claude/agents
Installed Cursor agents into: ~/.cursor/agents
Updated 6 skill(s) to v4.3.1.
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.claude/skills/impeccable/scripts/bin/darwin-arm64/impeccable
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.agents/skills/impeccable/...
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.cursor/skills/impeccable/...
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.hermes/skills/impeccable/...
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.pi/agent/skills/impeccable/...
Installed impeccable engine v0.1.5 (darwin-arm64) into: ~/.qoder/skills/impeccable/...
Installed hooks into: .claude, .agents, .cursor
```

实际落盘（每个 14MB，合计约 **84MB**）：

| 路径 | 大小 | 影响面 |
| --- | --- | --- |
| `~/.claude/skills/impeccable` | 14M | Claude Code 多一个 skill |
| `~/.agents/skills/impeccable` | 14M | 通用 agents 目录 |
| `~/.cursor/skills/impeccable` | 14M | Cursor 多一个 skill |
| `~/.hermes/skills/impeccable` | 14M | Hermes harness |
| **`~/.pi/agent/skills/impeccable`** | 14M | **pi CLI 会看到这个 skill**（行为变化最需要注意） |
| `~/.qoder/skills/impeccable` | 14M | Qoder harness |
| `~/.claude/agents/`、`~/.cursor/agents/` | 4 个 .md，约 33KB | 新增 `impeccable-*.md`，**原有 agents 文件未被改动**（对比 `ls -la` 时间戳：旧文件仍是 2026-01-30） |
| `/tmp/imp-skill2/.claude|.codex|.cursor` | 少量 hooks | 临时目录，可删 |

**回滚方式**（等你确认后我再执行，或你自己跑）：

```bash
# 只删 skill（保留原有 agents 文件）
rm -rf ~/.claude/skills/impeccable ~/.agents/skills/impeccable ~/.cursor/skills/impeccable \
       ~/.hermes/skills/impeccable ~/.pi/agent/skills/impeccable ~/.qoder/skills/impeccable
# 删它新增的 agent 定义（按文件名精确删，不要删目录）
rm -f ~/.claude/agents/impeccable-*.md ~/.cursor/agents/impeccable-*.md
rm -rf /tmp/imp-skill /tmp/imp-skill2
```

**我的建议与已执行结果**：保留 `~/.pi/agent/skills/impeccable`（pi CLI 里 `/audit`、`/polish`、`/optimize` 等 25 个命令可直接用），已按你确认删掉其余 5 份重复（约 70MB）：

```bash
# 已执行（2026-09-18 15:1x）
rm -rf ~/.claude/skills/impeccable ~/.agents/skills/impeccable ~/.cursor/skills/impeccable \
       ~/.hermes/skills/impeccable ~/.qoder/skills/impeccable
rm -f ~/.claude/agents/impeccable-*.md ~/.cursor/agents/impeccable-*.md
rm -rf /tmp/imp-skill /tmp/imp-skill2
```

结果：5 个 skill 目录已删；`~/.claude/agents/` 与 `~/.cursor/agents/` 的原有 agent 定义（`bug-analyzer`、`code-reviewer`、`dev-planner` 等）**未被改动**；`~/.pi/agent/skills/impeccable` 保留（14M）。
另注：安装时输出的 `Installed hooks into: .claude, .agents, .cursor` 写的是**临时目录**（`/tmp/imp-skill2`）里的 husk，家目录配置未被改（已核对 15:00 后变动的文件清单）。

### 0.2 我不想把 25 个 skill 文件写进这个仓库——需要你确认

`skills install` 支持的目标目录是 `.claude / .cursor / .gemini / .agents / .github / .kiro / .opencode / .pi / .qoder / .trae / .trae-cn`。本项目当前**没有任何 harness 目录**，CLI 会推断出 6 个并全部写入（每个 harness 一份，含 `live-browser.js` 522KB + `font-index.json` 1.1MB，全量约 15MB）。

这与仓库现有的上游合并纪律冲突：`docs/upstream-merge-policy.md` 要求“新增能力放 fork-only 新文件”，而 15MB 的第三方 agent 文件与产品代码混在一起后，`--list=slugs` 与 leak 统计都会变噪声。

**建议**：如果要装，只装一个 harness 目录（例如 `.pi/skills/impeccable/`），并加进 `.gitignore`；不要 6 个一起装。等你确认后我再执行。

### 0.3 `detect` 能跑，但它的 regex 引擎在本项目水土不服（误报率 61~70%）

```bash
npx --yes impeccable detect app components hooks lib --json
# → 27 findings / 5 rules，exit=2
```

27 条里 **19 条是误报**（下文逐条给证据）。原因：`detect` 对非 HTML 文件走纯正则，把**注释、模板字符串、文档文本**都当成 UI 代码。真正需要看的只有 5 类中的 2 类（`layout-transition`、`side-tab`）。

所以本文的价值不来自 `detect` 的输出，而来自**按 skill 的 audit rubric 手工核验**（a11y / performance / theming / responsive / implementation integrity 五维 + `craft-floor` 清单）。

---

## 1. Audit Health Score

| # | 维度 | 分数 | 关键发现 |
| --- | --- | --- | --- |
| 1 | Accessibility | **2** | 浅色三主题下 `--text-dim` 仅 ~3.2:1（49 处当文字色用）；`--accent` 在 `--bg-panel` 上 2.93:1；自定义弹层无 `role="dialog"` / 无焦点约束 |
| 2 | Performance | **2** | Markdown 每条消息逐 delta 全量重解析（另见优化文档 §1）；`transition: width` 动主布局与进度条；`will-change` 一次挂 5 个属性且常驻 |
| 3 | Theming | **2** | 247 个 token + oklch 调色板很完整，但被 **391 处内联 `fontSize` 数字**与 55 处硬编码 hex 绕过；`var(--control-*)` 只用了 10 次 |
| 4 | Responsive | **2** | `--control-touch: 44px` 定义了但**从未使用**；控件梯度最高 36px；移动端只有 7 条媒体查询 |
| 5 | Implementation Integrity | **3** | 系统是连贯且产品专属的（Codex 皮肤 / visual-spec.md / token 梯度）；漂移集中在 tsx 内联字面量 |
| **总分** | | **11/20** | **Acceptable（需要实质性工作）** |

评级带：18-20 Excellent、14-17 Good、10-13 Acceptable、6-9 Poor、0-5 Critical。

**Implementation Integrity 判定：通过。** 这个项目有真实的设计系统（`docs/codex-skin/visual-spec.md` + `delta.md` 记录了每条规则的取舍），token 不是装饰：`--radius-*` 被引用 265 次、`var(--token)` 全仓 2631 次、5 套主题用 oklch 且有 `verify-themes.mjs` 渲染回归。问题不是“拼装感”，而是**系统被内联字面量绕开**。

---

## 2. P0 / P1 级问题（先修这些）

### [P1] A11y-1 · 浅色主题下 `--text-dim` 与 `--accent` 对比度不达 WCAG AA

- **位置**：`app/globals.css:144`（light）、`:223`（mist）、`:262`（rose）的 `--text-dim: oklch(0.2x 0 0 / 0.52)`；使用点 `app/settings.css` 49 处 `color: var(--text-dim)`
- **类别**：Accessibility（WCAG 1.4.3，AA 正文 4.5:1）
- **测量方式（两路互相印证）**：① 自写 oklch→sRGB→WCAG 相对亮度脚本；② 在运行中的 127.0.0.1:30141 上用 canvas 实际填充并读回像素、按 WCAG 公式计算（浏览器自身解析 oklch + alpha 合成）。两路结果一致，下表为**浏览器实测值**：

| 主题 | text on bg | text-muted on bg | **text-dim on bg** | **text-dim on bg-panel** | **accent on bg-panel** |
| --- | --- | --- | --- | --- | --- |
| light | 15.52 ✅ | 6.19 ✅ | **3.32 ⚠️ 只够大字/图形** | **3.25 ⚠️** | **2.93 ❌** |
| dark | 14.55 ✅ | 8.10 ✅ | 4.83 ✅ | 4.97 ✅ | 11.83 ✅ |
| mist | 14.28 ✅ | 5.87 ✅ | **3.23 ⚠️** | **3.14 ⚠️** | 6.03 ✅ |
| rose | 14.06 ✅ | 5.75 ✅ | **3.19 ⚠️** | **3.12 ⚠️** | 6.38 ✅ |
| pine | 14.54 ✅ | 8.03 ✅ | 4.81 ✅ | 4.94 ✅ | 11.15 ✅ |

- **影响**：浅色/雾色/玫瑰三主题下，所有用 `--text-dim` 的提示、时间戳、单位、次要标签（settings 页最集中，49 处）在 13px 以下渲染时低于 AA；light 主题的 accent 放在面板底上连 3:1（大字/图形门槛）都不到。深色两套主题均达标。
- **建议**：浅色三主题的 `--text-dim` alpha 从 `0.52` 提到约 `0.68`（可到 ~4.6:1）；`--accent` 在浅色主题下改用更深变体（`oklch(0.55 0.16 250)` 量级）或新增 `--accent-text` token 专供文字。深色主题不动。
- **建议命令**：`/impeccable colorize`（限定 token 层，不动组件）

### [P1] A11y-1b · 项目自带的 AA 对比度门禁既**未接入运行器**、在 oklch 下又**必然失败**

这条比上一条更值得优先处理：项目**已经写了**对比度断言，但它既没在跑，也跑不过。

* **位置**：`e2e/themes.mjs:17-30` 定义了 `contrast()`；`:60-63` 对 `text / text-muted / text-dim / accent` × `bg / bg-panel / bg-hover / bg-selected / user-bg / assistant-bg / tool-bg` 全部断言 `>= 4.5`，另外断言 accent-contrast 按钮对比度——覆盖面比我上面那张表更广。

* **问题 1：没有被任何运行器调用。**

  * `package.json` 的 e2e 相关脚本只有 `test:e2e = node e2e/run.mjs` 与 `test:terminal`；

  * `e2e/run.mjs:12-13` 只 `import` 了 `extension-dialog.mjs` 与 `chat-appearance.mjs`；

  * 全仓 `grep -rn "themes.mjs"` 只命中 `docs/codex-skin/verify-themes.mjs`（**另一个文件**）的文档引用；

  * `.github/workflows/ci.yml` 的 `e2e` job 跑的是 `npm run test:e2e`。 → `e2e/themes.mjs`**&#x20;是孤儿脚本**，CI 不会跑它。

* **问题 2：即使跑也会在第一条断言上失败。** `contrast()` 只支持 hex（`hex.length === 4` / `hex.slice(1)` / `parseInt(part, 16)`），而本项目主题 token 已是 oklch。浏览器实测确认 `getComputedStyle(html).getPropertyValue('--text-dim')` 返回的是 `oklch(26% 0 0/.52)` 而不是 rgb，于是：

```text
contrast('oklch(26% 0 0/.52)', 'oklch(100% 0 0)')  →  NaN
NaN >= 4.5                                          →  false   →  assert.ok 失败
```

* **实测证据**（在运行中的 127.0.0.1:30141 页面内直接执行）：

```json
{ "theme": "light", "dark": false,
  "tokens": { "text": "oklch(26% 0 0)", "text-dim": "oklch(26% 0 0/.52)", "bg": "oklch(100% 0 0)" },
  "e2eContrastResult": "NaN", "e2eWouldPass": false }
```

* **影响**：项目在文档里（`docs/desktop-ui-borrowing-plan-2026-09-16.md:717,830`）把 `verify-themes.mjs` / `audit-tokens.mjs` 当作必过门禁，但**唯一检验 WCAG 对比度的脚本不在链路里**，导致 A11y-1 这类回归无人拦。

* **建议**（三步，可一次做完）：

  1. `contrast()` 改用浏览器真实解析：`new Option().style.color = v` 取不到就用 canvas `fillStyle` + `getImageData` 读回 sRGB（已验证可用），或直接 `CSS.registerProperty`；

  2. 把 `themes.mjs` 接入 `e2e/run.mjs`（或 `package.json` 新增 `test:themes` 并加入 CI `e2e` job）；

  3. 阈值分级：正文类（`text`/`text-muted`）要 4.5，`text-dim` 若定位为辅助信息可降到 3:1，但必须在断言里写明例外范围，而不是现在这种“写了 4.5 却从没跑”。

* **建议命令**：`/impeccable harden`（门禁归位）

### \[P1] A11y-2 · 自定义弹层缺 `role="dialog"` 与焦点约束

* **位置**：有 dialog 语义的只有 5 个文件（`components/SettingsUi.tsx:39`、`DirectoryPicker.tsx:245`、`ChatWindow.tsx:1969`、`SettingsPanel.tsx:592`、`ProjectTrustDialog.tsx:40`）；而以下弹层是自绘 overlay、**无 role、无&#x20;**`aria-modal`**、无焦点陷阱**：`ModelsConfig.tsx:1729`、`SkillsConfig.tsx`、`AgentsConfig.tsx`、`PluginsConfig.tsx`、`ToolDefinitionsPanel.tsx`、`SystemPromptPanel.tsx`、`AgentSessionPanel.tsx`

* **证据**：`ModelsConfig.tsx:1729` 是 `position: fixed; inset: 0` 的 div，Escape 靠 `onKeyDown`（`:1731`）——只有焦点在该 div 内部才触发；全仓 `grep -rn "focus-trap\|useFocusTrap"` 零命中；即使已经声明了 `role="dialog" aria-modal="true"` 的 `SettingsPanel.tsx:591-593`，在组件内 `grep focus` 也是**零命中**（既无初始 focus，也无 Tab 循环，背景也没 `inert`——全仓 `inert` 仅 3 处且与设置弹层无关）。对照：Proma 的这层由 16 个 Radix 包承担（`apps/electron/package.json:85-100`）。

* **类别**：Accessibility（WCAG 2.4.3 焦点顺序、4.1.2 名称角色值）

* **影响**：键盘用户 Tab 可以走到弹层背后的侧栏/输入框；屏幕阅读器不会播报进入弹层；Esc 在焦点落到 body 时失效。

* **建议**：优先复用原生 `<dialog>` + `showModal()`（项目已在 `MermaidBlock.tsx:157` / `ImagePreview.tsx:31` 用过，天然带焦点约束与 Esc）；自绘 overlay 至少补 `role="dialog" aria-modal="true"` + 打开时把焦点移入 + `inert` 兄弟节点。

* **建议命令**：`/impeccable harden`

### \[P1] A11y-3 · 触控目标系统性偏小（移动端）

* **位置**：`app/globals.css:86-93` 控件梯度 `--control-xs 22px / sm 26px / md 28px / lg 32px / xl 36px`，`--control-touch: 44px` 定义于 `:93`，但 `grep -rn "control-touch" app components` **只命中定义本身**（0 处使用）

* **类别**：Responsive / Accessibility（WCAG 2.5.8 Target Size 最低 24px，移动端惯例 44px）

* **影响**：移动端 28px 的图标按钮低于所有平台指南；`useIsMobile`（`hooks/useIsMobile.ts:7`，`max-width: 640px`）已存在，说明有移动端场景，但没有对应的触控放大。

* **建议**：移动端媒体查询里把交互元素改为 `min-height: var(--control-touch)`（token 已存在）+ 命中区用伪元素外扩（项目已有 `.panel-resize-handle` 的外扩手法可参考）。

* **建议命令**：`/impeccable adapt`

### \[P1] Perf-1 · `transition: width` 动画主布局与进度条

* **位置**（`detect` 命中 6 处，逐条核验后 4 处成立、2 处误报）：

  * ✅ `app/globals.css:1973` `.sidebar-container { transition: width ..., min-width ... }` —— **主布局每帧重排**

  * ✅ `components/FileExplorer.tsx:913` 上传进度条 `transition: width 120ms ease`

  * ✅ `components/fork/TodoChip.tsx:106` 进度条 `transition: width var(--fork-motion-chip)`

  * ✅ `components/ChatMinimap.tsx:718` 同时写 `transition: width` 且已有 `transform: scaleX(...)`（同一元素两套机制）

  * ❌ `app/globals.css:2088` 命中在注释文字里（"The fork's old `transition: width` is dead here"），非规则

  * ⚠️ `app/globals.css:1421` `.mermaid-zoom-canvas { transition: width 0.15s }` —— 缩放画布，可接受但同样可换 transform

* **类别**：Performance（布局抖动）

* **影响**：侧栏折叠/展开时整页重排，与 Markdown 流式渲染同帧竞争；进度条同理。

* **建议**：侧栏改 `grid-template-columns` 过渡（项目已在 `.main-panels` 用这个手法，`globals.css:2092` 注释自认），进度条一律 `transform: scaleX()` + `transform-origin: left`，`ChatMinimap` 删掉多余的 `width` 过渡。

* **建议命令**：`/impeccable optimize`

### \[P1] Perf-2 · `will-change` 一次挂 5 个属性且常驻

* **位置**：`components/AppShell.tsx:2328` `.session-info-popover { will-change: transform, opacity, filter, background, box-shadow; }`

* **类别**：Performance

* **证据**：该 popover 的动画只有 `transform-origin` + `animation: session-info-pop 360ms`（`:2326`）；`background` / `box-shadow` 不在动画里，`will-change` 对它们无意义但会强制创建图层并常驻内存。

* **建议**：收缩为 `will-change: transform`，动画结束后移除（或用 `animation-fill-mode` + 伪类控制）；`filter`/`background`/`box-shadow` 从清单删掉。

* **建议命令**：`/impeccable animate`

***

## 3. P2 级问题

### \[P2] Theming-1 · 类型梯度被 391 处内联 `fontSize` 数字绕过

* **位置**：`app/globals.css:76-84` 定义了 `--text-2xs:10 / xs:11 / sm:12 / md:13 / lg:14 / xl:15 / 2xl:18 / 3xl:24`，注释明确写着“every font-size literal in the app maps to exactly one step”

* **测量**：

| 写法 | 次数 |
| --- | --- |
| `var(--text-*)` 引用 | 89 |
| `var(--text-2xs)` 引用 | **8** |
| components 内联 `fontSize: <数字>` | **391**（12→163、11→137、10→55、13→31…） |
| 其中**不在梯度上**的值 | 12.5、11.5、13.5、9、15、20、18 等 |

* **类别**：Theming / Implementation Integrity（设计系统漂移）

* **影响**：改字号梯度不会传播到组件；出现 9px / 12.5px / 13.5px 这类梯度外值；`--text-2xs` 几乎成死 token。

* **建议**：新增 `lib/typography.ts` 导出 `TEXT = { xs: "var(--text-xs)", ... }`，增量替换内联数字；同时把两个梯度外值归并（9→`--text-2xs`、12.5/13.5→`--text-sm`/`--text-md`）。

* **建议命令**：`/impeccable typeset`

### \[P2] Theming-2 · 控件梯度被内联字面量镜像而非引用

* **位置**：`app/globals.css:86-93` 的 control 梯度；`var(--control-*)` 全仓**只被引用 10 次**，而内联 `height:` 数字分布为 28×30、30×15、22×13、36×10、32×10、24×8、26×7…——**数值正好等于梯度值，但写成了字面量**

* **类别**：Theming（同上，但影响更大的交互一致性）

* **影响**：控件大小改动无法一处生效；出现 30px、14px、13px 等渐变外高度。

* **建议**：与 Theming-1 同一 PR 处理，导出 `CONTROL = { xs/sm/md/lg/xl }`。

* **建议命令**：`/impeccable polish`

### \[P2] Theming-3 · 硬编码颜色仍散落在组件里

* **位置**：tsx 内 `#hex` 共 55 处 — `TerminalPanel.tsx`（20）、`ModelsConfig.tsx`（12）、`MessageView.tsx`（6）、`ChatInput.tsx`（4）；`rgba()` 42 处，含 `ModelsConfig.tsx:1729` 的遮罩 `rgba(0,0,0,0.4)`

* **类别**：Theming

* **核验**：`TerminalPanel` 的 hex 是**有意的**——`globals.css:50-58` 注释说明 xterm 调色板在 JS 里构造、且 `--terminal-surface` 必须与该 JS 的 background 严格相等；这部分不算缺陷。真正可改的是 `ModelsConfig` 的 12 处（弹层遮罩/边框/状态色）与 `MessageView`/`ChatInput` 的少数。

* **建议**：遮罩改为 token（如 `--scrim`）；`TerminalPanel` 保留但把 6 个 `--terminal-*` token 作为唯一真源反向注入 JS。

* **建议命令**：`/impeccable colorize`

### \[P2] Perf-3 · 图片懒加载与 alt 覆盖不全

* **位置**：`<img>` 共 30 个，带 `alt` 20 个（缺 10），带 `loading="lazy"` 仅 3 个

* **类别**：Performance / Accessibility

* **说明**：缺失的 10 个需逐个确认是装饰图（应显式 `alt=""`）还是内容图（应写描述）；`loading="lazy"` 应补到会话列表里的缩略图/壁纸之外的图片。

* **建议命令**：`/impeccable harden`

### \[P2] Perf-4 · 动效时长只部分 token 化

* **位置**：`app/globals.css` 只定义 4 个 `--motion-*` / `--ease-*`，但 tsx 内联 6 处硬编码 `NNNms`、CSS 内 8 处 `transition: <prop> NNms`

* **类别**：Theming（一致性）

* **建议**：收敛到 3-4 个时长 token（快/常规/慢/进出场），与 `craft-floor` 的“一个被编排的动效时刻，而不是散落效果”对齐。

* **建议命令**：`/impeccable animate`

***

## 4. P3 级问题（批量小项）

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| P3-1 | `::selection` 与 `caret-color` 未主题化 | `app/globals.css` 全仓零命中 | `craft-floor` 明确列为“最便宜也最容易被跳过的信号”：滚动条/下划线/`accent-color`/`tabular-nums` 都已主题化（`:648-868`、`:930`、`settings.css:1076`），只差这两个 |
| P3-2 | 10px 字号偏小 | `--text-2xs: 10px`（8 处使用）+ 内联 `fontSize: 10` 55 处 + `fontSize: 9` 5 处 | 密集工具 UI 可接受下限是 11px；9px 建议消除 |
| P3-3 | 危险左色条 | `components/ChatWindow.tsx:1849` `borderLeft: "3px solid var(--danger)"` | 命中 `craft-floor` 的“卡片/列表项/提示块上 >1px 的有色左边框”。建议改成带图标+标签的错误块，或降到 1px 并入背景 tint |
| P3-4 | blockquote 左边框 | `app/globals.css:992` `border-left: 2px solid var(--border-strong)` | 中性色、语义正确（引用），属**可接受**；若要与 P3-3 统一风格可降到 1px |
| P3-5 | 无 skip link | 全仓仅有 `sr-only` 标签（`WallpaperSettings.tsx:104`、`SettingsPanel.tsx:216`） | 侧栏 + 主区的应用补一个“跳到主内容”成本极低 |
| P3-6 | 标题层级松散 | `h1`×3、`h2`×4、`h3`×12、`h4/h5/h6` 各 1 | 面板内多处直接用 `h3` 起头；对屏幕阅读器导航不利 |
| P3-7 | 阅读列宽未按语言区分 | `--readable-content-max-width: 900px`（`globals.css:121`，用于 `.markdown-readable-column`） | 13-14px 下中文约 64 字/行（符合 65-75 字），英文长文约 120+ 字符/行（超出 65-75ch）。若要支持英文阅读，建议按 `:lang()` 或内容语言设 `76ch` 上限 |
| P3-8 | reduced-motion 全局截断 | `app/globals.css:1866-1872` `*` 上 `animation-duration: 0.01ms !important` + `transition-duration: 0.01ms !important`；`:1930` 另有 `0.001ms` | 项目同时在 7 个 CSS 块 + 6 处 JS `matchMedia` 分支做了**逐组件** reduced-motion 处理（`AppShell.tsx:2341`、`ChatMinimap.tsx:411/461/491/543` 等），方向是对的。全局截断的风险是加载指示器变静止帧、动效承载的状态变化被抹掉。建议保留全局兜底但加例外清单（`.spinner`、`.progress-*`），并统一 `0.001ms`/`0.01ms` 两种写法 |
| P3-9 | `app/globals.css` 注释乱码 23 行 | `:27,43,53,56,63,68,76,77,87,108,132,139,182,222,261,300,1711,1857,2089,2300,2375,2380,2433` | 形如 `鈥?`（U+2014）、`鈫`（→）、`脳`（×）、`搂`（§）——编码转换事故已写死在文件里（文件本身是合法 UTF-8）。只影响注释可读性，修它零风险；其余 3 个 CSS 文件干净 |

***

## 5. detect 结果逐条定性（19/27 误报）

| 规则 | 条数 | 定性 | 证据 |
| --- | --- | --- | --- |
| `broken-image` | 11 | **全部误报** | 命中的是注释与文档文本：`app/api/files/[...path]/route.ts:371` 是 CSP 说明里的 `<img>`、`app/wallpaper.css:10` 是注释、`components/ProcessGroup.tsx:518` 是 JSDoc、`hooks/useWallpaper.ts:32` 是注释。正则走非 HTML 模式时把注释当代码 |
| `em-dash-overuse` | 6 | **全部误报，且可定量证明** | 检测器把 CSS 变量前缀 `--` 当成了 em-dash：`app/globals.css` 里 U+2014 实际只有 **3** 个，而 `--` 出现 **1211** 次（它报告“1210 em-dashes”）；`app/wallpaper.css` 同理（U+2014 = 7，`--` = 361，它报 366）。真要查文案破折号，应只扫 `lib/i18n/messages/*` |
| `numbered-section-markers` | 2 | **误报，且可定量证明** | 报告 “Sequence: 01, 02, 04, 05, 06, 07”——缺的 `03` 正好对应 `oklch(… / 0.01…0.07)` 的 alpha 小数；文件里没有任何 `^\s*[0-9]{2}[^0-9]` 形的章节标记 |
| `layout-transition` | 6 | **4 真 2 误** | 见 [P1] Perf-1 |
| `side-tab` | 2 | **1 需修 1 可接受** | `ChatWindow.tsx:1849` 真（P3-3）；`globals.css:992` 是 blockquote，中性色，可接受（P3-4） |

对照：同一命令跑 Proma 的 `src/renderer` 只得 **1 条**（`side-tab`，`components/diff/MarkdownToc.tsx:111` 的 `border-l-2`）——说明误报率与代码里注释密度、CSS 变量用法强相关，不是项目本身特别差。

**给后续使用的建议**：`detect` 只用于 `app/**/*.css` 与真 HTML 产物（`.next/server/app/*.html` 或运行时 URL 走浏览器引擎），不要对 tsx 跑——否则误报率 70%。

***

## 6. 正面发现（不要在这上面“优化”）

1. **真 token 系统**：247 个 token、2631 处 `var(--token)` 引用、`--radius-*` 引用 265 次；radius/elevation/z-index/type/control 五条梯度都有注释说明来源（`globals.css:1-130`）。

2. **oklch 调色板 + 渲染回归**：5 套主题（light/dark/mist/rose/pine）全用 oklch，且有 `docs/codex-skin/verify-themes.mjs` 用真实浏览器读 computed value，专门抓“同名选择器重复导致后一份静默胜出”这类静态检查抓不到的错。这套做法比绝大多数同类项目严谨。

3. **token 审计门禁**：`docs/codex-skin/audit-tokens.mjs` 在合并上游后校验自造 token 是否仍被定义，避免主题块被覆盖后样式大面积塌掉。

4. **逐组件 reduced-motion**：7 个 CSS 块 + 6 处 JS `matchMedia` 分支（`AppShell.tsx:2341`、`ChatMinimap.tsx:411/461/491/543`、`ChatWindow.tsx:783`）而不是只在顶层截一刀。

5. **可分区的键盘可达分隔条**：`hooks/useResizablePanel.ts:199,278,290,167-168` 给了 `role="separator"` + `aria-orientation` + `tabIndex` + `aria-valuenow/aria-valuetext` + ←→ 调宽；Proma 同位置只有 `onMouseDown`（`SidePanel.tsx:1448,1828`）。这是本仓库在 a11y 上**强于对照项目**的地方。

6. **aria/live-region 密度高**：`aria-*` 17 种 \~470 处、`role` 24 种 \~90 处，其中 `role="alert"` 23 处、`role="status"` 21 处（对照 Proma 约 296 / 42，`alert` 0 处）。

7. **运行时请求缓存/去重**：`lib/models-cache.ts:16,33,57-88`（TTL + `inFlight` 合并 + generation 防陈旧写回）；`lib/file-access.ts:20-60` 的 allow-roots 5s 缓存。

8. **SSE 断线分级重连**：`lib/agent-event-connection.ts:41-200` 被动重连 + `lib/prompt-recovery.ts` 签名去重 + 半开连接在 `visibilitychange`/`online` 时对账。

9. **浏览器表面基本被主题化**：滚动条（`:648-868`）、`text-underline-offset`（`:930`）、`accent-color`（`settings.css:1076`）、`font-variant-numeric: tabular-nums`（`:2928`）、`::placeholder`（`:499`）。

10. **字体的选择与场景匹配**：系统 UI 字体栈 + `PingFang SC`/`Microsoft YaHei`（`globals.css:404`）对 Operate 模式是正确的（原生感 + CJK 覆盖），不是 `craft-floor` 禁止的“用系统显示字体当自有世界的展示字体”。

11. **没有&#x20;**`transition: all`（0 处）；`outline: none` 12 处均有配套 focus 样式，`focus-visible` 规则 23 条。

12. **移动端不是“顺带做”**：抽屉式侧栏（`AppShell.tsx:212-213`）、紧凑工具条 + More（`:458-478`）、`visualViewport` 键盘避让（`hooks/useViewportHeight.ts:35-90`）、34 处 `safe-area-inset-*`、`viewportFit: cover`、`pointer: coarse` 触控适配、PWA + Web Push。对照 Proma **完全没有宽度断点**（`globals.css` 仅 3 个 `@media`，全是 `prefers-reduced-motion`），窗口下限 800×600。

---

## 7. 建议的执行顺序（对应 `/impeccable` 命令）

1. **P1** `/impeccable optimize` — Perf-1（侧栏/进度条改 transform）+ Perf-2（will-change 收缩）
2. **P1** `/impeccable colorize` — A11y-1（浅色三主题 token 对比度）
3. **P1** `/impeccable harden` — A11y-2（弹层 dialog 语义与焦点）+ Perf-3（alt/lazy）
4. **P1** `/impeccable adapt` — A11y-3（移动端触控目标）
5. **P2** `/impeccable typeset` + `/impeccable polish` — Theming-1/2/4（内联字面量收口到 token）
6. **P3** `/impeccable polish` — 第 4 节 8 个小项一次过

> 以上每一项都已在 `docs/proma-prs-2026-09-18.md` 里拆成独立 PR（`DSN-01`…`DSN-09`），每个可单独提交与回滚。

---

## 附录 · 本次用到的可复现命令

```bash
# 1. 工具版本与能力
npx --yes impeccable --version            # 4.1.0
npx --yes impeccable skills help          # 25 个命令

# 2. 反模式扫描（注意 tsx 误报）
npx --yes impeccable detect app components hooks lib --json   # 27 findings / 5 rules

# 3. 对比度（本文自写脚本，oklch→sRGB→WCAG 相对亮度，含 alpha 合成）
node /tmp/contrast3.mjs

# 4. 梯度绕过统计
grep -rEo "fontSize: *[0-9.]+" components --include=*.tsx | grep -oE "[0-9.]+$" | sort -n | uniq -c
grep -rn "var(--control-" app components --include=*.css --include=*.tsx | wc -l
grep -rEo "height: *[0-9]+" components --include=*.tsx | grep -oE "[0-9]+$" | sort -n | uniq -c | sort -rn

# 5. skills install 失败与手工取 bundle
cd /tmp/imp-skill && yes | npx --yes impeccable skills install          # 失败：unzip 不是 zip
curl -sS -D - -o /dev/null "https://impeccable.style/api/download/bundle/universal"   # 302 → GitHub
curl -sSL -o /tmp/universal.zip "https://github.com/pbakaus/impeccable/releases/download/skill-v4.3.1/universal.zip"  # 15625571 bytes
```
