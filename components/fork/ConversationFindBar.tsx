"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/*
 * fork:zc-02 — the in-conversation find bar (⌘F), mounted by ChatWindow.
 *
 * Why a custom bar instead of the browser's native find: native find cannot
 * count model-level hits that live outside the paged render window, cannot walk
 * the "load earlier" flow to reach them, and its selection model fights this
 * app's per-message memoization. This component owns only the input, counter
 * and stepper. Searching, paging and painting live in lib/conversation-find.ts
 * and ChatWindow so the bar stays small and the pure logic stays testable.
 *
 * Focus contract: ChatWindow stores the element that had focus before opening
 * and restores it on close; this bar only autofocuses its input (and refocuses
 * when ChatWindow bumps `focusSignal`, e.g. a second ⌘F).
 */

export interface ConversationFindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  hitCount: number;
  /** Zero-based index of the active hit; -1 when nothing is active. */
  activeIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Results are capped or some indexed text was clipped. */
  truncated?: boolean;
  /** Incremented by ChatWindow on each ⌘F so focus returns to the input. */
  focusSignal?: number;
}

function FindIcon({ children, label, disabled, onClick }: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
      style={{
        display: "grid",
        placeItems: "center",
        width: 24,
        height: 24,
        flexShrink: 0,
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        color: disabled ? "var(--text-dim)" : "var(--text-muted)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function ConversationFindBar({
  query,
  onQueryChange,
  hitCount,
  activeIndex,
  onNext,
  onPrevious,
  onClose,
  truncated = false,
  focusSignal = 0,
}: ConversationFindBarProps): ReactNode {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = query.trim().length > 0;
  const hasHits = hitCount > 0;
  const countText = hasHits ? `${activeIndex + 1}/${hitCount}` : "0/0";

  // Autofocus on mount; `focusSignal` re-runs it when ⌘F is pressed again while
  // the bar is already open (the global listener ignores input-originated keys,
  // so the input itself cannot rely on it).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // Let the IME own Enter/Escape while a CJK candidate window is open.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      // Keep Esc from reaching the global abort handler: closing find must not
      // also stop the running turn.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.currentTarget.select();
    }
  }, [onClose, onNext, onPrevious]);

  return (
    <div
      role="search"
      aria-label={t("chat.findLabel")}
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "min(430px, calc(100% - 20px))",
        minHeight: 36,
        padding: "3px 5px 3px 10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-elev)",
        boxShadow: "var(--shadow-lg)",
        color: "var(--text)",
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0, color: "var(--text-muted)" }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("chat.findPlaceholder")}
        aria-label={t("chat.findLabel")}
        spellCheck={false}
        autoComplete="off"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 2px",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text)",
          caretColor: "var(--accent)",
          fontSize: TEXT.sm,
          lineHeight: 1.4,
        }}
      />

      {truncated && hasQuery && (
        <span
          title={t("chat.findTruncatedHint")}
          style={{ flexShrink: 0, color: "var(--warning)", fontSize: TEXT.xs, whiteSpace: "nowrap" }}
        >
          {t("chat.findTruncated")}
        </span>
      )}

      {hasQuery && !hasHits ? (
        <span
          role="status"
          aria-live="polite"
          style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: TEXT.xs, whiteSpace: "nowrap" }}
        >
          {t("chat.findNoResults")}
        </span>
      ) : (
        <span
          role="status"
          aria-live="polite"
          style={{
            flexShrink: 0,
            minWidth: 48,
            color: "var(--text-muted)",
            fontSize: TEXT.xs,
            fontVariantNumeric: "tabular-nums",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {countText}
        </span>
      )}

      <FindIcon label={t("chat.findPrevious")} disabled={!hasHits} onClick={onPrevious}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </FindIcon>
      <FindIcon label={t("chat.findNext")} disabled={!hasHits} onClick={onNext}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </FindIcon>
      <FindIcon label={t("chat.findClose")} onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </FindIcon>
    </div>
  );
}
