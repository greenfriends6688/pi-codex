"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { enteredClass, useTwoPhaseEnter } from "@/hooks/useTwoPhaseEnter";

/**
 * Generic right-click / dropdown menu.
 *
 * Renders into a portal on `document.body` so it always floats above every
 * panel and stacking context, and any component under the provider can open it:
 *
 *   const { openMenu } = useContextMenu();
 *   openMenu(event.clientX, event.clientY, [{ label: "Copy", onSelect: copy }]);
 *
 * Behaviour (each of these was previously missing from the one hand-rolled menu
 * this replaces):
 *  - follows the pointer and flips at the viewport edges;
 *  - closes on outside click, Escape, user wheel/touch scroll, `window.blur` and
 *    `resize` — but **not** on programmatic scroll, so a streaming chat that
 *    auto-scrolls under the menu does not dismiss it;
 *  - keyboard navigation (↑/↓, Home/End, Enter/Space);
 *  - `feedbackLabel` briefly replaces the label after a select (e.g. "Copied")
 *    before the menu closes itself;
 *  - submenus are limited to one level **by the type**, so a nested flyout is
 *    impossible to express.
 */

export interface ContextMenuItem {
  /** Discriminant for the entry union; callers never need to set it. */
  type?: "item";
  label: string;
  icon?: ReactNode;
  /** Render the label in the danger colour (destructive actions). */
  danger?: boolean;
  disabled?: boolean;
  /** Native tooltip, e.g. explaining why an item is disabled. */
  title?: string;
  /** Label shown for a moment after selecting, before the menu closes. */
  feedbackLabel?: string;
  /** Show a check mark in the icon slot (the currently active option). */
  checked?: boolean;
  /** Right-aligned secondary text (e.g. a count). */
  hint?: ReactNode;
  /**
   * One level of nested options, rendered as a flyout. Nested submenus are not
   * rendered, and the type forbids them.
   */
  submenu?: Omit<ContextMenuItem, "submenu">[];
  onSelect?: () => void | Promise<void>;
}

export type ContextMenuEntry = ContextMenuItem | { type: "separator" };

interface MenuState {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
}

interface ContextMenuApi {
  openMenu: (x: number, y: number, entries: ContextMenuEntry[]) => void;
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

const MENU_MARGIN = 6;
const MIN_WIDTH = 168;
const FEEDBACK_MS = 1200;
const CLOSE_ANIMATION_MS = 90;

export function useContextMenu(): ContextMenuApi {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used inside a <ContextMenuProvider>");
  }
  return context;
}

