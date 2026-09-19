import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readToolGrants, createApprovalExtension } = await jiti.import("./approval-extension.ts");

const customEntry = (data) => ({ type: "custom", customType: "pi-web:tool-grants", data });

test("授权从分支读回：取最后一条，忽略其它 custom entry 与畸形数据", () => {
  const grants = readToolGrants([
    { type: "message", message: { role: "user", content: "hi" } },
    { type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: ["read"] } },
    customEntry({ version: 1, grants: [{ toolName: "bash", target: "npm publish" }] }),
    customEntry({ version: 1, grants: [{ toolName: "bash", target: "npm publish" }, { toolName: "write", target: "/repo" }] }),
    customEntry({ version: 99, grants: [] }),
  ]);
  assert.deepEqual(grants, [
    { toolName: "bash", target: "npm publish" },
    { toolName: "write", target: "/repo" },
  ]);
  assert.deepEqual(readToolGrants([]), []);
  assert.deepEqual(readToolGrants([null, "x", 42]), []);
});

test("默认模式（bypass）下扩展不拦任何工具调用", async () => {
  const extension = createApprovalExtension(() => "bypass");
  const handlers = [];
  const fakePi = { on: (name, handler) => handlers.push({ name, handler }) };
  extension.factory(fakePi);

  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;
  const result = await toolCall(
    { toolName: "bash", input: { command: "rm -rf /" } },
    { hasUI: true, ui: { select: async () => "deny" }, sessionManager: { getBranch: () => [] } },
  );
  assert.equal(result, undefined, "bypass 必须放行（默认路径与改动前等价）");
});

test("没有 UI 时危险调用被拦，而不是默默放行", async () => {
  const extension = createApprovalExtension(() => "ask");
  const handlers = [];
  extension.factory({ on: (name, handler) => handlers.push({ name, handler }) });
  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;

  const result = await toolCall(
    { toolName: "bash", input: { command: "git push --force" } },
    { hasUI: false, ui: { select: async () => "allow-once" }, sessionManager: { getBranch: () => [] } },
  );
  assert.equal(result.block, true);
  assert.match(result.reason, /没有可用的交互界面/);
});

test("ask 模式下：拒绝 → block，允许一次 → 放行且不写授权", async () => {
  const extension = createApprovalExtension(() => "ask");
  const handlers = [];
  const appended = [];
  extension.factory({ on: (name, handler) => handlers.push({ name, handler }) });
  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;
  const ctx = (choice) => ({
    hasUI: true,
    ui: { select: async () => choice },
    sessionManager: { getBranch: () => [], appendCustomEntry: (type, data) => appended.push({ type, data }) },
  });

  const denied = await toolCall({ toolName: "bash", input: { command: "git push --force" } }, ctx("deny"));
  assert.equal(denied.block, true);
  assert.equal(appended.length, 0);

  const once = await toolCall({ toolName: "bash", input: { command: "git push --force" } }, ctx("allow-once"));
  assert.equal(once, undefined);
  assert.equal(appended.length, 0, "一次性放行不该写会话");
});

test("「本次会话总是允许」写入 pi-web:tool-grants，且随后同类调用直接放行", async () => {
  const extension = createApprovalExtension(() => "ask");
  const handlers = [];
  const appended = [];
  let branch = [];
  // 扩展侧写状态的正规入口是 pi.appendEntry（不是 ctx.sessionManager）
  const fakePi = {
    on: (name, handler) => handlers.push({ name, handler }),
    appendEntry: (type, data) => {
      appended.push({ type, data });
      branch = [...branch, { type: "custom", customType: type, data }];
    },
  };
  extension.factory(fakePi);
  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;
  const ctx = {
    hasUI: true,
    ui: { select: async () => "allow-session" },
    sessionManager: { getBranch: () => branch },
  };

  const first = await toolCall({ toolName: "bash", input: { command: "npm publish" } }, ctx);
  assert.equal(first, undefined);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, "pi-web:tool-grants");
  assert.deepEqual(appended[0].data, { version: 1, grants: [{ toolName: "bash", target: "npm publish" }] });

  // 第二次同类调用：不应再问（select 不再被调用也能放行）
  const secondCtx = { ...ctx, ui: { select: async () => { throw new Error("should not ask again"); } } };
  const second = await toolCall({ toolName: "bash", input: { command: "npm publish --tag next" } }, secondCtx);
  assert.equal(second, undefined);
});

test("等待期间被中止（select 抛错）→ 按拒绝处理", async () => {
  const extension = createApprovalExtension(() => "ask");
  const handlers = [];
  extension.factory({ on: (name, handler) => handlers.push({ name, handler }) });
  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;

  const result = await toolCall(
    { toolName: "bash", input: { command: "sudo rm -rf /" } },
    {
      hasUI: true,
      ui: { select: async () => { throw new Error("aborted"); } },
      sessionManager: { getBranch: () => [] },
    },
  );
  assert.equal(result.block, true);
  assert.match(result.reason, /拒绝/);
});

test("只读调用在 ask 模式下不触发对话框", async () => {
  const extension = createApprovalExtension(() => "ask");
  const handlers = [];
  extension.factory({ on: (name, handler) => handlers.push({ name, handler }) });
  const toolCall = handlers.find((entry) => entry.name === "tool_call").handler;

  let asked = false;
  const result = await toolCall(
    { toolName: "bash", input: { command: "git status --short" } },
    { hasUI: true, ui: { select: async () => { asked = true; return "deny"; } }, sessionManager: { getBranch: () => [] } },
  );
  assert.equal(result, undefined);
  assert.equal(asked, false);
});
