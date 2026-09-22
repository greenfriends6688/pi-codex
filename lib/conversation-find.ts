/**
 * lib/conversation-find.ts
 *
 * fork:zc-02 — pure search substrate for the in-conversation find bar (⌘F).
 *
 * Why the index is built from the message model instead of the DOM: this chat
 * intentionally only mounts a paged window of messages (see
 * lib/chat-lazy-load.ts and ChatWindow's `visibleCount`), and the loaded context
 * itself starts at the newest ~50 messages until "load earlier" pages older
 * history in. A DOM-only search would answer "no results" for exactly the old
 * hits a long session contains — the case the find bar exists for. Counting and
 * navigation therefore run on this model-level index; the DOM is only used to
 * paint ranges for hits whose entry happens to be rendered (ChatWindow).
 *
 * Kept DOM-free and dependency-free so node --test can exercise it directly.
 * Matching is toLowerCase() + indexOf, never regex word boundaries: Chinese has
 * no spaces between words, so a \b-based search would silently miss every CJK
 * hit while looking correct in English tests.
 */

import type {
  AgentMessage,
  BashExecutionMessage,
  CustomMessage,
  ToolResultMessage,
  UserMessage,
} from "./types";

/** Upper bound on returned hits; the UI can then tell the user the list is partial. */
export const CONVERSATION_FIND_MAX_HITS = 2000;
/** Per-segment clip: one tool result can be a multi-megabyte command log. */
export const CONVERSATION_FIND_MAX_SEGMENT_CHARS = 1_000_000;
/** Context characters kept on each side of a hit when building a snippet. */
export const CONVERSATION_FIND_SNIPPET_CONTEXT = 32;

export type ConversationFindField =
  | "userText"
  | "assistantText"
  | "thinking"
  | "toolName"
  | "toolInput"
  | "toolResult"
  | "command"
  | "output"
  | "customText";

export interface ConversationFindSegment {
  /**
   * Stable identity of the message the text came from. It equals `entryId` and
   * exists because the UI thinks in "message ids" while the session file thinks
   * in "entry ids"; keeping one value under both names makes call sites read
   * clearly without inventing a second identifier.
   */
  messageId: string;
  /** Entry id of the message in the session file; doubles as the DOM anchor key. */
  entryId: string;
  /** Index of the content block inside its message (0 for string content). */
  blockIndex: number;
  field: ConversationFindField;
  text: string;
}

export interface ConversationSearchIndex {
  segments: ConversationFindSegment[];
  /** At least one segment was clipped at CONVERSATION_FIND_MAX_SEGMENT_CHARS. */
  truncated: boolean;
}

export interface ConversationFindHit {
  messageId: string;
  entryId: string;
  field: ConversationFindField;
  /**
   * fork:zc-02 — 命中所在的内容块下标，与 `message.content[blockIndex]` 对齐。
   *
   * 为什么必须有它：每个命中里 194/197 落在 thinking / 工具输出上，而这些正文在
   * 折叠状态下**不在 DOM 里**（MessageView 两段式挂载 + 思考惰性加载）。只靠 entryId
   * 只能定位到消息，无法把那个具体的外层块展开 —— 于是高亮和滚动都拿不到 Range。
   * ChatWindow 用它把命中转成既有的 `searchBlock`（会话搜索跳转用的同一条通路）。
   * `-1` 表示该命中不属于某个块（例如 bash 执行）。
   */
  blockIndex: number;
  /** Character offset of the hit inside the segment text (inclusive). */
  start: number;
  /** Character offset of the hit end inside the segment text (exclusive). */
  end: number;
  /**
   * Nth hit inside this entry across all of its segments, in document order.
   * The DOM painter uses it to pick the matching rendered occurrence; when part
   * of the entry is collapsed or deferred it degrades to the nearest rendered
   * occurrence instead of dropping the highlight entirely.
   */
  occurrence: number;
  /** Short one-line context around the hit, safe to show in the UI. */
  snippet: string;
}

export interface ConversationFindResult {
  hits: ConversationFindHit[];
  /** True when the hit cap or a clipped segment means the list is partial. */
  truncated: boolean;
}

export interface ConversationFindOptions {
  /** Defaults to false (the find bar itself has no case toggle yet). */
  caseSensitive?: boolean;
  /** Defaults to CONVERSATION_FIND_MAX_HITS. */
  limit?: number;
}

