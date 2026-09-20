"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent, useSyncExternalStore } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
// D2-PR-12 — mention 高亮：输入框 overlay 与消息正文共用同一套切词/校验。
import { tokenizeMentions } from "@/lib/mention-tokens";
import { useFileIndex, useSkillNames } from "@/hooks/useProjectContext";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { ImagePreview } from "./ImagePreview";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableHeight } from "@/hooks/useResizableHeight";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { ThinkingIcon } from "./ThinkingIcon";
import type { ToolPreset } from "@/lib/tool-presets";
// fork:proma-02-mode — 会话权限模式
import { nextPermissionMode, PERMISSION_MODE_HINT_KEYS, PERMISSION_MODE_LABEL_KEYS, type PermissionMode } from "@/lib/permission-mode";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";
import {
  favoriteModelKey,
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModelKey,
} from "@/lib/favorite-models";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { TodoChip } from "./fork/TodoChip";
import type { TodoSummary } from "@/lib/todo-state";
import {
  normalizeSelectionContext,
  normalizeSessionReference,
  parseSessionReferenceClipboard,
  serializeComposerMessage,
  type SelectionContext,
  type SessionReference,
} from "@/lib/composer-context";
// fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办 的行内引用 token
import {
  COMPOSER_REFERENCE_TRIGGERS,
  buildMcpReferenceItems,
  buildReferenceInsertText,
  buildSessionReferenceItems,
  buildTodoReferenceItems,
  extractReferenceQuery,
  filterMcpReferenceItems,
  filterSessionReferenceItems,
  filterTodoReferenceItems,
  replaceReferenceToken,
  sessionReferenceFromItem,
  type ComposerReferenceItem,
  type ComposerReferenceQuery,
  type ReferenceMcpItem,
  type ReferenceMcpSource,
  type ReferenceSessionItem,
  type ReferenceSessionSource,
} from "@/lib/composer-references";
import { ComposerReferenceMenu } from "./ComposerReferenceMenu";
// fork:gap07-attachments — 任意文件：分类 / 上限 / 路径引用
import {
  MAX_ATTACHED_FILE_BYTES,
  buildAttachmentReference,
  nextAvailableAttachmentName,
  planAttachments,
  type AttachmentSkipReason,
} from "@/lib/composer-attachments";
import { encodeFilePathForApi, joinFilePath } from "@/lib/file-paths";
import { desktopFilePathFor } from "@/lib/desktop-shell";
// fork:pr13-composer — 拖入文件 cwd 相对化 + Markdown 列表续行
import { toCwdRelativeMentions } from "@/lib/file-mentions";
import { continueMarkdownList } from "@/lib/markdown-list";
// fork:pr14-compact — 阅读态输入框塌陷（振荡坑见 lib/input-compact.ts 的注释）
import {
  nextInputCompactState,
  scrollRemaining,
  type InputCompactScrollDirection,
} from "@/lib/input-compact";
import { TEXT } from "@/lib/typography";

export { filterModelOptions } from "./ModelSelector";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface Props {
  onSend: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  isStreaming: boolean;
  /** Text-only composer without the session controls or outer spacing. */
  compact?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: string[] }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  /** fork:proma-02-mode — 会话权限模式（Chat-only 会话不显示这个控件）。 */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  /** fork:gap04-queue — 队列逐条操控（移除 / 拖拽排序 / 立即发送）。 */
  onQueueRemove?: (kind: "steer" | "followUp", index: number, expect: string) => void;
  onQueueMove?: (kind: "steer" | "followUp", from: number, to: number, expect: string) => void;
  onQueuePromote?: (index: number, expect: string) => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  /** fork:ui-todo — task list of this session, derived from the transcript. */
  todoSummary?: TodoSummary | null;
  /** fork:gap06-references — 当前会话 id，用于把“自己”从 `&` 建议里剔除。 */
  currentSessionId?: string | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Initial context items for a focused composer, such as the new-chat quote popover. */
  initialSelectionContexts?: SelectionContext[];
  /** Locate the original assistant message for a saved selection context. */
  onLocateSelectionContext?: (context: SelectionContext) => void;
  /** Open a referenced historical session when its composer chip is clicked. */
  onOpenSessionReference?: (reference: SessionReference) => void;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  /** fork:zn-04 — the composer protrusion strip. Rendered by the caller but
   *  placed here, immediately above the card, because that adjacency is what the
   *  weld needs: any model banner between the two would break the joined shape
   *  (banner → strip → card is the only order that holds). */
  protrusion?: React.ReactNode;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  /** fork:gap07-attachments — 任意文件（图片内联，其余落盘后插路径引用）。 */
  addFiles: (files: File[]) => void;
  addSelectionContext: (context: SelectionContext) => void;
  removeSelectionContext: (id: string) => void;
  clearSelectionContexts: () => void;
  addSessionReference: (reference: SessionReference) => void;
  removeSessionReference: (id: string) => void;
  clearSessionReferences: () => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (
    text: string,
    images?: ChatDraftImage[],
    targetDraftKey?: string,
    contexts?: SelectionContext[],
    question?: string,
    sessionReferences?: SessionReference[],
  ) => void;
}

const TOOL_PRESETS = ["chat-only", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  "chat-only": "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8;

// fork:pr23-resize — composer 手动高度（竖向缩放）。
// 自动增高的 200px 上限是内容驱动的轴；手动高度是用户接管的另一条轴，因此下限/
// 上限单独定义。最小高度保底让工具栏在一行文本时仍然能完整放下。
const MIN_MANUAL_HEIGHT_DESKTOP = 104;
const MIN_MANUAL_HEIGHT_MOBILE = 80;
const MANUAL_MAX_HEIGHT_CAP = 480;
const MANUAL_MAX_HEIGHT_FRACTION = 0.55;
const INPUT_HEIGHT_STORAGE_KEY = "pi-chat-input-height";

// fork:pr14-compact — 真实用户滚动的「意图窗口」：wheel / touch / pointer / 滚动
// 按键之后这段时间内的 scroll 事件才被当作用户意图，程序化定位一概不算。
const COMPACT_INTENT_MS = 1200;
// 消息区能引发滚动的按键（焦点不在输入框 / 可编辑区域时才算阅读滚动）。
const COMPACT_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

export function cycleListIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

export function replaceLinksWithMarkdown(
  text: string,
  links: Iterable<{ label: string; href: string; occurrence: number }>,
): string | null {
  let result = "";
  let searchFrom = 0;
  let replaced = false;

  for (const { label, href, occurrence } of links) {
    if (!label || !href) continue;
    let index = 0;
    for (let match = 0; match <= occurrence; match++) {
      index = text.indexOf(label, match ? index + label.length : 0);
      if (index < 0) break;
    }
    if (index < searchFrom) continue;
    const escapedLabel = label.replace(/([\\[\]])/g, "\\$1");
    const escapedHref = href.replace(/([\\()])/g, "\\$1");
    result += `${text.slice(searchFrom, index)}[${escapedLabel}](${escapedHref})`;
    searchFrom = index + label.length;
    replaced = true;
  }

  return replaced ? result + text.slice(searchFrom) : null;
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function subscribeUpwardMenuMaxHeight(
  menu: HTMLElement,
  onChange: (height: number) => void,
): () => void {
  let frameId: number | null = null;
  const update = () => {
    frameId = null;
    onChange(getUpwardMenuMaxHeight(
      menu.getBoundingClientRect().bottom,
      getVisibleTopBoundary(menu),
    ));
  };
  const scheduleUpdate = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  };

  update();
  const parent = menu.parentElement;
  const layoutContainer = parent?.parentElement;
  const anchorObserver = typeof ResizeObserver === "undefined" || !parent
    ? null
    : new ResizeObserver(scheduleUpdate);
  if (parent) anchorObserver?.observe(parent);
  if (layoutContainer) anchorObserver?.observe(layoutContainer);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, true);

  return () => {
    anchorObserver?.disconnect();
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("scroll", scheduleUpdate, true);
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}

/** 在 root 里找面积最大的「在文档流里的」纵向滚动元素；绝对定位（弹层 / 面板）
 *  一律排除，避免把 stats 浮层、菜单当消息区。composer 自身及其内部同样排除。 */
function largestFlowScrollable(root: HTMLElement, composerRoot: HTMLElement, classHint: boolean): HTMLElement | null {
  const selector = classHint
    ? "[class*='overflow-y-auto'], [class*='overflow-auto']"
    : "*";
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (composerRoot.contains(element) || element.contains(composerRoot)) continue;
    const style = window.getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    if (style.position === "absolute" || style.position === "fixed") continue;
    if (style.display === "none" || style.visibility === "hidden") continue;
    const area = element.clientHeight * element.clientWidth;
    if (element.clientHeight > 0 && element.clientWidth > 0 && area > bestArea) {
      best = element;
      bestArea = area;
    }
  }
  return best;
}

/**
 * fork:pr14-compact — 从 composer 出发定位 ChatWindow 的消息滚动容器。
 *
 * 本仓库不允许改 ChatWindow（拿不到 scroll ref），所以按 DOM 结构找：从 composer
 * 向上逐层找最近的、含有「在流中的纵向滚动元素」的祖先，并在其中取面积最大者
 *  —— 消息列是主区里面积最大的滚动区；先用 Tailwind 的 overflow-y-auto 类名
 * 缩小扫描范围，类名不匹配时再回退到全量扫描。
 */
function findMessagesScrollContainer(composerRoot: HTMLElement): HTMLElement | null {
  if (typeof window === "undefined") return null;
  let node: HTMLElement | null = composerRoot.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const best = largestFlowScrollable(node, composerRoot, true) ?? largestFlowScrollable(node, composerRoot, false);
    if (best) return best;
    node = node.parentElement;
  }
  return null;
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type BuiltinSlashCommand = {
  name: string;
  description: string;
  source: "builtin";
  availableWhileStreaming?: boolean;
};

type SlashCommandPaletteItem = SlashCommandInfo | BuiltinSlashCommand;

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommand[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
  { name: "clone", description: "chat.commandClone", source: "builtin" },
];

function getBuiltinSlashCommand(message: string): BuiltinSlashCommand | undefined {
  const match = message.trim().match(/^\/([^\s]+)(?:\s|$)/);
  if (!match) return undefined;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]);
}

export function canRunBuiltinSlashCommandWhileStreaming(message: string): boolean {
  return getBuiltinSlashCommand(message)?.availableWhileStreaming === true;
}