function isSeparator(entry: ContextMenuEntry): entry is { type: "separator" } {
  return (entry as { type?: string }).type === "separator";
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // fork:ui-01 — two-phase enter: the menu mounts invisible and picks up
  // `context-menu--entered` one frame later, which is what lets the CSS
  // transition (fork-ui.css) actually play instead of the menu popping in.
  const entered = useTwoPhaseEnter(Boolean(menu));
  const [feedbackIndex, setFeedbackIndex] = useState(-1);
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearTimers();
    setSubmenuIndex(null);
    setSubmenuPos(null);
    setFeedbackIndex(-1);
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      setMenu(null);
      setPos(null);
      setActiveIndex(-1);
    }, CLOSE_ANIMATION_MS);
  }, [clearTimers]);

  const openMenu = useCallback((x: number, y: number, entries: ContextMenuEntry[]) => {
    clearTimers();
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setSubmenuIndex(null);
    setSubmenuPos(null);
    setFeedbackIndex(-1);
    setActiveIndex(-1);
    setMenu({ x, y, entries });
    // Provisional position; useLayoutEffect re-measures and flips.
    setPos({ x, y });
  }, [clearTimers]);

  // Measure the rendered menu and flip it at the viewport edges, so a right-click
  // near the bottom-right corner does not open a menu that runs off-screen.
  // layout size (offsetWidth/Height), NOT getBoundingClientRect: the enter
  // transition scales the layer to 0.98, and a rect measured mid-transition is
  // ~2% short, which lands the clamped position a couple of pixels over the
  // edge once the scale finishes (measured on a 390x844 viewport).
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(MENU_MARGIN, Math.min(menu.x, vw - menuWidth - MENU_MARGIN));
    const y = Math.max(MENU_MARGIN, Math.min(menu.y, vh - menuHeight - MENU_MARGIN));
    setPos((current) => (current && current.x === x && current.y === y ? current : { x, y }));
  }, [menu]);

  // Dismissal. Note the deliberate asymmetry on scroll: a real wheel/touch
  // gesture closes the menu (the anchor is no longer where the user pointed),
  // but a programmatic scroll does not — otherwise a streaming transcript would
  // tear the menu away mid-click.
  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const onUserScroll = (event: Event) => {
      // A wheel/touch event on any scroll container is real user intent.
      if (event.type === "wheel" || event.type === "touchmove") closeMenu();
    };
    const onBlur = () => closeMenu();
    const onResize = () => closeMenu();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onUserScroll, { passive: true, capture: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true, capture: true });
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onUserScroll, { capture: true });
      window.removeEventListener("touchmove", onUserScroll, { capture: true });
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, closeMenu]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  if (typeof document === "undefined") {
    return <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>{children}</ContextMenuContext.Provider>;
  }

  const selectableIndexes = menu
    ? menu.entries
      .map((entry, index) => (isSeparator(entry) || entry.disabled ? -1 : index))
      .filter((index) => index >= 0)
    : [];

  const move = (delta: number) => {
    if (selectableIndexes.length === 0) return;
    const currentSlot = selectableIndexes.indexOf(activeIndex);
    const nextSlot = currentSlot === -1
      ? (delta > 0 ? 0 : selectableIndexes.length - 1)
      : (currentSlot + delta + selectableIndexes.length) % selectableIndexes.length;
    setActiveIndex(selectableIndexes[nextSlot]);
    setSubmenuIndex(null);
  };

  const runItem = async (entry: ContextMenuItem, index: number) => {
    if (entry.disabled) return;
    if (entry.submenu && entry.submenu.length > 0) {
      setSubmenuIndex((current) => (current === index ? null : index));
      return;
    }
    if (!entry.onSelect) {
      closeMenu();
      return;
    }
    if (entry.feedbackLabel) {
      setFeedbackIndex(index);
    }
    try {
      await entry.onSelect();
    } catch {
      // A rejecting action (e.g. a denied clipboard write) must not escape as an
      // unhandled rejection; the menu still closes the way it always does.
    } finally {
      if (entry.feedbackLabel) {
        feedbackTimer.current = setTimeout(() => closeMenu(), FEEDBACK_MS);
      } else {
        closeMenu();
      }
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home":
      case "End": {
        event.preventDefault();
        if (selectableIndexes.length === 0) break;
        // Jump straight to the end slot: going through `move()` wraps back to the
        // current slot once anything is active, which made Home/End no-ops.
        setActiveIndex(event.key === "Home"
          ? selectableIndexes[0]
          : selectableIndexes[selectableIndexes.length - 1]);
        setSubmenuIndex(null);
        break;
      }
      case "Enter":
      case " ": {
        if (activeIndex < 0 || !menu) return;
        const entry = menu.entries[activeIndex];
        if (!entry || isSeparator(entry)) return;
        event.preventDefault();
        void runItem(entry, activeIndex);
        break;
      }
      default:
        break;
    }
  };

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>
      {children}
      {menu && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Context menu"
          className={`${enteredClass("context-menu", entered)}${closing ? " is-closing" : ""}`}
          style={{ top: pos.y, left: pos.x, minWidth: MIN_WIDTH }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onMenuKeyDown}
        >
          {menu.entries.map((entry, index) => {
            if (isSeparator(entry)) {
              return <div key={`sep-${index}`} role="separator" className="context-menu-separator" />;
            }
            const item = entry as ContextMenuItem;
            const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);
            const isActive = index === activeIndex;
            return (
              <div key={`${item.label}-${index}`} className="context-menu-item-wrap">
                <button
                  type="button"
                  role="menuitem"
                  className={[
                    "context-menu-item",
                    item.danger ? " is-danger" : "",
                    isActive ? " is-active" : "",
                  ].filter(Boolean).join(" ")}
                  aria-haspopup={hasSubmenu ? "menu" : undefined}
                  aria-expanded={hasSubmenu ? submenuIndex === index : undefined}
                  aria-disabled={item.disabled || undefined}
                  disabled={item.disabled}
                  title={item.title}
                  onMouseEnter={(event) => {
                    setActiveIndex(index);
                    if (hasSubmenu) {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSubmenuIndex(index);
                      setSubmenuPos({ x: rect.right - 4, y: rect.top - 5 });
                    } else {
                      setSubmenuIndex(null);
                    }
                  }}
                  onClick={() => void runItem(item, index)}
                >
                  <span className="context-menu-icon" aria-hidden="true">
                    {item.checked ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    ) : item.icon}
                  </span>
                  <span className="context-menu-label">
                    {feedbackIndex === index && item.feedbackLabel ? item.feedbackLabel : item.label}
                  </span>
                  {item.hint !== undefined && <span className="context-menu-hint">{item.hint}</span>}
                  {hasSubmenu && (
                    <span className="context-menu-caret" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </span>
                  )}
                </button>

                {hasSubmenu && submenuIndex === index && submenuPos && (
                  <div
                    role="menu"
                    className="context-menu context-menu-submenu"
                    style={{ top: submenuPos.y, left: submenuPos.x, minWidth: MIN_WIDTH - 24 }}
                    onMouseLeave={() => setSubmenuIndex(null)}
                  >
                    {item.submenu!.map((sub, subIndex) => (
                      <button
                        key={`${sub.label}-${subIndex}`}
                        type="button"
                        role="menuitem"
                        className={`context-menu-item${sub.danger ? " is-danger" : ""}`}
                        disabled={sub.disabled}
                        title={sub.title}
                        onClick={() => void runItem(sub, -1)}
                      >
                        <span className="context-menu-icon" aria-hidden="true">
                          {sub.checked ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m5 13 4 4L19 7" />
                            </svg>
                          ) : sub.icon}
                        </span>
                        <span className="context-menu-label">{sub.label}</span>
                        {sub.hint !== undefined && <span className="context-menu-hint">{sub.hint}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ContextMenuContext.Provider>
  );
}
