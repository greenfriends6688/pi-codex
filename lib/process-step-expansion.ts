/**
 * fork:step-expansion — 时间线上「哪几类步骤默认展开」。
 *
 * 时间线把一轮里的推理、命令、工具调用压成一行行步骤，点行头才展开细节。
 * 哪一类值得默认摊开因人而异（有人只想看命令输出，有人只想看推理），所以做成
 * 三档开关而不是写死。默认沿用改动前的行为：只有推理默认展开。
 *
 * 存 localStorage，和 `pi-thinking-expanded` 同一套路；改完广播事件，让已经挂载的
 * 时间线立刻跟着变（否则要等下一次重渲染才生效）。
 */

export type StepCategory = "reasoning" | "command" | "tool";

export const STEP_CATEGORIES: readonly StepCategory[] = ["reasoning", "command", "tool"];

export const STEP_EXPANSION_EVENT = "pi-step-expansion-changed";

const STORAGE_KEY = "pi-process-step-expanded";

export type StepExpansion = Record<StepCategory, boolean>;

/** 与改动前一致：推理默认摊开，命令与工具调用默认收起。 */
export const DEFAULT_STEP_EXPANSION: StepExpansion = {
  reasoning: true,
  command: false,
  tool: false,
};

export function loadStepExpansion(): StepExpansion {
  const fallback = { ...DEFAULT_STEP_EXPANSION };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<StepCategory, unknown>>;
    for (const category of STEP_CATEGORIES) {
      if (typeof parsed?.[category] === "boolean") fallback[category] = parsed[category] as boolean;
    }
    return fallback;
  } catch {
    // 存储被禁用或内容不是 JSON：退回默认，不因为一个偏好炸掉整个时间线。
    return { ...DEFAULT_STEP_EXPANSION };
  }
}

export function saveStepExpansion(next: StepExpansion): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下也照样生效本次会话。
  }
  window.dispatchEvent(new Event(STEP_EXPANSION_EVENT));
}

export function setStepCategoryExpanded(category: StepCategory, expanded: boolean): StepExpansion {
  const next = { ...loadStepExpansion(), [category]: expanded };
  saveStepExpansion(next);
  return next;
}

/**
 * 一个步骤归哪一类。
 *
 * 命令（bash）单独一类是因为它的展开内容是终端输出，体量与工具详情完全不同；
 * 其余工具调用（读文件、改文件、todo……）合并成一类，逐工具配开关没人会去点。
 */
export function stepCategoryOf(step: { reasoning?: boolean; tone?: string }): StepCategory {
  if (step.reasoning) return "reasoning";
  if (step.tone === "command_execution") return "command";
  return "tool";
}
