# 0003 · 行内引用体系（`&` 会话 / `#` MCP / `~` 待办）

| 项 | 值 |
| --- | --- |
| 意图 | 把「引用某个会话 / MCP 服务 / 待办项」从复制粘贴变成行内可发现的操作 |
| 参照实现 | B（Proma）的 5 类行内触发符（`docs/proma-prs-2026-09-18.md` 的 **GAP-06**；附录 E 已核实本仓缺口只在触发符与浮层） |
| 补丁文件 | [`0003-composer-references.patch`](./0003-composer-references.patch) |
| fork 标记 | `fork:gap06-references` |
| 新增文件 | 3 个（`lib/composer-references.ts`、`lib/composer-references.test.mjs`、`components/ComposerReferenceMenu.tsx`） |
| 上游文件接触面 | 6 个：`ChatInput.tsx`（9 处接线）、`ChatWindow.tsx`（1 处 prop）、`ChatInput.test.mjs`（桩注入 4 处 + 新用例 2 个）、`lib/i18n/messages/{en,zh-CN,zh-TW}.ts`（各 8 个 key） |

## 为什么要做

本仓此前只有 `@` 文件引用（`lib/file-fuzzy.ts` 的 `extractAtQuery` + `ChatInput.tsx` 里的 `@` 菜单）。
引用一个历史会话只能走「右键复制 → 粘贴到输入框」这条**不可发现**的路径（`AppShell.tsx:601-609`），
MCP 服务与待办项则完全没有引用手段 —— 用户只能手打服务名或整段复述待办。

附录 E.3 的关键结论决定了这个补丁的**大小**：

> `SessionReference` 管道已在 `components/ChatInput.tsx` 全线打通：回调签名（`:55-59`）、状态（`:613`）、
> 增删清（`:951-972`）、草稿持久化（`:743-794`）、chip 回跳（`:102`）、序列化下发（`lib/composer-context.ts:140`）。
> **缺的只是行内 `&` 触发符 + 建议浮层**，不是从零搭一套引用体系。

所以这里**没有**新建引用模型、没有改序列化格式、没有碰消息协议。

## 方案：三类触发符的落地方式刻意不同

下游能力不同，硬凑成一套反而会发明出不存在的概念：

| 触发符 | 数据源 | 确认后 | 为什么这么落 |
| --- | --- | --- | --- |
| `&` | `GET /api/sessions` | 变成 composer chip（`SessionReference`） | 会话引用管道已存在，chip 带 id、可回跳、随草稿持久化、随消息序列化 —— 没有理由再铺一条 |
| `#` | `GET /api/mcp` | 插入行内文本 `#server ` | MCP 只有「服务名」这一级稳定标识（工具级需要真握手），且本仓没有 MCP chip 类型；行内文本与 `@path` 同构，agent 直接可读 |
| `~` | composer 已有的 `todoSummary` prop | 插入行内文本 `~#3 第三步 ` | 本仓 todo 是会话级的，`#id` 正是 todo 工具的选择器（`lib/todo-state.ts` 的 `toggle` 接受 id 或文字），文本同时给人看 |

`@` 菜单本身**一行没改**（除了产出 token 的那一处，见下）—— 新增的是平行的一套。

### 与 `@` 菜单的共存

两个抽取器（`extractAtQuery` / `extractReferenceQuery`）都锚定光标，因此同一段文本最多只有一个能命中，
不需要优先级仲裁。`ChatInput.tsx` 的 `updateAtQuery` 现在一次光标解析产出两个 token：

```ts
const fileToken = cwd ? extractAtQuery(before) : null;
setAtQuery(fileToken);
setReferenceQuery(fileToken ? null : extractReferenceQuery(before));
```

没有 cwd 时 `@` 菜单整体不可用，但会话/待办引用不需要 cwd，所以引用 token 不跟着这个门控。

### 一个刻意的取巧：token 自校验而不是改 11 处上游重置点

程序化改文本的路径（发送后清空、插入引用、草稿恢复…）都会 `setValue(...)` 但不走 `updateAtQuery`，
上游在那些位置逐个调用了 `setAtQuery(null)`（共 11 处）。逐个跟着补 `setReferenceQuery(null)` 会让
diff 面积翻倍且以后每新增一个重置点就漏一次。改成让 token 自己校验：

```ts
// 记录的区间里不再是对应的 token 文本，就关掉菜单
const token = `${COMPOSER_REFERENCE_TRIGGERS[referenceQuery.kind]}${referenceQuery.query}`;
if (value.slice(referenceQuery.start, referenceQuery.start + token.length) !== token) setReferenceQuery(null);
```

效果等价，且覆盖未来任何新的重置路径。

## 改动清单

### 新增（无冲突面）

