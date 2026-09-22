import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";
const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

// fork:git-graph — 导出给 lib/git-graph.ts 复用：整个仓库只保留这一套
// execFile 封装（超时 / maxBuffer / LC_ALL 的配置只有一处）。
export async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

export async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  // fork:ui-perf — `--untracked-files=all` listed every file inside untracked
  // directories. On a working copy with scratch/build dirs that meant 18k
  // entries and a 3.6MB JSON body; `normal` collapses them into one row per
  // directory (what every git UI does) and returns 57 rows for the same tree.
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
  ]);
  return parseGitPorcelainV1(output);
}

export interface NumstatRecord {
  additions: number | null;
  deletions: number | null;
  path: string;
}

/**
 * fork:pr09 — 解析 `git diff --numstat -z --find-renames HEAD` 的逐文件行数。
 *
 * `-z` 下普通记录是 `<added>\t<deleted>\t<path>`；rename/copy 会被拆成
 * 「一个空路径的计数记录 + 原路径记录 + 新路径记录」三连，统计挂在**新路径**
 * （界面显示的就是新路径）。二进制文件的计数是 `-`，统一返回 null 让 UI 省略。
 */
export function parseNumstat(output: string): Map<string, NumstatRecord> {
  const records = output.split("\0");
  const entries = new Map<string, NumstatRecord>();
  const toCount = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const parts = record.split("\t");
    if (parts.length < 3) continue;
    const filePath = parts.slice(2).join("\t");
    if (filePath === "") {
      // rename/copy 组：紧随其后的两条记录是原路径与新路径。
      const originalPath = records[index + 1];
      const newPath = records[index + 2];
      if (originalPath && newPath) {
        entries.set(newPath, { additions: toCount(parts[0]), deletions: toCount(parts[1]), path: newPath });
        index += 2;
      }
      continue;
    }
    entries.set(filePath, { additions: toCount(parts[0]), deletions: toCount(parts[1]), path: filePath });
  }

  return entries;
}

async function readNumstatByPath(
  repositoryRoot: string,
  cwd: string,
): Promise<Map<string, NumstatRecord>> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "-z",
      "--find-renames",
      "HEAD",
      "--",
      pathspec,
    ]);
    return parseNumstat(output);
  } catch {
    return new Map();
  }
}

const UNTRACKED_LINE_COUNT_BUDGET_BYTES = 2_000_000;

interface UntrackedLineCount {
  lines: number;
  bytes: number;
  /** fork:pr09 — 文件超过本次剩余预算，未统计；调用方保持该文件统计为 null。 */
  budgetExceeded?: boolean;
  /** fork:zc-05 — 读取到的内容含 NUL 字节，按二进制处理。 */
  binary?: boolean;
}

function countUntrackedTextLines(filePath: string, budget = Number.POSITIVE_INFINITY): UntrackedLineCount {
  try {
    const stat = fs.lstatSync(filePath);
    // Untracked directories (the `--untracked-files=normal` case) are not files.
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) {
      return { lines: 0, bytes: 0 };
    }
    // 预算不够就跳过整次读取（而不是读一半），并把预算耗尽的事实告诉调用方。
    if (stat.size > budget) {
      return { lines: 0, bytes: 0, budgetExceeded: true };
    }
    const content = fs.readFileSync(filePath);
    // fork:zc-05 — 二进制文件没有行数概念，UI 显示「binary」而不是 +0 行。
    if (hasNullByte(content)) return { lines: 0, bytes: content.length, binary: true };
    if (content.length === 0) return { lines: 0, bytes: content.length };
    const text = content.toString("utf8");
    const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
    return { lines, bytes: content.length };
  } catch {
    return { lines: 0, bytes: 0 };
  }
}

/**
 * fork:ui-perf — the explorer asks for the same status on every refresh, tree
 * reload and session switch. A short TTL keeps those instant without making the
 * refresh button feel stale. `globalThis` survives hot reload, like the other
 * registries in this repo.
 */
const GIT_STATUS_CACHE_TTL_MS = 2500;
const GIT_STATUS_CACHE_MAX_ENTRIES = 32;

function gitStatusCache(): Map<string, { at: number; data: GitStatusResponse }> {
  const holder = globalThis as typeof globalThis & {
    __piGitStatusCache?: Map<string, { at: number; data: GitStatusResponse }>;
  };
  if (!holder.__piGitStatusCache) holder.__piGitStatusCache = new Map();
  return holder.__piGitStatusCache;
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const cache = gitStatusCache();
  const cached = cache.get(cwd);
  if (cached && Date.now() - cached.at < GIT_STATUS_CACHE_TTL_MS) return cached.data;

  const data = await computeGitStatus(cwd);
  if (cache.size >= GIT_STATUS_CACHE_MAX_ENTRIES) cache.clear();
  cache.set(cwd, { at: Date.now(), data });
  return data;
}

async function computeGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    };
  }

  const [entries, numstatByPath] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readNumstatByPath(repositoryRoot, cwd),
  ]);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    const lineStat = numstatByPath.get(entry.path);
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      // untracked 没有可对比的 HEAD 侧，行数在下面的预算循环里补。
      additions: classified.status === "untracked" ? null : (lineStat?.additions ?? null),
      deletions: lineStat?.deletions ?? null,
    }];
  });
  // Reading every untracked file to count its lines is what actually cost 3.4s
  // on a scratch-heavy tree. The number is only a summary, so it gets a budget.
  // fork:pr09 — 预算内同时把行数写回逐文件统计；预算耗尽后统计保持 null，
  // 界面省略而不是显示误导性的 +0。
  let remainingUntrackedBudget = UNTRACKED_LINE_COUNT_BUDGET_BYTES;
  for (const file of files) {
    if (file.status !== "untracked" || remainingUntrackedBudget <= 0) continue;
    const counted = countUntrackedTextLines(file.filePath, remainingUntrackedBudget);
    remainingUntrackedBudget -= counted.bytes;
    if (counted.budgetExceeded) continue;
    file.additions = counted.lines;
    file.deletions = null;
  }
  // 头部总数由逐文件统计求和得出，保证与列表行里的 ± 永远一致。
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions ?? 0;
    totalDeletions += file.deletions ?? 0;
  }

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: totalAdditions,
    deletions: totalDeletions,
  };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") {
    const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (!patch?.includes("\n@@ ")) return { supported: false };
    return { supported: true, status, patch };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}

// ============================================================================
// fork:zc-05 — Git 变更面板的数据层。
//
// 与 `getGitStatus`（文件树徽标，按 HEAD 汇总）不同，这里按**来源**分开：
//   unstaged = 工作区 vs 索引（untracked 也在这一侧）
//   staged   = 索引 vs HEAD
// 同一文件两侧都有改动时会在两个来源各出现一次（`MM`），diff 也各取各的基准。
//
// 纯函数（isChangeInSource / classifyChangeSide / buildChangeFiles /
// sortChangeFiles / groupChangeFiles）只做字符串与数组处理，直接单测；
// 带 git / fs 的部分放在后面，复用本文件已有的 execFile 封装。
// ============================================================================
