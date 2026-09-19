# 0017 · dev 服务看门狗（fork:dev-watchdog）

| 项 | 值 |
| --- | --- |
| 意图 | `npm run dev` 会被 OOM 杀掉后没人管；计划任务原来是「一次性 + 前台阻塞」，只跑过一次就再也不动 |
| 新增文件 | 2 个：`scripts/dev-watchdog.mjs`、`scripts/dev-watchdog.cmd` |
| 上游文件接触面 | 无（纯新增，dev 工具，不影响产品行为） |
| `.patch` | [`0017-dev-watchdog.patch`](./0017-dev-watchdog.patch)（3.0KB，2 个新增文件） |

## 三件被踩出来的事（都写进代码注释了）

1. **计划任务的写法**：原来 `schtasks /run` 报 SUCCESS、`Last Result: 1`，因为任务是 *One Time Only* 且执行的是前台阻塞的 `npm run dev`（dev 当时已在跑 → EADDRINUSE → 退出 1 → 从此不再运行）。现在任务改成「每 5 分钟一次」，执行的看门狗**幂等**：端口有人听就立刻退出。
2. **detached + 立即退出 = 子进程被杀**：在计划任务之外的 shell（本仓 agent 的 shell 处在 job 对象里）里，`spawn(detached).unref()` 出来的 dev 会随调用方退出被一起干掉，dev 根本起不来。所以看门狗改成**拉起 dev 并守着它**：dev 死掉（OOM）看门狗才退出 → 下一次巡检（≤5 分钟）再拉一次，形成自愈。
3. **不要用 shell 的 `>` 重定向**：Windows 上 Node 的参数引号规则会把 `cmd /c "npm … > 日志"` 整体当成一个参数 → 命令静默不执行（日志一直不更新，误导排查）。改成 `openSync(log)` + `stdio: ["ignore", fd, fd]`。

## 用法

```bash
node scripts/dev-watchdog.mjs            # 计划任务入口（幂等）
node scripts/dev-watchdog.mjs --status   # 只看状态，不动手（没在跑则退出码 1）
$env:PIWEB_PORT = 30199; node scripts/dev-watchdog.mjs   # 换端口探测（调试用）
```

计划任务：`schtasks /query /tn piweb-dev`（每 5 分钟；执行 `scripts\dev-watchdog.cmd`，它负责找 node 再调 `.mjs`，省掉 schtasks 的嵌套引号问题）。

## 验收（真杀真拉）

| 检查 | 结果 |
| --- | --- |
| dev 在跑时调用看门狗 | 立即退出 0，日志 `30141 在跑，跳过` |
| `taskkill /T` 杀掉整棵 dev 进程树 → 跑计划任务 | **5 秒后 30141 恢复监听**（新 PID），`/api/sessions` 返回 200 / 39 个会话 |
| 任务历史 | `Last Result: 0`，`Next Run Time` 正常滚动 |
| 日志重定向 | 被拉起/失败的 dev 输出都会写进 `%TEMP%\pi-dev.log`（用 `PIWEB_PORT` 指向空端口可复现失败路径） |

## 已知边界

- 被杀的 dev 会在 30141 上留 **TIME_WAIT**，此时立刻重启会 `EADDRINUSE`：看门狗会打印日志尾并在提示里说明「等下一次巡检」，5 分钟后自然接上。
- 看门狗只在「没人监听」时动手，不做僵尸进程清理（端口有人听但进程卡死的极端情况没有处理）。
