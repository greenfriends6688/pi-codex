/**
 * fork:git-graph — `%D` ref 装饰到展示标签的转换（纯函数，可在 Node 里单测）。
 *
 * `%D` 输出逗号分隔的装饰，例如：
 *   "HEAD -> main"    HEAD 指向本地分支
 *   "origin/feature"  远端跟踪分支
 *   "tag: v1.2"       annotated 或 lightweight tag
 *   "HEAD"            detached HEAD
 */

export type GitRefTagKind = "head" | "branch" | "remote" | "tag";

export interface GitRefTag {
  kind: GitRefTagKind;
  /** 圆角 chip 里显示的文字。 */
  label: string;
  /** 原始装饰，保留给 tooltip。 */
  ref: string;
}

const HEAD_PREFIX = "HEAD -> ";
const TAG_PREFIX = "tag:";

export function parseGitRefTags(refs: string[]): GitRefTag[] {
  const tags: GitRefTag[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(HEAD_PREFIX)) {
      const branch = trimmed.slice(HEAD_PREFIX.length).trim();
      tags.push({ kind: "head", label: "HEAD", ref: "HEAD" });
      if (branch) tags.push({ kind: "branch", label: branch, ref: trimmed });
    } else if (trimmed === "HEAD") {
      tags.push({ kind: "head", label: "HEAD", ref: trimmed });
    } else if (trimmed.startsWith(TAG_PREFIX)) {
      const name = trimmed.slice(TAG_PREFIX.length).trim();
      // 没有名字的 "tag:" 装饰没有可显示内容。
      if (name) tags.push({ kind: "tag", label: name, ref: trimmed });
    } else if (trimmed.includes("/")) {
      tags.push({ kind: "remote", label: trimmed, ref: trimmed });
    } else {
      tags.push({ kind: "branch", label: trimmed, ref: trimmed });
    }
  }
  return tags;
}
