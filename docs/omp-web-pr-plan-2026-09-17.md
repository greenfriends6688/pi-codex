# omp-web 借鉴项 · PR 拆分与实施计划

日期：2026-09-17 配套对比：`omp-web-comparison-2026-09-17.md` 基准：`@agegr/pi-web` 0.9.1 fork（仓库已是 git，HEAD 见 `git log -1`）

***

## 0. 拆分原则

| 原则 | 说明 |
| --- | --- |
| **单一意图** | 一个 PR 只做一件事；**绝不**把「皮肤/CSS」与「功能」混在一起 |
| **可独立回滚** | 每个 PR revert 后系统仍可用；新路由新文件优先于改老文件 |
| **自带测试** | 新增 `lib/` 逻辑必须带 `.test.mjs`；纯 UI PR 至少一个断言测试（本仓库惯例：读源码断言，见 `components/*.test.mjs`） |
| **不碰 CLI 平行真相** | 不往 `~/.pi` 写 pi CLI 不认识的结构（§6 不做清单） |
| **搬运带证据** | 每个 PR 的「依据」列到 omp-web 的 `file:line`，实施时对照，不凭记忆 |
| **i18n 三语同步** | 新增文案必须同时进 `en.ts` / `zh-CN.ts` / `zh-TW.ts`（`lib/i18n/messages/`） |

### 统一 DoD

```bash
node_modules/.bin/tsc --noEmit     # 必过
npm run lint                       # 0 error
npm test                           # 除环境性用例外全过
# 改动 app/globals.css 时追加：
node docs/codex-skin/audit-tokens.mjs
mv .next $(mktemp -d)/next && npm run prod   # 干净重建
node docs/codex-skin/verify-themes.mjs
```

***

## 1. 阶段总览

| 阶段 | 主题 | PR 数 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| **P1** | 侧栏与聊天纯前端改造 | 5 | — | 低 |
| **P2** | 运行态与「pi 设置」编辑器 | 4 | P1（PR-05 与 PR-01..04 无耦合，可并行） | 中 |
| **P3** | 密码锁与发布链路 | 4 | — | 中高（PR-09/10 涉密） |
| **P4** | 交付与评估 | 3 | P2 之后评估 | 高（PR-14/15 先 spike） |

推荐节奏：`P1 整批 → (P2 ∥ P3) → P4`。 P2 与 P3 **无代码依赖**，可双线并行。

***

## 2. P1 — 侧栏与聊天纯前端改造（5 个 PR）

### PR-01 · 侧栏「项目折叠 / 展开」

* **目标**：项目行左侧加 chevron，折叠后该项目下的会话与归档区不渲染；折叠态持久化。

* **依据**：`pi参考项目/omp-web-0.4.4/components/SessionSidebar.tsx:122`（`omp-web:collapsed-projects`）、`:898-910`（`toggleProjectCollapsed`）、`:1244-1280`。

* **接入点**：`components/SessionSidebar.tsx`（项目行渲染与 `projectSelection` 附近）；新增 `lib/sidebar-project-state.ts` + `.test.mjs`（纯函数 + localStorage 读写，便于测试）。

* **注意**：key 用本仓库前缀 `pi-web:`（现有 key 见 `lib/workspace-memory.ts`、`lib/file-explorer-state.ts`），**不要**写 `omp-web:*`；折叠不得影响「当前选中项目自动置顶」与归档区的展开状态（那是另一个状态）。

* **工作量**：S（\~150 行 + 测试）

* **风险**：低（纯 UI 状态）。与 `SessionSidebar.test.mjs` 的既有断言保持一致。

### PR-02 · 侧栏「从列表移除项目」+ 恢复入口

* **目标**：项目菜单（现 `projectMenuOpen`，`:502`）里加一条红色「从列表移除」；移除只改本地列表，不删任何会话/文件；在设置面板 General 段提供「已隐藏的项目」列表可一键恢复。

