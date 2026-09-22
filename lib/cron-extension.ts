import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  APPROVAL_CHOICES,
  addGrant,
  grantMatches,
  grantTargetFor,
  parseApprovalChoice,
  summarizeApprovalInput,
  TOOL_GRANTS_ENTRY_TYPE,
  type PermissionModeName,
  type ToolGrant,
} from "./approval-policy";
import { readToolGrants } from "./approval-extension";
import { sessionDayKey } from "./cron-lifecycle";
import { isKnownTimezone } from "./cron-timezone";
import {
  deleteCronTask,
  findCronTask,
  getCronConfigPath,
  listCronTasks,
  normalizeSchedule,
  normalizeTask,
  upsertCronTask,
} from "./cron-store";
import type { CronSchedule, CronTask } from "./cron-schedule";
import { isScheduledCronRunSession } from "./cron-runner";

/**
 * fork:zc-21 — the agent's own scheduled-task tools (`CronCreate`, `CronList`,
 * `CronUpdate`, `CronDelete`), registered as an inline extension.
 *
 * WHY an extension rather than a new API surface: the session runtime already
 * gives a tool everything the store needs — the real session id, the working
 * directory, and the active model — so the agent can say "remind me tomorrow at
 * nine" without any of those becoming model-supplied arguments. Four rules from
 * the reference are enforced here:
 *
 *   1. Writes need approval, reads do not. In bypass mode this extension asks
 *      itself (blocking `tool_call`); in ask/plan the house approval gate in
 *      `approval-extension.ts` does it, and a read is pre-granted so it never asks
 *      about `CronList`.
 *   2. Identity is injected by the runtime. `cwd`, `sessionId` and the model come
 *      from the `ExtensionContext`, never from tool arguments, and the created
 *      task is bound to the current session (`sessionMode: "reuse"`).
 *   3. Update surface is narrow. `CronUpdate` may change name/prompt/cron/end
 *      date/timezone/maxRuns only — never cwd, session binding, model, enabled
 *      state, run count or history.
 *   4. Recursion guard. A turn that *is* a scheduled run cannot create, update or
 *      delete tasks, which stops a scheduled prompt from replicating itself.
 */

export const HOST_CRON_EXTENSION_NAME = "pi-web-cron";

export const CRON_TOOL_NAMES = {
  list: "CronList",
  create: "CronCreate",
  update: "CronUpdate",
  delete: "CronDelete",
} as const;

/** Anything the agent can use to change the store. */
export const CRON_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  CRON_TOOL_NAMES.create,
  CRON_TOOL_NAMES.update,
  CRON_TOOL_NAMES.delete,
]);

export type CronClock = () => Date;

export interface CronExtensionOptions {
  /** Session permission mode; only `bypass` runs this extension's own gate. */
  getApprovalMode?: () => PermissionModeName;
  /** True while this session is executing a scheduled run (recursion guard). */
  isScheduledRun?: (sessionId: string) => boolean;
  /** Clock seam. */
  now?: CronClock;
  /** Store file seam (tests); defaults to `~/.pi/agent/pi-web-cron.json`. */
  storeFile?: string | (() => string);
  /** Id seam (tests). */
  randomId?: () => string;
}

// ---------------------------------------------------------------------------
// Identity + pure store operations (exported so they are unit-testable without
// a live ExtensionContext).
// ---------------------------------------------------------------------------

export interface CronAgentIdentity {
  cwd: string;
  sessionId: string;
  model?: { provider: string; modelId: string };
}

export interface CronCreateArgs {
  prompt: string;
  name?: string;
  /** 5-field cron expression (the only runtime schedule format). */
  expression: string;
  /** Inclusive last day ("YYYY-MM-DD"). */
  endDate?: string;
  /** IANA zone; omitted means the host zone. */
  timezone?: string;
  /** Stop after this many runs. */
  maxRuns?: number;
}

/**
 * Build a task from agent arguments + runtime identity. Throws on invalid input
 * rather than guessing; the tool result then explains what was wrong.
 */
