"use client";

import { useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCallBlock, getMessageImages, getMessageText, imageSource } from "./MessageView";
import { ImagePreview } from "./ImagePreview";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import { useProcessDisplayMode } from "@/hooks/useProcessDisplayMode";
import type { ProcessContentBlock } from "@/lib/process-content";
import type { ToolResultMessage } from "@/lib/types";
import {
  basenameResourcePath,
  classifyDocumentChangeKind,
  classifyShellCommand,
  classifyToolTone,
  extractToolTarget,
  type StepTone,
} from "@/lib/step-categorizer";

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
 * Two display modes:
 *  - `timeline` — the rows above, the default reading view;
 *  - `tabs`     — the same steps as a wrapped chip strip: a compact digest of
 *                 the turn where a chip opens its detail in place.
 *
 * Classification is pure (`lib/step-categorizer.ts`); this file only composes
 * rows. The renderer is opt-in — `useProcessDisplayMode()` defaults to
 * `legacy`, so the grouped path is a deliberate choice in Settings.
 */

type ToolBlock = Extract<ProcessContentBlock, { type: "toolCall" }>;
type TextBlock = Extract<ProcessContentBlock, { type: "text" }>;
type ReasonBlock = Extract<ProcessContentBlock, { type: "thinking" }>;

interface Step {
  id: string;
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
function toolStep(blocks: ToolBlock[], t: (key: string) => string): Step {
  const first = blocks[0];
  const id = blocks.length === 1 ? first.id : `group:${first.id}`;
  const failed = blocks.some((b) => b.status === "error");

  // A failed call keeps its raw tool name: the semantic verb would hide which
  // tool actually broke, which is the one thing the user needs from that row.
  if (failed) {
    const durations = blocks.map((b) => b.duration).filter((d): d is number => d !== undefined);
    return {
      id,
      label: blocks.length === 1 ? first.toolName : `${first.toolName} +${blocks.length - 1}`,
      icon: "warning",
      targets: [],
      duration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
      failed: true,
      count: blocks.length,
      blocks,
    };
  }

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
    label: tone ? t(TONE_LABEL_KEY[tone]) : first.toolName,
    icon: resolvedIcon,
    tone,
    targets,
    detail: tone === "command_execution" ? toolDetail(first, tone) : undefined,
    duration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
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
    steps.push(toolStep(buffer, t));
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
        // Only thinking blocks carry a duration; text blocks contribute 0 and
        // must not turn a known duration back into `undefined`.
        const added = block.type === "thinking" ? block.duration : undefined;
        if (added !== undefined) previous.duration = (previous.duration ?? 0) + added;
        continue;
      }
      steps.push({
        id: block.id,
        label: t(block.type === "thinking" ? "process.stepReasoning" : "process.stepNote"),
        icon: block.type === "thinking" ? "brain" : "checklist",
        targets: [],
        duration: block.type === "thinking" ? block.duration : undefined,
        thinking: block.type === "thinking",
        reasoning: true,
        blocks: [block],
      });
      continue;
    }

    steps.push({
      id: block.id,
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
export function summarizeSteps(steps: Step[], t: (key: string, params?: Record<string, string | number>) => string): string {
  let tools = 0;
  let failed = 0;
  let thoughts = 0;
  for (const step of steps) {
    if (step.thinking) {
      thoughts += step.blocks.length;
      continue;
    }
    if (step.blocks.length > 0 && step.blocks[0].type === "toolCall") {
      tools += step.count ?? step.blocks.length;
      if (step.failed) failed += step.blocks.length;
    }
  }
  const parts = [t("process.summaryTools", { count: tools })];
  if (failed > 0) parts.push(t("process.summaryFailed", { count: failed }));
  if (thoughts > 0) parts.push(t("process.summaryThoughts", { count: thoughts }));
  return parts.join(" · ");
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
        return onOpenFile ? (
          <button
            key={target}
            type="button"
            className="process-file-chip"
            title={target}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(target);
            }}
          >
            {inner}
          </button>
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
}: {
  blocks: ProcessContentBlock[];
  toolResults?: Map<string, ToolResultMessage>;
  onOpenSession?: (sessionId: string) => void;
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
}: {
  step: Step;
  toolResults?: Map<string, ToolResultMessage>;
  onOpenSession?: (sessionId: string) => void;
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
  return <ToolBody blocks={step.blocks} toolResults={toolResults} onOpenSession={onOpenSession} />;
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
  className?: string;
}

export function ProcessGroup({
  blocks,
  isStreaming = false,
  toolResults,
  onOpenFile,
  onOpenSession,
  reveal = false,
  className,
}: ProcessGroupProps) {
  const { t } = useI18n();
  const { displayMode } = useProcessDisplayMode();
  const steps = useMemo(() => buildProcessSteps(blocks, t), [blocks, t]);

  // Reasoning and note rows start open: their content is the point of the
  // timeline, and hiding it behind a click turns the view into a table of
  // contents. They render clamped to a few lines; `expandedIds` removes the
  // clamp. Keeping "is it open" and "is the clamp lifted" in two separate sets
  // means the row chevron keeps one consistent meaning (open / closed) instead
  // of cycling through three states.
  const defaultOpen = useMemo(
    () => new Set(steps.filter((step) => step.reasoning).map((step) => step.id)),
    [steps],
  );
  /** Explicit user overrides; absent = follow `defaultOpen`. */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [activeChip, setActiveChip] = useState<string | null>(null);

  if (steps.length === 0) return null;

  const tabsMode = displayMode === "tabs";

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

  const chipStep = tabsMode && activeChip ? steps.find((step) => step.id === activeChip) ?? null : null;

  return (
    <section
      className={`process-group${tabsMode ? " is-tabs" : " is-timeline"}${className ? ` ${className}` : ""}`}
      aria-label={t("process.groupLabel")}
      data-step-count={steps.length}
    >
      {tabsMode ? (
        <div className="process-chips" role="list">
          {steps.map((step) => {
            const active = step.id === activeChip;
            return (
              <button
                key={step.id}
                type="button"
                role="listitem"
                aria-expanded={active}
                className={[
                  "process-chip",
                  active ? " is-active" : "",
                  step.failed ? " is-failed" : "",
                  step.thinking ? " is-thinking" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setActiveChip(active ? null : step.id)}
              >
                <StepIcon name={step.icon} />
                <span className="process-chip-label">{step.label}</span>
                <FileChips targets={step.targets} onOpenFile={onOpenFile} compact />
                {step.detail && <span className="process-chip-detail">{step.detail}</span>}
                {step.failed && <span className="process-chip-failed">{t("process.failed")}</span>}
                <Duration seconds={step.duration} />
              </button>
            );
          })}
        </div>
      ) : (
        <ol className="process-steps">
          {steps.map((step, index) => {
            const id = step.id;
            const isOpen = isStepOpen(id);
            const last = index === steps.length - 1;
            return (
              <li
                key={id}
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
                  {step.detail && <span className="process-step-detail">{step.detail}</span>}
                  <Duration seconds={step.duration} />
                  {step.failed && <span className="process-step-failed">{t("process.failed")}</span>}
                </button>
                {isOpen && (
                  <StepBody
                    step={step}
                    toolResults={toolResults}
                    onOpenSession={onOpenSession}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {chipStep && (
        <StepBody
          step={chipStep}
          toolResults={toolResults}
          onOpenSession={onOpenSession}
        />
      )}
    </section>
  );
}
