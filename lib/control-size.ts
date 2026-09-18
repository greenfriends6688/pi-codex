/**
 * lib/control-size.ts
 *
 * 用途：把 app/globals.css 里定义的控件梯度（--control-xs…--control-touch）
 * 映射为 TypeScript 常量，供 React 内联 style 直接引用（DSN-07 / DSN-04 的
 * 第一步：先导出常量，新代码强制走常量）。
 *
 * 梯度（px）：xs:22 / sm:26 / md:28 / lg:32 / xl:36 / touch:44。
 * 其中 touch:44 是移动端最小触控目标（DSN-04），桌面端默认不动它。
 *
 * 纯数据模块：服务端与客户端都可 import，不依赖任何平台 API。
 */

/** 控件档位名，与 CSS 变量 `--control-*` 后缀一一对应。 */
export type ControlStep = "xs" | "sm" | "md" | "lg" | "xl" | "touch";

/** 各档位的数值（px），与 globals.css 中的定义保持一致。 */
export const CONTROL_PX: Record<ControlStep, number> = {
  xs: 22,
  sm: 26,
  md: 28,
  lg: 32,
  xl: 36,
  touch: 44,
};

/** 档位顺序（从小到大），归并与遍历共用。 */
export const CONTROL_STEPS: readonly ControlStep[] = ["xs", "sm", "md", "lg", "xl", "touch"];

/** 可直接用于 React style 的 CSS 变量引用，如 CONTROL.md === "var(--control-md)"。 */
export const CONTROL: Record<ControlStep, string> = {
  xs: "var(--control-xs)",
  sm: "var(--control-sm)",
  md: "var(--control-md)",
  lg: "var(--control-lg)",
  xl: "var(--control-xl)",
  touch: "var(--control-touch)",
};

/**
 * 把任意控件高度归并到最近的梯度档，返回可直接用于 style 的 var 字符串。
 * 距离相同时收敛到较小档；非有限值回退到 md（默认控件高度），不抛异常。
 */
export function nearestControlStep(px: number): string {
  if (!Number.isFinite(px)) return CONTROL.md;
  return CONTROL[nearestControlStepName(px)];
}

/** nearestControlStep 的档位名版本。 */
export function nearestControlStepName(px: number): ControlStep {
  if (!Number.isFinite(px)) return "md";
  let best: ControlStep = CONTROL_STEPS[0];
  let bestDistance = Math.abs(px - CONTROL_PX[best]);
  for (let i = 1; i < CONTROL_STEPS.length; i += 1) {
    const step = CONTROL_STEPS[i];
    const distance = Math.abs(px - CONTROL_PX[step]);
    // 严格小于才替换：并列时保留较小的档。
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}
