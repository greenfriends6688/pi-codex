# pi-web-0.9.0 vs Proma-main · 六大重点问题优化文档

日期：2026-09-18
对象：`pi参考项目/Proma-main`（Proma 开源版，`apps/electron` 0.19.55）vs 本仓库 `@agegr/pi-web` 0.9.1（`electron/main.js` 桌面壳 + Next.js Web）
方法：三路并行只读调研（Proma 架构 / pi-web 架构 / 六大根因）+ 主会话直接复核关键文件行号
配套（不再重复）：[`proma-comparison-2026-09-18.md`](./proma-comparison-2026-09-18.md)（全量 28 项可搬/7 项换引擎/5 项桌面绑定）+ [`proma-pr-plan-2026-09-18.md`](./proma-pr-plan-2026-09-18.md)（PR 拆分与上游合并纪律）

> 一句话结论：两者是**同一 pi SDK 0.85.1 上的两种架构**。Proma 是 `Vite 纯静态 + 主进程 IPC`（打包后无服务器依赖）；pi-web 是 **`Electron 壳里跑 next start` 的全栈 Web**（所有按钮都是 HTTP `/api/*`，服务器起不来就集体失效）。Markdown 慢是“热路径太重 + 无隔离”，打包失效是“按纯前端壳打包全栈应用”，文件树/记忆/定时/思考四项是“有骨架、缺产品化打磨”。

---

## 0. 底座一句话（修任何东西之前先对齐）

| 维度 | pi-web-0.9.0（本仓库） | Proma-main（参考） |
| --- | --- | --- |
| 形态 | Web 优先，`next start -H 127.0.0.1 -p 30141`；Electron 只是壳（`electron/main.js` 485 行，随机端口 `listen(0)` + `loadURL(127.0.0.1:port)`） | 桌面优先，`Vite build → dist/renderer` 纯静态，打包后 `loadFile`，无本地 HTTP 服务器（`src/main/index.ts:516-517`） |
| Agent loop | pi SDK `AgentSession`，`lib/rpc-manager.ts`（`globalThis.__piSessions` + 10 分钟 idle + fork 后立即 `destroy()`） | 自研 orchestrator 2374 行 + 自研 provider 适配 + UtilityProcess 常驻（`agent-runtime.cjs`） |
| 前↔后 | HTTP `/api/*` 约 60 个路由；`electron/preload.js` 仅 36 行（notify/badge/keepAwake/openExternal/revealPath/onAction），无业务 IPC | `preload/index.ts` 3114 行全量 IPC（`AGENT/CHANNEL/CHAT/AUTOMATION/PLANNING/VAULT/TERMINAL`）+ `ipc.ts` 373 处 `handle` + 自有 `proma-file://` token 协议 |
| 打包 | `package.json build`：`asar:false`，`mac.target:["dir"]`（**连 dmg 都不打**），`after-pack.mjs` 注入 `.next/node_modules`；`release/` 只有 `mac-arm64/*.app` | `electron-builder.yml`：`asar:true + asarUnpack（node-pty/sharp/esbuild…）`，`files:[dist/** + node_modules闭包]`，`extraResources:[bin/officecli/default-skills/splash]`，`mac:[dmg,zip] / win:nsis / linux:[AppImage,deb]`，`publish:github` |
| 状态/样式 | hooks + URL + localStorage；Next 16 + React 19 + Tailwind 4；3 语言 i18n 996 key | Jotai atoms 38 个；React 18 + Vite 6 + Tailwind 3 + Radix/shadcn；无 i18n（硬编码中文） |
| 包管理/构建 | npm；`next build --webpack`；`serverExternalPackages:[node-pty/undici/web-push/pi-*]` | bun workspaces；esbuild（main/agent-runtime/terminal-runtime/preload）+ Vite（renderer）+ `bun build --compile` CLI + `electron-rebuild -f -w node-pty` |

**直接推论（后面六节的前提）：**

1. pi-web **不能**做成纯静态 `output:export`——`/api/agent/[id]` 需要 in-process `AgentSession`（`route.ts:55 → startRpcSession → createAgentSessionFromServices`）。静态化 = 所有经 `/api/*` 的按钮必然 404。这是打包问题的总根。
2. Proma 的 Markdown/文件树/定时/思考优化大多是**渲染与调度纪律**（节流/分片/懒加载/后台 tick），可以不换架构直接抄；只有“打包后无服务器”这一点抄不了（除非重写后端为 IPC）。

---

## 1. Markdown 预览慢（P0）

### 1.1 现状与体感

- 聊天 `MarkdownBody` 几千~几万字 + 多代码块/公式时“越打越慢、停下顿一下”；超 100KB 反而不卡（被 `MAX_MARKDOWN_CHARS=100_000` 兜底转 `<pre>`）。
- 文件预览大 `.md` 打开慢（另一条链路，更重）。

