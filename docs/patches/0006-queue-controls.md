# 0006 · 队列逐条操控（撤回 / 删除 / 拖拽排序 / 立即发送）

| 项 | 值 |
| --- | --- |
| 意图 | 把「队列」从只读列表变成可逐条操作：删一条、拖拽排序、把 follow-up 提升为立即送达的 steer |
| 参照实现 | B（Proma）的逐条撤回 / 删除 / 拖拽排序 / 立即发送（`docs/proma-prs-2026-09-18.md` 的 **GAP-04**，含 **GAP-30**「保留本仓 steer/followUp 双语义」） |
| 补丁文件 | [`0006-queue-controls.patch`](./0006-queue-controls.patch) |
| fork 标记 | `fork:gap04-queue` |
| 新增文件 | 2 个（`lib/queue-surgery.ts` + 单测） |
| 上游文件接触面 | 7 个：`lib/rpc-manager.ts`（4 处）、`hooks/useAgentSession.ts`（3 处）、`components/ChatInput.tsx`（5 处）、`components/ChatWindow.tsx`（2 处）、三个 i18n 文件（各 2 个 key） |

## 先说 spike 结论（这是文档点名要先做的事情）

GAP-04 被标为「本清单里唯一会碰 agent 消息传递时序的 PR」，所以先读了 SDK 的实现，结论是三条：

1. **pi 没有单条出队语义**。`AgentSession` 只提供 `clearQueue()`（全清），以及 `getSteeringMessages()`
   / `getFollowUpMessages()` 两个只读视图；队列本体在 `Agent` 的 `PendingMessageQueue`（`enqueue` /
   `drain` / `clear`，同样没有 `remove(index)`）。→ 单条操作只能直接改队列内部结构。
2. **队列是两层的**：`AgentSession._steeringMessages` / `_followUpMessages`（**文本镜像**，UI 读的就是它）
   ＋ `Agent.steeringQueue` / `followUpQueue`（真正被 drain 的 `PendingMessageQueue`）。
   `clearQueue()` 会同时清两层。→ 逐条操作也必须同时改两层。
3. **交付是「按文本删第一条」**：`_handleAgentEvent` 在 `message_start` 时做
   `_steeringMessages.indexOf(messageText)` → `splice(index, 1)`。→ 两条同文本的消息永远删到第一条；
   而且只要两层不同步，镜像就会与真队列永久漂移（后面新入队的同文本消息会被镜像提前「消费」掉）。

所以本补丁的纪律是：**按下标操作、两层一致才允许写、写要原子**。

## 方案

```
浏览器（ChatInput 行内控件 / 拖拽）
   │  POST /api/agent/<id> { type: queue_remove | queue_move | queue_promote, kind, index, to?, expect? }
   ▼
rpc-manager：withQueueLock（同会话串行）
   ├─ readQueueState()      取镜像
   ├─ applyQueueOperation() 纯函数：按下标算新状态（lib/queue-surgery.ts，可单测）
   ├─ writeQueueState()     校验两层逐项文本一致 → 用**两个队列共用的对象池**取消息对象 → 全部算完再写
   └─ 广播 queue_update（SDK 私有广播 + 本层自己的广播）
```

四个关键决定：

- **`expect`（下标 + 文本）一起校验**：队列会因交付而前移，只校验下标会误删用户没打算删的那条。
  文本不符 → 拒绝并回传当前队列（`applied: false, reason: "stale"`），UI 据此刷新而不是猜。
- **两层一致才写**：`sameQueue(mirror, core)` 不成立就拒绝。这是唯一能挡住「交付正好插在中间」的关卡。
- **对象池跨两个队列**：`promote` 要把消息从 followUp 搬到 steering，只在本队列里找对象是找不到的
  （端到端测试第一次跑就撞上了这个）。
- **原子写**：先把两边的新数组都算出来再赋值。第一版是「先改镜像、再改核心」，核心那步抛错后两层
  永久漂移，后续操作全部被拒（也是端到端测试抓到的）。

## 改动清单

### 新增（无冲突面）

| 文件 | 作用 |
| --- | --- |
| `lib/queue-surgery.ts` | 纯函数：`applyQueueOperation`（remove / move / promote）、`sameQueue` 两层一致性、`queueContains`。全部按**下标**操作，`expect` 做过期校验 |
| `lib/queue-surgery.test.mjs` | 11 例：重复文本删第二条（SDK 的 `indexOf` 做不到）、越界、过期、带/不带 `expect`、前/后/末尾拖拽、原地不动另一个队列、提升到队首、提升的越界与过期 |

