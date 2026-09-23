"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage, UserMessage } from "@/lib/types";
import { normalizeCustomPanelLines } from "@/lib/ansi";
import { splitDialogTitle, splitDialogTitleCode } from "@/lib/dialog-title";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { countToolCallBlocks, getAssistantErrorMessage, getAssistantTruncationNotice, getDisplayableAssistantBlocks, isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import { extractTurnWrittenFiles, type WrittenFile } from "@/lib/turn-written-files";
import { useMemoryInvitation } from "@/components/fork/useMemoryInvitation";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { createSelectionContextId, type SelectionContext } from "@/lib/composer-context";
import type { SessionReference } from "@/lib/composer-context";
import { clearLocationTextHighlight, LOCATION_HIGHLIGHT_CLASS, setLocationTextHighlight } from "@/lib/location-highlight";
import { MessageView } from "./MessageView";
import { MarkdownBody } from "./MarkdownBody";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import type { FileLocationTarget } from "./FileViewer";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { SessionStatsBar } from "./SessionStatsBar";
import { NewSessionHome } from "./fork/NewSessionHome";
import { ProjectChip, type NewSessionTargets } from "./fork/ProjectChip";
import { ComposerTipLine } from "./fork/ComposerTipLine";
// fork:zc-02 — in-conversation find bar (⌘F): bar component + pure search index.
import { ConversationFindBar } from "./fork/ConversationFindBar";
import {
  buildSearchIndex,
  CONVERSATION_FIND_MAX_HITS,
  conversationFindHitKey,
  findHits,
  nextHitIndex,
  type ConversationFindHit,
} from "@/lib/conversation-find";
// fork:proma-05-explore — 分支会话的来源抬头条 + 带回结论
import { ExplorationBanner } from "./fork/ExplorationBanner";
import { extractTodoState } from "@/lib/todo-state";
import { AnsiText } from "./AnsiText";
import { useI18n } from "@/hooks/useI18n";
import { ProcessGroup, summarizeProcessBlocks } from "./ProcessGroup";
import { messageToProcessContentBlocks, type ProcessContentBlock } from "@/lib/process-content";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AppUpdateResponse } from "@/lib/api-types";
import type { ToolEntry } from "@/lib/tool-presets";
import { findChatScrollAnchor, type ChatScrollPosition } from "@/lib/chat-scroll-position";
import {
  captureScrollDistance,
  getPromptAnchorSpacerHeight,
  getVisibleRenderWindow,
  isScrollAtTail,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
// fork:zm-03 — 滚动权状态机 / prepend 锚定 / 渐隐遮罩（纯逻辑见 lib/scroll-follow.ts）。
import {
  captureScrollAnchor,
  initialFollowing,
  keyboardScrollIntent,
  nextFollowingAfterIntent,
  resolveFollowingAfterScroll,
  resolvePrependRestoreScrollTop,
  shouldAllowProgrammaticScroll,
  touchScrollIntent,
  wheelScrollIntent,
  type ScrollAnchorSample,
  type ScrollEventSource,
  type ScrollIntent,
} from "@/lib/scroll-follow";
import { ScrollFadeViewport } from "./fork/ScrollFadeViewport";
// fork:zm-07 — 等待态状态行（串行滚动）。
import { PhaseRoll } from "./fork/PhaseRoll";
// fork:zm-04 — 倒计时条共享同一个动效偏好守卫。
import { useMotionPreference } from "./fork/RollingNumber";
// fork:zc-17 — 零会话首屏的三条起步路径。
import { EmptyStateGuide } from "./fork/EmptyStateGuide";
import { TEXT } from "@/lib/typography";

interface Props {
  session: SessionInfo | null;
  searchTarget?: { sessionId: string; entryId: string; blockIndex?: number } | null;
  onSearchTargetHandled?: (target: { sessionId: string; entryId: string }) => void;
  initialScrollPosition?: ChatScrollPosition | null;
  onScrollPositionChange?: (sessionId: string, position: ChatScrollPosition) => void;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  onAgentEnd?: () => void;
  /** fork:zn-16 — 一轮运行以错误收场；设置里「任务失败时通知」接这里。 */
  onAgentError?: (message: string) => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  /** fork:zn-03 — reports empty-chat so AppShell can hide the top bar. */
  onEmptyChange?: (empty: boolean) => void;
  onSessionForked?: (newSessionId: string) => void;
  /** fork:proma-05-explore — 在右栏开一个分支的只读 tab（与主线并排看）。 */
  onOpenSessionPane?: (sessionId: string, parentSessionId?: string | null) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemToolsChange?: (tools: ToolEntry[] | null) => void;
  onSystemInfoLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string, hint?: number | Omit<FileLocationTarget, "filePath">) => void;
  onOpenSession?: (sessionId: string) => void;
  onAskInNewChat?: (prompt: string, sourceSessionId: string, sourceEntryId: string) => Promise<void>;
  quoteSelectionEnabled?: boolean;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  /** fork:ui-projectchip — workspace selector shown on the new-session page. */
  newSessionTargets?: NewSessionTargets | null;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

function phaseLabel(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

/**
 * fork:zm-07 — 相位身份（PhaseRoll 的 key）。
 *
 * 同一个工具/命令的 progress 更新必须保持同 key（原地换文字，不重播滚动）；
 * 换工具、换相位才是一条新状态。
 */
function phaseKeyOf(phase: AgentPhase): string {
  if (!phase) return "idle";
  if (phase.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (!latest) return "tools";
    return `tools:${latest.id || latest.name}`;
  }
  return phase.kind;
}

/** fork:zm-03 — 滚动指标（纯读数，不触碰布局）。 */
function scrollMetricsOf(container: HTMLElement): { scrollTop: number; viewportHeight: number; contentHeight: number } {
  return {
    scrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    contentHeight: container.scrollHeight,
  };
}

/**
 * fork:zm-03 — 把「视口顶部附近的第一条消息」采成锚点。
 *
 * 用 rect 差而不是 `offsetTop`：offsetParent 不一定是消息容器，rect 差在任何
 * 嵌套/滚动结构下都是同一坐标系。视口之上的最后一条作为兜底（整个视口都在两条消息之间）。
 */
function captureMessageAnchor(container: HTMLElement, content: HTMLElement | null): ScrollAnchorSample | null {
  if (!content) return null;
  const viewportTop = container.getBoundingClientRect().top;
  let fallback: ScrollAnchorSample | null = null;
  for (const item of content.querySelectorAll<HTMLElement>("[data-entry-id]")) {
    const entryId = item.dataset.entryId;
    if (!entryId) continue;
    const top = item.getBoundingClientRect().top;
    const sample = captureScrollAnchor({ entryId, elementViewportTop: top, viewportTop });
    if (top >= viewportTop - 1) return sample;
    fallback = sample;
  }
  return fallback;
}

function assistantTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent?.closest("[data-message-text]")) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function rangeFromTextOffsets(root: HTMLElement, startOffset: number, endOffset: number, fallbackText?: string): Range | null {
  const nodes = assistantTextNodes(root);
  if (nodes.length === 0) return null;
  const fullText = nodes.map((node) => node.data).join("");
  let start = Number.isFinite(startOffset) ? startOffset : -1;
  let end = Number.isFinite(endOffset) ? endOffset : -1;
  if (start < 0 || end <= start || end > fullText.length) {
    if (!fallbackText) return null;
    const match = fullText.indexOf(fallbackText);
    if (match < 0) return null;
    start = match;
    end = match + fallbackText.length;
  }
  const locate = (target: number): [Text, number] | null => {
    let cursor = 0;
    for (const node of nodes) {
      const next = cursor + node.data.length;
      if (target <= next) return [node, Math.max(0, target - cursor)];
      cursor = next;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.data.length] : null;
  };
  const startPoint = locate(start);
  const endPoint = locate(end);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint[0], startPoint[1]);
  range.setEnd(endPoint[0], endPoint[1]);
  return range;
}

// ---------------------------------------------------------------------------
// fork:zc-02 — CSS Custom Highlight painting for the in-conversation find bar.
//
// Why ranges instead of <mark> elements: MarkdownBody is memoized and re-rendered
// on every streamed chunk, so injecting highlight markup into its React tree would
// invalidate that memoization and fight incremental streaming. The CSS Custom
// Highlight API paints over the existing DOM without touching React. Environments
// without it (jsdom, older browsers) are a safe no-op: the bar still counts and
// navigates, it just cannot paint.
// ---------------------------------------------------------------------------
const CONVERSATION_FIND_HIGHLIGHT = "pi-conversation-find";
const CONVERSATION_FIND_ACTIVE_HIGHLIGHT = "pi-conversation-find-active";
const CONVERSATION_FIND_STYLE_ID = "pi-conversation-find-highlight-style";
const CONVERSATION_FIND_HIGHLIGHT_CSS = `
::highlight(${CONVERSATION_FIND_HIGHLIGHT}) {
  background-color: var(--accent-soft);
  color: var(--text);
}
::highlight(${CONVERSATION_FIND_ACTIVE_HIGHLIGHT}) {
  background-color: var(--accent);
  color: var(--bg);
}
`;

interface ConversationHighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

interface ConversationHighlightLike {
  priority?: number;
}

type ConversationHighlightConstructor = new (...ranges: Range[]) => unknown;

function conversationHighlightSupport(): {
  registry: ConversationHighlightRegistryLike;
  Highlight: ConversationHighlightConstructor;
} | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: ConversationHighlightRegistryLike }).highlights;
  const Highlight = (globalThis as unknown as { Highlight?: ConversationHighlightConstructor }).Highlight;
  if (!registry || typeof Highlight !== "function") return null;
  return { registry, Highlight };
}

function ensureConversationFindHighlightStyle(): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(CONVERSATION_FIND_STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = CONVERSATION_FIND_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== CONVERSATION_FIND_HIGHLIGHT_CSS) {
    style.textContent = CONVERSATION_FIND_HIGHLIGHT_CSS;
  }
}

function isConversationFindIgnoredText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest(
    "button,input,textarea,select,script,style,[contenteditable='true'],[aria-hidden='true']",
  ));
}

