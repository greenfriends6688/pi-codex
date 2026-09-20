/**
 * fork:git-graph — Git 图谱数据层的 `git log` 解析（纯函数，可在 Node 里单测）。
 *
 * 为什么字段分隔符用 `%x1f`：原型用 `|` 拼字段，subject 里一旦出现 `|`
 * （例如 `fix: a | b`）整行就会被拆错；`%x1f`（ASCII Unit Separator）
 * 不会出现在 commit 文本里，所以格式化与解析两端固定用它。
 *
 * 为什么不对 `git log --graph` 的 ASCII 图形做解析：车道布局（列与边）
 * 由 git-graph-lanes.ts 依据父链接推导，字符画既脆弱又拿不到行列语义，
 * 因此这里生成的 log 命令连 `--graph` 都不需要。
 */

export interface GitLogCommit {
  hash: string;
  parents: string[];
  author: string;
  /** Unix 秒级时间戳（%at）。 */
  timestamp: number;
  subject: string;
  /** ref 装饰（%D），例如 ["HEAD -> main", "origin/main"]。 */
  refs: string[];
}

const FIELD_SEPARATOR = "\x1f";

export function formatGitLogCommand(limit: number): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    // --topo-order：保证子提交一定排在父提交之前，车道状态机只需要单遍扫描，
    // 这也是图谱行序符合直觉（分支不会互相穿插）的前提。
    "--topo-order",
    `--format=%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%at${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%D`,
  ];
}

export function parseGitLog(raw: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEPARATOR);
    // 正常应有 6 段。subject 里不会有 \x1f，但 %D 为空时最后一段是空串；
    // 少于 6 段说明混入了告警等脏输出，直接跳过而不是抛错。
    if (fields.length < 6) continue;
    const [hash, parents, author, timestamp, subject, refs] = fields;
    if (!hash) continue;
    commits.push({
      hash,
      parents: parents.split(" ").filter(Boolean),
      author,
      timestamp: Number(timestamp) || 0,
      subject,
      // %D 的多个装饰之间是 ", "，但 ref 名里可能含逗号，这里只做常规切分。
      refs: refs ? refs.split(", ").filter(Boolean) : [],
    });
  }
  return commits;
}
