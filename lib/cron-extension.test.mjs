import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

/*
 * fork:zc-21 — the agent's cron tools.
 *
 * Pinned here: argument validation, the recursion guard, the narrow CronUpdate
 * surface, and the fact that identity (cwd/session/model) always comes from the
 * runtime even when the model tries to supply it.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CRON_TOOL_NAMES,
  CRON_WRITE_TOOL_NAMES,
  applyCronUpdate,
  buildCronTaskFromAgent,
  createCronExtension,
  decideCronApproval,
} = await jiti.import("@/lib/cron-extension");
const { findCronTask, listCronTasks, invalidateCronCache } = await jiti.import("@/lib/cron-store");
const { TOOL_GRANTS_ENTRY_TYPE } = await jiti.import("@/lib/approval-policy");

const NOW = new Date("2026-09-21T09:00:00.000Z");
const IDENTITY = {
  cwd: "/repo/current",
  sessionId: "runtime-session",
  model: { provider: "anthropic", modelId: "claude-sonnet" },
};

async function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-cron-tool-"));
  const file = join(dir, "pi-web-cron.json");
  try {
    invalidateCronCache();
    return await run(file);
  } finally {
    invalidateCronCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

function loadExtension(options = {}, storeFile) {
  const tools = new Map();
  const handlers = new Map();
  const entries = [];
  const extension = createCronExtension({
    now: () => NOW,
    randomId: () => "task-1",
    ...(storeFile ? { storeFile } : {}),
    ...options,
  });
  extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  });
  return { tools, handlers, entries };
}

function makeCtx(overrides = {}) {
  const branch = overrides.branch ?? [];
  return {
    ui: { select: overrides.select ?? (async () => "允许一次") },
    hasUI: overrides.hasUI ?? true,
    cwd: overrides.cwd ?? IDENTITY.cwd,
    model: overrides.model === undefined ? { provider: "anthropic", id: "claude-sonnet" } : overrides.model,
    mode: "rpc",
    sessionManager: {
      getSessionId: () => overrides.sessionId ?? IDENTITY.sessionId,
      getBranch: () => branch,
    },
  };
}

test("the extension registers exactly the four documented tools", () => {
  const { tools } = loadExtension();
  assert.deepEqual([...tools.keys()].sort(), ["CronCreate", "CronDelete", "CronList", "CronUpdate"]);
  assert.equal(CRON_TOOL_NAMES.create, "CronCreate");
  assert.equal(CRON_WRITE_TOOL_NAMES.has("CronList"), false, "reads are not writes");
});

test("buildCronTaskFromAgent validates the arguments", () => {
  const build = (args) => buildCronTaskFromAgent(args, IDENTITY, NOW, "task-1");
  assert.throws(() => build({ prompt: "  ", expression: "* * * * *" }), /prompt/);
  assert.throws(() => build({ prompt: "go", expression: "  " }), /expression/);
  assert.throws(() => build({ prompt: "go", expression: "* * * *" }), /invalid scheduled task/);
  assert.throws(() => build({ prompt: "go", expression: "* * * * *", timezone: "Mars/Base" }), /unknown timezone/);
  assert.throws(() => build({ prompt: "go", expression: "* * * * *", endDate: "2026-02-31" }), /endDate/);
});

test("identity always comes from the runtime, never from the arguments", () => {
  const task = buildCronTaskFromAgent(
    {
      prompt: "go",
      expression: "0 9 * * *",
      // The model tries to redirect the task; none of this may win.
      cwd: "/evil",
      sessionId: "model-session",
      model: { provider: "evil", modelId: "evil-model" },
    },
    IDENTITY,
    NOW,
    "task-1",
  );
  assert.equal(task.cwd, IDENTITY.cwd);
  assert.equal(task.reusableSessionId, IDENTITY.sessionId);
  assert.equal(task.sessionMode, "reuse", "the run returns to the session that created the task");
  assert.deepEqual(task.model, IDENTITY.model);
  assert.equal(task.schedule.kind, "cron");
  assert.equal(task.createdAt, NOW.toISOString());
});

test("CronUpdate ignores disallowed fields and preserves history", () => {
  const existing = buildCronTaskFromAgent({ prompt: "first", expression: "0 9 * * *", name: "Nightly" }, IDENTITY, NOW, "task-1");
  existing.runCount = 3;
  existing.lastRunAt = "2026-09-20T09:00:00.000Z";
  existing.history = [{ id: "r1", at: "2026-09-20T09:00:00.000Z", status: "ok" }];

  const updated = applyCronUpdate(existing, {
    id: existing.id,
    prompt: "second",
    // All of these are outside the allowed surface.
    cwd: "/evil",
    enabled: false,
    sessionMode: "new",
    reusableSessionId: "model-session",
    model: { provider: "evil", modelId: "evil-model" },
    runCount: 99,
    history: [],
    lastStatus: "running",
  });

  assert.equal(updated.prompt, "second");
  assert.equal(updated.cwd, existing.cwd, "workspace cannot change");
  assert.equal(updated.enabled, existing.enabled, "enabled cannot change");
  assert.equal(updated.model.provider, IDENTITY.model.provider, "model cannot change");
  assert.equal(updated.sessionMode, "reuse", "session binding cannot change");
  assert.equal(updated.reusableSessionId, IDENTITY.sessionId);
  assert.equal(updated.runCount, 3, "run count cannot change");
  assert.deepEqual(updated.history, existing.history, "history cannot change");
  assert.equal(updated.lastRunAt, existing.lastRunAt);
  assert.equal(updated.lastStatus, undefined);
});

test("CronUpdate can change the schedule, end date and run limit", () => {
  const existing = buildCronTaskFromAgent({ prompt: "go", expression: "0 9 * * *" }, IDENTITY, NOW, "task-1");
  const updated = applyCronUpdate(existing, { id: existing.id, expression: "*/10 * * * *", endDate: "2026-12-31", maxRuns: 4 });
  assert.equal(updated.schedule.expression, "*/10 * * * *");
  assert.equal(updated.schedule.endDate, "2026-12-31");
  assert.equal(updated.maxRuns, 4);

  const cleared = applyCronUpdate(updated, { id: existing.id, endDate: "", maxRuns: 0 });
  assert.equal(cleared.schedule.endDate, undefined);
  assert.equal(cleared.maxRuns, undefined);
});

