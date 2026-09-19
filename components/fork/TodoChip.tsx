"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { CONTROL } from "@/lib/control-size";
import { TEXT } from "@/lib/typography";
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
 *
 * fork:ui-todo-live — the panel is fed by the message list, which grows while the
 * turn streams, so it already tracked the run; what it did not do was *show* that
 * it was tracking anything. A flat list of identical rows that all turned grey at
 * once read as a summary written after the fact. The panel therefore names the
 * open item ("进行中"), carries a progress bar, and the chip title names that item
 * too, so a mid-run glance says what the agent is doing right now.
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
  // The oldest open item is the step the run is on. It is an inference, not a
  // report — the tool has no "current" field — but it is the one the agent would
  // tick next, and naming it is what separates progress from a counter.
  const activeTodo = complete ? null : summary.todos.find((todo) => !todo.done) ?? null;
  const progressText = t("chat.todosProgress", { done: summary.done, total: summary.total });

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
        title={activeTodo ? `${t("chat.todos")} · ${activeTodo.text}` : t("chat.todos")}
        aria-label={t("chat.todos")}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: CONTROL.sm,
          padding: "0 9px",
          border: "1px solid var(--border-faint)",
          borderRadius: 14,
          background: "var(--bg-panel)",
          color: complete ? "var(--text-muted)" : "var(--text)",
          fontSize: TEXT.sm,
          fontWeight: 500,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 6 2 2 3-4" /><path d="M13 7h7" />
          <path d="m4 17 2 2 3-4" /><path d="M13 18h7" />
        </svg>
        <span style={{ fontVariantNumeric: "tabular-nums" }} aria-live="polite">{progressText}</span>
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
              // DSN-05：宽度固定 100% + transform: scaleX，避免逐帧触发布局重排。
              width: "100%",
              height: "100%",
              transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})`,
              transformOrigin: "left",
              background: complete ? "var(--text-muted)" : "var(--accent)",
              transition: "transform var(--fork-motion-chip, 180ms) var(--ease-out)",
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
            padding: "10px 12px 9px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-elev)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: TEXT.sm, fontWeight: 600, color: "var(--text)" }}>{t("chat.todos")}</span>
            <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {progressText}
            </span>
            <button
              type="button"
              onClick={copy}
              title={t("chat.copyTodos")}
              style={{
                marginLeft: "auto",
                height: CONTROL.xs,
                padding: "0 8px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xs)",
                background: "transparent",
                color: copied ? "var(--accent)" : "var(--text-muted)",
                fontSize: TEXT.xs,
                cursor: "pointer",
              }}
            >
              {copied ? t("i18n.copied") : t("chat.copyTodos")}
            </button>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.done}
            aria-label={t("chat.todos")}
            style={{ height: 4, marginTop: 8, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}
          >
            <span
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})`,
                transformOrigin: "left",
                background: complete ? "var(--text-muted)" : "var(--accent)",
                transition: "transform var(--fork-motion-chip, 180ms) var(--ease-out)",
              }}
            />
          </div>

          <ul style={{ margin: "9px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {summary.todos.map((todo) => {
              const active = activeTodo?.id === todo.id;
              return (
                <li key={todo.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: TEXT.sm, lineHeight: 1.45 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 14,
                      height: 14,
                      marginTop: 2,
                      borderRadius: 4,
                      border: `1.5px solid ${todo.done || active ? "transparent" : "var(--border-strong)"}`,
                      background: todo.done
                        ? "var(--text-muted)"
                        : active
                          ? "var(--accent)"
                          : "transparent",
                      color: "var(--bg)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: TEXT["2xs"],
                      fontWeight: 700,
                    }}
                  >
                    {todo.done ? "✓" : active ? <span style={{ width: 5, height: 5, borderRadius: 5, background: "var(--bg)" }} /> : ""}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      color: todo.done ? "var(--text-dim)" : "var(--text)",
                      textDecoration: todo.done ? "line-through" : "none",
                    }}
                  >
                    {todo.text}
                  </span>
                  {active && (
                    <span
                      style={{
                        flexShrink: 0,
                        marginLeft: "auto",
                        padding: "1px 6px",
                        borderRadius: 9,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        fontSize: TEXT["2xs"],
                        lineHeight: 1.5,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("chat.todosActive")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p style={{ margin: "9px 0 0", paddingTop: 7, borderTop: "1px solid var(--border-faint)", fontSize: TEXT.xs, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("chat.todosHint")}
          </p>
        </div>
      )}
    </div>
  );
}