/** Text blocks out of a `string | (TextContent | ImageContent)[]` content union. */
function textParts(content: UserMessage["content"] | CustomMessage["content"] | undefined): string[] {
  if (typeof content === "string") return content.length > 0 ? [content] : [];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts;
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** Tool call text: name plus a readable serialization of its input. */
function toolCallText(toolName: string, input: Record<string, unknown>, rawInput?: string): string {
  const body = rawInput && rawInput.length > 0 ? rawInput : safeStringify(input);
  if (!toolName) return body;
  if (!body) return toolName;
  return `${toolName}\n${body}`;
}

interface IndexBuilder {
  segments: ConversationFindSegment[];
  truncated: boolean;
}

function pushSegment(
  builder: IndexBuilder,
  segment: Omit<ConversationFindSegment, "messageId">,
): void {
  if (segment.text.length === 0) return;
  let text = segment.text;
  if (text.length > CONVERSATION_FIND_MAX_SEGMENT_CHARS) {
    text = text.slice(0, CONVERSATION_FIND_MAX_SEGMENT_CHARS);
    builder.truncated = true;
  }
  builder.segments.push({ ...segment, messageId: segment.entryId, text });
}

/**
 * Flatten every searchable text block of a transcript into segments.
 *
 * `entryIds` is the parallel array used by SessionContext; when it is missing
 * or short (streaming edge cases), the message index is used as a fallback id
 * so the index never throws on malformed input.
 *
 * Tool results are attached to the entry that owns their tool call: the flat
 * `messages` array stores them as separate entries, but in grouped rendering
 * their text lives inside the assistant message's DOM node, and an anchor-less
 * entry would make scrolling unable to find anything. Results whose call cannot
 * be located keep their own entry id.
 */
export function buildSearchIndex(
  messages: readonly AgentMessage[],
  entryIds?: readonly (string | undefined)[],
): ConversationSearchIndex {
  const builder: IndexBuilder = { segments: [], truncated: false };
  const entryIdAt = (index: number): string => entryIds?.[index] ?? String(index);

  // First pass: toolCallId -> where the call actually lives.
  //
  // fork:zc-02 — 必须连 blockIndex 一起记：工具结果（toolResult）那一条消息自己是一个
  // entry，但它的正文要展开的却是**拥有它的那条 assistant 消息里那个 toolCall 块**。
  // 早先只把 entryId 换成了 owner，blockIndex 却留着结果消息自己的 partIndex，
  // 于是 ChatWindow 按 blockIndex 取到的块跟命中无关（或干脆不存在）——
  // 表现就是「跳到工具结果类命中时没有高亮、也不展开」。
  const toolCallBlocks = new Map<string, { entryId: string; blockIndex: number }>();
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    (message.content ?? []).forEach((block, blockIndex) => {
      if (block.type === "toolCall" && block.toolCallId) {
        toolCallBlocks.set(block.toolCallId, { entryId: entryIdAt(index), blockIndex });
      }
    });
  });

  messages.forEach((message, messageIndex) => {
    const entryId = entryIdAt(messageIndex);
    if (message.role === "user") {
      textParts(message.content).forEach((text, partIndex) => {
        pushSegment(builder, { entryId, blockIndex: partIndex, field: "userText", text });
      });
      return;
    }

    if (message.role === "assistant") {
      (message.content ?? []).forEach((block, blockIndex) => {
        if (block.type === "text") {
          pushSegment(builder, { entryId, blockIndex, field: "assistantText", text: block.text });
          return;
        }
        if (block.type === "thinking") {
          pushSegment(builder, { entryId, blockIndex, field: "thinking", text: block.thinking });
          return;
        }
        if (block.type === "toolCall") {
          pushSegment(builder, { entryId, blockIndex, field: "toolName", text: block.toolName });
          pushSegment(builder, {
            entryId,
            blockIndex,
            field: "toolInput",
            text: toolCallText(block.toolName, block.input, block.rawInput),
          });
        }
      });
      return;
    }

    if (message.role === "toolResult") {
      const result = message as ToolResultMessage;
      const owner = result.toolCallId ? toolCallBlocks.get(result.toolCallId) : undefined;
      const resultEntryId = owner?.entryId ?? entryId;
      // 命中在工具结果里时，展开目标就是 owner 消息里的那个 toolCall 块。
      const resultBlockIndex = owner?.blockIndex ?? 0;
      textParts(result.content).forEach((text) => {
        pushSegment(builder, { entryId: resultEntryId, blockIndex: resultBlockIndex, field: "toolResult", text });
      });
      return;
    }

    if (message.role === "custom") {
      textParts((message as CustomMessage).content).forEach((text, partIndex) => {
        pushSegment(builder, { entryId, blockIndex: partIndex, field: "customText", text });
      });
      return;
    }

    if (message.role === "bashExecution") {
      const bash = message as BashExecutionMessage;
      pushSegment(builder, { entryId, blockIndex: 0, field: "command", text: bash.command });
      pushSegment(builder, { entryId, blockIndex: 0, field: "output", text: bash.output });
    }
  });

  return builder;
}

