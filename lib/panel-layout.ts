export const MOBILE_MAX_WIDTH = 640;
export const SPLIT_PANEL_MIN_WIDTH = 960;

// Zeno rail sizing (`SHELL_SIDEBAR` in zeno-main's apps/desktop/src/renderer/lib/layout.ts):
// default 300px inside a 232–360 drag band. The previous 272/216/520 came from Zeno's
// legacy `--sidebar-width` CSS fallback, which is not the width its rail actually
// renders at — the real rail width is JS-computed and clamped to that band.
export const SIDEBAR_DEFAULT_WIDTH = 300;
export const SIDEBAR_MIN_WIDTH = 232;
export const SIDEBAR_MAX_WIDTH = 360;

export const RIGHT_PANEL_FALLBACK_WIDTH = 384;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1200;

const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : minWidth;
  const effectiveMax = Math.max(minWidth, maxWidth);
  return Math.round(Math.max(minWidth, Math.min(effectiveMax, finiteWidth)));
}

// Codex shows the editor and the file tree side by side inside one pane. The
// pane only splits when it is wide enough to hold both; narrower panes keep the
// single-surface behavior, where the tree yields to the active viewer.
export const PANEL_EXPLORER_WIDTH = 248;
export const PANEL_SPLIT_MIN_WIDTH = 560;

export function getSplitPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(Math.round(viewportWidth * 0.5), PANEL_SPLIT_MIN_WIDTH, 760);
}

export function getDefaultRightPanelWidth(viewportWidth: number): number {
  // The side panel has to hold a document, a diff or a terminal without
  // squeezing the transcript, so it scales with the viewport instead of
  // sitting at a fixed 384. The 560 ceiling is deliberately below upstream's
  // 640: at 1440 a 640 panel would leave the chat under 600px.
  return clampPanelWidth(Math.min(viewportWidth * 0.36, 560), 380, 640);
}

export function getSidebarMaxWidth(options: {
  viewportWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;

  const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
  const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
  const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
  return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth);
}

export function getRightPanelMaxWidth(options: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
}): number {
  const { viewportWidth, sidebarOpen, sidebarWidth } = options;
  if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;

  const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth,
  );
}
