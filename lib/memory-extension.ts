import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  MEMORY_RECALL_LIMIT,
  addMemory,
  getMemorySettings,
  listMemory,
  recallMemory,
  renderMemoryBlock,
} from "./memory-store";

/**
 * fork:memory — `remember` / `recall` tools plus context injection.
 *
 * Injection goes through `before_agent_start`, which the SDK documents as "inject a
 * message and/or modify the system prompt" — the memory list is re-rendered on every
 * turn, so a fact saved mid-session is available to the very next turn instead of
 * only after a reload. The injected message is `display: false`: it is context for
 * the model, not something to clutter the transcript with.
 *
 * Scope: the session's cwd decides which memories apply (global entries always do),
 * so a project's notes do not leak into an unrelated repo.
 */

export const HOST_MEMORY_EXTENSION_NAME = "pi-web-memory";

/**
 * The automatic capture pass (MusePi's "停止时自动捕获").
 *
 * It is a real turn, so it costs tokens — which is why it is behind a switch that
 * defaults to off. The wording matters: it asks for at most two entries and gives
 * the model an explicit way to say "nothing here", so a run that taught it nothing
 * does not invent a fact to justify the pass.
 */
export const MEMORY_CAPTURE_PROMPT = [
  "Memory pass — review the conversation so far.",
  "Call `remember` for at most TWO durable facts, preferences or project conventions that would still matter in a future session.",
  "Do not save task state, file paths that are about to change, or anything already written in the repo's own docs.",
  "If nothing qualifies, reply with exactly: nothing to remember",
].join(" ");

function scopeForCwd(cwd: string | undefined): string {
  return cwd && cwd.trim() ? cwd : "global";
}

export function createMemoryExtension(): InlineExtension {
  return {
    name: HOST_MEMORY_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      // The switches are read per hook, not captured once: flipping them in Settings
      // must take effect for the sessions that are already open.
      const memoryEnabled = () => getMemorySettings().enabled;
      const autoLearnEnabled = () => {
        const settings = getMemorySettings();
        return settings.enabled && settings.autoLearn;
      };

      // Capture bookkeeping: one pass per user-initiated run. `armed` is set by a
      // run that starts while we are not capturing, and the capture's own run
      // deliberately does not re-arm — otherwise the pass would chase itself.
      let armed = false;
      let capturing = false;
      pi.on("agent_start", async () => {
        if (!capturing) armed = true;
      });
      pi.on("agent_settled", async (_event, ctx) => {
        if (capturing) {
          capturing = false;
          armed = false;
          return;
        }
        if (!armed || !autoLearnEnabled()) return;
        armed = false;
        if (!ctx.isIdle()) return;
        capturing = true;
        try {
          await pi.sendUserMessage(MEMORY_CAPTURE_PROMPT, { deliverAs: "followUp" });
        } catch {
          // Busy or shutting down: drop this pass rather than retrying into a
          // session the user is no longer watching.
          capturing = false;
        }
      });

      // Deliberately NOT gated at factory time: the tools stay registered and check
      // the switch inside `execute`. Registering conditionally would mean "turning
      // memory on does nothing until you reload the session", which is exactly the
      // kind of half-wired switch this feature must not have.
      pi.registerTool(defineTool({
        name: "remember",
        label: "Remember",
        description: [
          "Save a durable fact, preference or instruction so it is available in future sessions.",
          "Use it for things that stay true beyond this task: project conventions, user preferences, environment quirks, decisions already made.",
          "Do NOT use it for transient task state (use the todo tool) or for anything already written in the repo's own docs.",
        ].join("\n"),
        promptSnippet: "Save a durable fact or preference for future sessions",
        promptGuidelines: [
          "Save at most a couple of facts per session; one clear sentence each.",
          "Prefer remember over repeating the same explanation in the next session.",
        ],
        executionMode: "parallel",
        parameters: Type.Object({
          text: Type.String({ description: "The fact, preference or instruction to keep" }),
          scope: Type.Optional(Type.String({ description: 'Where it applies: "global" (default) or an absolute project path' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          if (!memoryEnabled()) {
            return { content: [{ type: "text" as const, text: "Error: memory is disabled in Settings" }], details: { kind: "pi-web-memory", action: "remember", ok: false } };
          }
          const scope = params.scope?.trim() ? params.scope.trim() : scopeForCwd(ctx.cwd);
          const entry = addMemory({ text: params.text, scope, source: "agent" });
          if (!entry) {
            return { content: [{ type: "text" as const, text: "Error: text is required" }], details: { kind: "pi-web-memory", action: "remember", ok: false } };
          }
          return {
            content: [{ type: "text" as const, text: `Remembered (${entry.scope}): ${entry.text}` }],
            details: { kind: "pi-web-memory", action: "remember", ok: true, entry },
          };
        },
      }));

      pi.registerTool(defineTool({
        name: "recall",
        label: "Recall",
        description: "Search the saved memory list. Call with no query to see everything that applies to this project.",
        promptSnippet: "Search saved memories",
        executionMode: "parallel",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Words to look for; omit to list all applicable memories" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          if (!memoryEnabled()) {
            return { content: [{ type: "text" as const, text: "Error: memory is disabled in Settings" }], details: { kind: "pi-web-memory", action: "recall", ok: false } };
          }
          const scope = scopeForCwd(ctx.cwd);
          const applicable = listMemory().filter((entry) => entry.scope === "global" || entry.scope === scope);
          const matches = recallMemory(applicable, params.query ?? "", MEMORY_RECALL_LIMIT);
          return {
            content: [{
              type: "text" as const,
              text: matches.length
                ? matches.map((entry) => `- [${entry.scope === "global" ? "global" : "project"}] ${entry.text}`).join("\n")
                : "No matching memories",
            }],
            details: { kind: "pi-web-memory", action: "recall", ok: true, count: matches.length },
          };
        },
      }));

      // Inject the current list on every turn (re-rendered, so mid-session saves apply).
      pi.on("before_agent_start", async (_event, ctx) => {
        if (!memoryEnabled()) return undefined;
        const scope = scopeForCwd(ctx.cwd);
        const entries = listMemory().filter((entry) => entry.scope === "global" || entry.scope === scope);
        const block = renderMemoryBlock(entries, scope);
        if (!block) return undefined;
        return {
          message: {
            customType: "pi-web-memory",
            content: `${block}\n\n(These are saved notes from earlier sessions. Use them when relevant; ignore them when they contradict the current request.)`,
            display: false,
          },
        };
      });
    },
  };
}
