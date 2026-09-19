# 0016 · 子会话「没跑完」显示为已中断（PROMA-06 之一）

| 项 | 值 |
| --- | --- |
| 意图 | 上次标记为「运行中/排队中」但进程其实已经没了的子会话，不能再显示成在跑 —— 用户会一直等一个永远不会来的结果 |
| 参照实现 | Proma：启动时把 running 的委派标记为 interrupted（不可续） |
| fork 标记 | `fork:proma-06-delegation` |
| 新增文件 | 2 个：`lib/subagent-status.ts`、`lib/subagent-status.test.mjs` |
| 上游文件接触面 | 4 个：`components/AgentSessionPanel.tsx`（1 行）、三个 i18n（补 `agentSwitcher.status.queued`） |
| `.patch` | [`0016-subagent-status.patch`](./0016-subagent-status.patch)（6.2KB，6 个文件；基线是动手前的真快照） |

## 现状核实（先 grep 再动手）

服务端的 `readSubagentRun()` 已经有一层推导：最后一条 lifecycle entry 既不是 `pi-web:subagent-result` 也不是合法的 `pi-web:subagent-status` 时，返回 `interrupted`。

**但它漏掉了最大的一类**：最后一条就是合法 status、内容是 `running`/`queued`，而进程早就没了（重启、崩溃、被 OOM 杀掉）。这种情况下它照样返回 `running` —— 面板于是永远显示「运行中」。

实测（fixture：元数据 + `pi-web:subagent-status {status:"running"}`，无进程）：

```
/api/sessions → relation = {"kind":"subagent", …, "status":"running"}   ← 假状态
```

## 修法：展示层统一算「有效状态」

新增 `lib/subagent-status.ts`（纯函数）：

```ts
// 真的在跑 → running；不在跑但持久化是活状态（starting/queued/running）→ interrupted；
// 其余照持久化状态；没有状态信息 → completed
effectiveSubagentStatus(persisted, { running })
```

`components/AgentSessionPanel.tsx` 原来写的是 `running ? "running" : relation?.status ?? "completed"`，改成走这个 helper（1 行）。

## 决策

1. **在展示层判，不去改会话文件里的状态**：会话文件是历史记录，读取过程不应该改写它（也就不会带来新的写冲突）。
2. **「不在跑 + 持久化是活的」＝ `interrupted`，不是 `completed`**：那次委派根本没有产出结果，标成完成会撒谎。
3. **没跑完但用户从没看过的，也不显示成完成**（同一规则顺带覆盖）。
4. **侧栏不加第二套入口**：核实过本仓的子会话**不在侧栏渲染**（只按项目列 root 会话），子会话状态在顶栏的 Agents 面板里。我先在侧栏加了一版标记，实测确认那里根本没有子会话行 → 撤掉，不造重复入口。
5. 顺带补上三语言都缺的 `agentSwitcher.status.queued`（`queued` 状态此前没有文案，会直接漏出 i18n key）。

## 验收

- 单测 `lib/subagent-status.test.mjs`（5 例）：真在跑 → running（压过持久化值）；`starting/queued/running` + 不在跑 → interrupted；`completed/failed/aborted` 透传且不算中断；`interrupted` 透传且算中断；无状态 → completed；标签 key 单一来源。
- 浏览器冒烟 `test-results/smoke-subagent-status.mjs`（Playwright，一次性 fixture 会话，**4/4**）：顶栏出现 Agents 按钮 → 面板列出该子会话 → **显示「已中断」** → 描述行里不是「运行中」（实测输出 `general-purpose · 8秒钟前 / 已中断`）。
- `tsc --noEmit` 干净；`npm run lint` 0 error（245 warning 基线）；`npm test` 全绿（环境性失败见仓库说明）。

## 还没做（PROMA-06 的另外两块）

- **阻塞冒泡**：子会话遇到审批/提问时，父会话直接看到并能回答（Proma 的 `delegation_blocked`）。这需要把子会话的 `extension_ui_request` 转发到父会话的事件流，并在父会话里渲染可作答的卡片 —— 是独立的一块，值得单独立补丁。
- **委派状态的「未查看」语义**：现在有 running/completed/failed/aborted/interrupted，但「完成但用户没看过」还没做（侧栏对子会话本就不显示，落点应在 Agents 面板的角标上）。

## 合并上游后怎么重打

```bash
grep -rn "fork:proma-06-delegation" components/AgentSessionPanel.tsx lib/subagent-status.ts
# 三个不变式：
#   1) 展示层只用 effectiveSubagentStatus 判状态，别再自己写 running ? … : …；
#   2) 活状态 + 不在跑 → interrupted（不是 completed）；
#   3) 会话文件里的持久化状态不许被读取路径改写。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
