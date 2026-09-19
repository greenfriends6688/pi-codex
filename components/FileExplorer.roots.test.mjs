import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:gap08-roots / fork:gap10-* — 文件树的多根与三个细节。
 *
 * 为什么用组件渲染测试：本机没有 `.git`（也没有 worktree），所以「会话在 worktree 里 →
 * 多出一个项目根」这条分支没有真实会话可点。`renderToStaticMarkup` 不跑 effect，
 * 因此不需要 mock fetch：额外根的分区头会立刻渲染出来，正好用于断言。
 */

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { FileExplorer } = await jiti.import("./FileExplorer.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = readFileSync(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(FileExplorer, {
      changesCollapsed: false,
      onOpenFile() {},
      ...props,
    })),
  );
}

test("会话 cwd 与项目根相同时不出现第二个根（界面与改动前一致）", () => {
  const html = render({ cwd: "/repo/app", projectRoot: "/repo/app" });
  assert.doesNotMatch(html, /files\.scopeProject/);
  assert.doesNotMatch(html, />Project</);
});

test("会话在 worktree 里时渲染出「项目」根分区，并带上作用域徽标", () => {
  const html = render({ cwd: "/repo-worktrees/feature-a", projectRoot: "/repo" });
  // 徽标（文件句柄里是英文 Project —— node 环境没有 navigator，i18n 回退到 en）
  assert.match(html, /Project|项目|專案/);
  // 分区标题是项目根的最后一段，title 是完整路径
  assert.match(html, /title="\/repo"/);
});

test("多根时 watch 按根订阅，而不是只订阅会话 cwd", () => {
  assert.match(source, /extraRoots\.map\(\(root\) => \{[\s\S]*?new EventSource\(`\/api\/file-watch\?path=\$\{encodeURIComponent\(root\.path\)\}`\)/);
  assert.match(source, /return \(\) => \{ sources\.forEach\(\(source\) => source\.close\(\)\); \};/);
});

test("GAP-10 细节一：展开的目录行在子项滚动时粘住（深度错开、背景不透明）", () => {
  assert.match(source, /fork:gap10-sticky-dir/);
  assert.match(source, /position: "sticky"/);
  assert.match(source, /top: Math\.min\(depth, 3\) \* 24/);
  assert.match(source, /background: "var\(--bg-panel\)"/);
});

test("GAP-10 细节二：搜索命中滚到视口中间（祖先进展开已由既有 effect 负责）", () => {
  assert.match(source, /fork:gap10-search-scroll/);
  assert.match(source, /scrollIntoView\(\{ block: "center" \}\)/);
});

test("GAP-10 细节三：空目录 800ms 后重试一次，且重试不会无限递归", () => {
  assert.match(source, /fork:gap10-tree-retry/);
  assert.match(source, /if \(entries\.length === 0 && !isRetry\)/);
  assert.match(source, /\}, 800\);/);
  // 定时器必须在卸载时收掉
  assert.match(source, /emptyRetryRef\.current\) clearTimeout\(emptyRetryRef\.current\)/);
});

test("空目录文案走 i18n（原来是硬编码的英文 empty）", () => {
  assert.match(source, /t\("files\.emptyDirectory"\)/);
});
