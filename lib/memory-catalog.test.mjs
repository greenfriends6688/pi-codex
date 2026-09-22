// fork:zc-20 — memory catalog scanning stays read-only: it must list the same
// files the pi-memory extension writes, and nothing else. The filesystem is an
// injected in-memory adapter, so no test touches ~/.pi/.
import assert from "node:assert/strict";
import test from "node:test";

const {
  classifyMemoryEntry,
  filterMemoryEntries,
  isWritableMemoryPath,
  normalizeMemoryRelativePath,
  scanMemoryCatalog,
  sortMemoryEntries,
} = await import("./memory-catalog.ts");

/** Build an in-memory MemoryCatalogIo from `{ "daily/x.md": {...} }`. */
function createMemoryIo(files, { rootExists = true } = {}) {
  const records = Object.entries(files);
  const dirs = new Set([""]);
  for (const [path] of records) {
    const parts = path.split("/");
    if (parts.length > 1) dirs.add(parts[0]);
  }
  return {
    list(relativeDir) {
      if (!rootExists) return null;
      const prefix = relativeDir ? `${relativeDir}/` : "";
      const names = new Set();
      for (const [path] of records) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        names.add(rest);
      }
      return [...names];
    },
    isDirectory(relativeDir) {
      return rootExists && dirs.has(relativeDir);
    },
    statFile(relativePath) {
      const file = files[relativePath];
      // The server adapter drops symlinks that resolve outside the memory root.
      if (!file || file.outsideRoot) return null;
      return {
        size: file.size ?? file.content.length,
        mtimeMs: file.mtimeMs,
        mtime: new Date(file.mtimeMs).toISOString(),
      };
    },
  };
}

function entry(path, name, folder, mtimeMs) {
  return { path, name, folder, size: 1, mtimeMs, mtime: new Date(mtimeMs).toISOString() };
}

test("returns an empty catalog for a missing directory", () => {
  const io = createMemoryIo({}, { rootExists: false });
  assert.deepEqual(scanMemoryCatalog(io), { entries: [], count: 0, dirs: [] });
});

test("lists root files and daily/ + recovery/, ignoring other extensions", () => {
  const io = createMemoryIo({
    "MEMORY.md": { content: "# memory", mtimeMs: 1000 },
    "notes.txt": { content: "no", mtimeMs: 2000 },
    "daily/2026-09-20.md": { content: "day", mtimeMs: 3000 },
    "daily/2026-09-21.md": { content: "day", mtimeMs: 4000 },
    "recovery/2026-09-19.md": { content: "recovered", mtimeMs: 2500 },
    "other/stray.md": { content: "not scanned", mtimeMs: 9000 },
  });

  const scan = scanMemoryCatalog(io);
  assert.deepEqual(scan.dirs, ["daily", "recovery"]);
  assert.deepEqual(
    scan.entries.map((item) => item.path),
    ["daily/2026-09-21.md", "daily/2026-09-20.md", "recovery/2026-09-19.md", "MEMORY.md"],
  );
  assert.equal(scan.count, 4);
});

test("daily-only directory is a valid catalog", () => {
  const io = createMemoryIo({
    "daily/2026-09-21.md": { content: "day", mtimeMs: 5000 },
  });
  const scan = scanMemoryCatalog(io);
  assert.equal(scan.count, 1);
  assert.equal(scan.entries[0].folder, "daily");
  assert.equal(scan.entries[0].name, "2026-09-21.md");
});

test("entries carry size and mtime", () => {
  const io = createMemoryIo({
    "MEMORY.md": { content: "hello", size: 5, mtimeMs: 1234 },
  });
  const scan = scanMemoryCatalog(io);
  assert.equal(scan.entries[0].size, 5);
  assert.equal(scan.entries[0].mtimeMs, 1234);
  assert.equal(scan.entries[0].mtime, new Date(1234).toISOString());
});

