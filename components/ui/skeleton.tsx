// fork:ds-small-parts（DS-07/DS-08）—— 骨架占位：div + pulse，宽高/圆角由调用方 className（h-*、w-*、rounded-*）决定。
// 来源：shadcn/ui skeleton（components/ui/skeleton.tsx 注册表 + Skeleton 文档 API）。改动：bg-accent → bg-background-primary-hover
// （对齐本仓现有 .skeleton-line 的 --bg-hover），补 motion-reduce:animate-none。
import type { ComponentProps } from "react";
import { cx } from "@/utils/cx";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cx(
        "animate-pulse rounded-md bg-background-primary-hover motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
