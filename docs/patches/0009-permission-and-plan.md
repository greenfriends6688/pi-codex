# 0009 · 工具审批 + 权限档位 + 计划模式（PROMA-01/02/03）

| 项 | 值 |
| --- | --- |
| 意图 | 让工具执行前可按策略弹审批卡；每个会话可选「全自动 / 需审批 / 计划」三档；计划档只允许只读动作 |
| 参照实现 | Proma 的权限升级链与审批卡；pi 官方 `examples/extensions/permission-gate.ts`（审批）与 `examples/extensions/plan-mode/`（计划模式） |
| fork 标记 | `fork:proma-01-approval`、`fork:proma-02-mode`、`fork:proma-03-plan`、`fork:fix-stale-wrapper` |
| 新增文件 | 5 个：`lib/approval-policy.ts`、`lib/approval-extension.ts`、`lib/permission-mode.ts`、`lib/plan-mode.ts`、`lib/plan-mode-extension.ts`（外加 3 份单测） |
| 上游文件接触面 | 6 个：`lib/rpc-manager.ts`、`hooks/useAgentSession.ts`、`components/ChatInput.tsx`、`components/ChatWindow.tsx`、三个 i18n 文件 |
| `.patch` | [`0009-permission-and-plan.patch`](./0009-permission-and-plan.patch)（58.2KB，16 个文件；基线由会话记录反演，见文末） |

## 一个关键的实现判断：规格里那条"新管路"不用加

规格（`proma-pr-plan-2026-09-18.md` PROMA-01）写的是「复用 `extension_ui_request` 事件类型，**新增 `method: "approval"`**」。读完 pi 官方示例后确认**不必**：

```ts
// examples/extensions/permission-gate.ts
pi.on("tool_call", async (event, ctx) => {
  if (!ctx.hasUI) return { block: true, reason: "..." };
  const choice = await ctx.ui.select("⚠️ Dangerous command…", ["Yes", "No"]);
  if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
  return undefined;
});
```

`ctx.ui.select()` 在本仓映射到**既有的** `extension_ui_request` → ChatWindow 对话框 → `extension_ui_response` 通道，而 rpc-manager 的 `AgentSessionWrapper.onEvent` 会**重发未决请求**（`pendingUiRequests`）—— 也就是说规格要求的「队列」与「刷新后待决请求可恢复」在这个仓库里已经免费存在。少写一条管路，也就少一处将来与上游冲突的地方。

## 语义层（规格说"从零写的只有这一块"）

| 文件 | 内容 |
| --- | --- |
| `lib/approval-policy.ts` | 12 条危险规则（`rm -rf` / `sudo` / `chmod 777` / `git push --force` / `git reset --hard` / `curl \| sh` / `powershell -enc` / `publish` / `dd`·`mkfs` / 系统包管理器 / `kill -9` / 环境变量外传）、12 条只读白名单、参数摘要**脱敏+截断**（密钥键替换、160 字上限）、会话授权匹配（命令类要完全一致、路径类覆盖子路径）、`decideApproval` 主判定 |
| `lib/permission-mode.ts` | 三档定义、会话级 custom entry 读写（`pi-web:permission-mode`）、档位折叠、循环切换 |
| `lib/plan-mode.ts` | 计划档判定：**复用** approval-policy 的分类器（只放行 `read-only` 档），不新建第二份白名单 |

## 我替用户拍板的决定（都钉在测试里）

1. **默认 bypass 全放行**：`decideApproval` 在 bypass 下对 `rm -rf /` 也放行 —— 规格硬约束「默认策略必须保持全放行，只有用户显式打开或命中危险模式才拦」。测试专门钉了这条。
2. **只读白名单是显式的**，不做「看起来不危险就放行」：`npm test`、`git commit`、`node scripts/build.mjs` 都算「未知」（ask 档会问）。
3. **只持久化「本次会话总是允许」**，一次性放行不写会话（避免会话文件堆噪音）；授权写进 `pi-web:tool-grants` custom entry，随分支回退一起回退。
4. **中止即拒绝**：`select` 抛错/取消一律 `deny`；没有 UI（非交互）时危险调用**拦下**而不是默默放行。
5. **选项用人话标签**（`允许一次 / 本次会话总是允许 / 拒绝`）—— 第一版传的是 `allow-once` 这类 id，`ctx.ui.select` 会把它们原样渲染成按钮，等于给用户看三个英文单词。
6. **模式存会话 custom entry，不放 localStorage**：换浏览器/换机器打开同一会话，档位跟着走（浏览器冒烟验证过）。Chat-only 会话不显示这个控件（与 ADR-0002 的预设交叉）。
7. **计划档下审批不再重复问**：写动作已被计划扩展拦死，审批再问一次就是同一动作弹两次卡（`approvalModeForPlanAwareMode`）。
8. **计划档不搬官方示例的 TUI 部分**：`/plan` 命令、Ctrl+Alt+P、footer 状态、进度 widget、`[DONE:n]` 标记 —— 本仓要么已有等价物（档位按钮 = 开关；todo 工具 + 待办 chip = 进度），要么不适用；再引入一套进度表达只会让模型有两套互相竞争的方式。

