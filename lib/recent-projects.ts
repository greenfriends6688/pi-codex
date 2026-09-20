import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

/**
 * fork:recent-projects — 从本机其它编辑器 / Agent 的本地数据里读「最近打开的工作区」。
 *
 * 用于「新建任务」时的推荐列表：pi 自己的工作区由 session 列表给出，这里补的是
 * 那些**还没被 pi 打开过**的目录，省掉每次手动选文件夹。
 *
 * 四条原则（照抄参考项目，写死在这里）：
 *   1. 只读 —— 绝不写别人的数据；
 *   2. 诚实展示 —— 不与 pi 自己的工作区去重、不加「已添加」标记；
 *   3. 读不到的源**静默跳过** —— 每个源都是 best-effort；
 *   4. 远程工作区（非 file:// URI）返回 null，不猜本地路径。
 *
 * SQLite 源（VS Code 的 state.vscdb / Zed / OpenCode）用 lazy `import("node:sqlite")`：
 * Node 22.19 实测可用但会打 ExperimentalWarning，低版本或裁剪过的运行时直接拿不到模块 ——
 * 那种情况下**只退化为 JSON 源**，绝不让整个接口报错。
 */

export type RecentProjectSource = "vscode" | "zed" | "claude" | "codex" | "opencode";

export interface RecentProject {
  /** 归一化后的绝对本地路径（正斜杠）。 */
  path: string;
  source: RecentProjectSource;
  /** 最后使用时间（ms）；源里没有时间的（VS Code MRU）为 null，排序时沉底。 */
  timeMs: number | null;
}

type SqliteModule = typeof import("node:sqlite") | undefined;
let sqliteModulePromise: Promise<SqliteModule> | null = null;

function loadSqlite(): Promise<SqliteModule> {
  sqliteModulePromise ??= (async () => {
    try {
      return await import("node:sqlite");
    } catch {
      return undefined;
    }
  })();
  return sqliteModulePromise;
}

function pathKey(p: string): string {
  return p.toLowerCase();
}

/** `file://` URI → 本地路径；非 file URI（远程工作区）返回 null。 */
export function normalizeFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    const decoded = decodeURIComponent(uri);
    // 只剥掉 scheme：`file:///Users/me/app` → `/Users/me/app`。
    const withoutScheme = decoded.slice("file://".length);
    // 但 `file:///E:/Dev/x` 会留下 POSIX 风格的前导斜杠，Windows 盘符路径要去掉它。
    const local = /^\/[a-zA-Z]:\//.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
    return normalizePath(local);
  } catch {
    return null;
  }
}

/**
 * 正斜杠 + 去尾斜杠；空串返回 null。Windows 盘符统一大写
 * （`e:/Dev` → `E:/Dev`），这样探测结果能和 pi 自己的会话路径对上。
 */
export function normalizePath(p: string): string | null {
  const cleaned = p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (cleaned.length === 0) return null;
  return cleaned.replace(/^([a-z]):\//, (_match, drive: string) => drive.toUpperCase() + ":/");
}

/** 按路径去重（Windows 大小写不敏感），保留更新的时间，按时间降序。 */
export function dedupeAndSort(projects: RecentProject[]): RecentProject[] {
  const byPath = new Map<string, RecentProject>();
  for (const project of projects) {
    const key = pathKey(project.path);
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, project);
      continue;
    }
    const existingTime = existing.timeMs ?? -Infinity;
    const nextTime = project.timeMs ?? -Infinity;
    if (nextTime > existingTime) byPath.set(key, project);
  }
  return [...byPath.values()].sort((a, b) => (b.timeMs ?? -Infinity) - (a.timeMs ?? -Infinity));
}

// ─── VS Code 家族 ────────────────────────────────────────────────────────────

const VSCODE_PRODUCTS = ["Code", "Cursor", "Windsurf", "Trae", "VSCodium", "Positron"];

/** VS Code 系产品的 user-data 根（Windows 是 %APPDATA%）。 */
export function vscodeUserRoots(appData?: string): string[] {
  const platformRoot = appData ?? (process.platform === "win32"
    ? process.env.APPDATA ?? ""
    : process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : path.join(homedir(), ".config"));
  if (!platformRoot) return [];
  return VSCODE_PRODUCTS.map((name) => path.join(platformRoot, name, "User")).filter((p) => existsSync(p));
}