export function buildCronTaskFromAgent(
  args: CronCreateArgs,
  identity: CronAgentIdentity,
  now: Date,
  id: string,
): CronTask {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) throw new Error("prompt is required");
  const expression = typeof args.expression === "string" ? args.expression.trim().replace(/\s+/g, " ") : "";
  if (!expression) throw new Error("expression is required (a 5-field cron expression)");
  // Validate the zone before Intl sees it: `sessionDayKey` would otherwise throw
  // a raw RangeError instead of the tool explaining the bad argument.
  if (args.timezone && !isKnownTimezone(args.timezone)) throw new Error(`unknown timezone: "${args.timezone}"`);

  const schedule: CronSchedule = { kind: "cron", times: [], expression };
  if (args.endDate) schedule.endDate = args.endDate;
  if (args.timezone) schedule.timezone = args.timezone;

  const task = normalizeTask({
    id,
    name: args.name,
    prompt,
    // fork:zc-21 — identity comes from the runtime, not the model.
    cwd: identity.cwd,
    enabled: true,
    createdAt: now.toISOString(),
    runCount: 0,
    ...(Number.isFinite(args.maxRuns) && (args.maxRuns ?? 0) > 0 ? { maxRuns: Math.floor(args.maxRuns as number) } : {}),
    // The scheduled run returns to the session that created the task.
    sessionMode: "reuse",
    reusableSessionId: identity.sessionId,
    reusableSessionDayKey: sessionDayKey(now, args.timezone),
    ...(identity.model ? { model: identity.model } : {}),
    schedule,
  });
  if (!task) throw new Error("invalid scheduled task: check the cron expression, end date and timezone");
  if (args.timezone && !task.schedule.timezone) throw new Error(`unknown timezone: "${args.timezone}"`);
  if (args.endDate && !task.schedule.endDate) throw new Error(`endDate must be a real YYYY-MM-DD date: "${args.endDate}"`);
  return task;
}

export interface CronUpdateArgs {
  id: string;
  name?: string;
  prompt?: string;
  expression?: string;
  /** Empty string clears the end date. */
  endDate?: string;
  /** Empty string clears the zone (back to host). */
  timezone?: string;
  /** 0 clears the run limit. */
  maxRuns?: number;
}

function mergeSchedule(existing: CronTask, args: CronUpdateArgs): CronSchedule | null {
  const touchesSchedule = typeof args.expression === "string" || typeof args.endDate === "string" || typeof args.timezone === "string";
  if (!touchesSchedule) return null;
  if (existing.schedule.kind !== "cron") {
    throw new Error("only tasks created from a cron expression can be updated through CronUpdate");
  }
  const expression = typeof args.expression === "string" && args.expression.trim()
    ? args.expression.trim().replace(/\s+/g, " ")
    : existing.schedule.expression ?? "";
  if (!expression) throw new Error("this task has no cron expression to update");

  const input: Record<string, unknown> = {
    kind: "cron",
    times: [],
    expression,
    ...(existing.schedule.timezone ? { timezone: existing.schedule.timezone } : {}),
    ...(existing.schedule.idleWindow ? { idleWindow: existing.schedule.idleWindow } : {}),
    ...(existing.schedule.endDate ? { endDate: existing.schedule.endDate } : {}),
  };
  if (typeof args.endDate === "string") {
    if (args.endDate) input.endDate = args.endDate;
    else delete input.endDate;
  }
  if (typeof args.timezone === "string") {
    if (args.timezone) input.timezone = args.timezone;
    else delete input.timezone;
  }
  const schedule = normalizeSchedule(input);
  if (!schedule) throw new Error("invalid schedule update: check the cron expression, end date and timezone");
  if (args.endDate && !schedule.endDate) throw new Error(`endDate must be a real YYYY-MM-DD date: "${args.endDate}"`);
  if (args.timezone && !schedule.timezone) throw new Error(`unknown timezone: "${args.timezone}"`);
  return schedule;
}