### 1.2 根因（已核到行）

**R1 — 每次 token 全量重解析 + 预处理本身是多遍正则（主因）。**
`components/MarkdownBody.tsx:46`：`useMemo(() => normalizeDisplayMath(children), [children])`，`children` 是流式增长字符串，每来一个 delta 就失效 → `normalizeDisplayMath`（`lib/markdown.ts` 约 385 行：fence 跟踪、`rawCodeTag` 跟踪、转义反引号重写、bracket/display-math 四五种范式、`findDisplayMathClose` 内层扫描）全量重跑 + `ReactMarkdown` 全量 re-parse。长回答越到尾越慢，线性放大。

**R2 — 插件管线比 Proma 重一倍，且 KaTeX 走同步主线程。**
本仓库 `lib/markdown.ts:350-385`：remark×3（frontmatter + gfm + math）+ rehype×3（`rehypeRaw + rehypeSanitize + rehypeKatex`），preview 版又重复一份。Proma 聊天正文只有 remark×2 + rehype×1（`message.tsx:21-24,533-534`，**无 `rehypeRaw`**，减少一次 HAST 遍历 + XSS 面）。本仓库 `rehypeKatex` 同步，数学多/长公式消息每 token 全量重排。

**R3 — 高亮策略是“流式纯文本、结束时 Prism 全量”（体感顿一下的来源）。**
`MermaidBlock.tsx:264-287`：`isStreaming || !highlighterReady → <PlainCode>`，结束后 `<LazyCodeHighlighter>` 对攒下的大代码块一次性全量 tokenize。`useLazyHighlighter.ts:1-14` 注释明说 Prism 全语言包 ~1.5MB 是动态 import（首屏不阻塞是对的），但就绪后一次性 Prism 化仍是主线程顿。Proma 是 Shiki 三 API（`highlightCode` 异步 / `highlightCodeSync` / `highlightToTokens` 逐行）+ `THROTTLE_MS=80ms` + 160 条 LRU（`theme\0lang\0code` 为 key）+ `rAF` Delta 合并，流式期渐进上色。

**R4 — 长会话无“历史/实时隔离”，窗口会膨胀到全量。**
`lib/chat-lazy-load.ts:1`：`VISIBLE_PAGE_SIZE=50`，看似分页，但 `ChatWindow.tsx:838-844`：`setVisibleCount(max(current, messages.length))`，往上翻即膨胀；`rendered[]` 每次 render 全量重建；窗口内每条仍是完整 `MarkdownBody`。`components` 的 `useMemo` 依赖含 `isStreaming`（`MarkdownBody.tsx:112`），流式结束翻转时全部 code/img/a 渲染器 identity 失效一次。Proma `AgentMessages.tsx:735-795,803-807` 把稳定历史前缀与实时 tail 分开 memo，token 更新只重分组当前 turn。

**R5 — 文件预览比聊天更重（别和聊天混在一起修）。**
`MarkdownFilePreview.tsx:46-110` 在共享插件外又加 `rehypeSourceLineSpans`（逐 text 节点按 `\n` 切 span + `data-source-line`），大文件打开慢优先看这里。

### 1.3 Proma 的可抄纪律（只抄纪律，不换库）

- 聊天轻、预览重：聊天无 `rehypeRaw`；轻量预览（minimap/hover/ask-banner）统一 `PREVIEW_REMARK=[remarkGfm]`，且 `img→null、a→span、pre/code 截断`。
- 插件数组引用稳定（模块常量），`MessageResponse = React.memo`，链接/图片/pre/code 全 memo。
- 高亮节流 80ms + LRU 160 + `rAF` 合并 `sdk_delta`（后台 fallback `setTimeout 100ms`），流式期禁同步布局读（`ContentBlock.tsx:587` 注释）。
- 历史/live 分离 memo（token 只动 live 尾）。

### 1.4 优化方案（按优先级）

**P0-1 聊天热路径减负（不换库，纯纪律，预期收益最大）：**

1. `normalizeDisplayMath` 增量/节流：流式期间只对**新增尾部窗口**做规范化（或 `requestAnimationFrame` 节流后全量），非流式再全量一次。落点 `MarkdownBody.tsx:46`。
2. `components` 的 `useMemo` 去掉 `isStreaming`（或把 `isStreaming` 只传给 `CodeBlock/MermaidBlock` 两个叶子，不作为整个 map 的 key）。落点 `MarkdownBody.tsx:47-112`。
3. 流式期间降级 KaTeX：含 `$` 的消息在 `isStreaming` 时跳过 `rehypeKatex`（或只渲染首屏），结束后再全量排版。落点 `lib/markdown.ts`（新增 `markdownStreamingRehypePlugins`）。
4. 历史/live 分离：`ChatWindow` 把“已完成历史”与“当前流式 turn”分两个 memo 列表渲染（抄 `AgentMessages` 三层 memo 思想，成本低于全量虚拟化）。落点 `ChatWindow.tsx:628,838-844,900-910`。

