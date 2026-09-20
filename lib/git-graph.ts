import path from "path";
import type { GitLogCommit } from "./git-graph-parser";
import { formatGitLogCommand, parseGitLog } from "./git-graph-parser";
import { findRepositoryRoot, git } from "./git-changes";

/**
 * fork:git-graph — 图谱 tab 的服务端数据层。
 *
 * 只做两件事：一条有上限的 `git log`（不需要 --graph，车道几何由客户端
 * 状态机从父链接推导），以及详情卡要的「某个提交改了哪些文件」。
 *
 * 复用 lib/git-changes.ts 的 `git()` / `findRepositoryRoot()`，不在仓库里
 * 维护第二套 execFile 封装（超时、maxBuffer、LC_ALL 只有一处配置）。
 */

export interface GitLogResponse {
  isGitRepository: boolean;
  commits: GitLogCommit[];
  truncated: boolean;
}

export interface GitCommitFile {
  /** 文件的绝对路径（rename 取新路径）。 */
  filePath: string;
  /** git name-status 字母：M / A / D / R / C / T / U。 */
  code: string;
  originalPath?: string;
}

export interface GitCommitFilesResponse {
  supported: boolean;
  files: GitCommitFile[];
}

const GIT_GRAPH_MAX_BUFFER = 16 * 1024 * 1024;

export async function getGitLog(cwd: string, limit: number): Promise<GitLogResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { isGitRepository: false, commits: [], truncated: false };
  try {
    // 多取一条用于判断截断，避免再跑一次 count 查询。
    const output = await git(repositoryRoot, formatGitLogCommand(limit + 1), GIT_GRAPH_MAX_BUFFER);
    const commits = parseGitLog(output);
    return {
      isGitRepository: true,
      commits: commits.slice(0, limit),
      truncated: commits.length > limit,
    };
  } catch {
    // 空仓库（unborn HEAD，还没有任何 commit）或 git 执行失败：显示空图，
    // 不要把「初始化后还没提交」当成错误弹给用户。
    return { isGitRepository: true, commits: [], truncated: false };
  }
}

interface NameStatusRecord {
  code: string;
  repoPath: string;
  originalPath?: string;
}

/** 解析 `git diff --name-status` 的 -z（NUL 分隔）输出。 */
function parseNameStatus(output: string): NameStatusRecord[] {
  const fields = output.split("\0");
  const records: NameStatusRecord[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i];
    if (!status) continue;
    const letter = status[0];
    const isRenameLike = letter === "R" || letter === "C";
    const originalPath = isRenameLike ? fields[++i] : undefined;
    const repoPath = fields[++i];
    if (!repoPath) continue;
    records.push({ code: letter, repoPath, originalPath: originalPath || undefined });
  }
  return records;
}

function toAbsoluteFiles(repositoryRoot: string, records: NameStatusRecord[]): GitCommitFile[] {
  return records.map((record) => ({
    filePath: path.resolve(repositoryRoot, record.repoPath),
    code: record.code,
    ...(record.originalPath ? { originalPath: path.resolve(repositoryRoot, record.originalPath) } : {}),
  }));
}

export async function getGitCommitFiles(cwd: string, hash: string): Promise<GitCommitFilesResponse> {
  // hash 只允许十六进制，既能拒绝任意 revision 语法（`HEAD~1`、`--` 注入），
  // 也避免把用户输入透传给 git 当参数。
  if (!/^[0-9a-f]{6,40}$/i.test(hash)) return { supported: false, files: [] };
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false, files: [] };

  try {
    const parentsOutput = await git(repositoryRoot, ["log", "-1", "--format=%P", hash]);
    const parents = parentsOutput.trim().split(" ").filter(Boolean);
    // 一律和第一个 parent 比（root commit 和空树比），与常见图谱工具对
    // merge commit 的展示口径一致。
    const output = parents.length === 0
      ? await git(repositoryRoot, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", hash])
      : await git(repositoryRoot, ["diff", "--name-status", "-z", "--find-renames", parents[0], hash]);
    return { supported: true, files: toAbsoluteFiles(repositoryRoot, parseNameStatus(output)) };
  } catch {
    return { supported: false, files: [] };
  }
}