* **依据**：`SessionSidebar.tsx:916-930`（`handleRemoveProject`：只写 `omp-web:removed-projects`）、`:1671-1700`（红字菜单项）；它的短板是**没有恢复入口**，本 PR 补上（比参照实现更完整）。

* **接入点**：`components/SessionSidebar.tsx`（项目分组前的过滤）；`components/SettingsPanel.tsx`（General 段）；新增 `lib/hidden-projects.ts` + `.test.mjs`。

* **注意**：不要与 `lib/session-flags.ts`（pin/archive 是针对**会话**）混用一个存储；被移除的项目若仍是当前 cwd，需要退回默认选择（参照 omp `:930-932`）。

* **工作量**：S（\~180 行 + 测试）

* **风险**：低。唯一坑是「移除后 URL 里仍指向该项目会话」→ 保留当前会话可用，只从列表隐藏。

### PR-03 · fork 家族折叠

* **目标**：有子会话的会话行加 chevron，折叠其 fork 子树；折叠态持久化。

* **依据**：`SessionSidebar.tsx:2050-2090,2469-2490`（fork 缩进 + 折叠按钮）、`sidebar.collapseForks/expandForks` 文案。

* **接入点**：数据已有——`lib/session-family.ts`（`listSessionFamilies`）+ `components/SessionSidebar.tsx` 的 family 渲染分支；新增 `lib/session-family-collapse.ts` + `.test.mjs`（或复用到 PR-01 的存储模块）。

* **注意**：折叠状态按**根会话 id** 存，不要按项目存；`ArchivedSessionsSection` 已有「默认折叠 + 空则不渲染」的模式可照抄。

* **工作量**：S（\~120 行）

* **风险**：低。

### PR-04 · 项目级活动徽标（运行中数量 / 未读数量）

* **目标**：项目行显示「n 个会话运行中」（旋转图标）与「n 条未读」（圆点），点击仍按原行为选中项目。

* **依据**：`SessionSidebar.tsx:2130-2180`（`showProjectActivity`）、`:1255`（投影）。

* **接入点**：`components/SessionSidebar.tsx`（项目行）；数据已有：`runningSessionIds`、`unreadSessionIds` 都已在组件内（`:599-650` 附近）。

* **无障碍**：`aria-label` 要带计数（参照 omp `:2183-2184`），三语文案同步。

* **工作量**：S（\~80 行）

* **风险**：低；注意不要为每个项目做 N 次 O(sessions) 扫描，聚合成一次 Map。

### PR-05 · 流式 token 速率徽章（t/s）

* **目标**：流式 assistant 消息头部显示「估算 token 数 + t/s」，≥50/≥30/≥15 三档配色。

* **依据**：`omp-web/components/MessageView.tsx:32-60`（CJK≈1 token/字、其余 4 字符/token 的估算）、`:514-529,645-668`（300ms 采样）。

* **接入点**：`components/MessageView.tsx`（流式头部已有阶段提示）；估算逻辑放 `lib/streaming-message.ts`（已存在）+ `.test.mjs`。

* **注意**：估算仅用于**显示**，不得进入 `sessionStats`（真实 token 以上游 `usage` 为准）；流式结束立即清掉速率。

* **不做**：omp 的 `auto (high)`（思考生效档位）不在本 PR 范围——那是 omp 每回合解析的 effort，pi 的 `auto` 只是「不改 CLI 设置」的客户端占位，没有值可显（对比文档 §5）。

* **可选同批**：工具卡头部的 `+n/−n` diff 统计（omp `MessageView.tsx:902-946`）——本仓库已有 `SplitDiff`，只差头部计数。

* **工作量**：S（\~100 行 + 测试）

* **风险**：低（纯展示）。避免每 chunk 重算导致长回答卡顿：按 300ms 节流。

***

## 3. P2 — 运行态与「pi 设置」编辑器（4 个 PR）