**P0-2 高亮去顿（两选一，先做 A）：**

- A（小）：保持 Prism，但把“结束时一次性全量”改成**按代码块分片 + `requestIdleCallback`/rAF 分帧**，并给超大代码块行数上限 + 折叠（已有 `MAX_MARKDOWN_CHARS`，再加 `MAX_CODE_LINES`）。
- B（大）：迁到 Shiki `highlightToTokens` 逐行 + 80ms 节流 + LRU。收益更高但要换依赖、测主题/语言覆盖，排 P1。

**P1 文件预览：**

- `rehypeSourceLineSpans` 只在“源码行映射模式”启用，普通阅读模式走轻插件；大文件分页/虚拟滚动（先分页，后虚拟化）。

**验证：**

- 复现判据：中等长度（5k~50k 字 + 3+ 代码块 + 公式）逐字变慢 = R1/R2；结束后顿 = R3；往上翻全卡 = R4；超大反而不卡 = guard 生效。
- 性能基线：用同一会话分别测首 token 到可读、流式帧率、结束顿耗时；改后三项都要降。`tsc --noEmit + lint + npm test` 必过；i18n 无新增文案可跳过。

---

## 2. 打包 dmg/exe 后按钮点不了（P0，机制问题不是某个按钮写错）

### 2.1 机制（已核到行）

1. **Electron 只是“本地 Next 服务器的壳”，按钮 = HTTP API，服务器死则全死。** `electron/main.js:82-127,223-224`：`spawn(process.execPath,[nextBin,"start","-p",port,"-H","127.0.0.1"])`（端口每次随机 `listen(0)`，`30141` 只是 CLI 默认值），`waitReady(port,90s)` 后 `loadURL(127.0.0.1:port)`。无 `.next` 直接弹框退出（`:392-395`）；`serverProc exit` 非预期即弹“本地服务异常退出”并 `quit`。
2. **静态化与 in-process Agent 互斥。** `next.config.ts` 无 `output:"standalone"/"export"`，必须跑完整 Node 服务器；`serverExternalPackages` 被外部化为 `.next/node_modules/<pkg>-<hash>` 符号链接，打包靠 `scripts/after-pack.mjs` 签名前解引用注入。**若做成纯静态 export，`/api/agent|/sessions|/files|/cron|/terminal` 必然失效**——这正是“打成 dmg 后按钮失效”的直接机制。
3. **当前配置本来就没准备好发 dmg/exe。** `package.json build.mac.target:["dir"]`，`release/` 只有 `mac-arm64/*.app`，`extraResources` 仅托盘图标。dmg/exe 属自定义 target，若打包流程没跑 `npm run build` 或没执行 `afterPack`，终端（node-pty）、SSE、文件读写会随机失败，表现正是“部分可用、部分点不动”。对照 `release/builder-debug.yml` 的 `files` 排除表确认产物是否含 `.next/node_modules`。
4. **两个“点了没反应”的放大器：** `main.js:212-218` 的 `setWindowOpenHandler（deny + http(s)/mailto 转外部）` + `will-navigate（仅放行同 serverPort）`——任何触发 `window.open`、或 `localhost` 与 `127.0.0.1` 混写、或端口写死的导航都会被吞并/或弹到系统浏览器，应用内看就是“失效且无报错”；`proxy.ts:10-24 + lib/request-security.ts + lib/file-access.ts:20-60` 的 allow-list（会话 cwd/projectRoot + `~/pi-cwd-*` + `allowFileRoot()`，5s 缓存）——包内 `homedir/userData` 迁移（`main.js:250-266,329-333`）若与调试时目录不一致，会话扫不到 → roots 为空 → `/api/files` 403 → 文件树空白且依赖文件的按钮静默无操作。

### 2.2 Proma 的对照（为什么它没这个单点）

`src/main/index.ts:510-517`：dev `loadURL(127.0.0.1:5173)`，打包后 `loadFile(rendererPath)`（`vite base:'./'`），无端口、无 `waitReady`。后端走 3114 行 preload 全量 IPC + `dist/main.cjs/agent-runtime.cjs/terminal-runtime.cjs` + UtilityProcess 隔离；本地文件用 `proma-file://` opaque token（TTL 1h，cap 500，`realpathSync` + 越界校验）。`asar:true + asarUnpack（sharp/node-pty/esbuild…）` + `extraResources` + `mac:[dmg,zip]/win:nsis/linux:[AppImage,deb]` + `publish:github`。

### 2.3 优化方案（分三层，不要一上来就“改成 Proma 那样”）

**P0 先让现有架构的包可用（1-2 天）：**