/** One-line snippet around a hit, collapsing whitespace and adding ellipses. */
export function buildHitSnippet(
  text: string,
  start: number,
  end: number,
  context = CONVERSATION_FIND_SNIPPET_CONTEXT,
): string {
  const from = Math.max(0, start - context);
  const to = Math.min(text.length, end + context);
  const raw = text.slice(from, to).replace(/\s+/g, " ").trim();
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${raw}${suffix}`;
}

/**
 * Find every (non-overlapping) query occurrence in the indexed segments.
 *
 * Empty/whitespace-only queries match nothing. The search walks forward by the
 * full needle length after a hit, so "aa" in "aaa" counts once, never twice.
 * Hits come back in document order (messages, then blocks, then offsets).
 */
export function findHits(
  index: ConversationSearchIndex,
  query: string,
  options: ConversationFindOptions = {},
): ConversationFindResult {
  const { caseSensitive = false, limit = CONVERSATION_FIND_MAX_HITS } = options;
  const needle = query.trim();
  if (needle.length === 0 || limit <= 0) {
    return { hits: [], truncated: index.truncated };
  }

  const comparableNeedle = caseSensitive ? needle : needle.toLowerCase();
  const hits: ConversationFindHit[] = [];
  const occurrenceByEntry = new Map<string, number>();
  const truncated = index.truncated;

  for (const segment of index.segments) {
    const haystack = caseSensitive ? segment.text : segment.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length - comparableNeedle.length) {
      const start = haystack.indexOf(comparableNeedle, from);
      if (start < 0) break;
      const end = start + comparableNeedle.length;
      const occurrence = occurrenceByEntry.get(segment.entryId) ?? 0;
      occurrenceByEntry.set(segment.entryId, occurrence + 1);
      hits.push({
        messageId: segment.messageId,
        entryId: segment.entryId,
        field: segment.field,
        blockIndex: segment.blockIndex ?? -1,
        start,
        end,
        occurrence,
        snippet: buildHitSnippet(segment.text, start, end),
      });
      if (hits.length >= limit) {
        return { hits, truncated: true };
      }
      // Advance past the whole match: overlapping occurrences count once.
      from = end;
    }
  }

  return { hits, truncated };
}

/**
 * Wrapped index arithmetic for next/previous navigation.
 *
 * `direction` is +1 for next and -1 for previous. A `current` that is out of
 * range (including -1, "nothing active yet") starts from the first hit for
 * next and from the last hit for previous. An empty hit list returns -1.
 */
export function nextHitIndex(current: number, total: number, direction: -1 | 1 = 1): number {
  if (!Number.isFinite(total) || total <= 0) return -1;
  const count = Math.max(1, Math.trunc(total));
  if (!Number.isFinite(current) || current < 0 || current >= count) {
    return direction < 0 ? count - 1 : 0;
  }
  return (Math.trunc(current) + direction + count) % count;
}

/**
 * Stable identity of a hit across re-indexing (older pages load / streaming
 * commits). `occurrence` is unique within an entry, so the key survives hits
 * being prepended by an earlier page of history.
 */
export function conversationFindHitKey(
  hit: Pick<ConversationFindHit, "entryId" | "occurrence"> | null | undefined,
): string | null {
  if (!hit) return null;
  return `${hit.entryId}\u0000${hit.occurrence}`;
}