/**
 * Apply only the narrow, allowed update surface. Every other field (workspace,
 * session binding, model, enabled, run count, history, heartbeat, retry state)
 * is carried over from `existing` — extra keys on `args` are ignored, not merged.
 */
export function applyCronUpdate(existing: CronTask, args: CronUpdateArgs): CronTask {
  const schedule = mergeSchedule(existing, args);
  const patch: Partial<CronTask> = {
    id: existing.id,
    createdAt: existing.createdAt,
    ...(typeof args.name === "string" && args.name.trim() ? { name: args.name.trim() } : {}),
    ...(typeof args.prompt === "string" && args.prompt.trim() ? { prompt: args.prompt.trim() } : {}),
    ...(schedule ? { schedule } : {}),
    ...(typeof args.maxRuns === "number"
      ? (args.maxRuns > 0 ? { maxRuns: Math.floor(args.maxRuns) } : { maxRuns: undefined })
      : {}),
  };
  const merged = normalizeTask({ ...existing, ...patch });
  if (!merged) throw new Error("invalid scheduled task update");
  return merged;
}

// ---------------------------------------------------------------------------
// Approval (pure decision + the runtime prompt)
// ---------------------------------------------------------------------------

export interface CronApprovalInput {
  toolName: string;
  input: Record<string, unknown> | undefined;
  mode: PermissionModeName;
  hasUI: boolean;
  grants: readonly ToolGrant[];
  scheduledRun: boolean;
}

export type CronApprovalDecision =
  | { action: "allow" }
  | { action: "ask"; summary: string }
  | { action: "block"; reason: string };

/**
 * The cron-specific approval policy. Reads are always allowed; writes are
 * blocked during a scheduled run; ask/plan defers to the shared approval
 * extension (which sees the write tools as unclassified and asks); bypass mode
 * asks here, honouring the session's "always allow" grants.
 */
export function decideCronApproval(input: CronApprovalInput): CronApprovalDecision {
  if (!CRON_WRITE_TOOL_NAMES.has(input.toolName)) return { action: "allow" };
  if (input.scheduledRun) {
    return { action: "block", reason: "定时运行中不能创建、修改或删除定时任务（防止自我复制）" };
  }
  if (input.mode !== "bypass") return { action: "allow" };
  const subject = { toolName: input.toolName, input: input.input };
  if (input.grants.some((grant) => grantMatches(grant, subject))) return { action: "allow" };
  if (!input.hasUI) return { action: "block", reason: "需要用户确认，但当前没有可用的交互界面" };
  return { action: "ask", summary: summarizeApprovalInput(input.toolName, input.input) };
}

function cronApprovalPrompt(toolName: string, summary: string): string {
  const verb = toolName === CRON_TOOL_NAMES.create ? "创建" : toolName === CRON_TOOL_NAMES.update ? "修改" : "删除";
  return [
    `需要确认：agent 想${verb}定时任务`,
    "",
    summary ? `${toolName}：${summary}` : toolName,
  ].join("\n");
}

function safeSessionId(ctx: ExtensionContext): string {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return "";
  }
}

function identityFromContext(ctx: ExtensionContext): CronAgentIdentity {
  return {
    cwd: ctx.cwd,
    sessionId: safeSessionId(ctx),
    ...(ctx.model ? { model: { provider: String(ctx.model.provider), modelId: ctx.model.id } } : {}),
  };
}