1. 打包前硬门禁（进脚本，不靠人记）：`npm run build` 产物存在 + `.next/node_modules` 已注入 + node-pty ABI/执行位 + `files` 未误排除。参考 Proma `sync:runtime-deps` “发现绝对 symlink 即硬失败”的不变量，落到本仓库就是 `scripts/after-pack.mjs` 后加断言。
2. 自定义 dmg/zip target 时**必须带 `afterPack`**，并用 `release/builder-debug.yml` 逐项核对 `files/extraResources`。先只打 `dir + dmg + zip`（zip 是以后自动更新的前提），nsis/deb 后置。
3. 冒烟清单（每次打包必跑）：窗口能开 → 发一句话能回 → 文件树能列 → 开终端能跑 `echo` → 定时任务列表能拉 → DevTools 看 `/api/files/*` 是否 403、主进程日志有无 `will-navigate` 拦截、系统浏览器是否被异常拉起。
4. `localhost` 与 `127.0.0.1` 全仓统一（只用 `127.0.0.1`），窗口导航拦截加日志（被拦时在主进程 `console` 留一行，前端给一次 toast 而不是静默）。

**P1 体验（抄性价比最高的）：**

- 静态启动闪屏（Proma `resources/startup-splash`）：renderer 首帧前 show、`ready-to-show` dismiss，消除最坏 90s 空窗口。
- 单实例失败给提示（现在是静默 `quit`，像“双击没反应”）。
- dev/prod `userData` 隔离（现在共享 `SingletonLock`，dev 与 prod 会互相顶）。

**P2 路线决策（只二选一，不要中间态）：**

- A（推荐，改动最小）：**保留 `next start` 服务器模型**，把桌面包定义为“自带服务的可安装 Web”。代价是后台定时依赖进程活着（见 §5），文档写清楚。
- B（大重构）：学 Proma 把后端搬成 IPC/UtilityProcess，UI 纯静态。这等于重写 `lib/rpc-manager.ts + 60 个路由`，只有当“必须纯离线、无端口、无服务器”时才选。**不要在 A 没跑通之前启动 B。**

**验证：** `npm run build → electron-builder --dir → electron-builder --mac(dmg+zip)` 三档都过冒烟清单；`tsc/lint/test` 过；`upstream-merge-audit` leak 不涨（打包逻辑全抽到 `scripts/`，`package.json` builder 段 + `electron/main.js` 只做最小接线）。

---

## 3. 文件树（有骨架，缺性能与写操作）

| 项 | pi-web-0.9.0 | Proma-main | Gap 与修法 |
| --- | --- | --- | --- |
| 浏览/打开 | 有：`FileExplorer.tsx`（1141 行）+ `ExplorerPanel` + `FileViewer` + `/api/files?type=list/read` + allow-list（`file-access.ts` 5s 缓存）+ `path-security.ts` 单一边界 | 有：`FileBrowser.tsx`（懒加载+多选+三点菜单+重命名/删除）+ `listShallowDirectory`（目录优先+dotfile 沉底+`localeCompare`，跳过 `.DS_Store/Thumbs.db`，悬空 symlink 不炸树）+ 多根合并 | 对齐。抄它的排序/容错细节 |
| 性能 | **无虚拟化**（全文无 `react-window/virtual/IntersectionObserver`），大目录全量递归成 DOM；逐目录 `GET /api/files/:path?type=list`；每次 refresh 重拉 `/api/git/status` | 无整树虚拟化（`@tanstack/react-virtual` 只用在侧栏通用列表），但**浅层列出+展开再拉**，从不一次 `readdir -R` | P1：先抄“浅层+展开再拉 + git status 防抖/缓存”，再上虚拟化（`react-window` 或 Proma 同款 `react-virtual`）。不要一上来全量虚拟化 |
| 实时性 | **无轮询/SSE 订阅**：`useEffect[cwd,refreshKey,treeRefreshKey]` + 父级 key 自上而下重取；服务端虽有 `type=watch`（`fs.watch`，`connected` 在 watcher 建好后才发）但 `FileExplorer` **未订阅** | `node:fs.watch{recursive:true}` + 300ms debounce + 高噪声路径（`node_modules/.next` 等）过滤 + error 后 5s 自愈 + 缺失目录监听最近存在父目录；`memory/` 另有独立 watcher | P1：把现成的 `type=watch` 接上（订阅 + debounce + 噪声过滤），“不实时”即消失。注意 `chokidar` 两边都是“装了没用”，不要引 |
| 写操作 | 只读浏览 + 上传（G10 缺） | 原位重命名（只选中文件名）+ 批量删除确认 + 移动到… + 会话文件“移入项目” + `Cmd/Ctrl` 多选 + 右键菜单 | P2：按 G10 补（`PATCH/POST /api/files` 已有，先补 UI）。untracked 删除不给撤销要写清楚 |
| 体验细节 | 拖拽上传 + `@path` 引用 + 文件搜索树（`file-dirent/file-fuzzy/search-tree`） | 空目录 800ms 后重试一次（对抗 agent 写入竞态）+ 60s 内被改圆点 + 粘性目录行 + 搜索自动展开祖先并滚动居中 + 拖拽引用（`application/x-proma-file-panel` JSON + text 兜底） | P2：空目录重试 + 最近修改标记 + 粘性行，三件小而甜，先抄 |