### PR-06 · 运行中会话改用 SSE 推送

* **目标**：新增 `GET /api/agent/running/events`（SSE，先订阅再发初始快照，30s 心跳）；侧栏订阅它，**去掉 2.5s 轮询**（保留可见性变化时的对账轮询作为兜底）。

* **依据**：`omp-web/app/api/agent/running/events/route.ts:9-53`、`lib/rpc-manager.ts:1688-1717`（`subscribeRunningSessions`/`notifyRunningChange` 去重后广播）。

* **接入点**：

  * `lib/rpc-manager.ts`：新增订阅总线（挂在 `globalThis.__piRunningListeners`，与 `__piSessions` 同规则，穿热重载）；

  * `app/api/agent/running/events/route.ts`（新）；

  * `components/SessionSidebar.tsx`（订阅 + 断线重连 + `visibilitychange` 对账）。

* **注意**：本仓库 `AGENTS.md` 明确写了「侧栏每 2.5s 轮询」与后台标签页暂停策略——改动后**必须同步更新该段文档**；SSE 断线要有降级（回到轮询），否则内网代理会静默丢事件。

* **工作量**：M（\~250 行 + 测试）

* **风险**：中。SSE 与 Next dev 的 HMR 叠加时容易断流；测试用 `.test.mjs` 断言路由与总线契约（参照 omp `app/api/agent/running/events` 无测试，我们补上）。

### PR-07 · 「pi 设置」编辑器（后端）

- **目标**：新增 `GET/PATCH /api/pi-settings`，读写 `~/.pi/agent/settings.json`（项目层 `<cwd>/.pi/settings.json` 覆盖），返回一份**手写 schema** 的字段清单（label/description/type/group/value/defaultValue），PATCH 单字段写入。
- **依据**：`omp-web/app/api/settings/route.ts:132-192`（字段投影 + 类型校验 + `flush()`）、`lib/settings-api.ts:1-40`（字段协议）、`components/SettingsConfig.tsx:82-172`（6 种控件）。**但它的字段来自 SDK schema，我们没有**——字段表要手写，来源是 pi 的 `node_modules/@earendil-works/pi-coding-agent/docs/settings.md`。
- **首批字段（建议 ~25 项，全部是 pi 真的会读的键）**：

  | group | 键 |
  | --- | --- |
  | 模型与思考 | `defaultProvider` `defaultModel` `defaultThinkingLevel` `modelThinkingLevels` `thinkingBudgets` `enabledModels` |
  | 显示 | `hideThinkingBlock` `showCacheMissNotices` `markdown.mermaid` `markdown.codeBlockIndent` |
  | 压缩 | `compaction.enabled` `compaction.reserveTokens` `compaction.keepRecentTokens` |
  | 重试 | `retry.enabled` `retry.maxRetries` `retry.baseDelayMs` `retry.provider.timeoutMs` `retry.provider.maxRetries` |
  | 工具与资源 | `defaultTools` `packages` `extensions` `skills` `prompts` `themes` `enableSkillCommands` |
  | 网络与目录 | `httpProxy` `sessionDir` `images.autoResize` `images.blockImages` |

- **接入点**：新增 `lib/pi-settings-schema.ts`（纯数据 + 校验，配 `.test.mjs` 断言「每个 path 都在 SDK 文档里出现」）、`app/api/pi-settings/route.ts`；读写走现有 `SettingsManager`（`lib/rpc-manager.ts`/`app/api/plugins/route.ts` 已有用法）。
- **注意**：
  - **项目层 vs 全局层**：`settings.json` 的 `defaultTools`、`packages` 等键是全局语义，写项目层前要按 SDK 文档确认（`docs/settings.md:348` 有「Project Overrides」章节）。
  - **凭证类键不暴露**（pi 的密钥在 `auth.json`，不在 settings.json）；
  - `enabledModels` 的三处一致：本仓库 `lib/model-scope.ts` 解析它，写回后需 `invalidateModelsCache()`（已有）并通知前端刷新模型选择器。
