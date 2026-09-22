import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { allowFileRoot } from "@/lib/file-access";
import { isExistingPathWithinRoots, isPathWithinRoots } from "@/lib/path-security";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { MEMORY_DIR_NAME, PI_MEMORY_DAILY_DIR, PI_MEMORY_FILES, PI_MEMORY_WRITABLE } from "@/lib/pi-memory";
// fork:zc-20 — read-only catalog scan for the memory panel's directory view.
import {
  normalizeMemoryRelativePath,
  scanMemoryCatalog,
  type MemoryCatalogIo,
} from "@/lib/memory-catalog";

export const dynamic = "force-dynamic";

// fork:memory-panel — the pi-memory files, read and (deliberately bounded) write.
//
// pi-memory owns the memory feature: it writes `<agentDir>/memory/{MEMORY.md,
// SCRATCHPAD.md,daily/<date>.md}` and injects them itself. This route exists so the
// settings page can show *what is in there* — including the files that do not exist
// yet, which is the state a new install is in and the reason the panel used to look
// empty.
//
//   GET  /api/memory/files                 -> { dir, files, catalog }
//   GET  /api/memory/files?path=MEMORY.md  -> { content }
//   PUT  /api/memory/files { path, content } -> write one whitelisted file
//
// The write path is restricted to the three known names (plus `daily/<date>.md`):
// the agent and the user edit the same markdown, so a hand edit is legitimate, but
// nothing here may create arbitrary files in the agent directory.

const MAX_WRITE_BYTES = 256 * 1024;

export interface MemoryFileInfo {
  /** Path relative to the memory directory. */
  path: string;
  size: number;
  mtime: string;
  exists: boolean;
}

function memoryRoot(): string {
  return join(getAgentDir(), MEMORY_DIR_NAME);
}

function memoryFilePath(relativePath: string): string | null {
  // Containment + whitelist: only the files pi-memory itself uses are addressable.
  const root = memoryRoot();
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  const normalized = relative(root, absolute).split(sep).join("/");
  const allowed = PI_MEMORY_WRITABLE.some((name) => name === normalized)
    || new RegExp(`^${PI_MEMORY_DAILY_DIR}/\\d{4}-\\d{2}-\\d{2}\\.md$`).test(normalized);
  return allowed ? absolute : null;
}

function fileInfo(root: string, relativePath: string): MemoryFileInfo {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) {
    return { path: relativePath, size: 0, mtime: "", exists: false };
  }
  const stats = statSync(absolute);
  return { path: relativePath, size: stats.size, mtime: stats.mtime.toISOString(), exists: true };
}

/** Known files first (so the panel shows a shape), then anything else found on disk. */
function listMemoryFiles(root: string): MemoryFileInfo[] {
  const known = [
    ...PI_MEMORY_FILES,
    `${PI_MEMORY_DAILY_DIR}/${new Date().toISOString().slice(0, 10)}.md`,
  ];
  const seen = new Set(known);
  const out: MemoryFileInfo[] = known.map((relativePath) => fileInfo(root, relativePath));

  const dailyDir = join(root, PI_MEMORY_DAILY_DIR);
  if (existsSync(dailyDir)) {
    for (const entry of readdirSync(dailyDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relativePath = `${PI_MEMORY_DAILY_DIR}/${entry.name}`;
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);
      out.push(fileInfo(root, relativePath));
    }
  }
  // Newest activity first, but keep the not-yet-created rows at the end.
  return out.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    return (b.mtime || "").localeCompare(a.mtime || "") || a.path.localeCompare(b.path);
  });
}

/**
 * fork:zc-20 — node adapter for the pure catalog scanner. `realpathSync` on both
 * the root and each candidate keeps a symlink inside `memory/` from pulling in
 * files outside it; unreadable paths return null and are skipped.
 */
