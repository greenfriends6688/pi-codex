# omp-web 0.4.4 完整功能对比（含设置面逐项清点）

日期：2026-09-17　对象：`pi参考项目/omp-web-0.4.4`（omp-web 0.4.4，自称 fork 自 pi-web）
基准：本仓库 `@agegr/pi-web` 0.9.1 fork
配套：[`omp-web-pr-plan-2026-09-17.md`](./omp-web-pr-plan-2026-09-17.md)（PR 拆分）

> 前一版对比（同日早些时候）只看了文件清单，结论偏少。本版按「设置面 / 聊天面 / 外壳与文件 / 运行时与发布」四个面重做了逐项清点，
> **设置面按字段级展开**（附录 A 列出它设置面板里的全部 372 个字段），并标注每一项在本仓库的对应物。
>
> 结论摘要：它「有我没有」的**真正独立能力只有 12 项**（§6），另有 **10 类能力被 omp SDK 锁死**（§5，搬过来会造出 CLI 不认的平行配置）。
> 其余看起来没有的，绝大多数是我已经实现、只是叫法/位置不同（§7 列出 40 项对照）。

---

## 1. 底座差异（决定了哪些能搬）

| 维度 | 本仓库 | omp-web 0.4.4 |
| --- | --- | --- |
| SDK | `@earendil-works/pi-coding-agent` 0.85.1 | `@oh-my-pi/pi-coding-agent` **18.1.17**（源码 TS + `bun:` 内置模块） |
| 运行时 | Node ≥22.19 | 入口 Node/Bun，**服务端必须 Bun ≥1.3.14** |
| API 路由 | 59 | 47 |
| 组件 | 88 文件 | 43 文件 |
| i18n | 3 语言 / 871 key | 2 语言 / 522 key |
| 桌面壳 | Electron（`electron/main.js` 267 行，托盘 + 内嵌 next start） | Tauri v2（`src-tauri/`，随包 Bun，自更新 minisign） |
| 容器 | 无 | `Dockerfile` + `docker-compose.yml` + `docs/docker.md` |
| 测试 | 130 个独有 `.test.mjs` | 17 个独有（多为 SDK 契约测试） |
| 设置模型 | 手写 UI 偏好（localStorage）+ 5 个配置面板 | **CLI 设置 schema 驱动**（372 字段）+ 6 个配置面板 |

---

## 2. 它的设置弹窗长什么样

侧栏分两组（`components/SettingsConfig.tsx:335-338`）：

**Configuration（配置面板，6 个）**

| 面板 | 内容 | 我的对应物 |
| --- | --- | --- |
| Models | 左树 = Model roles / OAuth provider / API key provider / 自定义 provider+model；右侧详情 = provider 编辑、model 编辑、OAuth 登录、API key、Add provider | `ModelsConfig.tsx`（2170 行）**全覆盖**：provider 改名/删除/headers/Discover/API 选择、model 的 thinkingLevelMap、cost、context/maxTokens、image input、DeepSeek/developer compat、models.dev 目录填充与 Undo、Test、OAuth、API key（眼睛切换） |
| Themes | dark/light 映射两个 `SearchableSelect` + 色板预览 + `Active on web` 徽标 + `Preview` | `PiThemePicker` + `/api/themes`：按 **pi CLI 主题集**（`~/.pi/agent/themes`、项目 `.pi/themes`、内置注册表）选，比它多 |
| Skills | 来源分组（project/skills.sh/global/path）、Dormant 折叠区、`↑ update available`、Check/Update、Add skill（skills.sh 搜索 + global/project scope + 安装路径提示） | `SkillsConfig` + `/api/skills{,/search,/install,/check,/update}` **全覆盖**（含 dormancy 徽标与 `.test.mjs`） |
| Plugins | 安装（粘贴 `omp plugin add` 自动剥离）、scope、启用/禁用、Update、**Reload session**、Remove、只读信息网格、Resolved resources 分组、诊断悬浮 | `PluginsConfig` + `/api/plugins{,/check}` **全覆盖**（`onReloadSession`、resources 分组、scope 都在） |
| MCP | User/Project scope、外部来源只读徽标、ON/OFF 开关（改完自动 reload session）、JSON 编辑器、来源文件路径、headers/env/auth 脱敏 | `PluginsConfig` 的 MCP 区 + `/api/mcp`：scope、增删改启停、`test` 动作都有（脱敏粒度略粗） |
| Access | 密码开关、设置/替换/删除密码、`/recover` 入口、环境变量接管时只读 | **只有状态显示 + 登出**（`SettingsPanel.tsx:97-115`）→ §6 缺口 |

**OMP settings（10 个 tab，372 字段，全部由 SDK `SETTINGS_SCHEMA` 生成）**

