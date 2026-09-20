import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadSubject() {
  return import("./stream-update-scheduler.ts");
}

function createClock() {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();

  return {
    platform: {
      now: () => time,
      requestFrame(callback) {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame(handle) {
        frames.delete(handle);
      },
      setTimer(callback, delay) {
        const handle = nextHandle++;
        timers.set(handle, { callback, delay });
        return handle;
      },
      clearTimer(handle) {
        timers.delete(handle);
      },
    },
    setTime(next) {
      time = next;
    },
    runFrame() {
      const [handle, callback] = frames.entries().next().value ?? [];
      assert.ok(handle, "expected one queued animation frame");
      frames.delete(handle);
      callback(time);
    },
    runTimer() {
      const [handle, timer] = timers.entries().next().value ?? [];
      assert.ok(handle, "expected one queued timer");
      timers.delete(handle);
      timer.callback();
      return timer.delay;
    },
    get queuedFrames() {
      return frames.size;
    },
    get queuedTimers() {
      return timers.size;
    },
  };
}

test("coalesces burst updates to the newest complete snapshot", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), {
    ...clock.platform,
    maxUpdatesPerSecond: 30,
  });

  scheduler.enqueue("first");
  scheduler.enqueue("second");
  scheduler.enqueue("latest");
  assert.equal(clock.queuedFrames, 1);

  clock.runFrame();
  await Promise.resolve(); // commit is deferred to a microtask
  assert.deepEqual(committed, ["latest"]);
});

test("caps commits and resumes with the newest value after the frame interval", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), {
    ...clock.platform,
    maxUpdatesPerSecond: 30,
  });

  scheduler.enqueue("one");
  clock.runFrame();
  await Promise.resolve();
  clock.setTime(10);
  scheduler.enqueue("two");
  scheduler.enqueue("three");
  clock.runFrame();
  await Promise.resolve();

  assert.deepEqual(committed, ["one"]);
  assert.equal(clock.queuedTimers, 1);
  assert.ok(clock.runTimer() > 20);
  clock.setTime(34);
  clock.runFrame();
  await Promise.resolve();
  assert.deepEqual(committed, ["one", "three"]);
});

test("reset cancels delayed updates so stale stream content cannot commit", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.enqueue("stale");
  scheduler.reset();
  assert.equal(clock.queuedFrames, 0);
  assert.equal(clock.queuedTimers, 0);
  assert.deepEqual(committed, []);

  scheduler.enqueue("fresh");
  clock.runFrame();
  await Promise.resolve();
  assert.deepEqual(committed, ["fresh"]);
});

test("flush immediately commits the final queued snapshot", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.enqueue("partial");
  scheduler.enqueue("final");
  scheduler.flush();

  assert.deepEqual(committed, ["final"]);
  assert.equal(clock.queuedFrames, 0);
});

test("flush with nothing queued is a no-op", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.flush();
  assert.deepEqual(committed, []);
  assert.equal(clock.queuedFrames, 0);
  assert.equal(clock.queuedTimers, 0);
});

test("destroy permanently stops commits and drops queued snapshots", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.enqueue("pending");
  scheduler.destroy();
  assert.equal(clock.queuedFrames, 0);
  assert.equal(clock.queuedTimers, 0);
  scheduler.enqueue("after-destroy");
  scheduler.flush();
  await Promise.resolve();
  assert.deepEqual(committed, []);
});

test("falls back to timers when no requestFrame is available", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), {
    now: clock.platform.now,
    requestFrame: undefined,
    cancelFrame: undefined,
    setTimer: clock.platform.setTimer,
    clearTimer: clock.platform.clearTimer,
    maxUpdatesPerSecond: 30,
  });

  scheduler.enqueue("only");
  assert.equal(clock.queuedFrames, 0);
  assert.equal(clock.queuedTimers, 1);
  clock.runTimer();
  await Promise.resolve();
  assert.deepEqual(committed, ["only"]);
});

// ---------------------------------------------------------------------------
// useAgentSession 接线回归（源码级断言）
//
// hook 本身无法在 node 测试里渲染（依赖 EventSource / fetch / React 运行时），
// 因此和 hooks/useAgentSession.test.mjs 保持一致的源码切片断言，锁住三件事：
//   1. delta / snapshot 经 scheduler 合批，且入队的是完整快照；
//   2. 结束路径 flush 尾帧，reset 路径丢弃旧 run 快照；
//   3. 现有 run id 单调性与 30 秒 SSE 宽限窗口没被破坏。
// ---------------------------------------------------------------------------
const hookSource = await readFile(
  new URL("../hooks/useAgentSession.ts", import.meta.url),
  "utf8",
);

