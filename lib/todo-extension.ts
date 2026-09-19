import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  EMPTY_TODO_STATE,
  TODO_ACTIONS,
  applyTodoAction,
  canApplyTodoDetails,
  type TodoState,
} from "./todo-state";

/**
 * fork:ui-todo — the built-in `todo` tool, registered as an inline extension.
 *
 * Pi has no todo tool of its own; this one follows the SDK's documented state
 * pattern (`docs/extensions.md` § State Management, worked example
 * `examples/extensions/todo.ts`): the list lives in the tool result's `details`,
 * and the in-memory copy is rebuilt from the current branch on `session_start` /
 * `session_tree`. Nothing is written outside the session file, so a branch switch
 * or a fork rewinds the list exactly like the conversation.
 *
 * Registered unconditionally (unlike the subagent extension, which follows a
 * setting): a plan the user never sees is worse than an unused tool, and the tool
 * costs one line in every system prompt.
 */

export const HOST_TODO_EXTENSION_NAME = "pi-web-todos";

function reconstructFromBranch(ctx: ExtensionContext): TodoState {
  let state: TodoState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message || message.role !== "toolResult" || message.toolName !== "todo") continue;
    const details = (message as { details?: unknown }).details;
    if (!canApplyTodoDetails(details)) continue;
    state = { todos: details.todos.map((todo) => ({ ...todo })), nextId: details.nextId };
  }
  return state ?? EMPTY_TODO_STATE;
}

export function createTodoExtension(): InlineExtension {
  return {
    name: HOST_TODO_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let state: TodoState = EMPTY_TODO_STATE;
      const reconstruct = (ctx: ExtensionContext) => {
        state = reconstructFromBranch(ctx);
      };

      pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

      pi.registerTool(defineTool({
        name: "todo",
        label: "Todo",
        description: [
          "Manage the task list for this session. The user watches this list live, so every call shows up immediately.",
          "Actions:",
          "list — show the current list",
          "set (items: string[]) — replace the whole list, e.g. to record a plan before starting",
          "add (text) — append one item",
          "toggle (id, or text) — mark an item done / reopened",
          "remove (id) — delete one item",
          "clear — empty the list",
        ].join("\n"),
        promptSnippet: "Track the steps of a multi-step task in a visible todo list",
        promptGuidelines: [
          "Use todo with action set before starting work whenever a task has three or more steps, so the user can follow the plan while it runs.",
          // fork:ui-todo-live — a run that only toggles at the end shows the user
          // an unchanged list for the whole session and then a fully ticked one,
          // which reads as a static summary rather than live progress.
          "Toggle a todo's id in the very next tool call after that step's work has landed — never hold the updates back for the end of the run. A batch of toggles issued at the finish is indistinguishable from never updating the list.",
          "Mark an id done only for work that has actually finished; never tick an item because you are about to start it.",
          "Keep the list in sync: do not toggle an id that is not in the list, and re-read it with list after a long gap.",
        ],
        executionMode: "parallel",
        parameters: Type.Object({
          action: Type.Union(TODO_ACTIONS.map((action) => Type.Literal(action))),
          text: Type.Optional(Type.String({ description: "Todo text (add, or toggle by text)" })),
          items: Type.Optional(Type.Array(Type.String(), { description: "Full list of todo texts (set)" })),
          id: Type.Optional(Type.Number({ description: "Todo id (toggle / remove)" })),
        }),
        async execute(_toolCallId, params) {
          const result = applyTodoAction(state, params);
          state = result.state;
          return {
            content: [{ type: "text" as const, text: result.text }],
            details: result.details,
          };
        },
      }));
    },
  };
}