- **工作量**：M（~400 行 + 测试）
- **风险**：中。写坏 `settings.json` 会影响 CLI —— 必须原子写 + 先备份（参照 `lib/atomic-file.ts` 的 omp 实现思路），且 PATCH 只改单键，不整文件覆盖。

### PR-08 · 「pi 设置」编辑器（前端 + 跨字段搜索）

* **目标**：`SettingsPanel` 新增 `pi` section，按 group 渲染 boolean/select/text/secret/multiselect；每字段即时保存；改动需重载会话时给出提示与 `Reload session`；搜索框覆盖**全部字段的 label/description/path**（不是只 section 关键词）。

* **依据**：`SettingsConfig.tsx:66-79`（条件显隐）、`:82-172`（控件）、`:248-279`（分组与搜索）、`:309-315`（重载提示）。

* **接入点**：`components/SettingsPanel.tsx`（现 651 行，General/Models/Skills/Agents/Plugins 五段，加第六段）；`lib/i18n/messages/{en,zh-CN,zh-TW}.ts`。

* **注意**：本仓库设置面板的搜索是「section 关键词 + 当前 section DOM 文本」（`:479-491,540-565`）——新 section 的搜索应改成**数据驱动**（按字段过滤），顺带把既有段落也切过去，否则搜索行为会分叉。

* **照抄它的三个契约**（对比文档 §2.1）：① secret 字段只回 `configured`、留空不保存；② 改完需重建会话的键要给 `needsReload` 横幅 + `Reload session` 按钮；③ 面板有未保存草稿时关闭要提示（它**没做**，我们补上）。

* **移动端**：`<760px` 下设置面板走单列行布局（它用 `@media (max-width:760px)`），本仓库已有移动端断点体系，不要新增断点值。

* **工作量**：M（\~450 行 + 测试）

* **风险**：中（`SettingsPanel.tsx` 已是 651 行，注意别把它堆到 1500 行；建议新建 `components/PiSettingsSection.tsx`）。

### PR-09 · 显示设置下发（`hideThinkingBlock` 等）

* **目标**：新增 `GET /api/display-settings`，把「影响渲染」的 pi 设置（`hideThinkingBlock`、`showCacheMissNotices`）下发前端；`MessageView` 据此隐藏思考块与缓存未命中提示。

* **依据**：`omp-web/app/api/display-settings/route.ts:1-34`、`hooks/useDisplaySettings.ts:1-47`（`useSyncExternalStore` 单例 store）。

* **接入点**：新路由 + `hooks/useDisplaySettings.ts`（新，或并入现有 `hooks/useTheme.ts` 的模式）；`components/MessageView.tsx`（思考块渲染处）。

* **注意**：与既有 `lib/thinking-expansion-preference.ts`（默认展开/收起）**语义不同**：一个是「隐藏」，一个是「默认折叠」。两者共存时以隐藏优先，且隐藏不得删除数据（展开原文仍可复制）。

* **工作量**：S（\~150 行）

* **风险**：低。依赖 PR-07（没有写入端时，本 PR 也可以先只读 JSON）。

***

## 4. P3 — 密码锁与发布链路（4 个 PR）

### PR-10 · 密码存储层（scrypt + 原子写 + 验证缓存）

* **目标**：新增 `~/.pi/agent/pi-web-auth.json`（0600、目录 0700、`wx` 临时文件 + rename）；scrypt(N=16384,r=8,p=1,keyLen=64,16B salt) 存 salt+hash；`lib/web-auth.ts` 改为「存储优先，`PI_WEB_PASSWORD` 覆盖」，校验成功后 5 分钟验证缓存。

* **依据**：`omp-web/bin/web-auth-store.js:41-52,118-165,203-222,300-355`（参数、原子写、缓存）。

