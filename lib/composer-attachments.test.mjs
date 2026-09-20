import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// `composer-attachments.ts` 会 import `./file-fuzzy`（省略扩展名，打包器/jiti 能解析，
// 原生 node ESM 不能），所以这里与 lib/todo-state.test.mjs 一样走 jiti。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./composer-attachments.ts");
}

const MB = 1024 * 1024;
const file = (name, size, type = "") => ({ name, size, type });

test("上传上限与上传路由保持一致（每文件 25MB / 单次 100MB）", async () => {
  const { MAX_ATTACHED_FILE_BYTES, MAX_ATTACHED_UPLOAD_TOTAL_BYTES } = await loadSubject();

  assert.equal(MAX_ATTACHED_FILE_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_ATTACHED_UPLOAD_TOTAL_BYTES, 100 * 1024 * 1024);
});

test("上限内的任意文件类型都走上传（不再只收图片）", async () => {
  const { planAttachments } = await loadSubject();

  const plan = planAttachments([
    file("report.csv", 2 * MB, "text/csv"),
    file("notes.md", 1024, "text/markdown"),
    file("archive.zip", 9 * MB, "application/zip"),
  ]);

  assert.deepEqual(plan.upload.map((f) => f.name), ["report.csv", "notes.md", "archive.zip"]);
  assert.deepEqual(plan.referenceInPlace, []);
  assert.deepEqual(plan.skipped, []);
});

test("超过每文件上限但有本地路径 → 直接就地把路径写进消息", async () => {
  const { planAttachments } = await loadSubject();

  const big = file("video.mp4", 60 * MB, "video/mp4");
  const plan = planAttachments([big], { pathOf: () => "/Users/me/Downloads/video.mp4" });

  assert.deepEqual(plan.upload, []);
  assert.deepEqual(plan.referenceInPlace, [{ file: big, path: "/Users/me/Downloads/video.mp4" }]);
  assert.deepEqual(plan.skipped, []);
});

test("超过每文件上限又没有本地路径 → 显式跳过并给出原因（不再静默丢）", async () => {
  const { planAttachments } = await loadSubject();

  const big = file("video.mp4", 60 * MB, "video/mp4");
  const plan = planAttachments([big]);

  assert.deepEqual(plan.upload, []);
  assert.deepEqual(plan.referenceInPlace, []);
  assert.deepEqual(plan.skipped, [{ file: big, reason: "too-large" }]);
});

test("合计预算按顺序消耗，超预算但有路径的仍能就地引用", async () => {
  const { planAttachments } = await loadSubject();

  // 六个 20MB：前五个刚好 100MB，第六个超预算
  const plan = planAttachments([
    file("a.bin", 20 * MB), file("b.bin", 20 * MB), file("c.bin", 20 * MB),
    file("d.bin", 20 * MB), file("e.bin", 20 * MB), file("f.bin", 20 * MB),
  ], { pathOf: (f) => (f.name === "f.bin" ? "/tmp/f.bin" : null), uploadBudgetBytes: 100 * MB });

  assert.deepEqual(plan.upload.map((f) => f.name), ["a.bin", "b.bin", "c.bin", "d.bin", "e.bin"]);
  assert.deepEqual(plan.referenceInPlace.map((entry) => entry.file.name), ["f.bin"]);
  assert.deepEqual(plan.skipped, []);
});

test("合计预算耗尽且无路径 → 逐个显式跳过", async () => {
  const { planAttachments } = await loadSubject();

  const plan = planAttachments([
    file("a.bin", 20 * MB), file("b.bin", 20 * MB), file("c.bin", 20 * MB),
    file("d.bin", 20 * MB), file("e.bin", 20 * MB), file("f.bin", 20 * MB),
  ], { uploadBudgetBytes: 100 * MB });

  assert.deepEqual(plan.upload.map((f) => f.name), ["a.bin", "b.bin", "c.bin", "d.bin", "e.bin"]);
  assert.deepEqual(plan.skipped.map((entry) => entry.file.name), ["f.bin"]);
  assert.deepEqual(plan.referenceInPlace, []);
});

test("每文件上限优先于合计预算：30MB 文件在 100MB 预算下仍然不能上传", async () => {
  const { planAttachments } = await loadSubject();

  // 这条语义是刻意的：上传路由的封套（每文件 25MB）不因新功能被撞大
  const plan = planAttachments([file("big.bin", 30 * MB)], { uploadBudgetBytes: 100 * MB });
  assert.deepEqual(plan.upload, []);
  assert.deepEqual(plan.skipped.map((entry) => entry.file.name), ["big.bin"]);

  // 有本地路径时，同样大小反而能引用（路径本来就没大小限制）
  const withPath = planAttachments([file("big.bin", 30 * MB)], { pathOf: () => "/tmp/big.bin" });
  assert.deepEqual(withPath.referenceInPlace.map((entry) => entry.file.name), ["big.bin"]);
});

