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

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
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

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
): Promise<{ additions: number; deletions: number }> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "HEAD",
      "--",
      pathspec,
    ]);
    let additions = 0;
    let deletions = 0;
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted] = line.split("\t", 2);
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isInteger(addedCount)) additions += addedCount;
      if (Number.isInteger(deletedCount)) deletions += deletedCount;
    }
    return { additions, deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

const UNTRACKED_LINE_COUNT_BUDGET_BYTES = 2_000_000;

function countUntrackedTextLines(filePath: string, budget = Number.POSITIVE_INFINITY): { lines: number; bytes: number } {
  try {
    const stat = fs.lstatSync(filePath);
    // Untracked directories (the `--untracked-files=normal` case) are not files.
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES || stat.size > budget) {
      return { lines: 0, bytes: 0 };
    }
    const content = fs.readFileSync(filePath);
    if (hasNullByte(content) || content.length === 0) return { lines: 0, bytes: content.length };
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

  const [entries, trackedLineStats] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readTrackedLineStats(repositoryRoot, cwd),
  ]);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    }];
  });
  // Reading every untracked file to count its lines is what actually cost 3.4s
  // on a scratch-heavy tree. The number is only a summary, so it gets a budget.
  let remainingUntrackedBudget = UNTRACKED_LINE_COUNT_BUDGET_BYTES;
  const untrackedAdditions = files.reduce((total, file) => {
    if (file.status !== "untracked" || remainingUntrackedBudget <= 0) return total;
    const counted = countUntrackedTextLines(file.filePath, remainingUntrackedBudget);
    remainingUntrackedBudget -= counted.bytes;
    return total + counted.lines;
  }, 0);

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: trackedLineStats.additions + untrackedAdditions,
    deletions: trackedLineStats.deletions,
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
