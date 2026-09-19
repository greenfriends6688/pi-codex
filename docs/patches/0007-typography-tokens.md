# 0007 · DSN-07 收尾：内联字号全部收口到 token

| 项 | 值 |
| --- | --- |
| 意图 | 让「改 token 全局生效」真正成立：全仓不再有写死的 px 字号 |
| 依据 | `docs/proma-prs-2026-09-18.md` 的 **DSN-07**（第一批 391 → 44 处；附录 E 复算出 46） |
| 补丁文件 | [`0007-typography-tokens.patch`](./0007-typography-tokens.patch) |
| fork 标记 | `fork:dsn-07` |
| 新增文件 | 1 个（`lib/typography-usage.test.mjs`，全局守卫） |
| 上游文件接触面 | 10 个，都是「加一行 import + 字号换 token」 |

## 实际情况与文档的差异（先复核再动手）

文档/附录 E 记的是「第二批 46 处」，但按附录 E 自己的写法 `fontSize: *[0-9]` 重扫全仓是 **38 处 / 10 个文件**：

- `components/fork/TodoChip.tsx` 的 8 处**已经迁完了**（该文件已 `import { TEXT }`，且自带
  `assert.doesNotMatch(source, /fontSize: [0-9]/)` 守卫）—— 文档的 8 处是过时计数；
- 其余 10 个文件与文档清单一致：`CronConfig` 11、`PiMemoryConfig` 9、`UnsupportedFilePreview` 5、
  `app/error` 4、`app/global-error` 3、`PathActions` 2、`TerminalPanel`/`ProjectChip`/`ComposerTipLine`/`NewSessionHome` 各 1。

因为总量只有 38 处，这个补丁**一次把 DSN-07 做完**（而不是再切一批），并补上全局守卫。

## 方案

1. **归并规则**：与 `lib/typography.ts` 的 `nearestTextStep` 完全一致 —— 就近取档，**并列取较小档**。
   实际发生归并的 6 处：

   | 原值 | 处数 | 归并到 | 说明 |
   | --- | --- | --- | --- |
   | 11.5 | 4（CronConfig ×2、PiMemoryConfig、ComposerTipLine） | `TEXT.xs`(11) | 11 与 12 等距 → 取小 |
   | 12.5 | 2（PiMemoryConfig ×2） | `TEXT.sm`(12) | 12 与 13 等距 → 取小 |
   | 16 | 1（`app/error.tsx` 的 h2） | `TEXT.xl`(15) | \|16−15\|=1 < \|16−18\|=2 |
   | 20 | 1（`NewSessionHome` 标题） | `TEXT["2xl"]`(18) | \|20−18\|=2 < \|20−24\|=4 |

   其余 32 处是精确命中（11/12/13/18）。

2. **`TerminalPanel` 是特例**：那里的 `fontSize` 是 **xterm.js 的配置项**（它自己测量 canvas 算格子），
   必须给数字，给 CSS 变量会直接类型报错。改用 `TEXT_PX.md`（数值 token）—— 仍然是梯度驱动，
   改梯度会跟着变，只是拿不到 CSS 变量那条路。

3. **全局守卫**（`lib/typography-usage.test.mjs`）：
   - 扫 `app/` + `components/` 下所有 `.ts/.tsx`，**任何** `fontSize: <数字>` 都算违规，
     报错信息里带上文件:行，方便直接跳过去；
   - 第二条断言把梯度钉住：8 个档位必须同时在 `TEXT_PX`、`TEXT`、`globals.css` 的 `--text-*` 里存在
     —— 少一个就会出现「`TEXT.xx` 指向不存在的变量」这种更隐蔽的失效。

   为什么加全局守卫而不是继续逐文件断言：逐文件断言只守住写了断言的那几个文件，漏一处就前功尽弃；
   而这次迁移之后全仓是干净的，正好可以用一条全局规则把状态锁住。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `components/fork/CronConfig.tsx` | +1 import；11 处字号 → `TEXT.xs/md/sm` |
| `components/fork/PiMemoryConfig.tsx` | +1 import；9 处 → `TEXT.xs/sm` |
| `components/fork/UnsupportedFilePreview.tsx` | +1 import；5 处 → `TEXT.xs/sm/md` |
| `app/error.tsx` | +1 import；4 处 → `TEXT.sm/md/xl` |
| `app/global-error.tsx` | +1 import；3 处 → `TEXT.sm/md/["2xl"]` |
| `components/fork/PathActions.tsx` | +1 import；2 处 → `TEXT.xs` |
| `components/TerminalPanel.tsx` | 改 import 为 `TEXT_PX`；1 处 → `TEXT_PX.md`（附注说明为什么不能用 CSS 变量） |
| `components/fork/ProjectChip.tsx` / `ComposerTipLine.tsx` / `NewSessionHome.tsx` | 各 +1 import、1 处字号 |
| `lib/typography-usage.test.mjs` | 新增：全仓守卫 + 梯度一致性 |

## 验收

- `node_modules/.bin/tsc --noEmit` 干净（中途 `TerminalPanel` 报过一次 `string` 不能赋给 `number`，
  正是上面第 2 点）。
- `npm run lint`：**0 error / 245 warning**（与改动前同数；中途曾因 `TerminalPanel` 留着未用的 `TEXT`
  import 多 1 条，已修）。
- `npm test`：**1517 个测试，1504 通过**，11 个失败与改动前完全同一批。新增 2 例守卫测试全绿。
- 全仓复扫：`fontSize: <数字>` **0 处**（改前 38 处）。
- 目视验收（`test-results/smoke-typography.mjs`）：定时任务面板、记忆面板、空会话首页三处
  **横向溢出均为 0**（字号收了一档最容易挤爆固定宽度排版）；截图
  `test-results/verify/F-cron.png`、`F-memory.png`、`F-new-session-home.png`；浏览器报错 0 条。

## 已知取舍

- 6 处梯度外字号被归并（11.5→11、12.5→12、16→15、20→18）。这是 DSN-07 明确要求的方向
  （「归并到最近一档，保证视觉只收敛不跑偏」），代价是标题字号略小一档；目视验收确认没挤坏布局。
- `xterm` 的 `fontSize` 只能用数值，所以 `TerminalPanel` 走 `TEXT_PX` 而不是 `TEXT`。
  全局守卫允许 `TEXT_PX.*`（它也是梯度驱动）。
- 动态字号（用户在设置里调的 `--chat-content-font-size`）本来就不是字面量，不受守卫影响。

## 合并上游后怎么重打

```bash
grep -rn "fork:dsn-07" app components | head
# 上游新代码里若出现写死的 fontSize，直接跑 `node --test lib/typography-usage.test.mjs` 就会指出来；
# 换成 TEXT.<档位>（档名带数字时用 TEXT["2xs"] 形式）。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
