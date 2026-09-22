/**
 * fork:zc-20 — read-only catalog for `~/.pi/agent/memory/`.
 *
 * pi-memory (the `npm:pi-memory` package) owns this directory: it writes
 * `MEMORY.md`, `SCRATCHPAD.md`, `daily/<date>.md` and its own `recovery/`
 * snapshots, and the pi TUI and the Web UI must see the same files. This module
 * therefore only ever *lists* what is there. It does not define a new layout,
 * does not add project scoping, and does not extract or rewrite anything —
 * those belong to the extension; forking them here would give the TUI and the
 * browser two different memories.
 *
 * Filesystem access is injected (`MemoryCatalogIo`) so this module stays
 * dependency-free and safe to import from a client component: the settings
 * panel uses `filterMemoryEntries` / `isWritableMemoryPath`, while the server
 * route supplies the node adapter. Subdirectories are limited to the names
 * pi-memory uses (`MEMORY_CATALOG_SUBDIRS`) so a stray directory cannot turn
 * the panel into a general file browser.
 */

export const MEMORY_CATALOG_SUBDIRS = ["daily", "recovery"] as const;
export const MEMORY_CATALOG_MAX_FILES = 1000;

export interface MemoryCatalogEntry {
  /** Path relative to the memory root, POSIX separators. */
  path: string;
  name: string;
  /** "" for root files, otherwise "daily" / "recovery". */
  folder: string;
  size: number;
  mtimeMs: number;
  /** ISO timestamp for display. */
  mtime: string;
}

export interface MemoryCatalogScan {
  entries: MemoryCatalogEntry[];
  count: number;
  /** Subdirectories that were actually scanned (existing ones only). */
  dirs: string[];
}

/**
 * The server-side filesystem seam. `list`/`isDirectory` take a relative POSIX
 * directory ("" is the root) and `statFile` returns null for anything that is
 * missing, not a regular file, or a symlink escaping the memory root.
 */
export interface MemoryCatalogIo {
  list(relativeDir: string): readonly string[] | null;
  isDirectory(relativeDir: string): boolean;
  statFile(relativePath: string): { size: number; mtimeMs: number; mtime: string } | null;
}

export function classifyMemoryEntry(relativePath: string): { folder: string; name: string } {
  const normalized = relativePath.split("\\").join("/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return { folder: "", name: normalized };
  return { folder: normalized.slice(0, slash), name: normalized.slice(slash + 1) };
}

/**
 * The paths the memory panel may write. This mirrors the PUT whitelist in
 * `app/api/memory/files/route.ts` exactly — catalog entries outside it
 * (recovery/ snapshots, older hand-written notes) are read-only in the UI.
 */
export function isWritableMemoryPath(relativePath: string): boolean {
  return relativePath === "MEMORY.md"
    || relativePath === "SCRATCHPAD.md"
    || /^daily\/\d{4}-\d{2}-\d{2}\.md$/.test(relativePath);
}

/**
 * Validate a user supplied relative path and return its normalized POSIX form.
 * Rejects absolute paths (POSIX and Windows), `..`/`.` segments, empty
 * segments, non-`.md` names and NUL bytes. Callers still have to resolve the
 * result against the real root — this is the lexical half of the check.
 */
export function normalizeMemoryRelativePath(relativePath: unknown): string | null {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.length > 512) return null;
  if (relativePath.includes("\u0000")) return null;
  const normalized = relativePath.split("\\").join("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.startsWith("//")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  if (!normalized.toLowerCase().endsWith(".md")) return null;
  return segments.join("/");
}

/** Case-insensitive filename/path filter. An empty query returns all entries. */
export function filterMemoryEntries(
  entries: readonly MemoryCatalogEntry[],
  query: string,
): MemoryCatalogEntry[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [...entries];
  return entries.filter((entry) =>
    entry.name.toLowerCase().includes(keyword)
    || entry.path.toLowerCase().includes(keyword));
}

/** Newest first; ties break on the relative path so the order is stable. */
export function sortMemoryEntries(entries: readonly MemoryCatalogEntry[]): MemoryCatalogEntry[] {
  return [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

function collect(io: MemoryCatalogIo, folder: string, entries: MemoryCatalogEntry[]): void {
  const names = io.list(folder);
  if (!names) return;
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const path = folder ? `${folder}/${name}` : name;
    const stats = io.statFile(path);
    if (!stats) continue;
    entries.push({ path, name, folder, size: stats.size, mtimeMs: stats.mtimeMs, mtime: stats.mtime });
    if (entries.length >= MEMORY_CATALOG_MAX_FILES) return;
  }
}

/**
 * List root-level `.md` files plus the known pi-memory subdirectories. Missing
 * root or subdirectories are simply empty, never an error.
 */
export function scanMemoryCatalog(io: MemoryCatalogIo): MemoryCatalogScan {
  const entries: MemoryCatalogEntry[] = [];
  const dirs: string[] = [];

  if (!io.isDirectory("")) return { entries: [], count: 0, dirs: [] };
  collect(io, "", entries);

  for (const subdir of MEMORY_CATALOG_SUBDIRS) {
    if (!io.isDirectory(subdir)) continue;
    dirs.push(subdir);
    collect(io, subdir, entries);
  }

  const sorted = sortMemoryEntries(entries).slice(0, MEMORY_CATALOG_MAX_FILES);
  return { entries: sorted, count: sorted.length, dirs };
}
