# 0012 · 待办清单实时化 + 面板改版（fork:ui-todo-live）

| 项 | 值 |
| --- | --- |
| 意图 | 用户反馈：待办清单「看着不正规、不是实时」。让清单随每步更新，并把 chip/面板做得像进度而不是一行文字 |
| fork 标记 | `fork:ui-todo-live` |
| 新增文件 | 无（改 3 个代码文件 + 三个 i18n） |
| 上游文件接触面 | 4 个：`lib/todo-extension.ts`、`lib/todo-state.ts`、`components/fork/TodoChip.tsx`、`lib/i18n/messages/{en,zh-CN,zh-TW}.ts` |
| `.patch` | **未生成**（同 0011：改动来自另一条工作线，无编辑记录可反演） |

## 根因判断（关键：一半不是 UI 的锅）

UI 侧本来就是实时的：`extractTodoState(messages)` 读的是消息里的 toolResult `details`，而 `message_end` 会把 `details` 带进 `messages`，`rpc-manager` 不过滤这些事件。「只有最后才勾掉」来自**模型行为** —— 它把多次 `toggle` 攒到收尾一批发。所以两头都要改：工具侧的引导 + UI 侧的表达。

## 改动

| 文件 | 内容 |
| --- | --- |
| `lib/todo-extension.ts` | 强化 `promptGuidelines`：开工前先 `set`；**每完成一步就在下一次工具调用里 `toggle`**，明确禁止收尾批量；只勾真正完成的项。描述里点明「用户实时看着这份清单」 |
| `lib/todo-state.ts` | `toggle` 支持用 `text` 兜底选择条目（`set` 会重编号，id 过期不再让清单冻结在旧状态）；错误文案区分「id 找不到」与「text 找不到」 |
| `components/fork/TodoChip.tsx` | 面板加进度条（`role="progressbar"`）、表头、分隔线、进行中标记（第一个未完成项）；chip 的 `title` 显示当前项；字号/控件高度全部走 `TEXT.*` / `CONTROL.*`（**顺手把 DSN-07 里 TodoChip 的 6 处内联字号清零**） |
| i18n ×3 | 新增 `chat.todosActive`（进行中），改写 `chat.todosHint`（从「复制成一条消息」改成「AI 随进度实时更新」） |

## 验收

- `components/fork/TodoChip.test.mjs`（5 例，jiti + `react-dom/server` 渲染 + 源码断言）：空清单不渲染；chip 显示 `1/2` 且 title 带当前项；完成后不再宣称「进行中」；面板有 `role="progressbar"` 与 `chat.todosActive`；**禁止 `fontSize: <数字>`**（DSN-07 回归护栏）。
- `lib/todo-state.test.mjs`（10 例）：含 toggle-by-text（空白、id 优先、无匹配报错）。
- 浏览器实测（`test-results/verify/B2-midrun-todo-panel.png`、`D-todo-panel.png`；一次性产物不在仓库）：运行中清单已勾选前几项。

## 合并上游后怎么重打

```bash
grep -rn "fork:ui-todo-live" lib/todo-extension.ts lib/todo-state.ts components/fork/TodoChip.tsx
# 三个不变式：
#   1) 清单状态只能来自消息里的 toolResult details，不新增第二份状态源；
#   2) toggle 必须能在 id 过期时用 text 兜底（否则清单会「冻住」）；
#   3) TodoChip 里不允许出现数字字号（有测试盯着）。
npm test
```
