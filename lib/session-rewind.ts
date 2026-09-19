/**
 * fork:proma-04-rewind — 会话回退（rewind）的**语义层**。
 *
 * 「回退到此处」= 把会话文件截断到指定条目（**含**该条），它之后的所有对话消失。
 * 对齐 Proma 的 rewind 契约（`agent-session-manager.ts:932-1030, 1118-1145`）：
 *
 * - **按 entryId 定位、含该条截断**：定位用会话文件里的 `id`（每条 entry 都有），
 *   不是按消息序号 —— 序号会随分支/压缩变化，entryId 才是稳定的。
 * - **文件回退明确不支持**：Proma 的 rewind 也不回退磁盘上的文件改动（正常返回，
 *   而不是报错）。所以这里不碰工作区，只在返回里说明这一点，避免用户以为代码也回滚了。
 * - **严格解析**：任何一行不是合法 JSON，直接拒绝。宁可不回退，也不要把读不懂的
 *   会话文件重写一遍 —— 那是唯一可能永久丢数据的操作。
 * - **原子写**：复用 `lib/atomic-file.ts` 的 `writePrivateFileAtomicSync`（临时文件 + rename）。
 *
 * 纯函数（planRewind）与薄 IO（rewindSessionFile）分开，前者可单测。
 */

import { readFileSync } from "node:fs";
import { writePrivateFileAtomicSync } from "./atomic-file";

export type RewindRefusalReason = "entry-not-found" | "invalid-jsonl" | "nothing-to-drop" | "empty-file";

export interface RewindPlan {
  /** 保留的行（含目标条目）。 */
  kept: string[];
  /** 被截断掉的行数。 */
  dropped: number;
  /** 目标条目的类型，供回执显示（例如停在一条 user 消息上）。 */
  entryType?: string;
}

export type RewindPlanResult =
  | { ok: true; plan: RewindPlan }
  | { ok: false; reason: RewindRefusalReason; message: string };

export interface RewindResult {
  ok: boolean;
  reason?: RewindRefusalReason;
  message?: string;
  dropped?: number;
  kept?: number;
  entryType?: string;
  /** 明确告知调用方：磁盘上的文件改动**不会**被回退。 */
  filesReverted: false;
}

const REFUSAL_MESSAGES: Record<RewindRefusalReason, string> = {
  "empty-file": "这个会话文件是空的，无法回退",
  "invalid-jsonl": "会话文件里有无法解析的行，为保证不丢数据，已拒绝回退",
  "entry-not-found": "找不到这条消息对应的记录（可能已被压缩或来自更早的版本）",
  "nothing-to-drop": "这已经是最后一条消息，没有可回退的内容",
};

function refuse(reason: RewindRefusalReason): RewindPlanResult {
  return { ok: false, reason, message: REFUSAL_MESSAGES[reason] };
}

/**
 * 规划一次回退：算出保留哪些行。
 *
 * 第 0 行是 `type: "session"` 的头部（会话元数据），**永远保留** ——
 * 它不带 `id`，也不该参与匹配。
 */
export function planRewind(lines: readonly string[], entryId: string): RewindPlanResult {
  const trimmed = lines.filter((line) => line.trim().length > 0);
  if (trimmed.length === 0) return refuse("empty-file");

  let targetIndex = -1;
  let targetType: string | undefined;
  // 严格解析**整个文件**，找到目标也不提前 break：
  // 只要有一行读不懂，就说明我们对这份文件的理解不完整，宁可什么都不做。
  for (let index = 1; index < trimmed.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed[index]!);
    } catch {
      return refuse("invalid-jsonl");
    }
    const entry = parsed as { id?: unknown; type?: unknown };
    if (targetIndex === -1 && entry && typeof entry.id === "string" && entry.id === entryId) {
      targetIndex = index;
      targetType = typeof entry.type === "string" ? entry.type : undefined;
    }
  }
  if (targetIndex === -1) return refuse("entry-not-found");
  if (targetIndex === trimmed.length - 1) return refuse("nothing-to-drop");

  return {
    ok: true,
    plan: {
      kept: trimmed.slice(0, targetIndex + 1),
      dropped: trimmed.length - targetIndex - 1,
      ...(targetType ? { entryType: targetType } : {}),
    },
  };
}

/**
 * 执行回退：读文件 → 规划 → 原子写回。
 *
 * 只在 `planRewind` 成功时才写文件；写入是原子的（临时文件 + rename），
 * 所以「写一半失败」不会留下半个会话。
 */
export function rewindSessionFile(filePath: string, entryId: string): RewindResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: "empty-file",
      message: error instanceof Error ? error.message : String(error),
      filesReverted: false,
    };
  }

  const result = planRewind(raw.split("\n"), entryId);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message, filesReverted: false };

  // 保留原文件末尾的换行风格（会话文件每行一条，最后一行带换行）
  writePrivateFileAtomicSync(filePath, `${result.plan.kept.join("\n")}\n`);

  return {
    ok: true,
    dropped: result.plan.dropped,
    kept: result.plan.kept.length,
    ...(result.plan.entryType ? { entryType: result.plan.entryType } : {}),
    filesReverted: false,
  };
}

/** 回退后的用户提示（把「文件没被回退」这条明确说出来，避免误解）。 */
export function rewindSummary(result: RewindResult, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!result.ok) return result.message ?? t("rewind.failed");
  return t("rewind.done", { count: result.dropped ?? 0 });
}
