# 0010 · 会话回退「回退到此处」（PROMA-04）

| 项 | 值 |
| --- | --- |
| 意图 | 从某条消息起把会话**截断（含该条）**，它之后的对话消失；磁盘上已写的文件**不回退** |
| 参照实现 | Proma 的 rewind 契约（`agent-session-manager.ts:932-1030, 1118-1145`）：按 `entryId` 定位、含该条、正常返回且明确声明文件未回退 |
| fork 标记 | `fork:proma-04-rewind` |
| 新增文件 | 3 个：`lib/session-rewind.ts`、`lib/session-rewind.test.mjs`、`app/api/sessions/[id]/rewind/route.ts` |
| 上游文件接触面 | 5 个：`components/MessageView.tsx`（按钮 + props + memo 比较）、`components/ChatWindow.tsx`（接线 + 破坏性确认）、`hooks/useAgentSession.ts`（`handleRewind`）、三个 i18n 文件（3 个 key） |
| `.patch` | [`0010-session-rewind.patch`](./0010-session-rewind.patch)（21.3KB，9 个文件） |

## 语义层与 IO 分开

| 文件 | 内容 |
| --- | --- |
| `lib/session-rewind.ts` | `planRewind(lines, entryId)` 纯函数：**第 0 行会话头永远保留**（它不带 `id`，也不参与匹配）；**整个文件严格解析**——只要有一行不是合法 JSON 就整体拒绝（宁可不回退，也不要把读不懂的会话文件重写一遍，那是唯一可能永久丢数据的操作）；目标已是最后一条 → `nothing-to-drop` 拒绝而不是空写；返回 `kept` / `dropped` / `entryType`。`rewindSessionFile()` 是薄 IO：读 → 规划 → `writePrivateFileAtomicSync()` 原子写回（临时文件 + rename，"写一半失败"不会留下半个会话） |
| `app/api/sessions/[id]/rewind/route.ts` | `POST { entryId }`。运行中 → **409** + `reason: "running"`（不是 500：这是最常见的拒绝路径，UI 要能直接显示）；找不到 → 404；**先 `destroy()` wrapper 再截断**（同 AGENTS.md「Fork must destroy the wrapper immediately」，否则下次请求拿到的是被截断前的脏状态）；成功后 `invalidateSessionListCache()`；回执带 `filesReverted: false` |

## 我替用户拍板的决定

1. **破坏性操作先确认**，文案最显眼处写「不可撤销」和「文件不会回退」：`window.confirm(t("rewind.confirm"))`。
2. **文件回退明确不做**（与 Proma 一致）：正常返回 + 回执声明 `filesReverted: false`，而不是假装支持或直接报错 —— 避免用户以为磁盘上的代码改动也回滚了。
3. **服务端拒绝给可读原因 + 机器可读 `reason`**，UI 按 reason 决定文案与重试入口。（UI 侧 `addNotice` 的文案目前与 hook 里其它 notice 一样是英文，属**既有风格**，不是这条补丁引入的。）
4. **成功后重载上下文**：回退改的是文件，界面若停在已删除的 leafId 上会继续显示旧消息 → `loadContext(sid, null)` + `setActiveLeafId(null)`，回到当前分支的叶子。
5. **客户端先拦一道，服务端再判一次**：客户端拦是为了即时可读的原因；服务端判是为了正确性（多标签页并发时客户端状态不作数）。

## 验收

- 单测 `lib/session-rewind.test.mjs`：**9 例全绿** —— 含该条截断 / 目标就是最后一条 → 拒绝 / 找不到 entryId / 有一行坏 JSON 就整体拒绝 / 头部永不参与 id 匹配 / 空文件与空行 / 真的截断文件且声明 `filesReverted:false` / 失败时绝不改动文件 / 文件不存在时给可读失败
- 浏览器与端到端：`test-results/smoke-rewind-ui.mjs`、`test-results/smoke-rewind.mjs`（一次性脚本，gitignored）
- `tsc --noEmit` 干净；`npm run lint` 0 error（245 warning 是既有基线）

## 顺带清掉的死代码

`lib/session-rewind.ts` 里的 `rewindSummary()` 没有任何调用方（UI 自己拼提示语），而且引用了三个语言都没定义的 `rewind.done` / `rewind.failed` —— 删掉，少一处会漂移的文案源。

## 合并上游后怎么重打

```bash
grep -rn "fork:proma-04" components/MessageView.tsx components/ChatWindow.tsx hooks/useAgentSession.ts
# 三个不变式：
#   1) 截断必须"含目标条"，且头部永远保留；
#   2) 严格解析：一行坏 JSON 就整体拒绝，绝不部分重写；
#   3) 先 destroy wrapper 再写文件；运行中必须 409。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
