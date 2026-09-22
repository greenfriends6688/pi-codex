"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCallBlock, getMessageImages, getMessageText, imageSource } from "./MessageView";
import { ImagePreview } from "./ImagePreview";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { ProcessContentBlock } from "@/lib/process-content";
import type { ToolResultMessage } from "@/lib/types";
import {
  basenameResourcePath,
  classifyDocumentChangeKind,
  classifyShellCommand,
  classifyToolTone,
  extractToolTarget,
  isFindToolName,
  isListToolName,
  isReadToolName,
  isSearchToolName,
  type StepTone,
} from "@/lib/step-categorizer";
import {
  loadStepExpansion,
  stepCategoryOf,
  STEP_EXPANSION_EVENT,
  type StepExpansion,
} from "@/lib/process-step-expansion";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "@/lib/tool-names";
import { extractApplyPatchPaths, getApplyPatchInputText } from "@/lib/apply-patch";
import {
  STREAM_ENTER_CLEANUP_MS,
  streamEnterDelay,
  streamEnterMemory,
} from "@/lib/stream-enter-memory";

/**
 * Grouped "process" renderer.
 *
 * An assistant turn is a long interleaving of reasoning, tool calls and text.
 * Rendered flat, a five-minute run becomes forty collapsible rows and the answer
 * gets lost. This renders that span as a **terminal-style transcript** instead:
 * one summary line, then one compact row per semantic step, joined by tree
 * connectors (`├` / `└`) drawn with CSS borders so they do not depend on a
 * monospace glyph being present.
 *
 *   Used 22 tools (1 failed) · 26 thoughts
 *   ├ 📄 List  13s
 *   ├ ✎ Edit  [index.html] +2
 *   ├ > Run  node js/snake.js
 *   └ ⚠ bash  5s  failed
 *
 * Classification is pure (`lib/step-categorizer.ts`); this file only composes
 * rows. This is the only process renderer now — the flat list and the tab strip
 * were removed on 2026-09-21 — so a turn always reads as one timeline.
 */

type ToolBlock = Extract<ProcessContentBlock, { type: "toolCall" }>;
type TextBlock = Extract<ProcessContentBlock, { type: "text" }>;
type ReasonBlock = Extract<ProcessContentBlock, { type: "thinking" }>;

interface Step {
  id: string;
  /**
   * fork:zm-02 — stable per-turn ordinal used for the stagger delay. Assigned
   * when the step is first pushed (steps are append-only within a turn), so it
   * never shifts when older messages are prepended to the render window — which
   * is exactly why the delay must not read the render array's index.
   */
  sequence: number;
  /** The verb shown first: "Edit", "Run", "Thinking", a tool name on failure. */
  label: string;
  icon: IconName;
  tone?: StepTone;
  /** Repository-relative targets, rendered as file chips. */
  targets: string[];
  /** Secondary text after the label, e.g. the shell command. */
  detail?: string;
  /** Seconds, when the source carried a timestamp pair. */
  duration?: number;
  failed?: boolean;
  /** Tool calls folded into this step (the `×N` count for merged runs). */
  count?: number;
  thinking?: boolean;
  /**
   * Reasoning / note steps carry the model's own words. They render **open by
   * default** (clamped to a few lines) rather than behind a click: reading what
   * the model was thinking is the main reason to look at a timeline at all, and
   * a row that shows nothing makes the whole view feel like a table of contents.
   */
  reasoning?: boolean;
  blocks: ProcessContentBlock[];
}

type IconName =
  | "brain"
  | "search"
  | "read"
  | "edit"
  | "create"
  | "delete"
  | "terminal"
  | "toolbox"
  | "image"
  | "list"
  | "checklist"
  | "folder"
  | "warning";

/**
 * Inline 16px glyphs matching the app's existing hand-rolled SVG vocabulary
 * (this repository deliberately avoids an icon dependency).
 */
