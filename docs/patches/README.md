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
| 0002 | [`?session=` 会话恢复竞态](./0002-session-url-restore.md) | 已实现（含新单测 + 浏览器验证） | 1 个文件（3 处） |
| 0003 | [行内引用体系（`&` 会话 / `#` MCP / `~` 待办）](./0003-composer-references.md) | 已实现（含 20+ 单测 + 浏览器冒烟） | 6 个文件，均为接线级改动 |
| 0004 | [Windows 上 `npm run prod` / `dev:clean` 静默失败](./0004-windows-next-mode.md) | 已实现（Windows 实测） | 无（本仓脚本） |
| 0005 | [附件模型：任意文件 + 上传上限 + 超限降级为路径引用](./0005-composer-attachments.md) | 已实现（含 15 单测 + 浏览器冒烟） | 8 个文件，均为接线级改动 |
| 0006 | [队列逐条操控（撤回 / 删除 / 拖拽排序 / 立即发送）](./0006-queue-controls.md) | 已实现（含 11 单测 + 端到端交付顺序验证） | 7 个文件，均为接线级改动 |
| 0007 | [DSN-07 收尾：内联字号全部收口到 token](./0007-typography-tokens.md) | 已实现（DSN-07 完成，带全仓守卫） | 10 个文件，均加一行 import + 字号换 token |
| 0008 | [文件树：多根 + 作用域徽标 + 三个细节](./0008-file-tree-roots.md) | 已实现（GAP-08/10，含 13 单测 + 浏览器冒烟） | 6 个文件，均为接线级改动 |
| 0009 | [工具审批 + 权限档位 + 计划模式（PROMA-01/02/03）](./0009-permission-and-plan.md) | 已实现（含 32 单测 + 浏览器/端到端实测；`.patch` 已补） | 6 个文件，均为接线级改动 |
| 0010 | [会话回退「回退到此处」（PROMA-04）](./0010-session-rewind.md) | 已实现（含 9 单测 + 浏览器/端到端实测） | 5 个文件，均为接线级改动 |

## 工具：没有版本控制时怎么产出 `.patch`

本机的树是从 macOS 拷过来的，**没有 `.git`，也没有 `git` / `diff` / `python`**
（`docs/proma-prs-2026-09-18.md` 附录 E.2 已记录）。而本目录要求每个补丁产出一份 unified diff，
于是仓内自带一个零依赖实现：

```bash
# 生成：改前 / 改后两个文件 → unified diff（可多文件拼接，用 --out 写文件）
node scripts/fork-patch.mjs --old <旧> --new <新> --path <仓库相对路径> --out docs/patches/000N-x.patch

# 自检：LCS diff 的边界用例 + 往返（生成后再应用回去必须逐字节等于新文件）
node scripts/fork-patch.mjs --selftest

# 回滚 / 前滚：把补丁应用到工作树（--check 只看会不会改）
node scripts/fork-patch.mjs --apply docs/patches/0003-composer-references.patch --check
node scripts/fork-patch.mjs --apply docs/patches/0003-composer-references.patch
```

约定：`--- a/<path>` 的路径相对 `--root`（默认当前目录），新增文件的目标不存在时按空文件处理；
上下文不匹配就**报错退出**，不做“猜着改”。

### 基线要分阶段

一个文件可能被多个补丁改过（`components/ChatInput.tsx` 先后被 0003、0005 改）。
补丁 0003 的「改前」必须是**两个补丁都没打**的样子，0005 的「改前」必须是**只打了 0003** 的样子；
而每个 `.patch` 的「改后」也**不是当前文件**，而是下一个阶段的基线 —— 否则 0003 的
`.patch` 会把 0005 的改动一起打包进去。

本仓的做法：`test-results/build-baseline.mjs`（一次性工具）按阶段**倒序**反推，每退一层存一份
`test-results/fork-patch-baseline/<阶段>/<路径>`，`test-results/make-patches.mjs` 再据此生成补丁并跑三项校验：

1. 基线能被 TS 解析（反推出的语法错误 = hunk 的“改前”是假的）；
2. `apply(基线, 该补丁 diff)` 逐字节等于该补丁的「改后」；
3. 从最早基线依次打上各阶段补丁，**等于当前文件**（台账能当回滚/前滚依据的前提）。

这两个脚本放在 gitignored 的 `test-results/` 下（一次性工具）；`--selftest` 则在仓内的
`scripts/fork-patch.mjs` 里，随时可跑。

### 忘了快照怎么办：从会话记录反演

0009/0010 是回头补的（当时没先跑 `snapshot-stage.mjs`）。补法不是手写反演锚点，而是拿 pi 会话文件里
每次 `edit` 的 `oldText`/`newText`，按时间**倒序**把 `newText` 换回 `oldText` —— 每步要求唯一匹配，
对不上就跳过（记录里混有实际未生效的 op），再用「基线里不能有本补丁的 `fork:` 标记」「基线必须能解析」
「连续重复行扫描」三条兜底，最后只留 2 处人工修正。

一致性证明：把新阶段挂进 `make-patches.mjs` 后重跑，**已入库的 `0002–0008` 必须逐字节不变** ——
变了就说明新反演的基线跟原链条不兼容。

工具：`test-results/build-baseline-0009-0010.mjs`、`check-baselines.mjs`、`scan-baseline-artifacts.mjs`。
**新补丁一律先 `node test-results/snapshot-stage.mjs <编号> <文件...>` 再动手改。**
