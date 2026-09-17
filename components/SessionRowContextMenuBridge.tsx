"use client";

import { useEffect } from "react";
import { useContextMenu } from "./ContextMenu";
import { useI18n } from "@/hooks/useI18n";
import { SESSION_ROW_CONTEXT_MENU_EVENT, type SessionRowContextMenuDetail } from "@/lib/session-row-context-menu";
import { SESSION_TAGS, getSessionFlags, setSessionTag, toggleArchived, togglePinned, type SessionTag } from "@/lib/session-flags";

/**
 * Bridges the session sidebar's legacy window event onto the generic
 * `ContextMenuProvider`.
 *
 * The sidebar dispatches `SESSION_ROW_CONTEXT_MENU_EVENT` instead of using the
 * context hook directly, because the sidebar row and the menu live in different
 * subtrees and the sidebar must not depend on `AppShell`'s internals. Keeping
 * the event as the seam means the menu implementation can change without
 * touching the sidebar.
 */
export function SessionRowContextMenuBridge({
  onCopyReference,
}: {
  onCopyReference: (detail: SessionRowContextMenuDetail) => void | Promise<void>;
}) {
  const { openMenu } = useContextMenu();
  const { t } = useI18n();

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<SessionRowContextMenuDetail>).detail;
      if (!detail) return;
      event.preventDefault();
      const flags = getSessionFlags();
      const isPinned = flags.pinned.includes(detail.id);
      const isArchived = flags.archived.includes(detail.id);
      openMenu(detail.clientX, detail.clientY, [
        {
          label: t(isPinned ? "session.unpin" : "session.pin"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
            </svg>
          ),
          onSelect: () => {
            togglePinned(detail.id);
            // The sidebar owns the session list; ask it to re-read its data.
            detail.refresh();
          },
        },
        {
          label: t(isArchived ? "session.unarchive" : "session.archive"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
            </svg>
          ),
          onSelect: () => {
            toggleArchived(detail.id);
            detail.refresh();
          },
        },
        {
          // fork:ui-10 — manual status. The submenu keeps the row menu short.
          label: t("session.tag"),
          checked: Boolean(flags.tags[detail.id]),
          submenu: [
            ...SESSION_TAGS.map((tag: SessionTag) => ({
              label: t(`session.tag.${tag}`),
              checked: flags.tags[detail.id] === tag,
              onSelect: () => {
                setSessionTag(detail.id, tag);
                detail.refresh();
              },
            })),
            {
              label: t("session.tag.clear"),
              disabled: !flags.tags[detail.id],
              onSelect: () => {
                setSessionTag(detail.id, null);
                detail.refresh();
              },
            },
          ],
        },
        { type: "separator" },
        {
          label: t("session.copyReference"),
          feedbackLabel: t("session.copied"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          ),
          onSelect: () => onCopyReference(detail),
        },
      ]);
    };
    window.addEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, handle as EventListener);
    return () => window.removeEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, handle as EventListener);
  }, [openMenu, onCopyReference, t]);

  return null;
}