function StepIcon({ name }: { name: IconName }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "create":
      return <svg {...common}><path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M12 12v5M9.5 14.5h5" /></svg>;
    case "edit":
      return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
    case "delete":
      return <svg {...common}><path d="M4 6h16M9 6V4h6v2M18 6l-1 14H7L6 6M10 11v5M14 11v5" /></svg>;
    case "read":
      return <svg {...common}><path d="M12 6.5C10.5 5 8 4 4 4v14c4 0 6.5 1 8 2.5 1.5-1.5 4-2.5 8-2.5V4c-4 0-6.5 1-8 2.5z" /><path d="M12 6.5V20.5" /></svg>;
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>;
    case "list":
      return <svg {...common}><path d="M8 6h13M8 12h9M8 18h5" /><circle cx="5" cy="6" r="1.3" /><circle cx="5" cy="12" r="1.3" /><circle cx="5" cy="18" r="1.3" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "terminal":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 10 3 2.5-3 2.5M13 15h4" /></svg>;
    case "checklist":
      return <svg {...common}><path d="m3 7 2 2 3-3M3 17l2 2 3-3M13 8h8M13 18h8" /></svg>;
    case "image":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 17-5-5-6 6" /></svg>;
    case "brain":
      return <svg {...common}><path d="M9.5 4A3 3 0 0 0 7 6.8 3 3 0 0 0 6 12a3 3 0 0 0 1 5.2A3 3 0 0 0 9.5 20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" /><path d="M14.5 4A3 3 0 0 1 17 6.8 3 3 0 0 1 18 12a3 3 0 0 1-1 5.2A3 3 0 0 1 14.5 20a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /></svg>;
    case "warning":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>;
    case "toolbox":
    default:
      return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" /></svg>;
  }
}

// --- Classification ---------------------------------------------------------

const TONE_ICON: Record<StepTone, IconName> = {
  document_change: "edit",
  document_read: "read",
  document_search: "search",
  directory_list: "list",
  file_find: "folder",
  command_execution: "terminal",
  todo_update: "checklist",
  artifact_output: "image",
  approval_rejected: "warning",
};

const TONE_LABEL_KEY: Record<StepTone, string> = {
  document_change: "process.stepChange",
  document_read: "process.stepRead",
  document_search: "process.stepSearch",
  directory_list: "process.stepList",
  file_find: "process.stepFind",
  command_execution: "process.stepCommand",
  todo_update: "process.stepTodo",
  artifact_output: "process.stepArtifact",
  approval_rejected: "process.stepRejected",
};

/** Tones whose target should become a file chip. */
const SHOW_TARGET_TONES: ReadonlySet<StepTone> = new Set<StepTone>([
  "document_change",
  "document_read",
]);

function toolIdentity(block: ToolBlock) {
  return {
    toolName: block.toolName,
    label: typeof block.input?.label === "string" ? block.input.label : undefined,
    args: block.input,
    result: typeof block.result === "string" ? block.result : undefined,
  };
}

/** First string value among the given argument keys, case-insensitively. */
function argString(args: Record<string, unknown> | undefined, names: string[]): string | undefined {
  if (!args) return undefined;
  const lower = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(args)) {
    if (!lower.has(key.toLowerCase())) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Truncate to a single compact line — the row must never wrap. */
function oneLine(text: string, max = 64): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? compact.slice(0, max - 1) + "…" : compact;
}

/**
 * Build the secondary line: for shell commands the parsed `binary argument`
 * (so `bash -lc 'node js/snake.js …'` reads as `node js/snake.js …`), for other
 * tools the most meaningful argument.
 */
function toolDetail(block: ToolBlock, tone: StepTone | undefined): string | undefined {
  if (tone === "command_execution") {
    const command = argString(block.input, ["command", "cmd", "script"]);
    if (!command) return undefined;
    const info = classifyShellCommand(command);
    const rendered = info.argument ? `${info.binary} ${info.argument}` : info.binary;
    return oneLine(rendered, 72);
  }
  const raw = argString(block.input, ["pattern", "query", "path", "filePath", "file", "url"]);
  if (!raw) return undefined;
  return oneLine(raw, 72);
}