test("预算为 0 时全部走引用或跳过，不会误上传", async () => {
  const { planAttachments } = await loadSubject();

  const plan = planAttachments([file("a.txt", 10)], { uploadBudgetBytes: 0 });
  assert.deepEqual(plan.upload, []);
  assert.deepEqual(plan.skipped.map((entry) => entry.file.name), ["a.txt"]);
});

test("文件名清洗拦住目录穿越与非法名字", async () => {
  const { sanitizeAttachmentName } = await loadSubject();

  assert.equal(sanitizeAttachmentName("report.csv"), "report.csv");
  assert.equal(sanitizeAttachmentName("  带空格 名字 .txt  "), "带空格 名字 .txt");
  assert.equal(sanitizeAttachmentName("../etc/passwd"), null);
  assert.equal(sanitizeAttachmentName("a/b.csv"), null);
  assert.equal(sanitizeAttachmentName("a\\b.csv"), null);
  assert.equal(sanitizeAttachmentName(".."), null);
  assert.equal(sanitizeAttachmentName(""), null);
  assert.equal(sanitizeAttachmentName("bad\0name"), null);
  assert.equal(sanitizeAttachmentName(`${"x".repeat(201)}.txt`), null);
});

test("重名时给出 -2/-3 后缀而不是覆盖", async () => {
  const { nextAvailableAttachmentName } = await loadSubject();

  assert.equal(nextAvailableAttachmentName("report.csv", []), "report.csv");
  assert.equal(nextAvailableAttachmentName("report.csv", ["report.csv"]), "report-2.csv");
  assert.equal(nextAvailableAttachmentName("report.csv", ["report.csv", "report-2.csv"]), "report-3.csv");
  assert.equal(nextAvailableAttachmentName("README", ["README"]), "README-2");
  assert.equal(nextAvailableAttachmentName(".env", [".env.2", ".env"]), ".env-2");
});

test("路径引用插入的是 `@文件名`（不是完整路径），含空格时加引号", async () => {
  const { buildAttachmentReference } = await loadSubject();

  // fork:ui — 输入框里只显文件名（完整路径会把输入框撑爆）；
  // 发送前由 expandAttachmentReferences() 还原成路径。
  assert.deepEqual(buildAttachmentReference("/tmp/a.csv"), { text: "@a.csv ", cursorOffset: 7 });
  assert.deepEqual(
    buildAttachmentReference("/tmp/my report.csv"),
    { text: '@"my report.csv" ', cursorOffset: 17 },
  );
  // 取文件名必须同时认 POSIX 与 Windows 分隔符。
  assert.deepEqual(buildAttachmentReference("C:\\Users\\me\\报告.docx"), { text: "@报告.docx ", cursorOffset: 9 });
});

test("发送前把 `@文件名` 还原成 `@完整路径`", async () => {
  const { expandAttachmentReferences } = await loadSubject();
  const paths = ["/Users/me/.pi/agent/attachments/2026-09-20/a.csv"];

  // 命中：还原成完整路径
  assert.equal(expandAttachmentReferences("看看 @a.csv 这个", paths), "看看 @/Users/me/.pi/agent/attachments/2026-09-20/a.csv 这个");
  // 未命中：完全不动（不能误伤用户手打的其他 @ 文本）
  assert.equal(expandAttachmentReferences("@b.csv 不是附件", paths), "@b.csv 不是附件");
  // 没有附件时是原样返回
  assert.equal(expandAttachmentReferences("普通文本", []), "普通文本");
  // 同一附件被插两次：两处都还原
  assert.equal(
    expandAttachmentReferences("@a.csv 和 @a.csv", paths),
    "@/Users/me/.pi/agent/attachments/2026-09-20/a.csv 和 @/Users/me/.pi/agent/attachments/2026-09-20/a.csv",
  );
});

test("提示条只在有话说的时候出现", async () => {
  const { attachmentNotice } = await loadSubject();

  assert.equal(attachmentNotice({ referenced: [] }), "none");
  assert.equal(attachmentNotice({ referenced: [], images: 2 }), "references");
  assert.equal(attachmentNotice({ referenced: ["a.csv"] }), "references");
  assert.equal(
    attachmentNotice({ referenced: ["a.csv"], skipped: [{ name: "big.bin", reason: "too-large" }] }),
    "skipped",
  );
});
