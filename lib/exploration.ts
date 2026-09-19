/**
 * fork:proma-05-explore — 探索分支的语义层（纯函数，可单测）。
 *
 * 「探索」= 从主线某条消息 fork 出来的分支会话。SDK 的 `createBranchedSession()`
 * 会把 fork 点之前的 entry **按原 id 复制**给新会话（`chunk-JVUZSMYM.js` 里
 * `pathWithoutLabels = path.map(e => ({...e, parentId}))`），所以：
 *
 * - **「从哪条消息探索出来的」不需要任何额外元数据**：父子两条 entry id 序列的
 *   公共前缀就是被复制的那段，前缀的最后一条 = fork 点之前那条，父会话里它的下一条
 *   = 被用来 fork 的那条消息。
 * - **「带回结论」只取 fork 点之后的 assistant 文本**：pre-fork 内容已经在父会话里，
 *   重复注入等于双倍上下文；且**不自动发送**（对齐 Proma —— 自动发送会污染主线，
 *   这是设计意图不是遗漏）。
 *
 * 与「会话内分支」（`navigate_tree`，同一个文件里多个 leaf）不是一回事：探索是新文件，
 * 父子关系写在 header 的 `parentSession` 上（AGENTS.md 已强调这个区分）。
 */

/** 消息的最小形状（只用到 role 与 content）。 */
export interface ExplorationMessageLike {
  role?: string;
  content?: unknown;
}

export interface ExplorationOrigin {
  parentSessionId: string;
  /** 分支里最后一条与父会话共有的 entry（= fork 点之前那条）。 */
  boundaryEntryId: string;
  /** 父会话里被 fork 的那条消息；父会话在它之后没有条目时为 null。 */
  sourceEntryId: string | null;
  /** 展示用短标签（取自 source 消息文本）。 */
  sourceLabel: string;
}

export interface ExplorationDelta {
  text: string;
  /** 贡献了文本的 assistant 消息条数。 */
  assistantMessages: number;
}

/** 把消息内容里的文本块拼成纯文本（数组内容只取 `type: "text"`）。 */
export function messageText(message: ExplorationMessageLike | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => (
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string"
    ))
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** 压平成单行短标签（给 banner 用；空文本给空串，不要给"..."）。 */
export function labelFromText(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 推导探索来源。
 *
 * 判定方式是「公共前缀」而不是「严格相等开头」：分支的 entry id 是父会话可见路径的
 * 前缀副本，逐位比较时只要还能在父会话里找到同一个 id 就继续往后走；**至少要有 1 条
 * 共有条目**，否则返回 null —— 这样 subagent 会话（同样有 parentSessionId，但没有复制
 * 过来的历史）不会误判成探索分支。
 */
export function deriveExplorationOrigin(input: {
  parentSessionId: string;
  parentEntryIds: readonly string[];
  parentMessages: readonly ExplorationMessageLike[];
  branchEntryIds: readonly string[];
}): ExplorationOrigin | null {
  const parentIndex = new Map<string, number>();
  input.parentEntryIds.forEach((id, index) => { if (!parentIndex.has(id)) parentIndex.set(id, index); });

  let boundaryIndex = -1;
  for (let index = 0; index < input.branchEntryIds.length; index += 1) {
    const id = input.branchEntryIds[index]!;
    if (!parentIndex.has(id)) break;
    boundaryIndex = index;
  }
  if (boundaryIndex < 0) return null;

  const boundaryEntryId = input.branchEntryIds[boundaryIndex]!;
  const parentPosition = parentIndex.get(boundaryEntryId)!;
  const sourceEntryId = input.parentEntryIds[parentPosition + 1] ?? null;
  const sourceLabel = sourceEntryId
    ? labelFromText(messageText(input.parentMessages[parentPosition + 1]))
    : "";

  return { parentSessionId: input.parentSessionId, boundaryEntryId, sourceEntryId, sourceLabel };
}

/** 分支里 fork 点之后的 assistant 文本（连着多条就用空行隔开）。 */
export function explorationDelta(input: {
  branchEntryIds: readonly string[];
  branchMessages: readonly ExplorationMessageLike[];
  boundaryEntryId: string | null;
}): ExplorationDelta {
  const boundary = input.boundaryEntryId;
  const start = boundary === null ? 0 : input.branchEntryIds.indexOf(boundary) + 1;
  const parts: string[] = [];
  for (let index = Math.max(0, start); index < input.branchMessages.length; index += 1) {
    const message = input.branchMessages[index];
    if (!message || message.role !== "assistant") continue;
    const text = messageText(message);
    if (text) parts.push(text);
  }
  return { text: parts.join("\n\n").trim(), assistantMessages: parts.length };
}

export interface BringBackDraft {
  /** 追加到父会话草稿的正文。 */
  value: string;
  /** 一并加进草稿的会话引用（`&session`），让父会话知道结论来自哪条分支。 */
  sessionReference: { id: string; title?: string };
}

/**
 * 「带回结论」要写进父会话草稿的东西：正文 + 一条指向分支的引用。
 * 没有可带回的内容时返回 null（调用方据此禁用按钮，而不是写个空草稿进去）。
 */
export function planBringBack(input: {
  delta: ExplorationDelta;
  branch: { id: string; title?: string };
  existingText?: string;
}): BringBackDraft | null {
  const delta = input.delta.text.trim();
  if (!delta) return null;
  const existing = (input.existingText ?? "").trimEnd();
  const title = input.branch.title?.replace(/\s+/g, " ").trim();
  return {
    value: existing ? `${existing}\n\n${delta}` : delta,
    sessionReference: { id: input.branch.id, ...(title ? { title } : {}) },
  };
}
