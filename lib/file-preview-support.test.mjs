import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionOf,
  previewSupport,
  shouldShowUnsupportedCard,
  unsupportedReasonKey,
} from "./file-preview-support.ts";

test("extensionOf 取小写扩展名，无扩展名返回空串", () => {
  assert.equal(extensionOf("a/b/README.md"), "md");
  assert.equal(extensionOf("C:\\proj\\App.TSX"), "tsx");
  assert.equal(extensionOf("Makefile"), "");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
  assert.equal(extensionOf("dotfile."), "");
});

test("常见源码/文本/图片/音视频/文档判为可预览", () => {
  for (const path of ["a.ts", "a.py", "a.json", "a.yaml", "a.sh", "a.sql", "a.csv", "a.md", "a.png", "a.mp4", "a.mp3", "a.pdf", "a.docx", "a.html"]) {
    assert.equal(previewSupport(path), "supported", `${path} 应可预览`);
  }
});

test("压缩包/可执行/数据库/字体判为二进制", () => {
  for (const path of ["a.zip", "a.gz", "a.exe", "a.dylib", "a.so", "a.wasm", "a.sqlite", "a.db", "a.woff2", "a.psd"]) {
    assert.equal(previewSupport(path), "binary", `${path} 应判为二进制`);
  }
});

test("未知扩展名判为 unknown（仍给卡片，但原因不同）", () => {
  assert.equal(previewSupport("a.zzz"), "unknown");
  assert.equal(previewSupport("a.qwertyuiop"), "unknown");
});

test("无扩展名按文本处理（Dockerfile/Makefile 等）", () => {
  assert.equal(previewSupport("Dockerfile"), "supported");
  assert.equal(previewSupport("path/to/LICENSE"), "supported");
  assert.equal(previewSupport("noext"), "supported");
});

test("卡片显隐与原因键", () => {
  assert.equal(shouldShowUnsupportedCard("a.zip"), true);
  assert.equal(shouldShowUnsupportedCard("a.zzz"), true);
  assert.equal(shouldShowUnsupportedCard("a.ts"), false);
  assert.equal(unsupportedReasonKey("a.zip"), "i18n.unsupportedBinary");
  assert.equal(unsupportedReasonKey("a.zzz"), "i18n.unsupportedUnknown");
});
