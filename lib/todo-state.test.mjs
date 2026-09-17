import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  EMPTY_TODO_STATE,
  TODO_DETAILS_KIND,
  applyTodoAction,
  canApplyTodoDetails,
  extractTodoState,
  isTodoDetails,
} = await jiti.import("@/lib/todo-state");

/** Run a sequence of calls the way the tool does, threading the state through. */
function run(calls) {
  let state = EMPTY_TODO_STATE;
  const results = [];
  for (const call of calls) {
    const result = applyTodoAction(state, call);
    state = result.state;
    results.push(result);
  }
  return { state, results, last: results[results.length - 1] };
}

test("set records a plan and toggle ticks it off", () => {
  const { state, last } = run([
    { action: "set", items: ["read the spec", "write the code", "run tests"] },
    { action: "toggle", id: 1 },
  ]);

  assert.deepEqual(state.todos.map((todo) => [todo.id, todo.text, todo.done]), [
    [1, "read the spec", true],
    [2, "write the code", false],
    [3, "run tests", false],
  ]);
  assert.match(last.text, /completed/);
});

test("set keeps the done flag of a re-planned item", () => {
  const { state } = run([
    { action: "set", items: ["a", "b"] },
    { action: "toggle", id: 1 },
    { action: "set", items: ["a", "b", "c"] },
  ]);

  assert.deepEqual(state.todos.map((todo) => [todo.text, todo.done]), [["a", true], ["b", false], ["c", false]]);
});

test("add appends, remove deletes, clear empties", () => {
  const { state } = run([
    { action: "add", text: "first" },
    { action: "add", text: "second" },
    { action: "remove", id: 1 },
    { action: "add", text: "third" },
  ]);

  assert.deepEqual(state.todos.map((todo) => todo.text), ["second", "third"]);
  assert.equal(state.nextId, 4, "ids keep increasing so a stale toggle cannot hit a reused id");

  const cleared = run([{ action: "set", items: ["x"] }, { action: "clear" }]);
  assert.deepEqual(cleared.state.todos, []);
  assert.equal(cleared.state.nextId, 1);
});

test("bad calls report an error and leave the list untouched", () => {
  const base = run([{ action: "set", items: ["keep me"] }]);
  for (const call of [
    { action: "add" },
    { action: "add", text: "   " },
    { action: "toggle" },
    { action: "toggle", id: 99 },
    { action: "remove", id: 99 },
    { action: "set", items: [] },
  ]) {
    const result = applyTodoAction(base.state, call);
    assert.ok(result.details.error, `${JSON.stringify(call)} should fail`);
    assert.deepEqual(result.state.todos, base.state.todos, `${JSON.stringify(call)} must not mutate the list`);
    assert.match(result.text, /^Error: /);
  }
});

test("list renders every item with its state", () => {
  const { last } = run([
    { action: "set", items: ["one", "two"] },
    { action: "toggle", id: 1 },
    { action: "list" },
  ]);

  assert.equal(last.text, "[x] #1: one\n[ ] #2: two");
  assert.equal(run([{ action: "list" }]).last.text, "No todos");
});

// --- transcript derivation (what the UI reads back) ---

function toolResult(details, toolName = "todo") {
  return { type: "message", message: { role: "toolResult", toolName, details } };
}

test("extractTodoState takes the newest tool result, branch-aware", () => {
  const first = applyTodoAction(EMPTY_TODO_STATE, { action: "set", items: ["a", "b"] });
  const second = applyTodoAction(first.state, { action: "toggle", id: 1 });

  const branch = [toolResult(first.details), { type: "message", message: { role: "user", content: "go on" } }, toolResult(second.details)];
  const summary = extractTodoState(branch);

  assert.equal(summary.total, 2);
  assert.equal(summary.done, 1);
  assert.equal(summary.todos[1].text, "b");
});

test("a branched rewound transcript reports the older list", () => {
  const first = applyTodoAction(EMPTY_TODO_STATE, { action: "set", items: ["a"] });
  const second = applyTodoAction(first.state, { action: "add", text: "b" });

  assert.equal(extractTodoState([toolResult(first.details), toolResult(second.details)]).total, 2);
  // Same session, rewound to before the second call: the extra item is gone.
  assert.equal(extractTodoState([toolResult(first.details)]).total, 1);
});

test("foreign or malformed details are ignored", () => {
  assert.equal(extractTodoState([]).total, 0);
  assert.equal(extractTodoState([toolResult({ kind: "other", todos: [] })]).total, 0);
  assert.equal(extractTodoState([toolResult({ kind: TODO_DETAILS_KIND, todos: "no" })]).total, 0);
  assert.equal(extractTodoState([toolResult({ kind: TODO_DETAILS_KIND, todos: [{ id: "1", text: "x", done: false }], nextId: 2 })]).total, 0);
  // A different tool that happens to be named like ours must not match.
  assert.equal(extractTodoState([toolResult({ kind: TODO_DETAILS_KIND, todos: [], nextId: 1 }, "bash")]).total, 0);
});

test("isTodoDetails narrows without accepting non-objects", () => {
  assert.equal(isTodoDetails(null), false);
  assert.equal(isTodoDetails("pi-web-todo"), false);
  assert.equal(isTodoDetails({ kind: TODO_DETAILS_KIND, todos: [] }), true);
  assert.equal(canApplyTodoDetails({ kind: TODO_DETAILS_KIND, todos: [] }), false, "nextId is required to replay state");
  assert.equal(canApplyTodoDetails({ kind: TODO_DETAILS_KIND, todos: [], nextId: 1 }), true);
});
