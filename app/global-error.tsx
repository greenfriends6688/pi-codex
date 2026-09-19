"use client";
import { TEXT } from "@/lib/typography";

/**
 * fork:gap-error-boundary — 根布局级错误边界。
 *
 * `app/error.tsx` 覆盖不到根 `layout.tsx` 自身的错误，这一层负责兜住那种情况。
 * 按 Next 16 约定：必须自己渲染 `<html>` / `<body>`，且不会带上应用的全局样式与
 * `data-theme`（主题切换在这里失效），所以这里直接跟随系统深浅色，不假设任何 token。
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="zh-CN">
      <head>
        <title>Pi Codex</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <div style={{ maxWidth: 520, width: "100%" }} role="alert">
          <h1 style={{ fontSize: TEXT["2xl"], fontWeight: 600, margin: "0 0 8px" }}>应用启动失败 / Failed to start</h1>
          <p style={{ fontSize: TEXT.md, lineHeight: 1.7, margin: "0 0 12px", opacity: 0.8 }}>
            根布局渲染时出现异常。请先重试；若持续失败，打开开发者工具查看控制台堆栈。
            <br />
            An error occurred while rendering the root layout. Retry first; if it persists, check the console.
          </p>
          {error.digest && (
            <p style={{ fontSize: TEXT.sm, opacity: 0.7, margin: "0 0 16px" }}>
              digest: <code>{error.digest}</code>
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}
            >
              重试 / Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}
            >
              重新加载 / Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
