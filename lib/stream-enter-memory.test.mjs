import assert from "node:assert/strict";
import test from "node:test";
import {
  createStreamEnterMemory,
  normalizeStreamEnterId,
  streamEnterDelay,
  STREAM_ENTER_MAX_KEYS,
  STREAM_ENTER_MAX_STAGGER,
  STREAM_ENTER_STEP_MS,
} from "./stream-enter-memory.ts";

/*
 * fork:zm-02 — the one-shot entrance memory. The rules that matter:
 *   1. an id plays once and never again (session switches remount rows);
 *   2. the map cannot grow without bound after a long streaming session;
 *   3. the stagger delay comes from a stable sequence, not an array index.
 */

test("an id plays once and never again", () => {
  const memory = createStreamEnterMemory({ now: () => 42 });
  assert.equal(memory.shouldPlay("tool:1", true), true);
  assert.equal(memory.hasPlayed("tool:1"), false);

  assert.equal(memory.record("tool:1"), true);
  assert.equal(memory.hasPlayed("tool:1"), true);
  assert.equal(memory.shouldPlay("tool:1", true), false, "a remount must not replay it");
  assert.equal(memory.shouldPlay("tool:1", false), false);
});

test("an inactive container never starts an entrance", () => {
  const memory = createStreamEnterMemory();
  assert.equal(memory.shouldPlay("tool:2", false), false);
  assert.equal(memory.size(), 0, "reading must not record");
});

test("empty ids are inert instead of animating on a shared key", () => {
  const memory = createStreamEnterMemory();
  assert.equal(normalizeStreamEnterId("   "), null);
  assert.equal(memory.shouldPlay("", true), false);
  assert.equal(memory.shouldPlay("   ", true), false);
  assert.equal(memory.record("   "), false);
  assert.equal(memory.hasPlayed("   "), true, "empty ids are treated as already played");
  assert.equal(memory.size(), 0);
});

test("ids are trimmed before they are remembered", () => {
  const memory = createStreamEnterMemory();
  memory.record("  tool:3  ");
  assert.equal(memory.hasPlayed("tool:3"), true);
  assert.equal(memory.shouldPlay("tool:3", true), false);
});

test("the map evicts the oldest keys past the cap", () => {
  let clock = 0;
  const memory = createStreamEnterMemory({ maxKeys: 3, now: () => clock });
  for (const id of ["a", "b", "c"]) {
    memory.record(id);
    clock += 10;
  }
  assert.equal(memory.size(), 3);

  memory.record("d");
  assert.equal(memory.size(), 3, "cap is respected");
  assert.equal(memory.hasPlayed("a"), false, "oldest entry was evicted");
  assert.equal(memory.hasPlayed("b"), true);
  assert.equal(memory.hasPlayed("c"), true);
  assert.equal(memory.hasPlayed("d"), true);
  assert.equal(memory.shouldPlay("a", true), true, "an evicted id may play again");
});

test("prune reports how many records it dropped", () => {
  let clock = 0;
  const memory = createStreamEnterMemory({ maxKeys: 2, now: () => clock });
  for (const id of ["a", "b", "c", "d"]) {
    memory.record(id);
    clock += 5;
  }
  assert.equal(memory.size(), 2);
  assert.equal(memory.prune(), 0, "nothing left to prune");
  memory.clear();
  assert.equal(memory.size(), 0);
});

test("the default cap is large enough for normal sessions but finite", () => {
  const memory = createStreamEnterMemory();
  assert.equal(STREAM_ENTER_MAX_KEYS, 800);
  assert.equal(memory.size(), 0);
});

test("the stagger delay is a deterministic function of the stable sequence", () => {
  assert.equal(streamEnterDelay(0), `calc(0 * ${STREAM_ENTER_STEP_MS}ms)`);
  assert.equal(streamEnterDelay(1), `calc(1 * ${STREAM_ENTER_STEP_MS}ms)`);
  assert.equal(streamEnterDelay(3), "calc(3 * 36ms)");
  assert.equal(streamEnterDelay(2.9), "calc(2 * 36ms)", "fractions floor");
  assert.equal(
    streamEnterDelay(999),
    `calc(${STREAM_ENTER_MAX_STAGGER} * ${STREAM_ENTER_STEP_MS}ms)`,
    "late rows are clamped so they never wait seconds",
  );
  assert.equal(streamEnterDelay(-4), "calc(0 * 36ms)");
  assert.equal(streamEnterDelay(Number.NaN), "calc(0 * 36ms)");
});

test("appending new turns does not re-delay the steps that already exist", () => {
  // A turn's steps are append-only, so the sequence of any existing step is the
  // same whether the render window holds 2 or 5 steps. An array index would
  // fail this when older messages are prepended above the turn.
  const firstBatch = [0, 1].map((sequence) => streamEnterDelay(sequence));
  const afterAppend = [0, 1, 2, 3, 4].map((sequence) => streamEnterDelay(sequence));
  assert.deepEqual(afterAppend.slice(0, firstBatch.length), firstBatch);
  assert.notEqual(afterAppend[2], firstBatch[1], "new rows still get their own delay");
});
