/**
 * fork:proma-03-plan — 计划模式的**语义层**（纯函数）。
 *
 * 计划档的约束只有一条原则：**只允许能证明是只读的动作**。
 *
 * 参考实现（官方 `examples/extensions/plan-mode/`）的做法是两份列表：一份工具白名单
 * （`read/bash/grep/find/ls`）、一份 bash 只读命令白名单（它的 `utils.ts:isSafeCommand`）。
 * 本仓不这么干 —— PROMA-01 已经有分类器（`lib/approval-policy.ts` 的 `READ_ONLY_TOOLS`
 * 与 `READ_ONLY_RULES`），这里直接复用。两份白名单一定会漂移，而漂移的方向通常是
 * 「看起来放行、实际放行了一个写操作」，那是这个功能最不该出的错。
 *
 * 于是判定就是：read-only 工具 → 放行；bash 类 → 命令必须命中只读白名单；其余 → 拦。
 * 拦下来的理由要写给模型看（它会据此改成先出计划），所以文案是给模型的一句话。
 */

import { commandOf, decideApproval, type PermissionModeName } from "./approval-policy";

export interface PlanModeDecision {
  allowed: boolean;
  /** 拦下来的原因（写给模型看的一句话）。 */
  reason?: string;
}

/** 计划模式追加到 system prompt 的指令（对齐官方示例的 "present a plan first"）。 */
export const PLAN_MODE_SYSTEM_PROMPT = [
  "## 计划模式（只读）",
  "",
  "你当前处于**计划模式**：只允许只读动作（读文件、搜索、列目录、以及只读的 shell 命令）。",
  "写文件、改文件、以及任何有副作用的命令都会被系统拦住。",
  "",
  "请先用只读手段把情况摸清，然后**用编号列表给出计划**，每步一句话、写清要改哪个文件。",
  "用户确认后会自动切回可执行档位，那时再动手。",
].join("\n");

/**
 * 计划档下的单次判定。
 *
 * 复用 `decideApproval` 的 `read-only` 档作为唯一依据：它已经覆盖了工具级白名单
 * （read/grep/ls…）与命令级白名单（`git status`、`ls`、`cat`…）。判成 `read-only`
 * 才放行，其余（含 unknown）一律拦 —— 计划模式宁可拦多，因为它承诺的是"只调研"。
 */
export function decidePlanModeToolCall(toolName: string, input: Record<string, unknown> | undefined): PlanModeDecision {
  const decision = decideApproval({ mode: "ask" satisfies PermissionModeName, toolName, input });
  if (decision.tier === "read-only") return { allowed: true };

  const command = commandOf(input);
  const what = command
    ? `命令：${decision.summary || command}`
    : `工具：${toolName}`;
  return {
    allowed: false,
    reason: [
      `计划模式下不允许执行这个动作（${what}）。`,
      "请改用只读手段（读文件 / 搜索 / 只读命令）继续调研，然后把计划用编号列表写出来。",
    ].join(""),
  };
}

/** 计划模式是否生效（模式名到布尔的唯一映射，避免各处各写一遍）。 */
export function isPlanMode(mode: PermissionModeName): boolean {
  return mode === "plan";
}
