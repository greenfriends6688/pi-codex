import assert from "node:assert/strict";
import test from "node:test";

import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath, joinFilePath, sameFilePath } from "./file-paths.ts";

test("keeps absolute Windows paths when cwd casing differs", () => {
  const filePath = "D:/Work/repo/docs/guide.md";
  const relative = getRelativeFilePath(filePath, "d:/work/repo");

  // A selection is reopened from its canonical absolute path; it must not be
  // turned into a second absolute path under a case-variant cwd.
  assert.equal(relative, filePath);
  assert.equal(sameFilePath(filePath, "d:/work/repo/docs/guide.md"), true);
});

test("compares Windows paths by filesystem identity", () => {
  assert.equal(sameFilePath("D:\\Work\\repo\\docs\\..\\guide.md", "d:/work/repo/guide.md"), true);
  assert.equal(sameFilePath("D:/work/repo/guide.md", "D:/other/guide.md"), false);
  assert.equal(sameFilePath("/work/repo/guide.md", "/Work/repo/guide.md"), false);
});

// fork:upstream-0.9.2-unc-roots — UNC 路径移植的单测
test("encodeFilePathForApi keeps a UNC root inside the first segment", () => {
  // The catch-all route cannot carry a literal "//" prefix — URL routing
  // normalizes it away — so the root is folded into segment one as %2F%2Fhost.
  assert.equal(
    encodeFilePathForApi("\\\\192.0.2.1\\share\\dir"),
    "%2F%2F192.0.2.1/share/dir",
  );
  assert.equal(
    encodeFilePathForApi("//192.0.2.1/share/dir"),
    "%2F%2F192.0.2.1/share/dir",
  );
  assert.equal(
    encodeFilePathForApi("\\\\192.0.2.1\\share"),
    "%2F%2F192.0.2.1/share",
  );
});

test("encodeFilePathForApi encodes drive and POSIX paths per segment", () => {
  assert.equal(encodeFilePathForApi("D:\\repo\\a file.ts"), "D%3A/repo/a%20file.ts");
  assert.equal(encodeFilePathForApi("/tmp/a file.ts"), "tmp/a%20file.ts");
  assert.equal(encodeFilePathForApi("/tmp/dir/"), "tmp/dir");
});

test("getFileName and getFileDirectory handle UNC paths", () => {
  assert.equal(getFileName("\\\\host\\share\\dir\\file.ts"), "file.ts");
  assert.equal(getFileDirectory("\\\\host\\share\\dir\\file.ts"), "//host/share/dir");
  assert.equal(getFileDirectory("//host/share/dir"), "//host/share");
});

test("joinFilePath preserves the UNC root", () => {
  assert.equal(joinFilePath("\\\\host\\share\\dir", "child"), "//host/share/dir/child");
});

test("getRelativeFilePath strips a UNC cwd prefix", () => {
  assert.equal(
    getRelativeFilePath("\\\\host\\share\\dir\\sub\\file.ts", "\\\\host\\share\\dir"),
    "sub/file.ts",
  );
});