| tab | 分组 | 字段数 | 组内有代表性的项 |
| --- | --- | --- | --- |
| appearance | Theme / Composer / Status Line / Display / Images | 34 | `theme.dark` `theme.light`、`hideThinkingBlock`、`display.showTokenUsage`、`display.showTurnTime`、`display.smoothStreaming`、`tui.renderMermaid`、`images.blockImages` |
| model | Thinking / Sampling / Prompt / Retry & Fallback / Advisor / Prewalk / Vision | 55 | `defaultThinkingLevel`、`temperature/topP/topK/minP`、服务分层、`retry.*` 全家、`model.loopGuard.*`、advisor、prewalk、图片 URL 服务 |
| interaction | Input / Approvals / Notifications / Speech / Collab / Magic Keywords / Startup & Updates / Power / Agent / Git | 48 | `steeringMode`、`followUpMode`、`doubleEscapeAction`、`tools.approval`、`completion.notify`、`stt.*`、`completion`/`error` 通知、`recap.*` |
| context | General / Compaction / Rules (TTSR) / Experimental | 29 | `workspace.additionalDirectories`、`compaction.*`（阈值/中回合/异步/空闲/交接文档）、TTSR 规则、snapcompact |
| memory | General / Auto-Learn / Mnemopi / Hindsight / Sharpshooter | 31 | memory backend、auto-learn、Mnemopi 17 项、Hindsight 9 项 |
| files | Editing / Reading / Read Summaries / LSP | 27 | `edit.mode`/模糊匹配、`read.*`、读摘要、LSP 7 项 |
| shell | Bash / Eval & Runtimes | 16 | `bash.patterns`、`bashInterceptor`、direnv、shell minimizer、python/js eval 后端 |
| tools | Available Tools / Todos / Grep & Browser / Computer / GitHub / Output Limits / Execution / Discovery & MCP / Extensions / Developer | 60 | **18 个工具逐个开关**、todo 提醒、browser 12 项、computer、artifact 输出上限、`mcp.*` |
| tasks | Modes / Subagents / Isolation / Commands & Skills | 33 | `plan.enabled`、`goal.enabled`、子代理并发/递归/预算、隔离后端、worktree 克隆 |
| providers | Services / Fireworks / Tiny Model / Protocol / Timeouts / Privacy | 39 | `providers.maxInFlightRequests`、web search 顺序、TTS/语音、`providers.streamIdleTimeoutSeconds`、`secrets.enabled` |

字段渲染只有 6 种控件（`app/api/settings/route.ts:49-58`）：boolean / select / text / **secret（永不回传值，只回 `configured`）** / multiselect（可 ←→ 排序）/ providerLimits（JSON）。字段可带 `condition` 动态显隐，逐字段即时保存，改完若需重载会话会给出提示与 `Reload session` 按钮（`SettingsConfig.tsx:256-267,309-315`）。

### 2.1 值得抄的交互细节（→ PR-07/08/11 口径）

| 细节 | 它的做法（`file:line`） | 我要不要抄 |
| --- | --- | --- |
| 搜索跨全部字段 | 匹配 `label + description + path + group`，命中数进标题 `Search · N`，忽略当前 tab（`SettingsConfig.tsx:248-254,270`） | **抄**（PR-08；我现在的搜索只覆盖 section 关键词 + 当前段落 DOM 文本） |
| 凭证契约 | 服务端对 `isCredential` 字段只回 `configured`，值永远 `null`；前端 placeholder `Configured — enter to replace`，留空不保存（`app/api/settings/route.ts:137-147`） | **抄**（PR-07；否则我会把 API key 回传到浏览器） |
| 需重载提示 | 保存后除了即时生效的键（`hideThinkingBlock`、主题）之外，一律置 `needsReload` 并显示横幅 + 按钮（`:220-243`） | **抄**（PR-08；pi 的 `defaultTools`/`enabledModels` 确实要重建会话） |
| 条件显隐 | `ui.condition` 驱动（如 `defaultThinkingLevel === "auto"` 才显示 auto 相关项）（`:66-79`） | 抄（PR-07 schema 里留 `condition` 字段） |
| JSON 控件二次校验 | `providerLimits` 前端解析失败即报错不保存，服务端再校验「正数 + 取整」（`:113-127`；route `:108-118`） | 抄（PR-07 的 record 类字段） |
| 危险操作无确认 | MCP `Delete`、Access `Remove password`、Plugins `Remove` 都是点击即执行 | **不抄**（PR-11 的删密码要二次确认） |
| 关闭面板不提示草稿 | Models 面板 `close` 直接丢弃本地草稿（`:255`） | **不抄**（PR-08 加 dirty 提示或自动保存） |
| 主题 `Preview` 名不副实 | 按钮实际是 `light→dark→auto` 循环，不保证切到字面对应模式（`:290`；`useTheme.ts:17,165+`） | 不抄（我已有明确的主题选择器） |
| 无 cwd 时禁用项目级面板 | Skills/Plugins 按钮 disabled，title 说明「X requires a project」（`:336`） | 抄（PR-08 的 section 可用性） |
| 移动端设置布局 | `<760px` 切窄图标侧栏 + 单列设置行（`SettingsConfig.module.css`） | 抄（PR-08；我有 mobile 断点，设置面板尚未做单列） |

其它可复用的交互细节：模型发现列表上限 300 条 + `select shown` 三态全选（`ModelsConfig.tsx:384-410,487-548`）；catalog 填充只填空字段、可 `Undo`、价格不可靠时橙色提示（`:792-829,930-962`）；MCP 外部来源只读但开关仍可点（`app/api/mcp/route.ts:132-167`）；`SearchableSelect` 的 Arrow/Enter/Esc 行为与弹层翻转（`SearchableSelect.tsx:97-118,137-154`）。

---

## 3. 设置面对比：我缺什么、我有等价物什么

### 3.1 结构性差异（最重要的一条）

它是**「CLI 配置的浏览器编辑器」**：写到 `~/.omp/agent/config.yml`（项目层 `.omp/config.yml` 覆盖），CLI 与 Web 共用同一份真相。
我是**两截**：

- 配置面板：`ModelsConfig` / `SkillsConfig` / `PluginsConfig`（含 MCP 区）/ `AgentsConfig` / 主题（在 General 段，`PiThemePicker`）→ 覆盖它的 6 个面板中的 5 个，**基本对齐**（差的只有 Access）；
- UI 偏好面板（外观、边框、字号、引用、PowerShell、推送、声音…）→ 存在浏览器 `localStorage`，**与 pi CLI 的 `settings.json` 无关**。

**我没有任何「编辑 pi CLI 设置」的入口**：`grep -rn "settings.json"` 只有 `powershell-settings.ts`（只改 `defaultTools` 里的 powershell 项）与各面板的资源写入；`lib/startup-preferences.ts` 只在建会话时写默认模型/思考档。pi 的 `docs/settings.md` 里有 ~60 个键（thinkingBudgets、hideThinkingBlock、showCacheMissNotices、retry.*、compaction.*、enabledModels、defaultTools、sessionDir、markdown.mermaid、images.*、httpProxy、shellPath…），**目前只能手改 JSON**。

