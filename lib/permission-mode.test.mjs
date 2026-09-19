import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PERMISSION_MODES,
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_ENTRY_TYPE,
  readPermissionMode,
  appendPermissionMode,
  isPermissionModeEntry,
  nextPermissionMode,
} = await jiti.import("./permission-mode.ts");

const entry = (mode) => ({ type: "custom", customType: PERMISSION_MODE_ENTRY_TYPE, data: { version: 1, mode } });

test("缺省档位是 bypass：没选过档位的会话行为与改动前完全一致", () => {
  assert.equal(DEFAULT_PERMISSION_MODE, "bypass");
  assert.equal(readPermissionMode([]), "bypass");
  assert.equal(readPermissionMode([{ type: "message", message: {} }]), "bypass");
});

test("读回取最后一次写入（会话中途切档生效）", () => {
  assert.equal(readPermissionMode([entry("ask"), entry("bypass"), entry("plan")]), "plan");
  assert.equal(readPermissionMode([entry("plan"), entry("ask")]), "ask");
});

test("畸形数据一律回退默认档，而不是抛错（坏条目不能让会话打不开）", () => {
  assert.equal(readPermissionMode([null, "x", 42]), "bypass");
  assert.equal(readPermissionMode([{ type: "custom", customType: PERMISSION_MODE_ENTRY_TYPE, data: { version: 2, mode: "ask" } }]), "bypass");
  assert.equal(readPermissionMode([{ type: "custom", customType: PERMISSION_MODE_ENTRY_TYPE, data: { version: 1, mode: "yolo" } }]), "bypass");
  // 别的 custom entry 不能被误读
  assert.equal(readPermissionMode([{ type: "custom", customType: "pi-web:tool-grants", data: { version: 1, mode: "ask" } }]), "bypass");
});

test("写入一条 custom entry（与工具选择同款）", () => {
  const appended = [];
  const fakeSessionManager = { appendCustomEntry: (type, data) => appended.push({ type, data }) };

  appendPermissionMode(fakeSessionManager, "ask");
  assert.deepEqual(appended, [{ type: PERMISSION_MODE_ENTRY_TYPE, data: { version: 1, mode: "ask" } }]);

  // 非法值落回默认档，绝不写半个坏条目
  appendPermissionMode(fakeSessionManager, "yolo");
  assert.deepEqual(appended[1], { type: PERMISSION_MODE_ENTRY_TYPE, data: { version: 1, mode: "bypass" } });
  assert.equal(isPermissionModeEntry(appended[1].data), true);
});

test("plan 在 PROMA-03 落地后仍走最严格档：写动作由计划扩展拦，审批不再重复问", async () => {
  const { approvalModeFor, approvalModeForPlanAwareMode } = await jiti.import("./permission-mode.ts");
  // 保留原函数（语义：plan 不比其他受限档松）
  assert.equal(approvalModeFor("plan"), "ask");
  // 但实际接线用这个：plan 下写动作已被计划扩展拦死，审批再问一次就是双重弹卡
  assert.equal(approvalModeForPlanAwareMode("bypass"), "bypass");
  assert.equal(approvalModeForPlanAwareMode("ask"), "ask");
  assert.equal(approvalModeForPlanAwareMode("plan"), "bypass");
});

test("循环切换覆盖三档且回到起点", () => {
  const seen = [];
  let mode = DEFAULT_PERMISSION_MODE;
  for (let i = 0; i < PERMISSION_MODES.length; i += 1) {
    seen.push(mode);
    mode = nextPermissionMode(mode);
  }
  assert.deepEqual(seen, ["bypass", "ask", "plan"]);
  assert.equal(mode, "bypass");
});
