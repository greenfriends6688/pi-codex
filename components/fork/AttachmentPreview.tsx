"use client";

/**
 * fork:zc-08 — 附件 chip 的通用预览弹窗（图片 / PDF / DOCX / 音频 / 视频 / 文本）。
 *
 * WHY：composer 里插入的非图片附件此前只是输入框文本里的 `@文件名`，看不到内容；
 * 图片虽然能点开，也没有统一的多类型预览。这个组件把「附件」当作一等对象：
 * 触发按钮自己包在 chip 里，点开后按 `attachmentPreviewKind()` 选渲染分支：
 *
 * - image  → 直接复用既有的 `ImagePreview` 灯箱（不重复实现缩放/焦点/关闭逻辑）；
 * - pdf    → 浏览器内置阅读器的 iframe（与 FileViewer 的 DocumentViewer 同一条
 *            `?type=read` 路径，服务端按扩展名给出 `application/pdf`）；
 * - docx   → 服务端 mammoth 转好的 `?type=preview` HTML iframe（与 FileViewer 相同的
 *            sandbox 与尺寸约定）；
 * - audio / video → 原生 `<audio controls>` / `<video controls>`，服务端支持 Range；
 * - text   → 拉 `?type=read`（服务端返回 JSON chunk）后只渲染前
 *            `TEXT_PREVIEW_MAX_LINES` 行，超出的部分显式标注，避免大文件把弹窗拖死；
 * - none   → 明确的「该类型暂不支持预览」文案，不渲染乱码。
 *
 * 焦点与关闭行为与 `ImagePreview` 对齐：原生 `<dialog showModal>`、打开时锁 body
 * 滚动、焦点进入关闭按钮、关闭后回到触发按钮、Esc / 点击遮罩关闭。
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";
import { ImagePreview } from "@/components/ImagePreview";
import {
  TEXT_PREVIEW_MAX_LINES,
  firstPreviewLines,
  type AttachmentPreviewKind,
} from "@/lib/composer-attachments";

export interface AttachmentPreviewProps {
  /** 展示名（文件名，不含目录）。 */
  name: string;
  kind: AttachmentPreviewKind;
  /** 原始内容 URL（`/api/files/...?type=read`）。 */
  src: string;
  /** DOCX 等服务端渲染的预览 URL（`?type=preview`）；缺省回退 `src`。 */
  previewSrc?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

type TextState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lines: string[]; truncated: boolean }
  | { status: "error" };

export function AttachmentPreview({
  name,
  kind,
  src,
  previewSrc,
  children,
  className,
  style,
}: AttachmentPreviewProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewAttachment");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<TextState>({ status: "idle" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || kind !== "text") return;
    let active = true;
    setText({ status: "loading" });
    fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          // 文本走的是服务端 chunk API（JSON），不是裸文本。
          const body = await response.json() as { content?: unknown };
          return typeof body.content === "string" ? body.content : "";
        }
        return response.text();
      })
      .then((content) => {
        if (!active) return;
        setText({ status: "ready", ...firstPreviewLines(content) });
      })
      .catch(() => {
        if (active) setText({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [kind, open, src]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const closePreview = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  // 图片直接复用既有灯箱：它已经处理了缩放、焦点与移动端安全区。
  if (kind === "image") {
    return (
      <ImagePreview src={src} alt={name} className={className} style={style}>
        {children}
      </ImagePreview>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          cursor: "pointer",
          ...style,
        }}
        onClick={() => setOpen(true)}
        aria-label={`${previewLabel}: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={previewLabel}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="image-preview-dialog"
          aria-label={previewLabel}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              width: "100%",
              maxWidth: kind === "pdf" || kind === "docx" ? 1000 : 760,
              maxHeight: "100%",
              minHeight: 0,
            }}
          >
            <div
              style={{
                maxWidth: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-muted)",
                fontSize: TEXT.sm,
              }}
            >
              <span title={name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </span>
            </div>
            <div
              style={{
                width: "100%",
                maxHeight: "calc(100dvh - 96px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xl)",
                boxShadow: "var(--shadow-lg)",
                overflow: "hidden",
              }}
            >
              {renderPreviewBody(kind, { name, src, previewSrc, text, t })}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="image-preview-close"
            onClick={closePreview}
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </dialog>
      )}
    </>
  );
}

function renderPreviewBody(
  kind: AttachmentPreviewKind,
  context: {
    name: string;
    src: string;
    previewSrc?: string;
    text: TextState;
    t: (key: string, params?: Record<string, string | number>) => string;
  },
): React.ReactNode {
  const { name, src, previewSrc, text, t } = context;
  switch (kind) {
    case "pdf":
      // 浏览器内置 PDF 阅读器需要同源文档本身（不能加 sandbox），与 FileViewer 一致。
      return (
        <iframe
          src={src}
          title={name}
          style={{ width: "100%", height: "min(78dvh, 720px)", border: "none", background: "var(--bg)" }}
        />
      );
    case "docx":
      return (
        <iframe
          src={previewSrc ?? src}
          sandbox="allow-same-origin"
          title={name}
          style={{ width: "100%", height: "min(78dvh, 720px)", border: "none", background: "#eef1f5" }}
        />
      );
    case "audio":
      return (
        <audio
          controls
          preload="metadata"
          src={src}
          style={{ width: "min(520px, 92vw)", margin: "28px 20px" }}
        />
      );
    case "video":
      return (
        <video
          controls
          preload="metadata"
          src={src}
          style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 140px)", background: "#000" }}
        />
      );
    case "text": {
      if (text.status === "loading" || text.status === "idle") {
        return <div style={{ padding: 24, color: "var(--text-muted)", fontSize: TEXT.sm }}>{t("chat.previewLoading")}</div>;
      }
      if (text.status === "error") {
        return <div style={{ padding: 24, color: "var(--danger)", fontSize: TEXT.sm }}>{t("chat.previewTextFailed")}</div>;
      }
      return (
        <div style={{ width: "100%", maxHeight: "calc(100dvh - 96px)", overflow: "auto", textAlign: "left" }}>
          <pre
            style={{
              margin: 0,
              padding: "14px 16px",
              fontFamily: "var(--font-mono)",
              fontSize: TEXT.sm,
              lineHeight: 1.55,
              color: "var(--text)",
              whiteSpace: "pre",
              tabSize: 2,
            }}
          >
            {text.lines.join("\n")}
          </pre>
          {text.truncated && (
            <div
              style={{
                position: "sticky",
                bottom: 0,
                padding: "6px 16px",
                background: "var(--bg-panel)",
                borderTop: "1px solid var(--border)",
                color: "var(--text-dim)",
                fontSize: TEXT.xs,
              }}
            >
              {t("chat.previewTextTruncated", { count: TEXT_PREVIEW_MAX_LINES })}
            </div>
          )}
        </div>
      );
    }
    default:
      return (
        <div style={{ padding: 24, color: "var(--text-dim)", fontSize: TEXT.sm, textAlign: "center" }}>
          {t("chat.previewUnsupported")}
        </div>
      );
  }
}