### 3.2 逐项对照（它有的设置能力 → 我的状态）

| # | 它的能力 | 我的状态 |
| --- | --- | --- |
| 1 | schema 驱动的通用设置编辑器（372 字段、10 tab、分组、条件显隐） | ✗ **无**（pi SDK 无 schema；要手写精选 schema） |
| 2 | 跨 tab 字段搜索（匹配 label+description+path） | △ 只有 section 关键词 + 当前 section DOM 文本高亮（`SettingsPanel.tsx:479-491,540-565`） |
| 3 | secret 类型永不回传（只回 configured） | △ `ModelsConfig` 的 key 输入有显隐切换，但无统一契约 |
| 4 | 逐字段保存 + 「需重载会话」提示 + Reload session | △ 我有 `reload` 动作，但设置面板没有这个提示链 |
| 5 | `providers.maxInFlightRequests`（每 provider 并发上限） | ✗ 无（pi 也没这个设置，属 omp SDK） |
| 6 | 模型角色面板（10 角色 × 模型 × 思考档，写 CLI 配置） | ✗ 无（§5） |
| 7 | Access 密码面板 | ✗ 缺（§6-1） |
| 8 | `/recover` 恢复码 | ✗ 缺（§6-2） |
| 9 | 更新对话框（changelog + 一键安装 + 复制命令） | △ 只有「版本号 + 跳 release」链接（§6-3） |
| 10 | 主题 dark/light 映射写回 CLI | ✓ 等价且更强：我按 pi 主题集切换 |
| 11 | MCP user/project scope + 外部来源只读 + 开关即 reload | ✓ 我有 scope 与启停（外部来源徽标/脱敏粒度略弱） |
| 12 | Skills 更新检查 / scope 安装 / dormant | ✓ 全有 |
| 13 | Plugins Reload session / resolved resources / 诊断 | ✓ 全有 |
| 14 | Models：thinkingLevelMap、cost、catalog 填充、Test、Discover、OAuth、API key | ✓ 全有 |
| 15 | 显示设置（`hideThinkingBlock` 等）从服务端下发 | ✗ 缺（§6-4） |
| 16 | 设置里的「搜到即可跳」空态/分组顺序/新 group 追加 | △ 只在 General 段落生效 |

---

## 4. 聊天面：它有的（按可移植性标注）

**共通（我已有，略）**：图片附件（10 张/10MB）、粘贴与拖拽图片、草稿持久化、发送/停止、steer/follow-up 排队 + 召回、`!`/`!!` bash 模式（含 `excludeFromContext`）、slash 面板（分组 + skill dormant；内置 `/compact` `/auto-compact` `/reload` `/name` `/session` `/copy` `/clone`）、@ 文件提及（大仓 fallback + 引号路径 + `@path:start-end` 行区间）、输入历史（↑）、压缩按钮与横幅、自动重试横幅、回合折叠（user 锚点 + 过程分组）、最终答案拆分、懒加载历史 50 条/页、写入文件卡、thinking 懒加载接口、扩展 UI（select/confirm/input/editor/custom）、扩展状态栏与 widget、分支导航、完成音、浏览器通知、消息复制、代码块/Mermaid/KaTeX、行内 diff、usage/cost 行、上下文仪表、NoticeShelf、会话统计面板（含 cache 命中率）。

| 能力 | 依赖 | 我的状态 |
| --- | --- | --- |
| 流式估算 token + **t/s 速率徽章**（≥50/≥30/≥15 三档配色） | 通用 | ✗ 缺（§6-5） |
| `ask` 多问题交互卡（推荐答案、preview、Chat about this、Cmd+Enter 提交） | omp 扩展协议 | △ 我有通用 ExtensionDialog，但没有 `ask`/多问题表单形态 |
| `plan_review` 计划审批卡（Markdown 计划 + Refine/Approve + 反馈） | omp 扩展协议 | △ 同上 |
| Goal 模式（`/goal`、预算、自动续跑、GoalBar、跨进程恢复） | omp SDK `goals/state` | ✗ 无（§5） |
| 模型选择器按**角色**分组 | omp SDK | △ 我有模型作用域警告，无角色 |
| Auto 思考显示**生效档位**（`auto (high)`，每回合由 omp 解析） | omp SDK（`AUTO_THINKING` + 解析链） | ✗ **不可移植**：pi 侧 `auto` 只是「不改 CLI 设置」的客户端占位，没有解析出来的档位可显示 |
| 工具预设 off/default/full | omp 工具名 | ✓ 我更强（NONE/READ_ONLY/DEFAULT/FULL + 会话级持久化） |
| `/handoff`（原地换上下文） | omp 内置命令 | ✗ pi 侧为示例扩展命令，非内置 |
| bash 大输出 `view/download full output` | 通用 | ✓ 全有（同一路由名 + 引用校验） |
| SubagentPanel（running/history、1s 增量 transcript、跟随尾部） | omp 事件 | ✓ 我更强（AgentSessionPanel + subagent-runtime/queue/profile） |
| 输入框 placeholder 三态、IME 组合保护、弹层自动翻转 | 通用 | ✓ 全有 |

---

## 5. 被 omp SDK 锁死的 10 类（不建议搬）

模型角色 · Goal 模式 · CLI 设置 schema（372 字段的真相源） · Advisor（每回合二审模型） · Prewalk（强模型规划后移交廉价模型） · Memory 后端（Mnemopi/Hindsight/Auto-Learn） · STT/TTS/语音 · 18 个工具开关与 approval 策略 · snapcompact/TTSR/loop guard/LSP 等 omp 内部机制 · **Auto 思考的生效档位显示**（omp 每回合解析出 effort；pi 的 `auto` 仅是客户端占位，无值可显）。