* **接入点**：新增 `lib/web-auth-store.ts`（Node 侧，替代现有 `lib/web-auth.ts:16-81` 的纯环境变量比较）；`proxy.ts:27-46` 与 `app/api/web-auth/route.ts` 改为调用它。

* **注意**：

  * 现有 `lib/web-auth.ts` 的**会话 cookie（HMAC）机制保留**（比它每个请求都带 Basic 更好）；

  * `PI_WEB_PASSWORD` 仍要能完全覆盖存储（容器/CI 场景）；

  * 支持 `PI_WEB_AUTH_FILE` 覆盖凭据文件路径（它是 `OMP_WEB_AUTH_FILE`；多 profile / 自定义 agentDir 场景必需，本仓库目前没有）；

  * 文件不可解析时**fail-closed**（503），不要退化成「无锁」。

* **工作量**：M（\~300 行 + 测试，测试覆盖：参数校验、原子写、缓存失效、env 覆盖）

* **风险**：**高**——这是唯一的门锁。测试必须覆盖「文件损坏 → 拒绝所有请求」与「改密后旧 cookie 失效」（现有 cookie 签名用密码作 HMAC key，天然失效，要在测试里锁住）。

### PR-11 · Access 设置面板 + CLI 开关

* **目标**：设置面板加 Access 段（开关、设置/替换/删除密码、状态与文件路径、环境变量接管时只读）；CLI 加 `--authenticated`、`--reset-password`（非 TTY 直接报错），加 `bin/password-prompt.js`（raw mode 不回显）。

* **依据**：`omp-web/components/AccessConfig.tsx:113-241`、`bin/password-prompt.js:9-96`、`bin/omp-web-options.js:12-36`、`bin/omp-web.js:104-136`。

* **接入点**：`components/SettingsPanel.tsx`（Access 段，替换现有「仅登出」块 `:97-115`）、`bin/pi-web-options.js`、`bin/pi-web.js`、i18n ×3。

* **注意**：`--reset-password` 只认 CLI（**不要**加环境变量开关，omp 故意如此：防止远端环境变量被用来重置门锁）；面板要明说「Basic Auth 不加密传输」。它的「删除密码」点击即执行（`AccessConfig.tsx:207-211`）——我们要加二次确认。

* **工作量**：M（\~350 行）

* **风险**：中。CLI 交互在 Electron 壳里没有 TTY → 壳内应禁用这两个 flag 或在 UI 里给出替代路径。

### PR-12 · `/recover` 一次恢复码

* **目标**：未认证路由 `POST /api/web-auth/recovery`：`request` 在**服务器控制台**打印 12 位一次性码（3×4 Crockford base32，60bit，TTL 10 分钟，最多 5 次错，单次使用，只存 scrypt digest）；`complete` 用码改密码。新增 `/recover` 页面。

* **依据**：`omp-web/bin/web-auth-store.js:449-527`、`app/api/web-access/recovery/route.ts:22-126`、`app/recover/page.tsx:95-105`。

* **接入点**：`app/recover/page.tsx`（新）、`app/api/web-auth/recovery/route.ts`（新）、`proxy.ts`（放行 `/recover` 与该 API）、`lib/web-auth-store.ts`（PR-10）。

* **注意**：先验码后验密码（防探测）；错误码区分 409（已托管/不可用）/403（码错）/429（限流，带 `Retry-After`）；码只 `process.stdout.write`，**不进日志文件**。

* **工作量**：M（\~300 行 + 测试）

* **风险**：中高（恢复通道 = 绕过门锁的第二条路）。测试要锁住：限流、一次性、TTL、以及「环境变量托管时 409 拒绝」。

### PR-13 · 更新对话框（changelog + 复制安装命令）

* **目标**：把现在 `ChatWindow.tsx:165-180` 的「版本号 + 外链」升级为对话框：当前/最新版本、release changelog（GitHub API，失败降级为只有链接）、探测到的包管理器与安装命令 + 复制按钮。