### 上游文件的接线改动（每处都有 `fork:gap04-queue` 标记）

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `lib/rpc-manager.ts` | import / 字段 | 引入纯函数 + `private queueLock` |
| | 三个 RPC case | `queue_remove` / `queue_move` / `queue_promote`，返回 `{ applied, moved?, queue, reason? }`（**不抛异常**，过期要让 UI 显示原因） |
| | 私有方法 | `readQueueState` / `messageText` / `queueLayers` / `writeQueueState` / `withQueueLock` |
| `hooks/useAgentSession.ts` | import | `QueueKind` 类型 |
| | 新块 | `runQueueOperation`（统一三个操作：以服务端返回的权威状态覆盖本地，失败给通知并重取 `get_state`）+ `handleQueueRemove` / `handleQueueMove` / `handleQueuePromote` |
| `components/ChatInput.tsx` | props / 解构 | 三个可选回调 |
| | state | `draggingQueue`（**载荷存在 ref 里**，见下）+ `beginQueueDrag` / `endQueueDrag` / `queueDropTarget` |
| | `QueuedMessageRow` | 重写：可拖拽、行内 ✕（移除）与 ↑（立即发送，仅 follow-up），hover 显现但可键盘聚焦 |
| | 队列面板 | 两处渲染接上回调与拖放 |
| `components/ChatWindow.tsx` | 解构 + props | 把三个 handler 传下去 |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | `chat.attachImage` 附近 | 每个语言 2 个 key（`queueRemove`、`queueSendNow`） |

### 两处 UI 上的坑（都由浏览器冒烟抓出来）

1. **拖拽载荷不能只放 React state**：`drop` 可能在 `dragstart` 的同一个 tick 里发生（真实拖拽里也有极快的
   甩拖），此时 state 还是旧值 → 拖拽静默失效。改成 `draggingQueueRef` 存载荷，state 只管置灰。
2. **落点下标要分方向**：往下拖落在目标行**之后**、往上拖落在它**之前**（`queueDropTarget`），
   否则「把第一条拖到第二条上」会算出原地不动。

## 验收

- `npm run lint`：**0 error / 245 warning（与改动前同数）**；`tsc --noEmit` 干净。
- `npm test`：**1515 个测试，1502 通过**，11 个失败与改动前完全同一批（bash 环境 / PTY / worktree /
  ContextMenuProvider 脚手架 / 图片告警用例）。本补丁新增 11 例全绿。
- **端到端（真实跑一轮，`test-results/smoke-queue.mjs`）**：这一层是必须的 —— 只验 `get_state` 会漏掉
  「镜像改了、真队列没改」这种半改。脚本排队 `F1`/`F2`（follow-up）+ `S1`（steer），依次做
  拖拽排序 → 提升 → 逐条移除 → 过期/越界拒绝，最后**读转录里 agent 实际收到的消息**：

  | 检查 | 结果 |
  | --- | --- |
  | 三条都进队列 | ✅ |
  | `queue_move` 后 F2 到 F1 前面 | ✅ |
  | `queue_promote` 后 F2 落到 steering 队首、离开 followUp | ✅ |
  | `queue_remove` 删掉 F1 | ✅ |
  | 文本不符 → `stale`；越界 → `out-of-range`；**被拒的请求不改动队列** | ✅ |
  | 转录里实际收到：`F2` → `S1`，**F1 从未交付** | ✅ |
  | 跑完两层都清空、无残留 | ✅ |

- **UI 冒烟（`test-results/smoke-queue-ui.mjs`）**：真实会话排队后用浏览器操作 —— 点 ✕ 删掉指定那一条、
  点 ↑ 把它提升到 steering 队首、合成拖拽把「甲」拖到「乙」之后（**服务端队列顺序确实变成 [乙, 甲]**）；
  队列面板渲染 3 行；浏览器报错 0 条。截图：`test-results/verify/Q1..Q4-*.png`。

## 已知取舍

- **「立即发送」= 把 follow-up 提升为 steer**，不是「打断当前输出」。pi 没有「插队立刻打断」的语义，
  steer 的语义是「本轮工具调用结束后、下一次 LLM 调用前送达」——这是现有语义下最接近「立即」的做法，
  也顺带就是 GAP-30 要求保留的双语义之一。
- **不允许跨队列拖拽**：steer 与 follow-up 是两个语义不同的队列，拖拽只做队列内排序；跨队列的意图
  由「立即发送」（follow-up → steer）单独表达。
- **镜像与核心队列的顺序一致性依赖 SDK 的入队顺序**（两者总是同序 push）。若上游把
  `PendingMessageQueue` 改成优先级队列，`writeQueueState` 的对象池匹配会失配并**抛错拒绝**（不会静默写坏）。
- 没有做「暂停队列 / 批量选择」。GAP-04 只要求逐条操控；批量属于 UI 增强。

## 合并上游后怎么重打

```bash
grep -rn "fork:gap04-queue" lib/rpc-manager.ts hooks/useAgentSession.ts components/ChatInput.tsx components/ChatWindow.tsx

# 上游若把 PendingMessageQueue 或 _steeringMessages 改名/改语义，只需改 queueLayers() 与
# writeQueueState() 两处（纯逻辑不依赖 SDK 形状）；保持四个不变式：
#   1) 按下标操作、expect 校验过期；2) 两层一致才写；3) 对象池跨两个队列；4) 先算完再写（原子）。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
