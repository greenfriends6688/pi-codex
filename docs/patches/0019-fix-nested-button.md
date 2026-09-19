# 0019 · 过程步骤里的文件 chip 不再是嵌套 `<button>`（fork:fix-nested-button）

| 项 | 值 |
| --- | --- |
| 意图 | 修掉用户实测的 hydration 报错：`In HTML, <button> cannot be a descendant of <button>` / `<button> cannot contain a nested <button>` |
| fork 标记 | `fork:fix-nested-button` |
| 上游文件接触面 | 1 个：`components/ProcessGroup.tsx`（`FileChips` 的渲染分支） |
| 新增文件 | 1 个：`components/ProcessGroup.nested-button.test.mjs` |
| `.patch` | [`0019-fix-nested-button.patch`](./0019-fix-nested-button.patch)（基线是动手前的真快照） |

## 症状与根因

「过程显示」切到**步骤（时间线）**后，控制台刷两条 React 报错，整个过程步骤区域在开发者工具里是红的（hydration 之后 DOM 与 SSR 不一致的风险）。

根因在 `components/ProcessGroup.tsx` 的 `FileChips()`：它在给了 `onOpenFile` 时渲染真 `<button class="process-file-chip">`，而它的**两个调用点都在按钮内部**：

- `process-step-row`（步骤行，`<button>` 包着图标/标签/chip）
- `process-chip`（紧凑行，同样是 `<button>`）

于是出现 `<button>` 套 `<button>` —— HTML 内容模型不允许（button 里不能有交互内容），React 会直接报错。

## 修法

chip 改成 `span[role="button"]` + `tabIndex={0}`，并补上 Enter / 空格的键盘处理；`event.stopPropagation()` 保持原样（否则点 chip 会连带折叠步骤行）。外观类名不变（`.process-file-chip` 的样式照旧生效），所以视觉零变化。

## 验收

- `components/ProcessGroup.nested-button.test.mjs`（3 例，源码守卫）：chip 必须是 `span[role=button]` 且不能是 `<button>`；键盘处理与阻止冒泡必须在；这个文件里**只允许两个 `<button>`**（两层外层行），以后谁再冒出来第三个就红。
- `tsc --noEmit` 干净；`eslint` 0 error；全量测试与之前一致（失败项只剩环境性的那几条）。
- 浏览器实测脚本 `test-results/smoke-nested-button.mjs`（一次性）：检查 DOM 里 `button button` 为 0、且控制台不再出现这两条嵌套报错。

## 为什么值得单独立一个补丁

这条不是「样式微调」而是**非法 DOM**：hydration 报错会掩盖真正的错误，而且 `FileChips` 既可能在按钮内渲染（现在两处）也可能将来被搬到按钮外（那时用真 button 才合适）—— 留一份说明，合并上游时不会被人「顺手改回 `<button>`」。
