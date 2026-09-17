import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

/*
 * The memory switches are the whole point of this feature ("我开了才给我记，不开就不记"),
 * so they get their own test: the same factory, with a fake `pi`, driven through both
 * switch states. `PI_CODING_AGENT_DIR` is redirected to a temp dir *before* the store
 * module loads, so nothing touches the real agent directory.
 */
const dir = mkdtempSync(join(tmpdir(), "pi-web-memory-ext-"));
process.env.PI_CODING_AGENT_DIR = dir;

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
  moduleCache: false,
});
const { createMemoryExtension, MEMORY_CAPTURE_PROMPT } = await jiti.import("@/lib/memory-extension");
const { addMemory, getMemorySettings, invalidateMemoryCache, readMemoryFile, setMemorySettings } = await jiti.import("@/lib/memory-store");

/** Minimal ExtensionAPI stand-in: records what the factory registers/subscribes. */
function fakePi() {
  const tools = new Map();
  const handlers = new Map();
  const sent = [];
  return {
    tools,
    handlers,
    sent,
    api: {
      registerTool: (tool) => tools.set(tool.name, tool),
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      sendUserMessage: async (text) => { sent.push(text); },
    },
  };
}

const idleCtx = { cwd: "/repo/a", isIdle: () => true };

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("with memory off the tools refuse and nothing is injected", async () => {
  setMemorySettings({ enabled: false, autoLearn: false });
  invalidateMemoryCache();
  const { api, tools, handlers, sent } = fakePi();
  createMemoryExtension().factory(api);

  assert.deepEqual([...tools.keys()], ["remember", "recall"], "the tools stay registered so the switch can be flipped live");

  const remember = await tools.get("remember").execute("c1", { text: "should not be saved" }, undefined, undefined, idleCtx);
  assert.match(remember.content[0].text, /memory is disabled/);
  assert.equal(remember.details.ok, false);
  assert.equal(getMemorySettings().enabled, false);
  // The settings file itself exists (that is how the switch is stored) — what must
  // not exist is an entry.
  assert.deepEqual(readMemoryFile().entries, [], "the refused call stored nothing");

  const recall = await tools.get("recall").execute("c2", {}, undefined, undefined, idleCtx);
  assert.match(recall.content[0].text, /memory is disabled/);

  const injected = await handlers.get("before_agent_start")[0]({}, idleCtx);
  assert.equal(injected, undefined, "no injection while off");

  // Auto-learn must not fire either.
  await handlers.get("agent_start")[0]({}, idleCtx);
  await handlers.get("agent_settled")[0]({}, idleCtx);
  assert.deepEqual(sent, []);
});

test("turning memory on makes remember save and the next turn receive it", async () => {
  setMemorySettings({ enabled: true, autoLearn: false });
  invalidateMemoryCache();
  const { api, tools, handlers } = fakePi();
  createMemoryExtension().factory(api);

  const saved = await tools.get("remember").execute("c1", { text: "这个仓库用 pnpm" }, undefined, undefined, idleCtx);
  assert.equal(saved.details.ok, true, JSON.stringify(saved.details));

  const injected = await handlers.get("before_agent_start")[0]({}, idleCtx);
  assert.ok(injected?.message, "a memory list is injected");
  assert.match(injected.message.content, /这个仓库用 pnpm/);
  assert.equal(injected.message.display, false, "context, not transcript noise");
  assert.equal(injected.message.customType, "pi-web-memory");

  const recall = await tools.get("recall").execute("c2", { query: "pnpm" }, undefined, undefined, idleCtx);
  assert.match(recall.content[0].text, /pnpm/);
});

test("auto-learn runs one capture per run and never chases its own output", async () => {
  setMemorySettings({ enabled: true, autoLearn: true });
  invalidateMemoryCache();
  const { api, handlers, sent } = fakePi();
  createMemoryExtension().factory(api);

  const start = handlers.get("agent_start")[0];
  const settle = handlers.get("agent_settled")[0];

  // A normal run: start → settle → one capture message.
  await start({}, idleCtx);
  await settle({}, idleCtx);
  assert.deepEqual(sent, [MEMORY_CAPTURE_PROMPT], "exactly one capture pass");

  // The capture's own run: start → settle must not queue another one.
  await start({}, idleCtx);
  await settle({}, idleCtx);
  assert.equal(sent.length, 1, "the capture did not chase itself");

  // A real second run captures again.
  await start({}, idleCtx);
  await settle({}, idleCtx);
  assert.equal(sent.length, 2);

  // Off → no capture even after a start/settle pair.
  setMemorySettings({ autoLearn: false });
  invalidateMemoryCache();
  await start({}, idleCtx);
  await settle({}, idleCtx);
  assert.equal(sent.length, 2, "auto-learn off means no extra turn");
});

test("the capture prompt asks for at most two entries and allows silence", () => {
  assert.match(MEMORY_CAPTURE_PROMPT, /at most TWO/);
  assert.match(MEMORY_CAPTURE_PROMPT, /nothing to remember/);
  assert.match(MEMORY_CAPTURE_PROMPT, /remember/);
});

test("project scope keeps another project's notes out of the prompt", async () => {
  setMemorySettings({ enabled: true, autoLearn: false });
  addMemory({ text: "项目 A 的约定", scope: "/repo/a" });
  addMemory({ text: "全局偏好", scope: "global" });
  invalidateMemoryCache();

  const { api, handlers } = fakePi();
  createMemoryExtension().factory(api);

  const inA = await handlers.get("before_agent_start")[0]({}, { cwd: "/repo/a", isIdle: () => true });
  assert.match(inA.message.content, /项目 A 的约定/);
  assert.match(inA.message.content, /全局偏好/);

  const inB = await handlers.get("before_agent_start")[0]({}, { cwd: "/repo/b", isIdle: () => true });
  assert.doesNotMatch(inB.message.content, /项目 A 的约定/);
  assert.match(inB.message.content, /全局偏好/, "global notes apply everywhere");
});