/** Build one step from a run of tool calls that share a tone. */
function toolStep(blocks: ToolBlock[], t: (key: string) => string, sequence: number): Step {
  const first = blocks[0];
  const id = blocks.length === 1 ? first.id : `group:${first.id}`;
  const failed = blocks.some((b) => b.status === "error");

  // fork:process-failed-label — 失败行以前退回原始工具名，结果整行读作
  // 「bash 39s 失败」：既不知道跑的是什么命令，也不知道动的是哪个文件。现在语义动词、
  // 目标文件和命令细节全都保留，是不是失败交给行尾的「失败」徽标 + warning 图标表达。
  const tone = classifyToolTone(toolIdentity(first));
  const icon = tone ? TONE_ICON[tone] : "toolbox";
  let resolvedIcon = icon;
  if (tone === "document_change") {
    const kind = classifyDocumentChangeKind({ toolName: first.toolName, args: first.input });
    resolvedIcon = kind === "create" ? "create" : kind === "delete" ? "delete" : "edit";
  }

  const targets = tone && SHOW_TARGET_TONES.has(tone)
    ? blocks
      .map((b) => extractToolTarget(toolIdentity(b)))
      .filter((target): target is string => Boolean(target))
    : [];

  const durations = blocks.map((b) => b.duration).filter((d): d is number => d !== undefined);

  return {
    id,
    sequence,
    label: tone ? t(TONE_LABEL_KEY[tone]) : first.toolName,
    icon: failed ? "warning" : resolvedIcon,
    tone,
    targets,
    detail: tone === "command_execution" ? toolDetail(first, tone) : undefined,
    duration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
    failed: failed || undefined,
    count: blocks.length,
    blocks,
  };
}

/**
 * Collapse a block list into steps.
 *
 * Grouping rule: a run of **consecutive successful tool calls sharing one tone**
 * becomes a single step (three edits → one "Edit" step with three file chips).
 * An error, an unknown tool, or any change of tone starts its own step, so the
 * transcript never loses information about what ran in which order.
 */
export function buildProcessSteps(blocks: ProcessContentBlock[], t: (key: string) => string): Step[] {
  const steps: Step[] = [];
  let buffer: ToolBlock[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    steps.push(toolStep(buffer, t, steps.length));
    buffer = [];
  };

  const bufferedTone = () => (buffer.length > 0 ? classifyToolTone(toolIdentity(buffer[0])) : undefined);

  for (const block of blocks) {
    if (block.type === "toolCall") {
      const tone = block.status === "error" ? undefined : classifyToolTone(toolIdentity(block));
      if (buffer.length > 0 && (tone === undefined || tone !== bufferedTone())) flush();
      buffer.push(block);
      continue;
    }

    flush();

    if (block.type === "text" || block.type === "thinking") {
      const previous = steps[steps.length - 1];
      const canMerge = previous
        && previous.reasoning === true
        && previous.thinking === (block.type === "thinking")
        && previous.failed !== true;
      if (canMerge) {
        previous.blocks.push(block);
        previous.detail = oneLine(block.type === "thinking" ? block.thinking : block.text);
        // Only thinking blocks carry a duration; text blocks contribute 0 and
        // must not turn a known duration back into `undefined`.
        const added = block.type === "thinking" ? block.duration : undefined;
        if (added !== undefined) previous.duration = (previous.duration ?? 0) + added;
        continue;
      }
      steps.push({
        id: block.id,
        sequence: steps.length,
        label: t(block.type === "thinking" ? "process.stepReasoning" : "process.stepNote"),
        icon: block.type === "thinking" ? "brain" : "checklist",
        targets: [],
        duration: block.type === "thinking" ? block.duration : undefined,
        thinking: block.type === "thinking",
        reasoning: true,
        // fork:process-live — a closed reasoning row used to read "推理" and nothing
        // else, which is what made the grouped views feel like a table of contents.
        // The first line of the model's own words belongs on the row itself.
        detail: oneLine(block.type === "thinking" ? block.thinking : block.text),
        blocks: [block],
      });
      continue;
    }

    steps.push({
      id: block.id,
      sequence: steps.length,
      label: t(block.type === "image" ? "process.stepImage" : "process.stepCustom"),
      icon: block.type === "image" ? "image" : "toolbox",
      targets: [],
      blocks: [block],
    });
  }

  flush();
  return steps;
}

/** `Used 22 tools (1 failed) · 26 thoughts` */
/**
 * fork:ui-19 — one-line summary of a turn (MusePi rounds show "N files changed ·
 * N commands · N tools" above the fold, transcript-content.tsx:573-594).
 *
 * Before this only tool/failed/thinking counts existed, so "what did this round
 * actually do" needed a click. Files are counted **distinctly** (one file edited
 * three times is one file), commands are shell-ish tools, reads aggregate the
 * explore tools — the same categories the timeline rows already use.
 */