共同理由：本仓库 SDK 是 `@earendil-works/pi-coding-agent` 0.85.1，`grep -i "modelRole\|goals/state\|SETTINGS_SCHEMA\|mcpPrompt"` **零命中**；硬搬只能造出 CLI 不读的平行配置。若真想要「角色」体验，正确做法是 web 侧「模型预设组」（见 PR-17）。

---

## 6. 真正的独立缺口（12 项，可搬）

| # | 缺口 | 它的实现 | 我的现状 | 量级 |
| --- | --- | --- | --- | --- |
| 1 | 运行中会话 **SSE 推送** | `api/agent/running/events` + `subscribeRunningSessions` | 每 2.5s 轮询 `/api/agent/running` | M |
| 2 | 侧栏**项目折叠** | `omp-web:collapsed-projects` + chevron | 无 | S |
| 3 | 侧栏**移除项目**（只本地隐藏） | `omp-web:removed-projects` + 红字菜单项 | 无（且它没有恢复入口） | S |
| 4 | **fork 家族折叠** | 会话行 chevron + 折叠态 | 有 `lib/session-family.ts` 数据，无折叠 UI | S |
| 5 | **流式 t/s 徽章** | `MessageView` 估算 token/秒 + 三档配色 | 无 | S |
| 6 | **pi CLI 设置编辑器** | schema 驱动 372 字段 | 无（只能手改 settings.json） | L |
| 7 | **密码锁完整版**（scrypt 落盘 + 面板 + CLI flag） | `bin/web-auth-store.js` 550 行 + `AccessConfig` 248 行 | 只有 `PI_WEB_PASSWORD` 环境变量 + 会话 cookie，改密码要重启 | M |
| 8 | **`/recover` 恢复码**（控制台一次性码） | `app/recover/page.tsx` + recovery API | 无 | M |
| 9 | **更新对话框**（release changelog + 复制命令 + 一键安装） | `lib/omp-updates.ts` 284 + `OmpUpdateIndicator` 280 | 只有版本号 + 外链 | M |
| 10 | **项目级活动徽标**（运行中数量 / 未读数量） | `showProjectActivity` | 只有会话级 running/unread | S |
| 11 | **Docker 部署** | Dockerfile + compose + 文档 | 无 | S |
| 12 | **`ask` / `plan_review` 交互卡**（多问题表单形态） | `ChatWindow.tsx` 976-1330 | 通用 ExtensionDialog 已有 4 种 method，缺这两种富形态 | L（且收益取决于扩展生态） |

---

## 7. 我有、它没有（避免重复劳动 / 我方领先）

| 面 | 我方独有 |
| --- | --- |
| 终端 | xterm + node-pty（`TerminalPanel`/`lib/terminal-manager.ts`） |
| 子代理 | `AgentSessionPanel`/`AgentsConfig`/`subagent-runtime`/queue/prompt/isolation（603+587+… 行） |
| 外观 | 主题集 + 壁纸（`WallpaperLayer`/`WallpaperSettings`/`PiThemePicker`）、边框层次（`useBorderDepth`） |
| 面板 | `BrowserPanel`、`chat-workspace`（独立聊天工作区）、`ChatMinimap`、`TabBar` 多类型 tab（file/browser/markdown/terminal） |
| 编辑器 | `MarkdownFileEditor` + `CodeFileEditor`（WYSIWYG 保存）、`MarkdownFilePreview` |
| 工具 | `ToolDefinitionsPanel`（逐个工具的参数说明）、`ProcessGroup` 步骤归类（tabs/inline 两种渲染） |
| 通知 | Web Push（`app/api/push/*` + `lib/web-push.ts`） |
| 用量 | Provider 用量查询（`ProviderUsageSummary` + `/api/provider-usage/query`） |
| 交互 | 引用选中文本（`quoted-selection` + `ComposerContextStrip`）、`apply-patch`、提示词恢复（`prompt-recovery`） |
| 会话 | 会话搜索（`SessionSearch` + `/api/sessions/search`）、pin/archive（`session-flags`）、`session-stats`、**列表虚拟滚动**（它每项目只渲染 5 条 + Show more，我按视口高度窗口化） |
| 平台 | PowerShell 工具开关（`powershell-settings`）、三语 i18n（871 key）、PWA（`sw.js` + `offline.html` 已具备） |

> 注：PWA、音频/图片/PDF/DOCX 预览、文件外部写入 watch、上传冲突策略（error/overwrite/skip）、256KB/10MB 预览上限、`@path:start-end` 行区间引用、文件访问的「会话引用豁免」——**我全部已有**，不必再搬。

---

## 8. 建议

1. **先做 §6 的 S 级 5 项**（项目折叠/移除、fork 折叠、t/s 徽章、项目徽标）——纯前端、零 SDK 依赖。
2. **再做 SSE 推送**（§6-1）——去掉常驻轮询，顺带修好后台标签页的运行态。
3. **设置编辑器**（§6-6）是本次对比里唯一的结构性差距：pi SDK 没有 schema，需要手写一份**精选** schema（建议先 20-25 项高价值键：思考/显示、retry、compaction、enabledModels、defaultTools、markdown、images、sessionDir、httpProxy），做成独立的「pi 设置」section。
4. **密码锁三件套**（§6-7/8）按需做，只在把端口暴露到 LAN/反代时才必要。
5. **§5 的 9 类别照搬**；真要「角色」，走 PR-17 的 web 侧预设组。

---

## 附录 A：omp-web 设置面板的全部 372 个字段

> 来源：`@oh-my-pi/pi-coding-agent@18.1.17` 的 `src/config/settings-schema.ts`（`SETTINGS_SCHEMA` 中带 `ui` 元数据的项），
> 即 omp-web 设置弹窗会渲染的全部字段（tab 顺序 = schema 文件中的出现顺序，group 顺序 = `TAB_GROUPS`）。


