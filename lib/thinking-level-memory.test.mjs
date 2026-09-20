import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "pi-web-thinking-memory-"));
const emptyDir = mkdtempSync(join(tmpdir(), "pi-web-thinking-memory-empty-"));
process.env.PI_CODING_AGENT_DIR = dir;

const { getThinkingLevelMemory, rememberThinkingLevel, forgetThinkingLevel, thinkingLevelMemoryKey } =
  await createJiti(import.meta.url).import("./thinking-level-memory.ts");

test("remembers and reads per-model levels", () => {
  rememberThinkingLevel(thinkingLevelMemoryKey("reqtoken", "gpt-5.6"), "high");
  rememberThinkingLevel(thinkingLevelMemoryKey("reqtoken", "gpt-5.2"), "xhigh");

  const memory = getThinkingLevelMemory();
  assert.deepEqual(memory, {
    "reqtoken/gpt-5.6": "high",
    "reqtoken/gpt-5.2": "xhigh",
  });

  // 文件真实落盘（原子写）
  const raw = JSON.parse(readFileSync(join(dir, "pi-web-preferences.json"), "utf8"));
  assert.equal(raw.thinkingLevelMemory["reqtoken/gpt-5.6"], "high");
});

test("updates overwrite the previous level for the same model", () => {
  rememberThinkingLevel("reqtoken/gpt-5.6", "medium");
  assert.equal(getThinkingLevelMemory()["reqtoken/gpt-5.6"], "medium");
});

test("forgets a single model without touching the rest", () => {
  forgetThinkingLevel("reqtoken/gpt-5.6");
  const memory = getThinkingLevelMemory();
  assert.deepEqual(memory, { "reqtoken/gpt-5.2": "xhigh" });

  // 全部忘记后清掉 thinkingLevelMemory 字段
  forgetThinkingLevel("reqtoken/gpt-5.2");
  assert.deepEqual(getThinkingLevelMemory(), {});
  const raw = JSON.parse(readFileSync(join(dir, "pi-web-preferences.json"), "utf8"));
  assert.equal("thinkingLevelMemory" in raw, false);

  // 忘记不存在的 key 是无操作，不应抛错
  forgetThinkingLevel("nope/none");
});

test("empty memory returns an empty record", () => {
  process.env.PI_CODING_AGENT_DIR = emptyDir;
  assert.deepEqual(getThinkingLevelMemory(), {});
});

// 清理临时目录
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});