* **依据**：`omp-web/lib/omp-updates.ts:126-225`（版本比较、包管理器探测、`canInstall`/`restartRequired`）、`components/OmpUpdateIndicator.tsx:147-306`、`lib/npx.ts:61-81`（输出脱敏，本仓库已有 `lib/npx.ts`）。

* **接入点**：`lib/app-update.ts` + `app/api/app-update/route.ts`（扩字段，保持向后兼容）、`components/ChatWindow.tsx`（更新徽标 → 对话框）、i18n ×3。

* **注意**：npm 版本比较要用可靠实现（现有 `isNewerStableVersion` 可复用）；changelog 截断（它用 40k）；**Electron 壳内不显示一键安装**（见 PR-14）。

* **工作量**：S/M（\~250 行 + 测试）

* **风险**：低。

### PR-14 · 一键自更新（可选，独立回滚）

* **目标**：`POST /api/app-update` 执行 `npm i -g @agegr/pi-web@latest`（探测 npm/bun、120s 超时、脱敏 stdout/stderr、返回尾 2000 字符），成功后提示重启。

* **依据**：`omp-web/lib/omp-updates.ts:177-283`、`app/api/updates/route.ts:24-61`。

* **接入点**：新增 `lib/app-update-install.ts`（复用 `lib/npx.ts` 的环境与脱敏）、扩展 PR-13 对话框。

* **注意**：**必须**先判定运行形态：npm 全局安装 → 允许；源码目录 `next start` → 禁用（会装进只读/被 Electron 打进 `app.asar` 的目录）；Electron 壳内直接禁用。

* **工作量**：S（\~150 行 + 测试）

* **风险**：**中高**（执行安装命令 = 任意副作用）。建议默认关闭，用 `PI_WEB_DISABLE_SELF_UPDATE=1` 反向禁用，与它的 `OMP_WEB_DISABLE_SELF_UPDATE` 对齐。

***

## 5. P4 — 交付与评估（3 个）

### PR-15 · Docker 部署

* **目标**：`Dockerfile`（多阶段 node:22-slim）+ `docker-compose.yml`（挂载 `~/.pi`、`PI_WEB_PASSWORD` 必填、绑定 0.0.0.0）+ `docs/docker.md`。

* **依据**：`omp-web/Dockerfile:5-80`、`docker-compose.yml:17-33`、`docs/docker.md`。

* **接入点**：仓库根新增三文件；注意本仓库的 `NEXT_PUBLIC_APP_VERSION`（`app/api/app-update/route.ts:7`）与 `bin/pi-web.js` 的启动方式（`--hostname 0.0.0.0` + `--no-open`）。

* **注意**：本仓库依赖 `node-pty`（终端），容器里要有构建工具或预编译产物；`git` 也要装（worktree/diff）。

* **工作量**：S（\~120 行 + 文档）

* **风险**：低（不影响现有运行路径）。

### PR-16 · 「模型预设组」（模型角色的 web 侧等价物）· **先 spike**

* **目标**：在模型选择器里支持「预设组」：名字 + `provider/model` + thinking 档 +（可选）工具集；存 `~/.pi/agent/pi-web-presets.json`（**不写** CLI 不认识的 config.yml 结构）。切换预设 = 现有 `set_model` + `set_thinking_level`（+`set_tools`）的组合调用。

* **依据**：omp 的角色面板 `components/ModelRolesPanel.tsx:133-229`、`lib/model-roles.ts:32-115`（它写 CLI 的 `modelRoles`——我们**不**这么做）。

* **为什么是 spike**：需要先确认与 `enabledModels`/`modelScopeWarnings`、以及本仓库 `lib/tool-preset-preference.ts` 的关系；若与现有模型选择器冲突则放弃。

* **工作量**：L（spike 1 天；实现 \~500 行）

