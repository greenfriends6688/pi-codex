import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getBuiltinModelCatalog, findBuiltinModelConflicts } = await createJiti(import.meta.url).import("./builtin-models.ts");

test("内置目录包含常见 provider（anthropic/openai/google）", () => {
  const catalog = getBuiltinModelCatalog();
  const anthropic = catalog.get("anthropic");
  const openai = catalog.get("openai");
  assert.ok(anthropic && anthropic.size > 0, "anthropic 内置模型应存在");
  assert.ok(openai && openai.size > 0, "openai 内置模型应存在");
  assert.ok(anthropic.has("claude-sonnet-4-6") || anthropic.size >= 10, "anthropic 应有 claude 模型");
});

test("findBuiltinModelConflicts 识别与内置模型同名的 models[] 条目", () => {
  const catalog = getBuiltinModelCatalog();
  const [providerName, ids] = [...catalog.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  const builtinId = [...ids].sort()[0];
  const conflicts = findBuiltinModelConflicts({
    [providerName]: { models: [{ id: builtinId }, { id: "custom-model" }] },
    reqtoken: { models: [{ id: "gpt-5.6" }] }, // 非内置 provider 不误报
  });
  assert.deepEqual(conflicts, [`${providerName}/${builtinId}`]);
});

test("无冲突时返回空数组", () => {
  assert.deepEqual(findBuiltinModelConflicts({}), []);
  assert.deepEqual(findBuiltinModelConflicts({ custom: { models: [{ id: "m1" }] } }), []);
});

test("内置数据目录读不到时静默降级为空目录", () => {
  const previousCatalog = globalThis.__piBuiltinModels;
  // 模拟 loadCatalog 读不到 data 目录时的结果（空 Map），不应抛错也不误报冲突。
  globalThis.__piBuiltinModels = { providerModels: new Map() };
  try {
    assert.equal(getBuiltinModelCatalog().size, 0);
    assert.deepEqual(findBuiltinModelConflicts({ anything: { models: [{ id: "x" }] } }), []);
  } finally {
    globalThis.__piBuiltinModels = previousCatalog;
  }
});
