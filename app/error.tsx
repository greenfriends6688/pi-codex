"use client";

import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/**
 * fork:gap-error-boundary — 应用级错误边界。
 *
 * 在这之前全仓只有一个 `MarkdownEditorBoundary`，任何渲染期异常都会把
 * 整个会话界面变成白屏（Next 默认错误页没有"重试"路径，用户只能手动刷新）。
 * 这里给出可恢复的兜底：沿用主题 token，并暴露 digest 便于对照服务端日志。
 *
 * 注意（Next 16 约定）：错误边界的恢复函数叫 `retry`，不是 `reset`；
 * 且必须是客户端组件。样式用内联 + 主题变量，避免与 `globals.css` 的
 * 主题层产生耦合（错误页本身不该依赖可能出问题的样式）。
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    // 生产环境 message 会被脱敏，digest 用于对照服务端日志；完整堆栈留在控制台。
    console.error("[pi-web] render error boundary", error);
  }, [error]);

  const buttonStyle = {
    padding: "6px 14px",
    borderRadius: "var(--radius-md, 8px)",
    border: "1px solid var(--border, currentColor)",
    background: "var(--bg-panel, transparent)",
    color: "var(--text, inherit)",
    cursor: "pointer",
    font: "inherit",
    fontSize: TEXT.md,
  } as const;

  return (
    <div
      role="alert"
      style={{
        margin: "0 auto",
        maxWidth: 560,
        padding: "28px 24px",
        color: "var(--text, CanvasText)",
        fontFamily: "inherit",
      }}
    >
      <h2 style={{ fontSize: TEXT.xl, fontWeight: 600, margin: "0 0 8px" }}>{t("error.boundaryTitle")}</h2>
      <p style={{ fontSize: TEXT.md, lineHeight: 1.7, margin: "0 0 12px", color: "var(--text-muted, inherit)" }}>
        {t("error.boundaryHint")}
      </p>
      {error.digest && (
        <p style={{ fontSize: TEXT.sm, margin: "0 0 16px", color: "var(--text-dim, inherit)" }}>
          {t("error.boundaryDigest")} <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{error.digest}</code>
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => retry()} style={buttonStyle}>
          {t("error.boundaryRetry")}
        </button>
        <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
          {t("error.boundaryReload")}
        </button>
      </div>
    </div>
  );
}
