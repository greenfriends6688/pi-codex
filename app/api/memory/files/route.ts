import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { allowFileRoot } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { MEMORY_DIR_NAME, PI_MEMORY_DAILY_DIR, PI_MEMORY_FILES, PI_MEMORY_WRITABLE } from "@/lib/pi-memory";

export const dynamic = "force-dynamic";

// fork:memory-panel — the pi-memory files, read and (deliberately bounded) write.
//
// pi-memory owns the memory feature: it writes `<agentDir>/memory/{MEMORY.md,
// SCRATCHPAD.md,daily/<date>.md}` and injects them itself. This route exists so the
// settings page can show *what is in there* — including the files that do not exist
// yet, which is the state a new install is in and the reason the panel used to look
// empty.
//
//   GET  /api/memory/files                 -> { dir, files: MemoryFileInfo[] }
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

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const root = memoryRoot();
  const requested = new URL(req.url).searchParams.get("path");

  if (requested) {
    const absolute = memoryFilePath(requested);
    if (!absolute) return NextResponse.json({ error: "Path is outside the memory directory" }, { status: 403 });
    if (!existsSync(absolute)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ content: readFileSync(absolute, "utf8") });
  }

  // Let the main file viewer open these paths (they live outside every session cwd,
  // so without this the viewer would refuse them as unprotected).
  allowFileRoot(root);
  return NextResponse.json({ dir: root, files: listMemoryFiles(root) });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null) as { path?: unknown; content?: unknown } | null;
  const relativePath = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!relativePath) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    return NextResponse.json({ error: "Content is too large" }, { status: 413 });
  }

  const absolute = memoryFilePath(relativePath);
  if (!absolute) return NextResponse.json({ error: "Path is not a memory file" }, { status: 403 });

  const directory = dirname(absolute);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writePrivateFileAtomicSync(absolute, content);
  allowFileRoot(memoryRoot());
  return NextResponse.json({ file: fileInfo(memoryRoot(), relativePath) });
}