export function summarizeSteps(steps: Step[], t: (key: string, params?: Record<string, string | number>) => string): string {
  let tools = 0;
  let failed = 0;
  let thoughts = 0;
  let commands = 0;
  let reads = 0;
  const changedFiles = new Set<string>();
  for (const step of steps) {
    if (step.thinking) {
      thoughts += step.blocks.length;
      continue;
    }
    const toolBlocks = step.blocks.filter((block) => block.type === "toolCall");
    if (toolBlocks.length === 0) continue;
    tools += step.count ?? toolBlocks.length;
    if (step.failed) failed += toolBlocks.length;
    for (const block of toolBlocks) {
      if (block.type !== "toolCall") continue;
      const name = block.toolName;
      if (isShellToolName(name)) {
        commands += 1;
        continue;
      }
      // Reads must be classified *before* writes: a read tool carries a path too,
      // and the document-change classifier alone would happily count it as an edit.
      if (isReadToolName(name) || isSearchToolName(name) || isListToolName(name) || isFindToolName(name)) {
        reads += 1;
        continue;
      }
      if (isWriteToolName(name) || isEditToolName(name)) {
        const target = readWrittenPath(block.input);
        if (target) changedFiles.add(target);
        continue;
      }
      if (isApplyPatchToolName(name)) {
        // One patch can touch several files, and its targets only exist in the
        // patch text — reuse the parser the turn's file chips already use.
        const paths = extractApplyPatchPaths(getApplyPatchInputText(block.input));
        if (paths.length === 0) changedFiles.add(`patch:${block.id}`);
        else for (const path of paths) changedFiles.add(path);
      }
    }
  }
  const parts: string[] = [];
  if (changedFiles.size > 0) parts.push(t("process.summaryFiles", { count: changedFiles.size }));
  if (commands > 0) parts.push(t("process.summaryCommands", { count: commands }));
  if (parts.length === 0 && reads > 0) parts.push(t("process.summaryReads", { count: reads }));
  parts.push(t("process.summaryTools", { count: tools }));
  if (failed > 0) parts.push(t("process.summaryFailed", { count: failed }));
  if (thoughts > 0) parts.push(t("process.summaryThoughts", { count: thoughts }));
  return parts.join(" · ");
}

/** The two argument spellings write/edit tools use (see lib/turn-written-files.ts). */
function readWrittenPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Shell-family tools. `powershell` is the Windows preset's shell. */
function isShellToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "bash" || lower === "powershell" || lower === "shell" || lower === "exec" || lower === "run";
}

/**
 * One-line digest of a whole assistant process span.
 *
 * Exported so `ChatWindow` can hand it to the outer `ProcessDetailsGroup`
 * header: the group owns the collapse control, so its label is the only summary
 * the user should see. Rendering a second one inside `ProcessGroup` stacked two
 * count lines on top of each other.
 */
export function summarizeProcessBlocks(
  blocks: ProcessContentBlock[],
  t: (key: string, params?: Record<string, string | number>) => string,
  translateStep: (key: string) => string,
): string {
  if (blocks.length === 0) return "";
  return summarizeSteps(buildProcessSteps(blocks, translateStep), t);
}

// --- Row pieces -------------------------------------------------------------

function FileChips({
  targets,
  onOpenFile,
  compact = false,
}: {
  targets: string[];
  onOpenFile?: (filePath: string) => void;
  compact?: boolean;
}) {
  if (targets.length === 0) return null;
  // Beyond the cap the row would wrap, so the remainder becomes a `+N` hint —
  // the same shape the reference transcript uses.
  const cap = compact ? 2 : 3;
  const shown = targets.slice(0, cap);
  const rest = targets.length - shown.length;
  return (
    <>
      {shown.map((target) => {
        const name = basenameResourcePath(target);
        const inner = (
          <>
            <span className="process-chip-icon" aria-hidden="true">{getFileIcon(name, 12)}</span>
            <span className="process-chip-name">{name}</span>
          </>
        );
        // fork:fix-nested-button — 这里**不能**用真 `<button>`：`FileChips` 的两个调用点
        // 都在按钮内部（步骤行 `process-step-row`、紧凑 chip 行），嵌套 button 是非法 HTML，
        // React 会报 “<button> cannot be a descendant of <button>” 并引发 hydration 报错。
        // 用 `span[role=button]` + 键盘处理保持原来的点击行为与可达性，同时不违反内容模型。
        return onOpenFile ? (
          <span
            key={target}
            role="button"
            tabIndex={0}
            className="process-file-chip"
            title={target}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(target);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onOpenFile(target);
            }}
          >
            {inner}
          </span>
        ) : (
          <span key={target} className="process-file-chip" title={target}>{inner}</span>
        );
      })}
      {rest > 0 && <span className="process-file-more">+{rest}</span>}
    </>
  );
}

