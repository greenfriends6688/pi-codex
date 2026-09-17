import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  addMemory,
  clearMemory,
  consolidateMemory,
  deleteMemory,
  invalidateMemoryCache,
  listMemory,
  memoryQueryTokens,
  memoryStats,
  readMemoryFile,
  recallMemory,
  renderMemoryBlock,
  renderMemoryMarkdown,
  writeMemoryMarkdownMirror,
  updateMemory,
} = await jiti.import("@/lib/memory-store");

/** Each test gets its own file so the module-level cache cannot leak between them. */
function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-memory-"));
  const file = join(dir, "pi-web-memory.json");
  try {
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("entries persist, and the same fact saved twice is stored once", () => withStore((file) => {
  addMemory({ text: "This repo uses pnpm", scope: "global" }, file);
  addMemory({ text: "This repo uses pnpm", scope: "global" }, file);
  addMemory({ text: "This repo uses pnpm", scope: "/repo/a" }, file);
  invalidateMemoryCache();

  const entries = readMemoryFile(file).entries;
  assert.equal(entries.length, 2, "same text in a different scope is a different memory");
  assert.equal(entries[0].source, "user");
  assert.ok(entries[0].createdAt);
}));

test("list scopes: a project sees its own plus global, global sees everything", () => withStore((file) => {
  addMemory({ text: "global note" }, file);
  addMemory({ text: "project note", scope: "/repo/a" }, file);
  addMemory({ text: "other project", scope: "/repo/b" }, file);

  assert.deepEqual(listMemory(undefined, file).map((e) => e.text), ["other project", "project note", "global note"]);
  assert.deepEqual(listMemory("/repo/a", file).map((e) => e.text), ["project note", "global note"]);
}));

test("an empty or blank save is refused rather than stored", () => withStore((file) => {
  assert.equal(addMemory({ text: "   " }, file), null);
  assert.equal(readMemoryFile(file).entries.length, 0);
}));

test("text is capped so one entry cannot swallow the injected context", () => withStore((file) => {
  const entry = addMemory({ text: "x".repeat(2000) }, file);
  assert.equal(entry.text.length, 500);
}));

test("update and delete touch exactly one entry", () => withStore((file) => {
  const first = addMemory({ text: "one" }, file);
  const second = addMemory({ text: "two" }, file);

  assert.equal(updateMemory(first.id, "one (edited)", file).text, "one (edited)");
  assert.equal(readMemoryFile(file).entries.find((e) => e.id === second.id).text, "two");
  assert.equal(updateMemory("missing", "nope", file), null);

  assert.equal(deleteMemory(second.id, file), true);
  assert.equal(deleteMemory(second.id, file), false);
  assert.deepEqual(readMemoryFile(file).entries.map((e) => e.text), ["one (edited)"]);
}));

test("recall requires every query token and ranks short exact entries first", () => {
  const entries = [
    { id: "1", text: "This repo uses pnpm, not npm", scope: "global", source: "user", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "2", text: "pnpm", scope: "global", source: "user", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "3", text: "Tests live next to the source", scope: "global", source: "user", createdAt: "2026-01-03T00:00:00.000Z" },
  ];

  const hits = recallMemory(entries, "pnpm");
  assert.deepEqual(hits.map((entry) => entry.id), ["2", "1"], "the entry that is mostly the query wins");

  // All query tokens must appear, which is what excludes the unrelated entry.
  // Substring matching means "npm" also matches inside "pnpm" — accepted on
  // purpose (a memory list is small and a near-miss costs one extra line of
  // context; an index would cost much more than it saves).
  const both = recallMemory(entries, "pnpm npm").map((entry) => entry.id);
  assert.deepEqual(both, ["2", "1"]);
  assert.ok(!both.includes("3"), "an entry lacking a query token is excluded");
  assert.deepEqual(recallMemory(entries, "kwarg").map((entry) => entry.id), []);
  assert.equal(recallMemory(entries, "").length, 3, "no query means the standing list");
  assert.deepEqual(recallMemory(entries, "tests").map((entry) => entry.id), ["3"]);
});

test("CJK queries still match (tokens are letter runs, not whitespace splits)", () => {
  assert.deepEqual(memoryQueryTokens("用 中文 记忆"), ["用", "中文", "记忆"]);
  const entries = [{ id: "1", text: "这个仓库用 pnpm 不用 npm", scope: "global", source: "user", createdAt: "2026-01-01T00:00:00.000Z" }];
  assert.equal(recallMemory(entries, "仓库").length, 1);
});

test("the injected block separates project from global, and stays empty when there is nothing", () => {
  assert.equal(renderMemoryBlock([]), "");

  const globalOnly = renderMemoryBlock([{ id: "1", text: "g", scope: "global", source: "user", createdAt: "" }]);
  assert.equal(globalOnly, "## Memory\n- g");

  const both = renderMemoryBlock([
    { id: "1", text: "p", scope: "/repo/a", source: "user", createdAt: "" },
    { id: "2", text: "g", scope: "global", source: "user", createdAt: "" },
  ], "/repo/a");
  assert.match(both, /## Project memory\n- p\n\n## Global memory\n- g/);

  // A block for another project must not leak its project-scoped entries.
  const other = renderMemoryBlock([{ id: "1", text: "p", scope: "/repo/a", source: "user", createdAt: "" }], "/repo/b");
  assert.equal(other, "", "no applicable entries means no injected text at all");
});

test("stats count scopes, sources and characters", () => withStore((file) => {
  addMemory({ text: "abc", scope: "global" }, file);
  addMemory({ text: "de", scope: "/repo/a", source: "agent" }, file);
  addMemory({ text: "f", scope: "/repo/b" }, file);

  const stats = memoryStats(readMemoryFile(file).entries);
  assert.deepEqual(
    { total: stats.total, global: stats.global, projectCount: stats.projectCount, characters: stats.characters, fromAgent: stats.fromAgent, fromUser: stats.fromUser },
    { total: 3, global: 1, projectCount: 2, characters: 6, fromAgent: 1, fromUser: 2 },
  );
  assert.ok(stats.newest >= stats.oldest);
}));

test("consolidation folds same-meaning duplicates and prefers the user's wording", () => withStore((file) => {
  addMemory({ text: "  Repo uses pnpm  ", scope: "global", source: "agent" }, file);
  // Different casing/spacing, same fact, and written by the user.
  const duplicate = addMemory({ text: "repo uses pnpm", scope: "global", source: "user" }, file);
  addMemory({ text: "tests live beside source", scope: "global" }, file);

  const removed = consolidateMemory(file);
  const entries = readMemoryFile(file).entries;
  assert.equal(removed, 1);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.text.toLowerCase().includes("pnpm")).source, "user", "the human wording survives");
  assert.equal(duplicate.text, "repo uses pnpm");
}));

