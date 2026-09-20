import assert from "node:assert/strict";
import test from "node:test";
import { toCwdRelativeMentions, normalizePathSlashes } from "./file-mentions.ts";

test("converts absolute paths under cwd to relative mentions", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/repo/src/app.ts", "/repo/package.json"],
    "/repo",
  );
  assert.deepEqual(mentions, ["src/app.ts", "package.json"]);
  assert.deepEqual(rejected, []);
});

test("normalizes backslashes (Windows paths)", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["C:\\repo\\src\\app.ts", "C:/repo/README.md"],
    "C:\\repo",
  );
  assert.deepEqual(mentions, ["src/app.ts", "README.md"]);
  assert.deepEqual(rejected, []);
});

test("matches Windows drive paths case-insensitively", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["c:/REPO/src/app.ts"],
    "C:\\Repo",
  );
  assert.deepEqual(mentions, ["src/app.ts"]);
  assert.deepEqual(rejected, []);
});

test("rejects paths outside cwd", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/repo/src/app.ts", "/other/file.ts", "/repo-adjacent/x.ts"],
    "/repo",
  );
  assert.deepEqual(mentions, ["src/app.ts"]);
  assert.deepEqual(rejected, ["/other/file.ts", "/repo-adjacent/x.ts"]);
});

test("rejects the cwd itself and paths that collapse to it", () => {
  const { mentions, rejected } = toCwdRelativeMentions(["/repo", "/repo/"], "/repo");
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, ["/repo", "/repo/"]);
});

test("rejects a sibling with a shared string prefix", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/home/user/projects/foo-bar/a.ts"],
    "/home/user/projects/foo",
  );
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, ["/home/user/projects/foo-bar/a.ts"]);
});

test("rejects .. traversal even when the string prefix matches cwd", () => {
  // 前缀是 /repo/，但实际指向 cwd 之外 —— 必须拒绝（防 `..` 逃逸）。
  const posix = toCwdRelativeMentions(
    [
      "/repo/src/../../etc/passwd",
      "/repo/../secret.txt",
      "/repo/a/../b.ts",
    ],
    "/repo",
  );
  assert.deepEqual(posix.mentions, []);
  assert.deepEqual(posix.rejected, [
    "/repo/src/../../etc/passwd",
    "/repo/../secret.txt",
    "/repo/a/../b.ts",
  ]);

  const windows = toCwdRelativeMentions(
    ["C:\\repo\\src\\..\\..\\Windows\\system.ini", "c:/REPO/../secret"],
    "C:\\Repo",
  );
  assert.deepEqual(windows.mentions, []);
  assert.deepEqual(windows.rejected, [
    "C:\\repo\\src\\..\\..\\Windows\\system.ini",
    "c:/REPO/../secret",
  ]);
});

test("normalizes empty and dot segments inside cwd", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/repo//src/./app.ts", "/repo/./"],
    "/repo",
  );
  assert.deepEqual(mentions, ["src/app.ts"]);
  assert.deepEqual(rejected, ["/repo/./"]);
});

test("treats a filesystem root cwd as accepting every absolute path", () => {
  const { mentions, rejected } = toCwdRelativeMentions(["/tmp/a.ts", "/etc/hosts", "/"], "/");
  assert.deepEqual(mentions, ["tmp/a.ts", "etc/hosts"]);
  assert.deepEqual(rejected, ["/"]);
});

test("handles empty inputs", () => {
  const { mentions, rejected } = toCwdRelativeMentions([], "/repo");
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, []);
  const empty = toCwdRelativeMentions(["/repo/a.ts"], "");
  assert.deepEqual(empty.mentions, []);
  assert.deepEqual(empty.rejected, ["/repo/a.ts"]);
});

test("normalizePathSlashes strips trailing separators", () => {
  assert.equal(normalizePathSlashes("C:\\repo\\src\\"), "C:/repo/src");
  assert.equal(normalizePathSlashes("/repo///"), "/repo");
});