---

## 4. 记忆（不是缺失，是“插件化 + 简版面板”）

| 项 | pi-web-0.9.0 | Proma-main | Gap 与修法 |
| --- | --- | --- | --- |
| 存储 | `npm:pi-memory` 插件拥有记忆（`<agentDir>/memory/`，`memory_write/read/forget/restore/scratchpad/search/status` 7 工具）；本仓库只存常量（`lib/pi-memory.ts` 16 行：包名/目录名/`MEMORY.md/SCRATCHPAD.md/daily/`） | 纯文件：`~/.proma/agent-workspaces/{slug}/memory/` + 索引 `MEMORY.md` + 画像 `user-profile.md` + 项目指令 `AGENTS.md`；旧 `.claude/memory` 自动迁移（有日志）；`node:fs` 原子写，无向量/ORM | 语义接近，不要自造第二套记忆后端。不要把 `lib/workspace-memory.ts`（last-open 会话，localStorage）当成记忆去对比 |
| 面板 | 简版读写器：`GET/PUT /api/memory/files`（白名单 `MEMORY.md/SCRATCHPAD.md/daily/YYYY-MM-DD.md`，256k 上限，containment 校验）+ `PiMemoryConfig.tsx`（269 行展示+新建/编辑）；未装插件时空态“尚不存在”是预期 | 能力中心记忆 tab + 独立记忆窗口（`AGENTS.md` + 文件树 + 自动保存 + 外部冲突检测 + 变更 Shelf/时间线）+ 设置页 `WorkspaceMemoryTab` | P1：补独立记忆 UI（文件树 + 自动保存 + 外部冲突提示）+ 缺口引导（缺 `user-profile.md` 时渐进建画像）。P2：3 天周检邀请（`WORKSPACE_MEMORY_REVIEW_INTERVAL_DAYS=3`，只邀请不自动写）+ `memory/` diff watcher |
| 搜索 | 需外部 `qmd`（`PI_MEMORY_SEARCH_HINT_URL`） | 同类（无内置向量） | 对齐，不做向量库 |

---

## 5. 定时任务（都有，强弱点正好互补）

| 项 | pi-web-0.9.0（`fork:cron`） | Proma-main | 修法（只补它强我的四件） |
| --- | --- | --- | --- |
| 表达 | **更强**：完整 5 字段 cron（`cron-expression.ts`）+ 时区（`cron-timezone.ts`）+ `idleWindow`（跨午夜，窗口外顺延到起点）+ `weekdays`/cron 双通道 | 只有结构化 `interval/daily/weekly/monthly/once` + `activeWindow/activeWeekdays`，**无 cron 解析** | 保留我的表达力，不要降级成它的 |
| 存储/调度 | `<agentDir>/pi-web-cron.json`（5s 缓存，坏文件自愈）+ `cron-schedule.ts`（317 行）+ `cron-runner.ts`（30s tick，`instrumentation.ts` 启动） | `~/.proma/automations.json`（v4，`safe-file` 原子写，内存 write-through）+ `automation-scheduler.ts`（`nextRunAt + 30s tick`，无 `node-cron`，`2h` 超时，`runningAutomations` 防重入，重启过期顺延防雪崩） | 对齐。抄它的超时与防雪崩表述 |
| 执行 | 普通会话 `startRpcSession(__cron__uuid)+prompt`，跑完进侧栏可打开/分支/归档；**错过不补跑**（`CRON_MISSED_WINDOW_MS`）；并发同 task 去重 | `daily`（同日复用/跨日新建/上下文≥0.7 换新，留压缩余量）/`reuse`（常复用）；用户手发消息即“毕业”；`bypassPermissions`（否则卡弹窗）；`runAutomation = 新建/复用子会话 + headless + 通知 + broadcast` | **P1 四件（G15）**：①会话复用+毕业 ②连续失败 5 次自动暂停 ③`maxRuns` 达上限自动停用并标完成 ④完成通知（先 Web Push/`Notification`，飞书卡片后置）。另补单次 `2h` 超时 |
| 当前缺口 | 无 `maxRuns` 自动停用；只记 `lastStatus/lastError` 不自动暂停；每次新建会话无复用；无超时；无 agent 自建工具 | 完成通知目前只实现飞书；提醒是另一条（`planning-reminder-scheduler` 30s + SQLite 原子 claim + 主进程 `Notification{silent:true}`） | **P2**：7 个 agent 自建工具（list/get/create/update/delete/run，自动运行中禁递归，防 runaway），仓内有现成模式 `lib/todo-extension.ts` |
| 关键约束 | **服务器进程活着才有定时**。Electron `before-quit` 才杀 server（`main.js:478-486`），macOS 关窗不退出（`470-476`），关窗后仍能跑；整机睡眠/退出则停 | 调度器活在主进程，渲染器重载/崩溃不影响 | 文档必须写明：桌面包“关窗≠停定时，退出才停”；Web 自托管“进程停则定时停”。这是 §2 的 A 路线代价 |

