import assert from "node:assert/strict";
import { test } from "node:test";
import { createStreamThrottle } from "./stream-throttle.ts";

/** 可控时钟 + 可控定时器，避免测试依赖真实时间。 */
function createHarness(intervalMs = 120) {
  let clock = 0;
  const timers = [];
  let nextHandle = 1;
  const updates = [];
  const throttle = createStreamThrottle((text) => updates.push(text), {
    intervalMs,
    now: () => clock,
    setTimeoutFn: (handler, ms) => {
      const handle = nextHandle++;
      timers.push({ handle, handler, at: clock + ms });
      return handle;
    },
    clearTimeoutFn: (handle) => {
      const index = timers.findIndex((timer) => timer.handle === handle);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  const advance = (ms) => {
    clock += ms;
    for (const timer of [...timers]) {
      if (timer.at <= clock) {
        timers.splice(timers.indexOf(timer), 1);
        timer.handler();
      }
    }
  };
  return { throttle, advance, updates, timers, now: () => clock };
}

test("首个值立即交付，不等一个间隔", () => {
  const h = createHarness();
  h.throttle.push("a");
  assert.deepEqual(h.updates, ["a"]);
});

test("持续 push 的刷新频率上界是 intervalMs（不会被无限推迟）", () => {
  const h = createHarness(120);
  h.throttle.push("a"); // 立即交付
  for (const text of ["ab", "abc", "abcd", "abcde"]) h.throttle.push(text);
  assert.deepEqual(h.updates, ["a"], "间隔未到前不应刷新");
  h.advance(120);
  assert.deepEqual(h.updates, ["a", "abcde"], "到点后交付的是最新值，不是排队的第一帧");
  assert.equal(h.throttle.pending(), false);
});

test("中间值会被跳过（最新值优先）", () => {
  const h = createHarness(120);
  h.throttle.push("a");
  h.advance(200);
  h.throttle.push("b");
  h.throttle.push("c");
  h.throttle.push("d");
  h.advance(120);
  assert.deepEqual(h.updates, ["a", "d"]);
});

test("flush 取消待执行刷新并立即交付最终文本", () => {
  const h = createHarness(500);
  h.throttle.push("a");
  h.throttle.push("ab");
  assert.equal(h.throttle.pending(), true);
  h.throttle.flush();
  assert.deepEqual(h.updates, ["a", "ab"]);
  assert.equal(h.throttle.pending(), false, "flush 后不应再有定时器");
  assert.equal(h.timers.length, 0);
  h.advance(1000);
  assert.deepEqual(h.updates, ["a", "ab"], "已取消的刷新不能再补一次");
});

test("flush 在文本未变时是空操作", () => {
  const h = createHarness();
  h.throttle.push("a");
  h.throttle.flush();
  assert.deepEqual(h.updates, ["a"]);
});

test("value() 反映已交付文本", () => {
  const h = createHarness(120);
  h.throttle.push("a");
  h.throttle.push("ab");
  assert.equal(h.throttle.value(), "a");
  h.throttle.flush();
  assert.equal(h.throttle.value(), "ab");
});

test("dispose 之后不再回调，也不留定时器", () => {
  const h = createHarness(120);
  h.throttle.push("a");
  h.throttle.push("ab");
  h.throttle.dispose();
  assert.equal(h.timers.length, 0);
  h.advance(1000);
  h.throttle.push("abc");
  h.throttle.flush();
  assert.deepEqual(h.updates, ["a"]);
});

test("空字符串不会被当成首个值提前交付", () => {
  const h = createHarness(120);
  h.throttle.push("");
  assert.deepEqual(h.updates, []);
  h.throttle.push("a");
  assert.deepEqual(h.updates, ["a"]);
});