## 顺带修掉的一个真问题

`fork:fix-stale-wrapper`（`app/api/agent/[id]/route.ts`）：dev 热更新后 `globalThis.__piSessions` 里的 wrapper 实例仍挂在**旧模块**的 prototype 上，它的 `send()` 认不得新加的命令，于是新功能在旧会话上报 `Unsupported command: xxx`，看起来像功能坏了（用户实际撞到过，浏览器里弹出 `AgentCommandError` 浮层）。

修法：只在错误信息匹配 `/Unsupported command/i` 时**丢掉陈旧实例、用当前代码重建再发一次**；其它错误照旧抛出，避免吞掉真实故障。

## 验收

- `tsc --noEmit` 干净；`npm run lint` **0 error / 245 warning（与改动前同数）**。
- 单测：**32 例全绿** —— approval-policy 11、approval-extension 7、permission-mode 6、plan-mode 8。
- **浏览器实测（PROMA-02）**：控件行出现档位按钮 → 点击切到 ask / plan（服务端 `set_permission_mode` 落 custom entry）→ **刷新页面后档位从会话文件恢复** → 能切回 bypass；报错 0 条。
- **端到端实测（PROMA-03，`test-results/smoke-plan-mode.mjs`）**：
  | 检查 | 结果 |
  | --- | --- |
  | 计划档下文件没有被创建 | ✅ |
  | 计划档下模型回复的是**带文件名的计划**（先调研后执行） | ✅ |
  | 对照：全新会话（默认全自动）同类提示**真的写出了文件** | ✅ |
  | 能切回全自动 | ✅ |
- 「真的发起写调用时会不会被拦」由 `lib/plan-mode.test.mjs` 覆盖（`write`/`edit`/未分类命令一律 `allowed:false`，扩展返回 `{ block: true, reason }`）。端到端**没能**覆盖这条：试过「立刻用 write 工具…不要给计划」这种强制提示，用的模型（muse-spark）会把它答成一句编号计划而不发起工具调用 —— 那是模型行为，不是闸门失效，所以改为单测覆盖并在脚本里注明。

## 已知取舍

- 审批卡复用通用对话框（select 三选项），不是专门的"卡片"组件：本仓的 `extensionDialog` 已经能渲染选项列表与取消，专门做一个卡片组件要新开一条 `method: "custom"` 管路，收益只是排版。
- 危险规则是**正则清单**，不追求完备；方向是「宁可多问」：白名单没命中的一律算未知（ask 档会问）。
- 计划档的"只读"约束也是白名单式的：`bash` 里只放行能证明只读的命令，其余（含 `npm test`）都拦 —— 官方示例也是这个取舍。

## `.patch` 是怎么补上的（诚实交代）

0009 当时忘了先跑改前快照（`test-results/snapshot-stage.mjs` 必须在**动手之前**跑）。补的办法不是手写反演锚点：

1. **从会话记录反演**：pi 的会话文件里存着每次 `edit` 的 `oldText`/`newText` 成对内容，按时间**倒序**把 `newText` 换回 `oldText` 就得到「本阶段开始前」的文件。每步要求唯一匹配，对不上就跳过（记录里混有实际未生效的 op）。
2. **跳过的地方用检查兜**：基线必须能解析、“基线里不能再有 `fork:proma-0X` 标记”、以及一条重复行 artifact 扫描。实测只留下 2 处人工修正（`lib/rpc-manager.ts` 一段重复 `case`、`hooks/useAgentSession.ts` 一行重复）。
3. **一致性证明**：把 0009/0010 挂进 `test-results/make-patches.mjs` 后重跑，**0002–0008 的 `.patch` 与已入库版本逐字节相同**，且 28 个文件的组合校验（最早基线 → 逐阶段打补丁 → 当前文件）全部通过。

工具（都在 gitignored 的 `test-results/`）：`build-baseline-0009-0010.mjs`（反演）、`check-baselines.mjs`（改动内容核对）、`scan-baseline-artifacts.mjs`（重复行扫描）。

教训：**新补丁一律先 `node test-results/snapshot-stage.mjs <编号> <文件...>` 再动手改。**

## 合并上游后怎么重打

```bash
grep -rn "fork:proma-0[123]" lib/rpc-manager.ts hooks/useAgentSession.ts components/ChatInput.tsx components/ChatWindow.tsx
# 三个不变式：
#   1) 默认档 bypass 必须与"没有审批"完全等价（测试盯着这条）；
#   2) 计划档的判定只能有一个来源（lib/plan-mode.ts → approval-policy 的分类器），别再写第二份白名单；
#   3) 模式存会话 custom entry，不要放 localStorage。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
