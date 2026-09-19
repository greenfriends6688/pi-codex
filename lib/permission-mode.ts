/**
 * fork:proma-02-mode — 会话级权限模式（全自动 / 需审批 / 计划）。
 *
 * 三档语义（对齐 Proma 的 `agent-orchestrator.ts:1138-1142`）：
 *
 * | 档位 | 行为 |
 * | --- | --- |
 * | `bypass`（**默认**） | 全自动，等同改动前：工具调用一律放行 |
 * | `ask` | 非只读调用弹审批卡（见 `lib/approval-policy.ts` 的判定链） |
 * | `plan` | 计划档。PROMA-03 落地前它按**最严格的审批档**走（绝不比 ask 更松） |
 *
 * ## 为什么必须是会话级 custom entry，而不是 localStorage
 *
 * 模式要跟着会话走：换浏览器、换机器、把会话文件拷到别处，打开时模式都得还在。
 * localStorage 只描述「这台机器的这个浏览器」，会话文件才是会话状态的载体 ——
 * 所以这里与 `lib/session-tool-selection.ts` 用**同一套**写入模式
 * （`sessionManager.appendCustomEntry`，读回时后写覆盖先写、分支回退跟着回退）。
 *
 * 纯数据模块（除 append 那个薄封装外）：可单测。
 */

import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const PERMISSION_MODES = ["bypass", "ask", "plan"] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];

/** 缺省即现状：不选任何档位时行为与改动前完全一致。 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "bypass";

export const PERMISSION_MODE_ENTRY_TYPE = "pi-web:permission-mode";

export interface PermissionModeEntry {
  version: 1;
  mode: PermissionMode;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function isPermissionModeEntry(value: unknown): value is PermissionModeEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PermissionModeEntry>;
  return entry.version === 1 && isPermissionMode(entry.mode);
}

/**
 * 从条目里读回模式：**后写的覆盖先写的**（会话中途切过档就取最后一次），
 * 没有任何条目或数据畸形时回退默认档（而不是抛错，避免一个坏条目让会话打不开）。
 */
export function readPermissionMode(entries: readonly unknown[]): PermissionMode {
  let mode: PermissionMode | null = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (candidate.type !== "custom" || candidate.customType !== PERMISSION_MODE_ENTRY_TYPE) continue;
    if (!isPermissionModeEntry(candidate.data)) continue;
    mode = candidate.data.mode;
  }
  return mode ?? DEFAULT_PERMISSION_MODE;
}

/** 写入模式（与 `appendSessionToolSelection` 同款：一条 custom entry）。 */
export function appendPermissionMode(sessionManager: SessionManager, mode: PermissionMode): void {
  sessionManager.appendCustomEntry(PERMISSION_MODE_ENTRY_TYPE, {
    version: 1,
    mode: isPermissionMode(mode) ? mode : DEFAULT_PERMISSION_MODE,
  });
}

/**
 * 把权限模式折成审批引擎看得懂的档位。
 *
 * `plan` 在 PROMA-03 落地前等价于 `ask` —— 有意如此：一个刚被选中的档位如果要等下一个
 * 补丁才有约束力，用户会以为自己已经受保护了。宁可更严（多问几次），不可更松。
 */
export function approvalModeFor(mode: PermissionMode): "bypass" | "ask" {
  return mode === "bypass" ? "bypass" : "ask";
}

/**
 * fork:proma-03-plan — 计划档下审批引擎**不需要**再问：`lib/plan-mode.ts` 已经把
 * 写动作全拦了，剩下的只读动作本来就不会触发审批。两处都拦会在同一个动作上弹两次卡。
 */
export function approvalModeForPlanAwareMode(mode: PermissionMode): "bypass" | "ask" {
  if (mode === "bypass") return "bypass";
  if (mode === "plan") return "bypass";
  return "ask";
}

/** i18n 键（三档的显示名与说明）。 */
export const PERMISSION_MODE_LABEL_KEYS: Record<PermissionMode, string> = {
  bypass: "permission.modeBypass",
  ask: "permission.modeAsk",
  plan: "permission.modePlan",
};

export const PERMISSION_MODE_HINT_KEYS: Record<PermissionMode, string> = {
  bypass: "permission.modeBypassHint",
  ask: "permission.modeAskHint",
  plan: "permission.modePlanHint",
};

/** 循环切换（控件行是一个按钮，点一下换下一档）。 */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const index = PERMISSION_MODES.indexOf(mode);
  return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length]!;
}