export async function readVSCodeRecents(userRoots: string[]): Promise<RecentProject[]> {
  const out: RecentProject[] = [];
  for (const userRoot of userRoots) {
    const source: RecentProjectSource = "vscode";
    const sqlite = await loadSqlite();
    if (sqlite) {
      const dbPath = path.join(userRoot, "globalStorage", "state.vscdb");
      if (existsSync(dbPath)) {
        try {
          const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?")
              .get("history.recentlyOpenedPathsList") as { value?: unknown } | undefined;
            if (row && typeof row.value === "string") {
              const parsed = JSON.parse(row.value) as { entries?: Array<{ folderUri?: string; remoteAuthority?: string }> };
              for (const entry of parsed.entries ?? []) {
                if (!entry.folderUri || entry.remoteAuthority) continue;
                const p = normalizeFileUri(entry.folderUri);
                if (p) out.push({ path: p, source, timeMs: null });
              }
            }
          } finally {
            db.close();
          }
        } catch {
          // 被占用 / 结构变了：退到下面的 JSON 源。
        }
      }
    }
    // 旧版 storage.json。
    const jsonPath = path.join(userRoot, "globalStorage", "storage.json");
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as {
          openedPathsList?: { entries?: Array<{ folderUri?: string; remoteAuthority?: string }> };
        };
        for (const entry of parsed.openedPathsList?.entries ?? []) {
          if (!entry.folderUri || entry.remoteAuthority) continue;
          const p = normalizeFileUri(entry.folderUri);
          if (p) out.push({ path: p, source, timeMs: null });
        }
      } catch {
        // 坏了就跳过
      }
    }
    // workspaceStorage/<hash>/workspace.json：没有 MRU 顺序，但有真实 mtime。
    const wsRoot = path.join(userRoot, "workspaceStorage");
    if (existsSync(wsRoot)) {
      for (const hashDir of readdirSync(wsRoot)) {
        const wsFile = path.join(wsRoot, hashDir, "workspace.json");
        if (!existsSync(wsFile)) continue;
        try {
          const parsed = JSON.parse(readFileSync(wsFile, "utf8")) as { folder?: string; workspace?: string };
          const p = normalizeFileUri(parsed.folder ?? parsed.workspace ?? "");
          if (p) out.push({ path: p, source, timeMs: statSync(wsFile).mtimeMs });
        } catch {
          // 跳过
        }
      }
    }
  }
  return out;
}

// ─── Claude Code ─────────────────────────────────────────────────────────────

/** `~/.claude/history.jsonl` —— 天然的 MRU：{project, timestamp(ms)}。 */
export function readClaudeRecents(home?: string): RecentProject[] {
  const historyPath = path.join(home ?? homedir(), ".claude", "history.jsonl");
  if (!existsSync(historyPath)) return [];
  const out: RecentProject[] = [];
  try {
    for (const line of readFileSync(historyPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { project?: string; timestamp?: number };
        const p = normalizePath(entry.project ?? "");
        if (!p) continue;
        out.push({ path: p, source: "claude", timeMs: typeof entry.timestamp === "number" ? entry.timestamp : null });
      } catch {
        // 坏行跳过
      }
    }
  } catch {
    // 读不到就跳过
  }
  return out;
}

// ─── OpenAI Codex ────────────────────────────────────────────────────────────

const CODEX_MAX_FILES = 100;

