"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { TodoSummary } from "@/lib/todo-state";

/*
 * fork:ui-todo — the session's task list, next to the composer.
 *
 * The list itself is produced by the built-in `todo` tool (lib/todo-extension.ts)
 * and read back from the transcript (lib/todo-state.ts `extractTodoState`), so this
 * component owns nothing but presentation: a chip with progress, and a read-only
 * panel. Read-only on purpose — flipping a checkbox here would have to rewrite an
 * already-recorded tool result, which is exactly the history the session format
 * forbids rewriting; the copy action exists so the user can hand the list back to
 * the model instead.
 */

export function TodoChip({ summary }: { summary: TodoSummary }): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing to show before the tool has ever run: an empty chip would be noise on
  // every new session.
  if (summary.total === 0) return null;

  const percent = Math.round((summary.done / summary.total) * 100);
  const complete = summary.done === summary.total;

  const copy = () => {
    const text = summary.todos
      .map((todo) => `- [${todo.done ? "x" : " "}] ${todo.text}`)
      .join("\n");
    void copyText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t("chat.todos")}
        aria-label={t("chat.todos")}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 9px",
          border: "1px solid var(--border-faint)",
          borderRadius: 14,
          background: "var(--bg-panel)",
          color: complete ? "var(--text-muted)" : "var(--text)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 6 2 2 3-4" /><path d="M13 7h7" />
          <path d="m4 17 2 2 3-4" /><path d="M13 18h7" />
        </svg>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {t("chat.todosProgress", { done: summary.done, total: summary.total })}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 4,
            borderRadius: 2,
            background: "var(--border)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              width: `${percent}%`,
              height: "100%",
              background: complete ? "var(--text-muted)" : "var(--accent)",
              transition: "width var(--fork-motion-chip, 180ms) var(--ease-out)",
            }}
          />
        </span>
      </button>

      {open && (
        <div
          role="group"
          aria-label={t("chat.todos")}
          className="fork-todo-panel"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            width: 320,
            maxWidth: "min(320px, 92vw)",
            maxHeight: 320,
            overflowY: "auto",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-elev)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("chat.todos")} · {summary.done}/{summary.total}
            </span>
            <button
              type="button"
              onClick={copy}
              title={t("chat.copyTodos")}
              style={{
                marginLeft: "auto",
                height: 22,
                padding: "0 8px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xs)",
                background: "transparent",
                color: copied ? "var(--accent)" : "var(--text-muted)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {copied ? t("i18n.copied") : t("chat.copyTodos")}
            </button>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {summary.todos.map((todo) => (
              <li key={todo.id} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, lineHeight: 1.45 }}>
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    width: 13,
                    height: 13,
                    marginTop: 2,
                    borderRadius: 3,
                    border: `1px solid ${todo.done ? "transparent" : "var(--border-strong, var(--border))"}`,
                    background: todo.done ? "var(--text-muted)" : "transparent",
                    color: "var(--bg)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 9,
                  }}
                >
                  {todo.done ? "✓" : ""}
                </span>
                <span style={{ minWidth: 0, color: todo.done ? "var(--text-dim)" : "var(--text)", textDecoration: todo.done ? "line-through" : "none" }}>
                  {todo.text}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("chat.todosHint")}</p>
        </div>
      )}
    </div>
  );
}
