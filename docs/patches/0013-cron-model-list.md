# 0013 · 定时任务的模型下拉只剩「默认」（fork:fix-cron-model-list）

| 项 | 值 |
| --- | --- |
| 意图 | 用户反馈：定时任务里的模型下拉只有「默认」两个字，选不了模型 |
| fork 标记 | `fork:fix-cron-model-list` |
| 新增文件 | 无（改 1 个文件 + 三个 i18n） |
| 上游文件接触面 | 4 个：`components/fork/CronConfig.tsx`、`lib/i18n/messages/{en,zh-CN,zh-TW}.ts` |
| `.patch` | **未生成**（同 0011：改动来自另一条工作线，无编辑记录可反演） |

## 根因

`GET /api/models` 返回的形状是 `{ models: provider:id → name }` + `modelList: ModelInfo[]`（见 `lib/models-cache.ts` 的 `ModelsData`）—— **可选列表在 `modelList`，`models` 是个 Record**。`CronConfig` 读的是 `data.models` 再 `.map()` → `TypeError` → 被 `.catch(() => setModels([]))` 静默吞掉 → 下拉自然只剩「默认」。`AgentsConfig` 与 `useAgentSession` 读的都是 `modelList`，只有这里写错。

## 修法

- 改读 `modelList`；
- 「默认」项显示**实际默认模型**（`cron.modelDefault` = `默认 · {model}`），否则用户不知道默认到底是什么；
- 加载失败时给出提示（`cron.modelListError`），别再让 catch 把错误吞成「空列表」这种假正常。

## 验收

- `components/fork/CronConfig.test.mjs`（3 例，源码断言）：必须读 `modelList`；**禁止 `data?.models`**（防止改回去）；「默认」项要带默认模型名；失败要有 `cron.modelListError` 提示。已验证：把 `modelList` 改回 `models` 时该用例立刻失败。
- 浏览器实测截图（`test-results/verify/E-cron-section.png`、`F-cron-model-options.png`；一次性产物不在仓库）：下拉列出了全部可选模型，默认项带模型名。

## 合并上游后怎么重打

```bash
grep -rn "fork:fix-cron-model-list" components/fork/CronConfig.tsx
# 两条不变式：
#   1) 读 modelList，绝不读 models（有测试盯着）；
#   2) 失败必须显式提示，不允许静默空列表。
npm test
```
