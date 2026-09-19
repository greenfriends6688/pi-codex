# 0015 · 探索分支 + 结论带回主线（PROMA-05）

| 项 | 值 |
| --- | --- |
| 意图 | 从主线任意一条消息开一条**探索分支**（继承该点之前的上下文），分支里得到的结论可以一键「带回」主线草稿（不自动发送） |
| 参照实现 | Proma：右栏 `exploration:<sessionId>` tab、「带回结论」只写草稿；探索元数据 `explorationParentSessionId / sourceMessageId / sourceLabel` |
| fork 标记 | `fork:proma-05-explore` |
| 新增文件 | 3 个：`lib/exploration.ts`、`lib/exploration.test.mjs`、`components/fork/ExplorationBanner.tsx` |
| 上游文件接触面 | 4 个：`components/ChatWindow.tsx`（2 处接线）、三个 i18n 文件（8 个 key） |
| `.patch` | [`0015-exploration.patch`](./0015-exploration.patch)（18.0KB，7 个文件；**基线是动手前的真快照**） |

## 一个关键判断：来源不需要元数据

规格要求存 `explorationParentSessionId / sourceMessageId / sourceLabel` 三个字段。**本仓不需要**：pi 的 `SessionManager.createBranchedSession()` 把 fork 点之前的 entry **按原 id 复制**给新会话（`node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/...` 里 `pathWithoutLabels = path.map(e => ({...e, parentId}))`）。

于是「从哪条消息探索来的」可以**从文件本身推出来**：

- 分支 entry id 与父会话 entry id 的**公共前缀** = 被复制过来那段历史；
- 前缀最后一条 = fork 点之前那条；父会话里它的**下一条** = 被 fork 的那条消息（=`sourceLabel`）；
- 分支里前缀之后的 assistant 文本 = 要带回去的结论。

少一处元数据就少一处会漂移的状态（也就不用动服务端）。代价：要看父会话一眼（`GET /api/sessions/[id]/context`），拉不到就**不显示**抬头条 —— 宁可不显示，不给假来源。

## 语义与边界（都在 `lib/exploration.ts`，纯函数）

| 规则 | 为什么 |
| --- | --- |
| **至少要有 1 条共有 entry** 才算探索分支 | subagent 会话同样有 `parentSessionId` 但没有复制过来的历史，不能误判 |
| 公共前缀遇到新条目就**停止匹配**（不做集合交集） | 分支自己新加的 entry 之后如果又撞上父会话的 id，那也不是共有历史 |
| 「带回」只取 **assistant** 文本，且只在 fork 点之后 | pre-fork 内容已经在父会话里，重复注入 = 双倍上下文；用户问题没必要带 |
| 没有可带回的内容时 `planBringBack` 返回 null | 按钮置灰，而不是往草稿里写个空串 |
| 携带 `&session:<分支 id>` 引用进草稿 | 父会话发出去时能追溯到结论来自哪条分支（复用 0003 的引用管道） |
| **不自动发送** | Proma 明确如此：自动发送会污染主线，这是设计意图不是遗漏 |
| 关闭分支 tab ≠ 删除分支 | 分支是独立会话文件，父会话 header 里的 `parentSession` 一直指向它 |

与「会话内分支」（`navigate_tree`，同一个文件里多个 leaf）不是一回事：探索是**新文件**。

## 验收

- 单测 `lib/exploration.test.mjs`（9 例）：文本抽取忽略 thinking/toolCall；标签压平与截断；公共前缀定位 fork 点；新条目之后不再匹配；无共有条目 → null；fork 在首条消息之后 → `sourceLabel` 为空串；delta 只取 assistant；只有用户消息 → 空结论；`planBringBack` 追加已有草稿 + 引用去重 + 空结论返回 null。
- 浏览器冒烟 `test-results/smoke-exploration.mjs`（Playwright，一次性 fixture 会话，5 项全过）：分支显示「探索分支」抬头条 → 抬头条写出父会话那条来源消息 → 点「带回结论」切到父会话 → 父会话草稿里出现分支结论 → **父会话转录仍是 2 条（没有自动发送）**。
- `tsc --noEmit` 干净；`npm run lint` 0 error；`npm test` 全绿（环境性失败见仓库说明）。

## 还没做的（规格里的下一层）

- **右栏并排**：Proma 是把探索分支开在右栏 tab 里和主线并排看。本仓的 `Tab`（`components/TabBar.tsx`）目前只承载文件/终端/浏览器，**新增一种「会话 tab」要动 AppShell 的 tab 模型**，所以这一版先复用既有行为：fork 出来的分支直接作为当前会话打开（`onSessionForked` → `?session=<新 id>`），抬头条给出「打开父会话」回跳。
- **划词探索**（`AgentHistorySelectionLayer` 那个入口）：本仓的选区工具栏（若有）可以直接复用同一个 fork 动作，不需要新逻辑。
- 消息操作栏里**没有单独加**「探索此分支」按钮：既有「新会话」按钮走的 `fork` 命令与探索**完全同一条路径**（同一份复制语义），再加一个同名同义的按钮只会让人猜两者差别；抬头条会自动出现。要独立入口/文案的话是 3 行的事。

## 合并上游后怎么重打

```bash
grep -rn "fork:proma-05-explore" components/ChatWindow.tsx lib/i18n/messages/*.ts
# 四个不变式：
#   1) 来源靠父子 entry id 公共前缀推，别再存一份元数据；
#   2) 带回只取 fork 点之后的 assistant 文本；
#   3) 带回只写草稿、绝不自动发送；
#   4) 推不出来源就不显示抬头条（不要给假来源）。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