test("clear removes everything, or one scope at a time", () => withStore((file) => {
  addMemory({ text: "g", scope: "global" }, file);
  addMemory({ text: "a", scope: "/repo/a" }, file);
  addMemory({ text: "b", scope: "/repo/b" }, file);

  assert.equal(clearMemory("/repo/a", file), 1);
  assert.deepEqual(readMemoryFile(file).entries.map((entry) => entry.text).sort(), ["b", "g"]);
  assert.equal(clearMemory(undefined, file), 2);
  assert.equal(readMemoryFile(file).entries.length, 0);
  assert.equal(clearMemory(undefined, file), 0, "clearing an empty store is a no-op");
}));

test("the markdown export is grouped and the mirror lands next to the JSON", () => withStore((file) => {
  addMemory({ text: "global note", scope: "global" }, file);
  addMemory({ text: "project note", scope: "/repo/a" }, file);
  const markdown = renderMemoryMarkdown(readMemoryFile(file).entries);
  assert.match(markdown, /# Memory/);
  assert.match(markdown, /## Global/);
  assert.match(markdown, /## \/repo\/a/);
  assert.match(markdown, /- project note/);

  const path = writeMemoryMarkdownMirror(file);
  assert.ok(path.endsWith("pi-web-memory.md"), path);
  assert.match(readFileSync(path, "utf8"), /global note/);
}));
