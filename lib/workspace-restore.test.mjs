import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveRestoreTarget } = await jiti.import("./workspace-restore.ts");

const keyOf = (session) => session.projectKey ?? session.projectRoot ?? session.cwd ?? "";
const session = (id, modified, projectKey = "/repo") => ({ id, modified, projectKey });

test("prefers the remembered session when it still belongs to the workspace", () => {
  const target = resolveRestoreTarget({
    rememberedSessionId: "b",
    sessions: [session("a", "2026-09-01T00:00:00Z"), session("b", "2026-08-01T00:00:00Z")],
    workspaceKey: "/repo",
    keyOf,
  });
  assert.deepEqual(target, { kind: "remembered", sessionId: "b" });
});

test("falls back to the newest session when nothing is remembered", () => {
  const target = resolveRestoreTarget({
    rememberedSessionId: null,
    sessions: [session("old", "2026-08-01T00:00:00Z"), session("new", "2026-09-19T00:00:00Z")],
    workspaceKey: "/repo",
    keyOf,
  });
  assert.deepEqual(target, { kind: "newest", sessionId: "new" });
});

test("ignores a remembered session that drifted into another workspace", () => {
  const target = resolveRestoreTarget({
    rememberedSessionId: "other",
    sessions: [session("other", "2026-09-19T00:00:00Z", "/elsewhere"), session("mine", "2026-08-01T00:00:00Z")],
    workspaceKey: "/repo",
    keyOf,
  });
  assert.deepEqual(target, { kind: "newest", sessionId: "mine" });
});

test("starts a new draft for a workspace with no sessions", () => {
  const target = resolveRestoreTarget({
    rememberedSessionId: "gone",
    sessions: [session("other", "2026-09-19T00:00:00Z", "/elsewhere")],
    workspaceKey: "/repo",
    keyOf,
  });
  assert.deepEqual(target, { kind: "new-draft" });
});

test("sessions without a usable timestamp never outrank a dated one", () => {
  const target = resolveRestoreTarget({
    rememberedSessionId: null,
    sessions: [session("undated", undefined), session("dated", "2026-01-01T00:00:00Z")],
    workspaceKey: "/repo",
    keyOf,
  });
  assert.deepEqual(target, { kind: "newest", sessionId: "dated" });
});
