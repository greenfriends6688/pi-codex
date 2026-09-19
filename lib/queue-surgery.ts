/**
 * fork:gap04-queue — 队列逐条操控（撤回 / 删除 / 拖拽排序 / 立即发送）的纯逻辑。
 *
 * ## 为什么不能只改一侧
 *
 * pi 的队列是**两层**的：
 *
 * 1. `AgentSession._steeringMessages` / `_followUpMessages` —— 文本镜像，给 UI 看的
 *    （`agent-session.js` 的 `getSteeringMessages()` 就返回它）；
 * 2. `Agent.steeringQueue` / `followUpQueue`（`PendingMessageQueue`）—— 真正被 drain 的队列。
 *
 * 交付时，SDK 在 `message_start` 里按**文本**从镜像里删掉**第一条**匹配项：
 *
 * ```js
 * const steeringIndex = this._steeringMessages.indexOf(messageText);
 * if (steeringIndex !== -1) this._steeringMessages.splice(steeringIndex, 1);
 * ```
 *
 * 于是：
 * - 只改一层 → 镜像与真队列漂移，之后新入队的同文本消息会被镜像当成“已交付”而提前消失；
 * - 按文本删 → 两条一样的消息永远删到第一条（用户点第二条的 ✕，第一条消失）。
 *
 * 所以这个模块一律**按下标**算增量，并且要求调用方在提交前校验两层一致。
 * 这里不碰任何对象/网络（`QueueState` 就是两个字符串数组），
 * 于是越界、过期、重复文本、跨队列提升这些边界都能用 node:test 直接覆盖。
 */

export type QueueKind = "steer" | "followUp";

export interface QueueState {
  steering: string[];
  followUp: string[];
}

export type QueueOperation =
  /** 从队列里删掉一条。 */
  | { type: "remove"; kind: QueueKind; index: number; expect?: string }
  /** 队列内重排（拖拽）。`to` 是插入位置（按删除后的数组计）。 */
  | { type: "move"; kind: QueueKind; from: number; to: number; expect?: string }
  /** 立即发送：把 followUp 提升为 steer，下一个回合边界就送达，而不是等整轮结束。 */
  | { type: "promote"; index: number; expect?: string };

export type QueueFailureReason = "out-of-range" | "stale";

export interface QueueFailure {
  ok: false;
  reason: QueueFailureReason;
  message: string;
}

export interface QueueSuccess {
  ok: true;
  state: QueueState;
  /** 被操作的那条文本（回执用）。 */
  moved: string;
}

export const QUEUE_KIND_LABELS: Record<QueueKind, string> = {
  steer: "steering",
  followUp: "follow-up",
};

export function queueItems(state: QueueState, kind: QueueKind): string[] {
  return kind === "steer" ? state.steering : state.followUp;
}

/** 两层一致性校验：调用方在提交前用它判断「镜像与真队列是否还同步」。 */
export function sameQueue(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function clone(state: QueueState): QueueState {
  return { steering: [...state.steering], followUp: [...state.followUp] };
}

function fail(reason: QueueFailureReason, message: string): QueueFailure {
  return { ok: false, reason, message };
}

/**
 * 过期检测：UI 传来的下标必须指向它以为的那条文本。
 *
 * 队列随时可能因为交付而前移（另一条消息被 drain 掉），所以「下标 + 文本」一起校验 ——
 * 只校验下标的操作会把误删一条用户没打算删的消息。
 */
function itemAt(items: readonly string[], index: number, expect: string | undefined, kind: QueueKind): string | QueueFailure {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return fail("out-of-range", `${QUEUE_KIND_LABELS[kind]} index ${index} is out of range (0..${items.length - 1})`);
  }
  const value = items[index]!;
  if (expect !== undefined && expect !== value) {
    return fail("stale", `${QUEUE_KIND_LABELS[kind]} index ${index} no longer holds the expected message`);
  }
  return value;
}

export function applyQueueOperation(
  state: QueueState,
  operation: QueueOperation,
): QueueSuccess | QueueFailure {
  const next = clone(state);

  if (operation.type === "remove") {
    const items = queueItems(next, operation.kind);
    const current = itemAt(items, operation.index, operation.expect, operation.kind);
    if (typeof current !== "string") return current;
    items.splice(operation.index, 1);
    return { ok: true, state: next, moved: current };
  }

  if (operation.type === "move") {
    const items = queueItems(next, operation.kind);
    const current = itemAt(items, operation.from, operation.expect, operation.kind);
    if (typeof current !== "string") return current;
    // `to` 允许等于 items.length（拖到末尾）；删除后数组短了一位，所以用 >= 收敛。
    if (!Number.isInteger(operation.to) || operation.to < 0 || operation.to > items.length) {
      return fail("out-of-range", `${QUEUE_KIND_LABELS[operation.kind]} target ${operation.to} is out of range (0..${items.length})`);
    }
    items.splice(operation.from, 1);
    const target = operation.to > operation.from ? operation.to - 1 : operation.to;
    items.splice(target, 0, current);
    return { ok: true, state: next, moved: current };
  }

  const followUp = next.followUp;
  const current = itemAt(followUp, operation.index, operation.expect, "followUp");
  if (typeof current !== "string") return current;
  followUp.splice(operation.index, 1);
  // 提升到 steering 的**队首**：下一个回合边界就送达（steering 的语义），
  // 而不是排在本轮已经入队的 steer 后面等更久。
  next.steering.unshift(current);
  return { ok: true, state: next, moved: current };
}

/** 一次入队的文本是否已经在队列里（UI 用来给出「已排队」提示，不参与增删）。 */
export function queueContains(state: QueueState, text: string): boolean {
  return state.steering.includes(text) || state.followUp.includes(text);
}
