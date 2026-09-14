# Pi Web — Codex 风格版

> 感谢 [Pi Web 作者 @agegr](https://github.com/agegr/pi-web) 的优秀开源项目。本项目是基于 Pi Web 的 Codex 风格分支：保留上游功能，把整套 UI 重排为 Codex 设计语言，并摘取了若干尚未进入上游正式版的 PR。
>
> Special thanks to [@agegr](https://github.com/agegr/pi-web), the author of Pi Web. This is a Codex-style fork of Pi Web with the upstream feature set intact.

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[pi 编程智能体](https://github.com/earendil-works/pi)的本地浏览器界面。Pi Web 与 pi 共用本机配置和会话文件，可在浏览器中查找和继续对话、运行智能体、配置模型与资源，并查看项目文件。

![Pi Web 展示包含结构化 Markdown、工具调用和项目导航的 pi 会话](./docs/screenshot2.png)

## 与上游的差别

| | 上游 Pi Web | 本分支 |
| --- | --- | --- |
| 视觉语言 | 上游设计 | Codex 皮肤：分层表面、半透明细线边框、三级前景 alpha、单一单色主操作、13px 聊天字号、等宽字体栈 |
| 主题 | 6 套色板 | 同 6 套（`light` / `dark` / `mist` / `rose` / `pine` / `auto`），全部按 Codex 调色板重绘 |
| 文件树 | 左侧边栏 | 右侧面板，侧栏只保留纯会话列表 |
| 消息操作区 | 悬停才显示 | 常显 |
| MCP 服务器 | 无 | 插件面板内管理（摘取 [#470](https://github.com/agegr/pi-web/pull/470)） |
| 工作区编辑器 | 无 | Markdown 编辑器 + 可切换主/副区布局（摘取 [#838](https://github.com/agegr/pi-web/pull/838)） |
| 供应商用量 | 无 | OpenCode Go 配额展示（摘取 [#844](https://github.com/agegr/pi-web/pull/844)） |

本分支相对上游的每一处有意偏离，以及**合并上游新版本时如何不丢皮肤**的完整流程，都记在 [`docs/codex-skin/delta.md`](./docs/codex-skin/delta.md)。动主题或布局代码之前请先读它。

## 功能

- **会话工作区**：按项目查找、继续、重命名、导出和删除对话，并查看运行状态、上下文占用、花费和压缩信息。
- **两种分支方式**：**新会话**从较早的消息创建独立会话文件；**从此处编辑**在当前会话内创建分支。
- **项目文件工具**：浏览和上传文件、查看 Git Diff，并预览源码、Markdown、图片、音频、PDF 和 DOCX；文件变化后自动刷新。
- **Git worktree**：从侧边栏切换 checkout，同时把同一仓库不同 worktree 的会话归在一起。
- **MCP 服务器管理**：在插件面板中查看、添加、编辑、启用/停用、跨作用域移动、测试和删除 MCP 服务器，不必手改 JSON。
- **网页配置**：无需离开 Pi Web，即可管理 Provider 登录和 API Key、模型、模型测试、插件包及技能。
- **中文（简/繁）与英文界面**：首次打开跟随浏览器语言，也可在设置面板切换。

## 快速开始

需要 Node.js 22.19.0 或更高版本。先用 `node --version` 检查，然后：

```bash
git clone https://github.com/greenfriends6688/pi-codex.git
cd pi-codex
npm install
npm run prod
```

`npm run prod` 会做生产构建并在 [http://127.0.0.1:30141](http://127.0.0.1:30141) 提供服务，默认只监听 `127.0.0.1`。

> 上游的 `npx @agegr/pi-web` 装的是**上游包**，不是本分支——它既没有 Codex 皮肤，也没有 MCP 面板。本分支请从源码安装。

若尚未配置模型供应商，打开**模型**面板登录或填写 API Key。

## MCP 服务器

插件面板里有一块 **MCP 服务器**区域，与插件列表并列。它读写的是 pi 的 MCP 工具链所用的同一批文件：

| 作用域 | 文件 |
| --- | --- |
| 全局 | `~/.pi/agent/mcp.json` |
| 项目 | `<项目>/.pi/mcp.json` |

全局作为基线，项目条目按同名覆盖。写入项目作用域要求项目已受信任，与安装插件的规则一致。详情视图只列出环境变量的**键名**——列表接口从不返回值；只有进入编辑态时，高级 JSON 编辑器才会拉取含值的完整定义。

**测试连接**按钮会拉起 stdio 服务器（HTTP 型则 `POST initialize`），并回报服务器名、版本与工具数量；stdio 测试 20 秒超时。

> **重要**：pi 核心**不含内置 MCP**。上游文档明确写着它 "intentionally does not include built-in MCP"——MCP 能力必须由 pi 扩展或包提供。本面板管理的是这类包所消费的配置文件，**本身不会把 MCP 服务器接进 agent**。

## 配置

端口与主机名的优先级：命令行参数 > 环境变量。`--no-open` 或 `PI_WEB_NO_OPEN=1` 可禁用自动打开浏览器。`pi-web --help`（或 `-h`）会打印启动选项后直接退出，不启动服务；未知参数会报错退出。

| 参数或环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `--help`、`-h` | 打印启动选项并退出 | — |
| `--port <端口>`、`-p <端口>`、`PORT` | 服务端口 | `30141` |
| `--hostname <主机>`、`-H <主机>`、`PI_WEB_HOSTNAME` | 绑定主机名 | `127.0.0.1` |
| `--no-open`、`PI_WEB_NO_OPEN=1` | 不自动打开浏览器 | 自动打开 |
| `PI_WEB_SKIP_VERSION_CHECK=1` | 关闭版本更新检查 | 未设置 |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的精确代理/自定义主机名，逗号分隔 | 未设置 |
| `PI_WEB_PASSWORD` | 开启浏览器密码登录；API 客户端可用用户名 `pi` 走 Basic Auth | 不鉴权 |
| `PI_WEB_IDLE_TIMEOUT_MS` | 会话空闲超时（毫秒），上限 `2147483647`；`0` 关闭空闲回收；非法或越界值回落默认 | `600000`（10 分钟） |

例如：

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### 远程访问

绑定到非回环地址等于暴露一个能执行高权限操作的智能体。在可信局域网内请设置长随机密码：

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

密码认证不加密传输。不要把 Pi Web 以明文 HTTP 暴露到公网；请走可信反向代理的 HTTPS 或可信 VPN。若反向代理转发外部主机名，把该确切域名加入 `PI_WEB_ALLOWED_HOSTS`。该白名单不改变绑定的地址。

### HTTP 代理

服务端的模型与 API 请求遵循标准的 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run prod
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npm run prod
```

## 开发

**日常使用——预编译、快：**

```bash
npm run prod        # 清 dev 缓存 -> next build -> next start，端口 30141
```

生产模式是预编译的，单请求实测比开发模式快约 10 倍。开发模式下 Turbopack 每条路由首次访问都要现编（实测 10–15 秒），且 `reactStrictMode` 会双调用 effect。日常使用与演示一律走 `npm run prod`。

**改代码：**

```bash
npm run dev:clean   # 清生产缓存 -> next dev，端口 30141
npm run mode:status # 查看当前 .next 属于哪种模式
```

`dev` 与 `prod` 共用 `.next/` 且产物不兼容，手工混用会出现 `Failed to compile` 或 `Module ... factory is not available` 的假故障。`prod` 与 `dev:clean` 会在启动前把不匹配的缓存挪到系统临时目录，所以来回切换请走这两个命令，不要自己 `next build` 后再 `next dev`。

自检：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

`npm test` 目前有 2 个与功能无关的既有失败：一条 `SessionSidebar` 结构断言被 Codex 皮肤重构推翻，一条 `model-discovery` 测试需要在 `~/.pi/agent/` 下建锁文件。其余全部通过。

改动主题层后还要跑：

```bash
node docs/codex-skin/audit-tokens.mjs   # 自造 token、6 套色板完整性、CSS 括号配平
node docs/codex-skin/verify-themes.mjs  # 重复主题选择器 + 实际渲染出的 token 值
```

静态检查抓不到重复的主题选择器，只有渲染核对能发现。

参考文档：[国际化](./docs/i18n.md)、[发布流程](./docs/release.md)、[皮肤改动台账](./docs/codex-skin/delta.md)。

## 仓库结构

```text
app/             Next.js 界面与 API 路由
components/      React UI 组件
hooks/           客户端状态与交互 hook
lib/             会话、agent、模型、文件、Git 与安全逻辑
public/          静态资源与 PWA 文件
bin/             npm CLI 入口与启动参数解析
scripts/         构建与模式切换辅助脚本
docs/            面向用户与贡献者的专题文档
docs/codex-skin/ 皮肤改动台账、token 审计、主题渲染核对
```

架构说明与详细文件地图见 [AGENTS.md](./AGENTS.md)。

## 合并上游新版本

本分支的 `upstream` 分支存的是**纯净上游源码包快照**，不是真实上游 git 历史，因此与上游提交**没有共同祖先**。同步流程是：

1. 把新版本解压覆盖到 `upstream` 的工作区（`../pi-web-upstream`），在那里提交为 `upstream vX.Y.Z`。
2. 回到 `main` 执行 `git merge upstream`。冲突应当只出现在台账列出的文件里。
3. 逻辑冲突一律取上游，皮肤冲突按台账重打，然后跑上面那套完整自检。

**不要 `git merge` 上游的 PR 分支**（PR 带着数百条上游提交）。正确做法是对 PR 自己的基点取 diff 再打进来，具体命令见台账。

## 说明

- **Agent 数据**：Pi Web 默认读取 `~/.pi/agent`，会话文件位于 `sessions/<编码后的cwd>/<时间戳>_<uuid>.jsonl`。可用 `PI_CODING_AGENT_DIR` 指向别的 pi agent 目录。
- **文件系统访问**：Pi Web 必须能读 agent 数据目录以及各会话记录的工作目录。共享已有会话时，请在与 pi 相同的文件系统环境中运行。
- **共享配置**：模型面板使用 pi 的模型、设置与凭据存储，改动对两个界面都可见。
- **文件访问边界**：文件浏览器只覆盖在 Pi Web 中选过的工作目录，以及它已知的项目/会话根目录，不是通用文件系统浏览器。
- **Git worktree**：切换器可见性、创建与删除行为见 [Pi Web 中的 worktree](./docs/worktrees.zh-CN.md)。

### 下游集成的会话右键菜单

Electron 外壳等下游集成可以在不改 `SessionSidebar` 的前提下提供会话右键菜单。监听可取消的 `pi-web:session-row-contextmenu` 浏览器事件，并在决定自己处理时**同步**调用 `preventDefault()`：

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

`detail` 含 `id`、`path`、`cwd`、可选的 `name`、指针坐标，以及用于变更会话列表后刷新的 `refresh()`。若没有监听者取消该事件，Pi Web 保留浏览器原生右键菜单。该钩子属于浏览器侧，与 pi agent 扩展无关。

### 扩展的会话存活租约

带游离任务的**服务端** pi 扩展可以通过带版本号的全局注册表阻止会话被空闲回收：

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

每个活跃扩展会话注册一次，并在会话关闭、被替换或 reload 时调用返回的幂等 `release`。`isActive` 必须同步、开销小，且只针对传入的确切 session id 或文件。Provider 出错时按"保留该会话"兜底。该租约只影响自动空闲回收；显式关闭与 Stop 兜底清理仍然优先。

## 许可

[MIT](./LICENSE)