function Duration({ seconds }: { seconds?: number }) {
  if (!seconds || seconds <= 0) return null;
  return <span className="process-step-duration">{seconds}s</span>;
}

function ReasoningBody({ blocks }: { blocks: ProcessContentBlock[] }) {
  return (
    <div className="process-step-body process-reasoning-body">
      {blocks.map((block) => (
        <div key={block.id} className={`process-step-reasoning is-${block.type}`}>
          <MarkdownBody>
            {block.type === "thinking"
              ? (block as ReasonBlock).thinking
              : block.type === "text"
                ? (block as TextBlock).text
                : ""}
          </MarkdownBody>
        </div>
      ))}
      {/* fork:ui-process-full — the body used to be clamped to ~6 lines behind a
          "展开全文" button. The row itself already opens and closes, so the second
          collapsible layer only hid the reasoning the reader had just asked for
          (and its button sat under the fade, which read as a rendering bug). */}
    </div>
  );
}

/**
 * A standalone image (assistant output or custom-message attachment) rendered
 * with the flat renderer's `ImagePreview` + `<img>` so both modes share the
 * same click-to-zoom lightbox.
 */
function ProcessImage({ src }: { src: string }) {
  return (
    <ImagePreview src={src}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{ maxWidth: 240, maxHeight: 240, borderRadius: "var(--radius-sm)", objectFit: "contain", display: "block", border: "1px solid var(--border)" }}
      />
    </ImagePreview>
  );
}

/** Wrapping row for one or more process images. */
function ProcessImages({ images }: { images: string[] }) {
  if (images.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {images.map((src, index) => (
        <ProcessImage key={`${src}-${index}`} src={src} />
      ))}
    </div>
  );
}

function ToolBody({
  blocks,
  toolResults,
  onOpenSession,
  revealToolCallId,
}: {
  blocks: ProcessContentBlock[];
  toolResults?: Map<string, ToolResultMessage>;
  onOpenSession?: (sessionId: string) => void;
  /** fork:zc-02 — 被查找/搜索命中的那个工具调用，强制展开它的结果正文。 */
  revealToolCallId?: string;
}) {
  return (
    <div className="process-step-body process-step-tools">
      {blocks.map((block) => {
        if (block.type !== "toolCall") {
          if (block.type === "image") {
            const src = imageSource({ type: "image", source: block.source });
            return src ? <ProcessImages key={block.id} images={[src]} /> : null;
          }
          return (
            <div key={block.id} className="process-step-reasoning is-text">
              <MarkdownBody>
                {block.type === "thinking" ? (block as ReasonBlock).thinking : (block as TextBlock).text}
              </MarkdownBody>
            </div>
          );
        }
        return (
          <ToolCallBlock
            key={block.id}
            block={{
              type: "toolCall",
              toolCallId: block.toolCallId,
              toolName: block.toolName,
              input: block.input,
            }}
            result={block.result ?? toolResults?.get(block.toolCallId)}
            duration={block.duration}
            onOpenSession={onOpenSession}
            // fork:zc-02 — 分组（timeline）路径下 ToolCallBlock 自带一层折叠，
            // ProcessGroup 的 reveal 只打开外层 step；命中在工具结果里时必须让这个
            // 具体的卡也展开，否则结果正文根本不在 DOM 里（高亮拿不到 Range）。
            reveal={Boolean(revealToolCallId) && block.toolCallId === revealToolCallId}
          />
        );
      })}
    </div>
  );
}