### tab `interaction` · 交互 Interaction（48 字段 / 10 分组）

**Startup & Updates**

- Auto Resume — `autoResume`
- Quiet Startup — `startup.quiet`
- Show Startup Splash — `startup.showSplash`
- Setup Wizard — `startup.setupWizard`
- Check for Updates — `startup.checkUpdate`
- Update Channel — `update.channel`
- Marketplace Auto-Update — `marketplace.autoUpdate`
- Startup Changelog — `startup.changelogMode`

**Power**

- Sleep Prevention — `power.sleepPrevention`

**Git**

- Enable Git Integration — `git.enabled`

**Input**

- Steering Mode — `steeringMode`
- Follow-Up Mode — `followUpMode`
- Interrupt Mode — `interruptMode`
- Vim Editing Mode — `tui.vimMode`
- Vim Mode Indicator — `tui.vimModeDisplay`
- Loop Mode — `loop.mode`
- Loop Condition Timeout (ms) — `loop.conditionTimeoutMs`
- Recall Cleared Drafts — `composer.recallClearedDrafts`
- Double-Escape Action — `doubleEscapeAction`
- Session Tree Filter — `treeFilterMode`
- Autocomplete Items — `autocompleteMaxVisible`
- Typo Detection (macOS) — `spelling.typoDetection`
- Word Autocomplete (macOS) — `spelling.autocomplete`
- Autocorrect (macOS) — `spelling.autocorrect`
- Emoji Autocomplete — `emojiAutocomplete`
- Large Paste Menu — `paste.largeMenuThreshold`

**Magic Keywords**

- Magic Keywords — `magicKeywords.enabled`
- Ultrathink Keyword — `magicKeywords.ultrathink`
- Orchestrate Keyword — `magicKeywords.orchestrate`
- Workflow Keyword — `magicKeywords.workflow`

**Notifications**

- Completion Notification — `completion.notify`
- Error Notification — `error.notify`
- Ask Timeout — `ask.timeout`
- Ask Notification — `ask.notify`
- Idle Recap — `recap.enabled`
- Idle Recap Delay — `recap.idleSeconds`

**Collab**

- Relay URL — `collab.relayUrl`
- Web UI URL — `collab.webUrl`
- Display Name — `collab.displayName`
- Share Server — `share.serverUrl`
- Share Store — `share.store`
- Share Secret Redaction — `share.redactSecrets`

**Speech**

- Speech-to-Text — `stt.enabled`
- Speech Model — `stt.modelName`
- Speech-to-Text Submit Trigger — `stt.submitTrigger`

**Approvals**

- Tool Approval Policies — `tools.approval`
- Tool Approval — `tools.approvalMode`

**Agent**

- Unexpected Stops — `features.unexpectedStopDetection`


### tab `model` · 模型 Model（55 字段 / 7 分组）

**Advisor**

- Enable Advisor — `advisor.enabled`
- Advisor Sync Backlog — `advisor.syncBacklog`
- Advisor Immune Turns — `advisor.immuneTurns`
- Advisor Max Notes Per Update — `advisor.maxNotesPerUpdate`

**Prewalk**

- Enable Prewalk — `prewalk.enabled`

**Prompt**

- Model Role Storage — `modelRoleStorage`
- Inline Tool Descriptors — `inlineToolDescriptors`
- Include Model in Prompt — `includeModelInPrompt`
- Include Workspace Tree — `includeWorkspaceTree`
- List Skills in Prompt — `skillful`
- Personality — `personality`

**Vision**

- Describe Images for Text Models — `images.describeForTextModels`
- Serve Images as URLs — `images.urls.enabled`
- Image URL Backends — `images.urls.backends`
- Image Upload Command — `images.urls.command`
- Image URL Public Base — `images.urls.publicBaseUrl`
- Image URL Lifetime (hours) — `images.urls.ttlHours`
- Image URL Bind Host — `images.urls.bindHost`
- Image URL SSH Target — `images.urls.sshTarget`
- Image URL SSH Remote Port — `images.urls.sshRemotePort`

**Thinking**

- Thinking Level — `defaultThinkingLevel`
- Hide Thinking Blocks — `hideThinkingBlock`
- Prose Only Thinking — `proseOnlyThinking`
- Omit Thinking summaries — `omitThinking`
- External Thinking — `externalThinking`
- Loop Guard — `model.loopGuard.enabled`
- Loop Guard Scan Prose — `model.loopGuard.checkAssistantContent`
- Loop Guard Tool-Call Reminder — `model.loopGuard.toolCallReminder`
- Tool-Call Loop Guard — `model.toolCallLoopGuard.enabled`
- Tool-Call Loop Threshold — `model.toolCallLoopGuard.threshold`
- Tool-Call Loop Exempt Tools — `model.toolCallLoopGuard.exemptTools`
- Auto Thinking Model — `providers.autoThinkingModel`
- Auto Thinking Ceiling — `providers.autoThinkingMaxEffort`

**Sampling**

- Temperature — `temperature`
- Top P — `topP`
- Top K — `topK`
- Min P — `minP`
- Presence Penalty — `presencePenalty`
- Repetition Penalty — `repetitionPenalty`
- Text Verbosity — `textVerbosity`
- Service Tier — OpenAI — `tier.openai`
- Service Tier — Anthropic — `tier.anthropic`
- Service Tier — Google — `tier.google`
- Service Tier — Subagent — `tier.subagent`
- Service Tier — Advisor — `tier.advisor`

**Retry & Fallback**

