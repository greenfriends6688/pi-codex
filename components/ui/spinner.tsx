// fork:ds-small-parts（DS-07/DS-08）—— 加载指示：SVG 圆弧 spinner，role=status + aria-label，尺寸由 className（size-4 等）决定。
// 来源：shadcn/ui spinner（components/ui/spinner.tsx 注册表 + Spinner 文档 API）。改动：lucide Loader2Icon → 无依赖内联 SVG
// （stroke-width 1.5、currentColor）；新增可选 label，以 <title> 渲染为视觉隐藏文本（HTML 的 sr-only 不能放进 <svg>）。
import type { SVGProps } from "react";
import { cx } from "@/utils/cx";

export interface SpinnerProps extends SVGProps<SVGSVGElement> {
  /** 无障碍标签；同时作为 <title> 渲染为视觉隐藏文本。 */
  label?: string;
}

export function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label ?? "Loading"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // 注意：不加 motion-reduce:animate-none —— 本仓 DSN-09 的策略是“加载类动画在减少动态下保留”
      // （把 spinner 冻住会让“还在转”这个信息消失）。见 app/globals.css 的 reduced-motion 例外。
      className={cx("size-4 animate-spin", className)}
      {...props}
    >
      {label ? <title>{label}</title> : null}
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
