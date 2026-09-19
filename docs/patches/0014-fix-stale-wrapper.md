# 0014 · dev 热更新后陈旧 wrapper 自愈（fork:fix-stale-wrapper）

| 项 | 值 |
| --- | --- |
| 意图 | dev 模式热更新后，新加的命令在老会话上报 `Unsupported command: xxx`，看起来像「功能坏了」 |
| fork 标记 | `fork:fix-stale-wrapper` |
| 新增文件 | 无（改 1 个文件） |
| 上游文件接触面 | 1 个：`app/api/agent/[id]/route.ts` |
| `.patch` | [`0014-fix-stale-wrapper.patch`](./0014-fix-stale-wrapper.patch)（1.2KB，基线 = 远端版本，精确） |

## 根因

`globalThis.__piSessions` 是为了「活过 Next.js 热更新」才放在 `globalThis` 上的（AGENTS.md 记录过）。代价是：热更新后模块换新了，缓存里的 `AgentSessionWrapper` 实例仍挂在**旧模块**的 prototype 上，它的 `send()` 认不得新加的命令 —— 于是新功能在**已有**会话上直接报 `Unsupported command: queue_remove` 之类，浏览器里弹出 `AgentCommandError` 浮层。用户实际撞到过。

## 修法

只在确认是这一种情况时自愈，其它错误照旧往上抛：

```ts
if (existing?.isAlive()) {
  try {
    const result = await existing.send(body);
    ...
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Unsupported command/i.test(message)) throw error;   // 真实故障不许吞
    console.warn(`[pi-web] discarding a stale session wrapper for ${id} (${message})`);
    existing.destroy();                                       // 丢掉陈旧实例，下面按需重建
  }
}
```

## 设计取舍

- **按错误信息匹配**而不是无条件重建：`Unsupported command` 是「旧模块不认识新命令」的充分标志；其余错误（会话损坏、SDK 抛错）必须原样抛出，否则会把真故障伪装成「重启一下就好了」。
- **destroy 而不是原地补丁**：wrapper 缓存着文件与内存态，重建是最省心且与 fork 补丁同款的做法（AGENTS.md「Fork must destroy the wrapper immediately」）。
- 这条只在 dev 有意义，但代码没有按 `NODE_ENV` 分支 —— 生产里遇到同一条错误信息，重建也是正确行为，且日志会留痕。

## 验收

- 没有单测（要在同一进程里制造「旧模块实例」才能触发；成本高于收益）。验收方式是 dev 实测：热更新后对已有会话执行新命令（如队列撤回）→ 不再弹 `Unsupported command`，server 日志出现 `discarding a stale session wrapper`。
- `tsc --noEmit` 干净；`npm run lint` 0 error。

## 合并上游后怎么重打

```bash
grep -n "fork:fix-stale-wrapper" "app/api/agent/[id]/route.ts"
# 不变式：只在 /Unsupported command/i 时重建，其它错误必须继续抛出。
node_modules/.bin/tsc --noEmit && npm run lint
```