function StepBody({
  step,
  toolResults,
  onOpenSession,
  revealToolCallId,
}: {
  step: Step;
  toolResults?: Map<string, ToolResultMessage>;
  onOpenSession?: (sessionId: string) => void;
  revealToolCallId?: string;
}) {
  if (step.blocks.length === 0) return null;
  const first = step.blocks[0];
  // Reasoning-only steps render as prose; everything else as tool surfaces.
  if (step.reasoning) {
    return <ReasoningBody blocks={step.blocks} />;
  }
  if (first.type === "custom") {
    // `CustomMessage.content` is string | (TextContent|ImageContent)[]; going
    // through the flat renderer's helpers keeps arrays readable and images.
    const text = getMessageText(first.message.content);
    const imageSources = getMessageImages(first.message.content)
      .map((image) => imageSource(image))
      .filter((src) => src.length > 0);
    return (
      <div className="process-step-body">
        <ProcessImages images={imageSources} />
        {text && <MarkdownBody>{text}</MarkdownBody>}
      </div>
    );
  }
  return <ToolBody blocks={step.blocks} toolResults={toolResults} onOpenSession={onOpenSession} revealToolCallId={revealToolCallId} />;
}

// --- Streaming entrance (fork:zm-02) ------------------------------------------

/**
 * fork:zm-02 — true only when the user explicitly asked for motion.
 *
 * SSR and jsdom never see `matchMedia`, so the entrance stays inert there and
 * unit tests never assert mid-animation attributes. The CSS block carries its
 * own `prefers-reduced-motion` branch as the second line of defence.
 */
function useForkMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return enabled;
}

/**
 * fork:zm-02 — resolves which step ids are allowed to play the entrance.
 *
 * The decision has to happen **during render**: a marker added one effect later
 * would let the row paint once at full opacity and then visibly restart from 0.
 * Fresh ids are therefore collected from `knownRef` while rendering (a pure read
 * of the shared memory), and the effect only does the bookkeeping: baseline on
 * the first commit, record + schedule marker cleanup afterwards.
 *
 * The first commit is a baseline: every id already on screen is recorded in the
 * shared memory without animating, so switching sessions (or remounting the
 * paged window) never replays the whole screen.
 *
 * Deliberately no effect cleanup for the cleanup timer: the module memory
 * survives the component, React StrictMode would otherwise cancel the timer on
 * its simulated double-invoke, and a stray `setState` after unmount is a no-op.
 */