/** All non-overlapping occurrences of `query` among the element's text nodes. */
function conversationFindRangesIn(
  root: HTMLElement,
  query: string,
  caseSensitive: boolean,
  limit = CONVERSATION_FIND_MAX_HITS,
): Range[] {
  const needle = query.trim();
  if (needle.length === 0 || limit <= 0) return [];
  const comparable = caseSensitive ? needle : needle.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (!isConversationFindIgnoredText(text)) {
      const haystack = caseSensitive ? text.data : text.data.toLowerCase();
      let from = 0;
      while (from <= haystack.length - comparable.length) {
        const start = haystack.indexOf(comparable, from);
        if (start < 0) break;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + comparable.length);
        ranges.push(range);
        if (ranges.length >= limit) return ranges;
        from = start + comparable.length;
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function conversationFindAnchor(root: ParentNode, entryId: string | undefined | null): HTMLElement | null {
  if (!entryId || typeof CSS === "undefined" || typeof CSS.escape !== "function") return null;
  return root.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
}

/**
 * Closest anchored message to an entry that has no DOM anchor of its own.
 * Grouped process messages (thinking / tool calls / tool results) render inside
 * a shared process-group element, so a hit there can only be located by turn.
 */
function nearestConversationFindAnchor(
  root: HTMLElement,
  entryId: string,
  entryIds: readonly string[],
): HTMLElement | null {
  const targetIndex = entryIds.indexOf(entryId);
  if (targetIndex < 0) return null;
  let best: HTMLElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  root.querySelectorAll<HTMLElement>("[data-entry-id]").forEach((anchor) => {
    const anchorId = anchor.dataset.entryId;
    if (!anchorId) return;
    const anchorIndex = entryIds.indexOf(anchorId);
    if (anchorIndex < 0) return;
    const distance = Math.abs(anchorIndex - targetIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  });
  return best;
}

function applyConversationFindHighlights(
  root: HTMLElement,
  query: string,
  activeHit: ConversationFindHit | null,
): Range | null {
  ensureConversationFindHighlightStyle();
  const support = conversationHighlightSupport();
  if (!support) return null;

  const allRanges = conversationFindRangesIn(root, query, false);
  let activeRange: Range | null = null;
  const anchor = conversationFindAnchor(root, activeHit?.entryId);
  if (activeHit && anchor) {
    const anchorRanges = conversationFindRangesIn(anchor, query, false);
    if (anchorRanges.length > 0) {
      // `occurrence` counts model-level hits; collapsed or deferred blocks may
      // not be mounted, so clamp to the nearest rendered occurrence instead of
      // dropping the active highlight entirely.
      activeRange = anchorRanges[Math.min(Math.max(activeHit.occurrence, 0), anchorRanges.length - 1)] ?? null;
    }
  }

  const allHighlight = new support.Highlight(...allRanges) as ConversationHighlightLike;
  allHighlight.priority = 0;
  support.registry.set(CONVERSATION_FIND_HIGHLIGHT, allHighlight);

  const activeHighlight = new support.Highlight(...(activeRange ? [activeRange] : [])) as ConversationHighlightLike;
  activeHighlight.priority = 1;
  support.registry.set(CONVERSATION_FIND_ACTIVE_HIGHLIGHT, activeHighlight);

  return activeRange;
}

function clearConversationFindHighlights(): void {
  const support = conversationHighlightSupport();
  if (!support) return;
  support.registry.delete(CONVERSATION_FIND_HIGHLIGHT);
  support.registry.delete(CONVERSATION_FIND_ACTIVE_HIGHLIGHT);
}

// fork:zc-02 — cap on how much history the find bar pages in before it reports
// partial results; unbounded loading would turn a search in a 5k-message session
// into hundreds of requests.
const CONVERSATION_FIND_MAX_SEARCH_MESSAGES = 2000;
// fork:zc-02 — 把窗口撑到命中处时多带几条，避免命中恰好贴在可视区边缘。
const CONVERSATION_FIND_REVEAL_MARGIN = 8;

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 12;
// fork:ui-22 — density scales the column gutter too; the value stays a CSS calc so
// the density hook only has to write one variable.
const CHAT_COLUMN_PADDING_CSS = `calc(${CHAT_COLUMN_PADDING}px * var(--fork-density, 1))`;
// A dialog replacing another one within this window is a single interaction
// (e.g. select followed by a free-text input) and must not re-ring.
const EXTENSION_DIALOG_SOUND_MIN_GAP_MS = 2000;

function NewSessionUpdateLink({
  label,
}: {
  label: (version: string) => string;
}) {
  const [update, setUpdate] = useState<AppUpdateResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app-update", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AppUpdateResponse>;
      })
      .then((result) => {
        if (result?.updateAvailable && result.latestVersion && result.releaseUrl) {
          setUpdate(result);
        }
      })
      .catch(() => {
        // Update checks are best-effort and must not interrupt a new session.
      });
    return () => controller.abort();
  }, []);

  if (!update) return null;
  const accessibleLabel = label(update.latestVersion);

  return (
    <a
      href={update.releaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "center",
        gap: 3,
        minHeight: 32,
        minWidth: 0,
        padding: "0 4px",
        background: "transparent",
        borderRadius: "var(--radius-xs)",
        color: "var(--accent)",
        fontSize: TEXT.sm,
        fontWeight: 600,
        lineHeight: 1.2,
        textDecoration: "none",
        transition: "background 0.12s",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>v{update.latestVersion}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, defaultExpanded = false, reveal = false, summaryText, children, t }: { messageCount: number; toolCallCount: number; defaultExpanded?: boolean; reveal?: boolean; summaryText?: string; children: ReactNode; t: (key: string, params?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useLayoutEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  // The grouped renderer supplies its own summary (tool count, failures,
  // thoughts). Composing the default label on top of it produced two stacked
  // count lines — "处理详情 · 29 条消息 · 29 次工具调用" above
  // "29 次工具调用 · 5 段思考" — so the caller can replace it wholesale.
  const parts = [t("chat.processDetails"), `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`);
  const label = summaryText ?? parts.join(" · ");

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        aria-expanded={expanded || reveal}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: TEXT.sm,
          textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </button>
      </div>
      {(expanded || reveal) && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ChatWindow({ session, searchTarget, onSearchTargetHandled, initialScrollPosition, onScrollPositionChange, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd, onAgentError, onAttentionNeeded, onSessionCreated, onSessionForked, onOpenSessionPane, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onSystemInfoLoaderChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile, onOpenSession, onAskInNewChat, quoteSelectionEnabled = false, initialPrompt, onInitialPromptConsumed, newSessionTargets = null, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio, onEmptyChange }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const completionNotificationsEnabled = session?.relation?.kind !== "subagent";

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const extensionDialogLastSoundAtRef = useRef(0);
  const wrappedOnAgentEnd = useCallback(() => {
    if (completionNotificationsEnabled && soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [completionNotificationsEnabled, onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  const initialScrollPositionRef = useRef(searchTarget ? null : initialScrollPosition ?? null);
  const [pendingScrollRestore, setPendingScrollRestore] = useState<Extract<ChatScrollPosition, { atBottom: false }> | null>(() => {
    const position = initialScrollPositionRef.current;
    return position && !position.atBottom ? position : null;
  });
  const [restoreAnchorReady, setRestoreAnchorReady] = useState(false);
  // Lifted expanded state for tool calls — survives streaming re-renders and
  // stream → history promotion (keyed by toolCallId, fallback to stream/entry index).
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const handleToggleTool = useCallback((id: string) => {
    setExpandedToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    setExpandedToolIds(new Set());
  }, [session?.id]);

  // fork:ui-stats-inline — 会话统计面板现在长在 composer 下方（状态条右端），
  // 原来顶栏那个按钮/浮层已移除；`/session` 等外部入口改为就地展开。
  const [statsExpanded, setStatsExpanded] = useState(false);
  useEffect(() => {
    setStatsExpanded(false);
  }, [session?.id]);
  const handleSessionStatsPanelOpen = useCallback(() => {
    setStatsExpanded(true);
    onSessionStatsPanelOpen?.();
  }, [onSessionStatsPanelOpen]);

  const {
    loading, error, messages, activeToolResults, entryIds, historyCursor, hasEarlierMessages, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, setNoticePaused,
    addNotice,
    isAutoModelSelection,
    agentPhase,
    isNew,
    showScrollToBottom,
    sessionIdRef, scrollContainerRef,
    lastUserMsgRef, promptAnchorActive,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    // fork:proma-04-rewind
    handleRewind, rewinding,
    // fork:proma-02-mode
    permissionMode, handlePermissionModeChange,
    // fork:gap04-queue
    handleQueueRemove, handleQueueMove, handleQueuePromote,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands, scrollUserMsgToTop,
    loadContext, activeLeafId, scrollToBottom, scrollToMessage,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd: wrappedOnAgentEnd, onAgentError, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onSystemInfoLoaderChange, onSessionStatsPanelOpen: handleSessionStatsPanelOpen,
    deferInitialScroll: Boolean(pendingScrollRestore),
  });
  const sessionBusy = agentRunning || bashRunning;

  // fork:fix-memory-refresh — 前台会话懒检查记忆周检（FIX-11）：非运行中、
  // 非子 Agent 会话才触发；每个应用生命周期最多一次，冷却状态在服务端。
  const memoryInvitationEnabled = Boolean(session) && !sessionBusy && session?.relation?.kind !== "subagent";
  useMemoryInvitation({
    enabled: memoryInvitationEnabled,
    onInvite: useCallback((days: number | null) => {
      addNotice({
        type: "warning",
        message: t("memory.inviteNotice", { days: days ?? "—" }),
      });
    }, [addNotice, t]),
  });
  const locateSelectionContext = useCallback((context: SelectionContext) => {
    const clearConversationLocation = () => {
      scrollContainerRef.current?.querySelectorAll<HTMLElement>(`.${LOCATION_HIGHLIGHT_CLASS}`).forEach((highlight) => {
        highlight.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      });
      // Do this before the workspace starts switching tabs. Otherwise the
      // source/preview viewer can interpret the old chat selection as a new
      // workspace selection and open its action popover.
      window.getSelection()?.removeAllRanges();
      clearLocationTextHighlight();
    };
    clearConversationLocation();
    if (context.sourceFilePath) {
      onOpenFile?.(context.sourceAbsolutePath ?? context.sourceFilePath, {
        sourceSessionId: context.sourceSessionId,
        startLine: context.sourceStartLine,
        endLine: context.sourceEndLine,
        text: context.text,
      });
      return;
    }
    if (!context.sourceEntryId) return;
    const selector = `[data-entry-id="${CSS.escape(context.sourceEntryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    scrollToMessage(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = rangeFromTextOffsets(
      element,
      context.sourceStartOffset ?? -1,
      context.sourceEndOffset ?? -1,
      context.text,
    );
    if (!range) return;
    element.classList.add(LOCATION_HIGHLIGHT_CLASS);
    setLocationTextHighlight(range);
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const padding = 16;
      const delta = rangeRect.top < containerRect.top + padding
        ? rangeRect.top - (containerRect.top + padding)
        : rangeRect.bottom > containerRect.bottom - padding
          ? rangeRect.bottom - (containerRect.bottom - padding)
          : 0;
      if (delta) container.scrollBy({ top: delta, behavior: "instant" });
    });
  }, [onOpenFile, scrollContainerRef, scrollToMessage]);

  useEffect(() => {
    const clearConversationLocation = () => {
      scrollContainerRef.current?.querySelectorAll<HTMLElement>(`.${LOCATION_HIGHLIGHT_CLASS}`).forEach((highlight) => {
        highlight.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      });
      clearLocationTextHighlight();
    };
    const clearOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearConversationLocation();
    };
    document.addEventListener("pointerdown", clearConversationLocation, true);
    document.addEventListener("keydown", clearOnKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", clearConversationLocation, true);
      document.removeEventListener("keydown", clearOnKeyDown, true);
      clearConversationLocation();
    };
  }, [scrollContainerRef]);

  const [quotedSelection, setQuotedSelection] = useState<{
    text: string;
    top: number;
    left: number;
    sourceEntryId?: string;
  } | null>(null);
  const [quoteInputOpen, setQuoteInputOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quotePopoverRef = useRef<HTMLDivElement | null>(null);
  const quoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const closeQuotedSelection = useCallback(() => {
    setQuotedSelection(null);
    setQuoteInputOpen(false);
    setQuoteError(null);
  }, []);

  useEffect(() => {
    if (!quoteSelectionEnabled) closeQuotedSelection();
  }, [quoteSelectionEnabled, closeQuotedSelection]);

  const captureQuotedSelection = useCallback(() => {
    if (!quoteSelectionEnabled || quoteInputOpen) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const root = messageContentRef.current;
    if (!selection || selection.isCollapsed || !range || !root || !root.contains(range.commonAncestorContainer)) {
      setQuotedSelection(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setQuotedSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const sourceEntryId = [ancestor, start, end]
      .map((element) => element?.closest<HTMLElement>("[data-message-role=\"assistant\"]")?.dataset.entryId)
      .find((entryId): entryId is string => Boolean(entryId));
    setQuotedSelection({
      text,
      top: Math.min(window.innerHeight - 44, rect.bottom + 8),
      left: Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)),
      sourceEntryId,
    });
  }, [quoteSelectionEnabled, quoteInputOpen]);

  useEffect(() => {
    if (!quoteInputOpen || !quotedSelection) return;
    quoteChatInputRef.current?.insertIfEmpty(buildQuotedSelection(
      quotedSelection.text,
      t("chat.quoteIntro"),
      t("chat.quoteQuestion"),
    ));
  }, [quoteInputOpen, quotedSelection, t]);

  useLayoutEffect(() => {
    const popover = quotePopoverRef.current;
    if (!popover || !quotedSelection) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(quotedSelection.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(quotedSelection.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [quotedSelection, quoteInputOpen, quoteError]);

  useEffect(() => {
    if (!quotedSelection) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!quoteInputOpen && !quotePopoverRef.current?.contains(event.target as Node)) closeQuotedSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!quoteSubmitting) closeQuotedSelection();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection]);

  const askSelectionHere = useCallback(() => {
    if (!quotedSelection) return;
    chatInputRef?.current?.addSelectionContext({
      id: createSelectionContextId(),
      text: quotedSelection.text,
      sourceSessionId: sessionIdRef.current ?? session?.id,
      sourceEntryId: quotedSelection.sourceEntryId,
      label: t("chat.selectedText"),
    });
    window.getSelection()?.removeAllRanges();
    closeQuotedSelection();
  }, [chatInputRef, quotedSelection, closeQuotedSelection, session?.id, sessionIdRef, t]);

  const askSelectionInNewChat = useCallback(async (prompt: string) => {
    const sourceSessionId = sessionIdRef.current ?? session?.id;
    if (quoteSubmitting || !prompt.trim() || !quotedSelection?.sourceEntryId || !sourceSessionId || !onAskInNewChat) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    unlockAudio?.();
    try {
      await onAskInNewChat(
        prompt,
        sourceSessionId,
        quotedSelection.sourceEntryId,
      );
      closeQuotedSelection();
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }, [onAskInNewChat, quotedSelection, quoteSubmitting, session?.id, sessionIdRef, closeQuotedSelection, unlockAudio]);

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (loading || error || !initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    onInitialPromptConsumed?.();
    void handleSend(initialPrompt);
  }, [initialPrompt, loading, error, handleSend, onInitialPromptConsumed]);

  useEffect(() => {
    if (
      !completionNotificationsEnabled
      || !extensionDialog
      || soundedExtensionDialogIdRef.current === extensionDialog.id
    ) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    const now = Date.now();
    if (now - extensionDialogLastSoundAtRef.current < EXTENSION_DIALOG_SOUND_MIN_GAP_MS) return;
    extensionDialogLastSoundAtRef.current = now;
    playDoneSoundRef.current();
  }, [completionNotificationsEnabled, extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  // fork:zm-03 — 滚动跟随权 + prepend 锚点（纯逻辑见 lib/scroll-follow.ts）。
  // followingRef 只由真实用户输入改变；程序化滚动（流式贴底 / resize / prepend）读取它。
  const followingRef = useRef(initialFollowing());
  const prependAnchorRef = useRef<ScrollAnchorSample | null>(null);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const layoutShiftUntilRef = useRef(0);
  const userIntentRef = useRef<ScrollIntent>("none");
  const touchYRef = useRef<number | null>(null);
  // fork:zm-03 — 发消息后 `scrollUserMsgToTop` 会把消息顶到视口顶部（远离底部）；
  // 这次程序化滚动必须保持 following=true，否则随后的流式内容会被否决权挡住。
  // 用短窗口而不是布尔量：万一那次滚动没产生事件，窗口过期后不会误判用户滚动。
  const sendFollowUntilRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const restoreStartedRef = useRef(false);
  const pendingScrollRestoreRef = useRef(pendingScrollRestore);
  pendingScrollRestoreRef.current = pendingScrollRestore;
  const [pendingSearchScroll, setPendingSearchScroll] = useState<Props["searchTarget"]>(null);
  const searchMessage = messages[entryIds.indexOf(pendingSearchScroll?.entryId ?? "")];
  const searchBlock = searchMessage?.role === "assistant"
    ? (pendingSearchScroll?.blockIndex === undefined
      ? searchMessage.content.find((block) => block.type === "text")
      : searchMessage.content[pendingSearchScroll.blockIndex])
    : undefined;
  const searchHistoryRef = useRef({ entryIds, historyCursor, hasEarlierMessages });
  searchHistoryRef.current = { entryIds, historyCursor, hasEarlierMessages };

  useLayoutEffect(() => {
    const sessionId = session?.id;
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!sessionId || !onScrollPositionChange || !container || !content) return;
    return () => {
      if (pendingScrollRestoreRef.current) return;
      if (isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) {
        onScrollPositionChange(sessionId, { atBottom: true });
        return;
      }
      const viewportTop = container.getBoundingClientRect().top;
      const candidates = Array.from(content.children).flatMap((element) => {
        if (!(element instanceof HTMLElement) || !element.dataset.entryId) return [];
        const rect = element.getBoundingClientRect();
        return [{ entryId: element.dataset.entryId, top: rect.top, bottom: rect.bottom }];
      });
      const anchor = findChatScrollAnchor(candidates, viewportTop);
      if (!anchor) return;
      onScrollPositionChange(sessionId, {
        atBottom: false,
        ...anchor,
        oldestEntryId: searchHistoryRef.current.historyCursor,
      });
    };
  }, [loading, onScrollPositionChange, scrollContainerRef, session?.id]);

  useEffect(() => {
    if (searchTarget) setPendingScrollRestore(null);
  }, [searchTarget]);

  useEffect(() => {
    const position = pendingScrollRestore;
    const sessionId = session?.id;
    if (!position || !sessionId || loading || searchTarget || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const controller = new AbortController();

    const locate = async () => {
      const initialHistory = searchHistoryRef.current;
      if (initialHistory.entryIds.includes(position.anchorEntryId)) {
        setVisibleCount((current) => Math.max(current, initialHistory.entryIds.length * 2));
        setRestoreAnchorReady(true);
        return;
      }

      loadingOlderRef.current = true;
      let before = initialHistory.historyCursor;
      let hasMore = initialHistory.hasEarlierMessages;
      try {
        while (hasMore && before && !controller.signal.aborted) {
          const context = await loadContext(sessionId, activeLeafId, before, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!context) {
            scrollToBottom("instant");
            setPendingScrollRestore(null);
            return;
          }
          setVisibleCount((current) => current + Math.max(VISIBLE_PAGE_SIZE, context.messages.length * 2));
          if (context.entryIds.includes(position.anchorEntryId)) {
            setRestoreAnchorReady(true);
            return;
          }
          if (context.oldestEntryId === position.oldestEntryId) break;
          before = context.oldestEntryId;
          hasMore = context.hasMore;
        }
        if (!controller.signal.aborted) {
          scrollToBottom("instant");
          setPendingScrollRestore(null);
        }
      } finally {
        loadingOlderRef.current = false;
      }
    };

    void locate();
    return () => {
      controller.abort();
      // A branch change cancels restoration and must reveal the new context.
      setPendingScrollRestore(null);
    };
  }, [activeLeafId, loadContext, loading, pendingScrollRestore, scrollToBottom, searchTarget, session?.id]);

  useLayoutEffect(() => {
    const position = pendingScrollRestore;
    const content = messageContentRef.current;
    if (!position || !content || searchTarget) return;
    const element = Array.from(content.children).find((candidate) => (
      candidate instanceof HTMLElement && candidate.dataset.entryId === position.anchorEntryId
    ));
    if (element instanceof HTMLElement) {
      scrollToMessage(element, position.anchorOffset);
      setPendingScrollRestore(null);
      return;
    }
    if (restoreAnchorReady) {
      scrollToBottom("instant");
      setPendingScrollRestore(null);
    }
  }, [entryIds, pendingScrollRestore, restoreAnchorReady, scrollToBottom, scrollToMessage, searchTarget, visibleCount]);

  useEffect(() => {
    if (!searchTarget || loading) return;
    const controller = new AbortController();
    const locate = async () => {
      const history = searchHistoryRef.current;
      let found = history.entryIds.includes(searchTarget.entryId);
      if (!found && !sessionBusy && history.hasEarlierMessages && history.historyCursor && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        const container = scrollContainerRef.current;
        if (container) prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
        // ponytail: one extra page of 200 entries; deeper or other-branch hits just open the session.
        const context = await loadContext(searchTarget.sessionId, activeLeafId, history.historyCursor, { tail: 200, signal: controller.signal });
        loadingOlderRef.current = false;
        found = Boolean(context?.entryIds.includes(searchTarget.entryId));
      }
      if (controller.signal.aborted) return;
      if (found) {
        prevScrollDistanceRef.current = null;
        setVisibleCount((current) => Math.max(current, (searchHistoryRef.current.entryIds.length + 200) * 2));
        setPendingSearchScroll(searchTarget);
      } else {
        onSearchTargetHandled?.(searchTarget);
      }
    };
    void locate();
    return () => controller.abort();
  }, [searchTarget, loading, activeLeafId, sessionBusy, loadContext, onSearchTargetHandled, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!pendingSearchScroll || pendingSearchScroll !== searchTarget) return;
    const selector = `[data-entry-id="${CSS.escape(pendingSearchScroll.entryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(searchMessage?.role === "user" ? selector : `${selector} [data-search-target]`);
    if (element) {
      scrollToMessage(element);
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduceMotion) {
        element.animate([
          { backgroundColor: "var(--bg-selected)" },
          { backgroundColor: "transparent" },
        ], { duration: 2500 });
      }
    }
    setPendingSearchScroll(null);
    onSearchTargetHandled?.(pendingSearchScroll);
  }, [pendingSearchScroll, searchTarget, searchMessage, scrollContainerRef, scrollToMessage, onSearchTargetHandled]);

  // Load one older page of history. Shared by the top sentinel (triggered by
  // scrolling) and the minimap's "Load earlier" row so both paths keep a
  // single in-flight guard and the same scroll-anchoring capture.
  const loadOlderPage = useCallback(async () => {
    // Skip while a page is already loading or nothing older exists.
    if (loadingOlderRef.current) return;
    if (!hasEarlierMessages) return;
    const oldestId = historyCursor;
    if (!oldestId) return;
    const sid = session?.id ?? sessionIdRef.current;
    if (!sid) return;
    const container = scrollContainerRef.current;
    if (container) {
      prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
      // fork:zm-03 — prepend 锚定：先记下「视口顶部附近那条消息」的像素偏移，
      // 插入后按同一元素的实时位置把它放回去，而不是只补总高度差。
      prependAnchorRef.current = captureMessageAnchor(container, messageContentRef.current);
    }
    loadingOlderRef.current = true;
    setLoadingEarlier(true);
    try {
      // loadContext handles prepend + scroll anchoring.
      const context = await loadContext(sid, activeLeafId, oldestId);
      if (!context) {
        // 拉取失败：不要让本次采样留给下一次无关的 visibleCount 变化。
        prevScrollDistanceRef.current = null;
        prependAnchorRef.current = null;
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingEarlier(false);
    }
  }, [activeLeafId, hasEarlierMessages, historyCursor, loadContext, scrollContainerRef, session?.id, sessionIdRef]);

  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void loadOlderPage();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderPage, scrollContainerRef]);

  // Keep the rendered window at least as large as what's loaded, so prepended
  // (older) pages stay visible instead of being sliced off the top.
  useEffect(() => {
    setVisibleCount((current) => Math.max(current, messages.length));
  }, [messages.length]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  //
  // fork:zm-03 — 优先用消息锚点（offsetTop 语义）而不是「距底距离」：图片异步加载、
  // 折叠展开都会改变高度，距底补偿会漂；锚点按像素把同一条消息放回原视口偏移。
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) {
      // 搜索跳转等显式导航会清掉这个 ref 来取消本次恢复；锚点同样清掉。
      prependAnchorRef.current = null;
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const savedDistance = prevScrollDistanceRef.current;
    const anchor = prependAnchorRef.current;
    prevScrollDistanceRef.current = null;
    prependAnchorRef.current = null;

    if (anchor) {
      const element = messageContentRef.current?.querySelector<HTMLElement>(
        `[data-entry-id="${CSS.escape(anchor.entryId)}"]`,
      );
      if (element) {
        const target = resolvePrependRestoreScrollTop(anchor, {
          elementViewportTop: element.getBoundingClientRect().top,
          viewportTop: container.getBoundingClientRect().top,
          scrollTop: container.scrollTop,
        });
        if (target !== null) {
          programmaticScrollTargetRef.current = target;
          container.scrollTop = target;
          return;
        }
      }
    }

    const fallback = restoreScrollTop(container.scrollHeight, savedDistance);
    programmaticScrollTargetRef.current = fallback;
    container.scrollTop = fallback;
  }, [visibleCount, scrollContainerRef]);

  // ---------------------------------------------------------------------------
  // fork:zm-03 — 滚动跟随状态机（用户意图优先）。
  //
  // 背景：`useAgentSession` 里的 live-follow 只看自己的 near-bottom 旗标；
  // 一次程序化滚动（流式追加 / 窗口 resize / prepend）就可能把用户读到的位置拉回底部。
  // 这里按来源拆分（user / programmatic / layout）：只有 wheel / touch / 键盘 + 用户
  // 落点能改变 following；此外一律不动。并在 following=false 时否决
  // 「滚到最底」的程序化请求（lib/scroll-follow.ts 的 shouldAllowProgrammaticScroll）。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const applyFollowing = (next: boolean) => {
      if (followingRef.current === next) return;
      followingRef.current = next;
      // data 属性方便调试与以后按需做样式分支，不参与渲染。
      container.dataset.forkFollowing = next ? "true" : "false";
    };

    const onWheel = (event: WheelEvent) => {
      const intent = wheelScrollIntent(event.deltaY);
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? null;
      const previousY = touchYRef.current;
      touchYRef.current = nextY;
      if (nextY === null || previousY === null) return;
      const intent = touchScrollIntent(previousY, nextY);
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editableTarget = Boolean(target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      ));
      const intent = keyboardScrollIntent({ key: event.key, shiftKey: event.shiftKey, editableTarget });
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onScroll = () => {
      // 任何带用户意图的滚动都取消「刚发消息」窗口，用户操作永远优先。
      if (userIntentRef.current !== "none") sendFollowUntilRef.current = 0;
      if (
        sendFollowUntilRef.current > Date.now()
        && userIntentRef.current === "none"
        && programmaticScrollTargetRef.current === null
      ) {
        sendFollowUntilRef.current = 0;
        applyFollowing(true);
        return;
      }
      const metrics = scrollMetricsOf(container);
      const pendingTarget = programmaticScrollTargetRef.current;
      let source: ScrollEventSource = "user";
      if (pendingTarget !== null) {
        // 任何 scroll 事件都消费掉待定目标，避免它留给之后的用户滚动误判。
        programmaticScrollTargetRef.current = null;
        if (Math.abs(metrics.scrollTop - pendingTarget) <= 2 || userIntentRef.current === "none") {
          source = "programmatic";
        }
      } else if (userIntentRef.current === "none" && layoutShiftUntilRef.current > Date.now()) {
        source = "layout";
      }
      const intent = userIntentRef.current;
      userIntentRef.current = "none";
      if (source === "user" && intent === "awayFromBottom") {
        // 上滑意图立即生效（哪怕只滑了 10px，仍在 48px 容差内）。
        applyFollowing(false);
        return;
      }
      applyFollowing(resolveFollowingAfterScroll({
        following: followingRef.current,
        metrics,
        source,
      }));
    };

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainerRef, session?.id]);

  // fork:zm-03 — 程序化「滚到最底」的否决权。
  // live-follow 在 `useAgentSession` 里调用 `container.scrollTo({ top: scrollHeight })`；
  // 用户已上滑时把它拦住，流式追加就不再抢走阅读位置。其它滚动目标（跳转到某条消息、
  // prepend 锚定）不受影响。
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const originalScrollTo = container.scrollTo;
    const guarded = ((...args: unknown[]) => {
      const first = args[0] as ScrollToOptions | number | undefined;
      const requestedTop = typeof first === "number" ? first : first?.top;
      if (typeof requestedTop === "number" && !shouldAllowProgrammaticScroll({
        requestedTop,
        contentHeight: container.scrollHeight,
        following: followingRef.current,
      })) {
        // 被否决的贴底不会产生 scroll 事件；清掉目标，别留给下一次用户滚动误判。
        programmaticScrollTargetRef.current = null;
        return;
      }
      return (originalScrollTo as (...inner: unknown[]) => void).apply(container, args);
    }) as typeof container.scrollTo;
    container.scrollTo = guarded;
    return () => {
      if (container.scrollTo === guarded) container.scrollTo = originalScrollTo;
    };
  }, [scrollContainerRef, session?.id]);

  // fork:zm-03 — 视口尺寸变化（窗口 resize / 移动端键盘）会让内容重排：
  // 跟随时贴回底部，不跟随时不动（浏览器原生 overflow-anchor 会保住阅读位置）。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      layoutShiftUntilRef.current = Date.now() + 150;
      if (!followingRef.current) return;
      programmaticScrollTargetRef.current = container.scrollHeight;
      scrollToBottom("auto");
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef, scrollToBottom, session?.id]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    // fork:gap07-attachments — 拖拽入口与其他入口统一：图片内联，其余落盘后插路径引用
    chatInputRef?.current?.addFiles(files);
  }, [chatInputRef]);

  const { isDragOver, isRejectedDrag, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => isMessageGroupAnchor(m) || m.role === "assistant");
  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamState), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map(activeToolResults);
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [activeToolResults, messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);
  // fork:fix-render-split — 见下方 attachVisibleRefCached：ref 回调按 (idx, refIndex) 缓存，
  // 避免每次渲染都新建 N 个函数导致逐帧 ref 抖动。
  const visibleRefCacheRef = useRef<Map<string, (el: HTMLDivElement | null) => void> | null>(null);
  const revealHistoryForMinimap = useCallback(() => {
    setVisibleCount((current) => Math.max(current, messages.length * 2));
  }, [messages.length]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  // fork:zc-17 — 零会话首屏引导：新会话页 + 已知项目为空（= 侧栏一个会话都没有）才出现。
  const showEmptyStateGuide = isEmptyNew && (newSessionTargets?.projects.length ?? -1) === 0;
  // fork:zn-03 — report emptiness up (Zeno shows ThreadHeader only once the
  // timeline has activity). Effect, not render-time call: the parent setState
  // must not run during this render.
  useEffect(() => {
    onEmptyChange?.(isEmptyNew);
  }, [isEmptyNew, onEmptyChange]);

  // ---------------------------------------------------------------------------
  // fork:zc-10 — 计划快照广播 + 权限档位请求（右栏 PlanPane 的接线）。
  //
  // pi 不写计划文件，所以「当前计划」= 最后一条 assistant 消息里的编号列表；
  // 流式中的消息也并进来，右栏能看着计划逐条长出来。签名相同就不重复广播。
  // ---------------------------------------------------------------------------
  // 已提交消息里的计划：只在 messages 变化时重算（大多数帧都命中缓存）。
  // -------------------------------------------------------------------------
  // fork:zc-02 — in-conversation find (⌘F).
  //
  // The chat renders a paged window, not a virtualized list, and only the newest
  // ~50 messages are loaded at first; a DOM-only search would answer "no results"
  // for exactly the old hits long sessions contain. The model index
  // (lib/conversation-find.ts) is therefore the source of truth for counting and
  // stepping; `loadOlderPage` is reused to page history in until the search cap is
  // hit, and the DOM is only painted (ranges above) and scrolled.
  // -------------------------------------------------------------------------
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveKey, setFindActiveKey] = useState<string | null>(null);
  const [findNavSeq, setFindNavSeq] = useState(0);
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  const findPreviousFocusRef = useRef<HTMLElement | null>(null);
  const findLastScrollKeyRef = useRef("");

  const findIndex = useMemo(() => buildSearchIndex(messages, entryIds), [messages, entryIds]);
  const findResult = useMemo(() => findHits(findIndex, findQuery), [findIndex, findQuery]);
  const findHitsList = findResult.hits;
  const findActiveIndex = useMemo(() => {
    if (findHitsList.length === 0) return -1;
    if (findActiveKey) {
      const index = findHitsList.findIndex((hit) => conversationFindHitKey(hit) === findActiveKey);
      if (index >= 0) return index;
    }
    return 0;
  }, [findActiveKey, findHitsList]);
  const activeFindHit = findActiveIndex >= 0 ? findHitsList[findActiveIndex] ?? null : null;
  // fork:zc-02 — 把当前命中转成既有的 `searchBlock`（会话搜索跳转用的同一条通路）：
  // 它会让那个块展开（thinking 触发惰性加载、工具卡展开结果），正文进 DOM 后
  // 高亮与滚动才有 Range 可用。命中里 194/197 落在 thinking / 工具输出上，
  // 不走这一步就只是「计数在动、画面不动」。
  const findSearchBlock = useMemo(() => {
    if (!activeFindHit || activeFindHit.blockIndex < 0) return undefined;
    const message = messages[entryIds.indexOf(activeFindHit.entryId)];
    if (!message || !Array.isArray((message as { content?: unknown }).content)) return undefined;
    return (message as { content: AssistantContentBlock[] }).content[activeFindHit.blockIndex];
  }, [activeFindHit, entryIds, messages]);
  // fork:zc-02 — 命中落在工具结果里时，要展开的是**那个具体的工具卡**：
  // 分组（timeline）路径下 ToolCallBlock 自带一层折叠，只靠组级 reveal 不够。
  const findRevealToolCallId = findSearchBlock?.type === "toolCall" ? findSearchBlock.toolCallId : undefined;
  // 惰性加载的思考正文要等一次往返才进 DOM，所以命中后允许有限次重绘（上限 3 次）。
  const [findPaintSeq, setFindPaintSeq] = useState(0);
  const findPaintTriesRef = useRef(0);
  // 换命中就重置重绘预算，否则步进几次后就没预算了。
  useEffect(() => {
    findPaintTriesRef.current = 0;
  }, [activeFindHit]);
  const findSearchIncomplete = findOpen
    && findQuery.trim().length > 0
    && hasEarlierMessages
    && messages.length >= CONVERSATION_FIND_MAX_SEARCH_MESSAGES;

  // Rebase the active key onto the resolved hit. When older pages prepend, the
  // numeric index of the active hit shifts; pinning the key keeps the viewport on
  // the same message instead of jumping to whatever is now hit #0.
  const activeFindKey = conversationFindHitKey(activeFindHit);
  useEffect(() => {
    if (activeFindKey && activeFindKey !== findActiveKey) setFindActiveKey(activeFindKey);
  }, [activeFindKey, findActiveKey]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    const previous = findPreviousFocusRef.current;
    findPreviousFocusRef.current = null;
    if (previous && previous.isConnected) {
      // Defer past the unmount so focus does not land on a removed input.
      window.requestAnimationFrame(() => previous.focus());
    }
  }, []);

  const stepFind = useCallback((direction: -1 | 1) => {
    if (findHitsList.length === 0) return;
    const next = nextHitIndex(findActiveIndex, findHitsList.length, direction);
    setFindNavSeq((sequence) => sequence + 1);
    setFindActiveKey(conversationFindHitKey(findHitsList[next] ?? null));
  }, [findActiveIndex, findHitsList]);

  const handleFindQueryChange = useCallback((nextQuery: string) => {
    setFindQuery(nextQuery);
    setFindActiveKey(null);
    setFindNavSeq((sequence) => sequence + 1);
  }, []);

  // Page older history in while a query is active so hits outside the initially
  // loaded tail are found. Same loadOlderPage path (and in-flight guard) as the
  // minimap; stops at the search cap or once every page is in.
  useEffect(() => {
    if (!findOpen || findQuery.trim().length === 0) return;
    if (!hasEarlierMessages || loadingEarlier || loadingOlderRef.current) return;
    if (messages.length >= CONVERSATION_FIND_MAX_SEARCH_MESSAGES) return;
    if (findResult.truncated) return;
    void loadOlderPage();
  }, [
    findOpen,
    findQuery,
    findResult.truncated,
    hasEarlierMessages,
    loadOlderPage,
    loadingEarlier,
    messages.length,
  ]);

  // fork:zc-02 — 命中落在**渲染窗口之外**时，把窗口撑到能容纳它。
  //
  // 这是必需的一步，不是优化：命中计数基于「已加载的全部消息」（messages），
  // 而聊天列只渲染尾部 visibleCount 条（getVisibleRenderWindow 是**后缀窗口**：
  // startIndex = total - visibleCount）。不撑窗口的话，跳到较早的命中时计数会动、
  // 画面不动 —— 既没有高亮也滚不过去，看起来就是坏了。
  //
  // 上界故意用 messages.length 而不是 rendered.length：rendered 会把一轮里的过程
  // 消息合并成一个单元（长度 ≤ messages.length），按 messages 算只会多渲染一点，
  // 不会少渲染。宁可多渲染，不能漏。
  useEffect(() => {
    if (!findOpen || !activeFindHit) return;
    const hitIndex = entryIds.indexOf(activeFindHit.entryId);
    if (hitIndex < 0) return;
    const needed = messages.length - hitIndex + CONVERSATION_FIND_REVEAL_MARGIN;
    if (needed > visibleCount) setVisibleCount(Math.min(needed, messages.length));
  }, [activeFindHit, entryIds, findOpen, messages.length, visibleCount]);

  // Paint ranges and bring the active hit into view. `visibleCount` and `messages`
  // are dependencies so this re-runs after a page prepend or window expansion has
  // committed; the scroll key keeps streaming re-renders from yanking the viewport
  // back to the same hit.
  useEffect(() => {
    if (!findOpen || findQuery.trim().length === 0) {
      clearConversationFindHighlights();
      return;
    }
    const root = scrollContainerRef.current;
    if (!root) return;
    const frame = window.requestAnimationFrame(() => {
      const range = applyConversationFindHighlights(root, findQuery, activeFindHit);
      // fork:zc-02 — 思考正文是惰性加载的（展开后才拉），所以第一次重绘可能还在等
      // 那一次往返。拿不到 Range 就有限次重绘（上限 3），拿到就归零。
      if (range) {
        findPaintTriesRef.current = 0;
      } else if (activeFindHit && findPaintTriesRef.current < 3) {
        findPaintTriesRef.current += 1;
        window.setTimeout(() => setFindPaintSeq((sequence) => sequence + 1), 220);
      }
      const scrollKey = [
        findQuery,
        activeFindHit?.entryId ?? "",
        String(activeFindHit?.occurrence ?? -1),
        String(findNavSeq),
        String(findPaintSeq),
      ].join("\u0000");
      if (findLastScrollKeyRef.current === scrollKey) return;
      findLastScrollKeyRef.current = scrollKey;
      if (!activeFindHit) return;

      const anchor = conversationFindAnchor(root, activeFindHit.entryId);
      if (range && anchor) {
        // Center the matched range instead of the message top: a hit can sit deep
        // inside a long message, where top-aligning would leave it offscreen.
        const rangeRect = range.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const offset = (root.clientHeight - rangeRect.height) / 2 - (rangeRect.top - anchorRect.top);
        // Same trick as the session-search jump: cancel the pending prepend
        // scroll-anchor restore so it cannot land on top of this jump.
        prevScrollDistanceRef.current = null;
        scrollToMessage(anchor, offset);
        return;
      }
      // Grouped process messages have no `data-entry-id` anchor of their own; fall
      // back to the closest anchored message so the turn is at least shown.
      const fallback = anchor ?? nearestConversationFindAnchor(root, activeFindHit.entryId, entryIds);
      if (fallback) {
        prevScrollDistanceRef.current = null;
        scrollToMessage(fallback);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeFindHit,
    entryIds,
    findNavSeq,
    findOpen,
    findPaintSeq,
    findQuery,
    findRevealToolCallId,
    findSearchBlock,
    messages,
    scrollContainerRef,
    scrollToMessage,
    visibleCount,
  ]);

  // Clear the browser-wide highlight registry when this chat unmounts.
  useEffect(() => () => clearConversationFindHighlights(), []);

  // ⌘F / Ctrl+F opens (or refocuses) the bar. Events originating from a
  // textarea/input/contenteditable are deliberately ignored so the composer's own
  // semantics and every settings field keep native ⌘F.
  useEffect(() => {
    const onFindShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (isEmptyNew || extensionDialog) return;
      if (!findOpenRef.current) {
        findPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      event.preventDefault();
      setFindOpen(true);
      setFindFocusSeq((sequence) => sequence + 1);
      setFindNavSeq((sequence) => sequence + 1);
    };
    window.addEventListener("keydown", onFindShortcut);
    return () => window.removeEventListener("keydown", onFindShortcut);
  }, [extensionDialog, isEmptyNew]);

  // fork:ui-todo — the session's task list, read back from the transcript (the
  // built-in `todo` tool stores each list in its tool result). Memoized: the scan
  // walks the message list and the transcript re-renders on every streamed chunk.
  const todoSummary = useMemo(() => extractTodoState(messages), [messages]);
  const hasChatMinimap = !isEmptyNew && !isMobile && !pendingScrollRestore;
  const hasStreamingContent = Boolean(streamState.streamingMessage?.content.length);
  // fork:process-live-2 — the in-flight message's process blocks, converted once.
  // The running turn's timeline is assembled from two sources (the committed
  // messages of the turn and this partial one), so both call sites read the same
  // memo instead of converting the streaming message twice.
  const streamingProcess = useMemo(() => {
    const live = streamState.streamingMessage as AgentMessage | undefined;
    if (!streamState.isStreaming || !live || live.role !== "assistant") return null;
    const split = splitFinalAssistantBlocks(live);
    return {
      answerBlocks: split.answerBlocks,
      blocks: messageToProcessContentBlocks(
        { ...live, content: split.processBlocks } as AgentMessage,
        { messageIndex: messages.length, phase: "process", toolResults: toolResultsMap, isStreaming: true },
      ),
    };
  }, [streamState.isStreaming, streamState.streamingMessage, messages.length, toolResultsMap]);
  // Set by the render pass below when the grouped renderer already emitted the
  // running turn's timeline; the streaming block at the bottom of the list then
  // contributes only the answer half instead of opening a second group.
  let liveTurnTimeline = false;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const promptAnchorSpacerRef = useRef<HTMLDivElement | null>(null);
  const promptAnchorSpacerHeightRef = useRef(0);
  const promptAnchorMeasureFrameRef = useRef<number | null>(null);
  const promptAnchorAdjustmentDoneRef = useRef(false);
  const promptAnchorUpdateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const spacer = promptAnchorSpacerRef.current;
    if (!agentRunning || !promptAnchorActive) {
      promptAnchorUpdateRef.current = null;
      promptAnchorSpacerHeightRef.current = 0;
      promptAnchorAdjustmentDoneRef.current = false;
      if (spacer) spacer.style.height = "";
      return;
    }

    const container = scrollContainerRef.current;
    const messageContent = messageContentRef.current;
    const userMessage = lastUserMsgRef.current;
    if (!container || !messageContent || !userMessage || !spacer) return;

    let disposed = false;
    const updatePromptAnchorSpacer = () => {
      if (
        disposed
        || scrollContainerRef.current !== container
        || messageContentRef.current !== messageContent
        || lastUserMsgRef.current !== userMessage
        || promptAnchorSpacerRef.current !== spacer
      ) return;

      const containerTop = container.getBoundingClientRect().top;
      const userMessageTop = userMessage.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const targetTop = Math.max(0, userMessageTop - 16);
      const contentEnd = spacer.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const nextPromptAnchorSpacerHeight = getPromptAnchorSpacerHeight(
        targetTop,
        contentEnd,
        container.clientHeight,
      );

      const isInitialMeasurement = !promptAnchorAdjustmentDoneRef.current;
      const needsInitialAdjustment = isInitialMeasurement
        && nextPromptAnchorSpacerHeight > 0;
      if (isInitialMeasurement) promptAnchorAdjustmentDoneRef.current = true;
      if (nextPromptAnchorSpacerHeight === promptAnchorSpacerHeightRef.current) return;

      promptAnchorSpacerHeightRef.current = nextPromptAnchorSpacerHeight;
      spacer.style.height = nextPromptAnchorSpacerHeight > 0
        ? `${nextPromptAnchorSpacerHeight}px`
        : "";
      if (needsInitialAdjustment) scrollUserMsgToTop();
    };

    promptAnchorUpdateRef.current = updatePromptAnchorSpacer;
    const schedulePromptAnchorMeasure = () => {
      if (disposed || promptAnchorMeasureFrameRef.current !== null) return;
      promptAnchorMeasureFrameRef.current = requestAnimationFrame(() => {
        promptAnchorMeasureFrameRef.current = null;
        updatePromptAnchorSpacer();
      });
    };

    updatePromptAnchorSpacer();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePromptAnchorMeasure);
    observer?.observe(container);
    observer?.observe(messageContent);
    observer?.observe(userMessage);
    return () => {
      disposed = true;
      if (promptAnchorUpdateRef.current === updatePromptAnchorSpacer) {
        promptAnchorUpdateRef.current = null;
      }
      observer?.disconnect();
      if (promptAnchorMeasureFrameRef.current !== null) {
        cancelAnimationFrame(promptAnchorMeasureFrameRef.current);
        promptAnchorMeasureFrameRef.current = null;
      }
    };
  }, [
    agentRunning,
    lastUserMsgRef,
    messages.length,
    promptAnchorActive,
    scrollContainerRef,
    scrollUserMsgToTop,
  ]);

  useLayoutEffect(() => {
    promptAnchorUpdateRef.current?.();
  }, [streamState.streamingMessage]);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // fork:zn-04 — protrusion strip for the empty new-session state. Built here but
  // rendered by ChatInput immediately above the card; see the `protrusion` prop.
  // It only exists on the new-session page, so a normal session never renders one
  // (and therefore never loses the card's top corners).
  const composerProtrusion = isEmptyNew && newSessionTargets ? (
    <div className="fork-protrusion-bar" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 }}>
      <ProjectChip targets={newSessionTargets} />
      {/* fork:zc-17 — 空状态引导出现时，它自带轮播提示行；这里收掉一份避免同一句说两遍。 */}
      {!newSessionTargets.error && !showEmptyStateGuide && <ComposerTipLine />}
      {newSessionTargets.error && (
        <span role="alert" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: TEXT.xs, color: "var(--danger)" }}>
          {newSessionTargets.error}
        </span>
      )}
    </div>
  ) : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      protrusion={composerProtrusion}
      onSend={(message, images, contexts, question, sessionReferences) => {
        // fork:zm-03 — 发消息是「回到最新」的用户意图：先恢复跟随，再走原路径。
        followingRef.current = true;
        sendFollowUntilRef.current = Date.now() + 600;
        void handleSend(message, images, contexts, question, sessionReferences);
      }}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      // fork:proma-02-mode — 权限档位控件（Chat-only 会话由 ChatInput 自行隐藏）
      permissionMode={permissionMode}
      onPermissionModeChange={handlePermissionModeChange}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      // fork:gap04-queue — 队列逐条操控
      onQueueRemove={handleQueueRemove}
      onQueueMove={handleQueueMove}
      onQueuePromote={handleQueuePromote}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      todoSummary={todoSummary}
      // fork:gap06-references — 让 `&` 建议列表知道当前会话，把它自己剔除
      currentSessionId={session?.id ?? null}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      onLocateSelectionContext={locateSelectionContext}
      onOpenSessionReference={onOpenSession ? (reference: SessionReference) => onOpenSession(reference.id) : undefined}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8" role="status" aria-live="polite" aria-label={t("chat.loadingSession")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "min(100%, 480px)" }} aria-hidden="true">
          <div className="skeleton-line" style={{ height: 14, width: "38%" }} />
          <div className="skeleton-line" style={{ height: 56, width: "100%" }} />
          <div className="skeleton-line" style={{ height: 56, width: "92%", alignSelf: "flex-end" }} />
          <div className="skeleton-line" style={{ height: 14, width: "24%" }} />
        </div>
        <div className="text-xs text-text-muted">{t("chat.loadingSession")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className={`chat-content relative h-full min-w-0 overflow-hidden${hasChatMinimap ? " grid" : " flex flex-col"}`}
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        gridTemplateColumns: hasChatMinimap ? `minmax(0, 1fr) ${CHAT_MINIMAP_WIDTH}px` : undefined,
        gridTemplateRows: hasChatMinimap ? "minmax(0, 1fr) auto" : undefined,
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isRejectedDrag && !isDragOver && (
        <div
          role="status"
          className="anim-popover-down pointer-events-none absolute inset-x-0 top-3 z-50 mx-auto w-fit max-w-[calc(100%-32px)] px-3 py-1.5 text-xs"
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-pill)",
            color: "var(--text-muted)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {t("chat.dropFilesOnly")}
        </div>
      )}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center backdrop-blur-[1px]" style={{ background: "var(--accent-soft)" }}>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s`, borderColor: "var(--accent-border)" }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(0,0,0,0.12)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="var(--accent-border)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="var(--accent-border)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="var(--accent-border)" strokeWidth="1.6"/>
            <g stroke="var(--accent-border)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 0,
          right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
          zIndex: 40,
          display: "flex",
          // Toasts live in the top-right corner
          justifyContent: "flex-end",
          padding: `0 ${CHAT_COLUMN_PADDING_CSS}`,
          pointerEvents: "none",
        }}
      >
        <NoticeShelf notices={notices} floating onPauseChange={setNoticePaused} />
      </div>

      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        style={hasChatMinimap ? { gridColumn: "1", gridRow: "1" } : undefined}
      >
        {/* fork:zc-02 — in-conversation find bar (⌘F); state/effects live above. */}
        {findOpen && !isEmptyNew && (
          <ConversationFindBar
            query={findQuery}
            onQueryChange={handleFindQueryChange}
            hitCount={findHitsList.length}
            activeIndex={findActiveIndex}
            onNext={() => stepFind(1)}
            onPrevious={() => stepFind(-1)}
            onClose={closeFind}
            truncated={findResult.truncated || findIndex.truncated || findSearchIncomplete}
            focusSignal={findFocusSeq}
          />
        )}
        {extensionDialog && (
          <ExtensionDialog key={extensionDialog.id} request={extensionDialog} onRespond={respondToExtensionUi} />
        )}
        {extensionCustomUi && (
          <ExtensionCustomPanel key={extensionCustomUi.id} request={extensionCustomUi} onInput={sendExtensionCustomInput} />
        )}
        {/* fork:ui-newhome — hero + starter cards for a brand new session. */}
        {isEmptyNew && (
          // fork:zc-17 — 零会话首屏在 hero 之上再给三条起步路径；有项目/会话时
          // EmptyStateGuide 自己渲染成 null，布局与改动前一致。
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            <EmptyStateGuide
              targets={newSessionTargets}
              onOpenSession={onOpenSession}
              visible={showEmptyStateGuide}
            />
            <NewSessionHome
              cwd={messageCwd ?? null}
              isMobile={isMobile}
              onInsertPrompt={(text) => chatInputRef?.current?.insertIfEmpty(text)}
            />
          </div>
        )}
        {!isEmptyNew && <>
        {/* fork:zm-03 — 消息列改用 ScrollFadeViewport：顶部/底部渐隐遮罩由它按滚动位置
            自己算（inline maskImage + rAF + ResizeObserver），同时把 DOM 节点回填给
            scrollContainerRef，既有 scroll 监听与 minimap 引用保持不变。 */}
        <ScrollFadeViewport
          viewportRef={scrollContainerRef}
          // fork:upstream-0.9.2-scrollbar — 消息列是唯一必须用长输出拖动的位置，
          // 所以显示自己的滚动条而不是藏起来（minimap 只标回合）；
          // stable gutter 让短会话长出屏幕时居中列不会横向跳动。
          className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-4 [scrollbar-gutter:stable]"
          style={{ visibility: pendingScrollRestore ? "hidden" : undefined }}
        >
          <div style={{ minWidth: 0, padding: `0 ${CHAT_COLUMN_PADDING_CSS}` }}>
            <div ref={messageContentRef} onPointerUp={captureQuotedSelection} style={{ width: "100%", minWidth: 0, maxWidth: "var(--chat-content-max-width, 800px)", margin: "0 auto" }}>
            {/* fork:proma-05-explore — 从主线某条消息 fork 出来的分支：显示来源 + 把结论带回父会话草稿 */}
            {session && session.parentSessionId && (
              <ExplorationBanner
                branchSessionId={session.id}
                parentSessionId={session.parentSessionId}
                branchEntryIds={entryIds}
                branchMessages={messages}
                onOpenParent={onOpenSession}
                onOpenPane={onOpenSessionPane ? () => onOpenSessionPane(session.id, session.parentSessionId) : undefined}
              />
            )}
            {(() => {
              let lastUserIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") { lastUserIdx = i; break; }
              }
              // Anchor for live-tail detection: the last user message, or a
              // compaction summary when compaction has replaced it mid-turn.
              // Computed independently from lastUserIdx (which is kept for the
              // scroll-to-user ref) because a compaction summary can sit after
              // the last user message and anchor the still-streaming segment.
              let lastAnchorIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (isMessageGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
              }

              const visibleRefIndexByMessage = new Map<number, number>();
              let refIdx = 0;
              messages.forEach((msg, idx) => {
                if (isMessageGroupAnchor(msg) || msg.role === "assistant") {
                  visibleRefIndexByMessage.set(idx, refIdx++);
                }
              });

              // fork:fix-render-split — 稳定的 ref 回调。
              //
              // 原来每次渲染都会新建 N 个箭头函数作为 `ref`，React 因此每帧都要
              // 对每个可见消息执行「旧 ref(null) + 新 ref(node)」，流式期间就是每秒几十次
              // 与消息数成正比的无效赋值。改成按 (idx, refIndex) 缓存后，ref 只在消息
              // 真正增删时才会变动。（缓存上界 = 会话消息数 × 2，随会话增长但不会泄漏到其他会话。）
              const visibleRefCallbacks = (visibleRefCacheRef.current ??= new Map());
              const attachVisibleRefCached = (idx: number, refIndex: number, isLastUser: boolean) => {
                const cacheKey = `${refIndex}:${idx}:${isLastUser ? 1 : 0}`;
                let callback = visibleRefCallbacks.get(cacheKey);
                if (!callback) {
                  callback = (el: HTMLDivElement | null) => {
                    messageRefs.current[refIndex] = el;
                    if (isLastUser) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                  };
                  visibleRefCallbacks.set(cacheKey, callback);
                }
                return callback;
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[] } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                const isVisible = isMessageGroupAnchor(msg) || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                const messageKey = entryIds[idx] ?? idx;
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                const view = (
                  <MessageView
                    key={`${keyPrefix}-view-${messageKey}`}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenSession={onOpenSession}
                    entryId={entryIds[idx]}
                    searchBlock={entryIds[idx] === pendingSearchScroll?.entryId
                      ? searchBlock
                      // fork:zc-02 — 当前查找命中所在的块，走同一条 reveal 通路。
                      : entryIds[idx] === activeFindHit?.entryId
                        ? findSearchBlock
                        : undefined}
                    onFork={sessionBusy || isNew ? undefined : handleFork}
      // fork:proma-04-rewind — 回退是破坏性操作，先弹一道警示确认（回退不可撤销）
      onRewind={sessionBusy || isNew ? undefined : (entryId) => {
        if (!window.confirm(t("rewind.confirm"))) return;
        void handleRewind(entryId);
      }}
      rewinding={rewinding}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={sessionBusy ? undefined : handleNavigate}
                    onEditContent={handleEditContent}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    writtenFiles={options.writtenFiles}
                    expandedToolIds={expandedToolIds}
                    onToggleTool={handleToggleTool}
                  />
                );
                if (!isVisible || currentRefIdx === undefined) return view;
                return (
                  <div key={`${keyPrefix}-${messageKey}`} data-entry-id={entryIds[idx]} ref={options.attachRef === false ? undefined : attachVisibleRefCached(idx, currentRefIdx, idx === lastUserIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                if (!isMessageGroupAnchor(msg)) {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && !isMessageGroupAnchor(messages[endIdx])) endIdx += 1;

                const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                if (finalAssistantIdx === -1) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                // fork:process-live-2 — a running turn used to render flat here, and
                // only the in-flight message reached the grouped renderer. The timeline
                // therefore vanished the moment the turn's first tool call was committed
                // to `messages` and only came back once the turn finished — the "it
                // flips back to the flat list" report. The whole running turn is now one
                // timeline: its committed steps and the in-flight blocks share a group.
                const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
                if (isLiveTail) {
                  rendered.push(renderMessage(userIdx));

                  const liveBlocks: ProcessContentBlock[] = [];
                  let liveToolCalls = 0;
                  let liveRefIdx: number | undefined;
                  for (let processIdx = userIdx + 1; processIdx < endIdx; processIdx++) {
                    const processMessage = messages[processIdx];
                    if (processMessage.role !== "assistant" && processMessage.role !== "custom") continue;
                    const blocks = processMessage.role === "assistant"
                      ? getDisplayableAssistantBlocks(processMessage)
                      : [];
                    if (processMessage.role === "assistant" && blocks.length === 0) continue;
                    liveRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                    if (processMessage.role === "assistant") liveToolCalls += countToolCallBlocks(blocks);
                    liveBlocks.push(...messageToProcessContentBlocks(processMessage, {
                      messageIndex: processIdx,
                      entryId: entryIds[processIdx],
                      phase: "process",
                      toolResults: toolResultsMap,
                    }));
                  }
                  if (streamingProcess) {
                    liveBlocks.push(...streamingProcess.blocks);
                    liveToolCalls += streamingProcess.blocks.filter((block) => block.type === "toolCall").length;
                  }

                  if (liveBlocks.length > 0) {
                    const liveRefIndex = liveRefIdx;
                    rendered.push(
                      <div
                        key="process-group-live"
                        ref={liveRefIndex === undefined ? undefined : (el) => { messageRefs.current[liveRefIndex] = el; }}
                      >
                        <ProcessDetailsGroup
                          messageCount={Math.max(1, liveToolCalls)}
                          toolCallCount={liveToolCalls}
                          // Open while the model is still working, collapse once the answer
                          // starts — the same rule the finalized group uses.
                          defaultExpanded={!streamingProcess || streamingProcess.answerBlocks.length === 0}
                          summaryText={summarizeProcessBlocks(liveBlocks, (key, params) => t(key, params), (key) => t(key))}
                          t={t}
                        >
                          <ProcessGroup
                            blocks={liveBlocks}
                            isStreaming={streamState.isStreaming}
                            toolResults={toolResultsMap}
                            onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                            onOpenSession={onOpenSession}
                          />
                        </ProcessDetailsGroup>
                      </div>,
                    );
                    liveTurnTimeline = true;
                  }
                  idx = endIdx;
                  continue;
                }

                rendered.push(renderMessage(userIdx));

                const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                const finalSplit = splitFinalAssistantBlocks(finalAssistant);
                const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant) || getAssistantTruncationNotice(finalAssistant)
                  ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
                  : null;

                const finalProcessEnd = finalAssistant.content.indexOf(finalSplit.answerBlocks[0]);
                // Keep the original prefix so deferred thinking retains its stored block indices.
                const finalProcessBlocks = finalAssistant.content.slice(0, finalProcessEnd < 0 ? undefined : finalProcessEnd);

                const processViews: ReactNode[] = [];
                const groupedProcessBlocks: ProcessContentBlock[] = [];
                let processToolCount = 0;
                let processRefIdx: number | undefined;
                // fork:zc-02 — 在查找条开着且有查询词时，把每一轮的过程步骤都展开。
                //
                // 不只是「顺手」，而是这个功能能不能用的前提：命中计数建在**模型里的正文**
                // （thinking / 工具输出都在内），而折叠着的步骤正文**不在 DOM 里**
                // （MessageView 两段式挂载 + 惰性加载），于是高亮与滚动都拿不到 Range ——
                // 表现就是计数在动、画面不动。ProcessGroup 的 `reveal` 会把该组每个 step
                // 都置为打开（ProcessGroup.tsx 的 isStepOpen），正文随之进 DOM。
                // 复用会话搜索跳转已有的那条通路，不另建一套 reveal 状态。
                const revealForFind = findOpen && findQuery.trim().length > 0;
                let revealProcess = revealForFind;

                for (let processIdx = userIdx + 1; processIdx <= finalAssistantIdx; processIdx++) {
                  const processMessage = messages[processIdx];
                  if (processMessage.role === "custom") {
                    const customReveal = Boolean(pendingSearchScroll && pendingSearchScroll.entryId === entryIds[processIdx]);
                    revealProcess ||= customReveal;
                    processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                    groupedProcessBlocks.push(...messageToProcessContentBlocks(processMessage, {
                      messageIndex: processIdx,
                      entryId: entryIds[processIdx],
                      phase: "process",
                      toolResults: toolResultsMap,
                    }));
                    continue;
                  }
                  if (processMessage.role !== "assistant") continue;
                  const message = processIdx === finalAssistantIdx
                    ? withAssistantBlocks(processMessage, finalProcessBlocks, { omitUsage: Boolean(finalAnswerMessage) })
                    : processMessage;
                  const blocks = getDisplayableAssistantBlocks(message);
                  if (blocks.length === 0) continue;
                  processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                  processToolCount += countToolCallBlocks(blocks);
                  revealProcess ||= Boolean(pendingSearchScroll && entryIds[processIdx] === pendingSearchScroll.entryId && (!searchBlock || blocks.includes(searchBlock)));
                  groupedProcessBlocks.push(...messageToProcessContentBlocks(message, {
                    messageIndex: processIdx,
                    entryId: entryIds[processIdx],
                    phase: "process",
                    toolResults: toolResultsMap,
                  }));
                  continue;
                }

                if (groupedProcessBlocks.length > 0) {
                  // The group header is the only place a summary is rendered, so
                  // the grouped renderer computes its digest here and hands it
                  // down instead of printing a second count line inside itself.
                  const groupedSummary = summarizeProcessBlocks(groupedProcessBlocks, (key, params) => t(key, params), (key) => t(key));
                  rendered.push(
                    <div
                      key={`process-group-${entryIds[userIdx] ?? userIdx}`}
                      ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                    >
                      <ProcessDetailsGroup
                        messageCount={Math.max(1, processToolCount)}
                        toolCallCount={processToolCount}
                        defaultExpanded={!finalAnswerMessage}
                        reveal={revealProcess}
                        summaryText={groupedSummary}
                        t={t}
                      >
                        <ProcessGroup
                          blocks={groupedProcessBlocks}
                          isStreaming={streamState.isStreaming && finalAssistantIdx === messages.length - 1}
                          toolResults={toolResultsMap}
                          onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                          onOpenSession={onOpenSession}
                          reveal={revealProcess}
                          revealToolCallId={findRevealToolCallId}
                        />
                      </ProcessDetailsGroup>
                    </div>,
                  );
                }

                if (finalAnswerMessage) {
                  // Each tool call is stored as its own assistant entry, so the
                  // final answer alone carries no record of what the turn wrote.
                  // Gather the turn's assistant blocks and derive the file list
                  // from the write/edit calls among them.
                  const turnContent: AssistantContentBlock[] = [];
                  for (let i = userIdx + 1; i <= finalAssistantIdx; i++) {
                    const m = messages[i];
                    if (m?.role === "assistant") {
                      for (const b of (m as AssistantMessage).content ?? []) turnContent.push(b);
                    }
                  }
                  const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
                  rendered.push(renderMessage(finalAssistantIdx, {
                    messageOverride: finalAnswerMessage,
                    writtenFiles,
                  }));
                }
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  rendered.push(renderMessage(renderIdx));
                }
                idx = endIdx;
              }
              const { startIndex } = getVisibleRenderWindow(rendered.length, visibleCount);
              const hasMore = startIndex > 0 || hasEarlierMessages;
              return (
                <>
                  {hasMore && (
                     <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
                       {t("chat.loadEarlier")}
                    </div>
                  )}
                  {rendered.slice(startIndex)}
                </>
              );
            })()}
            {streamState.isStreaming && hasStreamingContent && streamState.streamingMessage && (
              (() => {
                // fork:process-live — the in-flight message used to render through the flat
                // MessageView, so switching the process-display setting mid-run changed
                // nothing until the turn finished and the finalized message reached the
                // grouped path below. Build the same group from the streaming message and
                // keep the flat renderer only for `legacy`.
                //
                // fork:process-live-2 — when the running turn's timeline has already been
                // emitted above (`liveTurnTimeline`), these process blocks are part of it
                // and only the answer half is still owed here.
                const live = streamState.streamingMessage as AgentMessage;
                if (!streamingProcess || (streamingProcess.blocks.length === 0 && !liveTurnTimeline)) {
                  // Unchanged flat renderer (and unchanged expression): the streaming
                  // message must keep receiving `toolResultsMap` so live shell output
                  // stays attached to its tool call.
                  return <MessageView message={streamState.streamingMessage as AgentMessage} toolResults={toolResultsMap} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} expandedToolIds={expandedToolIds} onToggleTool={handleToggleTool} />;
                }
                const answerView = streamingProcess.answerBlocks.length > 0 ? (
                  <MessageView
                    message={{ ...live, content: streamingProcess.answerBlocks } as AgentMessage}
                    toolResults={toolResultsMap}
                    isStreaming
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenSession={onOpenSession}
                    expandedToolIds={expandedToolIds}
                    onToggleTool={handleToggleTool}
                  />
                ) : null;
                if (liveTurnTimeline) return answerView;
                const liveToolCalls = streamingProcess.blocks.filter((block) => block.type === "toolCall").length;
                return (
                  <>
                    <div key="process-group-live">
                      <ProcessDetailsGroup
                        messageCount={Math.max(1, liveToolCalls)}
                        toolCallCount={liveToolCalls}
                        // Open while the model is still working, collapse once the answer
                        // starts — the same rule the finalized group uses.
                        defaultExpanded={streamingProcess.answerBlocks.length === 0}
                        summaryText={summarizeProcessBlocks(streamingProcess.blocks, (key, params) => t(key, params), (key) => t(key))}
                        t={t}
                      >
                        <ProcessGroup
                          blocks={streamingProcess.blocks}
                          isStreaming
                          toolResults={toolResultsMap}
                          onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                          onOpenSession={onOpenSession}
                        />
                      </ProcessDetailsGroup>
                    </div>
                    {answerView}
                  </>
                );
              })()
            )}

            {agentRunning && !hasStreamingContent && (
              // fork:zm-07 — 垂直间距放在 PhaseRoll 自己身上，不放在这层 wrapper 上：
              // PhaseRoll 在“没有相位可显”时返回 null（与改动前同一契约），
              // 而 wrapper 带着 py-2 渲染就会在等待结束后留下一条看不见的空隙。
              <div className="break-words text-xs text-text-muted">
                <PhaseRoll
                  text={agentPhase ? phaseLabel(agentPhase, t) : null}
                  phaseKey={phaseKeyOf(agentPhase)}
                  lineHeightEm={1.4}
                />
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-xs text-text-muted" role="status" aria-live="polite">
                <span>{t("chat.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                onOpenSession={onOpenSession}
              />
            )}

            <div ref={promptAnchorSpacerRef} aria-hidden="true" />
            </div>
          </div>
        </ScrollFadeViewport>
        </>}
      </div>

      {quoteSelectionEnabled && quotedSelection && createPortal(
        <div
          ref={quotePopoverRef}
          role={quoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.askSelection")}
          className="anim-popover-down"
          style={{
            position: "fixed",
            top: quotedSelection.top,
            left: quotedSelection.left,
            zIndex: 260,
            display: "flex",
            flexWrap: "wrap",
            gap: 3,
            width: quoteInputOpen ? "min(420px, calc(100vw - 16px))" : undefined,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
            overflowY: "auto",
            padding: quoteInputOpen ? 12 : 3,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
          }}
        >
          {quoteInputOpen ? (
            <fieldset
              disabled={quoteSubmitting}
              aria-busy={quoteSubmitting}
              style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: TEXT.sm, fontWeight: 600 }}>{t("chat.askInNewChat")}</span>
                <button type="button" className="file-viewer-icon-button" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={quoteSubmitting} onClick={closeQuotedSelection} style={{ border: "none" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <ChatInput
                ref={quoteChatInputRef}
                compact
                onSend={askSelectionInNewChat}
                onAbort={closeQuotedSelection}
                isStreaming={false}
              />
              {quoteError && <div role="alert" style={{ color: "var(--danger)", fontSize: TEXT.sm, overflowWrap: "anywhere" }}>{quoteError}</div>}
            </fieldset>
          ) : <>
          <button
            type="button"
            className="file-viewer-icon-button"
            title={t("chat.askInCurrent")}
            aria-label={t("chat.askInCurrent")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={askSelectionHere}
            style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: TEXT.sm, fontWeight: 500 }}
          >
            <span aria-hidden="true" style={{ fontSize: TEXT.xl }}>@</span>
            <span>{t("chat.askInCurrent")}</span>
          </button>
          {onAskInNewChat && quotedSelection.sourceEntryId && !sessionBusy && (
            <button
              type="button"
              className="file-viewer-icon-button"
              title={t("chat.askInNewChat")}
              aria-label={t("chat.askInNewChat")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
              style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: TEXT.sm, fontWeight: 500 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 3v12M18 9a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              </svg>
              <span>{t("chat.askInNewChat")}</span>
            </button>
          )}
          </>}
        </div>,
        document.body,
      )}

      <div
        className="relative shrink-0"
        style={hasChatMinimap ? {
          gridColumn: "1",
          gridRow: "2",
          // The minimap preview may expand leftward, but it must never cover
          // or intercept the composer at the bottom of the chat.
          zIndex: 2,
          background: "var(--bg)",
        } : undefined}
      >
        {!isEmptyNew && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
              display: "flex",
              justifyContent: "center",
              paddingBottom: 10,
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            <button
              type="button"
              className={`chat-scroll-to-bottom${showScrollToBottom && !pendingScrollRestore ? " is-visible" : ""}`}
              title={t("chat.scrollToLatest")}
              aria-label={t("chat.scrollToLatest")}
              onPointerDown={() => { followingRef.current = true; }}
              onKeyDown={(event) => {
                // 键盘触发 click 前先恢复跟随（zm-03 的回底否决权需要它）。
                if (event.key === "Enter" || event.key === " ") followingRef.current = true;
              }}
              onClick={() => scrollToBottom("smooth")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          </div>
        )}
        {isEmptyNew && (
          <div className="mx-auto w-full" style={{ maxWidth: "var(--composer-max-width, 892px)", paddingLeft: 16, paddingRight: 16 }}>
            <NewSessionUpdateLink label={(version) => t("appUpdate.releaseNotes", { version })} />
          </div>
        )}
        {chatInputElement}
        <ExtensionStatusBar
          statuses={extensionStatuses}
          widgets={extensionWidgets}
          trailing={(
            <SessionStatsBar
              sessionStats={sessionStats}
              contextUsage={contextUsage}
              session={session ? {
                projectRoot: session.projectRoot ?? null,
                cwd: session.cwd,
                branch: session.branch ?? null,
                isWorktree: session.isWorktree,
              } : null}
              expanded={statsExpanded}
              onToggle={setStatsExpanded}
            />
          )}
        />
      </div>
      {hasChatMinimap && (
        <ChatMinimap
          messages={messages}
          streamingMessage={streamState.streamingMessage}
          scrollContainer={scrollContainerRef}
          messageRefs={messageRefs}
          onRevealHistory={revealHistoryForMinimap}
          hasEarlierMessages={hasEarlierMessages}
          loadingEarlier={loadingEarlier}
          onLoadEarlier={loadOlderPage}
        />
      )}
      {/* fork:ui-newhome — the composer used to be vertically centred by a
          trailing flex spacer. Upstream and Wegent both put the hero above a
          bottom-anchored composer, which is what the empty state now does. */}
    </div>
  );
}