function cronTaskView(task: ReturnType<typeof listCronTasks>[number]) {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    schedule: task.schedule,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt ?? null,
    lastStatus: task.lastStatus ?? null,
    retryAt: task.retryAt ?? null,
    runCount: task.runCount,
    sessionMode: task.sessionMode ?? "new",
    recentRuns: (task.history ?? []).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export function createCronExtension(options: CronExtensionOptions = {}): InlineExtension {
  const clock: CronClock = options.now ?? (() => new Date());
  const file = () => (typeof options.storeFile === "function" ? options.storeFile() : options.storeFile ?? getCronConfigPath());
  const isScheduledRun = options.isScheduledRun ?? isScheduledCronRunSession;
  const approvalMode = options.getApprovalMode ?? (() => "bypass" as PermissionModeName);
  const randomId = options.randomId ?? (() => randomUUID());

  return {
    name: HOST_CRON_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let grants: ToolGrant[] = [];

      const reconstruct = (ctx: ExtensionContext) => {
        grants = readToolGrants(ctx.sessionManager.getBranch() as unknown[]);
      };
      pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

      const assertNotScheduledRun = (ctx: ExtensionContext, toolName: string) => {
        if (isScheduledRun(safeSessionId(ctx))) {
          throw new Error(`${toolName} is not allowed while running a scheduled task`);
        }
      };

      pi.on("tool_call", async (event, ctx) => {
        const input = (event.input ?? {}) as Record<string, unknown>;
        const toolName = event.toolName;

        // fork:zc-21 — reads never raise an approval card. In ask/plan the house
        // gate would otherwise ask about an unknown tool, so the read is
        // pre-granted in the session before that gate runs.
        if (toolName === CRON_TOOL_NAMES.list) {
          if (approvalMode() !== "bypass" && !grants.some((grant) => grant.toolName === CRON_TOOL_NAMES.list)) {
            grants = addGrant(grants, { toolName: CRON_TOOL_NAMES.list, target: "" });
            try {
              pi.appendEntry(TOOL_GRANTS_ENTRY_TYPE, { version: 1, grants });
            } catch (error) {
              console.error("[pi-web] failed to persist the CronList read grant:", error instanceof Error ? error.message : error);
            }
          }
          return undefined;
        }
        if (!CRON_WRITE_TOOL_NAMES.has(toolName)) return undefined;

        const decision = decideCronApproval({
          toolName,
          input,
          mode: approvalMode(),
          hasUI: ctx.hasUI,
          grants,
          scheduledRun: isScheduledRun(safeSessionId(ctx)),
        });
        if (decision.action === "block") return { block: true, reason: decision.reason };
        if (decision.action === "allow") return undefined;

        let selected: string | null | undefined;
        try {
          selected = await ctx.ui.select(cronApprovalPrompt(toolName, decision.summary), [...APPROVAL_CHOICES]);
        } catch {
          return { block: true, reason: "审批未获答复，已按拒绝处理" };
        }
        const choice = parseApprovalChoice(selected);
        if (choice === "deny") return { block: true, reason: "用户拒绝了这次工具调用" };
        if (choice === "allow-session") {
          grants = addGrant(grants, { toolName, target: grantTargetFor({ toolName, input }) });
          try {
            pi.appendEntry(TOOL_GRANTS_ENTRY_TYPE, { version: 1, grants });
          } catch (error) {
            console.error("[pi-web] failed to persist the cron tool grant:", error instanceof Error ? error.message : error);
          }
        }
        return undefined;
      });

      pi.registerTool(defineTool({
        name: CRON_TOOL_NAMES.list,
        label: "Cron List",
        description: "List scheduled tasks (id, name, cron schedule, enabled state, next run, last status). Read-only.",
        promptSnippet: "List the scheduled tasks",
        promptGuidelines: [
          "Call CronList before CronUpdate or CronDelete so you use a real task id; never guess one.",
        ],
        executionMode: "parallel",
        parameters: Type.Object({}),
        async execute() {
          const now = clock();
          const tasks = listCronTasks(now, file()).map((task) => cronTaskView(task));
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ tasks }, null, 2) }],
            details: { kind: "pi-web-cron-list", tasks },
          };
        },
      }));

      pi.registerTool(defineTool({
        name: CRON_TOOL_NAMES.create,
        label: "Cron Create",
        description: [
          "Create a scheduled task that runs a prompt later. Use it only when the user explicitly asks to schedule future automatic work.",
          "The task runs in the session that created it. The working directory and model are taken from the current session; do not pass them.",
          "Give a standard 5-field cron expression in the user's local timezone: minute hour day-of-month month day-of-week.",
          "Examples: '*/20 * * * *' every 20 minutes, '0 * * * *' hourly, '0 9 * * 1-5' weekdays at 09:00, '30 8 1 * *' the first of the month.",
        ].join("\n"),
        promptSnippet: "Create a scheduled task",
        promptGuidelines: [
          "Write the scheduled prompt as a complete instruction that can run later without the surrounding conversation.",
          "Never schedule a task whose prompt asks to create, modify or delete other scheduled tasks; scheduled runs cannot do that.",
          "Use CronList when you need the current tasks; use maxRuns for a finite number of runs.",
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: "The instruction the scheduled run should carry out." }),
          expression: Type.String({ description: "5-field cron expression in the user's local timezone." }),
          name: Type.Optional(Type.String({ description: "Short human-readable title." })),
          endDate: Type.Optional(Type.String({ description: "Inclusive last day, YYYY-MM-DD." })),
          timezone: Type.Optional(Type.String({ description: "IANA timezone; omit for the host zone." })),
          maxRuns: Type.Optional(Type.Number({ description: "Stop after this many runs." })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          assertNotScheduledRun(ctx, CRON_TOOL_NAMES.create);
          const task = buildCronTaskFromAgent(params, identityFromContext(ctx), clock(), randomId());
          upsertCronTask(task, file());
          return {
            content: [{
              type: "text" as const,
              text: `Created scheduled task ${task.id} ("${task.name}") with cron expression "${task.schedule.expression}". It will run in this session.`,
            }],
            details: { kind: "pi-web-cron-task", task },
          };
        },
      }));

      pi.registerTool(defineTool({
        name: CRON_TOOL_NAMES.update,
        label: "Cron Update",
        description: [
          "Update an existing scheduled task by id.",
          "Only the schedule, name, prompt and run limit can change. The working directory, session binding, model, enabled state and run history are preserved.",
          "Omitted fields keep their current values.",
        ].join("\n"),
        promptSnippet: "Update a scheduled task",
        promptGuidelines: [
          "Call CronList first to get the real task id.",
          "Only pass fields the user asked to change; do not delete and recreate a task to simulate an update.",
        ],
        parameters: Type.Object({
          id: Type.String({ description: "Task id from CronList." }),
          name: Type.Optional(Type.String()),
          prompt: Type.Optional(Type.String()),
          expression: Type.Optional(Type.String({ description: "Replacement 5-field cron expression." })),
          endDate: Type.Optional(Type.String({ description: "New inclusive end date; empty string clears it." })),
          timezone: Type.Optional(Type.String({ description: "New IANA timezone; empty string clears it." })),
          maxRuns: Type.Optional(Type.Number({ description: "New run limit; 0 clears it." })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          assertNotScheduledRun(ctx, CRON_TOOL_NAMES.update);
          const existing = findCronTask(params.id, file());
          if (!existing) throw new Error(`scheduled task not found: ${params.id}`);
          const updated = applyCronUpdate(existing, params);
          upsertCronTask(updated, file());
          return {
            content: [{ type: "text" as const, text: `Updated scheduled task ${updated.id} ("${updated.name}").` }],
            details: { kind: "pi-web-cron-task", task: updated },
          };
        },
      }));

      pi.registerTool(defineTool({
        name: CRON_TOOL_NAMES.delete,
        label: "Cron Delete",
        description: "Delete a scheduled task by id. Its run history is removed with it.",
        promptSnippet: "Delete a scheduled task",
        parameters: Type.Object({
          id: Type.String({ description: "Task id from CronList." }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          assertNotScheduledRun(ctx, CRON_TOOL_NAMES.delete);
          const deleted = deleteCronTask(params.id, file());
          return {
            content: [{
              type: "text" as const,
              text: deleted ? `Deleted scheduled task ${params.id}.` : `Scheduled task ${params.id} was not found.`,
            }],
            details: { kind: "pi-web-cron-delete", id: params.id, deleted },
          };
        },
      }));
    },
  };
}