* **风险**：高（容易造出与 CLI 平行的模型配置）。**默认结论：不做，除非确有重复切换模型的工作流。**

### PR-17 · 富交互卡（`ask` 多问题表单 / `plan_review`）· **先 spike**

* **目标**：让 `ExtensionDialog` 支持多问题表单（推荐答案、自定义输入、Cmd+Enter 提交）与计划审批（Markdown 计划 + Refine/Approve + 反馈）。

* **依据**：`omp-web/components/ChatWindow.tsx:976-1235`（ask）、`:1240-1330`（plan\_review）。

* **前置问题**：这两种卡是 **omp 扩展发起的&#x20;**`extension_ui_request`**&#x20;method**；本仓库现有 ExtensionDialog 支持 `select/confirm/input/editor/custom`（`lib/rpc-manager.ts:1503-1524`）。pi 生态里是否有扩展会发 `ask`/`plan_review`？没有的话，这只是给未来的协议预留。

* **工作量**：L（\~600 行）

* **风险**：高（协议自造）。**建议：先做 1 天 spike 找一两个真实扩展验需求，否则不做。**

---

## 6. 明确不搬（避免平行真相）

| 不搬 | 原因 |
| --- | --- |
| 模型角色（`modelRoles` 写 `config.yml`） | 本仓库 SDK 无角色概念，写了 CLI 不读；改走 PR-16 的 web 预设组 |
| Goal 模式、Advisor、Prewalk、Memory 后端、STT/TTS、snapcompact、TTSR、loop guard、LSP 设置 | 全是 omp SDK 内部机制的配置项，本仓库 SDK 0.85.1 无对应实现 |
| schema 驱动的 372 字段设置编辑器 | pi 无 `SETTINGS_SCHEMA`；改成手写 ~25 项（PR-07/08） |
| 18 个工具逐个开关 + `tools.approval` 策略 | pi 的对应物是 `defaultTools` 与会话级工具预设（本仓库已更强） |
| `providers.maxInFlightRequests` | omp SDK 的执行层能力，本仓库无此层 |
| MCP prompts 进斜杠面板 | pi SDK 无 `mcpPromptCommands` |
| Tauri 壳 | 本仓库已有 Electron 壳（托盘 + 内嵌 server），换壳无收益 |
| 服务端会话归档注册表 | 本仓库 `lib/session-flags.ts`（pin + archive）已覆盖，且是用户可见习惯 |

---

## 7. 依赖图与建议排期

```
P1:  PR-01  项目折叠
     PR-02  移除项目+恢复
     PR-03  fork 折叠          ── 这三项可同一周并行，互不改同一文件段
     PR-04  项目活动徽标
     PR-05  t/s 徽章
P2:  PR-06  running SSE          （独立）
     PR-07  pi 设置编辑器（后端） ─┬─ PR-09 显示设置下发（可先只读）
     PR-08  pi 设置编辑器（前端） ─┘
P3:  PR-10  密码存储 ──┬─ PR-11 Access 面板 + CLI
                       └─ PR-12 /recover
     PR-13  更新对话框 ── PR-14 一键安装（可选）
P4:  PR-15  Docker
     PR-16  模型预设组（spike → 决定做不做）
     PR-17  富交互卡（spike → 决定做不做）
```

| 建议批次 | 内容 | 产出 |
| --- | --- | --- |
| 第 1 批 | PR-01…05 | 侧栏与流式体验对齐，零 SDK 风险，可立刻合并 |
| 第 2 批 | PR-06 + PR-07/08 | 去掉轮询 + 补上唯一的结构性缺口（能改 pi 设置） |
| 第 3 批 | PR-10/11/12 | 只有「要暴露到 LAN/反代」时才做；一次性三连 |
| 第 4 批 | PR-13/14/15 | 发布与部署闭环 |
| 需要时 | PR-16/17 | spike 先行，结论允许是「不做」 |
