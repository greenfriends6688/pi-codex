import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { decidePlanModeToolCall, isPlanMode, PLAN_MODE_SYSTEM_PROMPT } = await jiti.import("./plan-mode.ts");
const { createPlanModeExtension } = await jiti.import("./plan-mode-extension.ts");

const bash = (command) => ({ toolName: "bash", input: { command } });

test("计划档下只读工具放行", () => {
  assert.equal(decidePlanModeToolCall("read", { path: "/repo/a.ts" }).allowed, true);
  assert.equal(decidePlanModeToolCall("grep", { pattern: "foo" }).allowed, true);
  assert.equal(decidePlanModeToolCall("ls", { path: "/repo" }).allowed, true);
  // 只读命令同样放行（复用 PROMA-01 的命令白名单）
  assert.equal(decidePlanModeToolCall("bash", { command: "git status --short" }).allowed, true);
  assert.equal(decidePlanModeToolCall("bash", { command: "ls -la" }).allowed, true);
});

test("写工具与有副作用的命令一律拦下，理由写给模型看", () => {
  const cases = [
    ["write", { path: "/repo/a.ts", content: "x" }],
    ["edit", { path: "/repo/a.ts", oldText: "a", newText: "b" }],
    ["bash", { command: "npm test" }],
    ["bash", { command: "rm -rf build" }],
    ["bash", { command: "git commit -m x" }],
  ];
  for (const [toolName, input] of cases) {
    const decision = decidePlanModeToolCall(toolName, input);
    assert.equal(decision.allowed, false, `${toolName} ${JSON.stringify(input)}`);
    assert.match(decision.reason, /计划模式下不允许/, toolName);
    // 理由必须告诉它下一步干什么（否则模型只会反复重试同一个动作）
    assert.match(decision.reason, /只读手段/, toolName);
  }
});

test("未分类的命令也拦（计划模式宁可拦多）", () => {
  const decision = decidePlanModeToolCall("bash", { command: "node scripts/build.mjs" });
  assert.equal(decision.allowed, false);
});

test("isPlanMode 只认 plan 档", () => {
  assert.equal(isPlanMode("plan"), true);
  assert.equal(isPlanMode("ask"), false);
  assert.equal(isPlanMode("bypass"), false);
});

test("system prompt 指令包含只读约束与「先给编号计划」", () => {
  assert.match(PLAN_MODE_SYSTEM_PROMPT, /只读/);
  assert.match(PLAN_MODE_SYSTEM_PROMPT, /编号/);
});

function runExtension(mode) {
  const handlers = [];
  createPlanModeExtension(() => mode).factory({ on: (name, handler) => handlers.push({ name, handler }) });
  return {
    beforeAgentStart: handlers.find((entry) => entry.name === "before_agent_start")?.handler,
    toolCall: handlers.find((entry) => entry.name === "tool_call")?.handler,
  };
}

test("非计划档下扩展完全不介入", async () => {
  const extension = runExtension("bypass");
  assert.equal(await extension.beforeAgentStart({ systemPrompt: "BASE" }), undefined);
  assert.equal(await extension.toolCall({ toolName: "write", input: { path: "a" } }), undefined);
});

test("计划档下追加 system prompt 且保留原有内容", async () => {
  const extension = runExtension("plan");
  const result = await extension.beforeAgentStart({ systemPrompt: "BASE" });
  assert.match(result.systemPrompt, /^BASE\n\n/);
  assert.match(result.systemPrompt, /计划模式/);
  // 没有原 prompt 时不能拼出 "undefined"
  const bare = await extension.beforeAgentStart({});
  assert.doesNotMatch(bare.systemPrompt, /undefined/);
});

test("计划档下写工具被 block，只读调用照常返回 undefined", async () => {
  const extension = runExtension("plan");
  const blocked = await extension.toolCall({ toolName: "write", input: { path: "/repo/a.ts" } });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /计划模式/);
  assert.equal(await extension.toolCall({ toolName: "read", input: { path: "/repo/a.ts" } }), undefined);
  assert.equal(await extension.toolCall(bash("git status")), undefined);
});
