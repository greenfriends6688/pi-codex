# 上游合并纪律（Upstream Merge Policy）

日期：2026-09-18
适用范围：**本仓库（`@agegr/pi-web` 0.9.1 fork）上的所有改动**
配套工具：[`upstream-merge-audit.mjs`](./upstream-merge-audit.mjs)、[`upstream-merge-baseline.json`](./upstream-merge-baseline.json)
相关文档：[`patches/README.md`](./patches/README.md)（功能补丁台账）、[`codex-skin/delta.md`](./codex-skin/delta.md)（皮肤台账 + 更新流水线）

---

## 0. 为什么要单独写这一份

本仓库**不是上游的 git 分支**——它由上游的 tarball 导入而成（`aeffa53 upstream v0.9.1 (pristine upstream tarball)`），
与上游 `agegr/main` **没有 merge base**。拿到新版本时的做法是「解压新 tarball → `git merge upstream` → 按台账重打冲突」。

这意味着：**任何一处改了上游文件却没有留标记的改动，到了合并那天都没有地图。**

于是有了这一条硬约束：

> **不能因为加了功能，就丢掉未来接受上游更新的能力。**

纪律本身不新（`docs/patches/README.md` §3、`docs/ui-layout-pr-plan-2026-09-17.md` §5.1 都写过），
**新的是把它变成可测量、可阻断的数字。**

---

## 1. 当前基线（实测，2026-09-18）

> 测于 **`main` 分支 `d4f3f78`**（因为合并是在 main 上发生的）。在文档分支上跑会得到略小的值，
> 那是分支基点不同，不是差异。重跑一条命令即可复现：`node docs/upstream-merge-audit.mjs`。

```
$ node docs/upstream-merge-audit.mjs

  merge surface   125 files   ← 会冲突的候选面
    with marker   31
    no marker     91          ← leak（无重打地图）
    reviewed ok   3
  leak rate       73%
  fork-only files 167         ← 新文件，不冲突
  churn           +42190 / -7525
  marker slugs    30
```

对照上一次真实合并的成本（v0.9.0 → v0.9.1，`delta.md` 记录）：

| 指标 | v0.9.0 → v0.9.1 实际 | 现在 |
| --- | --- | --- |
| 需要手工处理的冲突 | **10 个文件 / 25 处** | — |
| 冲突候选面 | — | **125 个文件** |
| 其中有标记（有地图） | — | 31 |
| **其中没标记（无地图）** | — | **91（73%）** |

**结论**：合并成本与 `merge surface` 和 `leak` 两个数正相关。现在 73% 的面没有地图，
所以下一次合并的真实成本会显著高于 v0.9.0→v0.9.1 的 10 文件 / 25 处。

> 还有一件已知的放大因素：上游从 0.10 起把 Next.js 换成了 **TanStack Start + Vite + Nitro**
> （见 `docs/ref-projects-comparison-2026-09-16.md`）。下一次合并本来就要重接大量文件，
> 这时候多 91 个没有地图的文件，代价会翻倍。

---

## 2. 三个接触面等级（每个 PR 必须自报）

沿用 `docs/ui-layout-pr-plan-2026-09-17.md:286-296` 的定义，并补上**自报格式**：

| 等级 | 含义 | 合并代价 | 允许做吗 |
| --- | --- | --- | --- |
| **T0 零接触** | 只新增 fork-only 文件 | 无冲突 | **鼓励，优先** |
| **T1 接线** | 上游文件内 ≤10 行改动，每处带 `// fork:<slug>` | `grep -rn "fork:<slug>"` 拿到清单，按台账重打 | 允许，**必须登记** |
| **T2 结构性** | 重写上游组件的 DOM / 状态结构 | 按 `delta.md` 重贴 | 仅当确有必要，且「取上游结构 + 覆盖层」 |

### 2.1 每个 PR 的描述里必须带这一行

```
接触面：T1 · 3 个上游文件 / 5 处改动 · slug=fork:proma-01 · audit leak 91 → 91
```

没有这一行的 PR 不合并。三个数字都要给：**文件数 / 处数 / audit 前后 leak 值**。

