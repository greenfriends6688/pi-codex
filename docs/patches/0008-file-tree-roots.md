# 0008 · 文件树：多根 + 作用域徽标 + 三个细节

| 项 | 值 |
| --- | --- |
| 意图 | 会话在 worktree 里时能同时看到「会话那份」与「项目根」；并补上文件树的三处细节 |
| 参照实现 | GAP-08（B 的 `FileBrowserRoot {path, scope}` 合并渲染）、GAP-10（粘性目录行 / 搜索定位 / 空目录重试） |
| 补丁文件 | [`0008-file-tree-roots.patch`](./0008-file-tree-roots.patch) |
| fork 标记 | `fork:gap08-roots`、`fork:gap10-sticky-dir`、`fork:gap10-search-scroll`、`fork:gap10-tree-retry` |
| 新增文件 | 3 个（`lib/file-browser-roots.ts` + 单测、`components/FileExplorer.roots.test.mjs`） |
| 上游文件接触面 | 6 个：`FileExplorer.tsx`（多处接线）、`ExplorerPanel.tsx`（3 处）、`AppShell.tsx`（1 处）、三个 i18n 文件（各 3 个 key） |

## GAP-08：多根只做「并存 + 徽标」，不动现有分组

本仓的文件树一直只接一个 `cwd`。而一个会话的 `cwd` 与它所属项目的根**可能不同**：

```
会话跑在 worktree 里：  cwd = <repo>-worktrees/<branch>    projectRoot = <repo>
普通会话 / 非 git 目录： cwd = projectRoot                  ← 绝大多数情况
```

所以按文档建议只做最小改动：**只有两者真的不同时**才多出一个「项目」根（带作用域徽标），
相同就退化成一个根、界面与改动前**完全一致**（没有多余的分组头）。去重一律走
`lib/paths.ts` 的 `samePath()` —— Windows 上 `C:\a` 与 `c:/a` 是同一个目录，而 git 还会吐
POSIX 风格路径，字符串相等判断在这件事上是错的。

两个实现决定：

- **主根不改成循环**：主根的渲染缠着上传回执、git 徽标、上传高亮、刷新脉冲与搜索，
  拆出来风险远大于收益。额外根走一条轻量路径（`RootSection`：列目录 + 展开 + 打开文件）。
- **watch 按根订阅**：FIX-08 的 `/api/file-watch?path=` 是**按路径**建立的，多根就必须多条
  `EventSource`（文档也点明了「watch 订阅需按根建立」）；额外根有自己的脉冲，主根的刷新链路不动。

## GAP-10：三个细节

| 细节 | 做法 | 为什么这么做 |
| --- | --- | --- |
| 粘性目录行 | 展开的目录行 `position: sticky`，`top` 按深度错开（封顶 3 层），背景用不透明的 `--bg-panel` | 不透明否则会看穿到下面的行；深度封顶否则深层目录会把内容推出视口 |
| 搜索命中滚动居中 | 命中行 `scrollIntoView({ block: "center" })`，由点击搜索结果的包装回调设目标 | **祖先自动展开本来就有**（既有的 effect 负责），所以这一项只缺滚动 |
| 空目录重试 | 首次列出为空 → 800ms 后**重试一次**（`isRetry` 防递归），定时器在卸载时收掉 | agent 刚 `mkdir`/刚写文件时，列表很容易在落盘前返回空，用户看到的就是一个永远空着的目录 |

顺手修掉一个 i18n 漏洞：空目录文案原本是**硬编码英文 `empty`**，现在是 `files.emptyDirectory`。

## 改动清单

### 新增

| 文件 | 作用 |
| --- | --- |
| `lib/file-browser-roots.ts` | 纯函数：`buildFileBrowserRoots`（相同则单根、不同则会话在前 + 项目在后）、`fileBrowserRootPaths`（去重）、`fileBrowserRootName`（展示名） |
| `lib/file-browser-roots.test.mjs` | 6 例：无 cwd、相同→单根、worktree→两根、Windows 大小写/分隔符等价只算一根、去重保序、盘符根名 |
| `components/FileExplorer.roots.test.mjs` | 7 例：组件渲染断言（相同→无徽标 / 不同→出现「项目」根与 title）+ watch 按根订阅、粘性、滚动居中、空目录重试（含定时器回收）与 i18n 空态 |

### 上游文件接线（每处都带 fork 标记）

| 文件 | 改动 |
| --- | --- |
| `components/FileExplorer.tsx` | import；`projectRoot` prop；`browserRoots` / `extraRoots` memo；额外根的 watch effect（多条 EventSource）+ 自己的脉冲；`RootSection` 组件与渲染；`TreeNode` 的粘性样式、`scrollToPath` 与滚动、空目录重试与新 i18n 文案、递归下传 `scrollToPath`；搜索面板的点击包装 |
| `components/ExplorerPanel.tsx` | `projectRoot` prop 透传 |
| `components/AppShell.tsx` | 传 `projectRoot={selectedSession?.projectRoot ?? null}` |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | 各 3 个 key：`files.scopeSession`、`files.scopeProject`、`files.emptyDirectory` |

## 验收

- `tsc --noEmit` 干净；`npm run lint` **0 error / 245 warning（与改动前同数）**。
- `npm test`：**1530 个测试，1517 通过**，11 个失败与改动前完全同一批。新增 13 例全绿
  （helper 6 + 组件 7）。
- 浏览器冒烟（`test-results/smoke-file-tree.mjs`，真实会话 + 真实右栏）：
  - 文件树 **35 行**渲染且**可见**（脚本顺带用 sessionStorage 打开了右栏，避免只数到 DOM）；
  - 单根会话**不出现**作用域徽标（0 个）；
  - 搜索打开 → 命中列表渲染 → 点击命中不报错；
  - 浏览器报错 **0 条**；截图 `test-results/verify/T-tree-single-root.png` 等。

## 已知取舍与没验到的部分

- **多根分支的「目视」验证只到组件渲染层**：本机这份树**没有 `.git`**（也没有 worktree），
  所以「会话在 worktree 里 → 多出一个项目根」没有真实会话可点。组件测试断言的正是那段 JSX
  （徽标文案 + `title` 为项目根路径），逻辑分支则由 helper 的 6 例覆盖。
- 额外根**不显示 git 徽标 / 上传高亮**（它们在主根链路里，键都是主 cwd）。worktree 会话的项目根
  一般是「别处的仓库状态」，本补丁不越界；需要时按同样方式再接一条 git status 请求即可。
- 粘性只做在**展开的目录行**上，深度封顶 3 层（更深的目录共用第 3 层的偏移）。
- GAP-10 提到 B 的「祖先导引线（最多 8 层）」**没做**：本仓的行已靠 `paddingLeft` 表达层级，
  加导线是纯视觉增量，留作以后按需。

## 合并上游后怎么重打

```bash
grep -rn "fork:gap08-roots\|fork:gap10-" components/FileExplorer.tsx components/ExplorerPanel.tsx components/AppShell.tsx
# 上游若重写文件树，先保住三件事：
#   1) 根列表由 lib/file-browser-roots.ts 算（samePath 去重），相同则单根；
#   2) watch 按根建立；
#   3) TreeNode 的粘性行 / 命中滚动 / 空目录重试三个细节。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
