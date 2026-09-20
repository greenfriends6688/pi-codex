// fork:pr09 — 逐文件 numstat ± 统计的仓库集成测试。
// 来源：REF lib/git-changes.test.mjs；合并进 MINE 时去掉了 REF 的 ignoredPaths
// 断言（MINE 没有该特性），并补上 2MB untracked 预算与 globalThis 缓存的覆盖。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url);

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function createRepository(t) {
  // macOS 的 tmpdir 是 /var → /private/var 符号链接，而 git 会把仓库根解析成
  // realpath；不归一化的话 getGitStatus 的 cwd 前缀检查会把所有文件都过滤掉。
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-web-git-changes-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, ["init", "-q"]);
  await git(cwd, ["config", "user.email", "test@example.invalid"]);
  await git(cwd, ["config", "user.name", "Test User"]);
  return cwd;
}

async function loadSubject() {
  return jiti.import("./git-changes.ts");
}

test("reports changed files and creates patches for untracked and deleted text files", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "tracked.txt"), "before\n");
  await git(cwd, ["add", "tracked.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);
  await rm(join(cwd, "tracked.txt"));
  await writeFile(join(cwd, "untracked.txt"), "first\nsecond\n");

  const { getGitFileDiff, getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  assert.equal(status.isGitRepository, true);
  assert.deepEqual(status.files.map((file) => [basename(file.filePath), file.status]).sort(), [
    ["tracked.txt", "deleted"],
    ["untracked.txt", "untracked"],
  ]);
  assert.equal(status.additions, 2);

  // Per-file diff stats: the deleted tracked file reports its removed line,
  // and the untracked file reports its full content as additions.
  const deletedStat = status.files.find((file) => file.status === "deleted");
  assert.deepEqual([deletedStat.additions, deletedStat.deletions], [0, 1]);
  const untrackedStat = status.files.find((file) => file.status === "untracked");
  assert.deepEqual([untrackedStat.additions, untrackedStat.deletions], [2, null]);

  const untracked = await getGitFileDiff(cwd, join(cwd, "untracked.txt"));
  assert.equal(untracked.supported, true);
  assert.match(untracked.patch ?? "", /\+first/);

  const deleted = await getGitFileDiff(cwd, join(cwd, "tracked.txt"));
  assert.deepEqual(deleted.status, "deleted");
  assert.equal(deleted.supported, true);
  assert.match(deleted.patch ?? "", /-before/);
});

test("reports per-file addition and deletion counts for tracked and renamed files", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "a.txt"), "one\n");
  await writeFile(join(cwd, "b.txt"), "x\n");
  await git(cwd, ["add", "a.txt", "b.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\n");
  await rm(join(cwd, "b.txt"));
  await git(cwd, ["mv", "a.txt", "renamed.txt"]);
  await writeFile(join(cwd, "binary.bin"), Uint8Array.of(0, 1, 2, 0));
  await git(cwd, ["add", "binary.bin"]);

  const { getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  const byPath = new Map(status.files.map((file) => [basename(file.filePath), file]));

  const renamed = byPath.get("renamed.txt");
  assert.deepEqual([renamed.additions, renamed.deletions], [3, 0]);
  const deleted = byPath.get("b.txt");
  assert.deepEqual([deleted.additions, deleted.deletions], [0, 1]);
  // Binary files have no line counts and must report null so the UI omits the stat.
  const binary = byPath.get("binary.bin");
  assert.equal(binary.additions, null);
  assert.equal(binary.deletions, null);

  // Header totals must equal the sum of the per-file stats.
  const totals = status.files.reduce(
    (counts, file) => {
      counts.additions += file.additions ?? 0;
      counts.deletions += file.deletions ?? 0;
      return counts;
    },
    { additions: 0, deletions: 0 },
  );
  assert.equal(status.additions, totals.additions);
  assert.equal(status.deletions, totals.deletions);
});

test("reports fully staged renames from the grouped numstat format", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
  await git(cwd, ["add", "a.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  // A pure staged rename (no content change) is emitted by numstat -z as an
  // empty-path counts record followed by the original and the new path.
  await git(cwd, ["mv", "a.txt", "renamed.txt"]);

  const { getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  const byPath = new Map(status.files.map((file) => [basename(file.filePath), file]));

  // The renamed row must carry the grouped record's 0/0 counts instead of
  // falling back to null (which would hide the stat in the UI).
  const renamed = byPath.get("renamed.txt");
  assert.deepEqual([renamed.additions, renamed.deletions], [0, 0]);
  assert.equal(byPath.has("a.txt"), false);
  assert.equal(status.additions, 0);
  assert.equal(status.deletions, 0);
});

test("parses NUL-delimited numstat output including rename groups and binary files", async () => {
  const { parseNumstat } = await loadSubject();
  const entries = parseNumstat([
    "3\t2\tsrc/a.ts",
    "-\t-\tbinary.png",
    "0\t0\t",
    "src/old name.ts",
    "src/new name.ts",
    "7\t1\tpath/with\ttab.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries.get("src/a.ts"), { additions: 3, deletions: 2, path: "src/a.ts" });
  // Binary counts come through as "-" and must stay null so the UI omits them.
  assert.deepEqual(entries.get("binary.png"), { additions: null, deletions: null, path: "binary.png" });
  // Rename group: counts are attached to the new path, not the original one.
  assert.deepEqual(entries.get("src/new name.ts"), { additions: 0, deletions: 0, path: "src/new name.ts" });
  assert.equal(entries.has("src/old name.ts"), false);
  // Tabs inside a path survive the three-field split.
  assert.deepEqual(entries.get("path/with\ttab.ts"), { additions: 7, deletions: 1, path: "path/with\ttab.ts" });
});

test("counts untracked additions per file and stops at the shared 2MB budget", async (t) => {
  const cwd = await createRepository(t);
  // 9 × 240,000 bytes = 2.16MB, just past the 2,000,000-byte budget. Each file is
  // under TEXT_PREVIEW_MAX_BYTES (256KB) so only the shared budget can cut it off.
  for (let index = 0; index < 9; index += 1) {
    await writeFile(join(cwd, `budget-${String(index).padStart(2, "0")}.txt`), "a\n".repeat(120_000));
  }

  const { getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  assert.equal(status.files.length, 9);
  // The first 8 files fit in the budget; the 9th must stay uncounted (null)
  // instead of being fully read and blowing the UI payload up again.
  const counted = status.files.filter((file) => file.additions !== null);
  assert.equal(counted.length, 8);
  assert.equal(status.additions, 8 * 120_000);
  assert.equal(status.deletions, 0);
  for (const file of status.files) {
    assert.equal(file.deletions, null, "untracked files have no HEAD side to delete from");
  }
});

test("serves repeat status reads from the globalThis TTL cache", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "a.txt"), "one\n");
  await git(cwd, ["add", "a.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  const { getGitStatus } = await loadSubject();
  const first = await getGitStatus(cwd);
  // Change the worktree between the two calls: the TTL cache must still return
  // the same object, proving Explorer refreshes within 2.5s do not re-spawn git.
  await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
  const second = await getGitStatus(cwd);
  assert.equal(second, first);
  assert.equal(second.additions, 0);
});
