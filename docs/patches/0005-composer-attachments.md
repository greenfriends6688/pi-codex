# 0005 · 附件模型：任意文件 + 上传上限 + 超限降级为路径引用

| 项 | 值 |
| --- | --- |
| 意图 | 拖入任何文件都不再被拒收 / 静默丢弃：能落的落盘并写进消息，超限的明确告诉用户为什么没有加 |
| 参照实现 | B（Proma）的「任意文件 100MB，>100MB 且有源路径时降级为路径引用」（`docs/proma-prs-2026-09-18.md` 的 **GAP-07**） |
| 补丁文件 | [`0005-composer-attachments.patch`](./0005-composer-attachments.patch) |
| fork 标记 | `fork:gap07-attachments` |
| 新增文件 | 4 个（`lib/composer-attachments.ts` + 单测、`app/api/attachments/route.ts` + 单测） |
| 上游文件接触面 | 8 个：`ChatInput.tsx`（8 处）、`ChatWindow.tsx`（2 处）、`hooks/useDragDrop.ts`（2 处）、`lib/desktop-shell.ts`（2 处）、`electron/preload.js`（2 处）、三个 i18n 文件（各 6 个 key） |

## 为什么要这么做（以及为什么不能「把文件塞进消息」）

`lib/image-attachments.ts` 的 `validateAgentImages` 是 pi 的 prompt 内容块边界：
**只有 `text` 与 `image`**。所以图片以外的字节**不可能**直接进上下文，无论前端怎么改。
唯一可行的机制是：把文件落到磁盘，把**路径**写进消息，由 agent 用自己的工具去读 ——
这也是文档里「降级为路径引用」的方向。

于是本补丁把入口分成三类出口，**没有一条是静默丢弃**：

| 出口 | 条件 | 落地 |
| --- | --- | --- |
| 内联图片 | `image/*` 且 ≤10MB 且未超过 10 张 | 既有管道 + 压缩，**完全保持不变** |
| 路径引用 | 其他文件，且 ≤ 上传上限 | 上传到附件目录 → 输入框插入 `@<绝对路径> ` |
| 跳过（有原因） | 超限**且**拿不到本地路径 | 顶部提示「已跳过（超过 25MB 且拿不到本地路径）：xxx.bin」 |

改动前 `ChatInput.tsx` 的行为是：非图片直接不匹配 → `if (!imageFiles.length) return;`
（超限/第 11 张图片同理）→ 用户拖了文件什么也没发生，这正是 GAP-07 要修的点。

## 方案

### 上传目标：专用附件目录，字节仍走既有上传路由

既有上传路由（`app/api/files/[...path]/route.ts` 的 POST）已经具备：25MB/文件、100MB/单次、
三种冲突策略、`parseFormDataWithinLimit` 的有界解析。它唯一的限制是**目标目录必须在允许根内**，
而允许根来自会话 cwd / 项目根 —— 往用户仓库里随手写附件是不能接受的。

所以新增 `GET /api/attachments`：返回 `<agentDir>/attachments/YYYY-MM-DD/`（按天分桶，
不存在则创建），并 `allowFileRoot()` 把它登记为允许根。**没有新开写通道**，字节仍旧走既有路由。

### 同名不覆盖

先 `conflict=skip`；被跳过的那些改名重试（`report.csv` → `report-2.csv` → `report-3.csv`，最多 5 轮）。
不用 `conflict=overwrite`：附件目录是当天的暂存区，同名覆盖会让**旧消息里的引用指向新内容**，
那种错误事后很难发现。

### 桌面外壳的就地引用

浏览器拿不到 `File` 的真实路径（安全限制），Electron 可以：`preload.js` 暴露
`filePathFor(file)`（内部是 `webUtils.getPathForFile`），`lib/desktop-shell.ts` 包一层
`desktopFilePathFor()` 并在桥不可用时安静返回 `null`。拿到路径的超限文件**不复制字节**，
直接把原路径写进消息 —— 这就是「>上限且有源路径时降级为路径引用」那条。

### 与图片管道的关系

`attachFiles()` 先挑出图片管道能收的（≤10MB、≤10 张），**其余全部**走路径引用分支 ——
包括「第 11 张图片」和「12MB 的图片」。它们以前会消失，现在至少变成一条可用的引用。

## 改动清单

### 新增（无冲突面）

| 文件 | 作用 |
| --- | --- |
| `lib/composer-attachments.ts` | 纯函数：`planAttachments`（上传预算 / 每文件上限 / 就地引用 / 跳过）、`sanitizeAttachmentName`、`nextAvailableAttachmentName`、`buildAttachmentReference`（复用 `@` 的引号规则）、`attachmentNotice` |
| `lib/composer-attachments.test.mjs` | 12 例：类型不再限定图片、每文件上限优先于合计预算、超限有路径→就地引用、超限无路径→显式跳过、预算按顺序消耗、文件名清洗、重名后缀、引用文本与光标偏移 |
| `app/api/attachments/route.ts` | `GET` → 建目录 + `allowFileRoot` + 返回 `{ dir }`；跨站请求 403 |
| `app/api/attachments/route.test.mjs` | 3 例：按天分桶且在 agent 目录下、GET 建目录、跨站拒绝 |