function memoryCatalogIo(root: string): MemoryCatalogIo {
  const realRoot = (() => {
    try {
      return realpathSync(root);
    } catch {
      return null;
    }
  })();

  const resolveWithin = (relativePath: string): string | null => {
    if (!realRoot) return null;
    const absolute = relativePath ? join(root, ...relativePath.split("/")) : root;
    try {
      const real = realpathSync(absolute);
      return isPathWithinRoots(real, new Set([realRoot])) ? absolute : null;
    } catch {
      return null;
    }
  };

  return {
    list(relativeDir) {
      const absolute = resolveWithin(relativeDir);
      if (!absolute) return null;
      try {
        return readdirSync(absolute);
      } catch {
        return null;
      }
    },
    isDirectory(relativeDir) {
      const absolute = resolveWithin(relativeDir);
      if (!absolute) return false;
      try {
        return statSync(absolute).isDirectory();
      } catch {
        return false;
      }
    },
    statFile(relativePath) {
      const absolute = resolveWithin(relativePath);
      if (!absolute) return null;
      try {
        const stats = statSync(absolute);
        if (!stats.isFile()) return null;
        return { size: stats.size, mtimeMs: stats.mtimeMs, mtime: stats.mtime.toISOString() };
      } catch {
        return null;
      }
    },
  };
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const root = memoryRoot();
  const requested = new URL(req.url).searchParams.get("path");

  if (requested) {
    // fork:zc-20 — the old whitelist could only read the three writable names,
    // so recovery/ snapshots appeared in the directory listing but could not be
    // previewed. Reads now accept any `.md` inside the memory root; the write
    // whitelist below is untouched on purpose (storage layout stays pi-memory's).
    const relativePath = normalizeMemoryRelativePath(requested);
    const catalogPath = relativePath ? join(root, ...relativePath.split("/")) : null;
    // fork:zc-20 — 先做「词汇层包含 + 存在性」两步，才能把状态码说对：
    // `isExistingPathWithinRoots` 自身就要求路径存在，把它当唯一闸口会让一个**不存在的**
    // 文件也报 403「在记忆目录之外」（下面那句 404 就成了死代码）。
    // 顺序：不在根内 → 403；在根内但不存在 → 404；存在则再用真实路径验一次符号链接逃逸。
    if (!catalogPath || !isPathWithinRoots(catalogPath, new Set([root]))) {
      return NextResponse.json({ error: "Path is outside the memory directory" }, { status: 403 });
    }
    if (!existsSync(catalogPath)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isExistingPathWithinRoots(catalogPath, new Set([root]))) {
      return NextResponse.json({ error: "Path is outside the memory directory" }, { status: 403 });
    }
    const absolute = catalogPath;
    // fork:fix-memory-ui — 面板要拿 mtime 作为冲突基线：agent 和用户可能同时改这个文件，
    // 保存时带上读时的 mtime，服务器不一致就拒（409），不能盲写覆盖。
    return NextResponse.json({ content: readFileSync(absolute, "utf8"), mtime: statSync(absolute).mtime.toISOString() });
  }

  // Let the main file viewer open these paths (they live outside every session cwd,
  // so without this the viewer would refuse them as unprotected).
  allowFileRoot(root);
  // fork:zc-20 — `files` keeps the old shape (known files, including the ones
  // that do not exist yet, so the panel can still create them); `catalog` is the
  // read-only directory view over root + daily/ + recovery/.
  return NextResponse.json({
    dir: root,
    files: listMemoryFiles(root),
    catalog: scanMemoryCatalog(memoryCatalogIo(root)),
  });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null) as { path?: unknown; content?: unknown; expectedMtime?: unknown } | null;
  const relativePath = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!relativePath) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    return NextResponse.json({ error: "Content is too large" }, { status: 413 });
  }

  const absolute = memoryFilePath(relativePath);
  if (!absolute) return NextResponse.json({ error: "Path is not a memory file" }, { status: 403 });

  // fork:fix-memory-ui — 乐观锁：面板编辑器自动保存时带上读时的 mtime；
  // 文件在读取之后被 agent（或另一个窗口）改过就 409，让 UI 提示冲突而不是静默覆盖。
  // 不带 expectedMtime 的调用（如「新建文件」一键创建）保持原行为，不做检查。
  if (typeof body?.expectedMtime === "string" && body.expectedMtime) {
    if (!existsSync(absolute)) {
      return NextResponse.json({ error: "The file no longer exists on disk", conflict: true }, { status: 409 });
    }
    const currentMtime = statSync(absolute).mtime.toISOString();
    if (currentMtime !== body.expectedMtime) {
      return NextResponse.json(
        { error: "The file changed on disk since it was loaded", conflict: true, mtime: currentMtime },
        { status: 409 },
      );
    }
  }

  const directory = dirname(absolute);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writePrivateFileAtomicSync(absolute, content);
  allowFileRoot(memoryRoot());
  return NextResponse.json({ file: fileInfo(memoryRoot(), relativePath) });
}
