import assert from "node:assert/strict";
import test from "node:test";

const {
  parseSessionFlags,
  applySessionFlags,
  archivedSessions,
} = await import("./session-flags.ts");

test("parseSessionFlags tolerates malformed and hostile storage", () => {
  assert.deepEqual(parseSessionFlags(null), { pinned: [], archived: [] });
  assert.deepEqual(parseSessionFlags(""), { pinned: [], archived: [] });
  assert.deepEqual(parseSessionFlags("{"), { pinned: [], archived: [] });
  assert.deepEqual(parseSessionFlags("[]"), { pinned: [], archived: [] });
  assert.deepEqual(parseSessionFlags("null"), { pinned: [], archived: [] });
  // Non-string entries and duplicates are dropped.
  assert.deepEqual(
    parseSessionFlags(JSON.stringify({ pinned: ["a", 3, null, "a", ""], archived: "nope" })),
    { pinned: ["a"], archived: [] },
  );
});

test("parseSessionFlags round-trips a well-formed payload", () => {
  const flags = parseSessionFlags(JSON.stringify({ pinned: ["a"], archived: ["b", "c"] }));
  assert.deepEqual(flags, { pinned: ["a"], archived: ["b", "c"] });
});

const rows = [
  { id: "s1" },
  { id: "s2" },
  { id: "s3" },
  { id: "s4" },
];

test("applySessionFlags returns a copy when no flags are set", () => {
  const out = applySessionFlags(rows, { pinned: [], archived: [] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s2", "s3", "s4"]);
  assert.notEqual(out, rows, "must not alias the input array");
});

test("applySessionFlags drops archived rows without touching the others", () => {
  const out = applySessionFlags(rows, { pinned: [], archived: ["s2"] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s3", "s4"]);
});

test("applySessionFlags partitions pinned rows stably (no reshuffle)", () => {
  const first = applySessionFlags(rows, { pinned: ["s3"], archived: [] });
  assert.deepEqual(first.map((r) => r.id), ["s3", "s1", "s2", "s4"]);
  const second = applySessionFlags(rows, { pinned: ["s1", "s3"], archived: [] });
  // Pinned keep their original relative order.
  assert.deepEqual(second.map((r) => r.id), ["s1", "s3", "s2", "s4"]);
});

test("applySessionFlags drops a row that is both pinned and archived", () => {
  const out = applySessionFlags(rows, { pinned: ["s2"], archived: ["s2"] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s3", "s4"]);
});

test("archivedSessions keeps an archived id retrievable while the main list hides it", () => {
  const flags = { pinned: [], archived: ["s2"] };
  assert.deepEqual(applySessionFlags(rows, flags).map((r) => r.id), ["s1", "s3", "s4"]);
  assert.deepEqual(archivedSessions(rows, flags).map((r) => r.id), ["s2"]);
  // Nothing archived means nothing to recover, and the helper never aliases
  // the input array the main filter copied.
  assert.deepEqual(archivedSessions(rows, { pinned: [], archived: [] }), []);
  assert.notEqual(archivedSessions(rows, flags), rows);
});
