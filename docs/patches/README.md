# 功能补丁台账（fork patches）

本目录记录本 fork 相对上游 `@agegr/pi-web` 的**功能类**改动。

与皮肤台账 [`../codex-skin/delta.md`](../codex-skin/delta.md) 的分工：

| 台账 | 管什么 | 冲突策略 |
| --- | --- | --- |
| `docs/codex-skin/delta.md` | 皮肤 / 布局 / CSS token | 皮肤冲突按台账重打 |
| `docs/patches/*.md`（本目录） | **功能**改动（新增能力、行为变化） | 逻辑冲突一律取上游，再按本文档重接 |

## 约定

1. **一个补丁 = 一个意图**，可独立 revert，自带测试。
2. **优先新增文件**：新能力放进新的 `lib/*.ts`、`app/api/*/route.ts`、`components/*.tsx`，
   上游文件只留「接线」级别的改动。
3. **上游文件的每处改动都带 `fork:<补丁名>` 标记**，例如 `// fork:chat-workspace`。
   合并上游后 `grep -rn "fork:chat-workspace" <file>` 即可拿到完整改动清单。
4. 每个补丁产出一份 `NNNN-<name>.patch`（unified diff）+ 一份说明 `.md`。
   > `.patch` 是在 fork 已经带上其余功能改动的树上生成的，**不保证** `git apply -p1` 直接落到
   > 干净的上游 / `main` 树上：hunk 的上下文行里可能带着其他补丁引入的代码。
   > 合并上游后重打时以 `fork:<补丁名>` 标记为准，`.patch` 只作对照。
5. 合并上游后按本目录的说明逐条重打，然后跑完整 DoD：
   `tsc --noEmit` → `npm run lint` → `npm test`。

## 补丁索引

| 编号 | 名称 | 状态 | 上游文件接触面 |
| --- | --- | --- | --- |
| 0001 | [独立聊天工作区（不在项目中的对话）](./0001-chat-workspace.md) | 已实现（待运行时验收） | 8 个文件，均为接线级改动 |
