import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const restoreStart = source.indexOf("// Auto-select cwd and restore session from URL on first load");
const restoreEnd = source.indexOf("// Prefer an exact UI selection while a refetch is in flight", restoreStart);
const restoreSource = source.slice(restoreStart, restoreEnd);

const loadStart = source.indexOf("const loadSessions = useCallback");
const loadEnd = source.indexOf("}, []);", loadStart);
const loadSource = source.slice(loadStart, loadEnd);

test("a `?session=` restore waits for the session list before spending its one shot", () => {
  assert.notEqual(restoreStart, -1);
  assert.notEqual(restoreEnd, -1);

  // The attempt is only consumed once the target was found, or once the list
  // has actually answered. Burning it on the first pass (empty `allSessions`
  // because `/api/chat-workspace` resolved first) left `?session=<id>` on the
  // welcome page for every install that has a chat workspace.
  const branch = restoreSource.indexOf("initialSessionId && !restoredRef.current");
  const loadedGate = restoreSource.indexOf("if (!sessionsLoadedRef.current) return;");
  const missingPathSpendsAttempt = restoreSource.indexOf("restoredRef.current = true;", loadedGate);
  const placeholder = restoreSource.indexOf("onInitialRestoreDone?.();");
  assert.ok(branch >= 0, "the restore branch exists");
  assert.ok(loadedGate > branch, "the retry gate sits inside the restore branch");
  assert.ok(missingPathSpendsAttempt > loadedGate, "the attempt is spent only after the list has loaded");
  assert.ok(placeholder > missingPathSpendsAttempt, "the placeholder is only reported for a truly missing session");
  assert.match(restoreSource, /const target = allSessions\.find\(\(s\) => s\.id === initialSessionId\);/);
});

test("the list-loaded flag is raised when /api/sessions answers, not when it fails", () => {
  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);
  assert.match(loadSource, /sessionsLoadedRef\.current = true;/);

  // A stale response must not mark the list as loaded …
  const staleGuard = loadSource.indexOf("if (loadId !== sessionLoadIdRef.current) return;");
  const flag = loadSource.indexOf("sessionsLoadedRef.current = true;");
  assert.ok(staleGuard >= 0 && flag > staleGuard, "only the current response raises the flag");
  // … and the catch branch must not, or a failed fetch would look like "no such session".
  const catchIndex = loadSource.indexOf("} catch (e) {");
  assert.ok(catchIndex > flag, "the flag is raised before the catch branch");
  assert.doesNotMatch(loadSource.slice(catchIndex), /sessionsLoadedRef\.current = true;/);
});
