/**
 * fork:proma-06-delegation — 子会话**阻塞冒泡**的语义层（纯函数，可单测）。
 *
 * 问题：子会话（`Agent` 工具起的那个）遇到需要人回答的事 —— 审批卡、提问 —— 时，请求是发在
 * **它自己**的会话事件流里的。父会话的 UI 只看父会话的流，于是这些请求**谁都看不到**：子会话
 * 就那么卡住（`extension_ui_request` 一直挂着），用户以为它还在跑。
 *
 * 做法：子会话运行时把它的事件里「等人回答」的那些**打上标记转发给父会话**；父会话复用既有的
 * 扩展对话框渲染（同一套 UI，不新造卡片），作答时把回执发回**子会话**（不是父会话）。
 *
 * 这个模块只做判断与整形，不碰 IO，也不管谁订阅谁 —— 接线在 `lib/subagent-runtime.ts`（转发）
 * 与 `lib/rpc-manager.ts`（注入父会话事件流）、客户端在 `hooks/useAgentSession.ts`。
 */

/** 转发到父会话时用的合成事件类型（不是 SDK 的事件类型，是我们自己加的）。 */
export const SUBAGENT_UI_REQUEST_EVENT = "subagent_ui_request";

/**
 * 需要**人回答**的方法才冒泡。`notify` / `setStatus` / `setWidget` 是通知性质的，
 * 冒泡只会把父会话刷屏，而且它们本来就不阻塞子会话。
 */
export const BLOCKING_UI_METHODS: readonly string[] = ["select", "confirm", "input", "editor", "custom"];

export interface SubagentUiRequestLike {
  type?: string;
  id?: unknown;
  method?: unknown;
  title?: unknown;
}

export interface SubagentUiBubble {
  type: typeof SUBAGENT_UI_REQUEST_EVENT;
  /** 需要回答的那条子会话（作答要发回它）。 */
  subagentSessionId: string;
  parentSessionId: string;
  /** 原请求的 id：作答回执靠它配对。 */
  requestId: string;
  method: string;
  title: string;
  /** 子会话的展示名（profile / description），没有就是空串。 */
  label: string;
  /** 原始请求原样带上，客户端复用既有对话框渲染。 */
  request: Record<string, unknown>;
}

/** 这个事件该不该冒泡（等人回答的 UI 请求才冒泡）。 */
export function shouldBubbleUiRequest(event: SubagentUiRequestLike | null | undefined): boolean {
  if (!event || event.type !== "extension_ui_request") return false;
  if (typeof event.id !== "string" || event.id.length === 0) return false;
  return typeof event.method === "string" && BLOCKING_UI_METHODS.includes(event.method);
}

/**
 * 把子会话的 UI 请求整形成冒泡事件。不满足条件返回 null（调用方据此跳过）。
 * `requestId` 直接沿用原 id：这样重复投递、父会话重连都能去重。
 */
export function toSubagentUiBubble(
  event: SubagentUiRequestLike | null | undefined,
  context: { subagentSessionId: string; parentSessionId: string; label?: string },
): SubagentUiBubble | null {
  if (!shouldBubbleUiRequest(event)) return null;
  const source = event as Record<string, unknown>;
  return {
    type: SUBAGENT_UI_REQUEST_EVENT,
    subagentSessionId: context.subagentSessionId,
    parentSessionId: context.parentSessionId,
    requestId: String(event!.id),
    method: String(event!.method),
    title: typeof event!.title === "string" ? event!.title : "",
    label: context.label?.replace(/\s+/g, " ").trim() ?? "",
    request: source,
  };
}

/** 作答回执要发去**子会话**——发错到父会话等于没回答，子会话会一直挂着。 */
export function toSubagentUiResponse(
  bubble: SubagentUiBubble,
  payload: Record<string, unknown> = {},
): { sessionId: string; command: Record<string, unknown> } {
  return {
    sessionId: bubble.subagentSessionId,
    command: { type: "extension_ui_response", id: bubble.requestId, ...payload },
  };
}

/**
 * 同一个 `requestId` 只保留一条（按出现顺序）。父会话重连、重复转发时不重复弹卡；
 * 也顺带把已经答过的（不在列表里的）自然淘汰。
 */
export function dedupeBubbles(bubbles: readonly SubagentUiBubble[]): SubagentUiBubble[] {
  const seen = new Set<string>();
  const merged: SubagentUiBubble[] = [];
  for (const bubble of bubbles) {
    if (seen.has(bubble.requestId)) continue;
    seen.add(bubble.requestId);
    merged.push(bubble);
  }
  return merged;
}

/** 从「父会话持有的待答列表」里摘掉一条（答完就撤）。 */
export function withoutBubble(bubbles: readonly SubagentUiBubble[], requestId: string): SubagentUiBubble[] {
  return bubbles.filter((bubble) => bubble.requestId !== requestId);
}