/** 读 `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl` 首行的 `session_meta.payload.cwd`。 */
export function readCodexRecents(home?: string): RecentProject[] {
  const root = path.join(home ?? homedir(), ".codex", "sessions");
  if (!existsSync(root)) return [];
  const out: RecentProject[] = [];
  try {
    const files: Array<{ file: string; mtime: number }> = [];
    for (const year of readdirSync(root)) {
      const yearDir = path.join(root, year);
      if (!isDirectory(yearDir)) continue;
      for (const month of readdirSync(yearDir)) {
        const monthDir = path.join(yearDir, month);
        if (!isDirectory(monthDir)) continue;
        for (const day of readdirSync(monthDir)) {
          const dayDir = path.join(monthDir, day);
          if (!isDirectory(dayDir)) continue;
          for (const name of readdirSync(dayDir)) {
            if (!name.endsWith(".jsonl")) continue;
            const full = path.join(dayDir, name);
            files.push({ file: full, mtime: safeMtime(full) });
          }
        }
      }
    }
    // 只看最近 100 个文件：目录多了之后全扫会拖慢接口。
    files.sort((a, b) => b.mtime - a.mtime);
    for (const { file } of files.slice(0, CODEX_MAX_FILES)) {
      try {
        const firstLine = readHead(file, 16 * 1024).split("\n")[0] ?? "";
        if (!firstLine.trim()) continue;
        const meta = JSON.parse(firstLine) as { type?: string; payload?: { cwd?: string; timestamp?: string } };
        if (meta.type !== "session_meta") continue;
        const p = normalizePath(meta.payload?.cwd ?? "");
        if (!p) continue;
        const timeMs = meta.payload?.timestamp ? Date.parse(meta.payload.timestamp) : Number.NaN;
        out.push({ path: p, source: "codex", timeMs: Number.isNaN(timeMs) ? null : timeMs });
      } catch {
        // 坏文件跳过
      }
    }
  } catch {
    // 读不到就跳过
  }
  return out;
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function safeMtime(target: string): number {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

/** 只读文件头若干字节（Codex 的 rollout 文件可能很大）。 */
function readHead(file: string, maxBytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
  } catch {
    return "";
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const read = readSync(fd, buffer, 0, maxBytes, 0);
    return read > 0 ? buffer.subarray(0, read).toString("utf8") : "";
  } catch {
    return "";
  } finally {
    try {
      closeSync(fd);
    } catch {
      // 忽略
    }
  }
}

// ─── Zed ─────────────────────────────────────────────────────────────────────

export function zedDbPath(): string | null {
  const root = process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support")
    : path.join(homedir(), ".local", "share");
  const candidate = path.join(root, "Zed", "db", "0-stable", "db.sqlite");
  return existsSync(candidate) ? candidate : null;
}

export async function readZedRecents(dbPath: string): Promise<RecentProject[]> {
  if (!dbPath) return [];
  const sqlite = await loadSqlite();
  if (!sqlite) return [];
  const out: RecentProject[] = [];
  try {
    // `?immutable=1`：Zed 在跑的时候库是带 WAL 的，只读打开不加这个会失败。
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare(
        "SELECT paths, timestamp FROM workspaces ORDER BY timestamp DESC LIMIT 100",
      ).all() as Array<{ paths?: unknown; timestamp?: unknown }>;
      for (const row of rows) {
        if (typeof row.paths !== "string") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.paths);
        } catch {
          continue;
        }
        const first = Array.isArray(parsed) ? parsed.find((item) => typeof item === "string") : null;
        if (typeof first !== "string") continue;
        const p = normalizePath(first);
        if (!p) continue;
        const timeMs = typeof row.timestamp === "number" ? row.timestamp : null;
        out.push({ path: p, source: "zed", timeMs });
      }
    } finally {
      db.close();
    }
  } catch {
    // 锁住 / 结构变了：跳过
  }
  return out;
}

// ─── OpenCode ────────────────────────────────────────────────────────────────

export function openCodeDbPath(): string | null {
  const root = process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support", "opencode")
    : path.join(homedir(), ".local", "share", "opencode");
  const candidate = path.join(root, "opencode.db");
  return existsSync(candidate) ? candidate : null;
}

export async function readOpenCodeRecents(dbPath: string): Promise<RecentProject[]> {
  if (!dbPath) return [];
  const sqlite = await loadSqlite();
  if (!sqlite) return [];
  const out: RecentProject[] = [];
  try {
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare(
        "SELECT directory AS directory, MAX(time_updated) AS t FROM session GROUP BY directory",
      ).all() as Array<{ directory?: unknown; t?: unknown }>;
      for (const row of rows) {
        if (typeof row.directory !== "string") continue;
        const p = normalizePath(row.directory);
        if (!p) continue;
        out.push({ path: p, source: "opencode", timeMs: typeof row.t === "number" ? row.t : null });
      }
    } finally {
      db.close();
    }
  } catch {
    // 锁住 / 结构变了：跳过
  }
  return out;
}

// ─── 汇总 ────────────────────────────────────────────────────────────────────

/** 收集所有可用源，合并成一份排好序的列表。 */
export async function collectRecentProjects(): Promise<RecentProject[]> {
  const sources = await Promise.all([
    readVSCodeRecents(vscodeUserRoots()),
    readZedRecents(zedDbPath() ?? ""),
    Promise.resolve(readClaudeRecents()),
    Promise.resolve(readCodexRecents()),
    readOpenCodeRecents(openCodeDbPath() ?? ""),
  ]);
  const merged: RecentProject[] = [];
  for (const list of sources) {
    for (const project of list) {
      // 只留真实存在的目录：workspaceStorage 里可能存的是 .code-workspace 文件。
      if (!isDirectory(project.path)) continue;
      merged.push(project);
    }
  }
  return dedupeAndSort(merged);
}