### 2.2 T0 的落点（照这个放，上游永远不会碰）

| 类型 | 落点 | 现有例子 |
| --- | --- | --- |
| 前端组件 | `components/fork/<Name>.tsx` | `CronConfig.tsx`、`McpConfig.tsx`、`PiMemoryConfig.tsx` |
| 内联扩展 / 工具 | `lib/<slug>-extension.ts` | `lib/todo-extension.ts`、`lib/subagent-extension.ts` |
| 纯逻辑 | `lib/<slug>.ts` + 同名 `.test.mjs` | `lib/cron-*.ts`、`lib/chat-workspace.ts` |
| API 路由 | `app/api/<新路径>/route.ts` | `app/api/cron/route.ts`、`app/api/mcp/route.ts` |
| 样式覆盖 | `app/fork-ui.css` | 见 `ui-layout-pr-plan` §5.2 |
| 文档 | `docs/*.md` | 本文件 |

> **注**：fork 的 `lib/` 目前是扁平的（没有 `lib/fork/`）。**不要**为了整齐新建 `lib/fork/`——
> 现有 30 个 slug 都在扁平命名空间里，改命名空间会让 146 个已有标记失效。用 `<slug>-` 前缀区分即可。

### 2.3 T1 的写法

```ts
// fork:proma-01 — 审批卡的挂载点；上游这一行没有等价物
{extensionDialog && <ExtensionDialog … />}
```

规则：

1. **一处一个标记**，标记文本 = `fork:` + slug（kebab-case，跟 PR 编号或功能名）。
2. **slug 必须唯一且稳定**。同一功能的多次接线用同一个 slug，这样 `grep` 一次拿全。
3. **不要改上游代码的行内逻辑**——只加接线。需要条件分支就整块加在末尾。
4. 上游文件里**不要**新增 import 之外的顶层结构（新 Hook、新 Context、新常量表）。
   要放这些，就把它们放在 T0 文件里再 import 进来。

---

## 3. 使用方式

```bash
# 看整体（默认对比 `upstream` 分支）
node docs/upstream-merge-audit.mjs

# 只看没有标记的文件（合并前先跑这个）
node docs/upstream-merge-audit.mjs --list=leaks

# 按 slug 看每个功能的接线面
node docs/upstream-merge-audit.mjs --list=slugs

# CI / 提交前当门禁（budget 读 docs/upstream-merge-baseline.json）
node docs/upstream-merge-audit.mjs --check

# 临时收紧预算，验证自己没引入新 leak
node docs/upstream-merge-audit.mjs --check --max-leaks=91
```

| 参数 | 说明 |
| --- | --- |
| `--ref=<ref>` | 对比的 ref，默认 `upstream`；也可用 `--ref=agegr/main` |
| `--json` | 机器可读输出 |
| `--list=leaks` / `--list=slugs` | 只列 leak 文件 / 只列 slug 统计 |
| `--all` | leak 列表不截断（默认只显示 25 条） |
| `--check` | 超出预算则退出码 1 |
| `--max-leaks=N` | 覆盖预算（不读 baseline 文件） |

**判断标准**：

- `merge surface` 涨 → 改到了更多上游文件（可能是 T1 变多，也可能是误改了无关文件）。
- `leaks` 涨 → **有改动没留地图**，这是要拦住的那一类。
- `fork-only files` 涨 → 健康（T0 在增长）。

---

## 4. 现状：91 个 leak 怎么处理

**不建议现在补 91 个标记。** 它们是历史积累的，盲目补标会把「重打地图」变成噪音。
建议分三步：

### 第一步：先分诊（不是补标记）

按性质把 91 个分成三类，其中前两类**本来就不需要标记**：

| 类别 | 例子（实测） | 处理 |
| --- | --- | --- |
| **整体重写**（本地就是真相） | `README*.md`、`.gitignore`、`bin/pi-web*.js`、`app/manifest.ts`、`app/login/page.tsx` | 记入 `REVIEWED_NO_MARKER` 白名单，**不需标记** |
| **二进制 / 生成物** | `build/icon.icns`、`build/icon.png`、`package-lock.json` | 同上，白名单 |
| **真·接线改动** | `app/api/files/[...path]/route.ts`、`components/*.tsx` 里的条件分支 | **需要补标记** |