| 文件 | 作用 |
| --- | --- |
| `lib/composer-references.ts` | 纯函数：`extractReferenceQuery`（token 抽取，含 `~/` 排除）、三类的 build/filter、`buildReferenceInsertText`、`replaceReferenceToken`。打分沿用 `file-fuzzy.ts` 同一把梯子（精确 100 / 前缀 80 / 子串 50 / 子序列 10） |
| `lib/composer-references.test.mjs` | 20 例：词中触发符不生效、空白关闭 token、`~/` 排除、会话剔除自身、MCP 去重与禁用保留、待办未完成优先、插入文本与光标偏移 |
| `components/ComposerReferenceMenu.tsx` | 建议浮层（新文件，避免往 `ChatInput` 里塞第四段内联 JSX）；与 `@` 菜单同一视觉外壳 |

### 上游文件的接线改动（每处都有 `fork:gap06-references` 标记）

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `components/ChatInput.tsx` | import | 引入纯函数模块与浮层组件 |
| | `Props` / 解构 | 新增可选 `currentSessionId`（把当前会话从 `&` 候选里剔除） |
| | state | 引用 token、菜单开关、高亮索引、菜单高度、会话/MCP 缓存与拉取去重 |
| | `updateAtQuery` | 同一次光标解析产出两个 token + token 自校验 effect |
| | （新块） | 候选 memo、数据源懒拉取（10s 缓存）、开合与高亮夹取、`scrollIntoView`、`subscribeUpwardMenuMaxHeight` 复用、`applyReferenceCompletion` |
| | `handleKeyDown` | 引用菜单的 ↑/↓/Esc/Tab-Enter 分支（IME 合成期间跳过，与 `@` 菜单一致）+ 依赖数组 |
| | render | 渲染 `<ComposerReferenceMenu>` |
| `components/ChatWindow.tsx` | `<ChatInput>` props | 传 `currentSessionId={session?.id ?? null}` |
| `components/ChatInput.test.mjs` | 两处 `runInNewContext` 桩 | 补引用菜单所需的桩变量（原测试用「抽 `handleKeyDown` 源码 + vm 执行」的方式，变量清单必须同步） |
| | 新增用例 | 「引用菜单优先于 `@` 菜单」与「引用菜单 ↑/↓ 环绕」 |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | `chat.noMatchingFiles` 附近 | 每个语言 8 个 key（三语言必须同时加，否则 parity 测试挂） |

## 验收

- `node_modules/.bin/tsc --noEmit` 干净。
- `npm run lint`：0 error（245 个既有 warning 不变）。
- `npm test`：**1489 pass / 11 fail**，11 个失败与本次改动无关且改前就在失败名单里（`No bash shell found`
  的 bash 环境用例、PTY 终端、worktree、`ContextMenuProvider` 脚手架、`ChatInput` 图片告警用例）。
  本补丁自身新增 21 个用例全绿（`lib/composer-references.test.mjs` 20 + `ChatInput.test.mjs` 1）。
- 浏览器冒烟（`test-results/smoke-references.mjs`，对真实 dev 服务跑）：
  - `~` → 「待办 · 3 个匹配项」，未完成在前，Tab 后输入框变成 `~#2 第二步 `；
  - `&` → 「会话引用 · 20 个匹配项」，**当前会话不在列表里**，Tab 后 token 被吃掉并出现 `会话1` chip；
  - `#` → 「MCP 服务 · N 个匹配项」（本机 0 个服务 → 显示空态）；
  - 反例：`~/` 不弹待办菜单（家目录路径）；`@` 在光标处时引用菜单不出现；
  - `@` 无回归：仍是「文件 · 20 个匹配项」；
  - 浏览器报错 0 条。截图在 `test-results/verify/R1…R5-*.png`。

## 已知取舍

- `#` / `~` 是**行内文本**而不是 chip：两者都没有 chip 类型，也没有回跳目标。将来若给 MCP 加 chip，
  改动点是 `applyReferenceCompletion` 的一个分支 + `lib/composer-context.ts` 的序列化。
- MCP 只能引用到**服务名**一级。工具级引用需要握手拿工具清单（`lib/mcp-validator.ts` 已有能力），
  属于 GAP-19「MCP 内置集成目录 + agent 自管工具」的范围，本补丁不越界。
- 会话候选上限 20 条、数据源 10s 缓存：与 `@` 文件菜单同款策略；候选来自 `/api/sessions` 全量列表，
  未做虚拟滚动（20 条固定上限，菜单本来也不该长）。
- 禁用的 MCP 服务**保留**在候选里并打「已禁用」标：从菜单里彻底消失会让人以为配置丢了。

## 合并上游后怎么重打

```bash
# 1. 看这次上游是否碰到本补丁的文件
grep -rn "fork:gap06-references" components/ChatInput.tsx components/ChatWindow.tsx

# 2. 上游只改 `@` 菜单时，把新增的引用分支接回去即可（它是平行的一套，不依赖 `@` 的实现细节）；
#    若上游重排了 `updateAtQuery`，务必保留「一次解析产出两个 token」这一点，否则两个菜单会互相抢

# 3. 新增文件整份保留；`ChatInput.test.mjs` 的桩变量清单要跟着上游的新变量补齐

# 4. 校验
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
