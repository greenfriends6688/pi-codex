# 0001 · 独立聊天工作区（不在项目中的对话）

| 项 | 值 |
| --- | --- |
| 意图 | 让「不在任何项目里」的对话有一个稳定归属，而不是 fallback 到 home / `/` |
| 参照实现 | `参考项目/PiDeck-main` 的内置 Chat 项目（`ProjectStore.ts` 的 `builtin-chat` + `chat-workspace`） |
| 补丁文件 | [`0001-chat-workspace.patch`](./0001-chat-workspace.patch) |
| fork 标记 | `fork:chat-workspace` |
| 新增文件 | 6 个 + 本目录 2 份文档 |
| 上游文件接触面 | 8 个，均为接线级 |

## 为什么要做

pi-web 的「项目」不是注册表，而是**会话 cwd 的分组**（`lib/session-reader.ts` 的
`attachSessionProjectInfo()` → `lib/project-identity.ts` 的稳定 key）。因此"不在项目中"
的对话仍然需要一个 cwd。改造前的两个出口都有问题：

1. `handleNewSession` 用 `selectedCwd || homeDir || "/"` 兜底 —— `homeDir` 是异步取的，
   点得快就会拿到 `""` → 落到 `/`（实测已产生一条 cwd 为 `/` 的会话）；
2. cwd = home 会让**整个家目录**进入文件浏览允许根（`lib/file-access.ts` +
   `lib/path-security.ts` 是严格包含判定），`~/.pi/agent/auth.json`、`~/.ssh` 全部可读。

## 方案

给"不属项目"的对话一个**专用、稳定、可配置**的目录，并在侧栏把它做成常驻分区：

```
GET  /api/chat-workspace          -> { cwd, projectKey }        # 读取（不存在则创建）
POST /api/chat-workspace { cwd }  -> { cwd, projectKey }        # 改目录（必须是已存在目录）
```

- 默认目录 `~/pi-web-chat`；用户覆盖持久化在 `<pi agent dir>/pi-web-chat.json`（`{ version, path }`，
  保留未知字段、原子写、malformed 时回退默认，不阻塞启动）。
- 拒绝把聊天目录设进 git 仓库（`resolveProject()` 会把仓库根折叠成项目 → 聊天会话会被
  错误归到该项目下）。
- 返回的 `projectKey` 与 `/api/sessions` 用的是同一个 `projectIdentityKey()`，
  所以浏览器端**从不比较路径**，只比较 key（Windows 大小写/分隔符问题天然消失）。
- 侧栏：`聊天` 分区与 `项目` **平级** —— 聊天标题行（12.5px/500，与「项目」同款排版）固定在列表最上面，
  下面跟着它自己的会话；`项目` 标题行连同工作区列表整体下移到聊天分区之后，两区各自渲染自己的会话。
  聊天行内 `+` 新建聊天、齿轮改目录、箭头折叠；`新建任务` 行右侧新增 workspace 选择器
  （选择项目 / 不在项目中）。
- 没有任何会话时也会选中聊天工作区 → 首屏直接是输入框，不再出现「开始使用」引导页
  （该引导页只在 `/api/chat-workspace` 不可用时才可能兜底出现）。

## 改动清单

### 新增（无冲突面）

| 文件 | 作用 |
| --- | --- |
| `lib/chat-workspace.ts` | 目录解析/持久化/比较（`getChatWorkspacePath`、`isChatWorkspacePath`、`ensureChatWorkspace`、`writeChatWorkspacePath`） |
| `lib/chat-workspace.test.mjs` | 默认值、malformed 回退、原子写保留未知字段、~ 展开、Windows 大小写等价 |
| `app/api/chat-workspace/route.ts` | GET/POST + `allowFileRoot()` + 仓库内目录拒绝 |
| `components/ChatWorkspaceRow.tsx` | 侧栏聊天分区行（选中/新建/改目录/折叠） |
| `components/NewTaskPicker.tsx` | `新建任务` 旁的工作区选择器（项目列表 / 不在项目中 / 添加项目） |
| `components/ChatWorkspace.ui.test.mjs` | 上面两个组件的契约断言（按钮不嵌套、Escape/外点关闭、面板锚点） |

### 上游文件的接线改动（每处都有 `fork:chat-workspace` 标记）

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `lib/file-access.ts` | `getAllowedFileRoots()` | 聊天目录作为固定允许根，未创建会话时文件树也可用 |
| `lib/project-groups.ts` | 末尾 | 新增 `chatProjectOf()` / `withoutChatProject()` 两个纯函数 |
| `lib/project-groups.test.mjs` | 末尾 | 对应测试 2 例 |
| `components/SessionSidebar.tsx` | 12 处 | 状态 + 拉取、`resolveDefaultCwd()`、`startSessionIn()`、聊天分区（标题行 + 会话列表，含选中时的虚拟窗口）、项目标题行下移到列表、目录选择器、`新建任务` 行 |
| `components/SessionSidebar.test.mjs` | 2 处 | 列表 map 断言跟随新结构 + 新增聊天分区断言 |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | `sidebar.newTask` 附近 | 新增 5 个 key（3 语言必须同时加，否则 i18n parity 测试挂） |

## 验收

- `GET /api/chat-workspace` 返回 `{ cwd, projectKey }`，目录自动创建。
- 侧栏出现 `聊天` 分区（即使 0 会话），位置在 `项目` 之上、与 `项目` 平级；点标题 → 切到聊天目录；
  `+` → 直接开新对话；折叠箭头只影响聊天自己的会话列表。
- `新建任务` 右侧箭头 → 「不在项目中（聊天）」/ 项目列表 / 「添加项目…」。
- 未选中任何项目时首屏是输入框（不是「开始使用」）。
- 聊天会话在侧栏只出现在聊天分区，不会同时出现在项目区。
- 文件浏览器可浏览聊天目录；家目录不会被顺带放开。

## 已知取舍

- 聊天目录**换掉后老会话不会迁移**（pi 会话按 cwd 编码分目录），所以定好后尽量别再改；
  改目录只影响之后新建的会话。
- PiDeck 还有一个"匿名会话"（不落盘），本补丁不做：pi 的会话模型始终写 `.jsonl`。
- 测试基线（合并上游后重跑）：`tsc --noEmit`、`npm run lint`、`npm test`。
  本机已知环境性失败与本补丁无关：缺 `git`（worktree/subagent-isolation）、缺 `bash`
  （project-command-env）、`node-pty` 未构建（terminal-manager），以及
  `components/ChatInput.test.mjs` 的图片告警用例。

## 合并上游后怎么重打

```bash
# 1. 看这次上游是否碰到本补丁的文件
grep -n "fork:chat-workspace" components/SessionSidebar.tsx lib/file-access.ts lib/project-groups.ts

# 2. 逻辑冲突一律取上游，再按「改动清单」逐条重接；新增文件整份保留

# 3. 校验
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