分诊后预期需要补标记的会远少于 91。

### 第二步：只给「将来会再碰」的文件补标记

优先级：本次 PR 计划（PROMA-*）会碰到的文件 → 高频改动文件 → 其余留空。
即「顺手补」，不做一次性考古。

### 第三步：用 `--check` 防回潮

把 `--check` 接进 CI（或至少接进本仓库的 DoD），预算只降不升。
预算要升必须在本文件里写明理由。

> 现在就能加的一条：`package.json` 的 `test` 脚本后面追加 audit，
> 或在 PR 模板里要求贴 audit 输出。**不阻塞合并**，但让数字可见。

---

## 5. 给本 PR 计划（PROMA-*）的额外约束

Proma 借鉴项里有两类**天然容易制造 T1/T2**的改动，需要额外注意：

| 风险项 | 为什么会碰上游 | 应遵守 |
| --- | --- | --- |
| **PROMA-01..03 审批 / 权限 / 计划模式** | 要挂到 `hooks/useAgentSession.ts`、`components/ChatWindow.tsx` 的既有事件链上 | 工具拦截全部放 `lib/proma-*-extension.ts`（T0）；上游文件只加**一处** `fork:proma-01` 挂载点 |
| **PROMA-06 子会话阻塞冒泡** | 要改 `lib/agent-event-stream.ts`（上游文件） | 事件字段用**可选字段**追加，不改既有字段语义；改动处打标 |
| **PROMA-14 / 24 定时任务** | `lib/cron-*.ts` 是 fork-only，安全 | 全 T0，可放心改 |
| **PROMA-25..28 IM 桥接** | 需要在 `instrumentation.ts` 挂启动 | 只加 **1 行** + `fork:proma-25` 标记（照 `startCronScheduler()` 的样子） |
| **PROMA-29/30 打包** | `package.json` 的 builder 配置、`electron/main.js` | `package.json` 已是 fork 重度改动文件，**保持只有版本号与 builder 配置的 diff**；打包逻辑抽到 `scripts/*.mjs`（T0） |
| **PROMA-19 自动更新** | 要改 `electron/main.js`（现在只是单文件壳） | 抽成 `electron/updater.mjs`（T0），`main.js` 只留一处 `fork:proma-19` 挂载 |
| **PROMA-20a 外链路由** | 要改 `components/MarkdownBody.tsx`（上游文件） | 加可选 prop `onOpenUrl`，默认行为不变 → 只有 1 处接线 |

**统一口径**：新增能力一律 `lib/proma-<name>.ts` / `components/fork/<Name>.tsx`；
上游文件只保留「挂载一行」。

---

## 6. 合并上游时的检查表

```bash
# 0. 记录合并前的数字
node docs/upstream-merge-audit.mjs --json > /tmp/before.json

# 1. 按 delta.md「更新流水线」导入新 tarball 并 merge
#    （见 docs/codex-skin/delta.md:16-24）

# 2. 冲突只应出现在 audit 列出的 merge surface 内
node docs/upstream-merge-audit.mjs --list=leaks

# 3. 逐 slug 重打
node docs/upstream-merge-audit.mjs --list=slugs
#    → 对每个 slug：grep -rn "fork:<slug>" ，按台账说明重接

# 4. 完整 DoD
node_modules/.bin/tsc --noEmit && npm run lint && npm test
node docs/codex-skin/audit-tokens.mjs     # 动了 CSS 时

# 5. 更新基线与本文件的数字
node docs/upstream-merge-audit.mjs --check
```

合并时两条冲突策略（来自 `delta.md`，不要改）：

- **逻辑冲突一律取上游**，再按 `fork:<slug>` 重接；
- **皮肤冲突按 `delta.md` 重打**。

---

## 7. 一句话总结

> 新增能力放 T0 新文件；碰上游文件就打 `fork:<slug>` 标记；
> 提交前跑一次 `--check`，**leak 数只允许降**。