---

## 6. 思考过程展示（事件双轨 + 懒加载，体验差一截）

| 项 | pi-web-0.9.0 | Proma-main | 修法 |
| --- | --- | --- | --- |
| 事件 | 增量 `text/thinking/toolcall_start/delta/end`（`streaming-message.ts:54-130` + `agent-event-wire.ts:14-105`）；生命周期 `agent_start/agent_end/message_*/tool_execution_*`；**Compaction 双轨兼容**（`auto_compaction_*/compaction_*`，`useAgentSession.ts:1376-1393`）；`set_thinking_level`（DeepSeek `xhigh→max` 兼容） | `sdk_delta/_partial` 合并（同 `uuid+runStartedAt` 才拼）→ `webContents.send(AGENT_STREAM_EVENT)` → `rAF` 每帧每会话一组 Delta（后台 `100ms` fallback，`cancelScheduledFlush` 防洪峰）→ Jotai | 事件侧对齐。抄它的 `rAF` 批处理与“后台 fallback” |
| 展示 | `ProcessGroup.tsx` 按轮次分组 + brain 图标 + duration 累加 + 失败时 tool 名置顶；空 thinking 过滤（`MessageView:638-640`）；`ThinkingBlock` 全文懒加载（`loadThinkingContent`，LRU 100 → `GET /entries/[entryId]/thinking?blockIndex=`，只当 `block.type==="thinking"` 才返回）；deferred 为空且非流式直接不渲染（`process-content.ts:49-53`，历史空行消失是预期） | `reasoning.tsx`（`defaultOpen true`，流式强制展开，结束后 1s 自动折叠，`duration=ceil((end-start)/1000)s`，`Brain + animate-pulse`）+ `AgentMessages` 三层 memo + `ProcessBlockGroup/TaskProgressCard/ChatToolActivityIndicator` + `<think>` 解析下沉 `session-core` | **保留懒加载**（省首屏内存是对的），补三件：①展开预取 + 缓存键稳定化（少一次往返体感）②结束后自动折叠 + duration（与 Proma 一致）③**流式期禁同步布局读**（`scrollHeight` 与 Markdown 同帧竞争是第二落点，抄 `ContentBlock:587` 纪律） |
| 级别 | `thinkingLevel/thinkingLevelPins` 经 `model-scope.ts:35-213`（`enabledModels` glob + `:thinking` 后缀，`resolveModelScopeWithDiagnostics` 与 TUI 同口径） | `resolvePiThinkingLevel(settings.agentThinking/agentEffort, sessionMeta.reasoningLevel/openAIThinkingLevel, provider/model/capability)` + `resolveReasoningProfile/inferReasoningTransport`，旧用户默认 `high`；Chat 侧 Gemini 才显示深度档 | 对齐。不要把 `enabledModels` 当字面量比（ minimatch + fuzzy + 后缀，见 AGENTS.md） |

---

## 7. 其他功能速查（逐一对比，不展开，详见配套对比 §3–§7）