function sliceSource(start, end) {
  const from = hookSource.indexOf(start);
  const to = hookSource.indexOf(end, from);
  assert.notEqual(from, -1, `start marker not found: ${start}`);
  assert.notEqual(to, -1, `end marker not found: ${end}`);
  return hookSource.slice(from, to);
}

test("useAgentSession batches deltas through the scheduler with full snapshots", () => {
  const schedulerSource = sliceSource(
    "// fork:stream-update-scheduler",
    "sessionPropIdRef.current = session?.id ?? null;",
  );

  assert.match(hookSource, /createStreamUpdateScheduler/);
  assert.match(schedulerSource, /createStreamUpdateScheduler<AgentMessage>/);
  assert.match(schedulerSource, /StreamUpdateScheduler<AgentMessage>/);
  // 完整快照入队：由 streamReducer 在影子状态上推进后 enqueue(message)。
  assert.match(schedulerSource, /streamReducer\(streamingStateRef\.current, action\)/);
  assert.match(schedulerSource, /scheduler\?\.enqueue\(next\.streamingMessage\)/);
  // delta 与 snapshot 都是合批路径，不直接 dispatch。
  assert.match(schedulerSource, /case "delta":\s*case "snapshot"/);
  assert.match(schedulerSource, /dispatchStreamState\(\{ type: "snapshot", message \}\)/);
});

test("useAgentSession flushes the tail on end and resets stale snapshots", () => {
  const schedulerSource = sliceSource(
    "// fork:stream-update-scheduler",
    "sessionPropIdRef.current = session?.id ?? null;",
  );
  const endIndex = schedulerSource.indexOf('case "end"');
  assert.notEqual(endIndex, -1, "end case not found");
  const endCase = schedulerSource.slice(endIndex);
  const startIndex = schedulerSource.indexOf('case "start"');
  const startCase = schedulerSource.slice(startIndex, schedulerSource.indexOf('case "resume"'));

  // 结束：先 flush 最后一个完整快照，再 reset + end。
  assert.match(endCase, /flushStreamUpdates\(\)[\s\S]*?resetStreamUpdates\(\)[\s\S]*?dispatchStreamState\(action\)/);
  // 新 run：旧 run 的挂起快照必须丢弃。
  assert.match(startCase, /resetStreamUpdates\(\)[\s\S]*?dispatchStreamState\(action\)/);
  // reset / flush 两个 helper 都是稳定 useCallback。
  assert.match(hookSource, /const resetStreamUpdates = useCallback/);
  assert.match(hookSource, /const flushStreamUpdates = useCallback/);
  // 卸载清理必须 reset，防止卸载后的会话再提交一帧。
  const mountSource = sliceSource("// Load session on mount", "useEffect(() => {\n    onSystemPromptChange");
  assert.match(mountSource, /sessionHookMountedRef\.current = false[\s\S]*?resetStreamUpdates\(\)/);
});

test("useAgentSession keeps run-id monotonicity and the 30s stream grace window", () => {
  const streamSource = sliceSource('case "message_start"', 'case "message_end"');
  const messageEndSource = sliceSource('case "message_end"', 'case "tool_execution_start"');
  const promptDoneSource = sliceSource('case "prompt_done"', 'case "prompt_error"');
  const reconcileSource = sliceSource(
    "const reconcileAgentState = useCallback",
    "// Recovery net for missed SSE events",
  );

  // 晚到的旧 run 事件仍被 agentRunningRef 拦住，不会复活 ghost bubble。
  assert.match(streamSource, /if \(!agentRunningRef\.current\) break;/);
  assert.match(messageEndSource, /if \(!agentRunningRef\.current\) break;/);
  // 结束路径仍然经由 wrapper 的 dispatch end（内部 flush 尾帧）。
  assert.match(messageEndSource, /dispatch\(\{ type: "end" \}\)/);
  // prompt_done / reconcile 的 run id 检查保持不变。
  assert.match(promptDoneSource, /const runId = promptRunIdRef\.current/);
  assert.match(reconcileSource, /const runId = promptRunIdRef\.current/);
  assert.match(reconcileSource, /sessionIdRef\.current !== sid \|\| promptRunIdRef\.current !== runId/);
  // 30 秒 SSE 宽限窗口未被改动。
  assert.match(hookSource, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(hookSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
});