- Retry Attempts — `retry.maxRetries`
- Max Retry Delay — `retry.maxDelayMs`
- Wait For Usage Reset — `retry.waitForUsageReset`
- Retry Model Fallback — `retry.modelFallback`
- Usage-Aware Fallback — `retry.usageAwareFallback`
- Reserve Margin — `retry.usageReservePct`
- Reserve Policy — `retry.usageReservePolicy`
- Retry Fallback Chains — `retry.fallbackChains`
- Fallback Revert Policy — `retry.fallbackRevertPolicy`
- Anthropic Server-Side Fallback (Fable 5) — `providers.anthropic.serverSideFallback`


### tab `providers` · 供应商 Providers（39 字段 / 6 分组）

**Services**

- Max In-Flight Requests — `providers.maxInFlightRequests`
- Codex Code Mode — `providers.openai-codex.codeMode`
- Codex Code Mode Direct Tools — `providers.openai-codex.codeModeDirectTools`
- Ollama Cloud Max Concurrency — `providers.ollama-cloud.maxConcurrency`
- Web Search Provider Order — `providers.webSearchOrder`
- Excluded Web Search Providers — `providers.webSearchExclude`
- Web Search Timeout — `providers.webSearchTimeoutSeconds`
- Gemini web_search model — `providers.webSearchGeminiModel`
- Antigravity Endpoint Mode — `providers.antigravityEndpoint`
- Image Provider Order — `providers.imageOrder`
- Live Voice — `live.voice`
- Text-to-Speech Provider — `providers.tts`
- Local TTS Model — `tts.localModel`
- Local TTS Voice — `tts.localVoice`
- Speech Vocalization — `speech.enabled`
- Speech Vocalization Mode — `speech.mode`
- Enhanced Speech Rewriting — `speech.enhanced`
- Speech Vocalization Voice — `speech.voice`
- Fetch Provider — `providers.fetch`
- Codex Auto-Redeem Saved Resets — `codexResets.autoRedeem`
- Codex Auto-Redeem Min Block — `codexResets.minBlockedMinutes`
- Codex Auto-Redeem Reserve — `codexResets.keepCredits`
- Codex Reset Salvage Horizon — `codexResets.salvageHorizonHours`
- Exa — `exa.enabled`
- Exa Search Delay — `exa.searchDelayMs`
- SearXNG Endpoint — `searxng.endpoint`

**Privacy**

- Hide Secrets — `secrets.enabled`

**Fireworks**

- Fireworks Tier — `providers.fireworksTier`

**Tiny Model**

- Tiny Model — `providers.tinyModel`
- Tiny Model Device — `providers.tinyModelDevice`
- Tiny Model Precision — `providers.tinyModelDtype`
- Unexpected Stop Model — `providers.unexpectedStopModel`

**Protocol**

- Kimi API Format — `providers.kimiApiFormat`
- OpenAI WebSockets — `providers.openaiWebsockets`
- Prompt Cache Retention — `providers.cacheRetention`
- OpenRouter Routing — `providers.openrouterVariant`
- Append-Only Context — `provider.appendOnlyContext`

**Timeouts**

- Stream First Event Timeout — `providers.streamFirstEventTimeoutSeconds`
- Stream Idle Timeout — `providers.streamIdleTimeoutSeconds`


### tab `appearance` · 外观 Appearance（34 字段 / 5 分组）

**Theme**

- Dark Theme — `theme.dark`
- Light Theme — `theme.light`
- Symbol Preset — `symbolPreset`
- Color-Blind Mode — `colorBlindMode`

**Composer**

- Composer Shape — `composer.shape`

**Status Line**

- Status Line Preset — `statusLine.preset`
- Status Line Separator — `statusLine.separator`
- Context-Reactive Line — `statusLine.contextLine`
- Session Accent — `statusLine.sessionAccent`
- Transparent Status Line — `statusLine.transparent`
- Compact Thinking Level — `statusLine.compactThinkingLevel`
- Show Hook Status — `statusLine.showHookStatus`

**Images**

- Show Inline Images — `terminal.showImages`
- Auto-Resize Images — `images.autoResize`
- Block Images — `images.blockImages`

**Display**

- Resize Scrollback — `tui.resizeScrollback`
- Native Terminal Progress — `terminal.showProgress`
- Large Headings (Kitty) — `tui.textSizing`
- Render Mermaid Diagrams — `tui.renderMermaid`
- Agent Reactions — `tui.reactions`
- Codex Reset Fireworks — `tui.codexResetFireworks`
- Terminal Title Run State — `tui.titleState`
- Terminal Hyperlinks — `tui.hyperlinks`
- Tight Layout — `tui.tight`
- Shimmer — `display.shimmer`
- Smooth Streaming — `display.smoothStreaming`
- Hide Tool Activity — `display.hideToolActivity`
- Show Token Usage — `display.showTokenUsage`
- Show Turn Time — `display.showTurnTime`
- Cache Miss Marker — `display.cacheMissMarker`
- Collapse Compacted History — `display.collapseCompacted`
- Show Hardware Cursor — `showHardwareCursor`
- IME-Safe Prompt Layout — `tui.imeSafeCursor`
- Show Resolved Model Badge — `task.showResolvedModelBadge`


### tab `tools` · 工具 Tools（60 字段 / 10 分组）

**Output Limits**

- Artifact Spill Threshold (KB) — `tools.artifactSpillThreshold`
- Artifact Tail Size (KB) — `tools.artifactTailBytes`
- Artifact Head Size (KB) — `tools.artifactHeadBytes`
- Output Column Cap — `tools.outputMaxColumns`
- Artifact Tail Lines — `tools.artifactTailLines`

**Available Tools**

- Todos — `todo.enabled`
- Glob — `glob.enabled`
- Grep — `grep.enabled`
- AST Grep — `astGrep.enabled`
- AST Edit — `astEdit.enabled`
- Debug — `debug.enabled`
- Launch — `launch.enabled`
- Speech Generation — `speechgen.enabled`
- Generate Image — `generate_image.enabled`
- Computer — `computer.enabled`
- Checkpoint/Rewind — `checkpoint.enabled`
- Read URLs — `fetch.enabled`
- Obsidian Vault — `vault.enabled`
- GitHub CLI — `github.enabled`
- Web Search — `web_search.enabled`
- Security — `security.enabled`
- Ask — `ask.enabled`
- Browser — `browser.enabled`