// Toast 整体高度上限；文本区高度上限 = 整体上限 - 上下 padding(14*2) - 上下边框(1*2)
const NOTICE_MAX_HEIGHT_PX = 500;
const NOTICE_TEXT_MAX_HEIGHT_PX = NOTICE_MAX_HEIGHT_PX - 30;

function NoticeShelf({ notices, floating = false, onPauseChange }: { notices: NoticeItem[]; floating?: boolean; onPauseChange?: (id: string | null) => void }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        // Right-anchored: every toast's right edge aligns here, widths extend leftward
        alignItems: "flex-end",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "var(--danger)"
          : notice.type === "warning"
            ? "var(--warning)"
            : notice.type === "success"
              ? "var(--success)"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            onMouseEnter={() => onPauseChange?.(notice.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) onPauseChange?.(null);
            }}
            onFocus={() => onPauseChange?.(notice.id)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover")) onPauseChange?.(null);
            }}
            style={{
              display: "flex",
              // Top-align children so the type dot sits by the first line on multi-line toasts
              alignItems: "flex-start",
              gap: 10,
              minHeight: 60,
              height: "auto",
              // 整体高度上限：超出后由文本区内部滚动承担（见下方 span 的 overflowY），
              // 容器自身保持 hidden，小圆点固定在顶部不随文本滚动
              maxHeight: NOTICE_MAX_HEIGHT_PX,
              // The floating wrapper is pointerEvents:"none" (click-through by design),
              // so the toast itself must opt back into interactivity or hover events never reach it
              pointerEvents: "auto",
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: TEXT.lg,
              lineHeight: 1.5,
              transformOrigin: "top right",
              // Use backwards fill for the entrance animation so height styles return to
              // inline styles once it finishes; otherwise the keyframe's fixed 60px would
              // stick around in fill mode and permanently clamp the expanded toast
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out backwards",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
                // Align with the optical center of the first text line: 14px vertical
                // padding + (21px line box - 7px dot) / 2
                marginTop: 21,
              }}
            />
            {/* Full text by default: pre-line preserves \n (nowrap/normal collapse
                newlines into spaces) and long lines wrap instead of truncating;
                content taller than the cap scrolls inside the text area */}
            <span
              tabIndex={0}
              style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX, overflowY: "auto", scrollbarWidth: "thin", whiteSpace: "pre-line", wordBreak: "break-word" }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function getExtensionDialogSummary(request: ExtensionDialogRequest): string | undefined {
  if (request.method === "select" && request.options.length > 0) return request.options[0];
  if (request.method === "confirm") {
    const firstLine = request.message.split("\n").find((line) => line.trim());
    return firstLine?.trim();
  }
  return undefined;
}

