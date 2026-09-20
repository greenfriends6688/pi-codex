import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { normalizeFileUri, normalizePath, dedupeAndSort } = await jiti.import("./recent-projects.ts");

test("decodes file:// URIs and rejects remote workspaces", () => {
  assert.equal(normalizeFileUri("file:///Users/me/Code/app"), "/Users/me/Code/app");
  assert.equal(normalizeFileUri("file:///E:/Dev/x"), "E:/Dev/x");
  assert.equal(normalizeFileUri("file:///Users/me/My%20Project"), "/Users/me/My Project");
  // 远程工作区（vscode-remote / ssh）不是本地路径，必须返回 null 而不是猜。
  assert.equal(normalizeFileUri("vscode-remote://ssh-remote+host/home/x"), null);
  assert.equal(normalizeFileUri("https://example.com/x"), null);
});

test("normalizes separators, trailing slashes and Windows drive letters", () => {
  assert.equal(normalizePath("  /Users/me/app/  "), "/Users/me/app");
  assert.equal(normalizePath("C:\\Dev\\app\\"), "C:/Dev/app");
  assert.equal(normalizePath("e:/dev"), "E:/dev");
  assert.equal(normalizePath("   "), null);
});

test("dedupes case-insensitively and keeps the newest timestamp", () => {
  const merged = dedupeAndSort([
    { path: "/Users/me/app", source: "vscode", timeMs: 100 },
    { path: "/users/me/APP", source: "claude", timeMs: 300 },
    { path: "/Users/me/other", source: "codex", timeMs: 200 },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].path, "/users/me/APP");
  assert.equal(merged[0].timeMs, 300);
  assert.equal(merged[1].path, "/Users/me/other");
});

test("sorts unknown timestamps last without dropping them", () => {
  const merged = dedupeAndSort([
    { path: "/Users/me/no-time", source: "vscode", timeMs: null },
    { path: "/Users/me/dated", source: "claude", timeMs: 10 },
  ]);
  assert.deepEqual(merged.map((project) => project.path), ["/Users/me/dated", "/Users/me/no-time"]);
});