| 功能 | pi-web-0.9.0 现状 | Proma-main | 判定 |
| --- | --- | --- | --- |
| 会话/分支 | 读 `.jsonl`（`session-reader.ts` + `SessionManager` 容错 + `entryIds[]↔message` 映射）+ fork（新文件，`destroy()` 防 wrapper 污染，`rpc-manager:732-777`）+ in-session branch（`navigate_tree` + `sliceActiveBranch`）+ `BranchNavigator`（迭代 DFS + compressChain，防深链栈溢出；导出 HTML 同理迭代化） | `SessionManager.forkFrom/open` + `forkAgentSession/rewindPiAgentSession` + 自研索引 `agent-sessions.json` v2 | 对齐。缺 rewind（截断当前文件，原子+回滚）与“探索分支带回结论”收口动作（P1/P2，见配套 G4/G5） |
| 模型/鉴权 | 能力驱动去重（双鉴权 anthropic/github-copilot 只出现一次，`provider-listing.ts`）+ `auth.json` 单凭证同锁删除 + 双列表同时刷新 + `enabledModels` 作用域 + models.dev 目录/发现/测试 | 24 家 provider 预设 + Keychain 加密 + 额度查询覆盖面 + OAuth PKCE | 各有强项。补额度显示与连接测试即可，不引 provider 适配层 |
| Skill/插件 | `DefaultResourceLoader` 同口径列举 + 只改 `disable-model-invocation` + `npx skills add` 安装 + `SettingsManager+DefaultPackageManager` 插件管理 + skills.sh 搜索/更新检查 | 工作区级隔离 + 17 内置技能 + 按 `version` 升级 + 导入导出 + 子文件编辑器 | 补“按工作区隔离 + 导入导出”按需做；内置技能目录可直接复用 `default-skills/` 16 个模板 |
| MCP | CRUD + `discover`（从 Claude/Codex/Cursor/VS Code 导入） | OAuth PKCE + Keychain + handshake 验证成功才写 enabled + 内置集成目录 18 个 + Agent 自管（先 list 再 configure，禁直编 `mcp.json`） | 补 handshake 验证 + 凭据加密（Web 端用 `0600` 文件 + 环境变量覆盖，不自造加密层） |
| 终端 | `terminal-manager.ts`（128KB ring + lease/expiry）+ `/api/terminal/*` + xterm 面板 + SSE `Last-Event-ID` 重放 | 独立 UtilityProcess（MessagePort，16ms 批处理、1MB 背压/重放）+ 快照恢复 + FitAddon 尺寸纪律（忽略 0×0）+ 6 个 Agent 工具 | 补“从文件区开终端”入口 + Agent 终端工具（G14）+ 尺寸纪律 |
| Worktree | 归组显示（一个仓库所有 worktree 一个项目行）+ `/api/worktrees`（`<repo>-worktrees/<branch>`，`add -b`，脏树 409 + force 二次确认，删后会话推断回主项目）+ Windows 路径 `toNativePath/samePath` | 会话级 activeWorktree + 子会话/终端跟随 + fork 时复制工作台 | 对齐。我多归组，它多跟随。补跟随按需做 |
| 搜索/导出 | 跨会话全文搜索 + HTML 导出（递归改迭代防深链栈溢出）+ Markdown 导出 | CLI `list/info/outline/search/export`（渐进式读取） | 对齐 |
| Todo/日程/提醒 | 会话级 todo（`todo-extension/state` + `TodoChip`）+ localStorage | SQLite `planning.db`（schema v9）+ 月视图 + 系统通知 + 22+ `mcp__planning__*` + EventKit 双向（N-API，不搬） | 补 SQLite + 提醒 rail（G17/G18），EventKit 不搬 |
| 主题/外观 | 6 套 Codex 皮肤 + pi 主题 + 壁纸/密度/边框 + 字号/列宽 | 3 档外观 | 我更强，不补 |
| i18n/部署 | 3 语言 996 key + 密码 + PWA + Web Push + Docker | 无 i18n，无 Web 部署 | 我更强。IM 桥接反而是我的优势载体（`instrumentation.ts` + `startRpcSession`，见配套 §7.6） |
| 更新 | `/api/app-update`（npm registry 比对 + 12h 缓存）+ 顶部提示条 | `electron-updater`（`autoDownload=false` + 10s 首查/每 4h + 空闲安装 + 缓存清理 + GitHub Release 日志 30min 缓存 + 403/429 冷却） | 前提是 §2 的 `dir → dmg+zip` + `latest-mac.yml` 跨架构合并，否则更新落不了地 |

---

## 8. 落地路线（只排三期）

**P0（本周：止血）：** §1 的 P0-1（Markdown 热路径节流 + 去 `isStreaming` key + KaTeX 降级）+ §2 的 P0（打包硬门禁 + dmg/zip + 冒烟清单 + 导航拦截日志）。这两件做完，“慢”和“点不了”的客诉各去掉一半以上。

**P1（下周：体验追平）：** 文件树订阅 `type=watch`（debounce + 噪声过滤）+ git status 缓存；记忆独立 UI + 周检邀请；定时四件（复用/毕业 + 失败暂停 + `maxRuns` + 超时/通知）；思考自动折叠 + 预取 + 禁同步布局读；高亮 B 方案评估（Shiki spike）。

**P2（按需：能力补齐）：** 文件写操作（G10）+ 改动面板（G9）+ XLSX/PPTX 预览（G11）+ Agent 自建定时（G16）+ 快捷键表/录制（G19）+ 存储管理（G18）。IM 桥接（Slack/飞书/钉钉）单独立项，默认只读工具预设 + 配对码 + 出境告知（见配套 §7.6.4）。

**纪律（配套 PR 计划 §0 的重申）：** 新增逻辑放 `lib/proma-*.ts` / `components/fork/*` / 新路由；碰上游文件打 `fork:<slug>` 并自报 `T1 · n 文件 / m 处 · leak 前后值`；`tsc --noEmit + lint + npm test + upstream-merge-audit --check` 必过；`globals.css` 动了追加 `audit-tokens.mjs`；Electron/打包动了追加 `npm run desktop` 冒烟 + 三档构建冒烟。

