import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// `file-browser-roots.ts` 内部 import `./paths`（省略扩展名），原生 node ESM 解析不了，
// 所以与其它带依赖的 lib 测试一样走 jiti。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildFileBrowserRoots, fileBrowserRootPaths, fileBrowserRootName } = await jiti.import("./file-browser-roots.ts");

test("没有 cwd 时不产生任何根（新会话还没选目录）", () => {
  assert.deepEqual(buildFileBrowserRoots({}), []);
  assert.deepEqual(buildFileBrowserRoots({ cwd: "   " }), []);
  assert.deepEqual(buildFileBrowserRoots({ cwd: null, projectRoot: "/repo" }), []);
});

test("项目根与会话 cwd 相同时只保留一个根（绝大多数会话的界面不变）", () => {
  const roots = buildFileBrowserRoots({ cwd: "/repo/app", projectRoot: "/repo/app" });
  assert.deepEqual(roots, [{ path: "/repo/app", scope: "session" }]);
});

test("会话跑在 worktree 里时出现两个根，会话在前", () => {
  const roots = buildFileBrowserRoots({
    cwd: "/repo-worktrees/feature-a",
    projectRoot: "/repo",
  });
  assert.deepEqual(roots, [
    { path: "/repo-worktrees/feature-a", scope: "session" },
    { path: "/repo", scope: "project" },
  ]);
});

test("路径等价判断走 samePath：Windows 大小写/分隔符不同不算两个根", () => {
  // `samePath` 对带盘符的路径做大小写折叠与斜杠归一，所以这里必须只出一个根。
  assert.deepEqual(
    buildFileBrowserRoots({ cwd: "C:\\Users\\me\\repo", projectRoot: "c:/users/me/repo" }),
    [{ path: "C:\\Users\\me\\repo", scope: "session" }],
  );
});

test("根路径去重保持顺序", () => {
  const paths = fileBrowserRootPaths([
    { path: "/repo-worktrees/a", scope: "session" },
    { path: "/repo", scope: "project" },
    { path: "/repo", scope: "project" },
  ]);
  assert.deepEqual(paths, ["/repo-worktrees/a", "/repo"]);
});

test("根名取最后一段，盘符根保留原样", () => {
  assert.equal(fileBrowserRootName("/repo"), "repo");
  assert.equal(fileBrowserRootName("/repo/worktrees/feature-a/"), "feature-a");
  assert.equal(fileBrowserRootName("C:\\Users\\me\\repo"), "repo");
  assert.equal(fileBrowserRootName("C:\\"), "C:");
});