/**
 * Render the scrollable portion of a dialog title: ```sh / ```bash code fences are
 * rendered as highlighted code blocks (red border + red tint to flag risky commands),
 * and all other text keeps pre-wrap multi-line rendering.
 */
function renderDialogTitle(title: string): ReactNode {
  const segments = splitDialogTitleCode(title);
  if (segments.length === 1 && !segments[0].isCode) return title;
  return segments.map((seg, i) => {
    if (seg.isCode) {
      return (
        <pre
          key={i}
          style={{
            margin: "6px 0",
            padding: "8px 10px",
            borderRadius: "var(--radius-sm)",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
            borderLeft: "3px solid var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: TEXT.sm,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            overflowX: "auto",
            color: "var(--text)",
          }}
        >
          {seg.text}
        </pre>
      );
    }
    return (
      <span key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {seg.text}
      </span>
    );
  });
}

/** fork:zm-04 — 剩余秒数（组件外，避免在 render 里直接调用 Date.now）。 */
function remainingSecondsUntil(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

/**
 * fork:zm-04 — 倒计时秒数（1 Hz 的 **DOM 写入**，不触发 React 渲染）。
 *
 * 原来 `now` state 挂在 ExtensionDialog 上，每秒重渲染整张卡（含 MarkdownBody
 * 与选项列表）。现在只在这里写一个 text node；父组件在倒计时期间渲染次数为 0。
 */
function ExtensionCountdownText({ expiresAt }: { expiresAt: number }) {
  const { t } = useI18n();
  const ref = useRef<HTMLSpanElement | null>(null);
  const initialSeconds = remainingSecondsUntil(expiresAt);

  useEffect(() => {
    const write = () => {
      const node = ref.current;
      if (!node) return;
      node.textContent = t("chat.extensionExpiresIn", { seconds: remainingSecondsUntil(expiresAt) });
    };
    write();
    const timer = setInterval(write, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, t]);

  return (
    <span ref={ref} style={{ fontSize: TEXT.xs, color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
      {t("chat.extensionExpiresIn", { seconds: initialSeconds })}
    </span>
  );
}

/** fork:zm-04 — 进度条高度（px）。 */
const COUNTDOWN_BAR_HEIGHT_PX = 2;

/**
 * fork:zm-04 — 审批倒计时进度条（WAAPI，零每秒渲染）。
 *
 * `scaleX(1) → scaleX(0)` 的线性动画，duration = 剩余毫秒，`fill: forwards`。
 * 只在显式 `no-preference` 时播放；reduced-motion / SSR / jsdom 直接隐藏
 * （静态满格条会让人误以为时间还在多，不如只留秒数文本）。
 */
function ExtensionCountdownBar({ expiresAt }: { expiresAt: number }) {
  const motion = useMotionPreference();
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const remainingMs = expiresAt - Date.now();
    if (motion !== "no-preference" || remainingMs <= 0 || typeof node.animate !== "function") {
      node.style.opacity = "0";
      return;
    }
    const animation = node.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration: remainingMs, easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [expiresAt, motion]);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-fork-countdown-bar
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        display: "block",
        height: COUNTDOWN_BAR_HEIGHT_PX,
        background: "var(--accent)",
        opacity: 0.55,
        transformOrigin: "left center",
        pointerEvents: "none",
      }}
    />
  );
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const [collapsed, setCollapsed] = useState(false);
  const focusFirstOption = useCallback((element: HTMLDivElement | null) => element?.focus(), []);
  const summary = getExtensionDialogSummary(request);
  const { head: titleHead, rest: titleRest } = splitDialogTitle(request.title);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onRespond(request, { cancelled: true });
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        // Collapsed or expanded, the card stays just above the composer: the top of
        // the message area reads as "detached" from what it is asking about.
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 20,
        pointerEvents: "none",
      }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          style={{
            pointerEvents: "auto",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(560px, 100%)",
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            color: "var(--text)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: TEXT.xs, fontWeight: 650, color: "var(--accent)", flexShrink: 0 }}>
            {t("chat.extensionPending")}
          </span>
          <span style={{ fontSize: TEXT.md, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {titleHead}
          </span>
          {summary && (
            <span style={{ fontSize: TEXT.sm, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "34%", flexShrink: 1 }}>
              {summary}
            </span>
          )}
          {request.expiresAt !== undefined && <ExtensionCountdownText expiresAt={request.expiresAt} />}
          <span style={{ fontSize: TEXT.sm, color: "var(--text-muted)", flexShrink: 0 }}>
            {t("chat.extensionExpand")}
          </span>
          {/* fork:zm-04 — WAAPI 进度条；倒计时不产生任何 React 渲染。 */}
          {request.expiresAt !== undefined && <ExtensionCountdownBar expiresAt={request.expiresAt} />}
        </button>
      ) : (
      <div
        role="dialog"
        aria-label={request.title}
        aria-modal="true"
        className="anim-dialog"
        style={{
          pointerEvents: "auto",
          position: "relative",
          width: "min(560px, 100%)",
          maxHeight: "min(760px, 100%)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: TEXT.lg, fontWeight: 650, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{titleHead}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 3, color: "var(--text-dim)", fontSize: TEXT.xs, fontFamily: "var(--font-mono)" }}>
              <span>{t("chat.extensionRequest")}</span>
              {request.expiresAt !== undefined && <ExtensionCountdownText expiresAt={request.expiresAt} />}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-expanded={true}
            title={t("chat.extensionCollapse")}
            aria-label={t("chat.extensionCollapse")}
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </button>
        </div>

        <div
          style={{
            padding: 14,
            flex: "1 1 auto", minHeight: 0, overflowY: "auto",
          }}
        >
          {titleRest && (
            <div style={{ marginBottom: 12, color: "var(--text-muted)", fontSize: TEXT.md, lineHeight: 1.55 }}>
              {renderDialogTitle(titleRest)}
            </div>
          )}
          {request.method === "confirm" && (
            <MarkdownBody>{request.message}</MarkdownBody>
          )}
          {request.method === "select" && (
            <div
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-extension-option]"));
                const index = buttons.indexOf(event.target as HTMLElement);
                if (index < 0) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0
                  : event.key === "End" ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus({ preventScroll: true });
                buttons[next].scrollIntoView({ block: "nearest" });
              }}
              style={{ display: "grid", gap: 8 }}
            >
              {request.options.map((option, index) => (
                <div
                  key={option}
                  role="button"
                  tabIndex={0}
                  data-extension-option
                  aria-label={option}
                  ref={index === 0 ? focusFirstOption : undefined}
                  onClick={() => onRespond(request, { value: option })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRespond(request, { value: option });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: TEXT.md,
                    overflowWrap: "anywhere",
                  }}
                >
                  <div inert>
                    <MarkdownBody>{option}</MarkdownBody>
                  </div>
                </div>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: TEXT.md,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: TEXT.md,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            autoFocus={request.method === "confirm" || (request.method === "select" && request.options.length === 0)}
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "7px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
             {t("chat.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--primary-bg)",
                background: "var(--primary-bg)",
                color: "var(--primary-fg)",
                cursor: "pointer",
              }}
            >
               {t("chat.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--primary-bg)",
                background: "var(--primary-bg)",
                color: "var(--primary-fg)",
                cursor: "pointer",
              }}
            >
               {t("chat.submit")}
            </button>
          ) : null}
        </div>
        {/* fork:zm-04 — 卡片底边的倒计时进度条。 */}
        {request.expiresAt !== undefined && <ExtensionCountdownBar expiresAt={request.expiresAt} />}
      </div>
      )}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const displayLines = normalizeCustomPanelLines(request.lines);
  const summary = displayLines.find((line) => line.trim())?.trim();

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus();
  }, [collapsed]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 20,
        pointerEvents: "none",
      }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(920px, 100%)",
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            color: "var(--text)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: TEXT.xs, fontWeight: 650, color: "var(--accent)", flexShrink: 0 }}>
            {t("chat.extensionPending")}
          </span>
          <span style={{ fontSize: TEXT.md, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {t("chat.extensionPanel")}
          </span>
          {summary && (
            <span style={{ fontSize: TEXT.sm, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "34%", flexShrink: 1 }}>
              {summary}
            </span>
          )}
          <span style={{ fontSize: TEXT.sm, color: "var(--text-muted)", flexShrink: 0 }}>
            {t("chat.extensionExpand")}
          </span>
        </button>
      ) : (
      <div
        role="dialog"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          pointerEvents: "auto",
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, 100%)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
           <div style={{ color: "var(--text)", fontSize: TEXT.md, fontWeight: 650 }}>{t("chat.extensionPanel")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              title={t("chat.extensionCollapse")}
              aria-label={t("chat.extensionCollapse")}
              style={{
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
            <button
              onClick={() => onInput(request, "\x03")}
              style={{
                padding: "5px 9px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: TEXT.sm,
              }}
            >
               {t("chat.close")}
            </button>
          </div>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            minHeight: 0,
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: TEXT.md,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          <AnsiText text={displayLines.join("\n")} />
        </pre>
      </div>
      )}
    </div>
  );
}