---

## 附录 A · 证据索引（本轮实核）

```
pi-web:
  package.json:1-135            依赖与 builder（asar:false, mac:[dir], afterPack）
  next.config.ts:22-30,44-68    serverExternalPackages + 仅 Cache-Control（无全局 CSP）
  electron/main.js:38-127,208-224,392-404,470-486  随机端口/spawn/waitReady90s/导航拦截/缺.next退出/关窗不退出
  electron/preload.js:15-35     仅 36 行，无业务 IPC
  scripts/after-pack.mjs:1-40   .next/node_modules 解引用注入
  components/MarkdownBody.tsx:46,47,112  全量重解析 + components key 含 isStreaming
  lib/markdown.ts:46-160,190-215,350-385 normalizeDisplayMath + remark3/rehype3
  components/MessageView.tsx:92,117-122,818,919-940  100KB guard + 全量 BlockView
  components/MermaidBlock.tsx:253,285-287,311  流式纯文本 + Prism 结束全量
  components/useLazyHighlighter.ts:24-29 + AsyncCodeHighlighter:1-20  Prism ~1.5MB 懒 chunk
  components/MarkdownFilePreview.tsx:46-110  rehypeSourceLineSpans
  components/FileExplorer.tsx:81-118,229,274-280,635,652-653,834-875  无虚拟化/无订阅/逐目录fetch/重拉git
  lib/file-access.ts:20-60 + path-security.ts  allow-list + 5s 缓存（安全边界）
  lib/pi-memory.ts:1-16 + memory/files/route.ts:1-132 + PiMemoryConfig:1-269  插件拥有记忆 + 白名单面板
  lib/cron-runner.ts:29,35,49-105 + cron-store/schedule + api/cron/route.ts:1-101 + CronConfig:1-433  30s tick/重入/错过跳过/手动run
  hooks/useAgentSession.ts:1147,1167,1236-1393,1789  agent_start/end/prompt_done/settled + compaction双轨
  lib/streaming-message.ts:54-130 + agent-event-wire.ts:14-105  增量归一化
  lib/process-content.ts:27-53,112-116 + ProcessGroup:55-80,230-323,500-581,708-755  thinking分组/置顶/duration
  app/api/sessions/[id]/entries/[entryId]/thinking/route.ts  懒加载全文（LRU100）
  lib/chat-lazy-load.ts:1 + ChatWindow:628,838-844,900-910,1451-1460  50分页 + 膨胀到全量
Proma:
  apps/electron/electron-builder.yml:1-212  asar/unpack/files/extraResources/mac[dmg,zip]/nsis/deb/publish
  apps/electron/package.json scripts  esbuild×4 + vite + bun compile CLI + rebuild node-pty + dist矩阵
  src/main/index.ts:35-37,363,510-517,726-728  proma-file协议 + loadFile + splash
  src/preload/index.ts:3114行 + src/main/ipc.ts:373  全量IPC
  src/utility/agent-runtime.ts + terminal-runtime.cjs  双UtilityProcess
  renderer/ai-elements/message.tsx:21-24,532-548  REMARK/REHYPE稳定引用 + 无rehype-raw
  renderer/agent/AgentMessages.tsx:668-1166  history/tail分离memo
  packages/core/highlight/shiki-service.ts + packages/ui/code-block  异步/同步/token三API + 80ms节流 + LRU160
  main/lib/automation-scheduler.ts + automation-manager.ts  30s tick/nextRunAt/2h超时/失败暂停
  main/lib/agent-workspace-manager.ts:1208-1622 + memory watcher + refresh-service(3天邀请)  文件记忆
  main/lib/directory-listing.ts + workspace-watcher.ts(300ms debounce/噪声过滤/5s自愈)  浅层+监听
```

## 附录 B · 依赖版本（本轮实核）

```
pi-web:  react-markdown 10.1.0 / remark-gfm 4.0.1 / remark-math 6 / rehype-katex 7.0.1 / rehype-raw 7 / rehype-sanitize 6 / katex 0.16.47 / mermaid 11.16.1 / react-syntax-highlighter 16.1.1（Prism 全语言 ~1.5MB） / electron 39 / electron-builder 25
Proma:   react-markdown 10.1.0 / remark-gfm 4.0.1 / remark-math 6 / rehype-katex 7 / rehype-raw 7.0.0（装了聊天不用）/ markdown-it 14.1.0 / shiki 3.22.0 / highlight.js 11.11.1 / lowlight 3.3.0 / katex 0.16 / mermaid 11.15.0 / tiptap 3.19.0 / codemirror 6 / tanstack/react-virtual 3.14.9 / chokidar 5.0.0（装了不用）/ electron 43.2.0 / electron-builder 25.1.8 / electron-updater 6.7.3 / vite 6
`