test("approval policy: reads are open, writes ask in bypass, defer in ask/plan", () => {
  const base = { input: { prompt: "go" }, mode: "bypass", hasUI: true, grants: [], scheduledRun: false };
  assert.deepEqual(decideCronApproval({ ...base, toolName: "CronList" }), { action: "allow" });
  assert.equal(decideCronApproval({ ...base, toolName: "CronCreate" }).action, "ask");
  assert.equal(decideCronApproval({ ...base, toolName: "CronDelete" }).action, "ask");
  assert.equal(decideCronApproval({ ...base, mode: "ask", toolName: "CronCreate" }).action, "allow", "the shared gate handles ask/plan");
  assert.equal(decideCronApproval({ ...base, toolName: "CronCreate", scheduledRun: true }).action, "block");
  assert.equal(decideCronApproval({ ...base, toolName: "CronCreate", hasUI: false }).action, "block");
  assert.equal(
    decideCronApproval({ ...base, toolName: "CronCreate", grants: [{ toolName: "CronCreate", target: "" }] }).action,
    "allow",
    "an always-allow grant skips the card",
  );
});

test("the recursion guard blocks every write from a scheduled run, but not reads", async () => {
  const { handlers } = loadExtension({ isScheduledRun: () => true });
  const ctx = makeCtx();
  for (const toolName of ["CronCreate", "CronUpdate", "CronDelete"]) {
    const result = await handlers.get("tool_call")(
      { type: "tool_call", toolCallId: "t", toolName, input: { prompt: "x", id: "task-1" } },
      ctx,
    );
    assert.equal(result?.block, true, `${toolName} must be blocked`);
    assert.match(result.reason, /定时运行/);
  }
  const read = await handlers.get("tool_call")(
    { type: "tool_call", toolCallId: "t", toolName: "CronList", input: {} },
    ctx,
  );
  assert.equal(read, undefined, "CronList stays available");
});

