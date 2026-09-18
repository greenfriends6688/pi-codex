/**
 * lib/typography.ts
 *
 * 用途：把 app/globals.css 里定义的类型梯度（--text-2xs…--text-3xl）映射为
 * TypeScript 常量，供 React 内联 style 直接引用（DSN-07 的第一步：先导出
 * 常量，新代码强制走常量，老代码按目录分批替换）。
 *
 * 梯度（px）：2xs:10 / xs:11 / sm:12 / md:13 / lg:14 / xl:15 / 2xl:18 / 3xl:24。
 * nearestTextStep() 把 9 / 11.5 / 12.5 / 13.5 / 15 / 20 这类梯度外字号归并
 * 到最近一档，保证视觉只收敛不跑偏。
 *
 * 纯数据模块：服务端与客户端都可 import，不依赖任何平台 API。
 */

/** 梯度档位名，与 CSS 变量 `--text-*` 后缀一一对应。 */
export type TextStep = "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/** 各档位的数值（px），与 globals.css 中的定义保持一致。 */
export const TEXT_PX: Record<TextStep, number> = {
  "2xs": 10,
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 15,
  "2xl": 18,
  "3xl": 24,
};

/** 档位顺序（从小到大），归并与遍历共用，改梯度只改这一处。 */
export const TEXT_STEPS: readonly TextStep[] = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];

/** 可直接用于 React style 的 CSS 变量引用，如 TEXT.md === "var(--text-md)"。 */
export const TEXT: Record<TextStep, string> = {
  "2xs": "var(--text-2xs)",
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  md: "var(--text-md)",
  lg: "var(--text-lg)",
  xl: "var(--text-xl)",
  "2xl": "var(--text-2xl)",
  "3xl": "var(--text-3xl)",
};

/** 把档位名反查为数值，非法输入返回 undefined（调用方自行回退）。 */
export function textStepPx(step: string): number | undefined {
  return (TEXT_PX as Record<string, number>)[step];
}

/**
 * 把任意字号归并到最近的梯度档，返回可直接用于 style 的 var 字符串。
 * 距离相同（如 11.5 介于 11 与 12 之间）时收敛到较小档；
 * 非有限值（NaN/Infinity）回退到 md（正文字号），不抛异常。
 */
export function nearestTextStep(px: number): string {
  if (!Number.isFinite(px)) return TEXT.md;
  let best: TextStep = TEXT_STEPS[0];
  let bestDistance = Math.abs(px - TEXT_PX[best]);
  for (let i = 1; i < TEXT_STEPS.length; i += 1) {
    const step = TEXT_STEPS[i];
    const distance = Math.abs(px - TEXT_PX[step]);
    // 严格小于才替换：并列时保留较小的档。
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return TEXT[best];
}

/** nearestTextStep 的档位名版本，需要知道归并到哪一档时用。 */
export function nearestTextStepName(px: number): TextStep {
  if (!Number.isFinite(px)) return "md";
  let best: TextStep = TEXT_STEPS[0];
  let bestDistance = Math.abs(px - TEXT_PX[best]);
  for (let i = 1; i < TEXT_STEPS.length; i += 1) {
    const step = TEXT_STEPS[i];
    const distance = Math.abs(px - TEXT_PX[step]);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}
