/**
 * fork:zc-16 — CRUD helpers for `~/.pi/agent/prompts/*.md` (slash-command templates).
 *
 * `components/ChatInput.tsx` already indexes that directory through
 * `SLASH_SOURCES`, so this module only has to read and surgically edit files
 * that pi itself will pick up: the filename becomes the command name and the
 * frontmatter `description` is what the palette shows.
 *
 * Editing discipline mirrors the skills toggle (`lib/skill-frontmatter.ts`):
 * we never re-serialize the YAML. The `description` line is replaced in place
 * and the body is swapped after the closing fence, so comments, key order,
 * quoting style and unknown keys survive a round trip. A file without
 * frontmatter is valid and stays valid.
 *
 * Pure string/path logic (no fs) so `lib/prompt-files.test.mjs` can load it
 * directly; the route owns the filesystem and the `lib/path-security.ts`
 * boundary.
 */

import { join } from "node:path";

export const PROMPT_FILE_MAX_BYTES = 256 * 1024;
export const PROMPT_NAME_MAX_LENGTH = 64;

export interface PromptFileSummary {
  /** Command name without the `.md` extension. */
  name: string;
  description: string;
  size: number;
  mtime: string;
}

export interface PromptFile extends PromptFileSummary {
  /** Raw file contents exactly as stored (frontmatter included). */
  content: string;
  /** Markdown after the frontmatter fence (the whole file when there is none). */
  body: string;
}

// Dots are excluded from the stem: the only sanctioned extension is the `.md`
// suffix, which `normalizePromptName` strips before this pattern runs. That
// keeps `review.txt` from silently becoming `review.txt.md`.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Normalize a user supplied name. Accepts the name with or without the `.md`
 * suffix; rejects anything that could address outside the prompts directory
 * (separators, `..`, leading dots, NUL) or is empty/too long.
 */
export function normalizePromptName(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stem = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
  if (!stem || stem.length > PROMPT_NAME_MAX_LENGTH) return null;
  if (!NAME_PATTERN.test(stem)) return null;
  if (stem === "." || stem === "..") return null;
  return stem;
}

export function promptFileName(raw: string): string | null {
  const stem = normalizePromptName(raw);
  return stem ? `${stem}.md` : null;
}

/** Join a validated name onto the prompts root; null when the name is invalid. */
export function resolvePromptPath(root: string, raw: string): string | null {
  const fileName = promptFileName(raw);
  if (!fileName) return null;
  return join(root, fileName);
}

// ============================================================================
// Frontmatter (surgical, format preserving)
// ============================================================================

interface FrontmatterBlock {
  /** Index just past the opening `---` line. */
  openEnd: number;
  /** Index of the first `-` of the closing fence. */
  closeStart: number;
  /** Index just past the closing fence line (including its newline). */
  closeEnd: number;
  /** Newline sequence used by the opening line. */
  newline: string;
}

function findFrontmatterBlock(content: string): FrontmatterBlock | null {
  const opening = /^(?:\uFEFF)?---[ \t]*(\r\n|\n|\r)/.exec(content);
  if (!opening) return null;

  const rest = content.slice(opening[0].length);
  const closing = /(^|(\r\n|\n|\r))---[ \t]*(?=(\r\n|\n|\r|$))/.exec(rest);
  if (!closing) return null;

  const closeStart = opening[0].length + closing.index + closing[1].length;
  const afterFence = content.slice(closeStart);
  const fenceLine = /^---[ \t]*(?:\r\n|\n|\r)?/.exec(afterFence);
  const closeEnd = closeStart + (fenceLine ? fenceLine[0].length : 3);

  return {
    openEnd: opening[0].length,
    closeStart,
    closeEnd,
    newline: opening[1],
  };
}

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to the naive strip; the editor still shows something sane.
    }
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  // Block scalars (`>-`, `|`): the marker itself is not the description.
  if (/^[>|][+-]?$/.test(value)) return "";
  return value;
}

/** Read the frontmatter `description`; "" when absent or unparseable. */
export function readPromptDescription(content: string): string {
  const block = findFrontmatterBlock(content);
  if (!block) return "";
  const head = content.slice(block.openEnd, block.closeStart);
  const match = /^[ \t]*description[ \t]*:([^\r\n]*)/m.exec(head);
  return match ? unquoteYamlScalar(match[1]) : "";
}

function yamlScalar(value: string): string {
  const plain = /^[A-Za-z0-9][A-Za-z0-9 ._()/-]*$/.test(value)
    && !/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(value)
    && value.length <= 200;
  return plain ? value : JSON.stringify(value);
}

/**
 * Replace (or insert, or remove when empty) only the `description` key. Every
 * other frontmatter line and the whole body are copied verbatim.
 */
export function setPromptDescription(content: string, description: string): string {
  const value = description.trim();
  const block = findFrontmatterBlock(content);

  if (!block) {
    if (!value) return content;
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? content.slice(1) : content;
    return `${bom}---\ndescription: ${yamlScalar(value)}\n---\n${body}`;
  }

  const head = content.slice(block.openEnd, block.closeStart);
  const line = `description: ${yamlScalar(value)}`;

  if (value === "") {
    const removed = head.replace(/^[ \t]*description[ \t]*:[^\r\n]*(?:\r\n|\n|\r)?/m, "");
    return content.slice(0, block.openEnd) + removed + content.slice(block.closeStart);
  }

  if (/^[ \t]*description[ \t]*:/m.test(head)) {
    const replaced = head.replace(/^([ \t]*)description[ \t]*:[^\r\n]*/m, `$1${line}`);
    return content.slice(0, block.openEnd) + replaced + content.slice(block.closeStart);
  }

  return content.slice(0, block.openEnd) + line + block.newline + content.slice(block.openEnd);
}

// ============================================================================
// Body
// ============================================================================

export function readPromptBody(content: string): string {
  const block = findFrontmatterBlock(content);
  if (!block) return content;
  return content.slice(block.closeEnd);
}

/**
 * Swap the markdown after the closing fence while keeping the whitespace the
 * user had between fence and body (for example the conventional blank line).
 */
export function replacePromptBody(content: string, body: string): string {
  const block = findFrontmatterBlock(content);
  if (!block) return body;
  const afterFence = content.slice(block.closeEnd);
  const firstBodyIndex = afterFence.search(/[^ \t\r\n]/);
  const leading = firstBodyIndex === -1
    ? (afterFence || `${block.newline}${block.newline}`)
    : afterFence.slice(0, firstBodyIndex);
  return content.slice(0, block.closeEnd) + leading + body;
}

export function buildPromptContent(description: string, body: string): string {
  const value = description.trim();
  const frontmatter = value ? `---\ndescription: ${yamlScalar(value)}\n---\n` : "";
  return `${frontmatter}\n${body}`;
}

export function parsePromptFile(
  content: string,
  name: string,
  size: number,
  mtime: string,
): PromptFile {
  return {
    name,
    description: readPromptDescription(content),
    size,
    mtime,
    content,
    body: readPromptBody(content),
  };
}