export function isExactSlashCommand(message: string, command: SlashCommandPaletteItem): boolean {
  return command.source === "builtin" && message.trim() === `/${command.name}`;
}

export function canClearBuiltinCommandInput(message: string, imageCount: number, submittedMessage: string): boolean {
  return imageCount === 0 && message.trim() === submittedMessage;
}

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

const CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
const CLIENT_MAX_IMAGE_SIDE = 1024;
const CLIENT_JPEG_QUALITY = 0.85;

export function shouldCompressImageFile(file: Pick<File, "size" | "type">): boolean {
  return file.size > CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES && file.type !== "image/gif";
}

function readImageFile(file: Blob, mimeType: string): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
      if (!data) {
        reject(new Error("Failed to read image"));
        return;
      }
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImageFile(file: File): Promise<{ data: string; mimeType: string }> {
  const original = () => readImageFile(file, file.type);
  if (!shouldCompressImageFile(file) || typeof createImageBitmap !== "function") return original();

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return original();

  try {
    const scale = Math.min(1, CLIENT_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return original();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", CLIENT_JPEG_QUALITY).split(",")[1];
    return data && data.length < Math.ceil(file.size / 3) * 4
      ? { data, mimeType: "image/jpeg" }
      : original();
  } catch {
    return original();
  } finally {
    bitmap.close();
  }
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

/**
 * fork:gap04-queue — 队列里的一行：可拖拽排序，带「立即发送」（仅 follow-up）与「移除」。
 *
 * 控件的可见性靠 `:hover`（用 style 手写，仓库不引 CSS-in-JS 库），
 * 但键盘用户也能拿到（button 本身可聚焦，hover 时显现不影响 tab 顺序）。
 */
function QueuedMessageRow({
  kind,
  text,
  index,
  promoteTitle,
  removeTitle,
  onRemove,
  onPromote,
  onDragStart,
  onDropOn,
  dragging,
}: {
  kind: "steer" | "follow-up";
  text: string;
  index: number;
  promoteTitle: string;
  removeTitle: string;
  onRemove: () => void;
  onPromote?: () => void;
  onDragStart?: () => void;
  onDropOn?: () => void;
  dragging?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const controlStyle: React.CSSProperties = {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    padding: 0,
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-dim)",
    cursor: "pointer",
    opacity: hover ? 1 : 0,
    transition: "opacity 0.12s",
  };
  return (
    <div
      title={text}
      draggable={Boolean(onDragStart)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setHover(true)}
      onBlurCapture={() => setHover(false)}
      onDragStart={onDragStart}
      onDragOver={(event) => { if (onDropOn) event.preventDefault(); }}
      onDrop={(event) => { if (onDropOn) { event.preventDefault(); onDropOn(); } }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: TEXT.sm,
        color: "var(--text-muted)",
        minWidth: 0,
        opacity: dragging ? 0.4 : 1,
        cursor: onDragStart ? "grab" : "default",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: TEXT["2xs"],
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: 999,
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 }}>
        {onPromote && (
          <button
            type="button"
            onClick={onPromote}
            title={promoteTitle}
            aria-label={promoteTitle}
            style={controlStyle}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" /><polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title={removeTitle}
          aria-label={`${removeTitle} #${index + 1}`}
          style={controlStyle}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body, onClose }: { tone: "error" | "warning"; title: string; body: string; onClose?: () => void }) {
  const color = tone === "error" ? "239,68,68" : "234,179,8";
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: `1px solid rgba(${color},0.3)`,
        borderRadius: "var(--radius-sm)",
        background: `rgba(${color},0.07)`,
        color: `rgb(${color})`,
        fontSize: TEXT.xs,
        lineHeight: 1.45,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}
        aria-hidden="true"
      >
        <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            padding: "0 2px",
            cursor: "pointer",
            color: "inherit",
            opacity: 0.7,
            fontSize: TEXT.md,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.modelError")} body={error} />;
}

/** True when the selected model is known to accept image input (#584). Unknown modality info never blocks the user. */
export function modelSupportsImageInput(
  model: { provider: string; modelId: string } | null | undefined,
  modelList: { id: string; name: string; provider: string; input?: string[] }[] | undefined
): boolean {
  if (!model) return true;
  const entry = modelList?.find((m) => m.provider === model.provider && m.id === model.modelId);
  if (!entry || !entry.input) return true;
  return entry.input.includes("image");
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={warnings.length > 1 ? t("chat.modelScopeWarnings") : t("chat.modelScopeWarning")}
      body={warnings.join("\n")}
    />
  );
}

/** 星标图标；填充表示已收藏。 */
function FavoriteStarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/**
 * fork:pr17-favorites — 输入框侧的收藏模型菜单。
 *
 * 与设置页 ModelsConfig 共用 lib/favorite-models 单一 store：任一入口的星标写入
 * 都会主动 notify，本组件通过 useSyncExternalStore 立即刷新；跨标签页则由
 * window storage 事件同步。模型下线的收藏项仍保留（置灰且不可点选），避免收藏被
 * 静默清掉。
 */
function FavoriteModelMenu({
  model,
  options,
  favorites,
  onSelect,
}: {
  model: { provider: string; modelId: string } | null | undefined;
  options: ModelSelectorOption[];
  favorites: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  const optionByKey = new Map(options.map((option) => [favoriteModelKey(option.provider, option.modelId), option]));
  // 可用模型排在前面；下线条目保持收藏顺序并置灰保留。
  const entries = [...favorites]
    .map((key) => ({ key, option: optionByKey.get(key) }))
    .sort((a, b) => (a.option ? 0 : 1) - (b.option ? 0 : 1));
  const currentKey = model ? favoriteModelKey(model.provider, model.modelId) : null;
  const currentFavorited = currentKey !== null && favorites.has(currentKey);

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("models.favorites")}
        title={t("models.favorites")}
        onClick={() => setOpen((current) => !current)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--spacing-token-button-composer, 28px)",
          height: "var(--spacing-token-button-composer, 28px)",
          padding: 0,
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: "var(--radius-md)",
          color: currentFavorited ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = open ? "var(--bg-hover)" : "none"; }}
      >
        <FavoriteStarIcon filled={currentFavorited} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("models.favorites")}
          className="anim-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 300,
            width: 240,
            maxHeight: 320,
            overflowY: "auto",
            padding: "4px 0",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 10px 6px", color: "var(--text-dim)", fontSize: TEXT["2xs"], fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            <span>{t("models.favorites")}</span>
            {currentKey && (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={currentFavorited}
                aria-label={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                title={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                onClick={() => toggleFavoriteModelKey(currentKey)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, background: "none", border: "none", color: currentFavorited ? "var(--accent)" : "var(--text-dim)", cursor: "pointer" }}
              >
                <FavoriteStarIcon filled={currentFavorited} />
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: "6px 10px 8px", color: "var(--text-dim)", fontSize: TEXT.xs }}>
              {t("models.noFavorites")}
            </div>
          ) : entries.map(({ key, option }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 2, margin: "0 4px", opacity: option ? 1 : 0.5 }}>
              <button
                type="button"
                role="menuitem"
                disabled={!option}
                onClick={() => {
                  if (!option) return;
                  setOpen(false);
                  onSelect(option.provider, option.modelId);
                }}
                title={option ? `${option.name} · ${option.provider}` : `${key} · ${t("models.unavailableModel")}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-sm)",
                  background: "none",
                  border: "none",
                  color: option ? "var(--text)" : "var(--text-dim)",
                  cursor: option ? "pointer" : "not-allowed",
                  fontSize: TEXT.sm,
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => { if (option) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {option?.name || option?.modelId || key.slice(key.indexOf(":") + 1)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("models.unfavoriteModel")}
                title={t("models.unfavoriteModel")}
                onClick={() => toggleFavoriteModelKey(key)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 4, background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}
              >
                <FavoriteStarIcon filled />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  permissionMode, onPermissionModeChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue, todoSummary, currentSessionId,
  onQueueRemove, onQueueMove, onQueuePromote,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  initialSelectionContexts,
  onLocateSelectionContext,
  onOpenSessionReference,
  cwd,
  protrusion,
  compact = false,
}: Props, ref) {
  const { t } = useI18n();
  const { fontSize } = useChatAppearance();
  const isMobile = useIsMobile();
  // fork:pr23-resize — 顶部手柄竖向缩放。`height === null` 保持内容驱动的自动
  // 高度；数字表示用户已接管。manualMode 时卡片挂内联固定高度，textarea 交给
  // `.is-manual-height` 的 CSS（`height: 100% !important`）填充并内部滚动，
  // 从而与自动增高互斥；引用回答形态（compact prop）与移动端不接管，避免旧的
  // 持久化高度破坏小布局。
  const inputShellRef = useRef<HTMLDivElement>(null);
  const manualModeRef = useRef(false);
  const minManualHeight = isMobile ? MIN_MANUAL_HEIGHT_MOBILE : MIN_MANUAL_HEIGHT_DESKTOP;
  const getMaxManualHeight = useCallback(() => {
    if (typeof window === "undefined") return MANUAL_MAX_HEIGHT_CAP;
    return Math.max(
      minManualHeight,
      Math.min(MANUAL_MAX_HEIGHT_CAP, Math.floor(window.innerHeight * MANUAL_MAX_HEIGHT_FRACTION)),
    );
  }, [minManualHeight]);
  const inputHeightResizer = useResizableHeight({
    ariaLabel: t("layout.resizeHint"),
    minHeight: minManualHeight,
    getMaxHeight: getMaxManualHeight,
    storageKey: INPUT_HEIGHT_STORAGE_KEY,
    targetRef: inputShellRef,
  });
  const manualHeight = inputHeightResizer.height;
  const manualMode = !compact && !isMobile && manualHeight !== null;
  manualModeRef.current = manualMode;

  // fork:pr14-compact — 阅读态塌陷。状态机在 lib/input-compact.ts：只有
  // 「真实用户意图 + 向上滚 + 离底 > 120px」才收起；到底只认同向下的滚动；
  // ResizeObserver 复算一律传 "none"；focus 一定展开。这样收缩引起的
  // “浏览器把视口夹回底部”就不会把状态来回翻转。
  const [readingCompact, setReadingCompact] = useState(false);
  /** wheel / touch / pointer / 滚动按键触发的意图窗口（Date.now 上限）。 */
  const compactIntentUntilRef = useRef(0);
  /** 上一次 scroll 事件的 scrollTop，用来求方向。 */
  const lastScrollTopRef = useRef(0);
  /** 定位到的消息滚动容器（DOM 发现，见 findMessagesScrollContainer）。 */
  const messagesScrollRef = useRef<HTMLElement | null>(null);
  /** 输入区是否聚焦；聚焦期间不收起，且 focus 一定展开。 */
  const inputFocusedRef = useRef(false);
  // fork:pr17-favorites — 与设置页 ModelsConfig 共用同一个收藏 store；
  // 同文档写入由 store 主动 notify，跨标签页由 window storage 事件同步。
  const favoriteModels = useSyncExternalStore(subscribeFavoriteModels, getFavoriteModelsSnapshot, getFavoriteModelsServerSnapshot);
  const initialDraft = draftKey ? getDraft(draftKey) : null;
  const [value, setValue] = useState(() => initialDraft?.value ?? "");
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftImagesToAttachedImages(initialDraft?.images)
  ));
  const [selectionContexts, setSelectionContexts] = useState<SelectionContext[]>(() => (
    (initialDraft?.contexts ?? initialSelectionContexts ?? []).flatMap((context) => {
      const normalized = normalizeSelectionContext(context);
      return normalized ? [normalized] : [];
    })
  ));
  const [sessionReferences, setSessionReferences] = useState<SessionReference[]>(() => (
    (initialDraft?.sessionReferences ?? []).flatMap((reference) => {
      const normalized = normalizeSessionReference(reference);
      return normalized ? [normalized] : [];
    })
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atMenuMaxHeight, setAtMenuMaxHeight] = useState<number | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  // fork:gap06-references — 行内引用菜单（& 会话 / # MCP / ~ 待办）。
  // 与 `@` 菜单平行：两个抽取器都锚定光标，所以同一时刻最多只有一个能命中（见
  // lib/composer-references.ts 的 extractReferenceQuery）。
  const [referenceQuery, setReferenceQuery] = useState<ComposerReferenceQuery | null>(null);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [referenceActiveIndex, setReferenceActiveIndex] = useState(0);
  const [referenceMenuMaxHeight, setReferenceMenuMaxHeight] = useState<number | null>(null);
  const [referenceSessions, setReferenceSessions] = useState<ReferenceSessionItem[] | null>(null);
  const [referenceMcp, setReferenceMcp] = useState<ReferenceMcpItem[] | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const referenceMenuRef = useRef<HTMLDivElement>(null);
  const referenceItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 数据源缓存时间戳（10s，与文件索引同款策略）。 */
  const referenceMetaRef = useRef<{ sessions?: number; mcp?: string }>({});
  /** 防止同一个数据源被并发拉取。 */
  const referenceFetchRef = useRef<{ sessions: boolean; mcp: string | null }>({ sessions: false, mcp: null });
  const [imageWarningDismissed, setImageWarningDismissed] = useState(false);
  /**
   * fork:gap04-queue — 正在拖拽的队列行。
   *
   * 载荷用 **ref** 存：drop 可能在 dragstart 的同一个 tick 里发生（真实拖拽里也有极快的
   * 甩拖），这时 React 还没重渲染，state 读到的是旧值（null）→ 拖拽会静默失效。
   * state 只负责置灰的视觉效果。
   */
  const [draggingQueue, setDraggingQueue] = useState<{ kind: "steer" | "followUp"; index: number } | null>(null);
  const draggingQueueRef = useRef<{ kind: "steer" | "followUp"; index: number } | null>(null);
  const beginQueueDrag = (kind: "steer" | "followUp", index: number) => {
    draggingQueueRef.current = { kind, index };
    setDraggingQueue({ kind, index });
  };
  const endQueueDrag = () => {
    draggingQueueRef.current = null;
    setDraggingQueue(null);
  };
  /** 拖拽落点 → 插入下标：往下拖落在目标行之后，往上拖落在它之前（“所见即所得”）。 */
  const queueDropTarget = (from: number, hovered: number) => (from < hovered ? hovered + 1 : hovered);
  /** fork:gap07-attachments — 附件落盘结果提示；每一次拖入都有可见交代，不静默丢。 */
  const [attachmentNotice, setAttachmentNotice] = useState<{
    added: string[];
    skipped: Array<{ name: string; reason: AttachmentSkipReason }>;
    failed: string[];
  } | null>(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [builtinCommandPending, setBuiltinCommandPending] = useState(false);
  const builtinCommandPendingRef = useRef(false);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  // D2-PR-12 — 高亮用的共享索引/技能缓存（模块级 + 30s TTL + 并发去重）。
  // 上方 @ 菜单继续用它自己的 10s TTL 状态：两条取数路径互不影响，避免动到补全行为。
  const fileIndexSnapshot = useFileIndex(cwd);
  const skillNames = useSkillNames(cwd);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // D2-PR-12 — 高亮层：viewport 精确盖住 textarea 的内容盒，layer 随滚动位移。
  const highlightViewportRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atMenuRef = useRef<HTMLDivElement>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const initialSelectionContextsRef = useRef(initialSelectionContexts);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const selectionContextsRef = useRef(selectionContexts);
  const sessionReferencesRef = useRef(sessionReferences);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;
  selectionContextsRef.current = selectionContexts;
  sessionReferencesRef.current = sessionReferences;
  initialSelectionContextsRef.current = initialSelectionContexts;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      selectionContextsRef.current = [];
      setSelectionContexts([]);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        contexts: selectionContextsRef.current,
        sessionReferences: sessionReferencesRef.current,
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [], contexts: [], sessionReferences: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ))
        && (moved.contexts?.length ?? 0) === currentDraft.contexts.length
        && (moved.contexts ?? []).every((context, index) => {
          const current = currentDraft.contexts[index];
          return current
            && context.id === current.id
            && context.text === current.text
            && context.sourceFilePath === current.sourceFilePath
            && context.sourceAbsolutePath === current.sourceAbsolutePath
            && context.sourceSessionId === current.sourceSessionId
            && context.sourceEntryId === current.sourceEntryId
            && context.sourceStartOffset === current.sourceStartOffset
            && context.sourceEndOffset === current.sourceEndOffset
            && context.label === current.label;
        })
        && (moved.sessionReferences?.length ?? 0) === currentDraft.sessionReferences.length
        && (moved.sessionReferences ?? []).every((reference, index) => (
          reference.id === currentDraft.sessionReferences[index]?.id
          && reference.title === currentDraft.sessionReferences[index]?.title
          && reference.cwd === currentDraft.sessionReferences[index]?.cwd
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      const movedContexts = (moved.contexts ?? []).flatMap((context) => {
        const normalized = normalizeSelectionContext(context);
        return normalized ? [normalized] : [];
      });
      selectionContextsRef.current = movedContexts;
      setSelectionContexts(movedContexts);
      const movedSessionReferences = (moved.sessionReferences ?? []).flatMap((reference) => {
        const normalized = normalizeSessionReference(reference);
        return normalized ? [normalized] : [];
      });
      sessionReferencesRef.current = movedSessionReferences;
      setSessionReferences(movedSessionReferences);
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(
      text: string,
      images?: ChatDraftImage[],
      targetDraftKey?: string,
      contexts?: SelectionContext[],
      question?: string,
      submittedSessionReferences?: SessionReference[],
    ) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        question ?? text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
        contexts,
        targetsCurrentComposer ? selectionContextsRef.current : storedDraft?.contexts,
        submittedSessionReferences,
        targetsCurrentComposer ? sessionReferencesRef.current : storedDraft?.sessionReferences,
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(question ?? text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (restoredDraft.contexts !== undefined) {
        const normalizedContexts = restoredDraft.contexts.flatMap((context) => {
          const normalized = normalizeSelectionContext(context);
          return normalized ? [normalized] : [];
        });
        selectionContextsRef.current = normalizedContexts;
        setSelectionContexts(normalizedContexts);
      }
      if (restoredDraft.sessionReferences !== undefined) {
        const normalizedReferences = restoredDraft.sessionReferences.flatMap((reference) => {
          const normalized = normalizeSessionReference(reference);
          return normalized ? [normalized] : [];
        });
        sessionReferencesRef.current = normalizedReferences;
        setSessionReferences(normalizedReferences);
      }
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addFiles(files: File[]) {
      void attachFiles(files);
    },
    addSelectionContext(context: SelectionContext) {
      const normalized = normalizeSelectionContext(context);
      if (!normalized) return;
      setSelectionContexts((current) => {
        if (current.some((item) => (
          item.sourceFilePath === normalized.sourceFilePath
          && item.sourceAbsolutePath === normalized.sourceAbsolutePath
          && item.sourceStartLine === normalized.sourceStartLine
          && item.sourceEndLine === normalized.sourceEndLine
          && item.sourceSessionId === normalized.sourceSessionId
          && item.sourceEntryId === normalized.sourceEntryId
          && item.sourceStartOffset === normalized.sourceStartOffset
          && item.sourceEndOffset === normalized.sourceEndOffset
          && item.text === normalized.text
        ))) {
          return current;
        }
        const next = [...current, normalized];
        selectionContextsRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    removeSelectionContext(id: string) {
      setSelectionContexts((current) => {
        const next = current.filter((context) => context.id !== id);
        selectionContextsRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    clearSelectionContexts() {
      selectionContextsRef.current = [];
      setSelectionContexts([]);
    },
    addSessionReference(reference: SessionReference) {
      const normalized = normalizeSessionReference(reference);
      if (!normalized) return;
      setSessionReferences((current) => {
        if (current.some((item) => item.id === normalized.id)) return current;
        const next = [...current, normalized];
        sessionReferencesRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    removeSessionReference(id: string) {
      setSessionReferences((current) => {
        const next = current.filter((reference) => reference.id !== id);
        sessionReferencesRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    clearSessionReferences() {
      sessionReferencesRef.current = [];
      setSessionReferences([]);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    if (compact) return;
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(async (file) => ({
          ...await compressImageFile(file),
          previewUrl: URL.createObjectURL(file),
        }))
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, [compact]);

  // ---------------------------------------------------------------------------
  // fork:gap07-attachments — 任意文件 → 落盘（或就地引用）→ 插入 `@路径`
  // ---------------------------------------------------------------------------

  /** 把引用路径插到光标处（与 `@` 菜单插入的文本同构，所以 agent 侧无需特殊处理）。 */
  const appendAttachmentReferences = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const current = valueRef.current;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? current.length;
    const insert = paths.map((path) => buildAttachmentReference(path).text).join("");
    const needsSpace = cursor > 0 && !/\s/.test(current.slice(cursor - 1, cursor));
    const next = current.slice(0, cursor) + (needsSpace ? " " : "") + insert + current.slice(cursor);
    const nextCursor = cursor + (needsSpace ? 1 : 0) + insert.length;
    valueRef.current = next;
    setValue(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, []);

  /**
   * 上传到附件目录。字节走的是**既有**文件上传路由（同一个 25MB/文件、100MB/单次封套、
   * 同一个冲突策略校验），这里只负责把目录要到手、把结果拼回绝对路径。
   *
   * 同名不覆盖：先用 `conflict=skip`，被跳过的那几个改名重试（`report.csv` →
   * `report-2.csv` → `report-3.csv`）。覆盖会让**旧消息里的引用指向新内容**，
   * 那种错误事后很难发现。
   *
   * 待重试的队列必须同时带着「本地 File」——只记服务端名字会丢了对应关系（名字被改过）。
   */
  const uploadAttachmentFiles = useCallback(async (files: File[]) => {
    const dirResponse = await fetch("/api/attachments");
    if (!dirResponse.ok) throw new Error(`attachments directory failed: ${dirResponse.status}`);
    const { dir } = await dirResponse.json() as { dir?: string };
    if (!dir) throw new Error("attachments directory missing");
    const url = `/api/files/${encodeFilePathForApi(dir)}?type=upload&conflict=skip`;

    const send = async (entries: Array<{ file: File; name: string }>) => {
      const form = new FormData();
      for (const entry of entries) {
        form.append(
          "files",
          entry.name === entry.file.name
            ? entry.file
            : new File([entry.file], entry.name, { type: entry.file.type }),
        );
      }
      const response = await fetch(url, { method: "POST", body: form });
      const body = await response.json().catch(() => null) as {
        uploaded?: string[];
        skipped?: string[];
        errors?: Array<{ name: string; error: string }>;
        error?: string;
      } | null;
      if (!response.ok && !(body?.uploaded?.length)) {
        throw new Error(body?.error ?? `upload failed: ${response.status}`);
      }
      return body ?? {};
    };

    const uploaded: string[] = [];
    const failed: string[] = [];
    const taken = new Set<string>();
    let pending: Array<{ file: File; name: string }> = files.map((file) => ({ file, name: file.name }));

    for (let attempt = 0; attempt < 5 && pending.length > 0; attempt += 1) {
      const body = await send(pending);
      uploaded.push(...(body.uploaded ?? []));
      failed.push(...(body.errors ?? []).map((entry) => entry.name));
      const conflicts = new Set(body.skipped ?? []);
      pending = pending.flatMap((entry) => {
        if (!conflicts.has(entry.name)) return [];
        taken.add(entry.name);
        return [{ file: entry.file, name: nextAvailableAttachmentName(entry.name, taken) }];
      });
    }

    return {
      paths: uploaded.map((name) => joinFilePath(dir, name)),
      names: uploaded,
      failed: [...failed, ...pending.map((entry) => entry.name)],
    };
  }, []);

  /**
   * 所有入口（按钮 / 拖拽 / 粘贴）统一走这里。
   *
   * 图片先走既有内联管道（10MB/10 张 + 压缩，**保持不变**）；剩下的 —— 包括超出图片
   * 上限的那部分 —— 按 `planAttachments` 分成上传 / 就地引用 / 跳过。
   */
  const attachFiles = useCallback(async (files: File[]) => {
    if (compact || files.length === 0) return;
    const imageSlots = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const inlineImages = files
      .filter((file) => file.type.startsWith("image/") && file.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, imageSlots);
    const rest = files.filter((file) => !inlineImages.includes(file));

    if (inlineImages.length > 0) await processImageFiles(inlineImages);
    if (rest.length === 0) return;

    // fork:pr13-composer — 先做 cwd 相对化：桌面外壳能拿到磁盘绝对路径时，
    // cwd 内的文件直接插 `@相对路径`（零拷贝，不经过附件目录）；cwd 外（含
    // `..` 逃逸、前缀相似的兄弟目录）才回退到原有上传 / 就地引用管线。
    const cwdMentionPaths: string[] = [];
    const uploadCandidates: File[] = [];
    for (const file of rest) {
      const absolutePath = desktopFilePathFor(file);
      const mentions = absolutePath && cwd ? toCwdRelativeMentions([absolutePath], cwd).mentions : [];
      if (mentions.length > 0) {
        cwdMentionPaths.push(...mentions);
      } else {
        uploadCandidates.push(file);
      }
    }

    if (uploadCandidates.length === 0) {
      appendAttachmentReferences(cwdMentionPaths);
      setAttachmentNotice({
        added: cwdMentionPaths.map((path) => path.split("/").pop() ?? path),
        skipped: [],
        failed: [],
      });
      return;
    }

    const entries = uploadCandidates.map((file) => ({ file, facts: { name: file.name, size: file.size, type: file.type } }));
    const plan = planAttachments(entries.map((entry) => entry.facts), {
      pathOf: (facts) => {
        const match = entries.find((entry) => entry.facts === facts);
        return match ? desktopFilePathFor(match.file) : null;
      },
    });

    const added = [
      ...cwdMentionPaths.map((path) => path.split("/").pop() ?? path),
      ...plan.referenceInPlace.map((entry) => entry.file.name),
    ];
    const paths = [...cwdMentionPaths, ...plan.referenceInPlace.map((entry) => entry.path)];
    const skipped = plan.skipped.map((entry) => ({ name: entry.file.name, reason: entry.reason }));
    const failed: string[] = [];

    if (plan.upload.length > 0) {
      const uploadFiles = plan.upload.flatMap((facts) => {
        const match = entries.find((entry) => entry.facts === facts);
        return match ? [match.file] : [];
      });
      try {
        const result = await uploadAttachmentFiles(uploadFiles);
        paths.push(...result.paths);
        added.push(...result.names);
        failed.push(...result.failed);
      } catch {
        failed.push(...plan.upload.map((facts) => facts.name));
      }
    }

    appendAttachmentReferences(paths);
    if (added.length > 0 || skipped.length > 0 || failed.length > 0) {
      setAttachmentNotice({ added, skipped, failed });
    }
  }, [appendAttachmentReferences, compact, cwd, processImageFiles, uploadAttachmentFiles]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    selectionContextsRef.current = [];
    setSelectionContexts([]);
    sessionReferencesRef.current = [];
    setSessionReferences([]);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
      contexts: selectionContexts,
      sessionReferences,
    });
  }, [attachedImages, draftKey, selectionContexts, sessionReferences, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        contexts: selectionContextsRef.current,
        sessionReferences: sessionReferencesRef.current,
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    const nextContexts = (draft?.contexts ?? initialSelectionContextsRef.current ?? []).flatMap((context) => {
      const normalized = normalizeSelectionContext(context);
      return normalized ? [normalized] : [];
    });
    const nextSessionReferences = (draft?.sessionReferences ?? []).flatMap((reference) => {
      const normalized = normalizeSessionReference(reference);
      return normalized ? [normalized] : [];
    });
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    selectionContextsRef.current = nextContexts;
    sessionReferencesRef.current = nextSessionReferences;
    setValue(nextValue);
    setSelectionContexts(nextContexts);
    setSessionReferences(nextSessionReferences);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useLayoutEffect(resizeTextarea, [value, fontSize, resizeTextarea]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let previousWidth = -1;
    const observer = new ResizeObserver(([entry]) => {
      // Height updates also notify the observer; only remeasure on width changes.
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      resizeTextarea();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const runBuiltinCommand = useCallback(async (msg: string): Promise<boolean> => {
    if (attachedImages.length || !msg.startsWith("/") || !onBuiltinCommand) return false;
    if (builtinCommandPendingRef.current) return true;
    builtinCommandPendingRef.current = true;
    setBuiltinCommandPending(true);
    try {
      const result = await onBuiltinCommand(msg);
      if (!result.handled) return false;
      if (!result.error && canClearBuiltinCommandInput(valueRef.current, attachedImagesRef.current.length, msg)) clearInput();
      return true;
    } finally {
      builtinCommandPendingRef.current = false;
      setBuiltinCommandPending(false);
    }
  }, [attachedImages.length, clearInput, onBuiltinCommand]);

  const handleSend = useCallback(async () => {
    const question = value.trim();
    if (!question && !attachedImages.length) return;
    const contexts = selectionContextsRef.current;
    const references = sessionReferencesRef.current;
    const msg = serializeComposerMessage(question, contexts, t("chat.quoteIntro"), references);
    onAudioUnlock?.();
    const builtinAllowed = !isStreaming || canRunBuiltinSlashCommandWhileStreaming(msg);
    if (builtinAllowed && await runBuiltinCommand(msg)) return;
    if (isStreaming) return;
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
  }, [value, attachedImages, isStreaming, runBuiltinCommand, onSend, clearInput, onAudioUnlock, t]);

  const slashQuery = !compact && value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const builtinCommands = isStreaming
      ? BUILTIN_SLASH_COMMANDS.filter((command) => command.availableWhileStreaming)
      : BUILTIN_SLASH_COMMANDS;
    const commands = [...builtinCommands, ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || TEXT_COLLATOR.compare(a.name, b.name);
      });
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy);

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0;
  // Warn when images are attached but the selected model is known not to accept
  // image input (#584), including a resolved default. Unknown models stay silent.
  const showImageUnsupportedWarning = (
    attachedImages.length > 0
    && !modelSupportsImageInput(model, modelList)
    && !imageWarningDismissed
  );
  useEffect(() => {
    if (attachedImages.length === 0) setImageWarningDismissed(false);
  }, [attachedImages.length]);

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    const pos = cursor ?? text.length;
    const before = text.slice(0, pos);
    const fileToken = cwd ? extractAtQuery(before) : null;
    setAtQuery(fileToken);
    // fork:gap06-references — 同一次光标解析也产出引用 token。两个抽取器都锚定光标，
    // 所以 `@` 命中时引用 token 必然为空（无需仲裁）。没有 cwd 时 `@` 菜单整体不可用，
    // 但会话/待办引用不需要 cwd，所以它不受这个门控。
    setReferenceQuery(fileToken ? null : extractReferenceQuery(before));
  }, [cwd]);

  // D2-PR-12 — 输入框高亮 token。三条硬规则：
  // 1. **valid 才高亮**：索引/技能未加载时 validator 返回 undefined，tokenizeMentions
  //    按 invalid 处理（高亮绝不猜）；
  // 2. **光标所在 token 保持纯文本**：`activeTokenStart` 取正在编辑的 @ token 起点，
  //    否则半截 token 会在打字时闪高亮；
  // 3. **代码块内不改**：这条针对消息体（remark 插件只改 text 节点）；输入框本身
  //    就是纯文本，不存在 code 节点。
  const highlightSegments = React.useMemo(() => tokenizeMentions(value, {
    fileExists: (path) => {
      if (!fileIndexSnapshot) return undefined;
      const key = path.toLowerCase();
      return fileIndexSnapshot.paths.has(key) || fileIndexSnapshot.dirs.has(key);
    },
    isSkill: (name) => (skillNames ? skillNames.has(name) : undefined),
  }, atQuery?.start ?? null), [value, fileIndexSnapshot, skillNames, atQuery]);

  // D2-PR-12 — 高亮层对齐（AGENTS.md 记的坑：文本域与高亮层必须共享字号，否则错位）。
  //
  // 文本域自己的文字是透明的（caret 保持可见），高亮层必须和它逐像素对齐：
  // - 字号/行高/字体在 CSS 里与 textarea 内联样式共用 --chat-content-font-size；
  // - viewport 的宽高镜像 textarea 的 clientWidth/clientHeight（滚动条出现时内容盒
  //   变窄，不同步就会每行漂移半个字）；
  // - 内层 layer 用 transform 平移 textarea 的滚动偏移，viewport 负责裁剪。
  const syncHighlightScroll = useCallback(() => {
    const ta = textareaRef.current;
    const viewport = highlightViewportRef.current;
    const layer = highlightLayerRef.current;
    if (!ta || !viewport || !layer) return;
    const width = ta.clientWidth;
    const height = ta.clientHeight;
    if (width > 0 && viewport.style.width !== `${width}px`) viewport.style.width = `${width}px`;
    if (height > 0 && viewport.style.height !== `${height}px`) viewport.style.height = `${height}px`;
    const x = ta.scrollLeft > 0 ? -ta.scrollLeft : 0;
    const y = ta.scrollTop > 0 ? -ta.scrollTop : 0;
    layer.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  }, []);
  // 每次渲染后同步：打字、模式切换、自动增高都会走渲染。
  useEffect(() => { syncHighlightScroll(); });
  // textarea 的尺寸也可能在没有 React 渲染时变化（滚动条出现、容器 resize、
  // rAF 里的自动增高），ResizeObserver 负责补同步。
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => syncHighlightScroll());
    observer.observe(ta);
    return () => observer.disconnect();
  }, [syncHighlightScroll]);

  // fork:gap06-references — 程序化改文本的路径（发送后清空、插入引用、草稿恢复…）
  // 都会 `setValue(...)` 但不走 updateAtQuery，上游那里逐个 `setAtQuery(null)` 是 11 处。
  // 与其一个个跟着改，不如让 token 自己校验：记录的区间里不再是对应的 token 文本，就关掉
  // 菜单。以后的任何新重置路径也自动被覆盖。
  useEffect(() => {
    if (!referenceQuery) return;
    const token = `${COMPOSER_REFERENCE_TRIGGERS[referenceQuery.kind]}${referenceQuery.query}`;
    const end = referenceQuery.start + token.length;
    if (value.slice(referenceQuery.start, end) !== token) setReferenceQuery(null);
  }, [value, referenceQuery]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  // ---------------------------------------------------------------------------
  // fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办
  // ---------------------------------------------------------------------------

  /** 当前该展示哪些候选。待办直接来自 prop（无需拉取）。 */
  const referenceItems: ComposerReferenceItem[] = React.useMemo(() => {
    if (!referenceQuery) return [];
    if (referenceQuery.kind === "session") {
      return filterSessionReferenceItems(referenceSessions ?? [], referenceQuery.query);
    }
    if (referenceQuery.kind === "mcp") {
      return filterMcpReferenceItems(referenceMcp ?? [], referenceQuery.query);
    }
    return filterTodoReferenceItems(buildTodoReferenceItems(todoSummary?.todos ?? []), referenceQuery.query);
  }, [referenceQuery, referenceSessions, referenceMcp, todoSummary]);

  // 拉取数据源：只在对应触发符真的被敲出来时才请求，命中缓存则不重复请求。
  useEffect(() => {
    if (!referenceQuery) return;
    if (referenceQuery.kind === "session") {
      const fetchedAt = referenceMetaRef.current.sessions;
      if (fetchedAt !== undefined && Date.now() - fetchedAt < 10_000) return;
      if (referenceFetchRef.current.sessions) return;
      referenceFetchRef.current.sessions = true;
      setReferenceLoading(true);
      fetch("/api/sessions")
        .then((res) => (res.ok ? (res.json() as Promise<{ sessions?: ReferenceSessionSource[] }>) : null))
        .then((data) => {
          setReferenceSessions(buildSessionReferenceItems(data?.sessions ?? [], { currentSessionId }));
          referenceMetaRef.current.sessions = Date.now();
        })
        .catch(() => {
          // 下次敲触发符重试；不要在菜单里空转
          referenceMetaRef.current.sessions = undefined;
        })
        .finally(() => {
          referenceFetchRef.current.sessions = false;
          setReferenceLoading(false);
        });
      return;
    }
    if (referenceQuery.kind === "mcp") {
      if (!cwd) return;
      if (referenceMetaRef.current.mcp === cwd) return;
      if (referenceFetchRef.current.mcp === cwd) return;
      referenceFetchRef.current.mcp = cwd;
      setReferenceLoading(true);
      fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ servers?: ReferenceMcpSource[] }>) : null))
        .then((data) => {
          setReferenceMcp(buildMcpReferenceItems(data?.servers ?? []));
          referenceMetaRef.current.mcp = cwd;
        })
        .catch(() => {
          referenceMetaRef.current.mcp = undefined;
        })
        .finally(() => {
          referenceFetchRef.current.mcp = null;
          setReferenceLoading(false);
        });
    }
  }, [referenceQuery, cwd, currentSessionId]);

  // 敲出/改写触发符时开菜单（与 `@` 菜单同款规则：Escape 关掉，下一次按键重开）。
  const referenceTokenKey = referenceQuery === null
    ? null
    : `${referenceQuery.kind}:${referenceQuery.start}:${referenceQuery.query}`;
  useEffect(() => {
    if (referenceTokenKey === null) {
      setReferenceMenuOpen(false);
      setReferenceActiveIndex(0);
      return;
    }
    setReferenceMenuOpen(true);
    setReferenceActiveIndex(0);
  }, [referenceTokenKey]);

  useEffect(() => {
    if (referenceActiveIndex >= referenceItems.length) {
      setReferenceActiveIndex(Math.max(0, referenceItems.length - 1));
    }
  }, [referenceItems.length, referenceActiveIndex]);

  useEffect(() => {
    referenceItemRefs.current.length = referenceItems.length;
  }, [referenceItems.length]);

  useEffect(() => {
    if (!referenceMenuOpen) return;
    referenceItemRefs.current[referenceActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [referenceActiveIndex, referenceMenuOpen]);

  useLayoutEffect(() => {
    if (!referenceMenuOpen || referenceQuery === null) {
      setReferenceMenuMaxHeight(null);
      return;
    }
    const menu = referenceMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setReferenceMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [referenceMenuOpen, referenceQuery]);

  /**
   * 确认一条候选：
   * - 会话 → 吃掉 token 并加一个 chip（复用已有 SessionReference 管道）；
   * - MCP / 待办 → 把 token 换成行内文本（与 `@path` 同构）。
   */
  const applyReferenceCompletion = useCallback((item: ComposerReferenceItem) => {
    if (!referenceQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    let newValue: string;
    let newPos: number;
    if (item.kind === "session") {
      newValue = value.slice(0, referenceQuery.start) + value.slice(cursor);
      newPos = referenceQuery.start;
      const reference = normalizeSessionReference(sessionReferenceFromItem(item));
      if (reference) {
        setSessionReferences((current) => {
          if (current.some((existing) => existing.id === reference.id)) return current;
          const next = [...current, reference];
          sessionReferencesRef.current = next;
          return next;
        });
      }
    } else {
      const replaced = replaceReferenceToken(value, referenceQuery.start, cursor, buildReferenceInsertText(item));
      newValue = replaced.value;
      newPos = replaced.cursor;
    }
    valueRef.current = newValue;
    setValue(newValue);
    setReferenceQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [referenceQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const question = value.trim();
    if (!question && !attachedImages.length) return;
    const contexts = selectionContextsRef.current;
    const references = sessionReferencesRef.current;
    const msg = serializeComposerMessage(question, contexts, t("chat.quoteIntro"), references);
    onAudioUnlock?.();
    if (!attachedImages.length && onBuiltinCommand && canRunBuiltinSlashCommandWhileStreaming(msg)) {
      void runBuiltinCommand(msg);
      return;
    }
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined, contexts, question, references);
      return;
    }
    clearInput();
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
    }
  }, [value, attachedImages, onBuiltinCommand, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock, runBuiltinCommand, t]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  // ── fork:pr14-compact — 阅读态塌陷接线 ────────────────────────────────
  // 方向由 scrollTop delta 求；ResizeObserver / 首次评估都传 "none"。
  const updateCompactFromScroll = useCallback((direction: InputCompactScrollDirection = "none") => {
    if (isMobile || compact) return;
    const container = messagesScrollRef.current;
    if (!container || inputFocusedRef.current) return;
    setReadingCompact((prev) => nextInputCompactState(prev, {
      kind: "scroll",
      remaining: scrollRemaining(container),
      direction,
      userIntent: Date.now() < compactIntentUntilRef.current,
    }));
  }, [compact, isMobile]);

  useEffect(() => {
    if (isMobile || compact) return;
    const composerRoot = inputShellRef.current?.closest("fieldset") ?? inputShellRef.current;
    if (!composerRoot) return;

    let container: HTMLElement | null = messagesScrollRef.current;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let disposed = false;

    const markScrollIntent = () => {
      compactIntentUntilRef.current = Date.now() + COMPACT_INTENT_MS;
    };

    const handleScroll = () => {
      if (!container) return;
      const delta = container.scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = container.scrollTop;
      updateCompactFromScroll(delta > 0 ? "down" : delta < 0 ? "up" : "none");
    };

    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!COMPACT_SCROLL_KEYS.has(event.key)) return;
      // 输入框 / 可编辑区域里的方向键属于编辑行为（翻历史、移光标），不算阅读滚动。
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      markScrollIntent();
    };

    const attach = (element: HTMLElement) => {
      container = element;
      messagesScrollRef.current = element;
      lastScrollTopRef.current = element.scrollTop;
      element.addEventListener("scroll", handleScroll, { passive: true });
      element.addEventListener("wheel", markScrollIntent, { passive: true });
      element.addEventListener("touchstart", markScrollIntent, { passive: true });
      element.addEventListener("pointerdown", markScrollIntent, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        // 容器高度会随 composer 塌陷/展开放生变化，必须复算底部位置；但这里
        // 拿不到方向，一律用 "none"，绝不能让它自己把状态翻回去（振荡坑）。
        resizeObserver = new ResizeObserver(() => updateCompactFromScroll("none"));
        resizeObserver.observe(element);
      }
      // 首次评估不塌陷：会话打开时可能本来就不在底部（锚点定位），那不算
      // 用户意图，等真实的向上滚动再收。
      updateCompactFromScroll("none");
    };

    const detach = () => {
      if (!container) return;
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", markScrollIntent);
      container.removeEventListener("touchstart", markScrollIntent);
      container.removeEventListener("pointerdown", markScrollIntent);
      resizeObserver?.disconnect();
      resizeObserver = null;
      container = null;
      messagesScrollRef.current = null;
    };

    const discovered = findMessagesScrollContainer(composerRoot);
    if (discovered) {
      attach(discovered);
    } else if (typeof MutationObserver !== "undefined") {
      // 新会话的消息列要等首条消息才挂载；消息列与 composer 同属上一层主区，
      // 所以观察 composer 所在列的父级（包含两者的共同祖先），发现后立刻断开。
      const watchRoot = composerRoot.parentElement?.parentElement ?? composerRoot.parentElement ?? composerRoot;
      mutationObserver = new MutationObserver(() => {
        if (disposed || messagesScrollRef.current) return;
        const found = findMessagesScrollContainer(composerRoot);
        if (found) {
          mutationObserver?.disconnect();
          mutationObserver = null;
          attach(found);
        }
      });
      mutationObserver.observe(watchRoot, { childList: true, subtree: true });
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onGlobalKeyDown);
      mutationObserver?.disconnect();
      mutationObserver = null;
      detach();
    };
  }, [compact, isMobile, updateCompactFromScroll]);

  // 展开后把塌陷期间被 CSS 压成一行高度的 textarea 恢复为内容高度（手动高度模式
  // 由 .is-manual-height 接管，跳过）。
  const wasReadingCompactRef = useRef(false);
  useEffect(() => {
    if (wasReadingCompactRef.current && !readingCompact) {
      const ta = textareaRef.current;
      if (ta && !manualModeRef.current) {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      }
    }
    wasReadingCompactRef.current = readingCompact;
  }, [readingCompact]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        const selectedCommand = displayedSlashCommands[slashActiveIndex];
        if (e.key === "Tab" && selectedCommand) {
          e.preventDefault();
          applySlashCommand(selectedCommand);
          return;
        }
        if (sendShortcut && selectedCommand) {
          e.preventDefault();
          const canSubmitNow = !isStreaming
            || (selectedCommand.source === "builtin" && selectedCommand.availableWhileStreaming === true);
          if (canSubmitNow && isExactSlashCommand(value, selectedCommand)) {
            setSlashMenuOpen(false);
            void handleSend();
          } else {
            applySlashCommand(selectedCommand);
          }
          return;
        }
      }

      // fork:gap06-references — 引用菜单（& / # / ~）与 `@` 菜单同款按键，
      // 同样在 IME 合成期间跳过。
      if (referenceMenuOpen && referenceQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setReferenceActiveIndex((i) => cycleListIndex(i, referenceItems.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setReferenceActiveIndex((i) => cycleListIndex(i, referenceItems.length, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setReferenceMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && referenceItems[referenceActiveIndex]) {
          e.preventDefault();
          applyReferenceCompletion(referenceItems[referenceActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      // fork:pr13-composer — Shift+Enter 的 Markdown 列表续行：无序列表、有序
      // 列表（序号 +1）、task 复选框（重置 `[ ]`）、引用 / 缩进组合；空项则删除整
      // 段前缀（VS Code 行为）。没有结构前缀时返回 null，回退到原生换行。
      //
      // `typeof` 守卫的原因：既有测试直接抽取这个回调在 VM 里执行，不会注入
      // continueMarkdownList；守卫让那些 Shift+Enter 用例仍走原生行为。
      if (e.key === "Enter" && e.shiftKey && !isComposing && !recentlyComposed
        && typeof continueMarkdownList === "function") {
        const ta = textareaRef.current;
        const start = ta?.selectionStart ?? value.length;
        const end = ta?.selectionEnd ?? start;
        const continuation = continueMarkdownList(value, start, end);
        if (continuation) {
          e.preventDefault();
          valueRef.current = continuation.value;
          setValue(continuation.value);
          setAtQuery(null);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(continuation.caret, continuation.caret);
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          });
          return;
        }
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          sendQueued((e.altKey && onFollowUp) || !onSteer ? "followup" : "steer");
        } else {
          handleSend();
        }
      }
    },
    [isMobile, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, referenceMenuOpen, referenceQuery, referenceItems, referenceActiveIndex, applyReferenceCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    // fork:pr23-resize — 手动高度生效时禁用自动增高：高度归手柄所有，textarea
    // 由 CSS 填满卡片；继续写 style.height 不仅无效（CSS !important 覆盖），
    // 还会让后续 reset 时残留旧值。
    if (manualModeRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    // fork:gap07-attachments — 粘贴的文件不再限定图片：图片内联，其余落盘后插路径引用。
    const fileItems = items.filter((item) => item.kind === "file");
    if (!compact && fileItems.length) {
      e.preventDefault();
      const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      void attachFiles(files);
      return;
    }

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const sessionReference = parseSessionReferenceClipboard(text);
    if (sessionReference) {
      e.preventDefault();
      const normalized = normalizeSessionReference(sessionReference);
      if (normalized) {
        setSessionReferences((current) => {
          if (current.some((reference) => reference.id === normalized.id)) return current;
          const next = [...current, normalized];
          sessionReferencesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (!html || !text) return;
    const document = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(document.querySelectorAll("a[href]"), (link) => {
      const label = link.textContent ?? "";
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.setEndBefore(link);
      return {
        label,
        href: link.getAttribute("href")?.trim() ?? "",
        occurrence: label ? range.toString().split(label).length - 1 : 0,
      };
    });
    const markdown = replaceLinksWithMarkdown(text, links);
    if (markdown === null) return;

    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const nextValue = ta.value.slice(0, start) + markdown + ta.value.slice(ta.selectionEnd);
    e.preventDefault();
    valueRef.current = nextValue;
    setValue(nextValue);
    setHistoryMenuOpen(false);
    updateAtQuery(nextValue, start + markdown.length);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }, [attachFiles, compact, updateAtQuery]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }
    const menu = slashMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [slashMenuOpen, slashQuery]);

  useLayoutEffect(() => {
    if (!atMenuOpen || atQuery === null) {
      setAtMenuMaxHeight(null);
      return;
    }
    const menu = atMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setAtMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [atMenuOpen, atQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelSelectorOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })();
  const rawToolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default";
  const toolPresetLabel = rawToolPresetLabel === "chat-only" ? t("chat.chatOnly") : rawToolPresetLabel;
  const sendButton = (
    <button
      onClick={handleSend}
      disabled={!value.trim() && !attachedImages.length}
      aria-label={t("chat.send")}
      title={t("chat.send")}
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // fork:zn-05 — 28px send circle (Zeno send-prompt h-7).
        width: "var(--zn-send)",
        height: "var(--zn-send)",
        padding: 0,
        background: (value.trim() || attachedImages.length) ? "var(--primary-bg)" : "var(--bg-subtle)",
        border: "none",
        borderRadius: "var(--radius-pill)",
        color: (value.trim() || attachedImages.length) ? "var(--primary-fg)" : "var(--text-dim)",
        cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
        transition: "background 0.15s, opacity 0.15s",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
  const stopButton = (
    <button
      onClick={onAbort}
      title={t("chat.stopAgent")}
      aria-label={t("chat.stopAgent")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // fork:zn-05 — 28px stop circle, matches send.
        width: "var(--zn-send)",
        height: "var(--zn-send)",
        padding: 0,
        background: "var(--primary-bg)",
        border: "none",
        borderRadius: "var(--radius-pill)",
        color: "var(--primary-fg)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
      </svg>
    </button>
  );
  const queueControls = isStreaming ? (
    <>
      {onSteer && (
        <button
          onClick={() => sendQueued("steer")}
          disabled={!canQueueStreamingMessage}
          title={t("chat.steerHint")}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 28, padding: "0 9px",
            background: canQueueStreamingMessage ? "var(--warning-soft)" : "none",
            border: `1px solid ${canQueueStreamingMessage ? "var(--warning)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)",
            color: canQueueStreamingMessage ? "var(--warning)" : "var(--text-dim)",
            cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
            fontSize: TEXT.sm, fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
          </svg>
          {t("chat.steer")}
        </button>
      )}
      {onFollowUp && (
        <button
          onClick={() => sendQueued("followup")}
          disabled={!canQueueStreamingMessage}
          title={`${t("chat.followUpHint")} (${isMobile ? "Ctrl/Cmd+" : ""}Alt/Option+Enter)`}
          aria-keyshortcuts={isMobile ? "Control+Alt+Enter Meta+Alt+Enter" : "Alt+Enter"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 28, padding: "0 9px",
            background: canQueueStreamingMessage ? "var(--accent-soft)" : "none",
            border: `1px solid ${canQueueStreamingMessage ? "var(--accent-border)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)",
            color: canQueueStreamingMessage ? "var(--accent)" : "var(--text-dim)",
            cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
            fontSize: TEXT.sm, fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
            <line x1="2" y1="9" x2="8" y2="9" />
          </svg>
          {t("chat.followUp")}
        </button>
      )}
    </>
  ) : null;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);



  return (
    <fieldset
      disabled={builtinCommandPending}
      aria-busy={builtinCommandPending}
      style={{
        flexShrink: 0,
        minWidth: 0,
        margin: 0,
        border: 0,
        background: "transparent",
        padding: compact ? 0 : "0 16px 8px",
        paddingRight: compact ? 0 : 16,
        opacity: builtinCommandPending ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Hidden file input */}
      {!compact && <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // fork:gap07-attachments — 任意文件（原来只收图片，其余静默丢弃）
          void attachFiles(files);
          e.target.value = "";
        }}
      />}
      <div style={{ maxWidth: "var(--composer-max-width, 892px)", margin: "0 auto" }}>
        {/* fork:zn-04 — banners sit above the strip and the strip stays welded to
            the card. Banners are transient alerts, the strip is chrome, so an
            alert must never come between the strip and the card (it would break
            the joined shape). The strip element itself is placed below, right
            before the card. */}
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {showImageUnsupportedWarning && (() => {
          const entry = modelList?.find((m) => m.provider === model?.provider && m.id === model?.modelId);
          return (
            <ModelNoticeBanner
              tone="warning"
              title={t("chat.imageNotSupportedTitle")}
              body={t("chat.imageNotSupportedBody", { model: entry?.name || model?.modelId || "" })}
              onClose={() => setImageWarningDismissed(true)}
            />
          );
        })()}
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div className="anim-popover-down" style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-elev)",
            padding: "5px 0",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}>
              <span style={{
                fontSize: TEXT["2xs"],
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                   title={t("chat.recallTitle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: TEXT.sm,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                   {t("chat.recall")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow
                key={`steer-${i}`}
                kind="steer"
                text={text}
                index={i}
                promoteTitle={t("chat.queueSendNow")}
                removeTitle={t("chat.queueRemove")}
                dragging={draggingQueue?.kind === "steer" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("steer", i, text)}
                onDragStart={onQueueMove ? () => beginQueueDrag("steer", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (drag?.kind !== "steer" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("steer", drag.index, queueDropTarget(drag.index, i), queuedMessages.steering[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow
                key={`followup-${i}`}
                kind="follow-up"
                text={text}
                index={i}
                promoteTitle={t("chat.queueSendNow")}
                removeTitle={t("chat.queueRemove")}
                dragging={draggingQueue?.kind === "followUp" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("followUp", i, text)}
                onPromote={onQueuePromote ? () => onQueuePromote(i, text) : undefined}
                onDragStart={onQueueMove ? () => beginQueueDrag("followUp", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (drag?.kind !== "followUp" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("followUp", drag.index, queueDropTarget(drag.index, i), queuedMessages.followUp[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "var(--warning-soft)", border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
            borderRadius: "var(--radius-md)", fontSize: TEXT.sm, color: "var(--warning)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
             {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {compactResultText && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "var(--success-soft)", border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)",
            borderRadius: "var(--radius-md)", fontSize: TEXT.sm, color: "var(--success)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {compactResultText}
          </div>
        )}
        {compactError && (
          <div
            role="alert"
            style={{
              marginBottom: 8,
              padding: "7px 10px",
              background: "var(--danger-soft)",
              border: "1px solid color-mix(in srgb, var(--danger) 32%, transparent)",
              borderRadius: "var(--radius-md)",
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
              fontSize: TEXT.sm,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {compactError}
          </div>
        )}
        <ComposerContextStrip
          contexts={selectionContexts}
          sessionReferences={sessionReferences}
          disabled={builtinCommandPending || isStreaming}
          onLocate={onLocateSelectionContext}
          onOpenSessionReference={onOpenSessionReference}
          onRemove={(id) => {
            setSelectionContexts((current) => {
              const next = current.filter((context) => context.id !== id);
              selectionContextsRef.current = next;
              return next;
            });
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onRemoveSessionReference={(id) => {
            setSessionReferences((current) => {
              const next = current.filter((reference) => reference.id !== id);
              sessionReferencesRef.current = next;
              return next;
            });
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
        {todoSummary && todoSummary.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <TodoChip summary={todoSummary} />
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <ImagePreview key={img.previewUrl} src={img.previewUrl}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt=""
                    style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
                  />
                </ImagePreview>
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              className="anim-popover"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                maxHeight: "min(44vh, 360px)",
              }}
            >
              <div
                title={t("chat.inputHistory")}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-dim)",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <div style={{ maxHeight: "calc(min(44vh, 360px) - 31px)", overflowY: "auto", padding: 4 }}>
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "7px 8px",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        background: active ? "var(--bg-selected)" : "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: TEXT.sm,
                        lineHeight: 1.45,
                      }}
                    >
                      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: TEXT.xs, color: "var(--text-dim)", paddingTop: 1 }}>
                        {index + 1}
                      </span>
                      <span style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                        {item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              className="anim-popover"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                maxHeight: slashMenuMaxHeight === null
                  ? "min(72.8vh, 598px)"
                  : `min(72.8vh, 598px, ${slashMenuMaxHeight}px)`,
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: TEXT.xs,
                  color: "var(--text-dim)",
                  flexShrink: 0,
                }}
              >
                 <span>{slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: slashCommandCountLabel })}</span>
                 <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 10 }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 4px", fontSize: TEXT.sm, color: "var(--text-dim)" }}>
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -10,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "4px 0 6px",
                          background: "var(--bg)",
                          color: "var(--text-dim)",
                          fontSize: TEXT["2xs"],
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const dormant = isDormantSkillCommand(command, skillDormancy);
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                minHeight: 58,
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                justifyContent: "center",
                                padding: "9px 10px",
                                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                                borderRadius: "var(--radius-sm)",
                                background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                                color: "var(--text)",
                                cursor: "pointer",
                                textAlign: "left",
                                boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
                              }}
                            >
                              <span style={{
                                fontSize: TEXT.md,
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                color: dormant ? "var(--text-dim)" : undefined,
                              }}>
                                /{command.name}
                                {dormant && (
                                  <span style={{
                                    marginLeft: 6,
                                    padding: "0 4px",
                                    border: "1px solid var(--border)",
                                    borderRadius: 3,
                                    fontSize: TEXT["2xs"],
                                    color: "var(--text-dim)",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {t("chat.dormant")}
                                  </span>
                                )}
                              </span>
                               {command.description && (
                                <span style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                  fontSize: TEXT.xs,
                                  lineHeight: 1.35,
                                  color: "var(--text-dim)",
                                }}>
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {referenceMenuOpen && referenceQuery !== null && (
            <ComposerReferenceMenu
              kind={referenceQuery.kind}
              items={referenceItems}
              activeIndex={referenceActiveIndex}
              loading={referenceLoading && referenceItems.length === 0}
              maxHeight={referenceMenuMaxHeight}
              menuRef={referenceMenuRef}
              itemRefs={referenceItemRefs}
              onHover={setReferenceActiveIndex}
              onPick={applyReferenceCompletion}
            />
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                ref={atMenuRef}
                className="anim-popover"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: atMenuMaxHeight === null
                    ? "min(48vh, 400px)"
                    : `min(48vh, 400px, ${atMenuMaxHeight}px)`,
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: TEXT.xs,
                    color: "var(--text-dim)",
                    flexShrink: 0,
                  }}
                >
                  <span>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                   <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
                </div>
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 4 }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "6px 8px", fontSize: TEXT.sm, color: "var(--text-dim)" }}>
                       {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            background: active ? "var(--bg-selected)" : "none",
                            color: "var(--text)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: TEXT.sm,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          {/* fork:gap07-attachments — 附件落盘结果：每次拖入都有可见交代（新增了什么、跳过了什么） */}
          {attachmentNotice && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                // 宽度由外层 composer 容器（`--composer-max-width`）统一约束，
                // 这里不再声明自己的 maxWidth —— 上层的 ChatAppearance 测试
                // 就要求这个变量在文件里只出现一次。
                margin: "0 0 6px",
                padding: "5px 8px 5px 10px",
                border: "1px solid var(--border-faint)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                fontSize: TEXT.xs,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                {attachmentNotice.added.length > 0 && (
                  <span>{t("chat.attachmentAdded", { names: attachmentNotice.added.join("、") })}</span>
                )}
                {attachmentNotice.skipped.length > 0 && (
                  <span style={{ color: "var(--warning)" }}>
                    {t("chat.attachmentSkipped", {
                      limit: Math.round(MAX_ATTACHED_FILE_BYTES / (1024 * 1024)),
                      names: attachmentNotice.skipped.map((entry) => entry.name).join("、"),
                    })}
                  </span>
                )}
                {attachmentNotice.failed.length > 0 && (
                  <span style={{ color: "var(--danger, #ef4444)" }}>
                    {t("chat.attachmentFailed", { names: attachmentNotice.failed.join("、") })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAttachmentNotice(null)}
                aria-label={t("chat.close")}
                title={t("chat.close")}
                style={{
                  marginLeft: "auto",
                  flexShrink: 0,
                  padding: "0 4px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: TEXT.md,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          )}
          {/* fork:zn-04 — the protrusion strip's slot: immediately before the
              card, after every banner. */}
          {protrusion}
          <div
            ref={inputShellRef}
            className={`chat-input-shell${manualMode ? " is-manual-height" : ""}${readingCompact ? " is-compact" : ""}`}
            // fork:pr14-compact — focus 一定展开（状态机 kind: "focus"），
            // 焦点在 composer 内时也不允许塌陷。
            onFocus={() => {
              inputFocusedRef.current = true;
              setReadingCompact((prev) => nextInputCompactState(prev, { kind: "focus" }));
            }}
            onBlur={() => {
              inputFocusedRef.current = false;
            }}
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background: compact ? "none" : "var(--bg-elev)",
              border: compact ? "none" : `1px solid ${bashMode ? "var(--border-strong)" : isStreaming && (onSteer || onFollowUp)
                ? "var(--warning)"
                : "var(--border)"}`,
              borderRadius: compact ? 0 : "var(--radius-composer, 18px)",
              padding: compact ? 0 : "10px 8px 6px 12px",
              boxShadow: compact ? "none" : "var(--shadow-sm)",
              // fork:pr23-resize — 手动高度直接挂在这里；自动模式不写 height，
              // 保持卡片随内容收缩。
              height: manualMode ? `${manualHeight}px` : undefined,
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            } as React.CSSProperties}
          >
          {/* fork:pr23-resize — 手柄骑在卡片上边缘（向上拖变大）。移动端与引用回答
              形态不渲染；阅读态塌陷（.is-compact）时由 CSS 隐藏。 */}
          {!compact && !isMobile && (
            <div
              {...inputHeightResizer.separatorProps}
              className={`chat-input-resize-handle${inputHeightResizer.isResizing ? " is-resizing" : ""}`}
            />
          )}
          <div
            className="chat-input-editor-row"
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: compact ? "column" : "row",
              gap: 8,
              alignItems: compact ? "stretch" : "center",
            }}
          >
          <div
            className="chat-input-highlight-wrap"
            style={{
              position: "relative",
              flex: compact ? "none" : 1,
              minWidth: 0,
              width: "100%",
              display: "flex",
            }}
          >
            {/* D2-PR-12 — 高亮 overlay（透明 textarea + 高亮层）。
                viewport 盖住 textarea 的内容盒并负责裁剪，layer 随滚动平移；
                textarea 自己的文字透明（caret 单独设色），所以可见字形全部来自
                高亮层。只有 valid 的 token 才渲染 .mention-token；正在输入（光标
                所在）的 token 由 activeTokenStart 判定为纯文本，避免半截 token 闪高亮。 */}
            <div
              ref={highlightViewportRef}
              className="chat-input-highlight-viewport"
              aria-hidden="true"
            >
              <div ref={highlightLayerRef} className="chat-input-highlight">
                {highlightSegments.map((segment, i) =>
                  segment.type === "text" || !segment.token.valid ? (
                    segment.text
                  ) : (
                    <span key={i} className={`mention-token mention-token-${segment.token.kind}`}>{segment.text}</span>
                  )
                )}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              aria-label={compact ? t("chat.quoteQuestion") : undefined}
              value={value}
              onChange={(e) => {
                valueRef.current = e.target.value;
                setValue(e.target.value);
                setHistoryMenuOpen(false);
                updateAtQuery(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                updateAtQuery(el.value, el.selectionStart);
              }}
              onScroll={syncHighlightScroll}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                lastCompositionEndAtRef.current = Date.now();
                const el = e.currentTarget;
                updateAtQuery(el.value, el.selectionStart);
              }}
              onInput={handleInput}
              onPaste={handlePaste}
              placeholder={
                isStreaming && (onSteer || onFollowUp)
                  ? t("chat.steerPlaceholder")
                  : isStreaming ? t("chat.agentPlaceholder")
                  : t("chat.messagePlaceholder")
              }
              rows={1}
              style={{
                flex: compact ? "none" : 1,
                minWidth: 0,
                width: "100%",
                background: "none",
                border: "none",
                outline: "none",
                resize: "none",
                // D2-PR-12 — 透明文字 + 可见 caret：字形由下方高亮层提供。
                color: "transparent",
                caretColor: "var(--text)",
                // 盖在高亮层之上（两者都是定位元素，DOM 顺序靠后者获胜），
                // 这样选区与 caret 不会被高亮层遮住。
                position: "relative",
                // 与高亮层共用同一个内容盒：UA 默认 padding 会让两层错位。
                padding: 0,
                fontSize: "var(--chat-content-font-size, 13px)",
                lineHeight: 1.6,
                fontFamily: "inherit",
                minHeight: compact ? 96 : 24,
                maxHeight: 200,
                overflow: "auto",
              }}
            />
          </div>

          {(compact || isMobile) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {isStreaming ? stopButton : sendButton}
            </div>
          )}
          </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* Bottom bar: left | center (context) | right */}
        {!compact && <div className="chat-input-toolbar" style={{
          marginTop: 6,
          display: isMobile ? "grid" : "flex",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : undefined,
          alignItems: "center",
          gap: 6,
        }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: isMobile ? "1 1 auto" : "0 0 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
             title={t("chat.attachFile")}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: "var(--spacing-token-button-composer, 28px)", height: "var(--spacing-token-button-composer, 28px)", padding: 0,
                background: "none", border: "none",
                borderRadius: "var(--radius-md)",
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                opacity: 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {/* Model selector - visible always, disabled while the session or switch is busy */}
            {(modelOptions.length > 0 || model || modelError) && onModelChange && (
              <ModelSelector
                options={modelOptions}
                value={model}
                onChange={onModelChange}
                disabled={isStreaming}
                busy={modelSwitching}
                isAutoSelection={isAutoModelSelection}
              />
            )}
            {/* fork:ui — 输入框侧的独立收藏菜单已移除（用户要求）：收藏现在就在
                模型下拉里每行右侧的星标上（ModelSelector），不需要第二个入口。 */}
          </div>

          {/* spacer */}
          {!isMobile && <div style={{ flex: 1 }} />}

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div ref={controlsMenuRef} style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            marginLeft: isMobile ? 0 : "auto",
          }}>
            {isMobile && (
              <button
                type="button"
                 title={controlsMenuOpen ? undefined : t("chat.moreControls")}
                 aria-label={t("chat.moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setControlsMenuOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: 28,
                  padding: "6px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-muted)",
                  cursor: controlsMenuOpen ? "default" : "pointer",
                  fontSize: TEXT.sm,
                  fontWeight: 500,
                  visibility: controlsMenuOpen ? "hidden" : "visible",
                  pointerEvents: controlsMenuOpen ? "none" : "auto",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {t("chat.moreControls")}
              </button>
            )}
            <div style={{
              display: isMobile ? (controlsMenuOpen ? "flex" : "none") : "flex",
              alignItems: "center",
              gap: isMobile ? 1 : 2,
              ...(isMobile ? {
                position: "absolute",
                right: 0,
                bottom: 0,
                zIndex: 60,
                padding: 1,
                width: "max-content",
                maxWidth: "calc(100vw - 32px)",
                flexWrap: "nowrap",
                justifyContent: "flex-end",
                border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
                boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                backdropFilter: "blur(10px)",
              } : null),
            }}>
            {isStreaming && onThinkingLevelChange && (
              // The level cannot change mid-turn, so this is read-only: a button here
              // would invite clicks that do nothing. It still answers the question
              // that matters while a turn runs, which budget is this one spending.
              <span
                title={t("chat.currentReasoning", { level: thinkingDisplayLabel })}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  // The control row has no gap; each control pads itself, so match
                  // the neighbouring buttons or this sits flush against Stop.
                  // Values follow the fork's tighter composer controls
                  // (6px 10px / 28px), not upstream's 8px 12px / 32px.
                  padding: isMobile ? "0 6px" : "6px 10px",
                  height: 28,
                  color: "var(--text-dim)", fontSize: TEXT.sm,
                }}
              >
                <ThinkingIcon active={false} size={11} />
                {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
              </span>
            )}
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                   title={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                   aria-label={t("chat.changeReasoningLabel")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: TEXT.sm,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                    <line x1="7" y1="18" x2="12" y2="18" />
                    <line x1="8" y1="21" x2="11" y2="21" />
                  </svg>
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                </button>
                {thinkingDropdownOpen && (
                  <div className="anim-popover" style={{
                    position: "absolute", bottom: "calc(100% + 6px)",
                    ...(isMobile ? { left: 0 } : { right: 0 }),
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)", boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                       const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: TEXT.sm, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: TEXT["2xs"], color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* fork:proma-02-mode — 权限档位（Chat-only 会话没有意义，所以隐藏）。
                点一下循环切换：全自动 → 需审批 → 计划。 */}
            {onPermissionModeChange && permissionMode && toolPreset !== "none" && (
              <button
                type="button"
                onClick={() => onPermissionModeChange(nextPermissionMode(permissionMode))}
                title={`${t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}：${t(PERMISSION_MODE_HINT_KEYS[permissionMode])}`}
                aria-label={t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  padding: isMobile ? "0 6px" : "6px 10px",
                  width: isMobile ? "auto" : undefined,
                  height: 28,
                  background: "none",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  // 非默认档位用强调色，因为「当前不全自动」是需要一眼看出来的状态
                  color: permissionMode === "bypass" ? "var(--text-muted)" : "var(--accent)",
                  cursor: "pointer",
                  fontSize: TEXT.sm,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {permissionMode === "bypass" && <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />}
                  {permissionMode === "ask" && (<><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="m9 12 2 2 4-4" /></>)}
                  {permissionMode === "plan" && (<><path d="M8 4h9a2 2 0 0 1 2 2v14l-4-2-3 2-3-2-4 2V6a2 2 0 0 1 2-2z" /><path d="M9 9h6M9 13h4" /></>)}
                </svg>
                {(!isMobile || controlsMenuOpen) && (
                  <span style={{ whiteSpace: "nowrap" }}>{t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}</span>
                )}
              </button>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("chat.changeToolPreset") + `: ${toolPresetLabel}`}
                  aria-label={t("chat.changeToolPreset")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: TEXT.sm,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                </button>
                {toolDropdownOpen && (
                  <div className="anim-popover" style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    right: isMobile ? undefined : 0,
                    left: isMobile ? 0 : undefined,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)", boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 120,
                  }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      let desc: string;
                      if (lvl === "chat-only") desc = t("chat.chatOnly");
                      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                      else desc = t("chat.allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: TEXT.sm, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>{lvl}</span>
                          <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isStreaming && onCompact && (
              <div>
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: isCompacting ? "var(--danger-soft)" : "none",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    color: isCompacting ? "var(--danger)" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: TEXT.sm, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "color-mix(in srgb, var(--danger) 18%, transparent)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "var(--danger-soft)" : "none";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : "var(--text-muted)";
                  }}
                   title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                   aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>{(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compacting")}</span>}</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>{(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compact")}</span>}</>
                  )}
                </button>
              </div>
            )}

            {isStreaming && queueControls}

            {onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                 title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                 aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  width: isMobile ? 32 : 32,
                  height: 28,
                  padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
            )}
            {isMobile && controlsMenuOpen && (
              <button
                type="button"
                 title={t("chat.collapseControls")}
                 aria-label={t("chat.collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setToolDropdownOpen(false);
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 28,
                  padding: 0,
                  marginLeft: 0,
                  background: "var(--bg-hover)",
                  border: "none",
                  borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                  borderRadius: "0 9px 9px 0",
                  color: "var(--text)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            {!isMobile && (isStreaming ? stopButton : sendButton)}
            </div>
          </div>

        </div>}
        {/* Close composer panel (wraps textarea + bottom controls) */}
        </div>
        {/* Close main-input relative wrapper (anchors history / @-mention menus) */}
        </div>
      </div>
    </fieldset>
  );
});
