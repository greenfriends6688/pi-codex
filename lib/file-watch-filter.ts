/**
 * fork:fix-tree-watch — 目录监听的噪声过滤（纯逻辑，可在 Node 里单测）。
 *
 * `app/api/file-watch/route.ts` 用 `fs.watch` 把目录变更推给文件树。
 * 大仓里一次 `npm install`、一次构建、一次编辑器保存都会产生成百上千条事件，
 * 不过滤的话 SSE 会被打满、客户端也会变成重取风暴。
 *
 * 过滤规则只有两条，都按「整段相等 / 后缀相等」判断，不做子串匹配——
 * 否则 `docs/distribution.md` 会因为含 "dist" 被误伤。
 */

/** 命中即丢弃的目录名或文件名（按路径段整段比较）。 */
export const IGNORED_WATCH_SEGMENTS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".DS_Store",
]);

/** 编辑器与下载器产生的临时文件后缀。 */
export const IGNORED_WATCH_SUFFIXES: readonly string[] = [
  ".swp",
  ".swx",
  ".tmp",
  "~",
  ".crdownload",
  ".part",
];

/**
 * 是否应该忽略这个变更路径。
 * `null` / `undefined` / 空字符串（部分平台不提供 filename）都返回 false，
 * 也就是「无法判断就上报」，宁可多刷一次也不要漏掉真实改动。
 */
export function shouldIgnoreWatchPath(changedPath: string | null | undefined): boolean {
  if (!changedPath) return false;
  const segments = changedPath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => IGNORED_WATCH_SEGMENTS.has(segment))) return true;
  return IGNORED_WATCH_SUFFIXES.some((suffix) => changedPath.endsWith(suffix));
}