function useStreamEnterIds(idsKey: string, enabled: boolean): ReadonlySet<string> {
  const [cleanupPending, setCleanupPending] = useState<ReadonlySet<string>>(() => new Set<string>());
  const knownRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(false);

  const ids = useMemo(() => (idsKey.length === 0 ? [] : idsKey.split("\n")), [idsKey]);

  // Render-phase read: ids that appeared since the last commit and have never
  // played anywhere in this tab. `shouldPlay` does not mutate the memory.
  const enteringNow: string[] = [];
  if (mountedRef.current && enabled) {
    for (const id of ids) {
      if (knownRef.current.has(id)) continue;
      if (streamEnterMemory.shouldPlay(id, true)) enteringNow.push(id);
    }
  }

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      for (const id of ids) {
        knownRef.current.add(id);
        streamEnterMemory.record(id);
      }
      return;
    }

    const fresh: string[] = [];
    for (const id of ids) {
      if (knownRef.current.has(id)) continue;
      knownRef.current.add(id);
      if (enabled && streamEnterMemory.shouldPlay(id, true)) fresh.push(id);
    }
    if (fresh.length === 0) return;

    for (const id of fresh) streamEnterMemory.record(id);
    setCleanupPending((current) => {
      const next = new Set(current);
      for (const id of fresh) next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setCleanupPending((current) => {
        if (!fresh.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, STREAM_ENTER_CLEANUP_MS);
  }, [enabled, ids]);

  if (enteringNow.length === 0) return cleanupPending;
  const next = new Set(cleanupPending);
  for (const id of enteringNow) next.add(id);
  return next;
}

// --- Component --------------------------------------------------------------

export interface ProcessGroupProps {
  blocks: ProcessContentBlock[];
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  onOpenFile?: (filePath: string) => void;
  onOpenSession?: (sessionId: string) => void;
  /** Force the detail bodies open (e.g. a search hit landed inside the group). */
  reveal?: boolean;
  /** fork:zc-02 — 命中所在的工具调用 id，透传到 ToolBody。 */
  revealToolCallId?: string;
  className?: string;
}

export function ProcessGroup({
  blocks,
  isStreaming = false,
  toolResults,
  onOpenFile,
  onOpenSession,
  reveal = false,
  revealToolCallId,
  className,
}: ProcessGroupProps) {
  const { t } = useI18n();
  const steps = useMemo(() => buildProcessSteps(blocks, t), [blocks, t]);

  // fork:zm-02 — new steps fade in one after another while the turn streams.
  // `step.sequence` (not the map index) is the stagger slot; the shared memory
  // guarantees each step id only ever plays the entrance once.
  const motionEnabled = useForkMotionEnabled();
  const streamAnimate = isStreaming && motionEnabled;
  const stepIdsKey = useMemo(() => steps.map((step) => step.id).join("\n"), [steps]);
  const enteringIds = useStreamEnterIds(stepIdsKey, streamAnimate);

  // fork:step-expansion — 哪几类步骤默认展开由设置决定（推理 / 命令 / 工具调用），
  // 改设置时广播事件，已经挂载的时间线立刻跟着变。
  const [expansion, setExpansion] = useState<StepExpansion>(loadStepExpansion);
  useEffect(() => {
    const onChange = () => setExpansion(loadStepExpansion());
    window.addEventListener(STEP_EXPANSION_EVENT, onChange);
    return () => window.removeEventListener(STEP_EXPANSION_EVENT, onChange);
  }, []);

  // Reasoning and note rows start open by default (and any other category the
  // reader opted into): their content is the point of the timeline, and hiding
  // it behind a click turns the view into a table of contents. They render
  // clamped to a few lines; `expandedIds` removes the clamp. Keeping "is it
  // open" and "is the clamp lifted" in two separate sets means the row chevron
  // keeps one consistent meaning (open / closed) instead of cycling through
  // three states.
  const defaultOpen = useMemo(
    () => new Set(steps.filter((step) => expansion[stepCategoryOf(step)]).map((step) => step.id)),
    [steps, expansion],
  );
  /** Explicit user overrides; absent = follow `defaultOpen`. */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());

  // fork:pr15-follow — 流式跟随最新 step 自己的滚动窗（REF 的 userScrolledUpRef /
  // ignoreProgrammaticScrollUntilRef）。只给最新一步挂 max-height 窗口，历史步
  // 保持原来的自由高度，避免动到已有的非流式渲染。
  const latestStepId = steps.length > 0 ? steps[steps.length - 1].id : null;
  const latestStepOpen = latestStepId !== null
    && (reveal || isStreaming || (overrides.get(latestStepId) ?? defaultOpen.has(latestStepId)));
  const latestStepScrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  // 阴影只在窗口越界时挂载；函数式 bail-out 让 ResizeObserver 的高频回调在数值
  // 没变时不触发 re-render（流式每个 delta 都会改变容器高度）。
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);

  const updateShadows = useCallback(() => {
    const element = latestStepScrollRef.current;
    if (!element) return;
    setShowTopShadow((prev) => {
      const next = element.scrollTop > 0;
      return prev === next ? prev : next;
    });
    setShowBottomShadow((prev) => {
      const next = element.scrollHeight - element.scrollTop - element.clientHeight > 1;
      return prev === next ? prev : next;
    });
  }, []);

  // 最新 step 换容器 / 重新打开时：清掉用户上翻标记并把窗口贴底。
  useEffect(() => {
    userScrolledUpRef.current = false;
    const element = latestStepScrollRef.current;
    if (!element) return;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + 100;
    element.scrollTop = element.scrollHeight;
    updateShadows();
  }, [latestStepId, latestStepOpen, updateShadows]);

  // 窗口内滚动：离底 >4px 视为用户上翻，回到 4px 内恢复跟随。程序化滚动会回传
  // scroll 事件，100ms 屏蔽窗把它和真实用户操作分开。
  useEffect(() => {
    const element = latestStepScrollRef.current;
    if (!element) return;
    const onScroll = () => {
      if (Date.now() < ignoreProgrammaticScrollUntilRef.current) return;
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 4;
      updateShadows();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [latestStepId, latestStepOpen, updateShadows]);

  // 贴底时内容增长不会触发 scroll 事件（scrollTop 不变），用 ResizeObserver 重算
  // 阴影，底部的淡出提示才不会滞后。
  useEffect(() => {
    const element = latestStepScrollRef.current;
    if (!element) return;
    updateShadows();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateShadows);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [latestStepId, latestStepOpen, isStreaming, updateShadows]);

  // 流式期间把最新 step 贴底；用户上翻后暂停，滚回底部由上面的 scroll 监听恢复。
  useEffect(() => {
    const element = latestStepScrollRef.current;
    if (!element || !isStreaming || userScrolledUpRef.current) return;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + 100;
    element.scrollTop = element.scrollHeight;
    updateShadows();
  }, [blocks, isStreaming, latestStepId, latestStepOpen, updateShadows]);

  if (steps.length === 0) return null;

  // Streaming keeps the newest step open so work is visible as it happens.
  const streamingOpen = isStreaming ? steps[steps.length - 1]?.id : null;

  const isStepOpen = (id: string): boolean => {
    if (reveal || streamingOpen === id) return true;
    return overrides.get(id) ?? defaultOpen.has(id);
  };

  const toggle = (id: string) => {
    setOverrides((current) => {
      const next = new Map(current);
      next.set(id, !isStepOpen(id));
      return next;
    });
  };

  return (
    <section
      className={`process-group is-timeline${className ? ` ${className}` : ""}`}
      aria-label={t("process.groupLabel")}
      data-step-count={steps.length}
    >
        <ol className="process-steps" data-fork-stream-animate={streamAnimate ? "true" : undefined}>
          {steps.map((step, index) => {
            const id = step.id;
            const isOpen = isStepOpen(id);
            const last = index === steps.length - 1;
            const entering = enteringIds.has(id);
            return (
              <li
                key={id}
                // fork:zn-10 — marks the streaming-open step so fork-ui.css can
                // shimmer its verb (Zeno .shimmer); static rows never animate.
                data-live={streamingOpen === id || undefined}
                // fork:zm-02 — only freshly appended steps carry the entrance
                // marker; the memory decides, not the render position.
                data-fork-enter={entering ? "true" : undefined}
                style={entering
                  ? ({ "--fork-enter-delay": streamEnterDelay(step.sequence) } as CSSProperties)
                  : undefined}
                className={[
                  "process-step",
                  isOpen ? " is-open" : "",
                  last ? " is-last" : "",
                  step.failed ? " is-failed" : "",
                  step.thinking ? " is-thinking" : "",
                  step.reasoning ? " is-reasoning" : "",
                ].filter(Boolean).join(" ")}
              >
                <button
                  type="button"
                  className="process-step-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(id)}
                >
                  <span className="process-step-icon" aria-hidden="true">
                    <StepIcon name={step.icon} />
                  </span>
                  <span className="process-step-label">{step.label}</span>
                  {step.count !== undefined && step.count > 1 && (
                    <span className="process-step-count">×{step.count}</span>
                  )}
                  <FileChips targets={step.targets} onOpenFile={onOpenFile} />
                  {/* fork:process-dedupe — 推理行展开后正文就是这段文字，行上再挂一份
                      截断版等于同一句话说两遍（闭合时仍保留，避免只剩一个「推理」）。 */}
                  {step.detail && !isOpen && <span className="process-step-detail">{step.detail}</span>}
                  <Duration seconds={step.duration} />
                  {step.failed && <span className="process-step-failed">{t("process.failed")}</span>}
                </button>
                {isOpen && (
                  <div style={{ position: "relative" }}>
                    <div
                      ref={last ? latestStepScrollRef : undefined}
                      style={{ maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}
                    >
                      <StepBody
                        revealToolCallId={revealToolCallId}
                        step={step}
                        toolResults={toolResults}
                        onOpenSession={onOpenSession}
                      />
                    </div>
                    {last && showTopShadow && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: 24,
                          zIndex: 10,
                          pointerEvents: "none",
                          background: "linear-gradient(to bottom, var(--bg), transparent)",
                        }}
                      />
                    )}
                    {last && showBottomShadow && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 24,
                          zIndex: 10,
                          pointerEvents: "none",
                          background: "linear-gradient(to top, var(--bg), transparent)",
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
    </section>
  );
}
