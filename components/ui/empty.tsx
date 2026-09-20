// fork:ds-small-parts（DS-07/DS-08）—— 空状态组合件：Empty / EmptyHeader / EmptyMedia / EmptyTitle / EmptyDescription / EmptyContent。
// 来源：shadcn/ui empty（components/ui/empty.tsx 注册表 + Empty 文档 API）。改动：去 cva 依赖与 shadcn token，按 BoardUI 语义 token 重写。
import type { ComponentProps } from "react";
import { cx, sortCx } from "@/utils/cx";

/**
 * shadcn/ui composition kept as-is:
 *
 *   Empty
 *   ├── EmptyHeader
 *   │   ├── EmptyMedia (variant="default" | "icon")
 *   │   ├── EmptyTitle
 *   │   └── EmptyDescription
 *   └── EmptyContent   ← buttons, inputs, links
 *
 * Styling is translated to BoardUI semantic tokens (bg-background-secondary-default,
 * text-text-primary/secondary, the 52 composite type utilities).
 */

const mediaStyles = sortCx({
  base: "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  variant: {
    default: "bg-transparent",
    icon: "size-10 rounded-lg bg-background-secondary-default text-text-primary [&_svg:not([class*='size-'])]:size-6",
  },
});

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cx(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cx(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className,
      )}
      {...props}
    />
  );
}

export interface EmptyMediaProps extends ComponentProps<"div"> {
  variant?: "default" | "icon";
}

export function EmptyMedia({
  className,
  variant = "default",
  ...props
}: EmptyMediaProps) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cx(mediaStyles.base, mediaStyles.variant[variant], className)}
      {...props}
    />
  );
}

export function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cx("text-title-3-medium", className)}
      {...props}
    />
  );
}

export function EmptyDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-description"
      className={cx(
        "text-body-regular text-text-secondary [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cx(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-body-regular text-balance",
        className,
      )}
      {...props}
    />
  );
}
