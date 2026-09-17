import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isApiRequestAllowed } from "@/lib/request-security";
import { MEMORY_DIR_NAME } from "@/lib/pi-memory";

export const dynamic = "force-dynamic";

// fork:memory-panel — read-only view of pi-memory's markdown files.
//
// pi-memory (npm package, installed through the plugins API) owns the memory
// feature: it writes `<agentDir>/memory/{MEMORY.md,daily/*.md,scratchpad.md}` and
// registers its own tools. This route only lists and reads those files for the
// settings page, so nothing here can write — the agent, not the panel, owns memory.
//
// GET /api/memory/files                -> { dir, files: [{ path, size, mtime }] }
// GET /api/memory/files?path=daily/x.md -> { content }
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const root = join(getAgentDir(), MEMORY_DIR_NAME);
  const requested = new URL(req.url).searchParams.get("path");

  if (requested) {
    const absolute = resolve(root, requested);
    // Containment check: only files inside the memory directory are readable, and
    // `..`/absolute inputs are refused rather than normalised into something else.
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      return NextResponse.json({ error: "Path is outside the memory directory" }, { status: 403 });
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ content: readFileSync(absolute, "utf8") });
  }

  return NextResponse.json({ dir: root, files: listMemoryFiles(root) });
}

export interface MemoryFileInfo {
  /** Path relative to the memory directory. */
  path: string;
  size: number;
  mtime: string;
}

/** Two levels deep is all pi-memory writes (root files + `daily/`). */
function listMemoryFiles(root: string, depth = 0): MemoryFileInfo[] {
  if (!existsSync(root) || depth > 2) return [];
  const out: MemoryFileInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMemoryFiles(absolute, depth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = statSync(absolute);
    out.push({
      path: relative(root, absolute).split(sep).join("/"),
      size: stats.size,
      mtime: stats.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}