**Todos**

- Todo Reminders — `todo.reminders`
- Todo Reminder Limit — `todo.remindersMax`
- Create Todos Automatically — `todo.eager`
- Todo Auto-Clear Delay — `tasks.todoClearDelay`

**Grep & Browser**

- Grep Context Before — `grep.contextBefore`
- Grep Context After — `grep.contextAfter`
- Browser CDP URL — `browser.cdpUrl`
- Browser Relay — `browser.relay`
- Browser Relay URL — `browser.relayUrl`
- Headless Browser — `browser.headless`
- cmux Browser — `browser.cmux`
- Freeze Browser Tabs On Turn End — `browser.freezeOnTurnEnd`
- Browser Idle Close Timeout — `browser.idleCloseSec`
- Screenshot Directory — `browser.screenshotDir`

**Computer**

- Computer Display — `computer.display`
- Computer Screenshot Width — `computer.maxWidth`
- Computer Screenshot Height — `computer.maxHeight`

**Execution**

- Image Question Timeout — `images.questionTimeoutMs`
- Intent Tracing — `tools.intentTracing`
- Abort On Fabricated Tool Result — `tools.abortOnFabricatedResult`
- Max Tool Timeout — `tools.maxTimeout`
- Async Execution — `async.enabled`
- Max Poll Time — `async.pollWaitDuration`
- IRC Timeout — `irc.timeoutMs`

**GitHub**

- GitHub View Cache — `github.cache.enabled`
- GitHub Cache Soft TTL — `github.cache.softTtlSec`
- GitHub Cache Hard TTL — `github.cache.hardTtlSec`

**Discovery & MCP**

- xd:// Tools — `tools.xdev`
- xd:// Prompt Docs — `tools.xdevDocs`
- xd:// Inline Devices — `tools.xdevInlineDevices`
- MCP Project Config — `mcp.enableProjectConfig`
- MCP Markdown Results — `mcp.renderMarkdownResults`
- MCP Update Injection — `mcp.notifications`
- MCP Notification Debounce — `mcp.notificationDebounceMs`

**Extensions**

- Tool Call Handler Timeout (ms) — `extensionHandlers.toolCallTimeoutMs`

**Developer**

- Auto QA — `dev.autoqa`
- Auto QA Push Endpoint — `dev.autoqaPush.endpoint`


### tab `context` · 上下文 Context（29 字段 / 4 分组）

**General**

- Additional Workspace Dirs — `workspace.additionalDirectories`
- Auto-Promote Context — `contextPromotion.enabled`
- Extended Context — `extendedContext`
- Branch Summaries — `branchSummary.enabled`

**Compaction**

- Auto-Compact — `compaction.enabled`
- Notes-backed context windows (experimental) — `compaction.experimentalContextManagement`
- Mid-Turn Compaction — `compaction.midTurnEnabled`
- Compaction Method Order — `compaction.methodOrder`
- Compaction Threshold — `compaction.thresholdPercent`
- Compaction Token Limit — `compaction.thresholdTokens`
- Save Handoff Docs — `compaction.handoffSaveToDisk`
- Remote Compaction V2 — `compaction.remoteStreamingV2Enabled`
- Async Compaction — `compaction.asyncEnabled`
- Idle Compaction — `compaction.idleEnabled`
- Idle Compaction Threshold — `compaction.idleThresholdTokens`
- Idle Compaction Delay — `compaction.idleTimeoutSeconds`
- Supersede Stale Reads — `compaction.supersedeReads`
- Elide Uneventful Results — `compaction.dropUseless`

**Experimental**

- Snapcompact System Prompt — `snapcompact.systemPrompt`
- Snapcompact Tool Results — `snapcompact.toolResults`
- Tool Calling Mode — `tools.format`
- Snapcompact Shape — `snapcompact.shape`

**Rules (TTSR)**

- TTSR — `ttsr.enabled`
- TTSR Context Mode — `ttsr.contextMode`
- TTSR Interrupt Mode — `ttsr.interruptMode`
- TTSR Repeat Mode — `ttsr.repeatMode`
- TTSR Repeat Gap — `ttsr.repeatGap`
- Built-in Rules — `ttsr.builtinRules`
- Disabled Rules — `ttsr.disabledRules`


### tab `memory` · 记忆 Memory（31 字段 / 5 分组）

**General**

- Memory Backend — `memory.backend`
- Memory Model — `providers.memoryModel`

**Sharpshooter**

- Sharpshooter Model — `sharpshooter.model`

**Auto-Learn**

- Auto-Learn (experimental) — `autolearn.enabled`
- Auto-run capture at stop — `autolearn.autoContinue`

**Mnemopi**

- Mnemopi DB Path — `mnemopi.dbPath`
- Mnemopi Bank — `mnemopi.bank`
- Mnemopi Scoping — `mnemopi.scoping`
- Embedding variant — `mnemopi.embeddingVariant`
- Mnemopi Auto Recall — `mnemopi.autoRecall`
- Mnemopi Auto Retain — `mnemopi.autoRetain`
- Mnemopi Polyphonic Recall — `mnemopi.polyphonicRecall`
- Mnemopi Enhanced Recall — `mnemopi.enhancedRecall`
- Mnemopi Proactive Linking — `mnemopi.proactiveLinking`
- Mnemopi Disable Embeddings — `mnemopi.noEmbeddings`
- Mnemopi Embedding Model — `mnemopi.embeddingModel`
- Mnemopi Embedding API URL — `mnemopi.embeddingApiUrl`
- Mnemopi Embedding API Key — `mnemopi.embeddingApiKey`
- Mnemopi LLM Mode — `mnemopi.llmMode`
- Mnemopi LLM Base URL — `mnemopi.llmBaseUrl`
- Mnemopi LLM API Key — `mnemopi.llmApiKey`
- Mnemopi LLM Model — `mnemopi.llmModel`