test("a write is blocked when the user denies, allowed on allow-once, granted on allow-session", async () => {
  const deny = loadExtension();
  const denied = await deny.handlers.get("tool_call")(
    { type: "tool_call", toolCallId: "t", toolName: "CronCreate", input: { prompt: "x" } },
    makeCtx({ select: async () => "拒绝" }),
  );
  assert.equal(denied?.block, true);

  const allow = loadExtension();
  const allowed = await allow.handlers.get("tool_call")(
    { type: "tool_call", toolCallId: "t", toolName: "CronCreate", input: { prompt: "x" } },
    makeCtx({ select: async () => "允许一次" }),
  );
  assert.equal(allowed, undefined);
  assert.equal(allow.entries.length, 0, "allow-once writes no grant");

  const grant = loadExtension();
  const granted = await grant.handlers.get("tool_call")(
    { type: "tool_call", toolCallId: "t", toolName: "CronCreate", input: { prompt: "x" } },
    makeCtx({ select: async () => "本次会话总是允许" }),
  );
  assert.equal(granted, undefined);
  assert.equal(grant.entries.length, 1);
  assert.equal(grant.entries[0].customType, TOOL_GRANTS_ENTRY_TYPE);
  assert.deepEqual(grant.entries[0].data.grants, [{ toolName: "CronCreate", target: "" }]);
});

test("in ask mode a read is pre-granted so the shared gate does not ask", async () => {
  const { handlers, entries } = loadExtension({ getApprovalMode: () => "ask" });
  const result = await handlers.get("tool_call")(
    { type: "tool_call", toolCallId: "t", toolName: "CronList", input: {} },
    makeCtx(),
  );
  assert.equal(result, undefined);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].customType, TOOL_GRANTS_ENTRY_TYPE);
  assert.equal(entries[0].data.grants[0].toolName, "CronList");
});

test("CronCreate persists, CronList lists, CronUpdate updates and CronDelete deletes", () => withStore(async (file) => {
  const { tools } = loadExtension({}, file);
  const ctx = makeCtx();

  const created = await tools.get("CronCreate").execute("t", { prompt: "check deps", expression: "0 9 * * *", name: "Deps" }, undefined, undefined, ctx);
  assert.match(created.content[0].text, /task-1/);
  assert.equal(findCronTask("task-1", file).reusableSessionId, IDENTITY.sessionId);

  const listed = await tools.get("CronList").execute("t", {}, undefined, undefined, ctx);
  const body = JSON.parse(listed.content[0].text);
  assert.equal(body.tasks.length, 1);
  assert.equal(body.tasks[0].name, "Deps");

  await tools.get("CronUpdate").execute("t", { id: "task-1", prompt: "check more deps", cwd: "/evil" }, undefined, undefined, ctx);
  const afterUpdate = findCronTask("task-1", file);
  assert.equal(afterUpdate.prompt, "check more deps");
  assert.equal(afterUpdate.cwd, IDENTITY.cwd, "workspace survives a model-supplied cwd");

  await tools.get("CronDelete").execute("t", { id: "task-1" }, undefined, undefined, ctx);
  assert.equal(findCronTask("task-1", file), null);
  assert.equal(listCronTasks(NOW, file).length, 0);
}));

test("execute refuses to create inside a scheduled run even if the gate is bypassed", async () => {
  await withStore(async (file) => {
    const { tools } = loadExtension({ isScheduledRun: () => true }, file);
    await assert.rejects(
      () => tools.get("CronCreate").execute("t", { prompt: "self-replicate", expression: "* * * * *" }, undefined, undefined, makeCtx()),
      /scheduled task/,
    );
    assert.equal(listCronTasks(NOW, file).length, 0);
  });
});