### 上游文件的接线改动（每处都有 `fork:gap07-attachments` 标记）

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `components/ChatInput.tsx` | import / state | 引入纯函数模块 + 提示条状态 |
| | （新块） | `appendAttachmentReferences`、`uploadAttachmentFiles`（含改名重试）、`attachFiles` |
| | imperative handle | 新增 `addFiles()`（拖拽入口用），保留 `addImages()` |
| | 粘贴 / 文件输入 / 附件按钮 | 统一走 `attachFiles`；`accept="image/*"` → 任意文件；按钮文案 → 「添加附件」 |
| | render | 结果提示条（已加入 / 已跳过 / 上传失败，可关闭） |
| `components/ChatWindow.tsx` | `onDrop` | `addImages` → `addFiles` |
| | 拒收提示文案 | 「只能拖入图片文件」→「只能拖入文件」 |
| `hooks/useDragDrop.ts` | `handleDragEnter` / `handleDragOver` | 判定从 `type.startsWith("image/")` 改为 `kind === "file"` |
| `lib/desktop-shell.ts` | `DesktopBridge` / 导出 | `filePathFor?()` + `desktopFilePathFor()` |
| `electron/preload.js` | 引入 / 暴露 | `webUtils` + `filePathFor`（try/catch → null） |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | `chat.attachImage` 附近 | 每个语言 6 个 key（`attachFile`、`attachmentAdded/Skipped/Failed`、`dropFilesOnly`，并移除旧的 `dropImagesOnly`） |

## 验收

- `npm run lint`：**0 error，245 warning（与改动前同数）** —— 中途曾多出 1 条
  `react-hooks/exhaustive-deps`（粘贴回调漏了 `attachFiles`），已修。
- `node_modules/.bin/tsc --noEmit` 干净。
- `npm test`：新增 15 例全绿（`lib/composer-attachments` 12 + `app/api/attachments` 3）；
  全套的 11 个失败与本次无关且**改前就在失败名单**（bash 环境 / PTY / worktree / ContextMenuProvider 脚手架 / 图片告警用例）。
- 浏览器冒烟（`test-results/smoke-attachments.mjs`，对真实 dev 服务）：
  - 拖入 `.csv` → 输入框出现 `@C:/Users/.../agent/attachments/2026-09-18/e2e-report-*.csv `，
    提示条「已作为引用加入」；并用 `/api/files/<path>?type=read` **读回内容一致**（证明字节真的落盘）；
  - 同一文件名再拖一次 → 入库为 `-2.csv`（**没有覆盖**）；
  - 拖入 30MB 文件（网页版无本地路径）→ 提示「已跳过（超过 25MB 且拿不到本地路径）：big.bin」，
    输入框不受污染；
  - 不再出现「只能拖入图片」的拒收提示；浏览器报错 0 条。

## 已知取舍

- **每文件上限保持 25MB（不是文档写的 100MB）**：上传路由的封套是这个数，放宽它会同时影响
  文件树的上传功能。100MB 是**单次合计**上限。想要单文件 100MB 需要单独一个 PR 去调
  `MAX_UPLOAD_FILE_BYTES`，本补丁不顺手扩大写盘口径；超限时按上面的三条出口明确交代。
- 附件目录按天分桶且**不自动清理**：它是暂存区，旧目录由用户自行删除（放在 agent 目录下，
  不污染仓库）。清理策略属于 PROMA-17「存储管理 + 自动归档」。
- 只做了 `@路径` 引用，没有把文本类文件的内容内联进消息：pi 自己会读文件，内联会让每次
  拖入都往上下文里塞一份副本（且要重做一遍截断/转义规则）。
- 网页版没有本地路径能力，这是浏览器的限制而不是取舍；桌面版通过 `filePathFor` 已经能就地引用。

## 合并上游后怎么重打

```bash
grep -rn "fork:gap07-attachments" components/ChatInput.tsx components/ChatWindow.tsx hooks/useDragDrop.ts lib/desktop-shell.ts electron/preload.js

# 上游若重写了拖拽/粘贴/文件输入中的任意一条入口，把 attachFiles() 接回去即可 ——
# 它是所有入口的唯一落点，三条出口的判定都在 lib/composer-attachments.ts 里（纯函数，可单测）。
# 上游若改了 app/api/files 的上传上限，请同步 lib/composer-attachments.ts 的两个常量。

node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