test("filtering is case-insensitive on name and path", () => {
  const entries = [
    entry("MEMORY.md", "MEMORY.md", "", 1),
    entry("daily/2026-09-21.md", "2026-09-21.md", "daily", 2),
    entry("recovery/scratch.md", "scratch.md", "recovery", 3),
  ];
  assert.deepEqual(filterMemoryEntries(entries, "memoR").map((item) => item.path), ["MEMORY.md"]);
  assert.deepEqual(filterMemoryEntries(entries, "DAILY").map((item) => item.path), ["daily/2026-09-21.md"]);
  assert.deepEqual(filterMemoryEntries(entries, "scratch").map((item) => item.path), ["recovery/scratch.md"]);
  assert.equal(filterMemoryEntries(entries, "").length, 3);
  assert.equal(filterMemoryEntries(entries, "nothing").length, 0);
});

test("sorts by mtime descending with a stable tie-break", () => {
  const io = createMemoryIo({
    "old.md": { content: "old", mtimeMs: 1_000_000 },
    "new.md": { content: "new", mtimeMs: 3_000_000 },
    "mid.md": { content: "mid", mtimeMs: 2_000_000 },
    "same-a.md": { content: "a", mtimeMs: 4_000_000 },
    "same-b.md": { content: "b", mtimeMs: 4_000_000 },
  });

  const scan = scanMemoryCatalog(io);
  assert.deepEqual(
    scan.entries.map((item) => item.name),
    ["same-a.md", "same-b.md", "new.md", "mid.md", "old.md"],
  );

  assert.deepEqual(
    sortMemoryEntries([
      entry("b.md", "b.md", "", 10),
      entry("a.md", "a.md", "", 10),
    ]).map((item) => item.path),
    ["a.md", "b.md"],
  );
});

test("symlinks pointing outside the root never enter the catalog", () => {
  const io = createMemoryIo({
    "inside.md": { content: "inside", mtimeMs: 2000 },
    "link.md": { content: "secret", mtimeMs: 3000, outsideRoot: true },
  });
  const scan = scanMemoryCatalog(io);
  assert.deepEqual(scan.entries.map((item) => item.path), ["inside.md"]);
});

test("normalizeMemoryRelativePath rejects escapes and non-markdown paths", () => {
  assert.equal(normalizeMemoryRelativePath("MEMORY.md"), "MEMORY.md");
  assert.equal(normalizeMemoryRelativePath("daily/2026-09-21.md"), "daily/2026-09-21.md");
  assert.equal(normalizeMemoryRelativePath("daily\\2026-09-21.md"), "daily/2026-09-21.md");
  assert.equal(normalizeMemoryRelativePath("../secret.md"), null);
  assert.equal(normalizeMemoryRelativePath("daily/../../secret.md"), null);
  assert.equal(normalizeMemoryRelativePath("/etc/passwd.md"), null);
  assert.equal(normalizeMemoryRelativePath("C:\\secret.md"), null);
  assert.equal(normalizeMemoryRelativePath("./MEMORY.md"), null);
  assert.equal(normalizeMemoryRelativePath("notes.txt"), null);
  assert.equal(normalizeMemoryRelativePath(""), null);
  assert.equal(normalizeMemoryRelativePath("a\u0000.md"), null);
});

test("classifyMemoryEntry splits folder and name", () => {
  assert.deepEqual(classifyMemoryEntry("MEMORY.md"), { folder: "", name: "MEMORY.md" });
  assert.deepEqual(classifyMemoryEntry("daily/2026-09-21.md"), { folder: "daily", name: "2026-09-21.md" });
});

test("isWritableMemoryPath mirrors the route's write whitelist", () => {
  assert.equal(isWritableMemoryPath("MEMORY.md"), true);
  assert.equal(isWritableMemoryPath("SCRATCHPAD.md"), true);
  assert.equal(isWritableMemoryPath("daily/2026-09-21.md"), true);
  assert.equal(isWritableMemoryPath("recovery/2026-09-21.md"), false);
  assert.equal(isWritableMemoryPath("daily/notes.md"), false);
});
