# 上游 0.9.1 → 0.9.2 合并方案（2026-09-22）

上游：`agegr/pi-web` v0.9.2（`040faddf`，2026-09-22）
本仓：`main` @ `61807c5`
准备：`upstream` 分支已提交 `14af8dc upstream v0.9.2 (pristine upstream tarball)`

> 规划类文档按本仓惯例不入 git（`.gitignore:80 /docs/zeno-*`）。
> 本文件不在忽略列表里，但属于同一类规划文档。

---

## 0. 网络

`github.com` 直连超时（`curl` 15s 拿 000），`api.github.com` 通（200）。
所以 **`git fetch` 用不了**，改用 API 拿 tarball：

```bash
curl -sL -o v092.tar.gz "https://api.github.com/repos/agegr/pi-web/tarball/v0.9.2"
```

---

## 1. 规模（实测）

```bash
node docs/upstream-merge-audit.mjs          # ref: upstream
node /tmp/scope.mjs                          # 冲突面 = 两边都改的文件
```

| 指标 | 上次真实合并 0.9.0→0.9.1 | 这次 0.9.1→0.9.2 |
| --- | --- | --- |
| 上游改动文件 | — | **188** |
| **两边都改（= 冲突面）** | 10 文件 / 25 处 | **107 文件** |
| 上游单方面改（可无痛吸收） | — | 81 |
| fork 单方面改（保持） | — | 529 |
| audit merge surface | 125 | **230** |
| audit leak（无重打地图） | 91 | **123** |
| audit marker slugs | 30 | 127 |

**结论：冲突面是上次的 10 倍。** 按仓库政策（`upstream-merge-policy.md` §6），冲突一律
「取上游 → 按 `fork:<slug>` 重接」，127 个 slug 要逐个重打。这不是一次会话能做完的，
硬做会把应用留在不可用状态。

---

## 2. 上游这版的 15 个 feat/perf

| PR | 内容 | 与本仓的关系 |
| --- | --- | --- |
| #940 | session 性能优化（#928 + #912 rebase） | 冲突 |
| #939 | **小地图悬停显示每回合工具调用数** | ⚠️ **与本仓 `fork:zn-17`（刚做的 dash tooltip）正面冲突** |
| #938 | Models 面板「手动刷新目录」按钮 | 冲突（ModelsConfig） |
| #934 | **内置子代理逐个关闭**（ADR 0005） | 冲突（AgentsConfig） |
| #930 | **`enabledModels` 开关**（Settings → Models，ADR 0004） | 冲突（ModelsConfig / models route） |
| #887 | 会话按浏览器 tab 记忆 | 冲突（AppShell） |
| #845 | 滚动到底部按钮 | 冲突（ChatWindow） |
| #868 | 插件面板显示包描述 | 冲突（PluginsConfig） |
| #853 | 变更文件行加 mention 按钮 + 中间省略路径 | 冲突（FileExplorer） |
| #844 | OpenCode Go provider 用量 | 冲突（ProviderUsageSummary） |
| #828 | `/auto-compact` 斜杠命令 | 冲突（ChatInput） |
| #825 | **会话/文件面板可拖拽** | ⚠️ **与本仓 `fork:zn-20/21` 的侧栏改动冲突** |
| #735 | composer 里预览图片附件 | 冲突（ChatInput） |
| #733 | 扩展 widget 字号设置 | 冲突（SettingsPanel） |
| #732 | worktree 先 fetch origin + 提高 git 超时 | 冲突（worktree） |

两处 ⚠️ 是**同一块 UI 两个实现**，必须先定谁赢：

- **小地图**：上游把 tooltip 做成「每回合工具调用数」；本仓 `fork:zn-17` 做成了
  「角色行 + 5 行正文预览」，且只在预览面板钉住时显示（因为本仓 dash 是
  `pointer-events: none`）。**建议取上游的触发方式 + 保留本仓的正文预览**，
  两者都是 hover 那一个位置的信息，可以合并成一个 tooltip 的两段。
- **侧栏可拖拽**：上游 #825 把会话/文件面板都做成可拖。本仓侧栏本来就可拖
  （`useResizablePanel`），且 `fork:zn-20/21` 刚改了行序、分段切换、折叠态图标条。
  **建议取上游的「文件面板也可拖」，侧栏部分保持本仓。**

---

## 3. 分批方案（按「功能」切，每批可运行可验证）

### 批 1 — 白拿：只拷上游单方面新增的文件（T0，零冲突）

这 81 个「上游单方面改动」里，**新增文件**可以整包拷进来而不动任何现有代码：

```
lib/enabled-models.ts + .test.mjs
lib/enabled-models-runtime.ts + .test.mjs
lib/exact-system-prompt.ts + .test.mjs
lib/agent-event-wire.ts + .test.mjs
components/EnabledModelsSection.tsx + .test.mjs
components/enabled-models-helpers.ts
components/models-config-helpers.ts
components/session-catalog-helpers.ts + .test.mjs
app/api/models/enabled/route.ts
app/api/models/refresh/route.ts
app/api/subagents/profiles/route.ts（改过，需对比）
docs/adr/0004-enabled-models-toggles.md
docs/adr/0005-built-in-subagent-disable.md
…（完整清单：node /tmp/scope.mjs 的「上游单方面改」段）
```

**风险**：低（新文件 + 新测试，不接线就是死代码）。
**验收**：`tsc --noEmit` + `npm test` 绿。

### 批 2 — 接线：把批 1 的能力接上（T1）

`components/ModelsConfig.tsx`、`components/AgentsConfig.tsx`、`components/SettingsPanel.tsx`、
`app/api/models/route.ts`、`app/api/plugins/route.ts`。
这些文件本仓也改过 → 逐个手工合，每处打 `fork:<slug>`。

### 批 3 — 大头：两边都重写的核心文件（T2）

`components/AppShell.tsx`、`ChatWindow.tsx`、`ChatInput.tsx`、`SessionSidebar.tsx`、
`ChatMinimap.tsx`、`FileViewer.tsx`、`MessageView.tsx`、`app/globals.css`、`app/settings.css`、
`hooks/useAgentSession.ts`、`lib/agent-event-stream.ts`。
每个几千行、两边都大改。**建议按「一个文件一个 PR」推。**

### 批 4 — 收尾

i18n（上游新增 key）、测试、`docs/upstream-merge-baseline.json` 基线更新、
`--check` 门禁跑绿。

---

## 4. 不要做的事

- **不要** `git merge upstream` 一把梭然后手工解 107 个冲突 —— 中途应用不可用，
  而且 127 个 slug 的语义冲突在一次性 diff 里看不出来。
- **不要**为了「吸收上游」放弃 fork 的功能面（皮肤、定时任务、MCP、记忆、
  自定义命令、独立聊天工作区、分段侧栏、折叠态图标条）。这些是 T0 文件，合并时
  应当**保持**，而不是被上游版本覆盖。
- **不要**在没有备份分支的情况下动 `main`。合并前先
  `git branch backup/pre-0.9.2-merge`（仓库里已有 `backup/pre-0.9.1-merge` 等先例）。
