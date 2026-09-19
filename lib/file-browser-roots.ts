/**
 * fork:gap08-roots — 文件树的多根模型。
 *
 * 本仓的文件树一直只接收**一个** `cwd`（`components/FileExplorer.tsx`）。而一个会话的
 * `cwd` 与它所属项目的根**可能不同**：会话跑在 git worktree 里时，`cwd` 是
 * `<repo>-worktrees/<branch>`，`projectRoot` 才是主仓库。此时用户既想看在改的那份
 * （会话），也想看主仓库的其它文件（项目）——这就是「多根 + 作用域徽标」要解决的问题。
 *
 * 按 `docs/proma-prs-2026-09-18.md` GAP-08 的建议，这里只做**并存 + 徽标**，
 * 不推翻本仓已有的「会话/项目分组 + worktree 分组」：根的顺序是「会话在前、项目在后」，
 * 只有真的不同才出现第二个根（相同就退化成一个根，界面上不出现多余的分组头）。
 *
 * 纯函数：不碰文件系统，也不比较字符串形式的路径 —— 一律用 `lib/paths.ts` 的
 * `samePath()`，因为 Windows 上 `C:\a` 与 `c:/a` 是同一个目录，而 git 还会吐出
 * POSIX 风格的路径。
 */

import { samePath } from "./paths";

export type FileBrowserScope = "session" | "project";

export interface FileBrowserRoot {
  /** 绝对路径。 */
  path: string;
  scope: FileBrowserScope;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 组装文件树的根列表。
 *
 * - `cwd` 缺省（还在选目录的新会话）→ 返回空数组，调用方渲染空态；
 * - `projectRoot` 与 `cwd` 相同（非 git 目录、或会话就在项目根）→ **只返回一个根**，
 *   这样绝大多数会话的界面与改动前完全一致；
 * - 两者不同（会话在 worktree 里）→ 两个根，会话在前。
 */
export function buildFileBrowserRoots(input: {
  cwd?: string | null;
  projectRoot?: string | null;
}): FileBrowserRoot[] {
  const cwd = clean(input.cwd);
  if (!cwd) return [];
  const roots: FileBrowserRoot[] = [{ path: cwd, scope: "session" }];
  const projectRoot = clean(input.projectRoot);
  if (projectRoot && !samePath(projectRoot, cwd)) {
    roots.push({ path: projectRoot, scope: "project" });
  }
  return roots;
}

/** 去重后的根路径列表（watch 订阅按根建立，所以这里要稳定的唯一集合）。 */
export function fileBrowserRootPaths(roots: readonly FileBrowserRoot[]): string[] {
  const paths: string[] = [];
  for (const root of roots) {
    if (paths.some((existing) => samePath(existing, root.path))) continue;
    paths.push(root.path);
  }
  return paths;
}

/** 根在树里的展示名：取最后一段（`/a/b/c` → `c`），盘符根保留原样。 */
export function fileBrowserRootName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return normalized;
  const last = parts[parts.length - 1]!;
  // `C:` 这类盘符根：`C:\` 去掉尾分隔符后是 `C:`，直接返回
  return last;
}
