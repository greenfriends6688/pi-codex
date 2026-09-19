import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { planRewind, rewindSessionFile } = await jiti.import("./session-rewind.ts");

const header = JSON.stringify({ type: "session", version: 3, id: "sess-1", cwd: "/repo" });
const entry = (id, type, parentId) => JSON.stringify({ type, id, parentId, message: { role: "user", content: id } });
const assistant = (id, parentId) => JSON.stringify({ type: "message", id, parentId, message: { role: "assistant", content: [] } });

const lines = (...extra) => [header, ...extra];

test("按 entryId 含该条截断：保留目标及其之前，丢掉之后", () => {
  const input = lines(entry("e1", "message", null), assistant("e2", "e1"), entry("e3", "message", "e2"), assistant("e4", "e3"));
  const result = planRewind(input, "e2");
  assert.equal(result.ok, true);
  assert.equal(result.plan.dropped, 2);
  assert.deepEqual(result.plan.kept, [header, input[1], input[2]]);
  assert.equal(result.plan.entryType, "message");
});

test("目标就是最后一条 → 没什么可回退（拒绝而不是空写）", () => {
  const input = lines(entry("e1", "message", null), assistant("e2", "e1"));
  const result = planRewind(input, "e2");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "nothing-to-drop");
  assert.match(result.message, /最后一条/);
});

test("找不到 entryId → 拒绝并说明可能被压缩", () => {
  const result = planRewind(lines(entry("e1", "message", null)), "missing");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "entry-not-found");
  assert.match(result.message, /压缩/);
});

test("严格解析：有一行不是合法 JSON 就整体拒绝（绝不部分重写）", () => {
  const input = lines(entry("e1", "message", null), "{ 这不是 json", entry("e3", "message", "e1"));
  const result = planRewind(input, "e1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-jsonl");
});

test("头部永远保留，且不参与 id 匹配", () => {
  // 头部即使带 id 也不该被当成目标（它是会话元数据）
  const headerWithId = JSON.stringify({ type: "session", id: "sess-1", version: 3 });
  const input = [headerWithId, entry("e1", "message", null), assistant("e2", "e1")];
  const result = planRewind(input, "sess-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "entry-not-found");
});

test("空文件与空行被正确处理", () => {
  assert.equal(planRewind([], "x").reason, "empty-file");
  assert.equal(planRewind(["", "  "], "x").reason, "empty-file");
  // 末尾多空行不影响判定
  const input = [...lines(entry("e1", "message", null), assistant("e2", "e1")), ""];
  assert.equal(planRewind(input, "e1").plan.dropped, 1);
});

test("rewindSessionFile 真的截断文件，且声明文件改动未回退", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-rewind-"));
  const file = join(dir, "session.jsonl");
  const content = [header, entry("e1", "message", null), assistant("e2", "e1"), entry("e3", "message", "e2")].join("\n") + "\n";
  writeFileSync(file, content, "utf8");

  const result = rewindSessionFile(file, "e2");
  assert.equal(result.ok, true);
  assert.equal(result.dropped, 1);
  assert.equal(result.filesReverted, false, "必须明确告诉调用方磁盘文件没有被回退");

  const after = readFileSync(file, "utf8");
  assert.equal(after, [header, entry("e1", "message", null), assistant("e2", "e1")].join("\n") + "\n");
  assert.equal(after.endsWith("\n"), true, "尾部换行风格保持");
});

test("失败时绝不改动文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-rewind-noop-"));
  const file = join(dir, "session.jsonl");
  const content = [header, entry("e1", "message", null)].join("\n") + "\n";
  writeFileSync(file, content, "utf8");

  const result = rewindSessionFile(file, "nope");
  assert.equal(result.ok, false);
  assert.equal(readFileSync(file, "utf8"), content, "拒绝路径必须原样保留文件");
});

test("文件不存在 → 可读失败而不是抛异常", () => {
  const result = rewindSessionFile(join(tmpdir(), "definitely-missing-file.jsonl"), "e1");
  assert.equal(result.ok, false);
  assert.equal(result.filesReverted, false);
});