**Hindsight**

- Hindsight API URL — `hindsight.apiUrl`
- Hindsight API Token — `hindsight.apiToken`
- Hindsight Bank ID — `hindsight.bankId`
- Hindsight Scoping — `hindsight.scoping`
- Hindsight Auto Recall — `hindsight.autoRecall`
- Hindsight Auto Retain — `hindsight.autoRetain`
- Hindsight Retain Mode — `hindsight.retainMode`
- Hindsight Mental Models — `hindsight.mentalModelsEnabled`
- Hindsight Mental Model Auto-Seed — `hindsight.mentalModelAutoSeed`


### tab `files` · 文件 Files（27 字段 / 4 分组）

**Editing**

- Edit Mode — `edit.mode`
- Fuzzy Match — `edit.fuzzyMatch`
- Fuzzy Match Threshold — `edit.fuzzyThreshold`
- Abort on Failed Preview — `edit.streamingAbort`
- Recover Inline Edit Payloads — `edit.recoverInlineEdits`
- Block Auto-Generated Files — `edit.blockAutoGenerated`
- Enforce Seen-Line Guard — `edit.enforceSeenLines`
- Record Parse Regressions — `edit.blackbox.enabled`
- Auto-Repair Parse Regressions — `edit.autoRepair.enabled`

**Reading**

- Line Numbers — `readLineNumbers`
- Default Read Limit — `read.defaultLimit`
- Markdown Previews — `read.renderMarkdown`
- Inline Read Previews — `read.toolResultPreview`

**Read Summaries**

- Read Summaries — `read.summarize.enabled`
- Prose Summaries — `read.summarize.prose`
- Read Summary Body Lines — `read.summarize.minBodyLines`
- Read Summary Comment Lines — `read.summarize.minCommentLines`
- Read Summary Minimum File Length — `read.summarize.minTotalLines`
- Read Summary Unfold Target — `read.summarize.unfoldUntil`
- Read Summary Unfold Ceiling — `read.summarize.unfoldLimit`

**LSP**

- LSP — `lsp.enabled`
- Lazy LSP Startup — `lsp.lazy`
- Shared Language Servers — `lsp.shared`
- Format on Write — `lsp.formatOnWrite`
- Diagnostics on Write — `lsp.diagnosticsOnWrite`
- Diagnostics on Edit — `lsp.diagnosticsOnEdit`
- Deduplicate Diagnostics — `lsp.diagnosticsDeduplicate`


### tab `shell` · Shell（16 字段 / 2 分组）

**Bash**

- Bash — `bash.enabled`
- Allow Compound Commands — `bash.allowCompoundCommands`
- Bash Auto-Background — `bash.autoBackground.enabled`
- Bash Approval Patterns — `bash.patterns`
- Bash Interceptor — `bashInterceptor.enabled`
- direnv Auto-Load — `bash.direnv`
- direnv Load Timeout (ms) — `bash.direnvLoadTimeoutMs`
- Shell Minimizer — `shellMinimizer.enabled`
- Shell Minimizer Source Outline — `shellMinimizer.sourceOutlineLevel`

**Eval & Runtimes**

- Python Eval Backend — `eval.py`
- JavaScript Eval Backend — `eval.js`
- Eval-Defined Tools — `eval.tools.enabled`
- Fresh Workpool Agents — `eval.workpool.freshAgents`
- Eval Auto-Background — `eval.autoBackground.enabled`
- Python Kernel Mode — `python.kernelMode`
- Python Interpreter — `python.interpreter`


### tab `tasks` · 任务 Tasks（33 字段 / 4 分组）

**Modes**

- Plan Mode — `plan.enabled`
- Start in Plan Mode — `plan.defaultOnStartup`
- Autosave Plans — `plan.autosave`
- Autosave Directory — `plan.autosaveDir`
- Goal Mode — `goal.enabled`
- Goal Status in Footer — `goal.statusInFooter`
- Goal Continuation Modes — `goal.continuationModes`
- Refresh Title on Replan — `title.refreshOnReplan`

**Isolation**

- Isolate Subagents — `task.isolation.enabled`
- Isolation Backend — `isolation.backend`
- Clone Checkout into Worktrees — `worktree.clone`
- Clean Source Checkout on /wt — `worktree.cleanSource`
- Apply Isolated Changes — `task.isolation.apply`
- Isolation Merge Strategy — `task.isolation.merge`
- Isolation Commit Style — `task.isolation.commits`
- Worktree Base Directory — `worktree.base`

**Subagents**

- Prefer Task Delegation — `task.eager`
- Batch Task Calls — `task.batch`
- Per-Task Effort — `task.enableEffort`
- Max Concurrent Tasks — `task.maxConcurrency`
- LSP in Subagents — `task.enableLsp`
- Max Task Recursion — `task.maxRecursionDepth`
- Max Subagent Runtime — `task.maxRuntimeMs`
- Agent Idle TTL — `task.agentIdleTtlMs`
- Soft Subagent Request Budget — `task.softRequestBudget`
- Soft Request Budget Notice — `task.softRequestBudgetNotice`
- Maximum Per-Spawn Effort — `task.maxEffort`
- Generic Task Prewalk — `task.prewalk`

**Commands & Skills**

- Skill Commands — `skills.enableSkillCommands`
- Claude User Commands — `commands.enableClaudeUser`
- Claude Project Commands — `commands.enableClaudeProject`
- OpenCode User Commands — `commands.enableOpencodeUser`
- OpenCode Project Commands — `commands.enableOpencodeProject`

