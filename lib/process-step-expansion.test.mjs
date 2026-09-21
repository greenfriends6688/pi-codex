import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_STEP_EXPANSION,
  loadStepExpansion,
  saveStepExpansion,
  setStepCategoryExpanded,
  stepCategoryOf,
} = await jiti.import("./process-step-expansion.ts");

/** 最小 localStorage 替身；`store` 传 null 表示存储不可用。 */
function withStorage(store) {
  const previous = globalThis.window;
  const listeners = [];
  globalThis.window = {
    localStorage: store,
    dispatchEvent: (event) => { listeners.push(event.type); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    listeners,
    restore() {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    },
  };
}

test("默认与改动前一致：只有推理默认展开", () => {
  const handle = withStorage({ getItem: () => null, setItem: () => {} });
  try {
    assert.deepEqual(loadStepExpansion(), { reasoning: true, command: false, tool: false });
    assert.deepEqual(DEFAULT_STEP_EXPANSION, { reasoning: true, command: false, tool: false });
  } finally {
    handle.restore();
  }
});

test("读回存过的值，坏数据与缺字段都退回默认", () => {
  const cases = [
    ['{"command":true}', { reasoning: true, command: true, tool: false }],
    ['{"command":true,"tool":true,"reasoning":false}', { reasoning: false, command: true, tool: true }],
    ['{"command":"yes"}', { reasoning: true, command: false, tool: false }],
    ['not json', { reasoning: true, command: false, tool: false }],
  ];
  for (const [raw, expected] of cases) {
    const handle = withStorage({ getItem: () => raw, setItem: () => {} });
    try {
      assert.deepEqual(loadStepExpansion(), expected, raw);
    } finally {
      handle.restore();
    }
  }
});

test("改一个类别会落盘并广播，其它类别不受影响", () => {
  const written = [];
  const handle = withStorage({ getItem: () => '{"reasoning":true}', setItem: (key, value) => written.push([key, value]) });
  try {
    const next = setStepCategoryExpanded("command", true);
    assert.deepEqual(next, { reasoning: true, command: true, tool: false });
    assert.deepEqual(written, [["pi-process-step-expanded", '{"reasoning":true,"command":true,"tool":false}']]);
    assert.deepEqual(handle.listeners, ["pi-step-expansion-changed"]);
  } finally {
    handle.restore();
  }
});

test("存储不可用时不抛异常", () => {
  const handle = withStorage(null);
  try {
    assert.deepEqual(loadStepExpansion(), DEFAULT_STEP_EXPANSION);
    assert.doesNotThrow(() => saveStepExpansion({ reasoning: false, command: false, tool: false }));
  } finally {
    handle.restore();
  }
});

test("步骤归类：推理 > 命令 > 其它工具", () => {
  assert.equal(stepCategoryOf({ reasoning: true }), "reasoning");
  assert.equal(stepCategoryOf({ reasoning: true, tone: "command_execution" }), "reasoning");
  assert.equal(stepCategoryOf({ tone: "command_execution" }), "command");
  assert.equal(stepCategoryOf({ tone: "document_read" }), "tool");
  assert.equal(stepCategoryOf({}), "tool");
});

test("服务端渲染（没有 window）也拿得到默认值", () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.deepEqual(loadStepExpansion(), DEFAULT_STEP_EXPANSION);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});
