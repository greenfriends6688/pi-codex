import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldIgnoreWatchPath } from "./file-watch-filter.ts";

test("噪声目录一律忽略", () => {
  assert.equal(shouldIgnoreWatchPath("node_modules/react/index.js"), true);
  assert.equal(shouldIgnoreWatchPath(".git/HEAD"), true);
  assert.equal(shouldIgnoreWatchPath("app/.next/cache/1"), true);
  assert.equal(shouldIgnoreWatchPath("dist/main.js"), true);
  assert.equal(shouldIgnoreWatchPath("coverage/lcov.info"), true);
  assert.equal(shouldIgnoreWatchPath("__pycache__/x.pyc"), true);
});

test(".DS_Store 与编辑器临时文件忽略", () => {
  assert.equal(shouldIgnoreWatchPath(".DS_Store"), true);
  assert.equal(shouldIgnoreWatchPath("src/App.tsx.swp"), true);
  assert.equal(shouldIgnoreWatchPath("notes.md~"), true);
  assert.equal(shouldIgnoreWatchPath("download.part"), true);
});

test("正常源码与文档路径不忽略", () => {
  assert.equal(shouldIgnoreWatchPath("src/components/App.tsx"), false);
  assert.equal(shouldIgnoreWatchPath("README.md"), false);
  assert.equal(shouldIgnoreWatchPath("app/api/files/route.ts"), false);
});

test("只按整段判断，不做子串匹配", () => {
  assert.equal(shouldIgnoreWatchPath("builds/notes.md"), false);
  assert.equal(shouldIgnoreWatchPath("docs/distribution.md"), false);
  assert.equal(shouldIgnoreWatchPath("src/node_modules_helper.ts"), false);
});

test("空值与空字符串返回 false（宁可多刷一次也不漏改动）", () => {
  assert.equal(shouldIgnoreWatchPath(null), false);
  assert.equal(shouldIgnoreWatchPath(undefined), false);
  assert.equal(shouldIgnoreWatchPath(""), false);
});

test("Windows 反斜杠路径同样按段判断", () => {
  assert.equal(shouldIgnoreWatchPath("node_modules\\react\\index.js"), true);
  assert.equal(shouldIgnoreWatchPath("src\\App.tsx"), false);
});
