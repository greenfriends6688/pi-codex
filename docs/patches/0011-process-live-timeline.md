# 0011 · 过程显示实时时间线（fork:process-live-2）

| 项 | 值 |
| --- | --- |
| 意图 | 用户截图反馈：过程显示切到「步骤（时间线）」后，AI 处理过程中时间线只闪一下，随即变回平铺列表；希望全程都是时间线 |
| fork 标记 | `fork:process-live-2` |
| 新增文件 | 无（改 1 个文件） |
| 上游文件接触面 | 1 个：`components/ChatWindow.tsx`（3 处标记） |
| `.patch` | **未生成**（见文末「为什么没有 .patch」） |

## 根因

`isLiveTail` 分支（`sessionBusy || isStreaming` 且是最后一组）在分组模式下仍逐条 `renderMessage` 平铺渲染，只有「正在流式的那一条消息」走 `ProcessGroup`。本轮第一个工具调用经 `message_end` 落进 `messages` 后，时间线立刻消失，直到整轮结束才由 finalized 分组路径重新出现 —— 视觉上就是「闪一下就没」。

## 修法

- live tail 在分组模式下把「本轮已落库消息」+「流式消息的过程块」合并成**同一个** `ProcessGroup`：新增 `streamingProcess` memo（把流式消息拆成答案块 / 过程块，只转换一次）与 `liveTurnTimeline` 标记（渲染时置位）。
- 底部那个流式块在 `liveTurnTimeline` 已置位时**只输出答案部分**，避免出现两个分组。
- 保留原语义：运行中分组默认展开（`defaultExpanded={!streamingProcess || streamingProcess.answerBlocks.length === 0}`，答案开始冒就折叠）；轮次结束后仍走 `defaultExpanded={!finalAnswerMessage}`；`legacy` 模式仍平铺。

## 设计取舍

- 不在 `legacy` 模式里也做时间线 —— 用户选的就是「平铺」，两种模式各自自洽。
- 合并的是**块**而不是「两条渲染路径」：`ProcessGroup` 只实例化一次，`ProcessContentBlock` 的转换在 memo 里做一次，避免流式期间每帧重算。
- 折叠规则沿用 finalized 路径（答案一出现就折叠），否则运行中与结束后会出现两种视觉状态。

## 验收

- `components/ChatWindow.live-process.test.mjs`（3 例，源码断言）：live tail 在 `legacy` 下才平铺；分组路径必须把 `streamingProcess.blocks` 并进 `liveBlocks` 并置 `liveTurnTimeline`；底部流式块在 `liveTurnTimeline` 时只返回 `answerView`。
- 浏览器实测截图（`test-results/verify/B-midrun-timeline.png`、`A-finished-turn-timeline.png`，一次性产物不在仓库）：处理中时间线持续存在、结束后按规则折叠。

## 合并上游后怎么重打

```bash
grep -n "fork:process-live-2" components/ChatWindow.tsx
# 两个不变式：
#   1) live tail 在 legacy 下必须仍然平铺（别顺手统一成时间线）；
#   2) 同一时刻只能存在一个 ProcessGroup —— 底部流式块在 liveTurnTimeline 时必须只渲染答案。
node_modules/.bin/tsc --noEmit && npm test
```

## 为什么没有 `.patch`

这组改动由另一条工作线（WorkBuddy）完成，pi 的会话记录里没有它的编辑操作，**反演不出改前内容**。按本目录的约定「逻辑冲突一律取上游，再按本文档重接；`.patch` 只作对照，重打以 `fork:` 标记为准」，缺 `.patch` 不影响重打；宁可不给，也不给一个改前侧是猜的补丁。
