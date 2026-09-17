/**
 * fork:ui-todo — pure todo state for the `todo` tool.
 *
 * Why this exists at all: pi ships no built-in todo tool, and that is what made an
 * earlier pass here conclude "not doable". It is doable — the SDK's own extension
 * example is a todo list (`examples/extensions/todo.ts`), and the documented state
 * pattern is to keep the list in **tool-result `details`** and rebuild it from the
 * session branch on load. That has a property a side file cannot match: branching
 * rewinds the list with the conversation, because each branch carries its own tool
 * results.
 *
 * Everything here is pure so the whole tool behaviour is unit-testable without
 * booting the SDK; `lib/todo-extension.ts` is the thin adapter that registers it.
 */

export const TODO_DETAILS_KIND = "pi-web-todo";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

export interface TodoState {
  todos: TodoItem[];
  nextId: number;
}

export interface TodoDetails extends TodoState {
  kind: typeof TODO_DETAILS_KIND;
  action: TodoAction;
  error?: string;
}

export const TODO_ACTIONS = ["list", "add", "set", "toggle", "remove", "clear"] as const;
export type TodoAction = (typeof TODO_ACTIONS)[number];

export type TodoParams = {
  action: TodoAction;
  text?: string;
  items?: string[];
  id?: number;
};

export const EMPTY_TODO_STATE: TodoState = { todos: [], nextId: 1 };

export function isTodoDetails(value: unknown): value is TodoDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<TodoDetails>;
  return details.kind === TODO_DETAILS_KIND && Array.isArray(details.todos);
}

export function canApplyTodoDetails(value: unknown): value is TodoDetails {
  if (!isTodoDetails(value)) return false;
  return typeof value.nextId === "number" && value.todos.every((todo) => (
    todo && typeof todo.id === "number" && typeof todo.text === "string" && typeof todo.done === "boolean"
  ));
}

export interface TodoSummary {
  todos: TodoItem[];
  done: number;
  total: number;
}

export const EMPTY_TODO_SUMMARY: TodoSummary = { todos: [], done: 0, total: 0 };

function summarize(state: TodoState): TodoSummary {
  const done = state.todos.filter((todo) => todo.done).length;
  return { todos: state.todos, done, total: state.todos.length };
}

/**
 * Rebuild the list from a branch (or any ordered list of messages/entries).
 *
 * Last write wins: a later tool result carries the complete list, so only the
 * newest one matters. Entries may be session entries (`{type:"message", message}`)
 * or already-unwrapped messages — the extension passes a branch, the UI passes the
 * rendered message list.
 */
export function extractTodoState(entries: readonly unknown[]): TodoSummary {
  let state: TodoState | null = null;
  for (const entry of entries) {
    const message = (entry && typeof entry === "object" && "message" in entry)
      ? (entry as { message?: unknown }).message
      : entry;
    if (!message || typeof message !== "object") continue;
    const candidate = message as { role?: unknown; toolName?: unknown; details?: unknown };
    if (candidate.role !== "toolResult" || candidate.toolName !== "todo") continue;
    if (!canApplyTodoDetails(candidate.details)) continue;
    state = { todos: candidate.details.todos.map((todo) => ({ ...todo })), nextId: candidate.details.nextId };
  }
  return state ? summarize(state) : EMPTY_TODO_SUMMARY;
}

export interface TodoActionResult {
  state: TodoState;
  details: TodoDetails;
  /** Human/model-facing one-liner or list rendering. */
  text: string;
}

function fail(state: TodoState, action: TodoAction, error: string): TodoActionResult {
  return {
    state,
    details: { kind: TODO_DETAILS_KIND, action, todos: state.todos.map((todo) => ({ ...todo })), nextId: state.nextId, error },
    text: `Error: ${error}`,
  };
}

function renderList(todos: readonly TodoItem[]): string {
  return todos.length
    ? todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n")
    : "No todos";
}

/**
 * Apply one tool call. Pure: the caller owns the returned state.
 *
 * `set` is the action the reference example lacks and agents actually want: a plan
 * arrives as one list ("set" with N items) and is then ticked off with `toggle`,
 * instead of N round-trips of `add`.
 */
export function applyTodoAction(state: TodoState, params: TodoParams): TodoActionResult {
  const current = { todos: state.todos.map((todo) => ({ ...todo })), nextId: state.nextId };
  const ok = (action: TodoAction, next: TodoState, text: string): TodoActionResult => ({
    state: next,
    details: { kind: TODO_DETAILS_KIND, action, todos: next.todos.map((todo) => ({ ...todo })), nextId: next.nextId },
    text,
  });

  switch (params.action) {
    case "list":
      return ok("list", current, renderList(current.todos));

    case "add": {
      const text = params.text?.trim();
      if (!text) return fail(current, "add", "text is required for add");
      const todo: TodoItem = { id: current.nextId, text, done: false };
      const next = { todos: [...current.todos, todo], nextId: current.nextId + 1 };
      return ok("add", next, `Added todo #${todo.id}: ${todo.text}`);
    }

    case "set": {
      const items = (params.items ?? []).map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return fail(current, "set", "items is required for set");
      // Keep the done flag of an item that already exists with the same wording, so
      // a re-plan does not silently un-complete finished work.
      const previous = new Map(current.todos.map((todo) => [todo.text, todo.done]));
      const todos = items.map((text, index) => ({ id: index + 1, text, done: previous.get(text) ?? false }));
      return ok("set", { todos, nextId: todos.length + 1 }, `Todo list set (${todos.length} items):\n${renderList(todos)}`);
    }

    case "toggle": {
      if (params.id === undefined) return fail(current, "toggle", "id is required for toggle");
      const todo = current.todos.find((item) => item.id === params.id);
      if (!todo) return fail(current, "toggle", `#${params.id} not found`);
      const todos = current.todos.map((item) => (item.id === params.id ? { ...item, done: !item.done } : item));
      const flipped = todos.find((item) => item.id === params.id)!;
      return ok("toggle", { todos, nextId: current.nextId }, `Todo #${flipped.id} ${flipped.done ? "completed" : "reopened"}`);
    }

    case "remove": {
      if (params.id === undefined) return fail(current, "remove", "id is required for remove");
      const todo = current.todos.find((item) => item.id === params.id);
      if (!todo) return fail(current, "remove", `#${params.id} not found`);
      const todos = current.todos.filter((item) => item.id !== params.id);
      return ok("remove", { todos, nextId: current.nextId }, `Removed todo #${todo.id}: ${todo.text}`);
    }

    case "clear":
      return ok("clear", { todos: [], nextId: 1 }, `Cleared ${current.todos.length} todos`);

    default:
      return fail(current, "list", `unknown action: ${String((params as { action?: unknown }).action)}`);
  }
}
